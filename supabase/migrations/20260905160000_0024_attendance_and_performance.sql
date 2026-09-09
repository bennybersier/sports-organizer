-- =============================================================================
-- 0023 ATTENDANCE, CALL-UPS AND PERFORMANCE
--
-- Three questions a club cannot currently answer: who actually turned up, who
-- was picked for the match, and whether anyone is getting better.
--
-- The one decision everything else follows from: a register is not a schedule
-- entry. `schedule_entries` belong to a schedule_version, and publishing a new
-- version archives the old one — that is the whole point of the versioning, and
-- it is right for a plan. It is fatal for a record of fact. If attendance hung
-- off a schedule entry, re-running the optimizer in January would silently
-- orphan every register the club had marked since September.
--
-- So `attendance_registers` is its own table. It records what happened, it
-- snapshots when and where it happened, and it keeps a *nullable* pointer back
-- at the schedule entry or calendar event it came from. Regenerate the schedule
-- as often as you like: the registers stand.
--
-- This is deliberately NOT a third calendar source. Nothing is ever drawn from
-- this table onto the calendar and the optimizer never reads it. A register is
-- created only when a human opens one, and cannot exist for a session nobody
-- ever attended to.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- What the gathering was. A match register carries a squad selection; a
-- training register does not.
create type attendance_occasion as enum ('TRAINING', 'MATCH');

-- CANCELLED is the load-bearing one: without it there is no way to tell a
-- session nobody bothered to mark from a session that never happened, and every
-- attendance percentage in the club is quietly wrong.
create type register_state as enum ('OPEN', 'RECORDED', 'CANCELLED');

-- EXCUSED is not a synonym for ABSENT. A player whose parent rang on Tuesday
-- and a player who simply did not appear are the same row to a headcount and
-- opposite rows to a coach, and the difference is most of what "commitment"
-- means over a season.
create type attendance_state as enum ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- Why someone was not there. Shared with athlete_availability_exceptions, so a
-- holiday declared in advance and a holiday discovered on the night are
-- reported as the same thing.
create type absence_reason as enum (
  'INJURY', 'ILLNESS', 'SCHOOL', 'FAMILY', 'HOLIDAY', 'TRANSPORT', 'OTHER'
);

-- Why a called-up player never came on. The point of recording it is that
-- "coach's decision" four weeks running is a conversation the club should be
-- prompted to have, and "resting" is not.
create type bench_reason as enum (
  'COACH_DECISION', 'ROTATION', 'INJURY', 'DISCIPLINARY', 'OTHER'
);

-- -----------------------------------------------------------------------------
-- Team-level settings this module needs
-- -----------------------------------------------------------------------------

alter table teams
  -- How many players may go on the sheet. Twelve for the agonistica sides;
  -- null for minibasket, where the rules require every child present to play
  -- and a cap would be a bug rather than a policy.
  add column match_call_up_limit smallint
    constraint teams_call_up_limit_sane check (
      match_call_up_limit is null or match_call_up_limit between 1 and 30
    ),
  -- Whether anyone actually keeps a scoresheet for this side. Filling in a
  -- box score for Pulcini is not a thing that happens, and offering the form
  -- to a minibasket instructor is how a feature gets a reputation.
  add column tracks_box_score boolean not null default false;

comment on column teams.match_call_up_limit is
  'Maximum players on the match sheet. Null means no cap (minibasket).';
comment on column teams.tracks_box_score is
  'Whether this side records per-player match statistics.';

