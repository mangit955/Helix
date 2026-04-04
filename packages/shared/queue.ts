import { Queue } from "bullmq";

export const fixQueue = new Queue("fix-queue", {
  connection: {
    host: "127.0.0.1",
    port: 6379,
  },
});
