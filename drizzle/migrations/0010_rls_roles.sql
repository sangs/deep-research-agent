-- Phase B (design 14 §5.2, decision 2026-11-09): database-enforced isolation.
--
-- Roles
--   app_login  — the only role the app and backend log in as. NOINHERIT and no
--                table grants of its own: a query that doesn't first switch role
--                gets "permission denied". LOGIN + password are set outside the
--                repo by scripts/db-app-login.sh (never in a migration).
--   app_user   — NOLOGIN. Personal tables, rows where user_id = app.user_id.
--   app_worker — NOLOGIN. Narrow cross-user work: sign-in resolution, owner
--                console, usage totals, newsletter mailbox (owner-only until
--                Phase C), retention. No access to research, digests or sources
--                content.
-- The app switches with SET LOCAL ROLE + set_config('app.user_id', …, true)
-- inside a transaction (lib/db-access.ts, backend/services/db.py), which is
-- safe with the Supabase transaction pooler. Migrations run as postgres.
-- Every new table needs its grants and policies here (CLAUDE.md).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_login') THEN
    CREATE ROLE app_login NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
-- No NOSUPERUSER here: only a superuser may name that attribute (Supabase's postgres is not
-- one), and a role created by a non-superuser can never be a superuser anyway.
ALTER ROLE app_login NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE;--> statement-breakpoint
GRANT app_user TO app_login;--> statement-breakpoint
GRANT app_worker TO app_login;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user, app_worker;--> statement-breakpoint

-- Row security on, and enforced even for the table owner's sessions that lack BYPASSRLS.
ALTER TABLE research_sessions   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE research_sessions   FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE news_digests        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE news_digests        FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE curated_sources     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE curated_sources     FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE usage_events        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE usage_events        FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE budget_raises       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE budget_raises       FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rate_limit_counters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users               FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE user_identities     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE user_identities     FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log           FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE default_sources     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE default_sources     FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE newsletter_emails   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE newsletter_emails   FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ingest_jobs         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ingest_jobs         FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gmail_actions       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gmail_actions       FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app_settings        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE app_settings        FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── app_user: the signed-in user's own rows ──────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON research_sessions, news_digests, curated_sources TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT ON usage_events, budget_raises TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON rate_limit_counters TO app_user;--> statement-breakpoint
GRANT SELECT ON users, ingest_jobs TO app_user;--> statement-breakpoint

CREATE POLICY research_sessions_app_user ON research_sessions FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY news_digests_app_user ON news_digests FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY curated_sources_app_user ON curated_sources FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY usage_events_app_user ON usage_events FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY budget_raises_app_user ON budget_raises FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY rate_limit_counters_app_user ON rate_limit_counters FOR ALL TO app_user
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY users_app_user ON users FOR SELECT TO app_user
  USING (id = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY ingest_jobs_app_user ON ingest_jobs FOR SELECT TO app_user
  USING (requested_by = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint

-- ── app_worker: cross-user work that never reads personal content ────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON user_identities, audit_log TO app_worker;--> statement-breakpoint
GRANT SELECT ON default_sources TO app_worker;--> statement-breakpoint
GRANT INSERT ON curated_sources TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT ON usage_events TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON newsletter_emails, ingest_jobs, gmail_actions, app_settings TO app_worker;--> statement-breakpoint

CREATE POLICY users_app_worker ON users FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY user_identities_app_worker ON user_identities FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY audit_log_app_worker ON audit_log FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY default_sources_app_worker ON default_sources FOR SELECT TO app_worker USING (true);--> statement-breakpoint
-- Seeding a newly active user's lists: insert only (no read of anyone's sources).
CREATE POLICY curated_sources_app_worker_seed ON curated_sources FOR INSERT TO app_worker WITH CHECK (true);--> statement-breakpoint
-- Spend totals (owner console, app-wide cap) and the newsletter sweep's own cost rows.
CREATE POLICY usage_events_app_worker ON usage_events FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
-- Newsletter mailbox tables: owner-only features until Phase C scopes them per mailbox.
CREATE POLICY newsletter_emails_app_worker ON newsletter_emails FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY ingest_jobs_app_worker ON ingest_jobs FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY gmail_actions_app_worker ON gmail_actions FOR ALL TO app_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY app_settings_app_worker ON app_settings FOR ALL TO app_worker USING (true) WITH CHECK (true);