-- -----------------------------------------------------------------------------
-- attendance_registers — one team, one occasion, one sheet
-- -----------------------------------------------------------------------------
create table attendance_registers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  season_id    uuid not null references seasons (id) on delete cascade,
  team_id      uuid not null references teams (id) on delete cascade,
  occasion     attendance_occasion not null,
  state        register_state not null default 'OPEN',

  -- Where this register came from, if anywhere. ON DELETE SET NULL rather than
  -- CASCADE: discarding a draft schedule must never delete the attendance a
  -- coach marked against it.
  schedule_entry_id uuid references schedule_entries (id) on delete set null,
  event_id          uuid references calendar_events (id) on delete set null,

  -- What actually happened, copied rather than joined. The session may have
  -- started late, moved hall, or been taken by a different coach, and the plan
  -- it came from may be archived or gone.
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  gym_id       uuid references gyms (id) on delete set null,
  trainer_id   uuid references trainers (id) on delete set null,

  -- Snapshotted from teams.match_call_up_limit when a match register opens, so
  -- changing the club's policy in March does not retroactively make October's
  -- team sheets illegal.
  call_up_limit smallint
    constraint registers_call_up_limit_sane check (
      call_up_limit is null or call_up_limit between 1 and 30
    ),

  notes        text,
  cancellation_reason text,
  recorded_at  timestamptz,
  recorded_by  uuid references profiles (id) on delete set null,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint registers_time_order check (ends_at > starts_at),
  -- A register has at most one origin; two would make "which session is this?"
  -- unanswerable.
  constraint registers_single_origin check (
    schedule_entry_id is null or event_id is null
  ),
  -- A match is always an event: opponent, competition and home/away live on
  -- calendar_events and a match sheet without them is not a match sheet.
  constraint registers_match_has_event check (
    occasion <> 'MATCH' or event_id is not null
  ),
  constraint registers_call_up_limit_is_match_only check (
    call_up_limit is null or occasion = 'MATCH'
  ),
  -- An implication, not an equivalence: a register that is later cancelled or
  -- reopened keeps the moment it was first marked, exactly as an archived
  -- schedule version keeps published_at.
  constraint registers_recorded_fields check (
    state <> 'RECORDED' or recorded_at is not null
  )
);

-- One sheet per session. A schedule entry is already one team, so it needs no
-- team in the key; an event may hold a derby, so it does.
create unique index attendance_registers_entry_uniq
  on attendance_registers (schedule_entry_id) where schedule_entry_id is not null;
create unique index attendance_registers_event_uniq
  on attendance_registers (event_id, team_id) where event_id is not null;

create index attendance_registers_team_idx on attendance_registers (team_id, starts_at desc);
create index attendance_registers_tenant_window_idx on attendance_registers (tenant_id, starts_at desc);
create index attendance_registers_season_idx on attendance_registers (season_id, occasion, state);
create index attendance_registers_open_idx on attendance_registers (tenant_id, starts_at)
  where state = 'OPEN';
select app.attach_touch_trigger('attendance_registers');

create trigger trg_registers_team_tenant
  before insert or update of team_id, tenant_id on attendance_registers
  for each row execute function app.assert_same_tenant('teams', 'team_id');
create trigger trg_registers_season_tenant
  before insert or update of season_id, tenant_id on attendance_registers
  for each row execute function app.assert_same_tenant('seasons', 'season_id');

-- -----------------------------------------------------------------------------
-- attendance_records — one athlete on one sheet
--
-- One row per squad member per occasion, including the four who were not
-- picked: "not called up" is a fact worth reporting on, and a report that can
-- only see the twelve who were cannot answer the question the club actually
-- asks, which is who keeps being left out.
-- -----------------------------------------------------------------------------
create table attendance_records (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  register_id  uuid not null references attendance_registers (id) on delete cascade,
  athlete_id   uuid not null references athletes (id) on delete cascade,

  state        attendance_state not null default 'PRESENT',
  -- Why they were not there, or why they were late.
  reason       absence_reason,
  -- Set when this row was pre-filled from a declared absence rather than
  -- observed, so a coach can see what the sheet assumed before they touched it.
  prefilled    boolean not null default false,
  minutes_late smallint check (minutes_late is null or minutes_late between 0 and 240),

  -- Match only. Enforced against the register's occasion by trigger below.
  called_up    boolean,
  started      boolean,
  bench_reason bench_reason,

  note         text,
  recorded_by  uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (register_id, athlete_id),
  constraint records_reason_needs_absence check (
    reason is null or state <> 'PRESENT'
  ),
  -- You cannot start a match you were not picked for, and you cannot be sat on
  -- the bench you were never on.
  constraint records_started_implies_called check (
    started is not true or called_up is true
  ),
  constraint records_bench_implies_called check (
    bench_reason is null or called_up is true
  )
);
create index attendance_records_athlete_idx on attendance_records (athlete_id);
create index attendance_records_register_idx on attendance_records (register_id);
create index attendance_records_tenant_idx on attendance_records (tenant_id, athlete_id);
select app.attach_touch_trigger('attendance_records');

create trigger trg_records_athlete_tenant
  before insert or update of athlete_id, tenant_id on attendance_records
  for each row execute function app.assert_same_tenant('athletes', 'athlete_id');
create trigger trg_records_register_tenant
  before insert or update of register_id, tenant_id on attendance_records
  for each row execute function app.assert_same_tenant('attendance_registers', 'register_id');

