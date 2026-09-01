-- =============================================================================
-- 0006 SAAS OPERATIONS
-- audit logs, notifications, integrations, AI configuration, OAuth, MCP keys.
--
-- Every secret in here is either hashed (MCP) or encrypted server-side (AI keys,
-- OAuth tokens). Ciphertext columns are never selectable by clients: the RLS
-- policies in 0008 expose only the metadata views for these tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_logs — append-only record of important mutations.
-- -----------------------------------------------------------------------------
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  actor_id      uuid references profiles (id) on delete set null,
  -- How the change arrived: WEB, MCP, AI, INTEGRATION, JOB, SYSTEM.
  actor_type    text not null default 'WEB',
  action        text not null,
  resource_type text not null,
  resource_id   uuid,
  old_value     jsonb,
  new_value     jsonb,
  -- Reason supplied when a user knowingly overrode a soft constraint.
  reason        text,
  metadata      jsonb not null default '{}'::jsonb,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index audit_logs_tenant_time_idx on audit_logs (tenant_id, created_at desc);
create index audit_logs_resource_idx on audit_logs (tenant_id, resource_type, resource_id);
create index audit_logs_actor_idx on audit_logs (tenant_id, actor_id, created_at desc);
create index audit_logs_action_idx on audit_logs (tenant_id, action, created_at desc);

-- Audit rows are immutable once written.
create or replace function app.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger trg_audit_logs_immutable
  before update or delete on audit_logs
  for each row execute function app.reject_mutation();

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  user_id       uuid not null references profiles (id) on delete cascade,
  type          text not null,
  title         text not null,
  body          text,
  -- Where clicking the notification should take the user.
  link          text,
  data          jsonb not null default '{}'::jsonb,
  -- Collapses repeated updates about the same thing into one notification.
  dedupe_key    text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id, tenant_id) where read_at is null;
create unique index notifications_dedupe_uniq on notifications (tenant_id, user_id, dedupe_key)
  where dedupe_key is not null and read_at is null;

create table notification_preferences (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id) on delete cascade,
  user_id       uuid not null references profiles (id) on delete cascade,
  type          text not null,
  channel       notification_channel not null,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, user_id, type, channel)
);
select app.attach_touch_trigger('notification_preferences');

-- Outbox so email delivery is asynchronous, retryable and observable.
create table email_outbox (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants (id) on delete cascade,
  to_email      text not null,
  template      text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        job_status not null default 'QUEUED',
  attempts      smallint not null default 0,
  error_message text,
  dedupe_key    text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index email_outbox_queue_idx on email_outbox (status, created_at) where status = 'QUEUED';
create unique index email_outbox_dedupe_uniq on email_outbox (dedupe_key) where dedupe_key is not null;
select app.attach_touch_trigger('email_outbox');

-- -----------------------------------------------------------------------------
-- ai_provider_configurations — per-tenant BYO-key AI configuration.
-- api_key_ciphertext never leaves the server.
-- -----------------------------------------------------------------------------
create table ai_provider_configurations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  provider           ai_provider not null,
  model              text not null,
  -- AES-256-GCM envelope, base64. Decrypted only in server-side code.
  api_key_ciphertext text not null,
  -- Last 4 characters, for "sk-...a1b2" style display. Never the whole key.
  api_key_hint       text not null check (length(api_key_hint) <= 8),
  is_enabled         boolean not null default true,
  -- Only one provider is active per tenant at a time.
  is_default         boolean not null default false,
  config             jsonb not null default '{}'::jsonb,
  last_verified_at   timestamptz,
  last_error         text,
  created_by         uuid references profiles (id) on delete set null,
  updated_by         uuid references profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, provider)
);
create unique index ai_provider_one_default on ai_provider_configurations (tenant_id) where is_default;
select app.attach_touch_trigger('ai_provider_configurations');

-- -----------------------------------------------------------------------------
-- integrations / oauth_connections
-- -----------------------------------------------------------------------------
create table integrations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  provider        integration_provider not null,
  status          integration_status not null default 'DISCONNECTED',
  -- Non-secret settings: target calendar id, sync direction, ...
  settings        jsonb not null default '{}'::jsonb,
  last_sync_at    timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, provider)
);
select app.attach_touch_trigger('integrations');

-- OAuth is per user, not per tenant: the calendar belongs to a person.
create table oauth_connections (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants (id) on delete cascade,
  user_id               uuid not null references profiles (id) on delete cascade,
  provider              integration_provider not null,
  external_account_id   text not null,
  external_account_email text,
  -- AES-256-GCM envelopes. Refresh tokens never reach the browser.
  access_token_ciphertext  text,
  refresh_token_ciphertext text,
  token_expires_at      timestamptz,
  scopes                text[] not null default '{}',
  status                integration_status not null default 'CONNECTED',
  last_sync_at          timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id, user_id, provider)
);
create index oauth_connections_user_idx on oauth_connections (user_id, provider);
select app.attach_touch_trigger('oauth_connections');

-- Maps our events to provider events so re-syncing never duplicates.
create table calendar_sync_links (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  connection_id     uuid not null references oauth_connections (id) on delete cascade,
  -- Exactly one of these is set.
  schedule_entry_id uuid references schedule_entries (id) on delete cascade,
  calendar_event_id uuid references calendar_events (id) on delete cascade,
  external_calendar_id text not null,
  external_event_id text not null,
  -- Provider etag/sequence, so we can detect external edits.
  external_version  text,
  last_synced_at    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sync_links_one_source check (
    (schedule_entry_id is not null)::int + (calendar_event_id is not null)::int = 1
  )
);
create unique index calendar_sync_links_external_uniq on calendar_sync_links (connection_id, external_calendar_id, external_event_id);
create unique index calendar_sync_links_entry_uniq on calendar_sync_links (connection_id, schedule_entry_id) where schedule_entry_id is not null;
create unique index calendar_sync_links_event_uniq on calendar_sync_links (connection_id, calendar_event_id) where calendar_event_id is not null;
select app.attach_touch_trigger('calendar_sync_links');

-- -----------------------------------------------------------------------------
-- mcp_api_keys — machine credentials. Only the hash is stored, ever.
-- -----------------------------------------------------------------------------
create table mcp_api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  -- The human the key acts as. Permissions resolve through this user.
  user_id      uuid not null references profiles (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 100),
  -- sha256 of the raw secret. The raw secret is displayed once, at creation.
  secret_hash  text not null,
  -- Non-secret prefix ("sco_live_ab12") used to identify the key in lists/logs.
  key_prefix   text not null,
  -- Subset of the user's permissions this key may exercise. Never a superset.
  scopes       text[] not null default '{}',
  last_used_at timestamptz,
  last_used_ip inet,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references profiles (id) on delete set null,
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index mcp_api_keys_secret_hash_uniq on mcp_api_keys (secret_hash);
create unique index mcp_api_keys_prefix_uniq on mcp_api_keys (key_prefix);
create index mcp_api_keys_tenant_idx on mcp_api_keys (tenant_id) where revoked_at is null;
create index mcp_api_keys_user_idx on mcp_api_keys (user_id) where revoked_at is null;
select app.attach_touch_trigger('mcp_api_keys');

-- -----------------------------------------------------------------------------
-- onboarding_progress — which setup steps a tenant has completed.
-- -----------------------------------------------------------------------------
create table onboarding_progress (
  tenant_id     uuid primary key references tenants (id) on delete cascade,
  completed_steps text[] not null default '{}',
  skipped_steps text[] not null default '{}',
  dismissed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
select app.attach_touch_trigger('onboarding_progress');
