import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member"]);
export const planTier = pgEnum("plan_tier", ["free", "starter", "pro", "scale"]);
export const videoStatus = pgEnum("video_status", [
  "draft",
  "queued",
  "generating",
  "rendering",
  "completed",
  "failed",
  "canceled"
]);
export const sceneStatus = pgEnum("scene_status", ["pending", "generating", "completed", "failed"]);
export const jobKind = pgEnum("job_kind", ["generation", "reroll", "publish", "cleanup", "autopilot"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed", "canceled"]);
export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "grant",
  "purchase",
  "reservation",
  "reservation_release",
  "refund",
  "adjustment",
  "reset"
]);
export const socialPlatform = pgEnum("social_platform", ["youtube", "tiktok", "instagram"]);
export const socialAccountStatus = pgEnum("social_account_status", [
  "connected",
  "expired",
  "revoked",
  "error"
]);
export const publishStatus = pgEnum("publish_status", [
  "pending",
  "uploading",
  "published",
  "failed",
  "retrying"
]);
export const inviteStatus = pgEnum("invite_status", ["pending", "accepted", "expired", "revoked"]);
export const voiceStatus = pgEnum("voice_status", ["ready", "processing", "failed"]);
export const moderationVerdict = pgEnum("moderation_verdict", ["allowed", "blocked", "flagged"]);
export const autopilotRunStatus = pgEnum("autopilot_run_status", [
  "running",
  "awaiting_review",
  "completed",
  "failed",
  "skipped"
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity & tenancy (FAV-302, FAV-202)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** External auth provider subject (Clerk user id, or "local:<id>" for the dev fallback). */
    authProviderId: text("auth_provider_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    isStaff: boolean("is_staff").notNull().default(false),
    defaultVoiceId: text("default_voice_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex("users_auth_provider_idx").on(t.authProviderId), uniqueIndex("users_email_idx").on(t.email)]
);

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    plan: planTier("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /**
     * Cached balance for fast reads; the append-only credit_ledger is the source of
     * truth and this value is recomputed from it (FAV-303: derived + cached).
     */
    cachedBalance: integer("cached_balance").notNull().default(0),
    balanceUpdatedAt: timestamp("balance_updated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug), index("organizations_stripe_idx").on(t.stripeCustomerId)]
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.orgId, t.userId),
    index("memberships_user_idx").on(t.userId)
  ]
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: membershipRole("role").notNull().default("member"),
    token: text("token").notNull(),
    status: inviteStatus("status").notNull().default("pending"),
    invitedByUserId: text("invited_by_user_id").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("invites_token_idx").on(t.token), index("invites_org_idx").on(t.orgId)]
);

// ---------------------------------------------------------------------------
// Videos, scenes, jobs (FAV-302)
// ---------------------------------------------------------------------------

export const videos = pgTable(
  "videos",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    title: text("title").notNull().default("Untitled"),
    topic: text("topic").notNull(),
    status: videoStatus("status").notNull().default("draft"),
    /** The full VideoRequest the wizard submitted (zod-validated at the boundary). */
    request: jsonb("request").notNull(),
    /** Validated VideoScript once scripting completes; edited in the scene editor. */
    script: jsonb("script"),
    errorMessage: text("error_message"),
    /** Storage key of the final MP4 (FAV-1004). */
    finalAssetKey: text("final_asset_key"),
    thumbnailAssetKey: text("thumbnail_asset_key"),
    /** Streaming host playback id (Mux) when ingested (FAV-1002). */
    playbackId: text("playback_id"),
    narrationAssetKey: text("narration_asset_key"),
    captionCues: jsonb("caption_cues"),
    durationSeconds: real("duration_seconds"),
    creditsEstimated: integer("credits_estimated"),
    creditsCharged: integer("credits_charged"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("videos_org_status_idx").on(t.orgId, t.status), index("videos_org_created_idx").on(t.orgId, t.createdAt)]
);

export const scenes = pgTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    narration: text("narration").notNull(),
    visualPrompt: text("visual_prompt").notNull(),
    onScreenText: text("on_screen_text"),
    status: sceneStatus("status").notNull().default("pending"),
    imageAssetKey: text("image_asset_key"),
    /** max tier: generated video clip instead of a still (FAV-503). */
    clipAssetKey: text("clip_asset_key"),
    audioStartSec: real("audio_start_sec"),
    audioEndSec: real("audio_end_sec"),
    rerollCount: integer("reroll_count").notNull().default(0),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex("scenes_video_index_idx").on(t.videoId, t.index)]
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    videoId: text("video_id").references(() => videos.id, { onDelete: "cascade" }),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    /** Current pipeline stage + granular progress for the UI (FAV-905). */
    stage: text("stage"),
    stageProgress: integer("stage_progress").notNull().default(0),
    detail: text("detail"),
    error: text("error"),
    /** Steps are idempotent keyed on video+step; the job itself is keyed too (FAV-903). */
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    /**
     * Queue lease (FAV-901): a worker claims a job by setting worker_id and a
     * lease expiry, extending it via heartbeat while running. If the worker
     * dies the lease lapses and another worker reclaims the job — pipeline
     * steps are idempotent, so the re-run resumes rather than duplicating.
     */
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    workerId: text("worker_id"),
    /** Correlates logs across web -> workflow -> workers (FAV-1601). */
    traceId: text("trace_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("jobs_idempotency_idx").on(t.idempotencyKey),
    index("jobs_org_status_idx").on(t.orgId, t.status),
    index("jobs_video_idx").on(t.videoId),
    // Drives the claim query: pending work ordered by age, plus lease sweeps.
    index("jobs_claim_idx").on(t.status, t.leasedUntil, t.createdAt)
  ]
);

