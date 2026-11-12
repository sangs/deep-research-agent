-- Phase C (design 15): each user connects their own Gmail. EXPAND step: additive only, so the
-- Phase B code keeps working while this is live. mailbox_id stays nullable until the owner's existing
-- rows are re-pointed to their mailbox (rollout step 5); a later contract migration then makes it
-- required and moves newsletter_emails' key to (mailbox_id, message_id).
CREATE TABLE "gmail_cap_ledger" (
	"google_sub" text PRIMARY KEY NOT NULL,
	"first_granted_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_credentials" (
	"mailbox_id" text PRIMARY KEY NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_nonce" "bytea" NOT NULL,
	"data_key_ciphertext" "bytea" NOT NULL,
	"kms_key_name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"client_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sweep_enabled" boolean DEFAULT true NOT NULL,
	"connected_at" bigint NOT NULL,
	"disconnected_at" bigint,
	"last_sweep_at" bigint,
	"last_error" text,
	"last_error_at" bigint
);
--> statement-breakpoint
ALTER TABLE "gmail_actions" ADD COLUMN "mailbox_id" text;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN "mailbox_id" text;--> statement-breakpoint
ALTER TABLE "newsletter_emails" ADD COLUMN "mailbox_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gmail_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_credentials" ADD CONSTRAINT "gmail_credentials_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_user_unique" ON "mailboxes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_google_sub_unique" ON "mailboxes" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "mailboxes_status_idx" ON "mailboxes" USING btree ("status");--> statement-breakpoint
ALTER TABLE "gmail_actions" ADD CONSTRAINT "gmail_actions_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_emails" ADD CONSTRAINT "newsletter_emails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gmail_actions_mailbox_created_idx" ON "gmail_actions" USING btree ("mailbox_id","created_at");--> statement-breakpoint
CREATE INDEX "ingest_jobs_mailbox_kind_created_idx" ON "ingest_jobs" USING btree ("mailbox_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_emails_mailbox_message_unique" ON "newsletter_emails" USING btree ("mailbox_id","message_id");--> statement-breakpoint

-- ── Row security (Phase B rules, CLAUDE.md) ──────────────────────────────────
ALTER TABLE mailboxes         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mailboxes         FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gmail_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gmail_credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gmail_cap_ledger  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gmail_cap_ledger  FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- app_user: their own mailbox (read; pause/resume background summarizing only).
GRANT SELECT ON mailboxes TO app_user;--> statement-breakpoint
GRANT UPDATE (sweep_enabled) ON mailboxes TO app_user;--> statement-breakpoint
CREATE POLICY mailboxes_app_user ON mailboxes FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint

-- app_user: mailbox-scoped rows of their own mailbox only.
GRANT SELECT, INSERT, UPDATE, DELETE ON newsletter_emails TO app_user;--> statement-breakpoint
CREATE POLICY newsletter_emails_app_user ON newsletter_emails FOR ALL TO app_user
  USING (mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = NULLIF(current_setting('app.user_id', true), '')))
  WITH CHECK (mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = NULLIF(current_setting('app.user_id', true), '')));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON gmail_actions TO app_user;--> statement-breakpoint
CREATE POLICY gmail_actions_app_user ON gmail_actions FOR ALL TO app_user
  USING (mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = NULLIF(current_setting('app.user_id', true), '')))
  WITH CHECK (mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = NULLIF(current_setting('app.user_id', true), '')));--> statement-breakpoint
-- Background sweeps of their mailbox (requested_by is null on those); permissive, so OR'ed with ingest_jobs_app_user.
CREATE POLICY ingest_jobs_app_user_mailbox ON ingest_jobs FOR SELECT TO app_user
  USING (mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = NULLIF(current_setting('app.user_id', true), '')));--> statement-breakpoint

-- app_worker (backend only): connect/disconnect, sweeps, the cap ledger, and the
-- credentials, which no other role can read.
GRANT SELECT, INSERT, UPDATE, DELETE ON mailboxes, gmail_credentials TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT ON gmail_cap_ledger TO app_worker;--> statement-breakpoint
CREATE POLICY mailboxes_app_worker ON mailboxes FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY gmail_credentials_app_worker ON gmail_credentials FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY gmail_cap_ledger_app_worker ON gmail_cap_ledger FOR ALL TO app_worker USING (true) WITH CHECK (true);
