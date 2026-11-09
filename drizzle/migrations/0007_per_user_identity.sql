CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_user_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "default_sources" (
	"domain" text NOT NULL,
	"list_type" text NOT NULL,
	CONSTRAINT "default_sources_domain_list_type_pk" PRIMARY KEY("domain","list_type")
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"email_at_link" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "user_identities_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL,
	"approved_at" bigint,
	"approved_by" text,
	"last_login_at" bigint
);
--> statement-breakpoint
ALTER TABLE "curated_sources" ADD COLUMN "user_id" text DEFAULT '32087c9e-d37e-4b7c-896e-58da85f4d108' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_created_idx" ON "audit_log" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_created_idx" ON "users" USING btree ("status","created_at");--> statement-breakpoint
-- ── Data steps (hand-written; see architecture/features/14-per-user-data-isolation-design) ──
-- The owner keeps the pre-multi-user fixed id, so every existing row is already theirs.
-- Email is a placeholder, claimed at the owner's next sign-in (AUTH_OWNER_EMAILS).
INSERT INTO "users" ("id", "email", "role", "status", "created_at", "approved_at")
VALUES ('32087c9e-d37e-4b7c-896e-58da85f4d108', 'owner@unclaimed.invalid', 'owner', 'active',
        (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Account that scheduled newsletter sweeps charge their cost to
-- (backend/services/ingest.py SYSTEM_USER). Never signs in: no identity, suspended.
INSERT INTO "users" ("id", "email", "name", "role", "status", "created_at")
VALUES ('system:newsletter-ingest', 'newsletter-ingest@system.invalid', 'Newsletter background sweeps', 'system', 'suspended',
        (extract(epoch from now()) * 1000)::bigint)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Any other user id already in personal tables gets a suspended placeholder user,
-- so the foreign keys below succeed and no data is lost.
INSERT INTO "users" ("id", "email", "role", "status", "created_at")
SELECT u, 'legacy-' || u || '@unclaimed.invalid', 'member', 'suspended', (extract(epoch from now()) * 1000)::bigint
FROM (
  SELECT "user_id" AS u FROM "research_sessions"
  UNION SELECT "user_id" FROM "news_digests"
  UNION SELECT "user_id" FROM "usage_events"
  UNION SELECT "user_id" FROM "budget_raises"
  UNION SELECT "user_id" FROM "rate_limit_counters"
) ids
WHERE u IS NOT NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- The old global uniqueness on curated_sources ((domain) or (domain, list_type), created
-- outside Drizzle by hand) would stop two users from having the same source. Drop
-- whatever unique constraints / indexes exist, apart from the primary key.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.curated_sources'::regclass AND contype = 'u' LOOP
    EXECUTE format('ALTER TABLE public.curated_sources DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
           WHERE i.indrelid = 'public.curated_sources'::regclass AND i.indisunique AND NOT i.indisprimary LOOP
    EXECUTE format('DROP INDEX public.%I', r.relname);
  END LOOP;
END $$;--> statement-breakpoint
-- Template for new users' source lists (same list as supabase/seed.sql).
INSERT INTO "default_sources" ("domain", "list_type") VALUES
  ('techcrunch.com', 'news_sites'),
  ('venturebeat.com', 'news_sites'),
  ('the-decoder.com', 'news_sites'),
  ('theverge.com', 'news_sites'),
  ('wired.com', 'news_sites'),
  ('infoq.com', 'news_sites'),
  ('thoughtworks.com', 'news_sites'),
  ('kdnuggets.com', 'news_sites'),
  ('towardsdatascience.com', 'news_sites'),
  ('news.ycombinator.com', 'news_sites'),
  ('unite.ai', 'news_sites'),
  ('openai.com', 'research_sites'),
  ('anthropic.com', 'research_sites'),
  ('deepmind.google', 'research_sites'),
  ('ai.meta.com', 'research_sites'),
  ('mistral.ai', 'research_sites'),
  ('huggingface.co', 'research_sites'),
  ('paperswithcode.com', 'research_sites'),
  ('developers.googleblog.com', 'research_sites'),
  ('research.microsoft.com', 'research_sites'),
  ('sherwood.news', 'newsletters'),
  ('deepview.com', 'newsletters'),
  ('alphasignal.ai', 'newsletters'),
  ('lennysnewsletter.com', 'newsletters'),
  ('infoq.com', 'newsletters'),
  ('tldrnewsletter.com', 'newsletters'),
  ('superhuman.ai', 'newsletters'),
  ('genai.works', 'newsletters'),
  ('8020ai.co', 'newsletters'),
  ('llmwatch.com', 'newsletters'),
  ('medium.com', 'newsletters'),
  ('substack.com', 'newsletters'),
  ('globalai.community', 'newsletters'),
  ('llamaindex.ai', 'newsletters'),
  ('ndtv.com', 'global_news_sites'),
  ('thehindu.com', 'global_news_sites'),
  ('indianexpress.com', 'global_news_sites'),
  ('reuters.com', 'global_news_sites'),
  ('apnews.com', 'global_news_sites'),
  ('bbc.com', 'global_news_sites'),
  ('nytimes.com', 'global_news_sites'),
  ('wsj.com', 'global_news_sites'),
  ('bloomberg.com', 'global_news_sites'),
  ('theguardian.com', 'global_news_sites'),
  ('cnn.com', 'global_news_sites'),
  ('npr.org', 'global_news_sites'),
  ('axios.com', 'global_news_sites'),
  ('economist.com', 'global_news_sites'),
  ('aljazeera.com', 'global_news_sites')
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "budget_raises" ADD CONSTRAINT "budget_raises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_sources" ADD CONSTRAINT "curated_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_digests" ADD CONSTRAINT "news_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD CONSTRAINT "rate_limit_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curated_sources_user_domain_list_unique" ON "curated_sources" USING btree ("user_id","domain","list_type");