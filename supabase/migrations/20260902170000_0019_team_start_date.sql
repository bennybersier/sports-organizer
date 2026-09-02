-- When this team actually starts training.
--
-- A schedule is generated once for the whole season, but teams do not all
-- begin on the same day: a first team may start in the last week of August
-- while an under-13 side waits for the school term. Without this, generation
-- starts everyone on the day it was run, and the only way to delay a team was
-- to cancel its first weeks by hand.
--
-- Null means "whenever the schedule starts", so existing teams are unaffected.
alter table team_training_requirements
  add column starts_on date;

comment on column team_training_requirements.starts_on is
  'First date this team trains. Null follows the schedule. Occurrences before it are not created.';
