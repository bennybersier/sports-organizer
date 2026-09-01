-- =============================================================================
-- 0007 PERMISSION TAXONOMY & SYSTEM ROLES
--
-- This migration is the single source of truth for the permission catalogue and
-- the default role -> permission matrix. It is written to be re-runnable: adding
-- a permission here and re-applying updates existing installations.
-- =============================================================================

insert into permissions (key, resource, action, description, category, sort_order) values
  ('tenant.read',        'tenant',      'read',    'View club profile and settings',            'Club',        10),
  ('tenant.update',      'tenant',      'update',  'Edit club profile and settings',            'Club',        20),
  ('tenant.delete',      'tenant',      'delete',  'Permanently delete the club',               'Club',        30),

  ('members.read',       'members',     'read',    'View club members',                         'People',      10),
  ('members.invite',     'members',     'invite',  'Invite new members',                        'People',      20),
  ('members.update',     'members',     'update',  'Change a member''s role',                   'People',      30),
  ('members.remove',     'members',     'remove',  'Remove a member from the club',             'People',      40),

  ('roles.read',         'roles',       'read',    'View roles and permissions',                'People',      50),
  ('roles.update',       'roles',       'update',  'Change role permissions and user overrides','People',      60),

  ('seasons.read',       'seasons',     'read',    'View seasons',                              'Seasons',     10),
  ('seasons.create',     'seasons',     'create',  'Create seasons',                            'Seasons',     20),
  ('seasons.update',     'seasons',     'update',  'Edit seasons',                              'Seasons',     30),
  ('seasons.archive',    'seasons',     'archive', 'Archive seasons',                           'Seasons',     40),

  ('teams.read',         'teams',       'read',    'View teams',                                'Teams',       10),
  ('teams.create',       'teams',       'create',  'Create teams',                              'Teams',       20),
  ('teams.update',       'teams',       'update',  'Edit teams and assignments',                'Teams',       30),
  ('teams.delete',       'teams',       'delete',  'Archive or delete teams',                   'Teams',       40),

  ('athletes.read',      'athletes',    'read',    'View athletes',                             'Athletes',    10),
  ('athletes.create',    'athletes',    'create',  'Add athletes',                              'Athletes',    20),
  ('athletes.update',    'athletes',    'update',  'Edit athletes',                             'Athletes',    30),
  ('athletes.delete',    'athletes',    'delete',  'Archive or delete athletes',                'Athletes',    40),

  ('trainers.read',      'trainers',    'read',    'View trainers',                             'Trainers',    10),
  ('trainers.create',    'trainers',    'create',  'Add trainers',                              'Trainers',    20),
  ('trainers.update',    'trainers',    'update',  'Edit trainers',                             'Trainers',    30),
  ('trainers.delete',    'trainers',    'delete',  'Archive or delete trainers',                'Trainers',    40),

  ('gyms.read',          'gyms',        'read',    'View gyms',                                 'Gyms',        10),
  ('gyms.create',        'gyms',        'create',  'Add gyms',                                  'Gyms',        20),
  ('gyms.update',        'gyms',        'update',  'Edit gyms',                                 'Gyms',        30),
  ('gyms.delete',        'gyms',        'delete',  'Archive or delete gyms',                    'Gyms',        40),

  ('availability.read',  'availability','read',    'View availability',                         'Availability',10),
  ('availability.create','availability','create',  'Add availability and exceptions',           'Availability',20),
  ('availability.update','availability','update',  'Edit availability and exceptions',          'Availability',30),
  ('availability.delete','availability','delete',  'Delete availability and exceptions',        'Availability',40),

  ('calendar.read',      'calendar',    'read',    'View the calendar',                         'Calendar',    10),
  ('calendar.create',    'calendar',    'create',  'Create calendar events',                    'Calendar',    20),
  ('calendar.update',    'calendar',    'update',  'Move, resize and edit events',              'Calendar',    30),
  ('calendar.delete',    'calendar',    'delete',  'Cancel or delete events',                   'Calendar',    40),

  ('schedule.generate',  'schedule',    'generate','Run the smart organizer',                   'Scheduling',  10),
  ('schedule.review',    'schedule',    'review',  'Review and adjust draft schedules',         'Scheduling',  20),
  ('schedule.publish',   'schedule',    'publish', 'Publish a schedule to the club',            'Scheduling',  30),

  ('integrations.read',  'integrations','read',    'View integrations',                         'Integrations',10),
  ('integrations.manage','integrations','manage',  'Connect and configure integrations',        'Integrations',20),

  ('ai.read',            'ai',          'read',    'View AI configuration',                     'Integrations',30),
  ('ai.manage',          'ai',          'manage',  'Configure AI providers and keys',           'Integrations',40),

  ('mcp.manage',         'mcp',         'manage',  'Create and revoke MCP API keys',            'Integrations',50),

  ('audit_logs.read',    'audit_logs',  'read',    'View the audit log',                        'Security',    10)
