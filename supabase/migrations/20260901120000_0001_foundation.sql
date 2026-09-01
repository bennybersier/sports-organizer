-- =============================================================================
-- 0001 FOUNDATION
-- Extensions, private `app` schema, shared enums, and generic helpers.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Private schema. Nothing here is exposed through PostgREST; it holds the
-- security-definer helpers that RLS policies depend on.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums (public: PostgREST must be able to resolve column types)
-- -----------------------------------------------------------------------------
create type tenant_status          as enum ('ACTIVE', 'SUSPENDED', 'DELETED');
create type membership_status      as enum ('ACTIVE', 'SUSPENDED');
create type invitation_status      as enum ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
create type override_effect        as enum ('ALLOW', 'DENY');
create type season_status          as enum ('DRAFT', 'ACTIVE', 'ARCHIVED');
create type entity_status          as enum ('ACTIVE', 'INACTIVE', 'ARCHIVED');
create type gender_category        as enum ('MALE', 'FEMALE', 'MIXED', 'OTHER', 'UNSPECIFIED');
create type membership_state       as enum ('ACTIVE', 'TRIAL', 'INACTIVE', 'SUSPENDED');
create type availability_exception_type as enum ('UNAVAILABLE', 'AVAILABLE_OVERRIDE');
create type schedule_version_status as enum ('DRAFT', 'GENERATING', 'GENERATED', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED', 'FAILED');
create type schedule_entry_status  as enum ('PROPOSED', 'SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');
create type calendar_event_type    as enum ('MATCH', 'TOURNAMENT', 'HOLIDAY', 'BLACKOUT', 'SPECIAL_EVENT', 'MEETING', 'TRAINING');
create type calendar_event_status  as enum ('SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED');
create type validation_state       as enum ('VALID', 'WARNING', 'CONFLICT', 'INVALID');
create type ai_provider            as enum ('GEMINI', 'ANTHROPIC', 'OPENAI');
create type integration_provider   as enum ('GOOGLE_CALENDAR');
create type integration_status     as enum ('CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED');
create type notification_channel   as enum ('IN_APP', 'EMAIL');
create type job_status             as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- Range over `time` — used by availability exclusion constraints so the
-- database itself rejects contradictory (overlapping) availability windows.
create type timerange as range (subtype = time);

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Attaches the standard updated_at trigger to a table.
create or replace function app.attach_touch_trigger(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger trg_touch_updated_at before update on %s for each row execute function app.touch_updated_at()',
    p_table
  );
end;
$$;
