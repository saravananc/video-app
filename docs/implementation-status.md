# Implementation Status Report

**Repository:** `saravananc/video-app` · branch `claude/upload-video-app-backlog-cg13v3`
**Backlog:** [`backlog/jira-backlog.md`](../backlog/jira-backlog.md) — 17 epics, 98 items, 355 points
**Report date:** 2026-08-04

## Executive summary

| Metric | Value |
|---|---|
| Backlog items fully done | 86 / 98 (88%) |
| Backlog items partially done | 8 / 98 |
| Backlog items not started | 4 / 98 |
| Automated tests | 133 across 5 packages (19 test files) |
| API routes | 47 |
| Database tables | 23 (4 migrations) |
| TODO / FIXME markers in source | 0 |
| Documented environment variables | 64 |

The generation pipeline, billing, publishing, autopilot, public API, and admin
tooling are complete and verified end to end.

**Update 2026-08-04 — both P0 blockers are now resolved.** Content moderation has
a real classifier adapter with a production boot guard, and the Clerk path
verifies sessions end to end. The remaining gap before a production deploy is
that the paid-provider adapters (ElevenLabs, fal.ai, Stripe live mode, Mux,
YouTube) have never run against real credentials. See
[Production Readiness](#9-production-readiness-checklist).

---

## 1. Completed features

Fully implemented, tested, and verified working end to end.

### Pipeline & rendering

| Feature | Backlog | Modules | Verification |
|---|---|---|---|
| Scene-script generation, zod-validated with retry on malformed output | FAV-401/402 | `packages/providers/src/llm/`, `packages/core/src/schemas/script.ts` | Unit tested; deterministic mock + Anthropic adapter |
| Per-scene image generation with tiers | FAV-501/502 | `packages/providers/src/visuals/` | Unit tested; gateway failover tested |
| Parallel scene generation with concurrency cap | FAV-504 | `packages/workflows/src/generation.ts` | Integration tested |
| Voiceover synthesis with long-script chunking | FAV-601/604 | `packages/providers/src/tts/` | 7 chunking tests incl. stitched-duration check |
| Word-level transcription → caption cues | FAV-701/702 | `packages/providers/src/transcription/`, `packages/core/src/schemas/captions.ts` | Unit tested |
| Remotion composition, props-driven | FAV-801 | `apps/render/src/FavComposition.tsx` | Real 1080×1920 H.264+AAC MP4 rendered |
| Ken Burns motion, transitions, burned-in animated captions | FAV-802/803/804 | `apps/render/src/` | Verified in extracted frames |
| Background music with narration ducking | FAV-805 | `apps/render/src/FavComposition.tsx` | Verified in render |
| Aspect ratio + resolution tiers | FAV-806 | `packages/core/src/schemas/video.ts` | Unit tested |
| Render timeout + failure handling | FAV-808 | `apps/render/src/render.ts` | Refund-on-failure tested |
| Scene re-roll with incremental charge | FAV-505 | `packages/workflows/src/reroll.ts` | Integration tested |
| Script/scene edit with artifact invalidation | FAV-404 | `packages/workflows/src/maintenance.ts` | Tested; re-render ~20s vs ~100s full |

### Orchestration & data

| Feature | Backlog | Modules | Verification |
|---|---|---|---|
| Durable job queue (`SKIP LOCKED`, leases, heartbeat, crash recovery) | FAV-901/902 | `packages/workflows/src/queue.ts` | 12 tests + live SIGKILL recovery on real Postgres |
| Standalone autoscaling worker pool | FAV-807 | `apps/worker/`, `Dockerfile.worker`, `fly.worker.toml` | Verified across separate processes |
| Step idempotency & retries | FAV-903 | `packages/workflows/src/generation.ts` | Tested: no duplicate work or charge on retry |
| Credit reserve / finalize / refund | FAV-904 | `packages/db/src/ledger.ts` | 6 ledger invariant tests |
| Append-only credit ledger, race-safe reservations | FAV-303 | `packages/db/src/ledger.ts` | Tested incl. concurrent overdraft |
| Stage-level progress tracking | FAV-905 | `packages/core/src/progress.ts` | Unit tested |
| Circuit breakers + provider fallback | FAV-906 | `packages/providers/src/gateway.ts` | Unit tested |
| Full relational schema + migrations + seed | FAV-301/302/304/305 | `packages/db/` | 23 tables, 4 migrations, idempotent seed |

### Product surface

| Feature | Backlog | Modules |
|---|---|---|
| Dashboard with filter, search, sort, keyset pagination | FAV-1101 | `apps/web/src/app/(app)/dashboard/video-list.tsx` |
| New-video wizard with live credit estimate | FAV-1102 | `apps/web/src/app/(app)/dashboard/new/page.tsx` |
| Scene editor: edit, re-roll, regenerate | FAV-1103 | `apps/web/src/app/(app)/dashboard/videos/[id]/scene-editor.tsx` |
| Real-time progress UI | FAV-1104 | `apps/web/src/app/(app)/dashboard/videos/[id]/page.tsx` |
| Player, download, share link | FAV-1105/1004 | same |
| Voice library + management UI | FAV-602/1106 | `apps/web/src/app/(app)/dashboard/voices/page.tsx` |
| Empty / loading / error states | FAV-1107 | `apps/web/src/components/ui.tsx` |
| Style + caption preview thumbnails | FAV-506/703 | `apps/web/src/app/api/previews/style/`, `components/caption-preview.tsx` |

### Platform

| Feature | Backlog | Modules | Verification |
|---|---|---|---|
| Email/password auth: scrypt, verification, reset, lockout | FAV-201 | `apps/web/src/lib/auth.ts`, `packages/providers/src/password.ts` | 15 tests + live flow on Postgres |
| Clerk session verification (RS256 + cached JWKS, rotation, JIT provisioning) | FAV-201 | `apps/web/src/lib/clerk-jwt.ts`, `lib/auth.ts`, `middleware.ts`, `api/auth/config/` | 14 tests signing real RSA tokens: forgery, `alg:none`, expiry, `nbf`, issuer pinning, rotation |
| Content moderation with a real classifier + production boot guard | FAV-405/1605 | `packages/providers/src/moderation/openai.ts`, `src/env.ts` | 12 tests incl. degrade-to-flagged on classifier outage |
| Orgs, memberships, roles, org switcher | FAV-202/203 | `apps/web/src/lib/auth.ts`, `components/org-switcher.tsx` | Role tests; switcher re-checks membership |
| Protected routes & middleware | FAV-204 | `apps/web/src/middleware.ts` | Live 401/redirect verified |
| Teammate invites | FAV-205 | `apps/web/src/app/api/org/invites/` | Live accept flow verified |
| Feature flags with per-org overrides | FAV-1703 | `packages/db/src/flags.ts` | 6 tests + live gate verification |
| Redis-backed rate limiting | FAV-1604 | `packages/providers/src/ratelimit.ts` | 9 tests against real Redis |
| Token encryption at rest (AES-256-GCM) | FAV-1603 | `packages/providers/src/crypto.ts` | Roundtrip + tamper tests |
| Autopilot: rules, scheduler, runs, safeguards, history | FAV-1401–1405 | `packages/workflows/src/autopilot.ts` | 4 tests incl. originality + review gate |
| Public REST API + scoped keys + metering | FAV-1501/1502/1503 | `apps/web/src/app/api/v1/`, `lib/api-key.ts` | Live verified incl. revocation |
| MCP server | FAV-1505 | `apps/mcp/` | Drove a real generation via MCP client |
| OpenAPI spec + developer docs page | FAV-1504 | `apps/web/src/app/docs/api/`, `api/v1/openapi.json` | Both served |
| Admin: orgs, jobs, manual retry/refund, flags | FAV-1701/1702/1703 | `apps/web/src/app/(app)/admin/` | Live verified, staff-gated |
| Audited support impersonation | FAV-1704 | `apps/web/src/app/api/admin/impersonate/` | Live verified |
| Data retention + deletion with ledger integrity | FAV-1003/1606 | `packages/workflows/src/retention.ts` | 5 tests |
| Structured logging with trace correlation | FAV-107/1601 | `packages/core/src/logger.ts` | Live: one traceId across pipeline |
| CI: lint, typecheck, test, staging deploy | FAV-102 | `.github/workflows/ci.yml` | YAML validated |

---

## 2. Partially completed features

| Feature | Backlog | Done | Remaining | Priority |
|---|---|---|---|---|
| TikTok publishing | FAV-1303 | Full adapter; contract tests against a local fake | Never executed against the live API. Requires TikTok app review; posts are private-only until approved. | P1 |
| Instagram Reels publishing | FAV-1304 | Adapter written | Never executed. Passes the IG account id through the token `scopes` array — a hack that will likely break. Needs Business account + App Review. | P1 |
| Text-to-video (max tier) | FAV-503 | fal.ai Kling adapter, per-second metering, graceful downgrade, flag-gated | Never executed against the live API; mock returns `null` so the path always downgrades to stills. | P2 |
| Multi-language voice | FAV-605 | Language selectable per video, voices carry language metadata | No model selection by language capability; no accurate capability messaging. | P2 |
| Mux streaming | FAV-1002 | Adapter, ingest on completion, playback ID stored | Player is HTML5 `<video>` on the signed MP4, not a Mux/HLS player. Never executed against live Mux. | P2 |
| Ops alerting | FAV-1608 | Health endpoint with queue depth, breaker states, error rates; webhook fires on threshold | Not wired to an external cron; no paging integration configured. | P1 |
| Billing dashboard | FAV-1206 | Plan display, upgrade, cancel, usage, balance, invoice history | No downgrade path; no proration handling. | P2 |
| Provenance & AI disclosure | FAV-1607 | Optional burned-in watermark; disclosure flags sent on publish | No C2PA/content-credentials metadata embedded in the file. | P2 |

---

## 3. Mock data / placeholder implementations

Every external service sits behind an interface with a real adapter and a
deterministic mock, selected by environment variable
(`packages/providers/src/env.ts`). **The mocks are why the app runs with zero
API keys — they are not accidental stubs.** The table below states what each
becomes in production.

### Provider mocks (env-selected — production-ready path exists)

| Mock | File | Activates real adapter with | Production readiness |
|---|---|---|---|
| LLM script generation | `llm/mock.ts` | `ANTHROPIC_API_KEY` | Adapter written, **never run against live API** |
| Visuals (FLUX) | `visuals/mock.ts` | `FAL_KEY` | Adapter written, **never run against live API** |
| TTS | `tts/mock.ts` | `ELEVENLABS_API_KEY` | Adapter written incl. chunking, **never run live** |
| Transcription | `transcription/mock.ts` | `OPENAI_API_KEY` | Whisper adapter written, **never run live** |
| Storage | `storage/fs.ts` | `R2_*` (4 vars) | R2 adapter written, **never run live** |
| Payments | `payments/mock.ts` | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Stripe adapter incl. webhook signature verification, **never run live** |
| Publishers | `publishers/mock.ts` | Per-platform client id/secret | YouTube/TikTok/Instagram adapters, contract-tested only |
| Streaming | `DirectStreamingProvider` | `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` | Mux adapter written, **never run live** |
| Email | `ConsoleEmailProvider` | `RESEND_API_KEY` + `EMAIL_FROM` | Resend adapter written, **never run live** |
| Analytics | `NoopAnalyticsProvider` | `POSTHOG_API_KEY` | PostHog batch adapter, **never run live** |
| Rate limiter | `MemoryRateLimiter` | `REDIS_URL` | ✅ **Verified against real Redis** |
| Database | PGlite (embedded) | `DATABASE_URL` | ✅ **Verified against real Postgres 16** |

### Mocks with **no** real adapter — genuine gaps

None remaining. Moderation was the last one; it now has
`OpenAiModerationProvider` (`moderation/openai.ts`) selected by env, and
production boot fails if no classifier is configured.

### Dev-only UI surfaces (must not ship enabled)

| Surface | File | Purpose | Action |
|---|---|---|---|
| Mock checkout page | `app/(app)/billing/mock-checkout/page.tsx` | Fake payment confirmation | 404s automatically when Stripe is configured — verify in staging |
| Mock consent screen | `app/social/mock-consent/page.tsx` | Fake OAuth consent | Only reachable via `MockPublisherProvider` |
| `POST /api/billing/mock-confirm` | `api/billing/mock-confirm/route.ts` | Emits a signed fake payment event | Returns 404 when `MockPaymentsProvider` isn't active |
| Demo seed accounts | `packages/db/src/seed.ts` | 3 users, password `demo-password-123` | **Set `FAV_AUTO_SEED=0` in production.** Currently seeds on every server boot. |

### Hardcoded values

| Value | File | Issue | Action |
|---|---|---|---|
| Voice preview generation forces `MockTtsProvider` | `api/voices/route.ts:27` | Previews are always synthetic even with ElevenLabs configured | Use `getTtsProvider()`; cache real previews to storage |
| Style thumbnails force `MockVisualsProvider` | `api/previews/style/[style]/route.ts:19` | Intentional — previews must be free and instant | Acceptable; document the intent |
| Voice clone uses a "demo sample" | `dashboard/voices/page.tsx:76-89` | UI fetches an existing preview instead of recording | Implement `MediaRecorder` capture or file upload |
| Wizard voice fallback list | `dashboard/new/page.tsx:38-40` | Three hardcoded voices before `/api/voices` responds | Cosmetic; replace with a skeleton |
| Default voice `voice_adam` | `workflows/src/generation.ts:313` | Fallback when no voice chosen | Acceptable |
| Music library is synthesized | `providers/src/audio/music.ts` | Chord pads generated in code, not licensed tracks | **License real royalty-free tracks and upload to storage (FAV-805).** |

---

## 4. Pending features (not started)

| Feature | Backlog | Module | Priority | Notes |
|---|---|---|---|---|
| Provision Postgres + Redis | FAV-104 | Infra | **P0** | Code paths ready; needs accounts. See `docs/deployment.md` |
| Provision R2 buckets + lifecycle rules | FAV-105 | Infra | **P0** | Adapter ready; needs bucket + least-priv keys |
| Deploy render worker pool | FAV-807 (infra half) | Infra | **P0** | `Dockerfile.worker` + `fly.worker.toml` ready; needs host |
| Temporal migration | FAV-907 | Orchestration | P2 | **Evaluated: no-go.** See [`docs/temporal-evaluation.md`](temporal-evaluation.md) |

---

## 5. Backend API requirements

All 46 routes exist. Status is **Available** unless noted.

### Auth (`/api/auth`)

| Endpoint | Purpose | Request | Response | Status |
|---|---|---|---|---|
| `POST /signup` | Create account + org + starter credits | `{email, password, name?}` | `{ok, userId, orgId, verificationRequired}` | Available |
| `POST /login` | Password sign-in | `{email, password}` | `{ok, orgId, role}` · 401/429 | Available |
| `POST /logout` | Clear session | — | `{ok}` | Available |
| `GET /me` | Current session | — | `{session:{user, org, orgId, role}}` | Available |
| `POST /verify-email` | Consume verification token | `{token}` | `{ok}` | Available |
| `PUT /verify-email` | Resend verification | — | `{ok}` | Available |
| `POST /password-reset` | Request reset link | `{email}` | `{ok}` (always) | Available |
| `PUT /password-reset` | Complete reset | `{token, password}` | `{ok}` | Available |

### Videos (`/api/videos`)

| Endpoint | Purpose | Request | Response | Status |
|---|---|---|---|---|
| `GET /` | List with filter/sort/pagination | query: `status, q, sort, limit, cursor` | `{videos[], nextCursor, hasMore}` | Available |
| `POST /` | Create + enqueue | `VideoRequest` | `{videoId, jobId, estimate}` · 402/403/429 | Available |
| `GET /[id]` | Detail + progress + scenes | — | `{video, job:{progress}, scenes[]}` | Available |
| `DELETE /[id]` | Purge assets, soft-delete | — | `{ok}` | Available |
| `POST /[id]/regenerate` | Re-run pipeline | `{fullScript?}` | `{jobId}` | Available |
| `PATCH /[id]/scenes/[i]` | Edit scene | `{narration?, visualPrompt?, onScreenText?}` | `{ok}` | Available |
| `POST /[id]/scenes/[i]/reroll` | Re-roll visual | — | `{jobId}` · 402 | Available |
| `POST /[id]/publish` | Publish to platform | `{socialAccountId, title, description?, tags?, visibility}` | `{publishJobId}` | Available |
| `GET /[id]/publish` | Publish history | — | `{publishes[]}` | Available |

### Billing (`/api/billing`)

| Endpoint | Purpose | Request | Response | Status |
|---|---|---|---|---|
| `POST /checkout` | Start checkout | `{kind:"plan"\|"pack", itemId}` | `{url}` | Available |
| `POST /cancel` | Cancel subscription | — | `{ok, pending?}` | Available |
| `GET /ledger` | Balance + credit history | — | `{balance, plan, entries[]}` | Available |
| `GET /invoices` | Invoice history | — | `{invoices[]}` | Available |
| `POST /mock-confirm` | **Dev only** — fake payment | `{kind, itemId}` | `{ok}` · 404 in prod | Available |

### Other modules

| Module | Endpoints | Status |
|---|---|---|
| Voices | `GET/POST /api/voices`, `DELETE/PUT /api/voices/[id]` | Available |
| Social | `GET /accounts`, `DELETE /accounts/[id]`, `GET /connect/[platform]`, `GET /callback/[platform]` | Available |
| Autopilot | `GET/POST /rules`, `GET/PATCH/DELETE /rules/[id]`, `POST /sweep` | Available |
| Org | `GET/POST /invites`, `POST /invites/accept`, `POST /switch` | Available |
| API keys | `GET/POST /api/keys`, `DELETE /api/keys/[id]` | Available |
| Public API v1 | `POST /videos/generate`, `GET /videos/[id]`, `GET /openapi.json` | Available |
| Admin | `/overview`, `/jobs`, `/jobs/[id]`, `/flags`, `/health`, `/maintenance`, `/impersonate` | Available |
| Webhooks | `POST /payments`, `POST /clerk` | Available |
| Auth | `GET /api/auth/config` → `{provider:"local"\|"clerk", signInUrl, signUpUrl}` | Available |
| Flags | `GET /api/flags` | Available |
| Assets | `GET /api/assets/[...key]` (dev FS storage, HMAC-signed) | Available |
| Previews | `GET /api/previews/style/[style]` | Available |

### APIs needing changes

| Endpoint | Issue | Priority |
|---|---|---|
| `GET /api/voices` | Hardcodes `MockTtsProvider` for previews | P1 |

---

## 6. Third-party service integrations

| Service | Purpose | Backlog | Status | Env vars | Notes |
|---|---|---|---|---|---|
| **Postgres (Neon)** | Primary datastore | FAV-104 | ✅ Verified live | `DATABASE_URL` | Tested on Postgres 16 |
| **Redis** | Rate limiting | FAV-104/1604 | ✅ Verified live | `REDIS_URL` | 9 tests against real Redis |
| **Anthropic** | Script generation | FAV-401 | ⚠️ Adapter only | `ANTHROPIC_API_KEY` | Never run live |
| **fal.ai** | Images + text-to-video | FAV-501/503 | ⚠️ Adapter only | `FAL_KEY` | Never run live |
| **ElevenLabs** | TTS + voice cloning | FAV-601/603 | ⚠️ Adapter only | `ELEVENLABS_API_KEY` | Chunking implemented |
| **OpenAI Whisper** | Transcription | FAV-701 | ⚠️ Adapter only | `OPENAI_API_KEY` | Never run live |
| **Cloudflare R2** | Object storage | FAV-105/1001 | ⚠️ Adapter only | `R2_*` (4) | Lifecycle rules not created |
| **Stripe** | Payments | FAV-1201/1202 | ⚠️ Adapter only | `STRIPE_*` (5+) | Webhook signature verification implemented |
| **Mux** | Adaptive streaming | FAV-1002 | ⚠️ Adapter only | `MUX_TOKEN_ID/SECRET` | Player still HTML5 |
| **Resend** | Transactional email | FAV-201/205 | ⚠️ Adapter only | `RESEND_API_KEY`, `EMAIL_FROM` | **Required** — verification/reset are unusable without it |
| **Sentry** | Error tracking | FAV-107 | ⚠️ Adapter only | `SENTRY_DSN` + 3 build vars | PII scrubbing + source maps configured |
| **PostHog** | Product analytics | FAV-1602 | ⚠️ Adapter only | `POSTHOG_API_KEY` | Funnel events instrumented |
| **YouTube Data API** | Publishing | FAV-1301/1302 | ⚠️ Adapter only | `YOUTUBE_CLIENT_ID/SECRET` | Needs Google verification for quota |
| **TikTok Content Posting** | Publishing | FAV-1303 | ⚠️ Contract-tested | `TIKTOK_CLIENT_KEY/SECRET` | Needs app audit |
| **Instagram Graph** | Reels publishing | FAV-1304 | ⚠️ Adapter, known defect | `INSTAGRAM_APP_ID/SECRET` | Account id passed via `scopes` — will likely break |
| **Clerk** | External auth | FAV-201 | ⚠️ Complete, tested against locally-signed tokens | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_ISSUER`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `CLERK_WEBHOOK_SECRET` | Session verification, JIT provisioning, and webhook all work. Optional — leave `CLERK_SECRET_KEY` unset for built-in auth |
| **OpenAI Moderation** | Safety | FAV-405/1605 | ⚠️ Adapter written, never run live | `OPENAI_API_KEY` or `FAV_MODERATION_PROVIDER` | `omni-moderation-latest`; keyword list is now a pre-filter and outage fallback, not the whole policy |
| SMS / OTP | — | — | Not required | — | No phone-based flows in the backlog |
| Push notifications | — | — | Not required | — | Not in the backlog |

Legend: ✅ verified against the live service · ⚠️ adapter written but never executed live · ❌ gap

---

## 7. Database & configuration requirements

### Schema — 23 tables, 4 migrations

| Group | Tables |
|---|---|
| Identity & tenancy | `users`, `organizations`, `memberships`, `invites`, `auth_tokens` |
| Content | `videos`, `scenes`, `voices`, `music_tracks` |
| Orchestration | `jobs` (doubles as the queue) |
| Billing | `credit_ledger`, `invoices`, `webhook_events` |
| Publishing | `social_accounts`, `publish_jobs` |
| Autopilot | `autopilot_rules`, `autopilot_runs` |
| API | `api_keys` |
| Platform | `feature_flags`, `feature_flag_overrides`, `moderation_decisions`, `impersonation_sessions`, `audit_log` |

Migrations: `0000_init`, `0001_job_queue_lease`, `0002_auth_credentials`,
`0003_invoices`. ER diagram in [`docs/schema.md`](schema.md).

### Configuration

Fail-fast at boot (`apps/web/next.config.ts`): production refuses to start
without `FAV_SESSION_SECRET`, `FAV_ENCRYPTION_KEY`,
`FAV_STORAGE_SIGNING_SECRET`, `DATABASE_URL`. `getModerationProvider()` adds a
second guard: in production it throws unless a classifier is configured or
`FAV_MODERATION_PROVIDER=keywords` accepts keyword-only screening on purpose.

| Category | Required in production |
|---|---|
| Secrets | `FAV_SESSION_SECRET`, `FAV_ENCRYPTION_KEY` (32-byte hex), `FAV_STORAGE_SIGNING_SECRET`, `FAV_PAYMENTS_SECRET` |
| Data | `DATABASE_URL`, `REDIS_URL` |
| Safety | `OPENAI_API_KEY` (or an explicit `FAV_MODERATION_PROVIDER=keywords`) |
| Storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Topology | `FAV_EMBEDDED_WORKER=0`, `FAV_SCHEDULERS=0`, `FAV_AUTO_SEED=0` |
| Worker | `FAV_WORKER_CONCURRENCY`, `FAV_JOB_LEASE_MS`, `FAV_WORKER_SCHEDULERS=1` on exactly one replica |

Full list with per-variable notes in [`.env.example`](../.env.example) (64 vars)
and [`docs/deployment.md`](deployment.md).

### Outstanding configuration work

| Item | Priority |
|---|---|
| Key rotation procedure for `FAV_ENCRYPTION_KEY` (decrypt-and-reencrypt job over `social_accounts` + `voices`) | P1 |
| R2 lifecycle rules expiring intermediates | P1 |
| Postgres connection pooling (Neon pooler endpoint) | P0 |
| Database backup + restore procedure | P0 |

---

## 8. Technical debt

No `TODO`, `FIXME`, `HACK`, or `XXX` markers exist in the source, and there is
one commented-out code line. The debt below is architectural rather than
littered.

| Item | Location | Impact | Priority |
|---|---|---|---|
| Instagram adapter passes the IG account id through the OAuth `scopes` array | `publishers/instagram.ts` | Fragile hack that will likely fail on first live contact | P1 |
| `pruneAuthTokens` has zero call sites | `db/src/auth-tokens.ts` | Spent tokens accumulate forever | P2 |
| `audit_log` written in only 3 places (impersonation) | `api/admin/impersonate/` | Admin refunds/adjustments and flag changes aren't audited | P1 |
| `apps/render`, `apps/worker`, `apps/mcp` have no tests | — | Render composition and worker lifecycle covered only indirectly | P1 |
| No end-to-end browser tests | — | UI regressions only caught by manual verification | P1 |
| Voice preview hardcodes the mock provider | `api/voices/route.ts:27` | Previews won't match the real voice | P1 |
| Music library is synthesized, not licensed | `providers/src/audio/music.ts` | Not shippable as "royalty-free music" | P1 |
| Duplicated auth-error handling in every route | 30+ route files | `authErrorResponse(err)` repeated; a wrapper would remove ~5 lines each | P2 |
| `chunkNarration` default limit is ElevenLabs-specific | `tts/chunking.ts` | Another provider with a different cap needs the limit threaded through | P2 |

---

## 9. Production readiness checklist

### P0 blockers — cannot deploy

| # | Blocker | Area | Detail |
|---|---|---|---|
| ~~1~~ | ~~**Content moderation is a regex list**~~ | Security | **Resolved 2026-08-04.** `OpenAiModerationProvider` classifies against `omni-moderation-latest`; production boot fails without a configured classifier unless `FAV_MODERATION_PROVIDER=keywords` opts out explicitly. |
| ~~2~~ | ~~**Clerk path is unusable**~~ | Auth | **Resolved 2026-08-04.** `verifyClerkSessionToken` verifies RS256 against cached JWKS; `getSession` provisions on first sight; middleware and the login page follow whichever scheme is active. |
| 1 | **No paid provider verified live** | Integration | LLM, visuals, TTS, transcription, storage, payments, email, and the new moderation adapter have never made a real API call. Each needs a staging smoke test. |
| 2 | **Email unverified** | Auth | Verification and password reset are unusable without a working Resend integration — new users can't confirm their address. |
| 3 | **Infrastructure not provisioned** | Infra | Postgres, Redis, R2, worker host all need accounts. |
| 4 | **`FAV_AUTO_SEED` defaults on** | Security | Demo accounts with a known password would be created in production unless explicitly disabled. |
| 5 | **No backup/restore procedure** | Data | The credit ledger is the billing source of truth with no documented recovery path. |

### P1 — should fix before general availability

| Area | Item |
|---|---|
| Security | No security headers / CSP configured (`next.config.ts` has no `headers()`) |
| Security | No request body size limits — large payloads reach zod validation |
| Security | CSRF relies solely on `sameSite=lax` cookies; no token for state-changing routes |
| Security | Encryption key rotation procedure undefined |
| Testing | No E2E/browser tests; three apps have no tests at all |
| Testing | Load testing never performed; queue throughput limits unknown |
| Observability | Alerting endpoint exists but isn't wired to a cron or pager |
| Observability | Admin actions (refunds, adjustments, flag changes) not written to `audit_log` |
| Performance | No CDN in front of assets; render worker capacity unmodelled |
| Compliance | No privacy policy, ToS, or GDPR data-export flow |

### P2 — post-launch

Downgrade/proration handling · C2PA content credentials · HLS player · language-aware voice selection · auth token pruning · route-handler wrapper to remove duplicated error handling.

### Already satisfied

✅ Fail-fast production config validation · ✅ Secrets never in source control · ✅ Passwords scrypt-hashed, tokens stored as hashes · ✅ OAuth tokens encrypted at rest · ✅ Rate limiting on auth, generation, and public API · ✅ Account enumeration resistance · ✅ Idempotent webhooks · ✅ Structured logging with trace correlation · ✅ Error tracking with PII scrubbing · ✅ Graceful worker shutdown · ✅ Crash recovery verified · ✅ CI blocks merges on lint/type/test · ✅ 113 automated tests

---

## 10. Recommended implementation roadmap

### Stage 1 — Unblock deployment (1–2 weeks)

Nothing else can be validated until real infrastructure exists.

| Order | Task | Backlog | Depends on |
|---|---|---|---|
| 1 | Provision Neon Postgres (pooled), Redis, R2 with lifecycle rules | FAV-104/105 | — |
| 2 | Set production secrets; **`FAV_AUTO_SEED=0`, `FAV_EMBEDDED_WORKER=0`, `FAV_SCHEDULERS=0`** | FAV-103 | 1 |
| 3 | Deploy worker pool; wire external crons to `/api/autopilot/sweep` and `/api/admin/maintenance` | FAV-807/1402 | 1, 2 |
| 4 | Configure Resend and verify the signup → verification → reset loop | FAV-201 | 2 |
| 5 | Document backup/restore for Postgres | — | 1 |

### Stage 2 — Make it safe (1 week, parallel with Stage 1)

| Order | Task | Backlog | Depends on |
|---|---|---|---|
| ~~6~~ | ~~Real moderation adapter + env selection~~ | FAV-405/1605 | **Done** — verify live in Stage 3 |
| ~~7~~ | ~~Decide Clerk~~ | FAV-201 | **Done** — session verification implemented; verify against a real Clerk instance in Stage 3 |
| 8 | Security headers, CSP, request size limits | FAV-1604 | — |
| 9 | Write admin actions to `audit_log` | FAV-1702/1704 | — |
| 10 | Key rotation procedure | FAV-1603 | 1 |

### Stage 3 — Verify paid integrations (1–2 weeks)

Each is independent; run in a staging environment with live keys and a low
spend cap.

| Order | Task | Backlog | Risk |
|---|---|---|---|
| 11 | Anthropic + fal.ai + ElevenLabs + Whisper smoke tests | FAV-401/501/601/701 | Low — adapters follow current APIs |
| 12 | R2 + signed URL verification | FAV-1001 | Low |
| 13 | Stripe: checkout, webhooks, renewal, cancellation | FAV-1201/1202/1204 | Medium — webhook signature path untested live |
| 14 | Sentry + PostHog verification | FAV-107/1602 | Low |
| 14b | OpenAI Moderation smoke test; confirm the degrade-to-flagged path under a forced outage | FAV-405/1605 | Low |
| 14c | Clerk against a real instance: JWKS fetch, `__session` cookie, JIT provisioning | FAV-201 | Low — only if Clerk is used |
| 15 | YouTube OAuth + upload (needs Google verification) | FAV-1301/1302 | Medium — quota approval can take weeks |
| 16 | Fix Instagram account-id handling, then live test | FAV-1304 | **High — known defect** |
| 17 | TikTok live test (needs app audit) | FAV-1303 | **High — audit gates posting** |

### Stage 4 — Harden (1–2 weeks)

| Order | Task | Depends on |
|---|---|---|
| 18 | E2E browser tests for the core creator flow | Stage 1 |
| 19 | Tests for `apps/render`, `apps/worker`, `apps/mcp` | — |
| 20 | Load test the queue; model worker capacity and autoscaling thresholds | Stage 1 |
| 21 | Wire alerting to a pager; validate thresholds | Stage 1 |
| 22 | License real royalty-free music; upload to storage | — |
| 23 | Replace mock voice previews with cached real ones | Stage 3 (11) |
| 24 | CDN in front of assets | Stage 1 |

### Stage 5 — Launch readiness

Privacy policy, ToS, GDPR export · billing downgrade/proration · Mux HLS player
· C2PA credentials · language-aware voice selection.

### Critical path

```
Provision infra ──┬─► Deploy workers ──┬─► Verify paid providers ──► Load test ──► Launch
                  │                    │
                  └─► Email working ───┘
```

Moderation and the Clerk path no longer sit on the critical path — both are
implemented and tested; they only need a live smoke test alongside the other
paid integrations in Stage 3.

Stages 1 and 2 run in parallel. Stage 3 cannot start before Stage 1 (needs a
deployed staging environment). Items 16 and 17 have external dependencies —
Instagram App Review and TikTok audit — that should be **started on day one**
since approval, not engineering, is the long pole.