on conflict (key) do update
  set resource = excluded.resource,
      action = excluded.action,
      description = excluded.description,
      category = excluded.category,
      sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- System roles. Lower rank = more privileged; a user can never grant or edit a
-- role at or above their own rank (enforced in the authorization service).
-- -----------------------------------------------------------------------------
insert into roles (key, name, description, is_system, rank, tenant_id) values
  ('OWNER',        'Owner',        'Full control of the club, including deletion.',                 true,  0,  null),
  ('ADMIN',        'Admin',        'Manages everything day to day except deleting the club.',        true, 10,  null),
  ('ORGANIZER',    'Organizer',    'Runs seasons, schedules and the club roster.',                   true, 20,  null),
  ('TRAINER',      'Trainer',      'Manages their own availability and views their teams.',          true, 30,  null),
  ('TEAM_MANAGER', 'Team Manager', 'Looks after a team roster and reads the schedule.',              true, 40,  null),
  ('ATHLETE',      'Athlete',      'Sees their own teams and training schedule.',                    true, 50,  null)
on conflict (tenant_id, key) do update
  set name = excluded.name,
      description = excluded.description,
      rank = excluded.rank;

-- -----------------------------------------------------------------------------
-- Default role -> permission matrix.
-- -----------------------------------------------------------------------------
create or replace function app.grant_role_permissions(p_role_key text, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id uuid;
begin
  select id into v_role_id from roles where key = p_role_key and tenant_id is null;
  if v_role_id is null then
    raise exception 'system role % not found', p_role_key;
  end if;

  delete from role_permissions
   where role_id = v_role_id
     and permission_key <> all (p_permissions);

  insert into role_permissions (role_id, permission_key)
  select v_role_id, unnest(p_permissions)
  on conflict do nothing;
end;
$$;

do $$
declare
  v_all text[];
begin
  select array_agg(key order by key) into v_all from permissions;

  -- Owner: everything.
  perform app.grant_role_permissions('OWNER', v_all);

  -- Admin: everything except destroying the club.
  perform app.grant_role_permissions('ADMIN', array_remove(v_all, 'tenant.delete'));

  -- Organizer: the full operational surface, but not security or billing-adjacent
  -- settings (roles, member management, integrations, AI keys, MCP).
  perform app.grant_role_permissions('ORGANIZER', array[
    'tenant.read',
    'members.read',
    'roles.read',
    'seasons.read', 'seasons.create', 'seasons.update', 'seasons.archive',
    'teams.read', 'teams.create', 'teams.update', 'teams.delete',
    'athletes.read', 'athletes.create', 'athletes.update', 'athletes.delete',
    'trainers.read', 'trainers.create', 'trainers.update', 'trainers.delete',
    'gyms.read', 'gyms.create', 'gyms.update', 'gyms.delete',
    'availability.read', 'availability.create', 'availability.update', 'availability.delete',
    'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete',
    'schedule.generate', 'schedule.review', 'schedule.publish',
    'integrations.read', 'ai.read',
    'audit_logs.read'
  ]);

  -- Trainer: reads the club, maintains availability (own rows only, narrowed
  -- further by RLS), and cannot change the schedule.
  perform app.grant_role_permissions('TRAINER', array[
    'tenant.read',
    'seasons.read',
    'teams.read',
    'athletes.read',
    'trainers.read',
    'gyms.read',
    'availability.read', 'availability.create', 'availability.update', 'availability.delete',
    'calendar.read'
  ]);

  -- Team Manager: looks after a roster.
  perform app.grant_role_permissions('TEAM_MANAGER', array[
    'tenant.read',
    'seasons.read',
    'teams.read',
    'athletes.read', 'athletes.create', 'athletes.update',
    'trainers.read',
    'gyms.read',
    'availability.read',
    'calendar.read'
  ]);

  -- Athlete: read-only view of their club life.
  perform app.grant_role_permissions('ATHLETE', array[
    'tenant.read',
    'seasons.read',
    'teams.read',
    'calendar.read'
  ]);
end;
$$;
