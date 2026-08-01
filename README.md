# FAV — Faceless AI Video SaaS

Type a topic, get a finished video: scene-by-scene script → per-scene visuals → voiceover →
word-synced captions → rendered MP4, with org multi-tenancy, an append-only credit ledger,
Stripe billing, social publishing, and autopilot scheduling.

Built from the backlog in [`backlog/jira-backlog.md`](backlog/jira-backlog.md) (17 epics, 98 stories).

## Quick start

```bash
pnpm install
pnpm build          # builds packages + web app
pnpm --filter @fav/web dev   # http://localhost:3000
```

No environment variables are required in development: the database is embedded
(PGlite), storage is the local filesystem, and every external provider (LLM,
image generation, TTS, transcription, Stripe, Mux, YouTube…) runs as a
deterministic mock. Migrations and the demo-org seed run automatically at
server startup. Add real keys per `.env.example` to activate real adapters —
no code changes needed.

## Workspace layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js app — UI, API routes, workflow endpoint |
| `apps/render` | Remotion project: composition + render entry |
| `packages/core` | Shared domain: zod schemas, credit cost table, pacing model |
| `packages/db` | Drizzle schema, migrations, seed, credit ledger |
| `packages/providers` | Interface + real adapter + mock per external service |
| `packages/workflows` | Durable generation pipeline + schedulers |
| `packages/config` | Shared tsconfig / eslint |
| `backlog/` | The product backlog this app is built from |
| `docs/` | Schema doc, deployment guide |

## Commands

```bash
pnpm build | lint | typecheck | test   # repo-wide via turbo
pnpm db:generate                        # drizzle-kit: emit SQL migration from schema
pnpm db:migrate                         # apply migrations
pnpm db:seed                            # migrate + seed demo org (idempotent)
```

## Architecture notes

- **Credits** are an append-only ledger (`credit_ledger`); balances are derived
  sums, reservations are race-safe, and every job's reserve → finalize/refund
  lifecycle is idempotent.
- **The pipeline** is one durable workflow with idempotent steps keyed on
  `videoId:step`; a failed run refunds automatically.
- **Providers** are selected purely by environment variables — see `.env.example`.
- **Database** is Postgres-dialect everywhere: embedded PGlite in dev, managed
  Postgres (e.g. Neon) in production via `DATABASE_URL`.

See [`docs/schema.md`](docs/schema.md) for the ER diagram.
