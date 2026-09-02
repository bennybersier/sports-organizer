-- Which team gets the slot when two want it.
--
-- Clubs are not flat: a first team's Tuesday evening in the main hall is not
-- negotiable against an under-13 side's third session. The optimizer placed
-- teams most-constrained-first, which is a good tie-breaker but a poor policy —
-- it handed contested slots to whichever team happened to have fewer options,
-- so a club could not express that some teams come first.
--
-- 1 is the highest priority, matching role ranks elsewhere in the schema where
-- a lower rank outranks a higher one. Defaulting to 3 leaves every existing
-- team equal, so adding this changes no schedule until somebody says otherwise.
alter table team_training_requirements
  add column priority smallint not null default 3
    constraint team_training_requirements_priority check (priority between 1 and 5);

comment on column team_training_requirements.priority is
  'Booking priority, 1 (highest) to 5 (lowest). Teams are placed in this order first, then most-constrained-first.';
