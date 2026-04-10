import { buildPlanPrompt } from "./prompts.js";
import type { AgentPlan, ContextFile } from "@repo/shared/types";

export interface ModelClient {
  generatePlan(input: {
    bugDescription: string;
    stackTrace: string | null;
    contextFiles: ContextFile[];
    previousFailures: string[];
  }): Promise<AgentPlan>;
}

export interface RawCompletionClient {
  complete(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function parseAgentPlan(value: unknown): AgentPlan {
  if (!isObject(value)) {
    throw new Error("Model response must be a JSON object.");
  }

  const { rootCause, planSummary, patchSummary, edits, commandsToRun } = value;

  if (typeof rootCause !== "string" || !rootCause.trim()) {
    throw new Error(
      "Model response field `rootCause` must be a non-empty string.",
    );
  }

  if (typeof planSummary !== "string" || !planSummary.trim()) {
    throw new Error(
      "Model response field `planSummary` must be a non-empty string.",
    );
  }

  if (typeof patchSummary !== "string" || !patchSummary.trim()) {
    throw new Error(
      "Model response field `patchSummary` must be a non-empty string.",
    );
  }

  if (!Array.isArray(edits)) {
    throw new Error("Model response field `edits` must be an array.");
  }

  if (edits.length > 3) {
    throw new Error("Model response may edit at most 3 files.");
  }

  const parsedEdits = edits.map((edit, index) => {
    if (!isObject(edit)) {
      throw new Error(`Edit ${index + 1} must be an object.`);
    }

    if (typeof edit.path !== "string" || !edit.path.trim()) {
      throw new Error(
        `Edit ${index + 1} field \`path\` must be a non-empty string.`,
      );
    }

    if (typeof edit.search !== "string" || !edit.search) {
      throw new Error(
        `Edit ${index + 1} field \`search\` must be a non-empty string.`,
      );
    }

    if (typeof edit.replace !== "string") {
      throw new Error(`Edit ${index + 1} field \`replace\` must be a string.`);
    }

    return {
      path: edit.path,
      search: edit.search,
      replace: edit.replace,
    };
  });

  return {
    rootCause,
    planSummary,
    patchSummary,
    edits: parsedEdits,
    commandsToRun: parseStringArray(commandsToRun, "commandsToRun"),
  };
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export class JsonModelClient implements ModelClient {
  constructor(private readonly rawCompletionClient: RawCompletionClient) {}

  async generatePlan(input: {
    bugDescription: string;
    stackTrace: string | null;
    contextFiles: ContextFile[];
    previousFailures: string[];
  }): Promise<AgentPlan> {
    const prompt = buildPlanPrompt(input);
    const rawResponse = await this.rawCompletionClient.complete(prompt);
    const normalizedResponse = stripCodeFences(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(normalizedResponse);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Model did not return valid JSON: ${error.message}`);
      }

      throw new Error("Model did not return valid JSON.");
    }

    return parseAgentPlan(parsed);
  }
}
