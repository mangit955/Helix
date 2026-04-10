export const fixJobStatuses = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;

export type FixJobStatus = (typeof fixJobStatuses)[number];

export const attemptStatuses = ["running", "succeeded", "failed"] as const;

export type AttemptStatus = (typeof attemptStatuses)[number];

export interface CreateFixJobInput {
  repoPath: string;
  bugDescription: string;
  stackTrace?: string | null;
  maxAttempts?: number;
}

export interface CreateFixJobResponse {
  jobId: string;
  status: FixJobStatus;
}

export interface FixQueueJobData {
  jobId: string;
  repoPath: string;
  bugDescription: string;
  stackTrace: string | null;
  maxAttempts: number;
}

export interface AttemptApiRecord {
  id: string;
  attemptNumber: number;
  status: AttemptStatus;
  workspacePath: string;
  buildPassed: boolean | null;
  testsPassed: boolean | null;
  bugResolved: boolean | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface FixJobApiRecord {
  id: string;
  repoPath: string;
  bugDescription: string;
  stackTrace: string | null;
  status: FixJobStatus;
  maxAttempts: number;
  currentAttempt: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: AttemptApiRecord[];
}

export interface GetFixJobResponse {
  job: FixJobApiRecord;
}

export interface TextEdit {
  path: string;
  search: string;
  replace: string;
}

export interface CommandExecution {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AgentPlan {
  rootCause: string;
  planSummary: string;
  patchSummary: string;
  edits: TextEdit[];
  commandsToRun: string[];
}

export interface AttemptVerification {
  success: boolean;
  buildPassed: boolean;
  testsPassed: boolean;
  bugResolved: boolean;
  logs: CommandExecution[];
  errors: string[];
}

export interface ContextFile {
  path: string;
  content: string;
}
