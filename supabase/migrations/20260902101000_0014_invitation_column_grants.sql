-- =============================================================================
-- 0014 INVITATION COLUMN GRANTS
--
-- 0013 tried to hide `token_hash` with a column-level REVOKE, which did
-- nothing: `authenticated` holds SELECT on the whole table, and in Postgres a
-- table-level privilege is not narrowed by revoking one column. The privilege
-- has to be dropped and re-granted column by column.
--
-- Caught by testing what the client could actually read back, rather than
-- trusting the migration to have meant what it said.
-- =============================================================================

revoke select on public.invitations from authenticated, anon;

-- Everything the members screen renders — and nothing else. Adding a column to
-- this table in future will make it invisible to clients until it is listed
-- here, which is the right default for a table holding a secret.
grant select (
  id,
  tenant_id,
  email,
  role_id,
  status,
  message,
  expires_at,
  invited_by,
  accepted_by,
  accepted_at,
  revoked_at,
  created_at,
  updated_at
) on public.invitations to authenticated;
