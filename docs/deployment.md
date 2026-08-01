# Deployment guide

The app runs fully keyless in development (embedded PGlite, filesystem storage,
mock providers). Production replaces each mock with a managed service purely
through environment variables — no code changes. This document covers the
infra-only backlog items (FAV-103/104/105, FAV-807, and platform app reviews).

## Environments (FAV-103)

Run three isolated environments — dev, staging, prod — each with its own
database, buckets, and secrets. Keep secrets in your platform's secret store
(Vercel envs, Doppler, 1Password); nothing sensitive lives in source control.
`.env.example` documents every variable.

## Core services

| Service | Variable(s) | Notes |
|---|---|---|
| Postgres (Neon) | `DATABASE_URL` | FAV-104. Enable connection pooling (Neon pooler endpoint). Migrations: `pnpm db:migrate` in CI/deploy. |
| Redis | `REDIS_URL` | **Required in production.** Rate limiting uses a sliding window over a Redis sorted set, evaluated atomically in Lua so the window is shared across the fleet. Without it the limiter falls back to in-memory: per-process, so limits multiply by instance count and reset on every deploy. A Redis outage fails *open* (requests allowed, error logged) so generation never goes down with it. |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | FAV-105. Create the bucket with least-privilege keys. Add a lifecycle rule expiring `videos/*/narration.*` after ~7 days (intermediates); final renders are kept. |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Maps to `users.auth_provider_id`; first login auto-provisions org + starter credits. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Create products for starter/pro/scale plans + three top-up packs; point the webhook at `/api/webhooks/payments` with events `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`. |
| Mux | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Optional adaptive streaming; without it the app serves the MP4 directly. |
| Sentry / PostHog | `SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` | Observability hooks. |
| Encryption | `FAV_ENCRYPTION_KEY` | 32-byte hex. Rotating: decrypt-and-reencrypt job over `social_accounts` + `voices`. **Required in production.** |
| Sessions/signing | `FAV_SESSION_SECRET`, `FAV_STORAGE_SIGNING_SECRET`, `FAV_PAYMENTS_SECRET` | Random 32+ byte strings. |

## Model providers

Set any of these to activate the real adapter (mock otherwise):

- LLM: `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` for Whisper transcription)
- Visuals: `FAL_KEY` (FLUX images, Kling text-to-video)
- Voice: `ELEVENLABS_API_KEY`

## Job queue and workers (FAV-901/807)

Jobs are queued in the `jobs` table. Enqueuing is just a row insert, so work
survives a web-tier restart; workers claim with `FOR UPDATE SKIP LOCKED` and
hold a time-boxed lease renewed by heartbeat. If a worker dies, its lease
lapses and another worker reclaims the job — pipeline steps are idempotent, so
the re-run resumes rather than repeating paid work.

**Production topology:** run `apps/worker` as its own autoscaling pool so
CPU-heavy renders never contend with request serving, and set
`FAV_EMBEDDED_WORKER=0` on the web tier so it only enqueues.

```bash
# web tier
FAV_EMBEDDED_WORKER=0 FAV_SCHEDULERS=0 node apps/web/server.js
# worker pool (scale on queue depth); exactly one replica sets FAV_WORKER_SCHEDULERS=1
DATABASE_URL=... FAV_WORKER_CONCURRENCY=2 node apps/worker/dist/main.js
```

| Variable | Purpose |
|---|---|
| `FAV_WORKER_CONCURRENCY` | Jobs in flight per worker (default 2). Renders are heavy — raise cautiously. |
| `FAV_WORKER_POLL_MS` | Idle poll interval (default 2000). |
| `FAV_JOB_LEASE_MS` | Lease duration (default 120000); heartbeat renews at a third of it. Must exceed your longest step. |
| `FAV_WORKER_SCHEDULERS` | `1` on exactly one replica to run autopilot + maintenance sweeps. |
| `FAV_EMBEDDED_WORKER` | `0` on the web tier in production. |

**The worker requires `DATABASE_URL`.** Without it the app uses embedded
PGlite, which is single-writer and cannot be shared between processes — the
worker would claim jobs the web tier never sees. It refuses to start in that
case; for single-process dev, leave the embedded worker enabled instead.

Autoscale on queue depth: `SELECT count(*) FROM jobs WHERE status = 'queued'`,
also exposed via `GET /api/admin/health`.

For renders specifically, `@fav/render` can be pointed at Remotion Lambda
(`renderMediaOnLambda`) behind the same `RenderFn` interface `defaultDeps`
uses, if you prefer serverless to a container pool.

## Publishing platform reviews

- **YouTube**: create a Google Cloud project, enable YouTube Data API v3, OAuth
  consent screen with the upload scope; verification required for production
  quota (FAV-1302).
- **TikTok**: register the app, request Content Posting API access; posts are
  private-only until the app passes TikTok's audit (FAV-1303).
- **Instagram**: Facebook app with `instagram_content_publish`, business
  verification, and App Review (FAV-1304).

Set the corresponding `*_CLIENT_ID`/`*_SECRET` vars once approved.

## Ops (FAV-1608)

`GET /api/admin/health` reports queue depth, breaker states, and failure rates;
set `ALERT_WEBHOOK_URL` (Slack/PagerDuty webhook) to receive alerts when
thresholds trip. Wire it to a 1-minute external cron.
