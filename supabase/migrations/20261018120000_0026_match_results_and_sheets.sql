-- =============================================================================
-- 0026 MATCH RESULTS AND GAME SHEETS
--
-- Until now the app could say a match was *going to happen* and, for the eight
-- sides that keep a scoresheet, what each of our players did in it — but not
-- who won. `fixtures` holds an obligation, `calendar_events` a commitment, and
-- `match_box_scores` our own twelve players. The opponent's score was nowhere,
-- so there was no result, no record, no form.
--
-- Two decisions shape this migration.
--
-- 1. A result is keyed `(event_id, team_id)`, exactly like an attendance
--    register. Not on `fixtures`, because a friendly has no fixture and would
--    have had no home for its score; not on `calendar_events`, because a derby
--    is one event with two of our sides in it and each needs its own result
--    row. Keying it the way a register is keyed means a register and a result
--    are always about the same match, found the same way.
--
-- 2. We only ever know *our own* results. Nothing here can produce a league
--    table: Virtus against Pavia is played in a hall we are not in and
--    published on a federation website we do not read. What this supports is
--    our record and our form, which is the honest version of the question.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- Why a match has no score. PENDING is the overwhelmingly common state — the
-- match is in the future, or it was played on Sunday and nobody has typed it in
-- yet — and it is *not* the same as 0–0, which is why score is nullable and
-- this is not a boolean.
create type match_result_state as enum ('PENDING', 'PLAYED', 'FORFEIT', 'ABANDONED');

-- Where a box score's numbers came from, and the reason this migration exists
-- in the shape it does. A referto records makes but never attempts (see
-- docs/referto-import.md §6), so a referto-sourced row has
-- `attempted = made` by necessity — which silently makes every shooting
-- percentage 100% and reduces `efficiency` to points minus fouls. Without this
-- column there is no way to tell such a row from one a coach typed off a
-- stats app, and the two must never be averaged together or shown alike.
create type box_score_source as enum ('MANUAL', 'REFERTO');

-- The life of an uploaded photograph. READ means a model has transcribed it and
-- the deterministic reader has checked the arithmetic; IMPORTED means a human
-- accepted that reading and it is now in `match_box_scores`. Nothing is written
-- to the box score on READ — a transcription is evidence, not a record.
create type match_sheet_state as enum ('UPLOADED', 'READ', 'FAILED', 'IMPORTED');

-- -----------------------------------------------------------------------------
-- match_results — one of our teams, one match, one score
-- -----------------------------------------------------------------------------
create table match_results (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  season_id   uuid not null references seasons (id) on delete cascade,
  -- The match, and which of our sides played it. ON DELETE CASCADE on the
  -- event: deleting a match deletes its result, which is correct — a score
  -- for a match that never existed is not worth keeping.
  event_id    uuid not null references calendar_events (id) on delete cascade,
  team_id     uuid not null references teams (id) on delete cascade,

  state       match_result_state not null default 'PENDING',

  /*
    Ours and theirs, rather than home and away. Home/away already lives on
    `calendar_events.is_home` and storing it twice is how the two come to
    disagree; "did we win" should also not require first working out which side
    of the fixture we were.

    300 is not a basketball score, but a minibasket festival played to a running
    total across four games can reach three figures, and the cap is here to
    catch a transposed digit rather than to legislate the sport.
  */
  our_score   smallint constraint match_results_our_score_sane
                check (our_score is null or our_score between 0 and 300),
  their_score smallint constraint match_results_their_score_sane
                check (their_score is null or their_score between 0 and 300),

  /*
    The quarter-by-quarter scores, ours and theirs, as two parallel arrays.

    These are not decoration. On a referto they are the four circled
    checkpoints down the progressive-score ladder, and they are what localises
    a misreading to a single quarter instead of to the whole sheet — see
    docs/referto-import.md §5, check 2. A result entered by hand may leave them
    null; a result imported from a sheet always has them.
  */
  our_periods   smallint[] constraint match_results_our_periods_sane
                  check (our_periods is null or (
                    array_length(our_periods, 1) between 1 and 8
                    and 0 <= all(our_periods) and 200 >= all(our_periods)
                  )),
  their_periods smallint[] constraint match_results_their_periods_sane
                  check (their_periods is null or (
                    array_length(their_periods, 1) between 1 and 8
                    and 0 <= all(their_periods) and 200 >= all(their_periods)
                  )),

  -- Free text, for the things a score cannot carry: "played 4v5 after the
  -- second quarter", "abandoned, floor unplayable".
  notes       text,

  recorded_by uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One result per side per match.
  unique (event_id, team_id),

  /*
    A state and a score cannot disagree. PENDING has no score; everything else
    has both halves of one. An ABANDONED match that was never restarted is
    recorded with the score as it stood, because that is what the sheet says.
  */
  constraint match_results_pending_has_no_score check (
    state <> 'PENDING' or (our_score is null and their_score is null)
  ),
  constraint match_results_played_has_score check (
    state = 'PENDING' or (our_score is not null and their_score is not null)
  ),
  -- Periods come in pairs or not at all: one side's quarters without the
  -- other's cannot be checked against anything, which is their only purpose.
  constraint match_results_periods_together check (
    (our_periods is null) = (their_periods is null)
  ),
  constraint match_results_periods_same_length check (
    our_periods is null or array_length(our_periods, 1) = array_length(their_periods, 1)
  )
);

