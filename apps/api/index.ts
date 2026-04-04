import express from "express";
import { fixQueue } from "../../packages/shared/queue";
import { PrismaClient } from "@prisma/client/extension";

const prisma = new PrismaClient();

const app = express();
app.use(express.json());

app.post("/fix", async (req, res) => {
  const { repoPath, error } = req.body;

  const dbjob = await prisma.fixJob.create({
    data: {
      repoPath,
      error,
      status: "queued",
    },
  });

  await fixQueue.add("fix", { id: dbjob.id, repoPath, error });

  res.json({ jobId: dbjob.id });
});
