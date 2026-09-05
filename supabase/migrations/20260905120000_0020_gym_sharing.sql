-- =============================================================================
-- 0020 LIMITED GYM SHARING
--
-- Most halls take one team at a time. Some can take two for a changeover — one
-- session winding down while the next warms up — and a hall with two courts can
-- genuinely run two side by side all evening. Those are three different halls,
-- and one boolean cannot tell them apart.
--
-- The defaults are today's rule exactly, so this migration changes no schedule
-- until a club says otherwise about a specific hall.
-- =============================================================================

alter table gyms
  add column max_concurrent_teams smallint not null default 1
    constraint gyms_max_concurrent_teams check (max_concurrent_teams between 1 and 4),
  add column max_shared_overlap_minutes smallint not null default 0
    constraint gyms_max_shared_overlap check (max_shared_overlap_minutes between 0 and 240);

-- (2, 0) and (1, 30) are both meaningless. Keeping them out of the table means
-- the engine never has to decide which half of a contradiction wins.
alter table gyms
  add constraint gyms_sharing_coherent check (
    (max_concurrent_teams > 1) = (max_shared_overlap_minutes > 0)
  );

comment on column gyms.max_concurrent_teams is
  'How many training sessions may run here at once. 1 is a normal hall.';
comment on column gyms.max_shared_overlap_minutes is
  'Longest overlap allowed between any two of them — a changeover, not a shared session.';

-- -----------------------------------------------------------------------------
-- Which entries are allowed to overlap at all
--
-- Denormalised from the hall onto the entry so the exclusion constraint below
-- can keep protecting every ordinary hall with an index. Flipping a hall back
-- to exclusive deliberately does NOT re-validate entries already written: a
-- published schedule records a decision that was legal when it was made, and
-- silently invalidating history would be worse than carrying it.
-- -----------------------------------------------------------------------------
alter table schedule_entries
  add column gym_shares boolean not null default false;

create or replace function app.set_schedule_entry_gym_sharing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select g.max_concurrent_teams > 1 into new.gym_shares
    from gyms g where g.id = new.gym_id;
  new.gym_shares := coalesce(new.gym_shares, false);
  return new;
end;
$$;

create trigger trg_schedule_entries_gym_shares
  before insert or update of gym_id on schedule_entries
  for each row execute function app.set_schedule_entry_gym_sharing();

-- -----------------------------------------------------------------------------
-- Narrow the exclusion constraint rather than dropping it
--
-- Postgres generated the original name by truncating the column list, so it is
-- not reliably predictable — find it by shape instead. Every hall that takes one
-- team at a time keeps exactly the index-enforced, race-free guarantee it has
-- always had; only shareable halls fall through to the trigger below.
--
-- Rejected on the way here: shrinking the range to
--   tstzrange(start_at + interval '15 min', end_at - interval '15 min', '[)')
-- which does encode "overlap <= 30" for any pair. But 15 is a constant where a
-- per-hall value belongs, a constraint expression cannot read `gyms`, it bounds
-- no concurrency at all, and it would silently permit a 30-minute overlap in a
-- hall configured exclusive. It enforces a rule that is neither the old one nor
-- the new one.
-- -----------------------------------------------------------------------------
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'public.schedule_entries'::regclass
     and contype = 'x'
     and pg_get_constraintdef(oid) like '%gym_id%';

  if constraint_name is null then
    raise exception 'Could not find the gym exclusion constraint on schedule_entries.';
  end if;

  execute format('alter table schedule_entries drop constraint %I', constraint_name);
end;
$$;

alter table schedule_entries
  add constraint schedule_entries_gym_exclusive
  exclude using gist (
    schedule_version_id with =, gym_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status <> 'CANCELLED' and not gym_shares);

-- Supports the trigger's two lookups.
create index schedule_entries_version_gym_idx
  on schedule_entries (schedule_version_id, gym_id, start_at)
  where status <> 'CANCELLED';

-- -----------------------------------------------------------------------------
-- The rule an index cannot express
--
-- EXCLUDE USING gist can say "these must not overlap". It cannot say "at most N
-- of them may overlap" or "by no more than M minutes", so shareable halls need
-- a trigger. That is a real loss: a trigger can be disabled, and a function
-- that SELECTs is not race-free on its own. The advisory lock buys the second
-- half of that back; nothing buys back the first.
-- -----------------------------------------------------------------------------
create or replace function app.assert_gym_sharing_within_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_teams   smallint;
  v_max_overlap smallint;
  v_worst       numeric;
  v_depth       int;
begin
  if new.status = 'CANCELLED' or not new.gym_shares then
    return null;
  end if;

  -- Serialises writers for this hall in this version. A GiST exclusion
  -- constraint is race-free by construction; a trigger that reads is not, so
  -- two concurrent inserts could each see a legal picture and together commit
  -- an illegal one.
  perform pg_advisory_xact_lock(
    hashtextextended(new.schedule_version_id::text || ':' || new.gym_id::text, 0));

  select max_concurrent_teams, max_shared_overlap_minutes
    into v_max_teams, v_max_overlap
    from gyms where id = new.gym_id;

  -- Only the new row's pairs need checking: every pair already in the hall was
  -- checked when the later of the two was written.
  select coalesce(max(extract(epoch from
           (least(e.end_at, new.end_at) - greatest(e.start_at, new.start_at))) / 60), 0)
    into v_worst
    from schedule_entries e
   where e.schedule_version_id = new.schedule_version_id
     and e.gym_id = new.gym_id
     and e.id <> new.id
     and e.status <> 'CANCELLED'
     and tstzrange(e.start_at, e.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)');

  if v_worst > v_max_overlap then
    raise exception
      'Two teams may share % for % minutes at most; this would be %.',
      (select name from gyms where id = new.gym_id), v_max_overlap, v_worst
      using errcode = 'exclusion_violation';
  end if;

  -- Depth can only change where a session starts, so probing starts is
  -- equivalent to a full sweep. `end_at > p.start_at` keeps ranges half-open:
  -- a session ending as another begins does not count twice.
  with live as (
    select e.start_at, e.end_at
      from schedule_entries e
     where e.schedule_version_id = new.schedule_version_id
       and e.gym_id = new.gym_id
       and e.id <> new.id
       and e.status <> 'CANCELLED'
       and tstzrange(e.start_at, e.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
    union all
    select new.start_at, new.end_at
  )
  select max((select count(*) from live l
               where l.start_at <= p.start_at and l.end_at > p.start_at))
    into v_depth
    from live p;

  if v_depth > v_max_teams then
    raise exception
      '% would hold % sessions at once; % allowed.',
      (select name from gyms where id = new.gym_id), v_depth, v_max_teams
      using errcode = 'exclusion_violation';
  end if;

  return null;
end;
$$;

-- Raised with errcode 23P01 and deliberately no SCO_USER_MESSAGE hint, so every
-- existing caller's exclusionMessage keeps applying unchanged. That includes
-- generation's "the schedule collided with itself — this is a bug", which stays
-- correct: the engine will not propose a placement a correctly configured hall
-- forbids, so a rejection here is the canary for the TypeScript predicate and
-- this function having drifted apart.
create constraint trigger trg_schedule_entries_gym_sharing
  after insert or update of start_at, end_at, gym_id, status, schedule_version_id
  on schedule_entries
  deferrable initially immediate
  for each row execute function app.assert_gym_sharing_within_policy();
