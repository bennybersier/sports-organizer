-- =============================================================================
-- 0012 USER-FACING ERROR MESSAGES & OWNER-GUARD FIX
--
-- Two corrections found by actually using the thing.
--
-- 1. The last-owner guard made tenant deletion impossible. Deleting a club
--    cascades to its memberships, the guard counts zero remaining owners, and
--    the whole transaction aborts — so a club could never be removed, and
--    neither could a user who solely owned one. The guard now stands down when
--    the club itself is going away, which is the only case it was never meant
--    to police.
--
-- 2. Messages raised deliberately by our own functions were being replaced with
--    generic ones. `fromDatabaseError` maps SQLSTATEs to error types, and it
--    cannot tell "Postgres rejected a constraint" (message is technical, must
--    not be shown) from "our function raised copy written for a human". So
--    "No account exists for that email" surfaced as "That club could not be
--    found", which is both unhelpful and untrue.
--
--    Every deliberate raise now carries HINT = 'SCO_USER_MESSAGE'. Postgres
--    never sets that itself, so it is an unambiguous signal that the message is
--    safe and intended for the end user. The SQLSTATE still selects the error
--    type and HTTP status; the hint only decides whose words are shown.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Owner guard: ignore cascades from the club's own deletion.
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
  -- The trigger is DEFERRABLE INITIALLY DEFERRED, so by the time it runs the
  -- club row is already gone if the club was itself deleted. Nothing to guard.
  if not exists (select 1 from tenants where id = v_tenant) then
    return null;
  end if;

  select count(*)
    into v_owner_count
    from tenant_memberships m
    join roles r on r.id = m.role_id
   where m.tenant_id = v_tenant
     and m.status = 'ACTIVE'
     and r.key = 'OWNER';

  if v_owner_count = 0 then
    raise exception 'This club must always have at least one active owner. Make someone else an owner first.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Mark every deliberate message as user-facing.
-- -----------------------------------------------------------------------------
create or replace function app.assert_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_tenant uuid;
begin
  execute format('select tenant_id from %I where id = $1', tg_argv[0])
     into v_parent_tenant
    using (to_jsonb(new) ->> tg_argv[1])::uuid;

  if v_parent_tenant is null then
    raise exception 'The linked % no longer exists.', tg_argv[0]
      using errcode = 'foreign_key_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  if v_parent_tenant <> new.tenant_id then
    raise exception 'That record belongs to a different club.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;
  return new;
end;
$$;

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
    raise exception 'Sign in to accept this invitation.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  select email into v_email from profiles where id = v_user_id;

  select * into v_inv from invitations where token_hash = p_token_hash for update;

  if not found then
    raise exception 'We couldn''t find that invitation. Check the link is complete.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  if v_inv.status <> 'PENDING' then
    raise exception 'This invitation has already been used or withdrawn.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  if v_inv.expires_at <= now() then
    update invitations set status = 'EXPIRED' where id = v_inv.id;
    raise exception 'This invitation has expired. Ask for a new one.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'This invitation was sent to a different email address.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  insert into tenant_memberships (tenant_id, user_id, role_id, created_by)
  values (v_inv.tenant_id, v_user_id, v_inv.role_id, v_inv.invited_by)
  on conflict (tenant_id, user_id) do nothing;

  update invitations
     set status = 'ACCEPTED', accepted_by = v_user_id, accepted_at = now()
   where id = v_inv.id;

  return v_inv.tenant_id;
end;
$$;

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
    raise exception 'That schedule version no longer exists.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  if not app.has_permission(v_version.tenant_id, 'schedule.publish') then
    raise exception 'You don''t have permission to publish schedules.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
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
   where season_id = v_version.season_id and status = 'PUBLISHED' and id <> p_version_id;

  update schedule_versions
     set status = 'PUBLISHED', published_at = now(), published_by = v_user_id
   where id = p_version_id;

  update schedule_entries
     set status = 'SCHEDULED'
   where schedule_version_id = p_version_id and status = 'PROPOSED';

  return p_version_id;
end;
$$;

create or replace function public.admin_create_tenant(
  p_name        text,
  p_slug        text,
  p_owner_email text,
  p_timezone    text default 'Europe/Zurich',
  p_locale      text default 'en',
  p_week_start  smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id  uuid;
  v_owner_role uuid;
  v_owner_id   uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can create clubs.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  select id into v_owner_id from profiles where email = lower(btrim(p_owner_email));
  if v_owner_id is null then
    raise exception 'No account exists for %. The owner needs to sign up or be invited first — creating a club never creates an account.', lower(btrim(p_owner_email))
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  select id into v_owner_role from roles where key = 'OWNER' and tenant_id is null;

  insert into tenants (name, slug, timezone, locale, week_start, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), p_timezone, p_locale, p_week_start, (select auth.uid()))
  returning id into v_tenant_id;

  insert into tenant_memberships (tenant_id, user_id, role_id, created_by)
  values (v_tenant_id, v_owner_id, v_owner_role, (select auth.uid()));

  insert into onboarding_progress (tenant_id) values (v_tenant_id);

  return v_tenant_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Deleting a club: privileged, deliberate, and now actually possible.
-- -----------------------------------------------------------------------------
create or replace function public.admin_delete_tenant(p_tenant_id uuid, p_confirm_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
begin
  if not app.is_platform_admin() then
    raise exception 'Only platform administrators can delete clubs.'
      using errcode = 'insufficient_privilege', hint = 'SCO_USER_MESSAGE';
  end if;

  select slug into v_slug from tenants where id = p_tenant_id;
  if v_slug is null then
    raise exception 'That club no longer exists.'
      using errcode = 'no_data_found', hint = 'SCO_USER_MESSAGE';
  end if;

  -- Typing the slug is the confirmation; this destroys every season, schedule
  -- and roster the club owns.
  if lower(btrim(p_confirm_slug)) <> v_slug then
    raise exception 'Type the club''s URL name exactly to confirm deletion.'
      using errcode = 'check_violation', hint = 'SCO_USER_MESSAGE';
  end if;

  delete from tenants where id = p_tenant_id;
end;
$$;

grant execute on function public.admin_delete_tenant(uuid, text) to authenticated;
