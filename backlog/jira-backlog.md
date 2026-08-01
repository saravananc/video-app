# Faceless AI Video SaaS - Jira Backlog

A complete, sprint-ready backlog for building the platform described in the architecture plan. Organized into 17 epics mapped to the four delivery phases. Import the companion CSV (`jira-backlog.csv`) directly into Jira, or use this document as the readable master.

## Legend

**Story points** use a Fibonacci scale (1, 2, 3, 5, 8, 13) reflecting relative effort/uncertainty. **Priority** is Highest / High / Medium / Low. **Phase** doubles as the sprint grouping and maps to the roadmap: Phase 0 (pipeline spike), Phase 1 (MVP), Phase 2 (product), Phase 3 (scale). Keys use the `FAV-` prefix; epics are `FAV-E#`.

## Epic summary

| Epic | Name | Stories | Points |
|---|---|---|---|
| FAV-E1 | Foundation & Infrastructure | 7 | 20 |
| FAV-E2 | Authentication & Multi-tenancy | 5 | 16 |
| FAV-E3 | Data Layer & Schema | 5 | 18 |
| FAV-E4 | Pipeline: Script Generation | 5 | 16 |
| FAV-E5 | Pipeline: Visual Generation | 6 | 27 |
| FAV-E6 | Pipeline: Voiceover | 5 | 17 |
| FAV-E7 | Pipeline: Captions | 3 | 8 |
| FAV-E8 | Render & Assembly | 8 | 33 |
| FAV-E9 | Job Orchestration | 7 | 34 |
| FAV-E10 | Storage & Delivery | 4 | 10 |
| FAV-E11 | Editor UI / Web App | 7 | 24 |
| FAV-E12 | Credits & Billing | 8 | 29 |
| FAV-E13 | Publishing Integrations | 6 | 27 |
| FAV-E14 | Autopilot | 5 | 21 |
| FAV-E15 | Public API & MCP | 5 | 19 |
| FAV-E16 | Observability, Security & Compliance | 8 | 23 |
| FAV-E17 | Admin & Support Tooling | 4 | 13 |
| | **Total** | **98** | **355** |

## Phase rollup

| Phase | Stories | Points |
|---|---|---|
| Phase 0 - Spike | 11 | 42 |
| Phase 1 - MVP | 37 | 133 |
| Phase 2 - Product | 32 | 107 |
| Phase 3 - Scale | 18 | 73 |

## FAV-E1 - Foundation & Infrastructure

_Stand up the repo, environments, core cloud resources and CI so every other epic has ground to build on._

### FAV-101 - Set up TypeScript monorepo
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** infra, setup

Create a Turborepo monorepo with shared tsconfig, eslint, prettier, and packages for web, workers, and shared types.

**Acceptance criteria:**
- Monorepo builds with a single command
- Shared config consumed by all packages
- Type-checking passes repo-wide

### FAV-102 - CI/CD pipeline
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** infra, ci

GitHub Actions running lint, typecheck, unit tests, and deploy to staging on merge to main.

**Acceptance criteria:**
- PRs blocked on failing lint/type/test
- Auto-deploy to staging on merge
- Deploy status reported to PR

**Depends on:** FAV-101

### FAV-103 - Environment & secrets management
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** infra, security

Define dev/staging/prod environments with a secrets store (e.g. Doppler/1Password/Vercel envs).

**Acceptance criteria:**
- Three isolated environments
- No secrets in source control
- Local .env.example documented

**Depends on:** FAV-101

### FAV-104 - Provision Postgres & Redis
**Type:** Task | **Points:** 2 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** infra, data

Provision managed Postgres (Neon) and Redis for queues, rate limiting, and caching.

**Acceptance criteria:**
- Postgres reachable from app + workers
- Redis reachable
- Connection pooling configured

**Depends on:** FAV-103

### FAV-105 - Provision R2 storage + lifecycle
**Type:** Task | **Points:** 2 | **Priority:** High | **Phase 1 - MVP** | **Labels:** infra, storage

Create Cloudflare R2 buckets for raw assets and final renders with lifecycle rules to expire intermediates.

**Acceptance criteria:**
- Buckets created with least-priv keys
- Lifecycle expiry on intermediate assets
- Signed-URL access verified

**Depends on:** FAV-103

### FAV-106 - Base web app scaffold
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** frontend, setup

Next.js App Router app with Tailwind and shadcn/ui, base layout, and design tokens.

**Acceptance criteria:**
- App boots locally and on staging
- Design system components available
- Dark/light theming baseline

**Depends on:** FAV-101

