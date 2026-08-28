// This app is single-tenant today (one shared Gmail account, no login) — a
// per-browser localStorage UUID fragmented saved/cached data across every
// browser session, profile, and device that ever ran the app (7 distinct
// identities found in Supabase as of 2026-08-28, almost certainly all the
// same real person). Returning a fixed identity keeps everything under one
// permanent identity until real multi-user auth exists — see
// documents/multi_user_auth_payments_roadmap.md, which documents the
// migration path ("claim your existing data") for when that ships and this
// fixed value is replaced by an authenticated user_id.
const FIXED_USER_ID = '32087c9e-d37e-4b7c-896e-58da85f4d108';

export function getUserId(): string {
  return FIXED_USER_ID;
}
