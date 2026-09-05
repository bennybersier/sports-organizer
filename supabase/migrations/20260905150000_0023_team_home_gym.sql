-- =============================================================================
-- 0023 WHERE A TEAM PLAYS AT HOME
--
-- Distinct from where it trains, and until now nowhere at all.
--
-- The two are genuinely different facts. A minibasket group can train in a
-- school gym with no scoreboard and host at the town hall; a first team trains
-- and plays in the same place; a side can train wherever there is room and host
-- where the federation will accept the floor. The fixture generator had been
-- guessing — senior sides to the club's own hall, everyone else to whichever
-- hall they happened to prefer for training — and a guess is not something a
-- club can correct.
--
-- On teams rather than on team_training_requirements: that table is about
-- training, and a home hall is not a training requirement. Teams are already
-- season-scoped, so a side moving hall between seasons costs nothing.
--
-- Nullable, because a team may genuinely have none — a group that plays every
-- fixture away, or one whose hall is not settled yet.
-- =============================================================================

alter table teams
  add column home_gym_id uuid references gyms (id) on delete set null;

comment on column teams.home_gym_id is
  'Where this team plays its home fixtures. Null when it has no home hall, or none decided yet.';

-- A gym belongs to the same club as the team that plays there.
create trigger trg_teams_home_gym_tenant
  before insert or update of home_gym_id on teams
  for each row when (new.home_gym_id is not null)
  execute function app.assert_same_tenant('gyms', 'home_gym_id');

create index teams_home_gym_idx on teams (home_gym_id) where home_gym_id is not null;
