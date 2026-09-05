-- =============================================================================
-- 0021 MATCH FIXTURES, AND THE TIME A MATCH TAKES THE HALL
--
-- A match already had a home: calendar_event_type has carried MATCH and
-- TOURNAMENT since the beginning, calendar_event_teams already links an event
-- to the teams in it, and the calendar already draws both. What was missing was
-- the three things a club reads off a fixture list — who, where, and which
-- competition — and any notion that a fixture takes the hall for longer than it
-- takes to play.
--
-- Deliberately not a separate `matches` table. A derby between two of the
-- club's own teams is one event with two of our teams and no external
-- opponent, which is exactly what calendar_event_teams already expresses and
-- what a `team_id not null` column could not. A second table would also mean a
-- third calendar source, a parallel CRUD surface, and MATCH left as a dead
-- enum value.
-- =============================================================================

alter table calendar_events
  add column opponent text
    constraint calendar_events_opponent_length
      check (opponent is null or length(btrim(opponent)) between 1 and 120),
  -- Null means the distinction does not apply: a holiday is neither home nor
  -- away, and an in-house derby is both. Not derived from gym_id, because a
  -- club may host in a rented hall that is not one of its own.
  add column is_home boolean,
  add column competition text
    constraint calendar_events_competition_length
      check (competition is null or length(btrim(competition)) between 1 and 120);

-- Fixture fields belong to fixtures. Without this they drift onto holidays and
-- meetings, and every reader has to guess whether they mean anything.
alter table calendar_events
  add constraint calendar_events_fixture_fields check (
    type in ('MATCH', 'TOURNAMENT')
    or (opponent is null and is_home is null and competition is null)
  );

comment on column calendar_events.opponent is
  'Opposing club. Null for an in-house match between two of the club''s own teams.';
comment on column calendar_events.is_home is
  'True when the club hosts. Null when the distinction does not apply.';
comment on column calendar_events.competition is
  'League or cup this fixture belongs to, e.g. "U19 Eccellenza".';

-- -----------------------------------------------------------------------------
-- How long the hall is tied up either side
--
-- A match is not two hours of basketball in an otherwise free hall: the
-- scorers' table goes up, the referees arrive, both squads warm up, and
-- afterwards it all comes down again. An 18:00-20:00 senior fixture holds the
-- hall from 16:30 to 21:00, and training booked into either end is training
-- nobody can actually do.
--
-- Outside calendar_events_fixture_fields on purpose: an open day or a hall
-- hired out to someone else needs setup time for exactly the same physical
-- reason, and tying buffers to fixture-ness would force a club to lie about an
-- event's type to get a correct hold on the room.
--
-- Per event rather than a club-wide default resolved at read time, because a
-- default that can be edited makes stored history mutable: raising it in
-- February would retroactively change what October's schedule meant, and the
-- generation summary explaining why a session was skipped would no longer
-- reproduce. A per-club default belongs on the *form*, filling these in.
-- -----------------------------------------------------------------------------
alter table calendar_events
  add column buffer_before_minutes smallint not null default 0
    constraint calendar_events_buffer_before check (buffer_before_minutes between 0 and 240),
  add column buffer_after_minutes smallint not null default 0
    constraint calendar_events_buffer_after check (buffer_after_minutes between 0 and 240);

-- An all-day event already holds the whole day. A buffer on one would either
-- mean nothing or spill into the neighbouring days, and both readings are
-- wrong. Refusing the combination is better than storing a number every reader
-- is then obliged to ignore — a convention only the code knows is a bug waiting
-- for the fourth caller.
alter table calendar_events
  add constraint calendar_events_allday_no_buffer check (
    all_day is false or (buffer_before_minutes = 0 and buffer_after_minutes = 0)
  );

comment on column calendar_events.buffer_before_minutes is
  'Minutes the gym is held before start_at — setup, warm-up, arrivals. Never set on an all-day event.';
comment on column calendar_events.buffer_after_minutes is
  'Minutes the gym is held after end_at — pack-down, clearing the hall.';

-- Fixtures are read by date and by team far more than by anything else.
create index calendar_events_tenant_start_idx
  on calendar_events (tenant_id, start_at)
  where status <> 'CANCELLED';
