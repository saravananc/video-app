CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"external_id" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"credits_granted" integer,
	"hosted_invoice_url" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_external_idx" ON "invoices" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "invoices" USING btree ("org_id","issued_at");