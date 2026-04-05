import { Worker } from "bullmq";
import {
  FIX_QUEUE_NAME,
  redisConnection,
  type FixQueueJobData,
} from "@repo/shared/queue";
import { prisma } from "@repo/shared/prisma";

const worker = new Worker<FixQueueJobData>(
  FIX_QUEUE_NAME,
  async (job) => {
    const { jobId } = job.data;

    await prisma.fixJob.update({
      where: { id: jobId },
      data: { status: "processing" },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await prisma.fixJob.update({
        where: { id: jobId },
        data: { status: "completed" },
      });

      return { success: true };
    } catch (error) {
      await prisma.fixJob.update({
        where: { id: jobId },
        data: { status: "failed" },
      });

      throw error;
    }
  },
  { connection: redisConnection },
);

worker.on("ready", () => {
  console.log(`Worker is listening on queue "${FIX_QUEUE_NAME}".`);
});

worker.on("completed", (job) => {
  console.log(`Completed fix job ${job.data.jobId}.`);
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