create index match_results_tenant_season_idx on match_results (tenant_id, season_id);
create index match_results_team_idx on match_results (team_id, state);
create index match_results_event_idx on match_results (event_id);

select app.attach_touch_trigger('match_results');

create trigger trg_match_results_team_tenant
  before insert or update of team_id, tenant_id on match_results
  for each row execute function app.assert_same_tenant('teams', 'team_id');
create trigger trg_match_results_season_tenant
  before insert or update of season_id, tenant_id on match_results
  for each row execute function app.assert_same_tenant('seasons', 'season_id');
create trigger trg_match_results_event_tenant
  before insert or update of event_id, tenant_id on match_results
  for each row execute function app.assert_same_tenant('calendar_events', 'event_id');

comment on table match_results is
  'Our score and theirs for one of our teams in one match. Keyed like an '
  'attendance register. Cannot produce a league table: only our own matches '
  'are ever known.';
comment on column match_results.our_periods is
  'Cumulative-per-period scores, ours. The checkpoints a referto import is '
  'validated against.';

/*
  A result may only be recorded against a match. A calendar event that is a
  training session or a club meeting has no score, and `opponent` is the column
  that says which is which — migration 0021 put it there precisely so a match
  needed no second table.
*/
create or replace function app.assert_event_is_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_opponent text;
begin
  select opponent into v_opponent from calendar_events where id = new.event_id;
  if v_opponent is null then
    raise exception 'A result can only be recorded for a match (event % has no opponent).',
      new.event_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_match_results_event_is_match
  before insert or update of event_id on match_results
  for each row execute function app.assert_event_is_match();

-- -----------------------------------------------------------------------------
-- match_box_scores — where the numbers came from
-- -----------------------------------------------------------------------------
alter table match_box_scores
  add column source box_score_source not null default 'MANUAL';

comment on column match_box_scores.source is
  'MANUAL means somebody typed it. REFERTO means it was derived from a game '
  'sheet, which records no shot attempts — so attempted = made, and neither '
  'shooting percentage nor efficiency is meaningful for such a row.';

