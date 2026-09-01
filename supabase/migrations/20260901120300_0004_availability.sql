-- =============================================================================
-- 0004 AVAILABILITY & TRAINING REQUIREMENTS
--
-- Availability is modelled as recurring weekly windows plus date-specific
-- exceptions. Weekdays are ISO-8601: 1 = Monday .. 7 = Sunday, matching
-- `extract(isodow from ...)`.
--
-- Times are wall-clock in the tenant's scheduling timezone. A window that runs
-- to midnight uses end_time = '24:00'. A window that genuinely crosses midnight
-- is stored as two rows (one per weekday), so every row satisfies start < end.
--
-- Overlapping windows for the same owner/weekday/validity period are rejected
-- by exclusion constraints — contradictory availability never reaches the
-- scheduling engine.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- gym_availability
-- -----------------------------------------------------------------------------
create table gym_availability (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  gym_id       uuid not null references gyms (id) on delete cascade,
  -- NULL = applies to every season.
  season_id    uuid references seasons (id) on delete cascade,
  iso_weekday  smallint not null check (iso_weekday between 1 and 7),
  start_time   time not null,
  end_time     time not null,
  valid_from   date not null default current_date,
  valid_until  date,
  note         text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint gym_availability_time_order check (end_time > start_time),
  constraint gym_availability_end_bound  check (end_time <= time '24:00'),
  constraint gym_availability_date_order check (valid_until is null or valid_until >= valid_from),
  exclude using gist (
    gym_id with =,
    iso_weekday with =,
    timerange(start_time, end_time, '[)') with &&,
    daterange(valid_from, valid_until, '[]') with &&
  )
);
create index gym_availability_lookup_idx on gym_availability (tenant_id, gym_id, iso_weekday);
create index gym_availability_season_idx on gym_availability (season_id) where season_id is not null;
select app.attach_touch_trigger('gym_availability');

create trigger trg_gym_availability_tenant
  before insert or update of gym_id, tenant_id on gym_availability
  for each row execute function app.assert_same_tenant('gyms', 'gym_id');

create table gym_availability_exceptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  gym_id       uuid not null references gyms (id) on delete cascade,
  exception_date date not null,
  -- NULL start/end = the whole day.
  start_time   time,
  end_time     time,
  type         availability_exception_type not null,
  reason       text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint gym_exc_time_pair  check ((start_time is null) = (end_time is null)),
  constraint gym_exc_time_order check (start_time is null or (end_time > start_time and end_time <= time '24:00'))
);
create index gym_availability_exceptions_lookup_idx on gym_availability_exceptions (tenant_id, gym_id, exception_date);
select app.attach_touch_trigger('gym_availability_exceptions');

create trigger trg_gym_exceptions_tenant
  before insert or update of gym_id, tenant_id on gym_availability_exceptions
  for each row execute function app.assert_same_tenant('gyms', 'gym_id');

-- -----------------------------------------------------------------------------
-- trainer_availability
-- -----------------------------------------------------------------------------
create table trainer_availability (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  trainer_id   uuid not null references trainers (id) on delete cascade,
  season_id    uuid references seasons (id) on delete cascade,
  iso_weekday  smallint not null check (iso_weekday between 1 and 7),
  start_time   time not null,
  end_time     time not null,
  valid_from   date not null default current_date,
  valid_until  date,
  note         text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trainer_availability_time_order check (end_time > start_time),
  constraint trainer_availability_end_bound  check (end_time <= time '24:00'),
  constraint trainer_availability_date_order check (valid_until is null or valid_until >= valid_from),
  exclude using gist (
    trainer_id with =,
    iso_weekday with =,
    timerange(start_time, end_time, '[)') with &&,
    daterange(valid_from, valid_until, '[]') with &&
  )
);
create index trainer_availability_lookup_idx on trainer_availability (tenant_id, trainer_id, iso_weekday);
create index trainer_availability_season_idx on trainer_availability (season_id) where season_id is not null;
select app.attach_touch_trigger('trainer_availability');

create trigger trg_trainer_availability_tenant
  before insert or update of trainer_id, tenant_id on trainer_availability
  for each row execute function app.assert_same_tenant('trainers', 'trainer_id');

create table trainer_availability_exceptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  trainer_id   uuid not null references trainers (id) on delete cascade,
  exception_date date not null,
  start_time   time,
  end_time     time,
  type         availability_exception_type not null,
  reason       text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trainer_exc_time_pair  check ((start_time is null) = (end_time is null)),
  constraint trainer_exc_time_order check (start_time is null or (end_time > start_time and end_time <= time '24:00'))
);
create index trainer_availability_exceptions_lookup_idx on trainer_availability_exceptions (tenant_id, trainer_id, exception_date);
select app.attach_touch_trigger('trainer_availability_exceptions');

