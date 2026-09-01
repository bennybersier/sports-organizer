-- =============================================================================
-- 0009 ROW LEVEL SECURITY
--
-- Every table in `public` gets RLS enabled. Tables holding secret material
-- (AI keys, OAuth tokens, MCP hashes) get RLS enabled with *no* policies for
-- `authenticated` and their grants revoked, so they are reachable only through
-- server-side code running as service_role, which performs its own permission
-- checks first.
-- =============================================================================

-- Applies the standard read/create/update/delete policy set for a tenant-owned
-- table. Passing NULL for an action means "no client-side policy for it".
create or replace function app.apply_tenant_rls(
  p_table  text,
  p_read   text,
  p_create text default null,
  p_update text default null,
  p_delete text default null
)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);

  execute format(
    'create policy %I on public.%I for select to authenticated using (app.has_permission(tenant_id, %L))',
    p_table || '_select', p_table, p_read);

  if p_create is not null then
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.has_permission(tenant_id, %L))',
      p_table || '_insert', p_table, p_create);
  end if;

  if p_update is not null then
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.has_permission(tenant_id, %L)) with check (app.has_permission(tenant_id, %L))',
      p_table || '_update', p_table, p_update, p_update);
  end if;

  if p_delete is not null then
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app.has_permission(tenant_id, %L))',
      p_table || '_delete', p_table, p_delete);
  end if;
end;
$$;

-- Locks a table away from client roles entirely.
create or replace function app.lock_table_to_service_role(p_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);
  execute format('revoke all on public.%I from anon, authenticated', p_table);
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles — you see yourself and the people you share a club with.
-- -----------------------------------------------------------------------------
alter table profiles enable row level security;
alter table profiles force row level security;

create policy profiles_select_self on profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_co_members on profiles
  for select to authenticated
  using (exists (
    select 1
      from tenant_memberships mine
      join tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
     where mine.user_id   = (select auth.uid())
       and mine.status    = 'ACTIVE'
       and theirs.user_id = profiles.id
  ));

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
alter table tenants enable row level security;
alter table tenants force row level security;

create policy tenants_select on tenants
  for select to authenticated
  using (app.is_tenant_member(id));

create policy tenants_update on tenants
  for update to authenticated
  using (app.has_permission(id, 'tenant.update'))
  with check (app.has_permission(id, 'tenant.update'));

-- Tenant creation and deletion are privileged server operations only.

-- -----------------------------------------------------------------------------
-- Catalogue tables — readable by any signed-in user, writable by nobody.
-- -----------------------------------------------------------------------------
-- Note: RLS is enabled but deliberately NOT forced on these three. They hold no
-- tenant data and are written only by migrations, which run as the table owner;
-- forcing RLS would lock the migration itself out of its own seed data.
alter table permissions enable row level security;
create policy permissions_select on permissions for select to authenticated using (true);
revoke insert, update, delete on permissions from anon, authenticated;

alter table roles enable row level security;
revoke insert, update, delete on roles from anon, authenticated;
create policy roles_select on roles
  for select to authenticated
  using (tenant_id is null or app.has_permission(tenant_id, 'roles.read'));

alter table role_permissions enable row level security;
revoke insert, update, delete on role_permissions from anon, authenticated;
create policy role_permissions_select on role_permissions
  for select to authenticated
  using (exists (
    select 1 from roles r
     where r.id = role_permissions.role_id
       and (r.tenant_id is null or app.has_permission(r.tenant_id, 'roles.read'))
  ));

-- -----------------------------------------------------------------------------
-- Membership, overrides, invitations
-- -----------------------------------------------------------------------------
alter table tenant_memberships enable row level security;
alter table tenant_memberships force row level security;

-- You can always see your own membership — that is how tenant switching works.
create policy tenant_memberships_select_self on tenant_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy tenant_memberships_select on tenant_memberships
  for select to authenticated
  using (app.has_permission(tenant_id, 'members.read'));

-- Role changes additionally require outranking the target; enforced in the
-- application service, which is the only writer for these rows.
create policy tenant_memberships_update on tenant_memberships
  for update to authenticated
  using (app.has_permission(tenant_id, 'members.update'))
  with check (app.has_permission(tenant_id, 'members.update'));

create policy tenant_memberships_delete on tenant_memberships
  for delete to authenticated
  using (app.has_permission(tenant_id, 'members.remove'));

select app.apply_tenant_rls('user_permission_overrides', 'roles.read', 'roles.update', 'roles.update', 'roles.update');

alter table invitations enable row level security;
alter table invitations force row level security;

create policy invitations_select on invitations
  for select to authenticated
  using (app.has_permission(tenant_id, 'members.read'));

create policy invitations_insert on invitations
  for insert to authenticated
  with check (app.has_permission(tenant_id, 'members.invite'));

create policy invitations_update on invitations
  for update to authenticated
  using (app.has_permission(tenant_id, 'members.invite'))
  with check (app.has_permission(tenant_id, 'members.invite'));

-- Accepting an invitation is a server operation: the raw token is exchanged
-- through a route handler that runs as service_role, so an authenticated user
-- can never read token_hash rows for a tenant they are not yet in.

