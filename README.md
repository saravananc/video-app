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
| `apps/web` | Next.js app — UI, API routes, public REST API |
| `apps/render` | Remotion project: composition + render entry |
| `apps/mcp` | MCP server wrapping the public API for AI tools |
| `packages/core` | Shared domain: zod schemas, credit cost table, pacing model |
| `packages/db` | Drizzle schema, migrations, seed, credit ledger |
| `packages/providers` | Interface + real adapter + mock per external service |
| `packages/workflows` | Generation pipeline, re-roll, publishing, autopilot |
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

## What's built

Creator flow: sign up (starter credits, no card) → wizard (topic, length, tone,
tier, format, style, captions, voice, transition, music) → live progress →
player + MP4 download → scene editor (edit narration/prompt, re-roll a single
visual, regenerate the script) → publish to YouTube/TikTok/Instagram.

Platform: org multi-tenancy with owner/admin/member roles, teammate invites,
Stripe subscriptions + never-expiring top-ups on an append-only credit ledger,
autopilot (niche + cadence → scheduled generate & publish, with originality
safeguards and an optional review gate), a public REST API with scoped keys
plus an MCP server, and staff admin tooling (job retry/refund, feature flags,
audited impersonation, ops health).

## Architecture notes

- **Credits** are an append-only ledger (`credit_ledger`); balances are derived
  sums, reservations are race-safe, and every job's reserve → finalize/refund
  lifecycle is idempotent. Video deletion soft-deletes and purges assets rather
  than dropping rows, so the audit trail survives.
- **The pipeline** is one workflow with idempotent steps keyed on domain state;
  a failed run refunds automatically, and after an edit only the invalidated
  artifacts regenerate (a re-render after a scene edit takes ~20s vs ~100s for
  a full generation).
- **Providers** are selected purely by environment variables — see `.env.example`.
- **Database** is Postgres-dialect everywhere: embedded PGlite in dev, managed
  Postgres (e.g. Neon) in production via `DATABASE_URL`.

## Public API

```bash
curl -X POST $APP/api/v1/videos/generate \
  -H "authorization: Bearer fav_live_..." -H "content-type: application/json" \
  -d '{"topic":"how lighthouses work","durationSeconds":30}'
# -> {"id":"vid_...","status":"queued","estimatedCredits":12}

curl $APP/api/v1/videos/vid_... -H "authorization: Bearer fav_live_..."
# -> {"status":"completed","downloadUrl":"https://..."}
```

Spec at `/api/v1/openapi.json`. Issue keys in the dashboard under **API**.
For AI tools, point an MCP client at `apps/mcp` with `FAV_API_URL` and
`FAV_API_KEY` set.

See [`docs/schema.md`](docs/schema.md) for the ER diagram and
[`docs/deployment.md`](docs/deployment.md) for production setup.
