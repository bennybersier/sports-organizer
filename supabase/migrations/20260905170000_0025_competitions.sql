-- =============================================================================
-- 0025 COMPETITIONS AND FIXTURES
--
-- A season starts with a question the app could not answer: which competitions
-- are we in, who else is in them, and how many matches does that leave us to
-- organise? A club could record a match, one at a time, on a day it already
-- knew — but it owes twenty-two of them the moment it enters a twelve-club
-- league, months before any has a date.
--
-- A fixture is an obligation; a calendar event is a commitment. calendar_events
-- requires a start_at, so an undated match cannot live there — which is why
-- fixtures are their own table and *materialise into* a calendar event once
-- dated. The calendar still holds exactly one kind of row, and migration 0021's
-- refusal to add a parallel `matches` table still stands: this is not that.
-- =============================================================================

create type competition_format as enum ('LEAGUE', 'CONCENTRATION');
create type competition_phase  as enum ('SINGLE', 'GROUP', 'GOLD', 'SILVER', 'BRONZE', 'PLAYOFF');
create type fixture_source     as enum ('FEDERATION', 'AGREED', 'PROVISIONAL');

-- -----------------------------------------------------------------------------
-- One of our teams, in one competition, for one season
-- -----------------------------------------------------------------------------
create table competitions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  season_id   uuid not null references seasons (id) on delete cascade,
  -- The side of ours that plays in it. A competition is always one team's.
  team_id     uuid not null references teams (id) on delete cascade,

  name        text not null constraint competitions_name_length
                check (length(btrim(name)) between 1 and 150),
  format      competition_format not null default 'LEAGUE',
  phase       competition_phase  not null default 'SINGLE',

  /*
    Basketball splits after a group stage: Gold, Silver and Bronze each get
    their own home-and-away schedule, drawn only once the first phase ends. A
    phase is a competition with a parent, so the second one can be declared —
    and its hall time held — before anybody knows who is in it.
  */
  parent_id   uuid references competitions (id) on delete set null,
  -- How many clubs the next phase is expected to hold, before the draw.
  expected_clubs smallint constraint competitions_expected_clubs
                   check (expected_clubs is null or expected_clubs between 2 and 40),

  /*
    How long our hall is held either side of a home fixture in this competition.
    Stated once here rather than typed into every match: senior fixtures need an
    hour and a half of setup, a minibasket concentration needs far less, and a
    club should not have to remember which.
  */
  home_buffer_before_minutes smallint not null default 60
    constraint competitions_buffer_before check (home_buffer_before_minutes between 0 and 240),
  home_buffer_after_minutes  smallint not null default 30
    constraint competitions_buffer_after  check (home_buffer_after_minutes between 0 and 240),

  status      entity_status not null default 'ACTIVE',
  notes       text,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index competitions_team_name_uniq
  on competitions (season_id, team_id, lower(name)) where deleted_at is null;
create index competitions_tenant_season_idx on competitions (tenant_id, season_id) where deleted_at is null;
create index competitions_parent_idx on competitions (parent_id) where parent_id is not null;

select app.attach_touch_trigger('competitions');
create trigger trg_competitions_season_tenant
  before insert or update of season_id on competitions
  for each row execute function app.assert_same_tenant('seasons', 'season_id');
create trigger trg_competitions_team_tenant
  before insert or update of team_id on competitions
  for each row execute function app.assert_same_tenant('teams', 'team_id');

-- -----------------------------------------------------------------------------
-- The clubs in it, ours among them
--
-- Rows rather than free text, so "Virtus Cremona away" means the same place
-- every time, and so a second phase can reuse the entries a group stage created.
-- -----------------------------------------------------------------------------
create table competition_entries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  competition_id uuid not null references competitions (id) on delete cascade,

  -- Set on exactly one row: us. Null on every opposing club.
  team_id        uuid references teams (id) on delete cascade,

  club_name      text not null constraint competition_entries_name_length
                   check (length(btrim(club_name)) between 1 and 120),
  town           text,
  -- Where they host. Free text: another club's hall is not one of our gyms.
  venue          text,

  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index competition_entries_name_uniq
  on competition_entries (competition_id, lower(club_name));
-- One of us per competition, and only one.
create unique index competition_entries_ours_uniq
  on competition_entries (competition_id) where team_id is not null;