### FAV-107 - Error tracking & logging baseline
**Type:** Task | **Points:** 2 | **Priority:** High | **Phase 1 - MVP** | **Labels:** infra, observability

Wire Sentry and structured logging across web and workers.

**Acceptance criteria:**
- Uncaught errors reported to Sentry
- Structured JSON logs with request/job IDs
- Source maps uploaded

**Depends on:** FAV-106

## FAV-E2 - Authentication & Multi-tenancy

_User identity, organizations, roles, and protected access — the tenancy boundary all data hangs off._

### FAV-201 - Integrate Clerk auth
**Type:** Story | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** auth

As a user I can sign up and log in with email and social providers so I can access the app.

**Acceptance criteria:**
- Email + at least one social login
- Session persisted across reloads
- Sign-out clears session

**Depends on:** FAV-106

### FAV-202 - Organizations & memberships
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** auth, multitenancy

As a user I belong to an organization so my data, billing, and teammates are scoped to it.

**Acceptance criteria:**
- Org auto-created on first signup
- All tenant data keyed by org_id
- User can belong to multiple orgs

**Depends on:** FAV-201, FAV-302

### FAV-203 - Roles & permissions
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** auth

As an org owner I can assign owner/admin/member roles so access is controlled.

**Acceptance criteria:**
- Three roles enforced server-side
- Billing limited to owner/admin
- Role checks unit-tested

**Depends on:** FAV-202

### FAV-204 - Protected routes & middleware
**Type:** Task | **Points:** 2 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** auth, security

Session + org middleware guarding all app and API routes.

**Acceptance criteria:**
- Unauthed requests redirected/401
- Org context injected per request
- API keys handled separately

**Depends on:** FAV-201

### FAV-205 - Teammate invites
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** auth

As an admin I can invite teammates by email so we can collaborate in one org.

**Acceptance criteria:**
- Email invite with expiring link
- Invitee joins existing org
- Pending/accepted states tracked

**Depends on:** FAV-203

## FAV-E3 - Data Layer & Schema

_The relational schema, migrations, and the append-only credit ledger that is the billing source of truth._

### FAV-301 - Drizzle ORM & migrations
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** data

Set up Drizzle with a repeatable migration workflow and typed query layer.

**Acceptance criteria:**
- Migrations run in CI + all envs
- Rollback path documented
- Typed queries end-to-end

**Depends on:** FAV-104

### FAV-302 - Core schema
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** data

Model users, organizations, memberships, videos, scenes, and jobs.

**Acceptance criteria:**
- All core tables + relations migrated
- Indexes on hot lookups
- ER diagram in repo

**Depends on:** FAV-301

### FAV-303 - Append-only credit ledger
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** data, billing

As the platform I record every credit change as an immutable ledger row so balances are auditable.

**Acceptance criteria:**
- No mutable balance column
- Balance derived + cached
- Compensating entries for refunds

**Depends on:** FAV-302

### FAV-304 - Ancillary tables
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** data

Model voices, social_accounts, autopilot_rules, publish_jobs.

**Acceptance criteria:**
- Tables migrated with encryption flags on token cols
- FKs + indexes set
- Documented in schema doc

**Depends on:** FAV-302

### FAV-305 - Seed & fixtures
**Type:** Task | **Points:** 2 | **Priority:** Medium | **Phase 1 - MVP** | **Labels:** data, dx

Deterministic seed data and fixtures for local dev and tests.

**Acceptance criteria:**
- One command seeds a working org
- Fixtures used by integration tests
- Idempotent re-seeding

**Depends on:** FAV-302

## FAV-E4 - Pipeline: Script Generation

_Turn a topic into a validated, structured, scene-by-scene script — the first stage of the pipeline._

### FAV-401 - LLM provider client
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, llm

Provider-agnostic LLM client abstraction (Claude/GPT/Gemini) with retries.

**Acceptance criteria:**
- Swap providers via config
- Retries with jitter
- Token usage logged

### FAV-402 - Structured scene-script generation
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, llm

As a creator I enter a topic and get a scene-by-scene script (narration + visual prompt + on-screen text) as validated JSON.

**Acceptance criteria:**
- Output validated against JSON schema
- Malformed output rejected + retried
- Scene count maps to duration

**Depends on:** FAV-401

### FAV-403 - Duration/tone/style controls
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** pipeline

As a creator I set target length, tone, and style so scripts match my niche.

**Acceptance criteria:**
- Controls affect prompt + scene count
- ~150 wpm pacing model
- Presets available

**Depends on:** FAV-402

