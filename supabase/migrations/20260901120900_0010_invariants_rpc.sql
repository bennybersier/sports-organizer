-- =============================================================================
-- 0010 BUSINESS INVARIANTS & TRANSACTIONAL RPCs
--
-- Operations that must be all-or-nothing, or that a client must be able to
-- trigger without being able to read the underlying rows, live here as
-- SECURITY DEFINER functions with a locked search_path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A tenant must always keep at least one active Owner.
-- -----------------------------------------------------------------------------
create or replace function app.assert_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_owner_count int;
begin
  select count(*)
    into v_owner_count
    from tenant_memberships m
    join roles r on r.id = m.role_id
   where m.tenant_id = v_tenant
     and m.status = 'ACTIVE'
     and r.key = 'OWNER';

  if v_owner_count = 0 then
    raise exception 'a club must always have at least one active owner'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger trg_memberships_owner_remains
  after update or delete on tenant_memberships
  deferrable initially deferred
  for each row execute function app.assert_owner_remains();

-- -----------------------------------------------------------------------------
-- Provision a club. Creates the tenant, its Owner membership and the onboarding
-- record in one transaction. Server-side only (service_role): there is no
-- public self-service club creation.
-- -----------------------------------------------------------------------------
create or replace function app.provision_tenant(
  p_name       text,
  p_slug       text,
  p_owner_id   uuid,
  p_timezone   text default 'Europe/Zurich',
  p_locale     text default 'en',
  p_week_start smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_owner_role uuid;
begin
  select id into v_owner_role from roles where key = 'OWNER' and tenant_id is null;
  if v_owner_role is null then
    raise exception 'system OWNER role is missing; run the permission seed migration';
  end if;

  insert into tenants (name, slug, timezone, locale, week_start, created_by)
  values (p_name, p_slug, p_timezone, p_locale, p_week_start, p_owner_id)
  returning id into v_tenant_id;

  insert into tenant_memberships (tenant_id, user_id, role_id, created_by)
  values (v_tenant_id, p_owner_id, v_owner_role, p_owner_id);

  insert into onboarding_progress (tenant_id) values (v_tenant_id);

  return v_tenant_id;
end;
$$;

revoke all on function app.provision_tenant(text, text, uuid, text, text, smallint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Accept an invitation.
--
-- The caller is authenticated but is *not yet* a member, so no RLS policy could
-- let them read the invitation. They present the raw token; we match on its
-- hash, verify it is theirs, and create the membership atomically. The function
-- returns only the tenant id — never any other tenant data.
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email   text;
  v_inv     invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select email into v_email from profiles where id = v_user_id;

  select * into v_inv
    from invitations
   where token_hash = p_token_hash
   for update;

  if not found then
    raise exception 'invitation not found' using errcode = 'no_data_found';
  end if;

  if v_inv.status <> 'PENDING' then
    raise exception 'this invitation is no longer valid' using errcode = 'check_violation';
  end if;

  if v_inv.expires_at <= now() then
    update invitations set status = 'EXPIRED' where id = v_inv.id;
    raise exception 'this invitation has expired' using errcode = 'check_violation';
  end if;

  -- The invitation is bound to the email address it was sent to.
  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'this invitation was issued to a different email address'
      using errcode = 'insufficient_privilege';
  end if;

  insert into tenant_memberships (tenant_id, user_id, role_id, created_by)
  values (v_inv.tenant_id, v_user_id, v_inv.role_id, v_inv.invited_by)
  on conflict (tenant_id, user_id) do nothing;

  update invitations
     set status      = 'ACCEPTED',
         accepted_by = v_user_id,
         accepted_at = now()
   where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Publish a schedule version.
--
-- Transactional promotion: the currently published version for the season is
-- archived and the target version becomes PUBLISHED. Nothing is ever edited in
-- place on a live schedule.
-- -----------------------------------------------------------------------------
create or replace function public.publish_schedule_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_version schedule_versions%rowtype;
begin
  select * into v_version from schedule_versions where id = p_version_id for update;
  if not found then
    raise exception 'schedule version not found' using errcode = 'no_data_found';
  end if;

  if not app.has_permission(v_version.tenant_id, 'schedule.publish') then
    raise exception 'not authorized to publish schedules' using errcode = 'insufficient_privilege';
  end if;

  if v_version.status not in ('GENERATED', 'UNDER_REVIEW', 'DRAFT') then
    raise exception 'a % schedule cannot be published', v_version.status
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from schedule_entries
     where schedule_version_id = p_version_id
       and validation_state in ('CONFLICT', 'INVALID')
       and status <> 'CANCELLED'
  ) then
    raise exception 'resolve all conflicting entries before publishing'
      using errcode = 'check_violation';
  end if;

  update schedule_versions
     set status = 'ARCHIVED', archived_at = now()
   where season_id = v_version.season_id
     and status = 'PUBLISHED'
     and id <> p_version_id;

  update schedule_versions
     set status = 'PUBLISHED', published_at = now(), published_by = v_user_id
   where id = p_version_id;

  update schedule_entries
     set status = 'SCHEDULED'
   where schedule_version_id = p_version_id
     and status = 'PROPOSED';

  return p_version_id;
end;
$$;

revoke all on function public.publish_schedule_version(uuid) from public, anon;
grant execute on function public.publish_schedule_version(uuid) to authenticated;
