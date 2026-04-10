import type { ContextFile } from "@repo/shared/types";

export interface BuildPlanPromptInput {
  bugDescription: string;
  stackTrace: string | null;
  contextFiles: ContextFile[];
  previousFailures: string[];
}

export interface PlanPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export const PLAN_SYSTEM_PROMPT = `You are fixing a TypeScript/Node bug in a local repository.

Return JSON only with this shape:
{
  "rootCause": "string",
  "planSummary": "string",
  "patchSummary": "string",
  "edits": [
    {
      "path": "relative/path/to/file.ts",
      "search": "exact old code snippet",
      "replace": "new code snippet"
    }
  ],
  "commandsToRun": ["pnpm build", "pnpm test"]
}

Rules:
- Edit at most 3 files.
- Use exact search strings taken from the provided file contents.
- Do not invent files that were not provided unless absolutely necessary.
- Prefer the smallest viable fix.
- If the bug is uncertain, still propose the best concrete patch.`;

export function buildPlanPrompt(input: BuildPlanPromptInput): PlanPrompt {
  const previousFailuresSection =
    input.previousFailures.length > 0
      ? input.previousFailures
          .map((failure, index) => `Attempt ${index + 1}: ${failure}`)
          .join("\n")
      : "None";

  const contextSection =
    input.contextFiles.length > 0
      ? input.contextFiles
          .map(
            (file) => `FILE: ${file.path}\n\`\`\`ts\n${file.content}\n\`\`\``,
          )
          .join("\n\n")
      : "No context files were available.";

  const userPrompt = [
    `Bug description: ${input.bugDescription}`,
    `Stack trace: ${input.stackTrace ?? "None provided"}`,
    "",
    "Previous failed attempts:",
    previousFailuresSection,
    "",
    "Repository context files:",
    contextSection,
    "",
    "Return JSON only.",
  ].join("\n");

  return {
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userPrompt,
  };
}