### FAV-404 - Script edit & regenerate
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** pipeline, frontend

As a creator I can edit narration or regenerate the whole script before rendering.

**Acceptance criteria:**
- Per-scene inline edit
- Regenerate whole or single scene
- Edits persist to DB

**Depends on:** FAV-402, FAV-1103

### FAV-405 - Input prompt moderation
**Type:** Task | **Points:** 2 | **Priority:** High | **Phase 2 - Product** | **Labels:** pipeline, safety

Moderate user topic/prompt input before generation to protect provider accounts.

**Acceptance criteria:**
- Prohibited prompts blocked pre-generation
- Moderation decisions logged
- Clear user-facing rejection

**Depends on:** FAV-401

## FAV-E5 - Pipeline: Visual Generation

_Per-scene image and text-to-video generation via a resilient model gateway, with quality tiers and re-roll._

### FAV-501 - Model gateway with fallback
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, visuals

Abstraction over fal.ai/Replicate for image + video models with a fallback provider and circuit breaker.

**Acceptance criteria:**
- Primary+fallback per model type
- Circuit breaker on repeated failure
- Cost per call recorded

**Depends on:** FAV-401

### FAV-502 - Image generation per scene
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, visuals

As the pipeline I generate one image per scene (FLUX tiers) from its visual prompt.

**Acceptance criteria:**
- Basic + premium image tiers
- Asset stored to R2 keyed by scene
- Failures retryable per scene

**Depends on:** FAV-501, FAV-105

### FAV-503 - Text-to-video generation
**Type:** Story | **Points:** 8 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** pipeline, visuals

As the pipeline I generate short video clips per scene (Kling/Runway/Luma) for the max tier.

**Acceptance criteria:**
- Per-second metering wired to credits
- Configurable clip length
- Graceful downgrade if unavailable

**Depends on:** FAV-501

### FAV-504 - Parallel scene generation
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** pipeline

Generate scene assets in parallel with a concurrency cap and backpressure.

**Acceptance criteria:**
- Configurable concurrency limit
- Partial-failure handling
- Progress emitted per scene

**Depends on:** FAV-502, FAV-905

### FAV-505 - Scene re-roll
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** pipeline, frontend

As a creator I can regenerate a single scene's visual without touching the rest.

**Acceptance criteria:**
- Single asset regenerated + replaced
- Correct incremental credit charge
- UI reflects new asset

**Depends on:** FAV-502, FAV-1103

### FAV-506 - Visual style presets
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** pipeline

As a creator I pick a visual style (cinematic, anime, 3D, etc.) applied across scenes.

**Acceptance criteria:**
- Style injected into every visual prompt
- Consistent look across scenes
- Preview thumbnails

**Depends on:** FAV-502

## FAV-E6 - Pipeline: Voiceover

_Narration synthesis via ElevenLabs, a browsable voice library, and voice cloning._

### FAV-601 - ElevenLabs integration
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, voice

Client for ElevenLabs TTS with model/voice selection and retries.

**Acceptance criteria:**
- Synthesize narration to audio
- Model + voice selectable
- Errors retryable

### FAV-602 - Voice library UI
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** pipeline, voice, frontend

As a creator I browse and select from 1000+ voices so my video sounds right.

**Acceptance criteria:**
- Searchable/filterable voice list
- In-browser preview sample
- Selection persists to video

**Depends on:** FAV-601, FAV-1102

### FAV-603 - Voice cloning
**Type:** Story | **Points:** 5 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** pipeline, voice

As a creator I clone my voice from a short sample so videos use my own voice.

**Acceptance criteria:**
- Upload/record sample
- Clone stored per org (encrypted)
- Clone usable like any voice

**Depends on:** FAV-601, FAV-304

### FAV-604 - Narration synthesis + timing
**Type:** Story | **Points:** 3 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, voice

As the pipeline I synthesize the full narration and capture exact audio duration.

**Acceptance criteria:**
- Audio stored to R2
- Precise duration recorded
- Handles long scripts via chunking

**Depends on:** FAV-601

### FAV-605 - Multi-language handling
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** pipeline, voice

As a creator I generate narration in multiple languages where the voice model supports it.

**Acceptance criteria:**
- Language selectable per video
- Model chosen by language support
- Accurate capability messaging

**Depends on:** FAV-604

## FAV-E7 - Pipeline: Captions

_Transcribe the real audio for word-level timing, and offer animated caption styles._

### FAV-701 - Whisper transcription
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** pipeline, captions

Transcribe the synthesized audio to get word-level timestamps (never trust script timing).

