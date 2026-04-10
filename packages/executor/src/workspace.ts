import os from "node:os";
import path from "node:path";
import { cp, mkdir, realpath, rm, stat } from "node:fs/promises";

const HELIX_TMP_ROOT = path.join(os.tmpdir(), "helix");

async function assertDirectoryExists(directoryPath: string): Promise<string> {
  const absolutePath = path.resolve(directoryPath);

  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    throw new Error(`Directory does not exist: ${absolutePath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Expected a directory but received: ${absolutePath}`);
  }

  return realpath(absolutePath);
}

function getJobRoot(jobId: string): string {
  const normalizedJobId = jobId.trim();

  if (!normalizedJobId) {
    throw new Error("jobId must be a non-empty string.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(normalizedJobId)) {
    throw new Error(
      `jobId contains unsupported characters: ${normalizedJobId}`,
    );
  }

  return path.join(HELIX_TMP_ROOT, normalizedJobId);
}

export async function prepareBaseWorkspace(
  repoPath: string,
  jobId: string,
): Promise<string> {
  const sourceRepoPath = await assertDirectoryExists(repoPath);
  const jobRoot = getJobRoot(jobId);
  const baseWorkspacePath = path.join(jobRoot, "base");

  await rm(jobRoot, { recursive: true, force: true });
  await mkdir(jobRoot, { recursive: true });

  await cp(sourceRepoPath, baseWorkspacePath, {
    recursive: true,
    force: true,
  });

  return baseWorkspacePath;
}

export async function createAttemptWorkspace(
  baseWorkspacePath: string,
  attemptNumber: number,
): Promise<string> {
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    throw new Error(
      `attemptNumber must be a positive integer. Received: ${attemptNumber}`,
    );
  }

  const resolvedBaseWorkspacePath =
    await assertDirectoryExists(baseWorkspacePath);

  const jobRoot = path.dirname(resolvedBaseWorkspacePath);
  const attemptWorkspacePath = path.join(jobRoot, `attempt-${attemptNumber}`);

  await rm(attemptWorkspacePath, { recursive: true, force: true });

  await cp(resolvedBaseWorkspacePath, attemptWorkspacePath, {
    recursive: true,
    force: true,
  });

  return attemptWorkspacePath;
}