-- The match-only columns cannot be a CHECK, because whether they apply lives on
-- the parent row. Without this a training register grows team-sheet data that
-- no reader expects and every report has to defend against.
create or replace function app.assert_call_up_matches_occasion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_occasion attendance_occasion;
begin
  select occasion into v_occasion
    from attendance_registers where id = new.register_id;

  if v_occasion = 'MATCH' and new.called_up is null then
    raise exception 'a match record must say whether the athlete was called up'
      using errcode = 'check_violation';
  end if;

  if v_occasion <> 'MATCH'
     and (new.called_up is not null or new.started is not null or new.bench_reason is not null)
  then
    raise exception 'call-up fields belong to a match register, not a % one', v_occasion
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_records_call_up_occasion
  before insert or update of register_id, called_up, started, bench_reason on attendance_records
  for each row execute function app.assert_call_up_matches_occasion();

-- -----------------------------------------------------------------------------
-- athlete_availability_exceptions — the absences the club is told about
--
-- Shaped as a date range rather than the single dated row the gym, trainer and
-- team exception tables use, and deliberately so: those override a recurring
-- weekly pattern, and an athlete has no weekly pattern to override. What a club
-- is actually told is "away from the 20th to the 27th", which is one row here
-- and would be eight rows and a lie anywhere else.
--
-- Registers pre-fill from this table, which is the whole return on entering it:
-- the coach opens Tuesday's sheet and the three known absences are already
-- marked, flagged as assumed rather than observed.
-- -----------------------------------------------------------------------------
create table athlete_availability_exceptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  athlete_id   uuid not null references athletes (id) on delete cascade,
  -- Null means every team the athlete plays for. A player who is away is away;
  -- a player rested from one squad is not.
  team_id      uuid references teams (id) on delete cascade,
  starts_on    date not null,
  ends_on      date not null,
  reason       absence_reason not null,
  note         text,
  -- Who told us. Free text on purpose: today it is the coach typing "mum rang",
  -- and it stays true when a parent enters it themselves.
  reported_by  text,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint athlete_exc_date_order check (ends_on >= starts_on),
  -- A decade-long absence is a membership change, not an exception.
  constraint athlete_exc_length check (ends_on - starts_on <= 400)
);
create index athlete_availability_exceptions_lookup_idx
  on athlete_availability_exceptions (tenant_id, athlete_id, starts_on, ends_on);
create index athlete_availability_exceptions_window_idx
  on athlete_availability_exceptions (tenant_id, starts_on, ends_on);
select app.attach_touch_trigger('athlete_availability_exceptions');

create trigger trg_athlete_exceptions_tenant
  before insert or update of athlete_id, tenant_id on athlete_availability_exceptions
  for each row execute function app.assert_same_tenant('athletes', 'athlete_id');

-- -----------------------------------------------------------------------------
-- match_box_scores — the scoresheet, for the sides that keep one
--
-- Its own table rather than columns on attendance_records because it applies to
-- eight of the club's thirty teams, it is entered afterwards by a different
-- person from a different piece of paper, and it is eighteen columns wide.
--
-- Two-pointers and three-pointers are stored separately rather than as "field
-- goals" plus "of which threes", because every argument about a box score
-- schema is ultimately about whether FGM includes the threes. This way there is
-- nothing to argue about and `points` can be computed rather than trusted.
-- -----------------------------------------------------------------------------
create table match_box_scores (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  register_id  uuid not null references attendance_registers (id) on delete cascade,
  athlete_id   uuid not null references athletes (id) on delete cascade,

  -- Seconds, because a scoresheet says 27:14 and rounding it loses the game.
  seconds_played   int not null default 0 check (seconds_played between 0 and 5400),

  two_point_made        smallint not null default 0 check (two_point_made >= 0),
  two_point_attempted   smallint not null default 0 check (two_point_attempted >= 0),
  three_point_made      smallint not null default 0 check (three_point_made >= 0),
  three_point_attempted smallint not null default 0 check (three_point_attempted >= 0),
  free_throw_made       smallint not null default 0 check (free_throw_made >= 0),
  free_throw_attempted  smallint not null default 0 check (free_throw_attempted >= 0),

  offensive_rebounds smallint not null default 0 check (offensive_rebounds >= 0),
  defensive_rebounds smallint not null default 0 check (defensive_rebounds >= 0),
  assists     smallint not null default 0 check (assists >= 0),
  steals      smallint not null default 0 check (steals >= 0),
  blocks      smallint not null default 0 check (blocks >= 0),
  turnovers   smallint not null default 0 check (turnovers >= 0),
  fouls_committed smallint not null default 0 check (fouls_committed between 0 and 10),
  fouls_drawn     smallint not null default 0 check (fouls_drawn >= 0),
  plus_minus  smallint,

  -- Derived, so they cannot disagree with the shots they are made of.
  points int generated always as (
    two_point_made * 2 + three_point_made * 3 + free_throw_made
  ) stored,
  rebounds int generated always as (
    offensive_rebounds + defensive_rebounds
  ) stored,
  -- "Valutazione" — the single number Italian basketball actually quotes. Spelt
  -- out rather than built from `points` and `rebounds` because Postgres will
  -- not let one generated column read another.
  efficiency int generated always as (
    (two_point_made * 2 + three_point_made * 3 + free_throw_made)
      + (offensive_rebounds + defensive_rebounds)
      + assists + steals + blocks + fouls_drawn
    - ((two_point_attempted - two_point_made)
      + (three_point_attempted - three_point_made)
      + (free_throw_attempted - free_throw_made)
      + turnovers + fouls_committed)
  ) stored,

  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (register_id, athlete_id),
  constraint box_two_point_sane   check (two_point_made <= two_point_attempted),
  constraint box_three_point_sane check (three_point_made <= three_point_attempted),
  constraint box_free_throw_sane  check (free_throw_made <= free_throw_attempted)
);
create index match_box_scores_athlete_idx on match_box_scores (athlete_id);
create index match_box_scores_register_idx on match_box_scores (register_id);
create index match_box_scores_tenant_idx on match_box_scores (tenant_id, athlete_id);
select app.attach_touch_trigger('match_box_scores');

