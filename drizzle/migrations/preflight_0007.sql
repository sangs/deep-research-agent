-- Read-only preflight for 0007_per_user_identity. Run before `npx drizzle-kit migrate`:
--   psql "$DATABASE_URL" -X -f drizzle/migrations/preflight_0007.sql
-- Expect: only user id 32087c9e-d37e-4b7c-896e-58da85f4d108 below (anything else becomes a
-- suspended placeholder user), and 0007 not yet in the applied list.
SET default_transaction_read_only = on;
SELECT 'research_sessions' AS tbl, user_id, count(*) FROM research_sessions GROUP BY 2
UNION ALL SELECT 'news_digests', user_id, count(*) FROM news_digests GROUP BY 2
UNION ALL SELECT 'usage_events', user_id, count(*) FROM usage_events GROUP BY 2
UNION ALL SELECT 'budget_raises', user_id, count(*) FROM budget_raises GROUP BY 2
UNION ALL SELECT 'rate_limit_counters', user_id, count(*) FROM rate_limit_counters GROUP BY 2;
SELECT count(*) AS curated_sources_rows FROM curated_sources;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.curated_sources'::regclass;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'curated_sources';
SELECT to_regclass('public.users') AS users_table_already_exists;
SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
