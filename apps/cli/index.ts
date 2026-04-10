#!/usr/bin/env node
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  CreateFixJobInput,
  CreateFixJobResponse,
  FixJobApiRecord,
  GetFixJobResponse,
} from "./../../packages/shared/types.js";

interface ParsedFixCommand {
  repoPath: string;
  bugDescription: string;
  stackTrace: string | null;
  maxAttempts?: number;
  apiBaseUrl: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

function printUsage(): void {
  console.log(
    `
Usage:
  helix fix --repo <path> --bug <description> [options]

Required:
  --repo, -r           Path to the local repository
  --bug, -b            Bug description to fix

Optional:
  --stack, -s          Stack trace or error output
  --max-attempts       Maximum retry attempts
  --api                API base URL (default: http://127.0.0.1:4000)
  --poll-interval      Poll interval in ms (default: 2000)
  --timeout            Overall timeout in ms (default: 600000)
  --help, -h           Show this help message

Examples:
  helix fix --repo ./demo-app --bug "TypeError: Cannot read properties of undefined"

  helix fix \\
    --repo ./demo-app \\
    --bug "Build fails in production" \\
    --stack "src/index.ts:14 TypeError: Cannot read properties of undefined" \\
    --max-attempts 3
`.trim(),
  );
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("-")) {
    throw new Error(`Expected a value after ${flag}.`);
  }

  return value;
}

function parsePositiveInteger(rawValue: string, flag: string): number {
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${flag} must be a positive integer. Received: ${rawValue}`,
    );
  }

  return parsed;
}

function normalizeApiBaseUrl(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, "");
}

function getInvocationCwd(): string {
  const initCwd = process.env.INIT_CWD?.trim();

  if (initCwd) {
    return initCwd;
  }

  return process.cwd();
}

function normalizeArgv(argv: string[]): string[] {
  if (argv[0] === "--") {
    return argv.slice(1);
  }

  return argv;
}

function parseCommandLine(argv: string[]): ParsedFixCommand {
  const normalizedArgv = normalizeArgv(argv);
  const [command, ...args] = normalizedArgv;

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command !== "fix") {
    throw new Error(
      `Unknown command "${command}". Only "fix" is supported right now.`,
    );
  }

  let repoPath: string | undefined;
  let bugDescription: string | undefined;
  let stackTrace: string | null = null;
  let maxAttempts: number | undefined;
  let apiBaseUrl = normalizeApiBaseUrl(
    process.env.HELIX_API_URL ??
      `http://127.0.0.1:${process.env.API_PORT ?? "4000"}`,
  );
  let pollIntervalMs = 2_000;
  let timeoutMs = 600_000;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--repo":
      case "-r": {
        repoPath = readOptionValue(args, index, arg);
        index += 1;
        break;
      }

      case "--bug":
      case "-b":
      case "--error": {
        bugDescription = readOptionValue(args, index, arg);
        index += 1;
        break;
      }

      case "--stack":
      case "-s": {
        stackTrace = readOptionValue(args, index, arg);
        index += 1;
        break;
      }

      case "--max-attempts": {
        maxAttempts = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      }

      case "--api": {
        apiBaseUrl = normalizeApiBaseUrl(readOptionValue(args, index, arg));
        index += 1;
        break;
      }

      case "--poll-interval": {
        pollIntervalMs = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      }

      case "--timeout": {
        timeoutMs = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      }

      case "--help":
      case "-h": {
        printUsage();
        process.exit(0);
      }

      default: {
        throw new Error(
          `Unknown argument "${arg}". Run "helix --help" for usage.`,
        );
      }
    }
  }

  if (!repoPath || repoPath.trim().length === 0) {
    throw new Error("Missing required --repo argument.");
  }

  if (!bugDescription || bugDescription.trim().length === 0) {
    throw new Error("Missing required --bug argument.");
  }

  return {
    repoPath: path.resolve(getInvocationCwd(), repoPath.trim()),
    bugDescription: bugDescription.trim(),
    stackTrace: stackTrace?.trim() ? stackTrace.trim() : null,
    maxAttempts,
    apiBaseUrl,
    pollIntervalMs,
    timeoutMs,
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON response but received: ${text}`);
  }
}

function getErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallbackMessage;
}

function getFetchFailureMessage(
  error: unknown,
  apiBaseUrl: string,
  action: string,
): string {
  if (error instanceof Error) {
    return `Unable to ${action} at ${apiBaseUrl}. Make sure the API server is running and reachable. Original error: ${error.message}`;
  }

  return `Unable to ${action} at ${apiBaseUrl}. Make sure the API server is running and reachable.`;
}

async function createFixJob(
  apiBaseUrl: string,
  input: CreateFixJobInput,
): Promise<CreateFixJobResponse> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}/fix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new Error(getFetchFailureMessage(error, apiBaseUrl, "submit a fix job"));
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        payload,
        `Failed to create fix job. HTTP ${response.status}`,
      ),
    );
  }

  return payload as CreateFixJobResponse;
}

async function getFixJob(
  apiBaseUrl: string,
  jobId: string,
): Promise<GetFixJobResponse> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}/jobs/${jobId}`);
  } catch (error) {
    throw new Error(getFetchFailureMessage(error, apiBaseUrl, "poll job status"));
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `Failed to fetch job. HTTP ${response.status}`),
    );
  }

  return payload as GetFixJobResponse;
}

