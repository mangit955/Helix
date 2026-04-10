import { readFileSafe, scanRelevantFiles } from "@repo/executor";
import type { ContextFile } from "@repo/shared/types";

export async function buildPromptContext(input: {
  workspacePath: string;
  bugDescription: string;
  stackTrace: string | null;
}): Promise<ContextFile[]> {
  const relevantFiles = await scanRelevantFiles(
    input.workspacePath,
    input.bugDescription,
    input.stackTrace,
  );

  const contextFiles: ContextFile[] = [];

  for (const filePath of relevantFiles) {
    const content = await readFileSafe(input.workspacePath, filePath);
    contextFiles.push({
      path: filePath,
      content,
    });
  }

  return contextFiles;
}
