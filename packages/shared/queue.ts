import { Queue, type ConnectionOptions } from "bullmq";

export const FIX_QUEUE_NAME = "fix-queue";

export interface FixQueueJobData {
  jobId: string;
  repoPath: string;
  error: string | null;
}

function getRedisPort(): number {
  const rawPort = process.env.REDIS_PORT ?? "6379";
  const parsedPort = Number.parseInt(rawPort, 10);

  if (Number.isNaN(parsedPort)) {
    throw new Error(`Invalid REDIS_PORT value: ${rawPort}`);
  }

  return parsedPort;
}

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: getRedisPort(),
};

export const fixQueue = new Queue<FixQueueJobData>(FIX_QUEUE_NAME, {
  connection: redisConnection,
});
