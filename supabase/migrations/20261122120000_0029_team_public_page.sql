-- -----------------------------------------------------------------------------
-- 0029 — a public page for a team, for its parents
--
-- Parents want the fixtures, the results and when training is, and they do not
-- have — and should not need — an account. The page is reached by an
-- unguessable token rather than by the team's id or a readable slug: a link
-- that is shared in a WhatsApp group is fine, a page anyone can find by
-- guessing or crawling is not, because a youth team's page says where a group
-- of children will be and when.
--
-- Null means the page is off. A new token replaces the old one, which is how a
-- link that has gone further than intended is withdrawn.
--
-- Stored in the clear, unlike invitation tokens: the coach has to be able to
-- copy the link again next week, and what it unlocks is exactly what the page
-- shows — nothing that is not already meant for an audience outside the club.
-- The page is served by the application with the secret key, after looking
-- the token up; no `anon` policy is added, so the token opens nothing through
-- PostgREST.
-- -----------------------------------------------------------------------------
alter table public.teams
  add column if not exists public_token text;

create unique index if not exists teams_public_token_uniq
  on public.teams (public_token)
  where public_token is not null;

comment on column public.teams.public_token is
  'Secret for the read-only public team page (/public/teams/<token>). Null when the page is off; replaced to revoke an old link.';
