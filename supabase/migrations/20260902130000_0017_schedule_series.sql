-- Groups the occurrences of one recurring training slot.
--
-- A generated schedule is a weekly pattern materialised across the season, so
-- "U16, Tuesdays, 18:00, Hall A" exists as one row per week. Without a shared
-- identity those rows are unrelated, and the only removal action the app could
-- offer was withdrawing the entire schedule — every team, every day — which is
-- not what anyone means by cancelling a training.
--
-- The default matters: any row inserted without a series is its own series of
-- one, so a manually added session behaves sensibly rather than joining
-- someone else's slot.
alter table schedule_entries
  add column series_id uuid not null default gen_random_uuid();

-- Existing rows each become their own series. Correct rather than merely
-- convenient: before this migration a schedule only ever held one week, so no
-- two rows were ever occurrences of the same slot.
comment on column schedule_entries.series_id is
  'Occurrences of one recurring weekly slot share this. Cancel one occurrence, or the whole series.';

create index schedule_entries_series_idx on schedule_entries (tenant_id, series_id, start_at);
