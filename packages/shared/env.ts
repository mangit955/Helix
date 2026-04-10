import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

let envLoaded = false;

function findWorkspaceEnvFile(): string | null {
  const currentFilePath = fileURLToPath(import.meta.url);
  let currentDirectory = path.dirname(currentFilePath);

  while (true) {
    const candidatePath = path.join(currentDirectory, ".env");
    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    const packageJsonPath = path.join(currentDirectory, "package.json");
    const pnpmWorkspacePath = path.join(currentDirectory, "pnpm-workspace.yaml");

    if (existsSync(packageJsonPath) && existsSync(pnpmWorkspacePath)) {
      return candidatePath;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

export function ensureWorkspaceEnvLoaded(): void {
  if (envLoaded) {
    return;
  }

  const envPath = findWorkspaceEnvFile();
  if (envPath && existsSync(envPath)) {
    loadEnvFile(envPath);
  }

  envLoaded = true;
}
