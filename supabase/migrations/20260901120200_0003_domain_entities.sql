-- =============================================================================
-- 0003 DOMAIN ENTITIES
-- seasons, gyms, trainers, teams, athletes and their relationships.
-- Every table carries tenant_id directly so RLS is a single uniform predicate.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- seasons — e.g. "2026/2027". First-class: teams and schedules hang off one.
-- -----------------------------------------------------------------------------
create table seasons (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 100),
  start_date   date not null,
  end_date     date not null,
  status       season_status not null default 'DRAFT',
  description  text,
  -- Scheduling defaults for this season (weights, day window, ...).
  config       jsonb not null default '{}'::jsonb,
  -- Set when this season was created by duplicating another.
  copied_from_season_id uuid references seasons (id) on delete set null,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint seasons_date_order check (end_date > start_date)
);
create unique index seasons_tenant_name_uniq on seasons (tenant_id, lower(name));
-- At most one ACTIVE season per tenant.
create unique index seasons_one_active_per_tenant on seasons (tenant_id) where status = 'ACTIVE';
create index seasons_tenant_status_idx on seasons (tenant_id, status);
create index seasons_tenant_dates_idx on seasons (tenant_id, start_date, end_date);
select app.attach_touch_trigger('seasons');

-- -----------------------------------------------------------------------------
-- gyms — physical training locations.
-- -----------------------------------------------------------------------------
create table gyms (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 150),
  description  text,
  address_line1 text,
  address_line2 text,
  postal_code  text,
  city         text,
  country      text,
  capacity     int check (capacity is null or capacity > 0),
  -- Sports this hall can host; used to filter candidate gyms for a team.
  sport_types  text[] not null default '{}',
  equipment    text[] not null default '{}',
  color        text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  notes        text,
  status       entity_status not null default 'ACTIVE',
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index gyms_tenant_name_uniq on gyms (tenant_id, lower(name)) where deleted_at is null;
create index gyms_tenant_status_idx on gyms (tenant_id, status) where deleted_at is null;
create index gyms_sport_types_idx on gyms using gin (sport_types);
select app.attach_touch_trigger('gyms');

-- -----------------------------------------------------------------------------
-- trainers — coaching staff. Optionally linked to a login account.
-- -----------------------------------------------------------------------------
create table trainers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  -- A trainer may exist without ever logging in.
  user_id      uuid references profiles (id) on delete set null,
  first_name   text not null check (length(btrim(first_name)) between 1 and 100),
  last_name    text not null check (length(btrim(last_name)) between 1 and 100),
  email        text check (email is null or email = lower(email)),
  phone        text,
  qualifications text[] not null default '{}',
  color        text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  notes        text,
  status       entity_status not null default 'ACTIVE',
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index trainers_tenant_email_uniq on trainers (tenant_id, email) where email is not null and deleted_at is null;
create unique index trainers_tenant_user_uniq on trainers (tenant_id, user_id) where user_id is not null and deleted_at is null;
create index trainers_tenant_status_idx on trainers (tenant_id, status) where deleted_at is null;
create index trainers_name_idx on trainers (tenant_id, last_name, first_name);
select app.attach_touch_trigger('trainers');