create trigger trg_box_scores_athlete_tenant
  before insert or update of athlete_id, tenant_id on match_box_scores
  for each row execute function app.assert_same_tenant('athletes', 'athlete_id');
create trigger trg_box_scores_register_tenant
  before insert or update of register_id, tenant_id on match_box_scores
  for each row execute function app.assert_same_tenant('attendance_registers', 'register_id');

-- -----------------------------------------------------------------------------
-- athlete_evaluations — the coach's read, periodically
--
-- Per period rather than per session. A coach asked to rate sixteen players
-- after every training rates nobody after the third week; asked to do it four
-- times a year, they will, and four honest points make a better curve than
-- ninety abandoned ones.
--
-- Four axes because that is the rubric Italian coaching already uses — tecnica,
-- tattica, fisico, atteggiamento — so nobody has to be taught it.
-- -----------------------------------------------------------------------------
create table athlete_evaluations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  season_id    uuid not null references seasons (id) on delete cascade,
  athlete_id   uuid not null references athletes (id) on delete cascade,
  -- The evaluation is of a player in a group: the same child may be a leader in
  -- their own year and a passenger in the year above, and both are true.
  team_id      uuid not null references teams (id) on delete cascade,
  trainer_id   uuid references trainers (id) on delete set null,

  period_start date not null,
  period_end   date not null,

  technique  smallint check (technique  is null or technique  between 1 and 5),
  tactical   smallint check (tactical   is null or tactical   between 1 and 5),
  physical   smallint check (physical   is null or physical   between 1 and 5),
  attitude   smallint check (attitude   is null or attitude   between 1 and 5),

  strengths   text,
  development text,
  note        text,
  -- Club-specific axes without a migration per club, matching athletes.metadata.
  metadata    jsonb not null default '{}'::jsonb,

  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint evaluations_period_order check (period_end >= period_start),
  -- An evaluation that scores nothing and says nothing is an empty row.
  constraint evaluations_not_empty check (
    technique is not null or tactical is not null or physical is not null
    or attitude is not null or btrim(coalesce(strengths, '')) <> ''
    or btrim(coalesce(development, '')) <> ''
  ),
  unique (athlete_id, team_id, period_start)
);
create index athlete_evaluations_athlete_idx on athlete_evaluations (athlete_id, period_start desc);
create index athlete_evaluations_team_idx on athlete_evaluations (team_id, period_start desc);
create index athlete_evaluations_season_idx on athlete_evaluations (season_id, period_start desc);
select app.attach_touch_trigger('athlete_evaluations');

create trigger trg_evaluations_athlete_tenant
  before insert or update of athlete_id, tenant_id on athlete_evaluations
  for each row execute function app.assert_same_tenant('athletes', 'athlete_id');
