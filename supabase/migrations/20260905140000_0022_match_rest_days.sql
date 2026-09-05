-- =============================================================================
-- 0022 REST DAYS AROUND A FIXTURE
--
-- How much room a team needs either side of a match.
--
-- The match date itself is always closed to training — a squad cannot be in two
-- places on one evening, and a club that says otherwise means "a morning
-- session", which is a different fixture rather than a rest-day setting. This
-- column is the buffer *beyond* that: 0 leaves the day before and after free
-- for training, 1 keeps a first team fresh, 2 covers a long trip.
--
-- Per team rather than per club, because the answer genuinely differs: a
-- minibasket group plays Saturday morning and trains happily that afternoon,
-- while an Eccellenza side wants the Wednesday clear around a Tuesday game. A
-- club-wide default would be overridden per team within a week of going live,
-- so it would buy a column and cost a settings screen.
--
-- Defaults to 0, so adding it changes no existing schedule.
-- =============================================================================

alter table team_training_requirements
  add column match_rest_days smallint not null default 0
    constraint ttr_match_rest_days check (match_rest_days between 0 and 3);

comment on column team_training_requirements.match_rest_days is
  'Whole days either side of a fixture on which this team does not train. The match date itself is always blocked.';