-- -----------------------------------------------------------------------------
-- teams — scoped to a season, since squads are rebuilt every year.
-- -----------------------------------------------------------------------------
create table teams (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  season_id    uuid not null references seasons (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 150),
  sport        text not null,
  category     text,
  age_group    text,
  gender       gender_category not null default 'UNSPECIFIED',
  color        text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  notes        text,
  status       entity_status not null default 'ACTIVE',
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index teams_season_name_uniq on teams (season_id, lower(name)) where deleted_at is null;
create index teams_tenant_season_idx on teams (tenant_id, season_id) where deleted_at is null;
create index teams_tenant_status_idx on teams (tenant_id, status) where deleted_at is null;
create index teams_sport_idx on teams (tenant_id, sport);
select app.attach_touch_trigger('teams');

-- A team's season must belong to the same tenant as the team.
create or replace function app.assert_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_tenant uuid;
  v_sql text;
begin
  v_sql := format('select tenant_id from %I where id = $1', tg_argv[0]);
  execute v_sql into v_parent_tenant using (to_jsonb(new) ->> tg_argv[1])::uuid;
  if v_parent_tenant is null then
    raise exception 'referenced % row not found', tg_argv[0] using errcode = 'foreign_key_violation';
  end if;
  if v_parent_tenant <> new.tenant_id then
    raise exception 'cross-tenant reference: %.% points at another tenant', tg_table_name, tg_argv[1]
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_teams_season_tenant
  before insert or update of season_id, tenant_id on teams
  for each row execute function app.assert_same_tenant('seasons', 'season_id');

-- -----------------------------------------------------------------------------
-- athletes — club members. Season-independent; team links carry the season.
-- -----------------------------------------------------------------------------
create table athletes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  user_id      uuid references profiles (id) on delete set null,
  first_name   text not null check (length(btrim(first_name)) between 1 and 100),
  last_name    text not null check (length(btrim(last_name)) between 1 and 100),
  date_of_birth date,
  gender       gender_category not null default 'UNSPECIFIED',
  email        text check (email is null or email = lower(email)),
  phone        text,
  address_line1 text,
  address_line2 text,
  postal_code  text,
  city         text,
  country      text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  membership_status membership_state not null default 'ACTIVE',
  notes        text,
  -- Club-specific extra fields without a migration per club.
  metadata     jsonb not null default '{}'::jsonb,
  status       entity_status not null default 'ACTIVE',
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint athletes_dob_sane check (date_of_birth is null or (date_of_birth > date '1900-01-01' and date_of_birth <= current_date))
);
create unique index athletes_tenant_email_uniq on athletes (tenant_id, email) where email is not null and deleted_at is null;
create index athletes_tenant_status_idx on athletes (tenant_id, status) where deleted_at is null;
create index athletes_name_idx on athletes (tenant_id, last_name, first_name);
create index athletes_user_idx on athletes (user_id) where user_id is not null;
select app.attach_touch_trigger('athletes');

-- -----------------------------------------------------------------------------
-- athlete_teams — many-to-many, with history preserved via left_at.
-- -----------------------------------------------------------------------------
create table athlete_teams (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  athlete_id   uuid not null references athletes (id) on delete cascade,
  team_id      uuid not null references teams (id) on delete cascade,
  jersey_number int check (jersey_number is null or jersey_number between 0 and 999),
  position     text,
  joined_at    date not null default current_date,
  left_at      date,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint athlete_teams_date_order check (left_at is null or left_at >= joined_at)
);
-- One *current* membership per athlete/team pair; historical rows may repeat.
create unique index athlete_teams_current_uniq on athlete_teams (athlete_id, team_id) where left_at is null;
create index athlete_teams_team_idx on athlete_teams (team_id) where left_at is null;
create index athlete_teams_athlete_idx on athlete_teams (athlete_id);
create index athlete_teams_tenant_idx on athlete_teams (tenant_id);
select app.attach_touch_trigger('athlete_teams');

create trigger trg_athlete_teams_athlete_tenant
  before insert or update of athlete_id, tenant_id on athlete_teams
  for each row execute function app.assert_same_tenant('athletes', 'athlete_id');
create trigger trg_athlete_teams_team_tenant
  before insert or update of team_id, tenant_id on athlete_teams
  for each row execute function app.assert_same_tenant('teams', 'team_id');

-- -----------------------------------------------------------------------------
-- trainer_teams — many-to-many, with a designated head coach per team.
-- -----------------------------------------------------------------------------
create table trainer_teams (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  trainer_id   uuid not null references trainers (id) on delete cascade,
  team_id      uuid not null references teams (id) on delete cascade,
  is_head_coach boolean not null default false,
  assigned_at  date not null default current_date,
  unassigned_at date,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trainer_teams_date_order check (unassigned_at is null or unassigned_at >= assigned_at)
);
create unique index trainer_teams_current_uniq on trainer_teams (trainer_id, team_id) where unassigned_at is null;
create unique index trainer_teams_one_head_coach on trainer_teams (team_id) where is_head_coach and unassigned_at is null;
create index trainer_teams_team_idx on trainer_teams (team_id) where unassigned_at is null;
create index trainer_teams_trainer_idx on trainer_teams (trainer_id);
create index trainer_teams_tenant_idx on trainer_teams (tenant_id);
select app.attach_touch_trigger('trainer_teams');

create trigger trg_trainer_teams_trainer_tenant
  before insert or update of trainer_id, tenant_id on trainer_teams
  for each row execute function app.assert_same_tenant('trainers', 'trainer_id');
create trigger trg_trainer_teams_team_tenant
  before insert or update of team_id, tenant_id on trainer_teams
  for each row execute function app.assert_same_tenant('teams', 'team_id');
