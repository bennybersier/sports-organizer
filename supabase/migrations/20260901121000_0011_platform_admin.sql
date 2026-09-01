-- =============================================================================
-- 0011 PLATFORM ADMINISTRATION
--
-- A platform admin is staff of the *system*, not a member of any club. They
-- exist outside tenancy: they hold no tenant_membership, yet can administer
-- every club for support and operations.
--
-- This deliberately punches a hole in tenant isolation, so it is built to be
-- narrow, explicit and observable:
--
--   * The grant lives in its own table with NO grants for `authenticated`.
--     It is emphatically NOT a boolean on `profiles` — profiles carries a
--     self-update policy, so a flag there would be self-assignable, which is a
--     straight privilege-escalation hole.
--   * The bypass is folded into the two existing authorization primitives, so
--     there is exactly one place where it takes effect rather than a special
--     case sprayed across ~40 policies.
--   * Every mutation a platform admin makes is audited with
--     actor_type = 'PLATFORM_ADMIN', and entering a club is itself an event.
-- =============================================================================

create table platform_admins (
  user_id     uuid primary key references profiles (id) on delete cascade,
  -- Why this person has system-wide access. Required: an unexplained grant is
  -- a grant nobody can review.
  note        text not null,
  granted_by  uuid references profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references profiles (id) on delete set null
);

create index platform_admins_active_idx on platform_admins (user_id) where revoked_at is null;

comment on table platform_admins is
  'System staff who can administer every club. Managed only by service-role code '
  '(scripts/platform-admin.ts). No client role has any privilege on this table.';

-- No client access whatsoever: reachable only through the security-definer
-- helpers below and through service-role code.
alter table platform_admins enable row level security;
alter table platform_admins force row level security;
revoke all on public.platform_admins from anon, authenticated;

-- -----------------------------------------------------------------------------
-- The predicate.
-- -----------------------------------------------------------------------------
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from platform_admins
     where user_id = (select auth.uid())
       and revoked_at is null
  );
$$;

revoke all on function app.is_platform_admin() from public, anon;
grant execute on function app.is_platform_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Fold the bypass into the two primitives every policy already calls.
--
-- Doing it here rather than in each policy means the bypass cannot drift: a
-- policy added later inherits it automatically, and there is one line to read
-- when auditing what platform admins can reach.
-- -----------------------------------------------------------------------------
create or replace function app.is_tenant_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_platform_admin()
      or exists (
    select 1
      from tenant_memberships m
      join tenants t on t.id = m.tenant_id
     where m.tenant_id = p_tenant
       and m.user_id   = (select auth.uid())
       and m.status    = 'ACTIVE'
       and t.status    = 'ACTIVE'
       and t.deleted_at is null
  );
$$;

create or replace function app.has_permission(p_tenant uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Platform admins hold every permission in every club, by definition.
    when app.is_platform_admin() then true
    else
      app.is_tenant_member(p_tenant)
      and coalesce(
            (select o.effect = 'ALLOW'
               from user_permission_overrides o
              where o.tenant_id      = p_tenant
                and o.user_id        = (select auth.uid())
                and o.permission_key = p_permission),
            (select exists (
               select 1
                 from tenant_memberships m
                 join role_permissions rp on rp.role_id = m.role_id
                where m.tenant_id       = p_tenant
                  and m.user_id         = (select auth.uid())
                  and m.status          = 'ACTIVE'
                  and rp.permission_key = p_permission)),
            false
          )
  end;
$$;

-- The permission matrix must show a platform admin holding everything.
create or replace function public.my_permissions(p_tenant uuid)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when app.is_platform_admin() then p.key else null end
    from permissions p
   where app.is_platform_admin()
  union
  select permission_key
    from app.effective_permissions(p_tenant, null)
   where not app.is_platform_admin()
     and app.is_tenant_member(p_tenant);
$$;

-- -----------------------------------------------------------------------------
-- Client-facing helpers for the admin console.
-- -----------------------------------------------------------------------------
create or replace function public.am_i_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_platform_admin();
$$;

grant execute on function public.am_i_platform_admin() to authenticated;

-- Every club in the system, with the counts the console lists. Returns nothing
-- at all unless the caller is staff — the guard is inside the function, so it
-- cannot be reached by anyone else.
create or replace function public.admin_list_tenants()
returns table (
  id            uuid,
  name          text,
  slug          text,
  timezone      text,
  status        tenant_status,
  created_at    timestamptz,
  deleted_at    timestamptz,
  member_count  bigint,
  team_count    bigint,
  athlete_count bigint,
  season_count  bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, t.slug, t.timezone, t.status, t.created_at, t.deleted_at,
         (select count(*) from tenant_memberships m where m.tenant_id = t.id and m.status = 'ACTIVE'),
         (select count(*) from teams tm where tm.tenant_id = t.id and tm.deleted_at is null),
         (select count(*) from athletes a where a.tenant_id = t.id and a.deleted_at is null),
         (select count(*) from seasons s where s.tenant_id = t.id)
    from tenants t
   where app.is_platform_admin()
   order by t.created_at desc;
$$;

grant execute on function public.admin_list_tenants() to authenticated;

-- -----------------------------------------------------------------------------
-- Club creation.
--
-- Previously a service-role-only operation, which left no way to create the
-- first club from the UI. Platform admins can now do it, transactionally, with
-- an Owner assigned by email. The Owner must already have an account: this
-- creates a membership, never an identity.
-- -----------------------------------------------------------------------------
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
    raise exception 'only platform administrators can create clubs'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_owner_id from profiles where email = lower(btrim(p_owner_email));
  if v_owner_id is null then
    raise exception 'No account exists for %. Invite them first, then create the club.',
      p_owner_email using errcode = 'no_data_found';
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

grant execute on function public.admin_create_tenant(text, text, text, text, text, smallint) to authenticated;
