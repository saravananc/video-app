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
| Redis | `REDIS_URL` | Rate limiting + caching. The in-memory limiter is single-node only. |
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

## Render workers (FAV-807)

Renders are CPU-heavy and must not share compute with the web tier in
production. Two options, both isolated + autoscaling:

1. **Remotion Lambda** — serverless renders; wire `@fav/render` to
   `@remotion/lambda` (`renderMediaOnLambda`) behind the same `RenderFn`
   interface used by `defaultDeps`.
2. **Container pool** — a worker image running `@fav/workflows` job consumers,
   scaled on queue depth (e.g. Fly machines / ECS + queue length metric),
   concurrency capped per worker (`SCENE_GENERATION_CONCURRENCY`).

In both cases, replace the in-process runner (`apps/web/src/lib/runner.ts`)
with your queue of choice (Inngest is the backlog's pick — the workflow
functions are already step-shaped and idempotent) and point the autopilot
scheduler (`/api/autopilot/sweep`) at a cron.

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
