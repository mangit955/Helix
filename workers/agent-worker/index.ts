import { PrismaClient } from "@prisma/client/extension";
import { Worker } from "bullmq";

const prisma = new PrismaClient();
const worker = new Worker("fix-queue", async (job) => {
  const { jobId } = job.data;

  await prisma.FixJob.update({
    where: { id: jobId },
    data: { status: "processing" },
  });

  await new Promise((r) => setTimeout(r, 2000));

  await prisma.FixJob.update({
    where: { id: jobId },
    data: { status: "completed" },
  });

  return { success: true };
});
