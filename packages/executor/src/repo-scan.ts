import { readdir, realpath, stat } from "node:fs/promises";
import { readFileSafe } from "./editor.js";
import path = require("node:path");

const MAX_RELEVANT_FILES = 8;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
]);

const SEARCHABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "have",
  "when",
  "then",
  "line",
  "column",
]);

async function resolveWorkspaceRoot(workspacePath: string): Promise<string> {
  const absolutePath = path.resolve(workspacePath);

  try {
    return await realpath(absolutePath);
  } catch {
    throw new Error(`Workspace does not exist: ${absolutePath}`);
  }
}

function toRelativePosix(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile();
  } catch {
    return false;
  }
}

async function collectFilesRecursively(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name);
      if (
        SEARCHABLE_EXTENSIONS.has(extension) ||
        entry.name === "package.json"
      ) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootPath);

  return files;
}

function extractTokens(input: string): string[] {
  const rawTokens = input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !STOP_WORDS.has(token));

  return Array.from(new Set(rawTokens)).slice(0, 12);
}

function extractStackTracePaths(stackTrace: string): string[] {
  const matches = Array.from(
    stackTrace.matchAll(
      /([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json))(?:\:\d+(?:\:\d+)?)?/g,
    ),
  );

  const candidates: string[] = [];

  for (const match of matches) {
    const candidate = match[1];
    if (candidate) {
      candidates.push(candidate.replace(/\\/g, "/"));
    }
  }

  return Array.from(new Set(candidates));
}

async function addIfPresent(
  results: string[],
  seen: Set<string>,
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  if (results.length >= MAX_RELEVANT_FILES) {
    return;
  }

  const absolutePath = path.join(workspaceRoot, relativePath);
  if (!(await fileExists(absolutePath))) {
    return;
  }

  const normalizedPath = relativePath.split(path.sep).join("/");
  if (seen.has(normalizedPath)) {
    return;
  }

  seen.add(normalizedPath);
  results.push(normalizedPath);
}

export async function scanRelevantFiles(
  workspacePath: string,
  bugDescription: string,
  stackTrace: string | null,
): Promise<string[]> {
  const workspaceRoot = await resolveWorkspaceRoot(workspacePath);
  const results: string[] = [];
  const seen = new Set<string>();

  await addIfPresent(results, seen, workspaceRoot, "package.json");
  await addIfPresent(results, seen, workspaceRoot, "tsconfig.json");

  if (stackTrace) {
    const stackPaths = extractStackTracePaths(stackTrace);

    for (const candidatePath of stackPaths) {
      if (results.length >= MAX_RELEVANT_FILES) {
        break;
      }

      const normalizedCandidate = candidatePath.startsWith("/")
        ? candidatePath
        : path.join(workspaceRoot, candidatePath);

      if (!(await fileExists(normalizedCandidate))) {
        continue;
      }

      const relativePath = path.isAbsolute(normalizedCandidate)
        ? toRelativePosix(workspaceRoot, normalizedCandidate)
        : candidatePath;

      if (
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath) ||
        seen.has(relativePath)
      ) {
        continue;
      }

      seen.add(relativePath);
      results.push(relativePath);
    }
  }

  if (results.length >= MAX_RELEVANT_FILES) {
    return results;
  }

  const candidateFiles = await collectFilesRecursively(workspaceRoot);
  const searchTokens = extractTokens(bugDescription);

  if (searchTokens.length === 0) {
    return results;
  }

  const scoredFiles: Array<{ path: string; score: number }> = [];

  for (const candidateFile of candidateFiles) {
    const relativePath = toRelativePosix(workspaceRoot, candidateFile);

    if (seen.has(relativePath)) {
      continue;
    }

    let content = "";
    try {
      content = await readFileSafe(workspaceRoot, relativePath);
    } catch {
      continue;
    }

    const lowerContent = content.toLowerCase();
    const lowerRelativePath = relativePath.toLowerCase();

    let score = 0;

    for (const token of searchTokens) {
      if (lowerRelativePath.includes(token)) {
        score += 3;
      }

      if (lowerContent.includes(token)) {
        score += 1;
      }
    }

    if (score > 0) {
      scoredFiles.push({
        path: relativePath,
        score,
      });
    }
  }

  scoredFiles.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.path.localeCompare(right.path);
  });

  for (const entry of scoredFiles) {
    if (results.length >= MAX_RELEVANT_FILES) {
      break;
    }

    if (seen.has(entry.path)) {
      continue;
    }

    seen.add(entry.path);
    results.push(entry.path);
  }

  return results;
}