**Acceptance criteria:**
- Word-level timestamps produced
- Runs on final audio
- Failure retryable

**Depends on:** FAV-604

### FAV-702 - Caption timing model
**Type:** Task | **Points:** 2 | **Priority:** High | **Phase 0 - Spike** | **Labels:** pipeline, captions

Convert word timestamps into caption cues consumable by the renderer.

**Acceptance criteria:**
- Cues grouped into readable chunks
- Timing aligns with audio
- Serialized for render props

**Depends on:** FAV-701

### FAV-703 - Caption style presets
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** pipeline, captions, frontend

As a creator I pick a caption style (bold, karaoke, impact, etc.) so captions match the trend.

**Acceptance criteria:**
- Multiple named styles
- Applied at render time
- Preview in editor

**Depends on:** FAV-702, FAV-804

## FAV-E8 - Render & Assembly

_Composite scenes, motion, transitions, music, and captions into the final MP4 on autoscaling workers._

### FAV-801 - Remotion project & compositions
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** render

Set up Remotion with a parameterized composition taking scenes, audio, and caption cues as props.

**Acceptance criteria:**
- Deterministic local render
- Props fully drive output
- 1080p output verified

### FAV-802 - Scene rendering + Ken Burns
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 0 - Spike** | **Labels:** render

As the pipeline I render each scene image with subtle pan/zoom motion.

**Acceptance criteria:**
- Configurable motion per scene
- Motion respects aspect ratio
- No visible artifacts

**Depends on:** FAV-801

### FAV-803 - Scene transitions
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** render

As a creator my scenes blend with transitions so the video feels seamless.

**Acceptance criteria:**
- Multiple transition types
- Transition timing configurable
- Works with both images and clips

**Depends on:** FAV-801

### FAV-804 - Burned-in animated captions
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 0 - Spike** | **Labels:** render, captions

As the pipeline I burn word-synced animated captions into the video.

**Acceptance criteria:**
- Captions synced to word timestamps
- Legible over any background
- Style-driven appearance

**Depends on:** FAV-702, FAV-801

### FAV-805 - Background music mixing
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** render

As a creator I add royalty-free background music ducked under narration.

**Acceptance criteria:**
- Music library selectable
- Ducking under voice
- Loudness normalized

**Depends on:** FAV-801

### FAV-806 - Aspect ratio & resolution
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** render

As a creator I export vertical/horizontal at 1080p or 4K.

**Acceptance criteria:**
- Vertical + horizontal supported
- 1080p + 4K tiers
- Resolution metered to credits

**Depends on:** FAV-801

### FAV-807 - Render worker deploy + autoscale
**Type:** Task | **Points:** 8 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** render, infra

Deploy render workers (containers or Remotion Lambda) as an isolated autoscaling pool.

**Acceptance criteria:**
- Isolated from API/model workers
- Autoscales on queue depth
- Concurrency capped per worker

**Depends on:** FAV-801, FAV-902

### FAV-808 - Render failure handling
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** render, reliability

Timeouts, streamed logs, and clean failure semantics for renders.

**Acceptance criteria:**
- Hard timeout per render
- Logs captured to observability
- Terminal failure triggers refund

**Depends on:** FAV-807, FAV-904

## FAV-E9 - Job Orchestration

_The durable workflow engine that chains the whole pipeline with idempotency, retries, and credit safety._

### FAV-901 - Workflow engine setup
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** orchestration

Set up Inngest with the scaffolding for durable multi-step workflows.

**Acceptance criteria:**
- Workflows deploy + observable
- Local dev runner working
- Step results persisted

**Depends on:** FAV-104

### FAV-902 - End-to-end generation workflow
**Type:** Story | **Points:** 8 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** orchestration

As the platform I run one durable workflow that executes script->visuals->voice->captions->render->store.

**Acceptance criteria:**
- All stages chained as steps
- Resumes mid-workflow on retry
- Emits progress at each step

**Depends on:** FAV-901, FAV-402, FAV-502, FAV-604, FAV-701, FAV-801

### FAV-903 - Idempotency & retries
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** orchestration, reliability

Make every step idempotent (keyed on video+step) with retry-with-jitter.

**Acceptance criteria:**
- Retried step overwrites, never duplicates
- No double asset generation
- Retry policy tuned per provider

**Depends on:** FAV-902

### FAV-904 - Credit reserve / finalize / refund
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** orchestration, billing

As the platform I reserve credits at start, finalize on success, and refund on terminal failure.

**Acceptance criteria:**
- Pending reservation before work
- Charge finalized only on success
- Auto-refund on failure