// ---------------------------------------------------------------------------
// Credit ledger (FAV-303): append-only, no mutable balance column
// ---------------------------------------------------------------------------

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entryType: ledgerEntryType("entry_type").notNull(),
    /**
     * Signed credits: grants/purchases/releases/refunds positive, reservations negative.
     * Balance is always SUM(amount) for the org — rows are never updated or deleted.
     */
    amount: integer("amount").notNull(),
    jobId: text("job_id").references(() => jobs.id),
    videoId: text("video_id").references(() => videos.id),
    /** Stripe event id for webhook-driven entries; uniqueness gives idempotency (FAV-1202). */
    stripeEventId: text("stripe_event_id"),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    metadata: jsonb("metadata"),
    createdAt: createdAt()
  },
  (t) => [
    index("ledger_org_created_idx").on(t.orgId, t.createdAt),
    // One reservation / release / refund per job — retries can't double-charge (FAV-903/904).
    uniqueIndex("ledger_job_entry_idx")
      .on(t.jobId, t.entryType)
      .where(sql`${t.jobId} IS NOT NULL`),
    uniqueIndex("ledger_stripe_event_idx")
      .on(t.stripeEventId, t.entryType)
      .where(sql`${t.stripeEventId} IS NOT NULL`)
  ]
);

// ---------------------------------------------------------------------------
// Voices & music (FAV-304, FAV-6xx, FAV-805)
// ---------------------------------------------------------------------------

export const voices = pgTable(
  "voices",
  {
    id: text("id").primaryKey(),
    /** NULL = global library voice; set = org-owned clone (FAV-603). */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("mock"),
    providerVoiceId: text("provider_voice_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    language: text("language").notNull().default("en"),
    /** Extra languages this voice supports (FAV-605). */
    languages: jsonb("languages").$type<string[]>(),
    gender: text("gender"),
    previewAssetKey: text("preview_asset_key"),
    isClone: boolean("is_clone").notNull().default(false),
    /** ENCRYPTED AT REST (FAV-1603): envelope-encrypted sample reference, never plaintext. */
    cloneSampleKeyEncrypted: text("clone_sample_key_encrypted"),
    status: voiceStatus("status").notNull().default("ready"),
    createdAt: createdAt()
  },
  (t) => [index("voices_org_idx").on(t.orgId), index("voices_language_idx").on(t.language)]
);

export const musicTracks = pgTable("music_tracks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mood: text("mood").notNull(),
  assetKey: text("asset_key").notNull(),
  durationSeconds: real("duration_seconds").notNull(),
  license: text("license").notNull().default("royalty-free"),
  createdAt: createdAt()
});

