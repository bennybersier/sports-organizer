-- -----------------------------------------------------------------------------
-- 0031 — away halls: opponents' gyms, saved so their address is typed once
--
-- A club plays away at the same dozen halls every season, and the address of
-- each is what a parent driving there needs. Saving them as gyms lets the
-- match editor pick one and every page use its address — and a corrected
-- address corrects every match played there.
--
-- But a gym has so far meant "somewhere we can train", and the schedule
-- generator offers every active gym to every team. An away hall must never be
-- one of those, so it is flagged rather than mixed in: the generator, the
-- training requirements and the team pickers leave flagged halls out, and the
-- match editor lists them separately.
-- -----------------------------------------------------------------------------
alter table public.gyms
  add column if not exists is_away boolean not null default false;

comment on column public.gyms.is_away is
  'An opponent''s hall, saved for its address. Never offered for training: the generator and training pickers skip it; the match editor lists it under away halls.';