create trigger trg_trainer_exceptions_tenant
  before insert or update of trainer_id, tenant_id on trainer_availability_exceptions
  for each row execute function app.assert_same_tenant('trainers', 'trainer_id');

-- -----------------------------------------------------------------------------
-- team_availability — windows in which a team is willing/able to train.
-- -----------------------------------------------------------------------------
create table team_availability (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  team_id      uuid not null references teams (id) on delete cascade,
  iso_weekday  smallint not null check (iso_weekday between 1 and 7),
  start_time   time not null,
  end_time     time not null,
  valid_from   date not null default current_date,
  valid_until  date,
  note         text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint team_availability_time_order check (end_time > start_time),
  constraint team_availability_end_bound  check (end_time <= time '24:00'),
  constraint team_availability_date_order check (valid_until is null or valid_until >= valid_from),
  exclude using gist (
    team_id with =,
    iso_weekday with =,
    timerange(start_time, end_time, '[)') with &&,
    daterange(valid_from, valid_until, '[]') with &&
  )
);
create index team_availability_lookup_idx on team_availability (tenant_id, team_id, iso_weekday);
select app.attach_touch_trigger('team_availability');

create trigger trg_team_availability_tenant
  before insert or update of team_id, tenant_id on team_availability
  for each row execute function app.assert_same_tenant('teams', 'team_id');

create table team_availability_exceptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  team_id      uuid not null references teams (id) on delete cascade,
  exception_date date not null,
  start_time   time,
  end_time     time,
  type         availability_exception_type not null,
  reason       text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint team_exc_time_pair  check ((start_time is null) = (end_time is null)),
  constraint team_exc_time_order check (start_time is null or (end_time > start_time and end_time <= time '24:00'))
);
create index team_availability_exceptions_lookup_idx on team_availability_exceptions (tenant_id, team_id, exception_date);
select app.attach_touch_trigger('team_availability_exceptions');

create trigger trg_team_exceptions_tenant
  before insert or update of team_id, tenant_id on team_availability_exceptions
  for each row execute function app.assert_same_tenant('teams', 'team_id');

-- -----------------------------------------------------------------------------
-- team_training_requirements — what the optimizer must satisfy per team.
-- One row per team per season.
-- -----------------------------------------------------------------------------
create table team_training_requirements (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  team_id             uuid not null references teams (id) on delete cascade,
  season_id           uuid not null references seasons (id) on delete cascade,

  -- Hard requirements
  sessions_per_week   smallint not null default 2 check (sessions_per_week between 0 and 14),
  duration_minutes    smallint not null default 90 check (duration_minutes between 15 and 480),
  -- ISO weekdays the team may train on at all. Empty = any weekday.
  allowed_weekdays    smallint[] not null default '{}',
  earliest_start      time not null default time '08:00',
  latest_end          time not null default time '22:30',
  -- Minimum whole days between two sessions (0 = same day allowed).
  min_days_between    smallint not null default 1 check (min_days_between between 0 and 7),
  max_days_between    smallint check (max_days_between is null or max_days_between between 1 and 14),
  -- Gyms the team is physically able to use. Empty = any gym.
  allowed_gym_ids     uuid[] not null default '{}',

  -- Soft preferences
  preferred_weekdays  smallint[] not null default '{}',
  preferred_start     time,
  preferred_end       time,
  preferred_gym_ids   uuid[] not null default '{}',
  -- Per-team weight overrides for the soft-constraint scorer.
  preference_weights  jsonb not null default '{}'::jsonb,
  notes               text,

  created_by          uuid references profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ttr_time_window   check (latest_end > earliest_start),
  constraint ttr_pref_window   check (preferred_end is null or preferred_start is null or preferred_end > preferred_start),
  constraint ttr_gap_order     check (max_days_between is null or max_days_between >= min_days_between),
  constraint ttr_allowed_days  check (allowed_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint ttr_pref_days     check (preferred_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  -- The session must physically fit inside the allowed daily window.
  constraint ttr_duration_fits check (
    duration_minutes <= extract(epoch from (latest_end - earliest_start)) / 60
  ),
  unique (team_id, season_id)
);
create index ttr_tenant_season_idx on team_training_requirements (tenant_id, season_id);
select app.attach_touch_trigger('team_training_requirements');

create trigger trg_ttr_team_tenant
  before insert or update of team_id, tenant_id on team_training_requirements
  for each row execute function app.assert_same_tenant('teams', 'team_id');
create trigger trg_ttr_season_tenant
  before insert or update of season_id, tenant_id on team_training_requirements
  for each row execute function app.assert_same_tenant('seasons', 'season_id');