// ---------------------------------------------------------------------------
// Publishing (FAV-304, FAV-13xx)
// ---------------------------------------------------------------------------

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name"),
    /** ENCRYPTED AT REST (FAV-1603): envelope-encrypted OAuth tokens, never plaintext. */
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").$type<string[]>(),
    status: socialAccountStatus("status").notNull().default("connected"),
    connectedByUserId: text("connected_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("social_accounts_org_platform_ext_idx").on(t.orgId, t.platform, t.externalAccountId),
    index("social_accounts_expiry_idx").on(t.tokenExpiresAt)
  ]
);

export const publishJobs = pgTable(
  "publish_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    socialAccountId: text("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    platform: socialPlatform("platform").notNull(),
    status: publishStatus("status").notNull().default("pending"),
    title: text("title").notNull(),
    description: text("description"),
    tags: jsonb("tags").$type<string[]>(),
    visibility: text("visibility").notNull().default("public"),
    /** Platform AI-disclosure flag attached on publish (FAV-1607). */
    aiDisclosure: boolean("ai_disclosure").notNull().default(true),
    externalPostId: text("external_post_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("publish_jobs_org_idx").on(t.orgId), index("publish_jobs_video_idx").on(t.videoId)]
);

// ---------------------------------------------------------------------------
// Autopilot (FAV-304, FAV-14xx)
// ---------------------------------------------------------------------------

export const autopilotRules = pgTable(
  "autopilot_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    niche: text("niche").notNull(),
    /** e.g. "daily", "weekly:mon,thu", "every:2d" — parsed by the scheduler (FAV-1402). */
    cadence: text("cadence").notNull(),
    socialAccountId: text("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null"
    }),
    /** Partial VideoRequest used as defaults for each run. */
    videoDefaults: jsonb("video_defaults"),
    enabled: boolean("enabled").notNull().default(true),
    /** Editorial review gate before publish (FAV-1404). */
    requiresReview: boolean("requires_review").notNull().default(false),
    /** Topics already used, so runs stay varied (FAV-1404 originality). */
    recentTopics: jsonb("recent_topics").$type<string[]>(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("autopilot_rules_next_run_idx").on(t.enabled, t.nextRunAt)]
);

export const autopilotRuns = pgTable(
  "autopilot_runs",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => autopilotRules.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    videoId: text("video_id").references(() => videos.id, { onDelete: "set null" }),
    publishJobId: text("publish_job_id").references(() => publishJobs.id, { onDelete: "set null" }),
    status: autopilotRunStatus("status").notNull().default("running"),
    ideaTopic: text("idea_topic"),
    error: text("error"),
    creditsSpent: integer("credits_spent"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true })
  },
  (t) => [index("autopilot_runs_rule_idx").on(t.ruleId, t.startedAt)]
);

// ---------------------------------------------------------------------------
// Public API (FAV-1501)
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 of the full key; plaintext is shown once at creation and never stored. */
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)]
);

// ---------------------------------------------------------------------------
// Platform plumbing: webhooks, flags, moderation, audit (FAV-1202, 1703, 405, 1704)
// ---------------------------------------------------------------------------

/** Processed external webhook events — the idempotency record (FAV-1202 AC). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.provider, t.externalId] })]
);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description"),
  defaultOn: boolean("default_on").notNull().default(false),
  createdAt: createdAt()
});

export const featureFlagOverrides = pgTable(
  "feature_flag_overrides",
  {
    flagKey: text("flag_key")
      .notNull()
      .references(() => featureFlags.key, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull()
  },
  (t) => [primaryKey({ columns: [t.flagKey, t.orgId] })]
);

export const moderationDecisions = pgTable(
  "moderation_decisions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    videoId: text("video_id").references(() => videos.id, { onDelete: "set null" }),
    stage: text("stage").notNull().default("input"),
    inputText: text("input_text").notNull(),
    verdict: moderationVerdict("verdict").notNull(),
    categories: jsonb("categories").$type<string[]>(),
    createdAt: createdAt()
  },
  (t) => [index("moderation_org_idx").on(t.orgId, t.createdAt)]
);

export const impersonationSessions = pgTable("impersonation_sessions", {
  id: text("id").primaryKey(),
  staffUserId: text("staff_user_id")
    .notNull()
    .references(() => users.id),
  targetOrgId: text("target_org_id")
    .notNull()
    .references(() => organizations.id),
  reason: text("reason").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true })
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id),
    orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    impersonationSessionId: text("impersonation_session_id").references(() => impersonationSessions.id),
    metadata: jsonb("metadata"),
    createdAt: createdAt()
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)]
);