create trigger trg_evaluations_team_tenant
  before insert or update of team_id, tenant_id on athlete_evaluations
  for each row execute function app.assert_same_tenant('teams', 'team_id');

-- -----------------------------------------------------------------------------
-- Permissions
--
-- `record` and `manage` are separate because they are held by different people:
-- a coach marks their own sheets as the session happens, and an organizer
-- reopens a sheet that was marked wrong three weeks ago. Giving a coach the
-- second one by default would make every historical record editable by anyone
-- who can mark a register.
-- -----------------------------------------------------------------------------
insert into permissions (key, resource, action, description, category, sort_order) values
  ('attendance.read',   'attendance',  'read',   'View registers, call-ups and attendance reports', 'Attendance', 10),
  ('attendance.record', 'attendance',  'record', 'Mark registers, pick match squads, enter statistics', 'Attendance', 20),
  ('attendance.manage', 'attendance',  'manage', 'Reopen recorded registers and delete them',       'Attendance', 30),
  ('evaluations.read',  'evaluations', 'read',   'View player evaluations',                         'Attendance', 40),
  ('evaluations.write', 'evaluations', 'write',  'Write and edit player evaluations',               'Attendance', 50)
on conflict (key) do update
  set resource = excluded.resource,
      action = excluded.action,
      description = excluded.description,
      category = excluded.category,
      sort_order = excluded.sort_order;

-- `app.grant_role_permissions` sets a role's matrix by deleting everything not
-- in the array it is handed. That is right for 0007, which states the whole
-- matrix in one place, and catastrophic here: calling it with five keys would
-- leave ORGANIZER holding five permissions and nothing else. A later migration
-- adding a permission needs to add, so here is the additive form.
create or replace function app.add_role_permissions(p_role_key text, p_permissions text[])
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

  insert into role_permissions (role_id, permission_key)
  select v_role_id, unnest(p_permissions)
  on conflict do nothing;
end;
$$;

do $$
begin
  -- 0007 grants OWNER and ADMIN whatever is in `permissions` at the time it
  -- runs, so a fresh install picks the new keys up on its own. An installation
  -- where 0007 has already run needs them adding.
  --
  -- The narrow roles below cannot be moved into 0007 instead: role_permissions
  -- has a foreign key to permissions, and 0007 runs before the keys exist. So
  -- re-running 0007 — which its own header invites — will strip these five from
  -- ORGANIZER, TRAINER and TEAM_MANAGER. Re-apply this block if that happens;
  -- every statement in it is idempotent.
  perform app.add_role_permissions('OWNER', array[
    'attendance.read', 'attendance.record', 'attendance.manage',
    'evaluations.read', 'evaluations.write'
  ]);
  perform app.add_role_permissions('ADMIN', array[
    'attendance.read', 'attendance.record', 'attendance.manage',
    'evaluations.read', 'evaluations.write'
  ]);
  perform app.add_role_permissions('ORGANIZER', array[
    'attendance.read', 'attendance.record', 'attendance.manage',
    'evaluations.read', 'evaluations.write'
  ]);

  -- The point of the module. A trainer could previously write nothing but their
  -- own availability; marking the register is the one thing only they can do.
  -- They do not get `manage`: their reach is their own sheets, and the service
  -- layer narrows that further to the teams they actually coach.
  perform app.add_role_permissions('TRAINER', array[
    'attendance.read', 'attendance.record',
    'evaluations.read', 'evaluations.write'
  ]);

  -- Looks after a roster: can mark and pick, does not assess.
  perform app.add_role_permissions('TEAM_MANAGER', array[
    'attendance.read', 'attendance.record', 'evaluations.read'
  ]);

  -- Athletes are deliberately left out. Reading attendance means reading the
  -- whole club's, and scoping a row to "mine" needs a member-to-athlete link
  -- that does not exist yet.
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('attendance_registers',
  'attendance.read', 'attendance.record', 'attendance.record', 'attendance.manage');
select app.apply_tenant_rls('attendance_records',
  'attendance.read', 'attendance.record', 'attendance.record', 'attendance.record');
select app.apply_tenant_rls('athlete_availability_exceptions',
  'attendance.read', 'attendance.record', 'attendance.record', 'attendance.record');
select app.apply_tenant_rls('match_box_scores',
  'attendance.read', 'attendance.record', 'attendance.record', 'attendance.manage');
select app.apply_tenant_rls('athlete_evaluations',
  'evaluations.read', 'evaluations.write', 'evaluations.write', 'evaluations.write');
