-- -----------------------------------------------------------------------------
-- 0030 — whether an athlete may appear on their team's parents' page
--
-- The parents' page (0029) lists the squad as first name and last initial.
-- The club collects publication consent at registration, so this defaults to
-- yes — every athlete already registered is included by the default as the
-- column is added — and is the place to record a family that said no.
--
-- Not null: "unknown" is not a state the page could act on.
-- -----------------------------------------------------------------------------
alter table public.athletes
  add column if not exists public_consent boolean not null default true;

comment on column public.athletes.public_consent is
  'Whether the athlete may be listed (first name and last initial) on the public parents'' page of their teams.';
