export const fixJobStatuses = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export type FixJobStatus = (typeof fixJobStatuses)[number];

export interface FixJobRecord {
  id: string;
  repoPath: string;
  error: string | null;
  status: FixJobStatus;
  createdAt: Date;
}
