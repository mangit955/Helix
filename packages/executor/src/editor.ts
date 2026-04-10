import { readFile, realpath, writeFile } from "node:fs/promises";
import type { TextEdit } from "@repo/shared/types";
import path = require("node:path");

async function resolveWorkspaceRoot(workspacePath: string): Promise<string> {
  const resolvedWorkspacePath = path.resolve(workspacePath);

  try {
    return await realpath(resolvedWorkspacePath);
  } catch {
    throw new Error(`Workspace does not exist: ${resolvedWorkspacePath}`);
  }
}

async function resolvePathInsideWorkspace(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  if (!relativePath.trim()) {
    throw new Error("relativePath must be a non-empty string.");
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }

  const workspaceRoot = await resolveWorkspaceRoot(workspacePath);
  const candidatePath = path.resolve(workspaceRoot, relativePath);

  let normalizedCandidatePath: string;
  try {
    normalizedCandidatePath = await realpath(candidatePath);
  } catch {
    normalizedCandidatePath = candidatePath;
  }

  const relativeToRoot = path.relative(workspaceRoot, normalizedCandidatePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Path escapes the workspace root: ${relativePath}`);
  }

  return candidatePath;
}

function countOccurrences(content: string, search: string): number {
  if (!search) {
    return 0;
  }

  return content.split(search).length - 1;
}

export async function readFileSafe(
  workspacePath: string,
  relativePath: string,
): Promise<string> {
  const filePath = await resolvePathInsideWorkspace(
    workspacePath,
    relativePath,
  );

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read ${relativePath}: ${error.message}`);
    }

    throw new Error(`Failed to read ${relativePath}.`);
  }
}

export async function applyTextEdits(
  workspacePath: string,
  edits: TextEdit[],
): Promise<string[]> {
  if (edits.length === 0) {
    return [];
  }

  const editsByPath = new Map<string, TextEdit[]>();

  for (const edit of edits) {
    if (!edit.path.trim()) {
      throw new Error("Edit path must be a non-empty string.");
    }

    if (!edit.search) {
      throw new Error(`Edit search text must be non-empty for ${edit.path}.`);
    }

    const existingEdits = editsByPath.get(edit.path) ?? [];
    existingEdits.push(edit);
    editsByPath.set(edit.path, existingEdits);
  }

  const changedFiles: string[] = [];

  for (const [relativePath, fileEdits] of Array.from(editsByPath.entries())) {
    const absolutePath = await resolvePathInsideWorkspace(
      workspacePath,
      relativePath,
    );

    let content = await readFileSafe(workspacePath, relativePath);

    for (const edit of fileEdits) {
      const matchCount = countOccurrences(content, edit.search);

      if (matchCount !== 1) {
        throw new Error(
          `Edit for ${relativePath} expected exactly 1 match but found ${matchCount}.`,
        );
      }

      content = content.replace(edit.search, edit.replace);
    }

    await writeFile(absolutePath, content, "utf8");
    changedFiles.push(relativePath);
  }

  return changedFiles;
}
