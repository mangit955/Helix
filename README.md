# Helix

Helix is an autonomous bug-fixing system. Phase 0 sets up the foundation that later phases will build on:

- a durable job record in PostgreSQL
- a Redis-backed queue with BullMQ
- an API that creates fix jobs
- a worker that picks up jobs and updates their status
- shared types and queue contracts inside the monorepo

## Phase 0 Status

Phase 0 is complete when the repo can do all of the following:

1. accept a fix job through the API
2. persist that job in PostgreSQL
3. enqueue the job in Redis
4. let the worker consume the job
5. update the job status from `queued` to `processing` to `completed`
6. build, lint, and typecheck the new packages through Turbo

This repository now supports that flow.

## Monorepo Layout

```txt
apps/
  api/               HTTP API for creating and querying fix jobs
  dashboard/         Next.js dashboard app
  docs/              Docs app
packages/
  shared/            Shared queue config and shared types
  ui/                Shared UI components
workers/
  agent-worker/      BullMQ worker that processes fix jobs
prisma/
  schema.prisma      Database schema
```

## Prerequisites

- Node.js 18+
- pnpm 10+
- PostgreSQL
- Redis
- Docker Desktop or Docker Engine if you want one-command local infrastructure

## Environment Setup

Copy `.env.example` to `.env` and update the values for your machine:

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

## Run Phase 0

Start the API:

```bash
pnpm --filter api dev
```

Start the worker in a second terminal:

```bash
pnpm --filter agent-worker dev
```

If you want to run both backend processes together in separate terminals, the usual beginner flow is:

1. `pnpm infra:up`
2. `cp .env.example .env`
3. `pnpm install`
4. `pnpm exec prisma migrate dev`
5. `pnpm --filter api dev`
6. `pnpm --filter agent-worker dev`

Create a fix job:

```bash
curl -X POST http://127.0.0.1:4000/fix \
  -H "Content-Type: application/json" \
  -d '{"repoPath":"./demo-repo","error":"TypeError: x is undefined"}'
```

Check job status:

```bash
curl http://127.0.0.1:4000/jobs/<job-id>
```

Health check:

```bash
curl http://127.0.0.1:4000/health
```

## Validation Commands

Use these commands to verify the workspace:

```bash
pnpm lint
pnpm check-types
pnpm build
pnpm exec prisma validate
```

## What Phase 0 Does Not Do Yet

Phase 0 intentionally stops before the agent loop. It does not yet:

- analyze repositories
- generate code fixes
- run tests or builds against target repos
- retry failed fixes
- store learning or memory

Those arrive in the next phases on top of this foundation.