function formatCheck(value: boolean | null | undefined): string {
  if (value === true) {
    return "pass";
  }

  if (value === false) {
    return "fail";
  }

  return "pending";
}

function printJobUpdate(job: FixJobApiRecord): void {
  console.log("");
  console.log(`Job ${job.id}`);
  console.log(`Status: ${job.status}`);
  console.log(`Repo: ${job.repoPath}`);
  console.log(`Bug: ${job.bugDescription}`);
  console.log(`Attempts: ${job.currentAttempt}/${job.maxAttempts}`);

  if (job.failureReason) {
    console.log(`Failure reason: ${job.failureReason}`);
  }

  if (job.attempts.length === 0) {
    console.log("No attempts recorded yet.");
    return;
  }

  for (const attempt of job.attempts) {
    console.log(
      `Attempt ${attempt.attemptNumber}: ${attempt.status} | build=${formatCheck(attempt.buildPassed)} | tests=${formatCheck(attempt.testsPassed)} | bug=${formatCheck(attempt.bugResolved)}`,
    );

    if (attempt.errorMessage) {
      console.log(
        `Attempt ${attempt.attemptNumber} error: ${attempt.errorMessage}`,
      );
    }
  }
}

function createSnapshotKey(job: FixJobApiRecord): string {
  return JSON.stringify({
    status: job.status,
    currentAttempt: job.currentAttempt,
    failureReason: job.failureReason,
    attempts: job.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      buildPassed: attempt.buildPassed,
      testsPassed: attempt.testsPassed,
      bugResolved: attempt.bugResolved,
      errorMessage: attempt.errorMessage,
    })),
  });
}

async function waitForJobCompletion(
  apiBaseUrl: string,
  jobId: string,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<FixJobApiRecord> {
  const startedAt = Date.now();
  let previousSnapshot = "";

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await getFixJob(apiBaseUrl, jobId);
    const { job } = payload;
    const snapshot = createSnapshotKey(job);

    if (snapshot !== previousSnapshot) {
      printJobUpdate(job);
      previousSnapshot = snapshot;
    }

    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms while waiting for job ${jobId} to finish.`,
  );
}

async function main(): Promise<void> {
  const parsed = parseCommandLine(process.argv.slice(2));

  const input: CreateFixJobInput = {
    repoPath: parsed.repoPath,
    bugDescription: parsed.bugDescription,
    stackTrace: parsed.stackTrace,
    maxAttempts: parsed.maxAttempts,
  };

  console.log(`Submitting fix job to ${parsed.apiBaseUrl}...`);
  const createdJob = await createFixJob(parsed.apiBaseUrl, input);

  console.log(
    `Created job ${createdJob.jobId}. Initial status: ${createdJob.status}`,
  );

  const finalJob = await waitForJobCompletion(
    parsed.apiBaseUrl,
    createdJob.jobId,
    parsed.pollIntervalMs,
    parsed.timeoutMs,
  );

  if (finalJob.status === "completed") {
    console.log("");
    console.log(`Job ${finalJob.id} completed successfully.`);
    return;
  }

  throw new Error(finalJob.failureReason ?? `Job ${finalJob.id} failed.`);
}

void main().catch((error: unknown) => {
  console.error("");
  console.error("CLI failed.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unknown error");
  }

  process.exitCode = 1;
});
