-- =============================================================================
-- 0005 SCHEDULING
--
-- A generated schedule never touches the published one. Every training entry
-- belongs to a schedule_version; publishing promotes one version and archives
-- the previous, transactionally.
--
-- Non-training events (matches, tournaments, holidays, hall closures, in-house
-- events with several teams) live in calendar_events, which is deliberately
-- separate: those may legitimately put multiple teams in one gym, which the
-- optimizer must never do on its own.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- schedule_versions
-- -----------------------------------------------------------------------------
create table schedule_versions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  season_id      uuid not null references seasons (id) on delete cascade,
  -- Monotonic per season; assigned by trigger.
  version_number int not null,
  name           text,
  status         schedule_version_status not null default 'DRAFT',
  -- The exact optimizer input/config used, so a run is reproducible.
  generation_config jsonb not null default '{}'::jsonb,
  -- Summary produced by the engine: score, unmet requirements, warnings.
  result_summary jsonb not null default '{}'::jsonb,
  -- Seed used by the optimizer's tie-breaking, for reproducible reruns.
  random_seed    bigint,
  error_message  text,
  -- The window this schedule covers (defaults to the season window).
  applies_from   date not null,
  applies_until  date not null,
  based_on_version_id uuid references schedule_versions (id) on delete set null,
  generated_at   timestamptz,
  published_at   timestamptz,
  published_by   uuid references profiles (id) on delete set null,
  archived_at    timestamptz,
  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint schedule_versions_window check (applies_until >= applies_from),
  -- A published version keeps published_at once archived, so this is an
  -- implication rather than an equivalence.
  constraint schedule_versions_published_fields check (
    status <> 'PUBLISHED' or published_at is not null
  ),
  unique (season_id, version_number)
);
-- Exactly one published version per season at a time.
create unique index schedule_versions_one_published on schedule_versions (season_id) where status = 'PUBLISHED';
create index schedule_versions_tenant_idx on schedule_versions (tenant_id, season_id, status);
create index schedule_versions_created_idx on schedule_versions (tenant_id, created_at desc);
select app.attach_touch_trigger('schedule_versions');

create trigger trg_schedule_versions_season_tenant
  before insert or update of season_id, tenant_id on schedule_versions
  for each row execute function app.assert_same_tenant('seasons', 'season_id');

create or replace function app.assign_schedule_version_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.version_number is null then
    select coalesce(max(version_number), 0) + 1
      into new.version_number
      from schedule_versions
     where season_id = new.season_id;
  end if;
  return new;
end;
$$;

create trigger trg_schedule_versions_number
  before insert on schedule_versions
  for each row execute function app.assign_schedule_version_number();

-- -----------------------------------------------------------------------------
-- schedule_entries — one training session: one team, one trainer, one gym.
-- -----------------------------------------------------------------------------
create table schedule_entries (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  season_id           uuid not null references seasons (id) on delete cascade,
  schedule_version_id uuid not null references schedule_versions (id) on delete cascade,
  team_id             uuid not null references teams (id) on delete cascade,
  -- A slot may be provisionally unstaffed while an organizer resolves conflicts.
  trainer_id          uuid references trainers (id) on delete set null,
  gym_id              uuid not null references gyms (id) on delete restrict,

  start_at            timestamptz not null,
  end_at              timestamptz not null,
  status              schedule_entry_status not null default 'PROPOSED',

  -- Why the optimizer chose this slot: satisfied constraints, score, trade-offs.
  -- Surfaced verbatim in the "Why this slot?" panel.
  explanation         jsonb not null default '{}'::jsonb,
  score               numeric(6,2),
  -- Set when a human moved this entry away from the optimizer's choice.
  manually_adjusted   boolean not null default false,
  validation_state    validation_state not null default 'VALID',
  validation_details  jsonb not null default '{}'::jsonb,
  notes               text,

  created_by          uuid references profiles (id) on delete set null,
  updated_by          uuid references profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint schedule_entries_time_order check (end_at > start_at),
  constraint schedule_entries_duration   check (end_at - start_at <= interval '12 hours'),

  -- Hard invariants, enforced per version so drafts never collide with the
  -- published schedule: one team per gym per slot, one trainer at a time,
  -- one team in one place at a time.
  exclude using gist (
    schedule_version_id with =, gym_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status <> 'CANCELLED'),
  exclude using gist (
    schedule_version_id with =, trainer_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status <> 'CANCELLED' and trainer_id is not null),
  exclude using gist (
    schedule_version_id with =, team_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status <> 'CANCELLED')
);
create index schedule_entries_version_idx on schedule_entries (schedule_version_id, start_at);
create index schedule_entries_tenant_window_idx on schedule_entries (tenant_id, start_at, end_at);
create index schedule_entries_team_idx on schedule_entries (team_id, start_at);
create index schedule_entries_trainer_idx on schedule_entries (trainer_id, start_at) where trainer_id is not null;
create index schedule_entries_gym_idx on schedule_entries (gym_id, start_at);
create index schedule_entries_season_status_idx on schedule_entries (season_id, status);
select app.attach_touch_trigger('schedule_entries');

