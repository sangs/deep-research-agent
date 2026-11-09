ALTER TABLE "users" ADD COLUMN "deletion_requested_at" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_before_deletion" text;--> statement-breakpoint
-- Purge accounts whose 30-day deletion grace period is over (design 14 §8).
-- Called by the background job as app_worker (SECURITY INVOKER: runs with the
-- caller's rights). Per account: strip email addresses from its audit entries,
-- delete the user row (ON DELETE CASCADE removes all of its data), and record
-- an id-only 'account_deleted' entry. Returns how many accounts were purged.
CREATE OR REPLACE FUNCTION purge_deleted_accounts(grace_days integer) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  cutoff bigint := (extract(epoch FROM now()) * 1000)::bigint - grace_days::bigint * 86400000;
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id, deletion_requested_by FROM users
    WHERE status = 'deleting' AND deletion_requested_at IS NOT NULL AND deletion_requested_at < cutoff
    FOR UPDATE
  LOOP
    UPDATE audit_log SET metadata = metadata - 'email'
    WHERE (target_user_id = r.id OR actor_user_id = r.id) AND metadata ? 'email';
    DELETE FROM users WHERE id = r.id;
    INSERT INTO audit_log (id, actor_user_id, action, target_user_id, metadata, created_at)
    VALUES (gen_random_uuid()::text, NULL, 'account_deleted', r.id,
            jsonb_build_object('grace_days', grace_days,
                               'requested_by', CASE WHEN r.deletion_requested_by = r.id THEN 'self' ELSE 'owner' END),
            (extract(epoch FROM now()) * 1000)::bigint);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_deleted_accounts(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_deleted_accounts(integer) TO app_worker;--> statement-breakpoint
-- The purge strips emails from audit metadata: the worker may update that column only.
GRANT UPDATE (metadata) ON audit_log TO app_worker;
