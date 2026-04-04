export type FixJobStatus = "queued" | "processing" | "completed" | "failed";
export interface FixJob {
  id: string;
  repoPath: string;
  error: string;
  status: FixJobStatus;
  createdAt: Date;
}
