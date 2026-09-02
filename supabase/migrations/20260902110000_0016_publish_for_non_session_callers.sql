-- =============================================================================
-- 0016 PUBLISHING FROM A NON-SESSION CALLER
--
-- `publish_schedule_version` checked the caller's permission itself, with
-- `app.has_permission(..., auth.uid())`. That works for the web UI, which
-- arrives with a JWT — and can never work for MCP, which authenticates with an
-- API key and has no `auth.uid()` at all. Publishing through MCP failed with a
-- permission error even for a key whose owner was an Owner.
--
-- The fix separates the two concerns that were tangled together:
--
--   * the *transaction* — archive the current published version, promote this
--     one, flip its entries to SCHEDULED — which is identical for every caller
--   * the *authorization* — which differs by transport: RLS and auth.uid() for
--     a browser session, the TypeScript permission service for MCP and jobs
--
-- The transaction moves into a function that performs no auth check and is
-- callable only by service_role. The session-facing wrapper keeps its check and
-- delegates. Neither path skips authorization; they just perform it where they
-- actually can.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The transaction, with no opinion about who is calling.
-- -----------------------------------------------------------------------------
create or replace function public.internal_publish_schedule_version(
  p_version_id uuid,
  p_user_id    uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version schedule_versions%rowtype;
begin
  select * into v_version from schedule_versions where id = p_version_id for update;
  if not found then
    raise exception 'That schedule version no longer exists.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  if v_version.status not in ('GENERATED', 'UNDER_REVIEW', 'DRAFT') then
    raise exception 'A % schedule can''t be published.', lower(v_version.status::text)
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  if exists (
    select 1 from schedule_entries
     where schedule_version_id = p_version_id
       and validation_state in ('CONFLICT', 'INVALID')
       and status <> 'CANCELLED'
  ) then
    raise exception 'Resolve the conflicting sessions before publishing.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  update schedule_versions
     set status = 'ARCHIVED', archived_at = now()
   where season_id = v_version.season_id
     and status = 'PUBLISHED'
     and id <> p_version_id;

  update schedule_versions
     set status = 'PUBLISHED', published_at = now(), published_by = p_user_id
   where id = p_version_id;

  update schedule_entries
     set status = 'SCHEDULED'
   where schedule_version_id = p_version_id
     and status = 'PROPOSED';

  return p_version_id;
end;
$$;

-- Only service_role. A client role calling this directly would be publishing
-- without any authorization check at all.
revoke all on function public.internal_publish_schedule_version(uuid, uuid)
  from public, anon, authenticated;

comment on function public.internal_publish_schedule_version(uuid, uuid) is
  'Publishes a schedule version without checking authorization. service_role '
  'only: callers must have already established the actor''s permission — the '
  'web UI through public.publish_schedule_version, MCP and jobs through the '
  'TypeScript permission service.';

-- -----------------------------------------------------------------------------
-- The session-facing wrapper: same check as before, one implementation beneath.
-- -----------------------------------------------------------------------------
create or replace function public.publish_schedule_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from schedule_versions where id = p_version_id;
  if v_tenant is null then
    raise exception 'That schedule version no longer exists.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  if not app.has_permission(v_tenant, 'schedule.publish') then
    raise exception 'You don''t have permission to publish schedules.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  return public.internal_publish_schedule_version(p_version_id, (select auth.uid()));
end;
$$;

revoke all on function public.publish_schedule_version(uuid) from public, anon;
grant execute on function public.publish_schedule_version(uuid) to authenticated;