**Depends on:** FAV-303, FAV-902

### FAV-905 - Progress tracking
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** orchestration

Persist granular progress to the job record for the UI.

**Acceptance criteria:**
- Stage-level progress written
- Percent/label available to UI
- Terminal states recorded

**Depends on:** FAV-902

### FAV-906 - Circuit breakers & fallbacks
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** orchestration, reliability

Wire provider circuit breakers and fallbacks into the workflow.

**Acceptance criteria:**
- Breaker opens on repeated failure
- Fallback provider engaged
- Health surfaced to ops

**Depends on:** FAV-501, FAV-903

### FAV-907 - Temporal migration spike
**Type:** Task | **Points:** 5 | **Priority:** Low | **Phase 3 - Scale** | **Labels:** orchestration, scale

Evaluate migrating from Inngest to Temporal for higher workflow volume.

**Acceptance criteria:**
- POC of core workflow on Temporal
- Cost/perf comparison documented
- Go/no-go recommendation

**Depends on:** FAV-902

## FAV-E10 - Storage & Delivery

_Move assets in and out of R2 and serve finished video via a streaming host._

### FAV-1001 - R2 asset helpers + signed URLs
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** storage

Upload/download helpers and short-lived signed URLs for assets.

**Acceptance criteria:**
- Typed put/get helpers
- Signed URLs expire
- Keying convention enforced

**Depends on:** FAV-105

### FAV-1002 - Mux integration
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** storage, delivery

As a creator I watch my finished video with adaptive streaming and thumbnails.

**Acceptance criteria:**
- Final MP4 ingested to Mux
- Adaptive playback + thumbnail
- Playback ID stored on video

**Depends on:** FAV-1001

### FAV-1003 - Asset lifecycle cleanup
**Type:** Task | **Points:** 2 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** storage

Expire intermediate scene assets after a video completes.

**Acceptance criteria:**
- Intermediates expired post-render
- Final + re-roll inputs retained
- Cleanup job scheduled

**Depends on:** FAV-1001

### FAV-1004 - Download final MP4
**Type:** Story | **Points:** 2 | **Priority:** High | **Phase 1 - MVP** | **Labels:** storage, frontend

As a creator I download the raw MP4 of my finished video.

**Acceptance criteria:**
- Signed download URL
- Correct filename/metadata
- Access scoped to owner org

**Depends on:** FAV-1001

## FAV-E11 - Editor UI / Web App

_The creator-facing surface: dashboard, generation wizard, scene editor, live progress, and playback._

### FAV-1101 - Dashboard / video list
**Type:** Story | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** frontend

As a creator I see all my videos and their statuses in one place.

**Acceptance criteria:**
- List with status + thumbnail
- Filter/sort
- Pagination

**Depends on:** FAV-302, FAV-106

### FAV-1102 - New video wizard
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** frontend

As a creator I create a video by choosing topic, tier, aspect, voice, and style.

**Acceptance criteria:**
- Guided multi-step form
- Credit cost estimate shown
- Submits + enqueues job

**Depends on:** FAV-902, FAV-1205

### FAV-1103 - Scene editor
**Type:** Story | **Points:** 5 | **Priority:** High | **Phase 2 - Product** | **Labels:** frontend

As a creator I review and tweak each scene (narration, prompt, re-roll) before rendering.

**Acceptance criteria:**
- Per-scene edit + re-roll
- Changes persist
- Reflects generation state

**Depends on:** FAV-404, FAV-505

### FAV-1104 - Real-time progress UI
**Type:** Story | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** frontend

As a creator I watch a real progress bar as my video generates.

**Acceptance criteria:**
- Live stage-level progress
- Poll or subscribe to job
- Error states surfaced clearly

**Depends on:** FAV-905

### FAV-1105 - Video player + download
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** frontend

As a creator I play the finished video in-app and download it.

**Acceptance criteria:**
- Mux player embedded
- Download button
- Share/copy link

**Depends on:** FAV-1002, FAV-1004

### FAV-1106 - Voice management UI
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** frontend

As a creator I manage voices (browse library, manage clones).

**Acceptance criteria:**
- Library browse + preview
- Manage clones
- Set default voice

**Depends on:** FAV-602, FAV-603

### FAV-1107 - Empty/loading/error UX
**Type:** Task | **Points:** 2 | **Priority:** Medium | **Phase 1 - MVP** | **Labels:** frontend, ux

Consistent empty states, skeletons, and error handling across the app.

**Acceptance criteria:**
- Skeletons on load
- Friendly empty states
- Recoverable error UI

