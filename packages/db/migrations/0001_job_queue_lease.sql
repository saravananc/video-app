ALTER TABLE "jobs" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "worker_id" text;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","leased_until","created_at");