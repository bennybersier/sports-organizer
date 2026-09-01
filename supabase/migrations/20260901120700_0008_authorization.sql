-- =============================================================================
-- 0008 AUTHORIZATION FUNCTIONS
--
-- These are the primitives every RLS policy is built from. They are
-- SECURITY DEFINER so a policy on tenant_memberships can itself read
-- tenant_memberships without recursing through RLS.
--
-- Resolution order, matching the application-side PermissionService exactly:
--     explicit user override  >  role permission  >  deny
-- =============================================================================

-- True when the caller has an active membership in an active tenant.
create or replace function app.is_tenant_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
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

-- The single permission predicate. Never called with a client-supplied tenant
-- id on the application side; RLS calls it with the row's own tenant_id.
create or replace function app.has_permission(p_tenant uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_tenant_member(p_tenant)
     and coalesce(
           -- 1. Explicit per-user override wins, in both directions.
           (select o.effect = 'ALLOW'
              from user_permission_overrides o
             where o.tenant_id      = p_tenant
               and o.user_id        = (select auth.uid())
               and o.permission_key = p_permission),
           -- 2. Otherwise the role's default permissions.
           (select exists (
              select 1
                from tenant_memberships m
                join role_permissions rp on rp.role_id = m.role_id
               where m.tenant_id      = p_tenant
                 and m.user_id        = (select auth.uid())
                 and m.status         = 'ACTIVE'
                 and rp.permission_key = p_permission)),
           -- 3. Deny by default.
           false
         );
$$;

-- Every permission the caller effectively holds in a tenant. Used by the app to
-- hydrate the session once per request instead of probing permission by
-- permission, and to render the permission matrix.
create or replace function app.effective_permissions(p_tenant uuid, p_user uuid default null)
returns table (permission_key text, source text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with target as (
    select coalesce(p_user, (select auth.uid())) as user_id
  ),
  role_perms as (
    select rp.permission_key
      from tenant_memberships m
      join role_permissions rp on rp.role_id = m.role_id
      cross join target
     where m.tenant_id = p_tenant
       and m.user_id   = target.user_id
       and m.status    = 'ACTIVE'
  ),
  overrides as (
    select o.permission_key, o.effect
      from user_permission_overrides o
      cross join target
     where o.tenant_id = p_tenant
       and o.user_id   = target.user_id
  )
  select p.key,
         case when ov.effect is not null then 'OVERRIDE' else 'ROLE' end
    from permissions p
    left join overrides ov on ov.permission_key = p.key
   where coalesce(ov.effect = 'ALLOW', p.key in (select permission_key from role_perms));
$$;

-- The caller's role rank in a tenant (lower = more privileged). NULL if not a
-- member. Used to stop a user editing a member who outranks them.
create or replace function app.role_rank(p_tenant uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.rank
    from tenant_memberships m
    join roles r on r.id = m.role_id
   where m.tenant_id = p_tenant
     and m.user_id   = (select auth.uid())
     and m.status    = 'ACTIVE';
$$;

-- Trainer rows belonging to the caller. Lets a Trainer edit their own
-- availability without being able to touch anyone else's.
create or replace function app.owns_trainer(p_trainer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from trainers t
     where t.id = p_trainer
       and t.user_id = (select auth.uid())
  );
$$;

revoke all on function app.is_tenant_member(uuid) from public, anon;
revoke all on function app.has_permission(uuid, text) from public, anon;
revoke all on function app.effective_permissions(uuid, uuid) from public, anon;
revoke all on function app.role_rank(uuid) from public, anon;
revoke all on function app.owns_trainer(uuid) from public, anon;

grant execute on function app.is_tenant_member(uuid) to authenticated;
grant execute on function app.has_permission(uuid, text) to authenticated;
grant execute on function app.effective_permissions(uuid, uuid) to authenticated;
grant execute on function app.role_rank(uuid) to authenticated;
grant execute on function app.owns_trainer(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Thin public wrappers so the browser client can hydrate its session.
-- They take no client-controlled shortcut: membership is re-resolved from
-- auth.uid() every call.
-- -----------------------------------------------------------------------------
create or replace function public.my_memberships()
returns table (
  tenant_id   uuid,
  tenant_name text,
  tenant_slug text,
  tenant_timezone text,
  role_key    text,
  role_name   text,
  role_rank   int,
  status      membership_status
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, t.slug, t.timezone, r.key, r.name, r.rank, m.status
    from tenant_memberships m
    join tenants t on t.id = m.tenant_id
    join roles   r on r.id = m.role_id
   where m.user_id = (select auth.uid())
     and m.status  = 'ACTIVE'
     and t.status  = 'ACTIVE'
     and t.deleted_at is null
   order by t.name;
$$;

grant execute on function public.my_memberships() to authenticated;

create or replace function public.my_permissions(p_tenant uuid)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select permission_key from app.effective_permissions(p_tenant, null)
   where app.is_tenant_member(p_tenant);
$$;

grant execute on function public.my_permissions(uuid) to authenticated;