-- -----------------------------------------------------------------------------
-- match_sheets — the photograph, and what was made of it
--
-- Hung off the register rather than the result, because the sheet is evidence
-- about a squad: it names twelve players, says which five started and how many
-- fouls each committed, and only incidentally carries the final score. A
-- register must already exist for the match before a sheet can be imported
-- against it — the sheet never creates the match it describes.
-- -----------------------------------------------------------------------------
create table match_sheets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  register_id uuid not null references attendance_registers (id) on delete cascade,

  -- Path within the `match-sheets` bucket: <tenant_id>/<register_id>/<id>.<ext>.
  -- The tenant id leads because the storage policies below read it back out of
  -- the path; a file whose first segment is not the caller's club is invisible.
  storage_path text not null unique
    constraint match_sheets_path_length check (length(storage_path) between 1 and 1024),
  /*
    Images only, and only the three every vision model reads natively. A phone
    may produce HEIC, and a federation may email a PDF; neither is accepted
    here, because storing a file the reader cannot read would be a feature that
    appears to work. The upload input asks for these three, which is what makes
    iOS hand over a JPEG.
  */
  mime_type   text not null
    constraint match_sheets_mime check (mime_type in (
      'image/jpeg', 'image/png', 'image/webp'
    )),
  byte_size   int not null constraint match_sheets_size check (byte_size between 1 and 10485760),

  state       match_sheet_state not null default 'UPLOADED',

  /*
    Two JSON columns, deliberately separate.

    `transcription` is what the model said it saw: roster rows and ladder
    entries, no arithmetic. `reading` is what our own deterministic code made of
    that — derived points per player, and the result of every check in
    docs/referto-import.md §5. Keeping them apart is what makes a disputed
    import answerable: you can see whether the model misread the paper or our
    code misread the model, and you can re-derive the second without paying to
    re-read the photograph.
  */
  transcription jsonb,
  reading       jsonb,

  -- Which model produced the transcription. A reading that is challenged in
  -- March is not answerable without it.
  read_model  text,
  -- Why it failed, in words a club secretary can act on: which check broke and
  -- what the arithmetic was.
  failure     text,

  imported_at timestamptz,
  imported_by uuid references profiles (id) on delete set null,
  uploaded_by uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint match_sheets_imported_fields check (
    state <> 'IMPORTED' or (imported_at is not null and reading is not null)
  ),
  constraint match_sheets_failure_belongs_to_failure check (
    failure is null or state = 'FAILED'
  )
);

create index match_sheets_register_idx on match_sheets (register_id, created_at desc);
create index match_sheets_tenant_state_idx on match_sheets (tenant_id, state);

select app.attach_touch_trigger('match_sheets');

create trigger trg_match_sheets_register_tenant
  before insert or update of register_id, tenant_id on match_sheets
  for each row execute function app.assert_same_tenant('attendance_registers', 'register_id');

comment on table match_sheets is
  'An uploaded photograph of a game sheet, the model transcription of it, and '
  'the deterministic reading derived from that transcription.';

-- -----------------------------------------------------------------------------
-- Row level security
--
-- Results follow attendance rather than competitions: the person who marks the
-- register on Sunday evening is the person who knows the score, and asking a
-- club to grant a second permission to type it in would mean it never gets
-- typed in.
-- -----------------------------------------------------------------------------
select app.apply_tenant_rls('match_results',
  'attendance.read', 'attendance.record', 'attendance.record', 'attendance.manage');
select app.apply_tenant_rls('match_sheets',
  'attendance.read', 'attendance.record', 'attendance.record', 'attendance.manage');

-- -----------------------------------------------------------------------------
-- Storage
--
-- The club's first uploaded files, so this is also the first storage bucket.
-- Private: a game sheet is a page of children's surnames and birth years, and
-- a public bucket would put it behind a guessable URL forever. Everything is
-- served through short-lived signed URLs minted server-side after a permission
-- check.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-sheets', 'match-sheets', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
  Tenant isolation for objects, read out of the path.

  The first folder of every key is the owning club's id, so membership is a
  question about `(storage.foldername(name))[1]`. A malformed key — anything
  whose first segment is not a uuid — is rejected by the cast inside the
  `app.has_permission` call rather than falling through to a permissive branch,
  which is why the uuid cast is in the policy and not wrapped in a try.

  These four are written out rather than put through `app.apply_tenant_rls`,
  which only knows tables with a `tenant_id` column.
*/
create policy match_sheets_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'match-sheets'
    and app.has_permission(((storage.foldername(name))[1])::uuid, 'attendance.read')
  );

create policy match_sheets_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'match-sheets'
    and app.has_permission(((storage.foldername(name))[1])::uuid, 'attendance.record')
  );

create policy match_sheets_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'match-sheets'
    and app.has_permission(((storage.foldername(name))[1])::uuid, 'attendance.record')
  )
  with check (
    bucket_id = 'match-sheets'
    and app.has_permission(((storage.foldername(name))[1])::uuid, 'attendance.record')
  );

create policy match_sheets_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'match-sheets'
    and app.has_permission(((storage.foldername(name))[1])::uuid, 'attendance.manage')
  );