**Depends on:** FAV-1101

## FAV-E12 - Credits & Billing

_Stripe subscriptions, non-expiring top-ups, monthly resets, and pre-flight balance enforcement._

### FAV-1201 - Stripe products & checkout
**Type:** Task | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** billing

Set up subscription tiers + top-up products and Stripe Checkout.

**Acceptance criteria:**
- Tier products created
- Checkout flow working
- Customer linked to org

**Depends on:** FAV-202

### FAV-1202 - Subscription webhooks -> ledger
**Type:** Story | **Points:** 5 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** billing

As the platform I credit accounts from Stripe webhooks reliably.

**Acceptance criteria:**
- Webhook signature verified
- Idempotent event handling
- Ledger entry per grant

**Depends on:** FAV-1201, FAV-303

### FAV-1203 - Credit top-ups
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** billing

As a creator I buy extra non-expiring credits.

**Acceptance criteria:**
- One-time purchase flow
- Credits never expire
- Ledger reflects purchase

**Depends on:** FAV-1202

### FAV-1204 - Monthly credit reset
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** billing

Reset subscription credit allotment on renewal via ledger entry.

**Acceptance criteria:**
- Reset on renewal event
- Top-up credits preserved
- Reset audited in ledger

**Depends on:** FAV-1202

### FAV-1205 - Pre-generation balance enforcement
**Type:** Story | **Points:** 3 | **Priority:** Highest | **Phase 1 - MVP** | **Labels:** billing

As the platform I block jobs a user can't afford before enqueuing.

**Acceptance criteria:**
- Balance checked before enqueue
- Clear insufficient-credit UX
- Race-safe check

**Depends on:** FAV-303, FAV-902

### FAV-1206 - Billing dashboard
**Type:** Story | **Points:** 5 | **Priority:** High | **Phase 2 - Product** | **Labels:** billing, frontend

As an owner I manage my plan, see usage, and view invoices.

**Acceptance criteria:**
- Plan upgrade/downgrade/cancel
- Usage + balance shown
- Invoice history

**Depends on:** FAV-1202

### FAV-1207 - Cost table / pricing config
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** billing

Central config mapping generation actions to credit costs.

**Acceptance criteria:**
- Per-action credit costs configurable
- Used by estimator + charging
- Margin over provider cost verified

**Depends on:** FAV-303

### FAV-1208 - Free tier + starter credits
**Type:** Story | **Points:** 2 | **Priority:** High | **Phase 1 - MVP** | **Labels:** billing, growth

As a new user I get starter credits with no card so I can try the product.

**Acceptance criteria:**
- Starter credits on signup
- No card required
- Starter credits non-expiring

**Depends on:** FAV-303

## FAV-E13 - Publishing Integrations

_OAuth and upload flows for YouTube, TikTok, and Instagram, with token refresh and publish tracking._

### FAV-1301 - YouTube OAuth + token storage
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** publishing, youtube

As a creator I connect my YouTube account so videos can be published there.

**Acceptance criteria:**
- OAuth consent flow
- Refresh token stored encrypted
- Disconnect flow

**Depends on:** FAV-304

### FAV-1302 - YouTube upload + metadata
**Type:** Story | **Points:** 5 | **Priority:** High | **Phase 2 - Product** | **Labels:** publishing, youtube

As a creator I publish a finished video to YouTube with title/description/tags/visibility.

**Acceptance criteria:**
- Resumable upload of final MP4
- Metadata + visibility set
- External video ID recorded

**Depends on:** FAV-1301, FAV-1004

### FAV-1303 - TikTok publishing
**Type:** Story | **Points:** 8 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** publishing, tiktok

As a creator I publish to TikTok via the Content Posting API.

**Acceptance criteria:**
- OAuth + app-review prep
- Upload respects content rules
- Post ID recorded

**Depends on:** FAV-304

### FAV-1304 - Instagram Reels publishing
**Type:** Story | **Points:** 5 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** publishing, instagram

As a creator I publish Reels via the Graph API (container->publish).

**Acceptance criteria:**
- Business/Creator account handling
- Two-step publish
- Post ID recorded

**Depends on:** FAV-304

### FAV-1305 - Token refresh & expiry
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** publishing, reliability

Proactively refresh platform OAuth tokens before expiry.

**Acceptance criteria:**
- Refresh before expiry
- Re-auth prompt on failure
- Refresh errors alerted

**Depends on:** FAV-1301

### FAV-1306 - Publish job tracking + retry
**Type:** Task | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** publishing

