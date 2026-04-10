import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Prisma } from "@prisma/client";
import { fixQueue } from "@repo/shared/queue";
import { prisma } from "@repo/shared/prisma";
import type {
  CreateFixJobInput,
  CreateFixJobResponse,
  GetFixJobResponse,
} from "@repo/shared/types";

class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const apiPort = parsePort(process.env.API_PORT, 4000);

function parsePort(rawPort: string | undefined, fallbackPort: number): number {
  const parsedPort = Number.parseInt(rawPort ?? `${fallbackPort}`, 10);

  if (Number.isNaN(parsedPort)) {
    throw new Error(`Invalid port value: ${rawPort}`);
  }

  return parsedPort;
}

function parseMaxAttempts(value: unknown): number {
  if (value === undefined || value === null) {
    return 3;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(
      "`maxAttempts` must be a positive integer when provided.",
      400,
    );
  }

  return value;
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new HttpError("Request body must be valid JSON.", 400);
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function getRequestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? `127.0.0.1:${apiPort}`;
  return new URL(request.url ?? "/", `http://${host}`);
}

type FixJobWithAttempts = Prisma.FixJobGetPayload<{
  include: {
    attempts: true;
  };
}>;

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serializeFixJob(fixJob: FixJobWithAttempts): GetFixJobResponse["job"] {
  return {
    id: fixJob.id,
    repoPath: fixJob.repoPath,
    bugDescription: fixJob.bugDescription,
    stackTrace: fixJob.stackTrace,
    status: fixJob.status,
    maxAttempts: fixJob.maxAttempts,
    currentAttempt: fixJob.currentAttempt,
    failureReason: fixJob.failureReason,
    startedAt: toIsoString(fixJob.startedAt),
    completedAt: toIsoString(fixJob.completedAt),
    createdAt: fixJob.createdAt.toISOString(),
    updatedAt: fixJob.updatedAt.toISOString(),
    attempts: fixJob.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      workspacePath: attempt.workspacePath,
      buildPassed: attempt.buildPassed,
      testsPassed: attempt.testsPassed,
      bugResolved: attempt.bugResolved,
      errorMessage: attempt.errorMessage,
      createdAt: attempt.createdAt.toISOString(),
      updatedAt: attempt.updatedAt.toISOString(),
      completedAt: toIsoString(attempt.completedAt),
    })),
  };
}

async function handleCreateFixJob(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);

  const repoPath = body.repoPath;
  const bugDescription = body.bugDescription;
  const stackTrace = body.stackTrace;
  const maxAttempts = parseMaxAttempts(body.maxAttempts);

  if (typeof repoPath !== "string" || repoPath.trim().length === 0) {
    throw new HttpError("`repoPath` must be a non-empty string.", 400);
  }

  if (
    typeof bugDescription !== "string" ||
    bugDescription.trim().length === 0
  ) {
    throw new HttpError("`bugDescription` must be a non-empty string.", 400);
  }

  if (
    stackTrace !== undefined &&
    stackTrace !== null &&
    typeof stackTrace !== "string"
  ) {
    throw new HttpError("`stackTrace` must be a string when provided.", 400);
  }

  const input: CreateFixJobInput = {
    repoPath: repoPath.trim(),
    bugDescription: bugDescription.trim(),
    stackTrace:
      typeof stackTrace === "string" && stackTrace.trim().length > 0
        ? stackTrace.trim()
        : null,
    maxAttempts,
  };

  const fixJob = await prisma.fixJob.create({
    data: {
      repoPath: input.repoPath,
      bugDescription: input.bugDescription,
      stackTrace: input.stackTrace ?? null,
      maxAttempts,
      currentAttempt: 0,
      status: "queued",
    },
  });

  await fixQueue.add("fix", {
    jobId: fixJob.id,
    repoPath: fixJob.repoPath,
    bugDescription: fixJob.bugDescription,
    stackTrace: fixJob.stackTrace,
    maxAttempts: fixJob.maxAttempts,
  });

  const payload: CreateFixJobResponse = {
    jobId: fixJob.id,
    status: fixJob.status,
  };

  sendJson(response, 202, payload);
}

async function handleGetFixJob(
  jobId: string,
  response: ServerResponse,
): Promise<void> {
  if (!jobId) {
    throw new HttpError("A job id is required.", 400);
  }

  const fixJob = await prisma.fixJob.findUnique({
    where: { id: jobId },
    include: {
      attempts: {
        orderBy: {
          attemptNumber: "asc",
        },
      },
    },
  });

  if (!fixJob) {
    throw new HttpError("Fix job not found.", 404);
  }

  const payload: GetFixJobResponse = {
    job: serializeFixJob(fixJob),
  };

  sendJson(response, 200, payload);
}

const server = createServer(async (request, response) => {
  const url = getRequestUrl(request);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fix") {
      await handleCreateFixJob(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
      const jobId = url.pathname.slice("/jobs/".length);
      await handleGetFixJob(jobId, response);
      return;
    }

    sendJson(response, 404, { error: "Route not found." });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message =
      error instanceof HttpError ? error.message : "Internal server error.";

    if (!(error instanceof HttpError)) {
      console.error("API request failed:", error);
    }

    sendJson(response, statusCode, { error: message });
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Shutting down API server after ${signal}...`);
  await prisma.$disconnect();
  await fixQueue.close();
  server.close(() => process.exit(0));
}

server.listen(apiPort, () => {
  console.log(`API server listening on http://127.0.0.1:${apiPort}`);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
