import { Worker } from "bullmq";
import { runFixJob } from "@repo/agent/orchestrator";
import {
  FIX_QUEUE_NAME,
  redisConnection,
} from "@repo/shared/queue";
import { prisma } from "@repo/shared/prisma";
import type { FixQueueJobData } from "@repo/shared/types";
import { createModelClient } from "./model-client.js";

class TerminalJobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalJobFailure";
  }
}

const modelClient = createModelClient();

const worker = new Worker<FixQueueJobData>(
  FIX_QUEUE_NAME,
  async (job) => {
    const {
      jobId,
      repoPath,
      bugDescription,
      stackTrace,
      maxAttempts,
    } = job.data;

    await prisma.fixJob.update({
      where: { id: jobId },
      data: {
        status: "processing",
        startedAt: new Date(),
        completedAt: null,
        failureReason: null,
      },
    });

    try {
      const result = await runFixJob({
        jobId,
        repoPath,
        bugDescription,
        stackTrace,
        maxAttempts,
        modelClient,
      });

      if (result.success) {
        await prisma.fixJob.update({
          where: { id: jobId },
          data: {
            status: "completed",
            completedAt: new Date(),
            failureReason: null,
          },
        });

        return result;
      }

      await prisma.fixJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          completedAt: new Date(),
          failureReason: result.failureReason,
        },
      });

      throw new TerminalJobFailure(
        result.failureReason ?? "Fix job failed after exhausting all attempts.",
      );
    } catch (error) {
      if (error instanceof TerminalJobFailure) {
        throw error;
      }

      const failureReason =
        error instanceof Error ? error.message : "Unknown worker failure.";

      await prisma.fixJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          completedAt: new Date(),
          failureReason,
        },
      });

      throw error;
    }
  },
  { connection: redisConnection },
);

worker.on("ready", () => {
  console.log(`Worker is listening on queue "${FIX_QUEUE_NAME}".`);
});

worker.on("completed", (job, result) => {
  console.log(`Completed fix job ${job.data.jobId}.`, result);
});

worker.on("failed", (job, error) => {
  console.error(`Fix job ${job?.data.jobId ?? "unknown"} failed.`, error);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Shutting down worker after ${signal}...`);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
