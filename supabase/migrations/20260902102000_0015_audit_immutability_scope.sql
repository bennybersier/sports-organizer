-- =============================================================================
-- 0015 AUDIT IMMUTABILITY — SCOPE THE GUARD
--
-- `audit_logs` is append-only, enforced by a trigger that refuses UPDATE and
-- DELETE. Correct, but too broad: deleting a club cascades to its audit rows,
-- the trigger refuses, and the whole transaction aborts. A club that had ever
-- done anything could not be deleted at all.
--
-- Exactly the shape of the last-owner bug in 0012, and found the same way —
-- by trying to clean up after a test.
--
-- The guard now stands down only when the club itself is going away. Ordinary
-- deletes and every update stay refused, which is the property that makes the
-- log worth having.
-- =============================================================================

create or replace function app.reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /*
    An UPDATE is never legitimate: an audit entry that can be edited is not
    evidence of anything.
  */
  if tg_op = 'UPDATE' then
    raise exception '% rows cannot be modified', tg_table_name
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  /*
    A DELETE is legitimate in exactly one case: the club is being deleted and
    Postgres is cascading. Row-level FK cascades run after the parent row is
    gone, so its absence is the reliable signal — and it cannot be forged from
    a client, which has no delete privilege on this table in the first place.
  */
  if not exists (select 1 from tenants where id = old.tenant_id) then
    return old;
  end if;

  raise exception '% rows are append-only', tg_table_name
    using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
end;
$$;