create trigger trg_schedule_entries_team_tenant
  before insert or update of team_id, tenant_id on schedule_entries
  for each row execute function app.assert_same_tenant('teams', 'team_id');
create trigger trg_schedule_entries_gym_tenant
  before insert or update of gym_id, tenant_id on schedule_entries
  for each row execute function app.assert_same_tenant('gyms', 'gym_id');
create trigger trg_schedule_entries_version_tenant
  before insert or update of schedule_version_id, tenant_id on schedule_entries
  for each row execute function app.assert_same_tenant('schedule_versions', 'schedule_version_id');

-- -----------------------------------------------------------------------------
-- calendar_events — everything on the calendar that is not an optimizer entry.
-- -----------------------------------------------------------------------------
create table calendar_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  season_id     uuid references seasons (id) on delete cascade,
  type          calendar_event_type not null,
  status        calendar_event_status not null default 'SCHEDULED',
  title         text not null check (length(btrim(title)) between 1 and 200),
  description   text,
  location      text,
  gym_id        uuid references gyms (id) on delete set null,
  trainer_id    uuid references trainers (id) on delete set null,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  all_day       boolean not null default false,
  color         text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  -- Set true only for deliberate multi-team occupancy (in-house match,
  -- tournament). The optimizer never sets this and never relies on it.
  allows_gym_sharing boolean not null default false,
  -- Blocks the gym/trainer for scheduling purposes (e.g. HOLIDAY, BLACKOUT).
  blocks_scheduling boolean not null default false,
  external_id   text,
  metadata      jsonb not null default '{}'::jsonb,
  cancelled_at  timestamptz,
  cancellation_reason text,
  created_by    uuid references profiles (id) on delete set null,
  updated_by    uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint calendar_events_time_order check (end_at > start_at),
  constraint calendar_events_cancelled check ((status = 'CANCELLED') = (cancelled_at is not null))
);
create index calendar_events_tenant_window_idx on calendar_events (tenant_id, start_at, end_at);
create index calendar_events_season_idx on calendar_events (season_id, start_at) where season_id is not null;
create index calendar_events_gym_idx on calendar_events (gym_id, start_at) where gym_id is not null;
create index calendar_events_trainer_idx on calendar_events (trainer_id, start_at) where trainer_id is not null;
create index calendar_events_type_idx on calendar_events (tenant_id, type, status);
create unique index calendar_events_external_uniq on calendar_events (tenant_id, external_id) where external_id is not null;
select app.attach_touch_trigger('calendar_events');

create trigger trg_calendar_events_season_tenant
  before insert or update of season_id, tenant_id on calendar_events
  for each row when (new.season_id is not null)
  execute function app.assert_same_tenant('seasons', 'season_id');

-- An event may involve several teams (that is the whole point of the split).
create table calendar_event_teams (
  event_id  uuid not null references calendar_events (id) on delete cascade,
  team_id   uuid not null references teams (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (event_id, team_id)
);
create index calendar_event_teams_team_idx on calendar_event_teams (team_id);
create index calendar_event_teams_tenant_idx on calendar_event_teams (tenant_id);

-- -----------------------------------------------------------------------------
-- jobs — background work (generation, sync, email). Idempotent + observable.
-- -----------------------------------------------------------------------------
create table jobs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  kind          text not null,
  status        job_status not null default 'QUEUED',
  -- Natural key of the work; a second enqueue of the same key is a no-op.
  idempotency_key text,
  payload       jsonb not null default '{}'::jsonb,
  result        jsonb not null default '{}'::jsonb,
  progress      smallint not null default 0 check (progress between 0 and 100),
  progress_message text,
  error_message text,
  attempts      smallint not null default 0,
  max_attempts  smallint not null default 3,
  -- The user the job acts on behalf of; authorization is re-checked at run time.
  requested_by  uuid references profiles (id) on delete set null,
  scheduled_for timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index jobs_idempotency_uniq on jobs (tenant_id, kind, idempotency_key) where idempotency_key is not null;
create index jobs_queue_idx on jobs (status, scheduled_for) where status in ('QUEUED', 'RUNNING');
create index jobs_tenant_idx on jobs (tenant_id, created_at desc);
select app.attach_touch_trigger('jobs');
