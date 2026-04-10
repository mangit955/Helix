import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { CommandExecution } from "@repo/shared/types";
import path = require("node:path");

const ALLOWED_COMMANDS = new Set(["pnpm", "npm", "yarn", "node", "npx"]);

async function resolveWorkspaceRoot(workspacePath: string): Promise<string> {
  const absolutePath = path.resolve(workspacePath);

  try {
    return await realpath(absolutePath);
  } catch {
    throw new Error(`Workspace does not exist: ${absolutePath}`);
  }
}

function assertAllowedCommand(command: string): void {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(
      `Command "${command}" is not allowed. Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`,
    );
  }
}

function formatCommandPart(part: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(part)) {
    return part;
  }

  return JSON.stringify(part);
}

export async function runCommand(
  workspacePath: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandExecution> {
  const resolvedWorkspacePath = await resolveWorkspaceRoot(workspacePath);
  assertAllowedCommand(command);

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `timeoutMs must be a positive integer. Received: ${timeoutMs}`,
    );
  }

  const startedAt = Date.now();

  return new Promise<CommandExecution>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, args, {
      cwd: resolvedWorkspacePath,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(
        new Error(`Failed to start command "${command}": ${error.message}`),
      );
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeoutHandle);

      const durationMs = Date.now() - startedAt;
      const commandText = [command, ...args].map(formatCommandPart).join(" ");

      let finalStderr = stderr;

      if (timedOut) {
        finalStderr =
          `${finalStderr}\nCommand timed out after ${timeoutMs}ms.`.trim();
      }

      if (signal) {
        finalStderr =
          `${finalStderr}\nProcess exited with signal ${signal}.`.trim();
      }

      resolve({
        command: commandText,
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        stdout,
        stderr: finalStderr,
        durationMs,
      });
    });
  });
}
