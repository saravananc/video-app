CREATE TYPE "public"."autopilot_run_status" AS ENUM('running', 'awaiting_review', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('generation', 'reroll', 'publish', 'cleanup', 'autopilot');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('grant', 'purchase', 'reservation', 'reservation_release', 'refund', 'adjustment', 'reset');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."moderation_verdict" AS ENUM('allowed', 'blocked', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'starter', 'pro', 'scale');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('pending', 'uploading', 'published', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."scene_status" AS ENUM('pending', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."social_account_status" AS ENUM('connected', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('youtube', 'tiktok', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('draft', 'queued', 'generating', 'rendering', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."voice_status" AS ENUM('ready', 'processing', 'failed');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"org_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"impersonation_session_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"cadence" text NOT NULL,
	"social_account_id" text,
	"video_defaults" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"requires_review" boolean DEFAULT false NOT NULL,
	"recent_topics" jsonb,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"org_id" text NOT NULL,
	"video_id" text,
	"publish_job_id" text,
	"status" "autopilot_run_status" DEFAULT 'running' NOT NULL,
	"idea_topic" text,
	"error" text,
	"credits_spent" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"job_id" text,
	"video_id" text,
	"stripe_event_id" text,
	"reason" text,
	"created_by_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag_overrides" (
	"flag_key" text NOT NULL,
	"org_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "feature_flag_overrides_flag_key_org_id_pk" PRIMARY KEY("flag_key","org_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"default_on" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_user_id" text NOT NULL,
	"target_org_id" text NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"video_id" text,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"stage" text,
	"stage_progress" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"error" text,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"trace_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"video_id" text,
	"stage" text DEFAULT 'input' NOT NULL,
	"input_text" text NOT NULL,
	"verdict" "moderation_verdict" NOT NULL,
	"categories" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mood" text NOT NULL,
	"asset_key" text NOT NULL,
	"duration_seconds" real NOT NULL,
	"license" text DEFAULT 'royalty-free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" "plan_tier" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"cached_balance" integer DEFAULT 0 NOT NULL,
	"balance_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"video_id" text NOT NULL,
	"social_account_id" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"status" "publish_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"tags" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"ai_disclosure" boolean DEFAULT true NOT NULL,
	"external_post_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"index" integer NOT NULL,
	"narration" text NOT NULL,
	"visual_prompt" text NOT NULL,
	"on_screen_text" text,
	"status" "scene_status" DEFAULT 'pending' NOT NULL,
	"image_asset_key" text,
	"clip_asset_key" text,
	"audio_start_sec" real,
	"audio_end_sec" real,
	"reroll_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"scopes" jsonb,
	"status" "social_account_status" DEFAULT 'connected' NOT NULL,
	"connected_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_provider_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"is_staff" boolean DEFAULT false NOT NULL,
	"default_voice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"created_by_user_id" text,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"topic" text NOT NULL,
	"status" "video_status" DEFAULT 'draft' NOT NULL,
	"request" jsonb NOT NULL,
	"script" jsonb,
	"error_message" text,
	"final_asset_key" text,
	"thumbnail_asset_key" text,
	"playback_id" text,
	"narration_asset_key" text,
	"caption_cues" jsonb,
	"duration_seconds" real,
	"credits_estimated" integer,
	"credits_charged" integer,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"provider" text DEFAULT 'mock' NOT NULL,
	"provider_voice_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"language" text DEFAULT 'en' NOT NULL,
	"languages" jsonb,
	"gender" text,
	"preview_asset_key" text,
	"is_clone" boolean DEFAULT false NOT NULL,
	"clone_sample_key_encrypted" text,
	"status" "voice_status" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_external_id_pk" PRIMARY KEY("provider","external_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_impersonation_session_id_impersonation_sessions_id_fk" FOREIGN KEY ("impersonation_session_id") REFERENCES "public"."impersonation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_rules" ADD CONSTRAINT "autopilot_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_rules" ADD CONSTRAINT "autopilot_rules_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_rule_id_autopilot_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."autopilot_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_publish_job_id_publish_jobs_id_fk" FOREIGN KEY ("publish_job_id") REFERENCES "public"."publish_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voices" ADD CONSTRAINT "voices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilot_rules_next_run_idx" ON "autopilot_rules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "autopilot_runs_rule_idx" ON "autopilot_runs" USING btree ("rule_id","started_at");--> statement-breakpoint
CREATE INDEX "ledger_org_created_idx" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_job_entry_idx" ON "credit_ledger" USING btree ("job_id","entry_type") WHERE "credit_ledger"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_stripe_event_idx" ON "credit_ledger" USING btree ("stripe_event_id","entry_type") WHERE "credit_ledger"."stripe_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_idx" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_idx" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "jobs_video_idx" ON "jobs" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "moderation_org_idx" ON "moderation_decisions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_stripe_idx" ON "organizations" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "publish_jobs_org_idx" ON "publish_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "publish_jobs_video_idx" ON "publish_jobs" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenes_video_index_idx" ON "scenes" USING btree ("video_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_org_platform_ext_idx" ON "social_accounts" USING btree ("org_id","platform","external_account_id");--> statement-breakpoint
CREATE INDEX "social_accounts_expiry_idx" ON "social_accounts" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_provider_idx" ON "users" USING btree ("auth_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "videos_org_status_idx" ON "videos" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "videos_org_created_idx" ON "videos" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "voices_org_idx" ON "voices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "voices_language_idx" ON "voices" USING btree ("language");