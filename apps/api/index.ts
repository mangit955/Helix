import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fixQueue } from "@repo/shared/queue";
import { prisma } from "@repo/shared/prisma";

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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
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

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function getRequestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? `127.0.0.1:${apiPort}`;
  return new URL(request.url ?? "/", `http://${host}`);
}

async function handleCreateFixJob(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const repoPath = body.repoPath;
  const error = body.error;

  if (typeof repoPath !== "string" || repoPath.trim().length === 0) {
    throw new HttpError("`repoPath` must be a non-empty string.", 400);
  }

  if (error !== undefined && error !== null && typeof error !== "string") {
    throw new HttpError("`error` must be a string when provided.", 400);
  }

  const fixJob = await prisma.fixJob.create({
    data: {
      repoPath: repoPath.trim(),
      error: typeof error === "string" ? error : null,
      status: "queued",
    },
  });

  await fixQueue.add("fix", {
    jobId: fixJob.id,
    repoPath: fixJob.repoPath,
    error: fixJob.error,
  });

  sendJson(response, 202, {
    jobId: fixJob.id,
    status: fixJob.status,
  });
}

async function handleGetFixJob(jobId: string, response: ServerResponse): Promise<void> {
  if (!jobId) {
    throw new HttpError("A job id is required.", 400);
  }

  const fixJob = await prisma.fixJob.findUnique({
    where: { id: jobId },
  });

  if (!fixJob) {
    throw new HttpError("Fix job not found.", 404);
  }

  sendJson(response, 200, { job: fixJob });
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
    const message = error instanceof HttpError ? error.message : "Internal server error.";

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
