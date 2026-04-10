import type { Prisma } from "@prisma/client";
import {
  applyTextEdits,
  createAttemptWorkspace,
  prepareBaseWorkspace,
} from "@repo/executor";
import { prisma } from "@repo/shared/prisma";
import type { AgentPlan, AttemptVerification } from "@repo/shared/types";
import { buildPromptContext } from "./context.js";
import type { ModelClient } from "./model.js";
import { buildPlanPrompt } from "./prompts.js";
import { verifyAttempt } from "./verify.js";

export interface RunFixJobInput {
  jobId: string;
  repoPath: string;
  bugDescription: string;
  stackTrace: string | null;
  maxAttempts: number;
  modelClient: ModelClient;
}

export interface RunFixJobResult {
  success: boolean;
  jobId: string;
  completedAttemptCount: number;
  failureReason: string | null;
}

function serializeJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return value;
}

function getAttemptErrorMessage(
  verification: AttemptVerification,
  fallbackMessage: string,
): string {
  if (verification.errors.length > 0) {
    return verification.errors.join(" ");
  }

  return fallbackMessage;
}

function toFailureSummary(input: {
  attemptNumber: number;
  errorMessage: string;
  plan?: AgentPlan;
}): string {
  const planSummary = input.plan?.planSummary
    ? ` Plan: ${input.plan.planSummary}`
    : "";

  return `Attempt ${input.attemptNumber} failed: ${input.errorMessage}.${planSummary}`;
}

export async function runFixJob(
  input: RunFixJobInput,
): Promise<RunFixJobResult> {
  const previousFailures: string[] = [];

  const baseWorkspacePath = await prepareBaseWorkspace(
    input.repoPath,
    input.jobId,
  );

  for (
    let attemptNumber = 1;
    attemptNumber <= input.maxAttempts;
    attemptNumber += 1
  ) {
    await prisma.fixJob.update({
      where: { id: input.jobId },
      data: {
        currentAttempt: attemptNumber,
      },
    });

    const attemptWorkspacePath = await createAttemptWorkspace(
      baseWorkspacePath,
      attemptNumber,
    );

    const attemptRecord = await prisma.attempt.create({
      data: {
        fixJobId: input.jobId,
        attemptNumber,
        status: "running",
        workspacePath: attemptWorkspacePath,
      },
    });

    let promptText: string | null = null;
    let generatedPlan: AgentPlan | null = null;

    try {
      const contextFiles = await buildPromptContext({
        workspacePath: attemptWorkspacePath,
        bugDescription: input.bugDescription,
        stackTrace: input.stackTrace,
      });

      const prompt = buildPlanPrompt({
        bugDescription: input.bugDescription,
        stackTrace: input.stackTrace,
        contextFiles,
        previousFailures,
      });

      promptText = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

      generatedPlan = await input.modelClient.generatePlan({
        bugDescription: input.bugDescription,
        stackTrace: input.stackTrace,
        contextFiles,
        previousFailures,
      });

      const changedFiles = await applyTextEdits(
        attemptWorkspacePath,
        generatedPlan.edits,
      );

      const verification = await verifyAttempt({
        workspacePath: attemptWorkspacePath,
        bugDescription: input.bugDescription,
        stackTrace: input.stackTrace,
      });

      const errorMessage = verification.success
        ? null
        : getAttemptErrorMessage(
            verification,
            "Verification failed after applying the generated patch.",
          );

      await prisma.attempt.update({
        where: { id: attemptRecord.id },
        data: {
          status: verification.success ? "succeeded" : "failed",
          rootCause: generatedPlan.rootCause,
          planSummary: generatedPlan.planSummary,
          patchSummary: generatedPlan.patchSummary,
          modelPrompt: promptText,
          modelResponse: JSON.stringify(generatedPlan, null, 2),
          filesChanged: serializeJson(changedFiles),
          commandLogs: serializeJson(
            verification.logs as unknown as Prisma.InputJsonValue,
          ),
          buildPassed: verification.buildPassed,
          testsPassed: verification.testsPassed,
          bugResolved: verification.bugResolved,
          errorMessage,
          completedAt: new Date(),
        },
      });

      if (verification.success) {
        return {
          success: true,
          jobId: input.jobId,
          completedAttemptCount: attemptNumber,
          failureReason: null,
        };
      }

      previousFailures.push(
        toFailureSummary({
          attemptNumber,
          errorMessage:
            errorMessage ??
            "Verification failed without a specific error message",
          plan: generatedPlan,
        }),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown attempt failure.";

      await prisma.attempt.update({
        where: { id: attemptRecord.id },
        data: {
          status: "failed",
          rootCause: generatedPlan?.rootCause ?? null,
          planSummary: generatedPlan?.planSummary ?? null,
          patchSummary: generatedPlan?.patchSummary ?? null,
          modelPrompt: promptText,
          modelResponse: generatedPlan
            ? JSON.stringify(generatedPlan, null, 2)
            : null,
          errorMessage,
          completedAt: new Date(),
        },
      });

      previousFailures.push(
        toFailureSummary({
          attemptNumber,
          errorMessage,
          plan: generatedPlan ?? undefined,
        }),
      );
    }
  }

  const failureReason =
    previousFailures.at(-1) ?? "All attempts failed without a recorded reason.";

  return {
    success: false,
    jobId: input.jobId,
    completedAttemptCount: input.maxAttempts,
    failureReason,
  };
}
