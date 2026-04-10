/*
  Warnings:

  - You are about to drop the column `error` on the `FixJob` table. All the data in the column will be lost.
  - The `status` column on the `FixJob` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `bugDescription` to the `FixJob` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `FixJob` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FixJobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "FixJob" DROP COLUMN "error",
ADD COLUMN     "bugDescription" TEXT NOT NULL,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "currentAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "stackTrace" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "FixJobStatus" NOT NULL DEFAULT 'queued';

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "fixJobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'running',
    "workspacePath" TEXT NOT NULL,
    "rootCause" TEXT,
    "planSummary" TEXT,
    "patchSummary" TEXT,
    "modelPrompt" TEXT,
    "modelResponse" TEXT,
    "filesChanged" JSONB,
    "buildPassed" BOOLEAN,
    "testsPassed" BOOLEAN,
    "bugResolved" BOOLEAN,
    "commandLogs" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_fixJobId_attemptNumber_key" ON "Attempt"("fixJobId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_fixJobId_fkey" FOREIGN KEY ("fixJobId") REFERENCES "FixJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