Track publish jobs with status and retry on transient failure.

**Acceptance criteria:**
- Publish jobs persisted
- Retry on transient errors
- Status visible in UI

**Depends on:** FAV-1302

## FAV-E14 - Autopilot

_Scheduled, hands-off generation and publishing per niche and cadence, with originality safeguards._

### FAV-1401 - Autopilot rule builder
**Type:** Story | **Points:** 5 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** autopilot

As a creator I set a niche, cadence, and platform so videos post automatically.

**Acceptance criteria:**
- Niche + cadence + platform config
- Next-run scheduling
- Enable/disable per rule

**Depends on:** FAV-304, FAV-1302

### FAV-1402 - Scheduler
**Type:** Task | **Points:** 5 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** autopilot, orchestration

Trigger autopilot runs on schedule via cron/scheduled workflows.

**Acceptance criteria:**
- Fires at next_run_at
- Advances schedule after run
- Missed-run handling

**Depends on:** FAV-1401, FAV-901

### FAV-1403 - Auto idea + full run
**Type:** Story | **Points:** 5 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** autopilot

As the platform I auto-generate an idea and run the full pipeline for each scheduled slot.

**Acceptance criteria:**
- Fresh idea per run
- Full pipeline + publish
- Failures alert the owner

**Depends on:** FAV-1402, FAV-902, FAV-1302

### FAV-1404 - Originality safeguards
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 3 - Scale** | **Labels:** autopilot, safety, compliance

As the platform I nudge autopilot output toward original/varied content to reduce platform-policy risk.

**Acceptance criteria:**
- Variation across runs
- Optional editorial review gate
- Policy-risk guidance surfaced

**Depends on:** FAV-1403

### FAV-1405 - Autopilot history & controls
**Type:** Story | **Points:** 3 | **Priority:** Low | **Phase 3 - Scale** | **Labels:** autopilot, frontend

As a creator I view autopilot run history and pause/resume rules.

**Acceptance criteria:**
- Run history with outcomes
- Pause/resume
- Per-run cost visible

**Depends on:** FAV-1403

## FAV-E15 - Public API & MCP

_Programmatic access to generation for developers, plus an MCP server for AI tools._

### FAV-1501 - API key management
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** api

As a developer I issue and revoke API keys scoped to my org.

**Acceptance criteria:**
- Issue/revoke keys
- Scopes enforced
- Keys metered to org credits

**Depends on:** FAV-202

### FAV-1502 - Generation REST endpoints
**Type:** Story | **Points:** 5 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** api

As a developer I POST /v1/videos/generate and poll GET /v1/videos/{id}.

**Acceptance criteria:**
- Async generate returns job id
- Status polling to completion
- Auth via API key

**Depends on:** FAV-1501, FAV-902

### FAV-1503 - API rate limiting + metering
**Type:** Task | **Points:** 3 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** api, billing

Rate-limit the API per org and meter usage against credits.

**Acceptance criteria:**
- Per-org rate limits
- Credit debit per call
- 429 with retry info

**Depends on:** FAV-1502, FAV-1604

### FAV-1504 - API documentation
**Type:** Task | **Points:** 3 | **Priority:** Low | **Phase 3 - Scale** | **Labels:** api, docs

Publish OpenAPI spec and developer docs.

**Acceptance criteria:**
- OpenAPI spec generated
- Docs site published
- Auth + examples included

**Depends on:** FAV-1502

### FAV-1505 - MCP server
**Type:** Story | **Points:** 5 | **Priority:** Low | **Phase 3 - Scale** | **Labels:** api, mcp

As a developer I drive video generation from AI tools (Claude/Cursor) via MCP.

**Acceptance criteria:**
- MCP server wraps REST API
- Auth via account or API key
- Published + documented

**Depends on:** FAV-1502

## FAV-E16 - Observability, Security & Compliance

_Keep the platform safe, legible, and compliant — tracing, moderation, encryption, retention, alerting._

### FAV-1601 - Pipeline tracing
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** observability

Trace jobs end-to-end with correlated IDs across web, workflow, and workers.

**Acceptance criteria:**
- Single trace per video job
- Cross-service correlation
- Searchable in tooling

**Depends on:** FAV-107, FAV-902

### FAV-1602 - Product analytics
**Type:** Task | **Points:** 2 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** observability, growth

Instrument key funnels with PostHog.

**Acceptance criteria:**
- Signup->first-video funnel
- Feature usage events
- Dashboards for activation/retention

**Depends on:** FAV-106