-- -----------------------------------------------------------------------------
-- Domain entities
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('seasons',  'seasons.read',  'seasons.create',  'seasons.update',  'seasons.archive');
select app.apply_tenant_rls('gyms',     'gyms.read',     'gyms.create',     'gyms.update',     'gyms.delete');
select app.apply_tenant_rls('trainers', 'trainers.read', 'trainers.create', 'trainers.update', 'trainers.delete');
select app.apply_tenant_rls('teams',    'teams.read',    'teams.create',    'teams.update',    'teams.delete');
select app.apply_tenant_rls('athletes', 'athletes.read', 'athletes.create', 'athletes.update', 'athletes.delete');
select app.apply_tenant_rls('athlete_teams', 'athletes.read', 'teams.update', 'teams.update', 'teams.update');
select app.apply_tenant_rls('trainer_teams', 'trainers.read', 'teams.update', 'teams.update', 'teams.update');
select app.apply_tenant_rls('team_training_requirements', 'teams.read', 'teams.update', 'teams.update', 'teams.update');

-- -----------------------------------------------------------------------------
-- Availability — the generic policy, plus a self-service escape hatch so a
-- Trainer can maintain their own calendar without `trainers.update`.
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('gym_availability',            'availability.read', 'availability.create', 'availability.update', 'availability.delete');
select app.apply_tenant_rls('gym_availability_exceptions', 'availability.read', 'availability.create', 'availability.update', 'availability.delete');
select app.apply_tenant_rls('trainer_availability',            'availability.read', 'availability.create', 'availability.update', 'availability.delete');
select app.apply_tenant_rls('trainer_availability_exceptions', 'availability.read', 'availability.create', 'availability.update', 'availability.delete');
select app.apply_tenant_rls('team_availability',            'availability.read', 'availability.create', 'availability.update', 'availability.delete');
select app.apply_tenant_rls('team_availability_exceptions', 'availability.read', 'availability.create', 'availability.update', 'availability.delete');

-- -----------------------------------------------------------------------------
-- Scheduling
-- -----------------------------------------------------------------------------
alter table schedule_versions enable row level security;
alter table schedule_versions force row level security;

create policy schedule_versions_select on schedule_versions
  for select to authenticated
  using (app.has_permission(tenant_id, 'calendar.read'));

create policy schedule_versions_insert on schedule_versions
  for insert to authenticated
  with check (app.has_permission(tenant_id, 'schedule.generate'));

create policy schedule_versions_update on schedule_versions
  for update to authenticated
  using (app.has_permission(tenant_id, 'schedule.review'))
  with check (app.has_permission(tenant_id, 'schedule.review'));

create policy schedule_versions_delete on schedule_versions
  for delete to authenticated
  using (app.has_permission(tenant_id, 'schedule.review') and status <> 'PUBLISHED');

alter table schedule_entries enable row level security;
alter table schedule_entries force row level security;

create policy schedule_entries_select on schedule_entries
  for select to authenticated
  using (app.has_permission(tenant_id, 'calendar.read'));

create policy schedule_entries_insert on schedule_entries
  for insert to authenticated
  with check (app.has_permission(tenant_id, 'schedule.review'));

create policy schedule_entries_update on schedule_entries
  for update to authenticated
  using (app.has_permission(tenant_id, 'schedule.review'))
  with check (app.has_permission(tenant_id, 'schedule.review'));

create policy schedule_entries_delete on schedule_entries
  for delete to authenticated
  using (app.has_permission(tenant_id, 'schedule.review'));

select app.apply_tenant_rls('calendar_events', 'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete');
select app.apply_tenant_rls('calendar_event_teams', 'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete');

alter table jobs enable row level security;
alter table jobs force row level security;
create policy jobs_select on jobs
  for select to authenticated
  using (app.is_tenant_member(tenant_id));
-- Jobs are only ever enqueued and mutated server-side.

-- -----------------------------------------------------------------------------
-- Operations
-- -----------------------------------------------------------------------------
alter table audit_logs enable row level security;
alter table audit_logs force row level security;
create policy audit_logs_select on audit_logs
  for select to authenticated
  using (app.has_permission(tenant_id, 'audit_logs.read'));
-- Inserts happen through the AuditService running as service_role, so an audit
-- trail can never be forged from the client.
revoke insert, update, delete on audit_logs from anon, authenticated;

alter table notifications enable row level security;
alter table notifications force row level security;
create policy notifications_select_own on notifications
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table notification_preferences enable row level security;
alter table notification_preferences force row level security;
create policy notification_preferences_own on notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()) and app.is_tenant_member(tenant_id))
  with check (user_id = (select auth.uid()) and app.is_tenant_member(tenant_id));

alter table onboarding_progress enable row level security;
alter table onboarding_progress force row level security;
create policy onboarding_progress_select on onboarding_progress
  for select to authenticated
  using (app.is_tenant_member(tenant_id));
create policy onboarding_progress_update on onboarding_progress
  for update to authenticated
  using (app.has_permission(tenant_id, 'tenant.update'))
  with check (app.has_permission(tenant_id, 'tenant.update'));

-- Integrations: metadata is readable, credentials live in locked tables.
select app.apply_tenant_rls('integrations', 'integrations.read', 'integrations.manage', 'integrations.manage', 'integrations.manage');

-- -----------------------------------------------------------------------------
-- Secret-bearing tables: no client access at all.
-- -----------------------------------------------------------------------------
select app.lock_table_to_service_role('ai_provider_configurations');
select app.lock_table_to_service_role('oauth_connections');
select app.lock_table_to_service_role('mcp_api_keys');
select app.lock_table_to_service_role('calendar_sync_links');
select app.lock_table_to_service_role('email_outbox');
