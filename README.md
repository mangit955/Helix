# Helix

Helix is an autonomous bug-fixing system. Phase 1 turns the Phase 0 foundation into a real closed loop:

`bug input -> repo context -> patch plan -> file edits -> build/test verification -> verdict -> retry if needed`

The current MVP supports one local TypeScript/Node repository at a time.

## Phase 1 Status

Phase 1 is complete when the repo can do all of the following:

1. accept a fix request through the CLI or API
2. persist the job and attempts in PostgreSQL
3. enqueue work in Redis through BullMQ
4. let the worker run the agent loop
5. create isolated attempt workspaces under `/tmp/helix/<jobId>`
6. collect relevant repo files for context
7. ask a model for a structured patch plan
8. apply text edits to the attempt workspace
9. run `pnpm build` and `pnpm test`
10. mark the job `completed` or `failed` with stored attempt history

This repository now supports that flow.

## Monorepo Layout

```txt
apps/
  api/               HTTP API for creating and querying fix jobs
  cli/               Local CLI for submitting and polling fix jobs
  dashboard/         Next.js dashboard app
  docs/              Docs app
packages/
  agent/             Agent loop, prompt building, verification, orchestration
  executor/          Workspace cloning, file edits, command runner, repo scan
  shared/            Prisma client, queue config, shared contracts, env loading
  ui/                Shared UI components
workers/
  agent-worker/      BullMQ worker that executes fix jobs
prisma/
  schema.prisma      Database schema
```

## Prerequisites

- Node.js 22+ recommended
- pnpm 10+
- PostgreSQL
- Redis
- An OpenAI-compatible API key
- Docker Desktop or Docker Engine if you want one-command local infrastructure

## Environment Setup

Copy [`.env.example`](/Users/manasraghuwanshi/Developer/projects/helix/.env.example) to `.env`:

```bash
cp .env.example .env
```

Required variables:

- `POSTGRES_DB`: local PostgreSQL database name used by Docker Compose
- `POSTGRES_USER`: local PostgreSQL username used by Docker Compose
- `POSTGRES_PASSWORD`: local PostgreSQL password used by Docker Compose
- `DATABASE_URL`: PostgreSQL connection string used by Prisma
- `REDIS_HOST`: Redis hostname for BullMQ
- `REDIS_PORT`: Redis port for BullMQ
- `API_PORT`: port used by the API server
- `OPENAI_API_KEY`: model provider API key
- `OPENAI_MODEL`: model name, for example `gpt-5.4-mini`
- `OPENAI_BASE_URL`: model base URL, for example `https://api.openai.com/v1`

Notes:

- The runtime now auto-loads the repo root `.env` for the API, worker, and shared packages.
- You can use OpenAI directly or an OpenAI-compatible provider such as OpenRouter.

Example OpenRouter configuration:

```bash
OPENAI_API_KEY=your_openrouter_key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=openai/gpt-4o-mini
OPENAI_REASONING_EFFORT=medium
OPENAI_TIMEOUT_MS=120000
```

## Start Local Infrastructure

If you do not already have PostgreSQL and Redis running, start both with Docker:

```bash
pnpm infra:up
```

Stop them when you are done:

```bash
pnpm infra:down
```

## Install

```bash
pnpm install
```

The install step also runs `prisma generate`, so the Prisma client is ready before you start the API or worker.

## Database Setup

Create or update your database schema:

```bash
pnpm exec prisma migrate dev
```

If you only want to refresh the Prisma client:

```bash
pnpm prisma:generate
```

## Run Phase 1

Start the API in one terminal:

```bash
pnpm --filter api dev
```

Start the worker in a second terminal:

```bash
pnpm --filter agent-worker dev
```

Use the CLI in a third terminal:

```bash
pnpm --filter helix-cli dev -- fix \
  --repo ./demo-app \
  --bug "TypeError: Cannot read properties of undefined" \
  --stack "src/index.ts:2 TypeError: Cannot read properties of undefined"
```

Health check:

```bash
curl http://127.0.0.1:4000/health
```

Manual API submission:

```bash
curl -X POST http://127.0.0.1:4000/fix \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath":"/absolute/path/to/demo-app",
    "bugDescription":"TypeError: Cannot read properties of undefined",
    "stackTrace":"src/index.ts:2 TypeError: Cannot read properties of undefined",
    "maxAttempts":3
  }'
```

Check job status:

```bash
curl http://127.0.0.1:4000/jobs/<job-id>
```

## Expected Phase 1 Flow

When a job succeeds, Helix should:

1. store the job as `queued`
2. let the worker mark it `processing`
3. create `/tmp/helix/<jobId>/base`
4. create `/tmp/helix/<jobId>/attempt-1`
5. scan relevant files from the target repo
6. generate a strict JSON patch plan
7. apply text edits inside the attempt workspace
8. run `pnpm build`
9. run `pnpm test`
10. mark the attempt `succeeded` and the job `completed`

If a run fails, the attempt error is stored and the worker retries until `maxAttempts` is exhausted.

## Minimal Demo Repo

Your target repo should:

- be local on disk
- have a valid `package.json`
- support `pnpm build`
- support `pnpm test`
- be small enough that file retrieval stays manageable

Phase 1 is intentionally scoped to local TypeScript/Node repos only.

## Validation Commands

Use these commands to verify the workspace:

```bash
pnpm exec prisma validate
pnpm --filter @repo/shared exec tsc --noEmit
pnpm --filter @repo/executor exec tsc --noEmit
pnpm --filter @repo/agent exec tsc --noEmit
pnpm --filter api exec tsc --noEmit
pnpm --filter agent-worker exec tsc --noEmit
pnpm --filter helix-cli exec tsc --noEmit
```

## Current Limitations

Phase 1 intentionally keeps the system narrow. It does not yet:

- sandbox commands
- support non-Node repos
- use embeddings or retrieval memory
- separate evaluator logic into a dedicated package
- provide a production dashboard for traces
- support multi-agent execution

Those belong to the next phases.