### FAV-1603 - Secret & token encryption at rest
**Type:** Task | **Points:** 3 | **Priority:** Highest | **Phase 2 - Product** | **Labels:** security

Encrypt OAuth tokens and voice-clone samples at rest.

**Acceptance criteria:**
- Envelope encryption for tokens
- Keys rotated
- No plaintext secrets in DB

**Depends on:** FAV-304

### FAV-1604 - Rate limiting
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** security

Rate-limit the generation endpoint and API per org.

**Acceptance criteria:**
- Generation endpoint limited
- Redis-backed limiter
- Clear limit responses

**Depends on:** FAV-104

### FAV-1605 - Content moderation pipeline
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 2 - Product** | **Labels:** safety, compliance

As the platform I moderate inputs and optionally outputs to stay policy-compliant.

**Acceptance criteria:**
- Input moderation enforced
- Output spot-check option
- Decisions logged/appealable

**Depends on:** FAV-405

### FAV-1606 - Data retention & deletion
**Type:** Story | **Points:** 3 | **Priority:** High | **Phase 3 - Scale** | **Labels:** compliance

As a user I can delete my data, and old data is retained per policy.

**Acceptance criteria:**
- User-initiated deletion
- Retention windows enforced
- Deletion cascades assets

**Depends on:** FAV-1001

### FAV-1607 - Provenance & AI disclosure
**Type:** Task | **Points:** 3 | **Priority:** Medium | **Phase 3 - Scale** | **Labels:** compliance

Support content provenance/watermarking and platform AI-disclosure metadata.

**Acceptance criteria:**
- Provenance metadata attached
- Optional watermark
- Disclosure flags on publish

**Depends on:** FAV-1302

### FAV-1608 - Ops alerting
**Type:** Task | **Points:** 3 | **Priority:** High | **Phase 1 - MVP** | **Labels:** observability, reliability

Alert on queue depth, provider health, and error spikes.

**Acceptance criteria:**
- Alerts on queue backlog
- Provider outage alerts
- Error-rate thresholds paged

**Depends on:** FAV-107, FAV-906

## FAV-E17 - Admin & Support Tooling

_Internal tools so the team can operate the platform: monitor jobs, adjust credits, and support users._

### FAV-1701 - Admin dashboard
**Type:** Story | **Points:** 3 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** admin

As an operator I view users, orgs, and credit balances.

**Acceptance criteria:**
- Search users/orgs
- View balances + ledger
- Access restricted to staff

**Depends on:** FAV-303

### FAV-1702 - Job monitoring + manual actions
**Type:** Story | **Points:** 5 | **Priority:** High | **Phase 2 - Product** | **Labels:** admin, support

As an operator I inspect stuck jobs and manually retry or refund.

**Acceptance criteria:**
- Job list with states + errors
- Manual retry action
- Manual refund writes ledger entry

**Depends on:** FAV-905, FAV-904

### FAV-1703 - Feature flags
**Type:** Task | **Points:** 2 | **Priority:** Medium | **Phase 2 - Product** | **Labels:** admin

Gate features/tiers behind flags for rollout.

**Acceptance criteria:**
- Flags per org/tier
- Runtime toggles
- Default-off for risky features

**Depends on:** FAV-106

### FAV-1704 - Audited support impersonation
**Type:** Story | **Points:** 3 | **Priority:** Low | **Phase 3 - Scale** | **Labels:** admin, support, security

As support I can view a user's account (impersonate) with full audit logging.

**Acceptance criteria:**
- Impersonation gated to support role
- Every action audited
- Time-boxed sessions

**Depends on:** FAV-203

## Suggested sprint sequencing

Run Phase 0 as a single de-risking spike sprint (prove the render pipeline end-to-end before anything else). Phase 1 is roughly 3-4 two-week sprints to a payable MVP: foundation and schema first, then auth and orchestration, then the wizard, progress UI, storage, and basic billing. Phase 2 layers in quality tiers, voices, caption styles, YouTube publishing, the billing dashboard, and hardening. Phase 3 is continuous: remaining platforms, autopilot, the public API and MCP server, admin tooling, and scale work. Pull the highest-priority, unblocked stories into each sprint and respect the `Depends on` links.

## Notes on estimates

Points are relative sizing, not hours - calibrate to your team's velocity after the first sprint. The render pipeline (FAV-8xx), the end-to-end workflow (FAV-902), and text-to-video (FAV-503) carry the most uncertainty and are intentionally sized larger. Publishing integrations (FAV-13xx) hide real cost in third-party review processes and OAuth edge cases - treat their estimates as optimistic until you've been through each platform's approval once.
