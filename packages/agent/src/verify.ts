import { runCommand } from "@repo/executor";
import type { AttemptVerification, CommandExecution } from "@repo/shared/types";

export interface VerifyAttemptInput {
  workspacePath: string;
  bugDescription: string;
  stackTrace: string | null;
  timeoutMs?: number;
}

function combinedLogs(logs: CommandExecution[]): string {
  return logs
    .map((log) => `${log.stdout}\n${log.stderr}`)
    .join("\n")
    .toLowerCase();
}

function bugStillPresent(
  logs: CommandExecution[],
  bugDescription: string,
  stackTrace: string | null,
): boolean {
  const combined = combinedLogs(logs);
  const needles = [bugDescription, stackTrace]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.toLowerCase());

  if (needles.length === 0) {
    return false;
  }

  return needles.some((needle) => combined.includes(needle));
}

export async function verifyAttempt(
  input: VerifyAttemptInput,
): Promise<AttemptVerification> {
  const timeoutMs = input.timeoutMs ?? 120_000;

  const logs: CommandExecution[] = [];

  const buildLog = await runCommand(
    input.workspacePath,
    "pnpm",
    ["build"],
    timeoutMs,
  );
  logs.push(buildLog);

  const testLog = await runCommand(
    input.workspacePath,
    "pnpm",
    ["test"],
    timeoutMs,
  );
  logs.push(testLog);

  const buildPassed = buildLog.exitCode === 0;
  const testsPassed = testLog.exitCode === 0;
  const bugResolved = !bugStillPresent(
    logs,
    input.bugDescription,
    input.stackTrace,
  );

  const errors: string[] = [];

  if (!buildPassed) {
    errors.push("Build failed.");
  }

  if (!testsPassed) {
    errors.push("Tests failed.");
  }

  if (!bugResolved) {
    errors.push("The original bug text still appeared in build or test logs.");
  }

  return {
    success: buildPassed && testsPassed && bugResolved,
    buildPassed,
    testsPassed,
    bugResolved,
    logs,
    errors,
  };
}