create index competition_entries_competition_idx on competition_entries (competition_id);

select app.attach_touch_trigger('competition_entries');

-- -----------------------------------------------------------------------------
-- The matches themselves
-- -----------------------------------------------------------------------------
create table fixtures (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  competition_id uuid not null references competitions (id) on delete cascade,

  matchday       smallint not null constraint fixtures_matchday check (matchday > 0),
  -- Who hosts. Null while undecided, and for a concentration it changes from
  -- one weekend to the next, so it belongs here rather than on the competition.
  host_entry_id  uuid references competition_entries (id) on delete set null,

  -- Null until the federation publishes it or two clubs agree it.
  starts_at      timestamptz,
  ends_at        timestamptz,
  source         fixture_source not null default 'AGREED',

  -- What this became once it had a date. Cleared when the date is.
  calendar_event_id uuid references calendar_events (id) on delete set null,

  notes          text,
  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint fixtures_dates_together check ((starts_at is null) = (ends_at is null)),
  constraint fixtures_time_order     check (ends_at is null or ends_at > starts_at)
);

create index fixtures_competition_idx on fixtures (competition_id, matchday);
create index fixtures_tenant_start_idx on fixtures (tenant_id, starts_at) where starts_at is not null;
create index fixtures_event_idx on fixtures (calendar_event_id) where calendar_event_id is not null;

select app.attach_touch_trigger('fixtures');

-- -----------------------------------------------------------------------------
-- Who is in each fixture
--
-- A league fixture has two participants; a concentration has three or four in
-- one hall. A fixture holding only our own entry is one whose opponent is not
-- yet known — which is exactly the slot a second phase reserves before its
-- draw, with no extra flag and no second table.
-- -----------------------------------------------------------------------------
create table fixture_participants (
  fixture_id uuid not null references fixtures (id) on delete cascade,
  entry_id   uuid not null references competition_entries (id) on delete cascade,
  tenant_id  uuid not null references tenants (id) on delete cascade,
  primary key (fixture_id, entry_id)
);

create index fixture_participants_entry_idx on fixture_participants (entry_id);

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
insert into permissions (key, resource, action, description, category, sort_order) values
  ('competitions.read',   'competitions', 'read',   'View competitions and fixtures',   'Competitions', 10),
  ('competitions.create', 'competitions', 'create', 'Add competitions and fixtures',    'Competitions', 20),
  ('competitions.update', 'competitions', 'update', 'Edit competitions and fixtures',   'Competitions', 30),
  ('competitions.delete', 'competitions', 'delete', 'Remove competitions and fixtures', 'Competitions', 40)
on conflict (key) do update
  set resource    = excluded.resource,
      action      = excluded.action,
      description = excluded.description,
      category    = excluded.category,
      sort_order  = excluded.sort_order;

/*
  app.grant_role_permissions deletes any grant not in the array it is handed, so
  it cannot be called with only the new keys. Owner and Admin are derived from
  the whole table and stay safe; the rest are appended.
*/
do $$
declare v_all text[];
begin
  select array_agg(key order by key) into v_all from permissions;
  perform app.grant_role_permissions('OWNER', v_all);
  perform app.grant_role_permissions('ADMIN', array_remove(v_all, 'tenant.delete'));
end;
$$;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
  cross join (values ('competitions.read'), ('competitions.create'),
                     ('competitions.update'), ('competitions.delete')) as p(key)
 where r.tenant_id is null and r.key = 'ORGANIZER'
on conflict do nothing;

-- Coaches, managers and athletes see the fixture list; they do not edit it.
insert into role_permissions (role_id, permission_key)
select r.id, 'competitions.read'
  from roles r
 where r.tenant_id is null and r.key in ('TRAINER', 'TEAM_MANAGER', 'ATHLETE')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('competitions',         'competitions.read', 'competitions.create', 'competitions.update', 'competitions.delete');
select app.apply_tenant_rls('competition_entries',  'competitions.read', 'competitions.create', 'competitions.update', 'competitions.delete');
select app.apply_tenant_rls('fixtures',             'competitions.read', 'competitions.create', 'competitions.update', 'competitions.delete');
select app.apply_tenant_rls('fixture_participants', 'competitions.read', 'competitions.create', 'competitions.update', 'competitions.delete');
