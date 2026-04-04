-- CreateTable
CREATE TABLE "FixJob" (
    "id" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "error" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixJob_pkey" PRIMARY KEY ("id")
);
