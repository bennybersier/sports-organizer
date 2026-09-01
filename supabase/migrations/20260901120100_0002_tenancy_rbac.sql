-- =============================================================================
-- 0002 TENANCY & RBAC
-- profiles, tenants, roles, permissions, memberships, overrides, invitations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — one row per auth.users row. Created by trigger on signup.
-- -----------------------------------------------------------------------------
create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  locale        text not null default 'en',
  timezone      text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_email_lower check (email = lower(email))
);
create unique index profiles_email_key on profiles (email);
select app.attach_touch_trigger('profiles');

-- -----------------------------------------------------------------------------
-- tenants — one sports club / organization.
-- -----------------------------------------------------------------------------
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 200),
  slug          text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  timezone      text not null default 'Europe/Zurich',
  locale        text not null default 'en',
  -- ISO-8601 weekday the club's week starts on: 1 = Monday .. 7 = Sunday.
  week_start    smallint not null default 1 check (week_start between 1 and 7),
  logo_url      text,
  status        tenant_status not null default 'ACTIVE',
  -- Free-form club preferences (scheduling defaults, notification defaults, ...).
  settings      jsonb not null default '{}'::jsonb,
  -- Reserved so subscription/billing can be layered on without reshaping tenancy.
  plan          text not null default 'free',
  created_by    uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index tenants_slug_key on tenants (slug) where deleted_at is null;
select app.attach_touch_trigger('tenants');

-- -----------------------------------------------------------------------------
-- permissions — the global taxonomy. Seeded by migration, not user editable.
-- -----------------------------------------------------------------------------
create table permissions (
  key          text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  resource     text not null,
  action       text not null,
  description  text not null,
  -- Grouping used to render the permission matrix.
  category     text not null,
  sort_order   int  not null default 0
);

-- -----------------------------------------------------------------------------
-- roles — system roles have tenant_id IS NULL and are shared by every tenant.
-- Tenant-scoped custom roles are supported by the shape, not yet by the UI.
-- -----------------------------------------------------------------------------
create table roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references tenants (id) on delete cascade,
  key          text not null check (key ~ '^[A-Z_]+$'),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  -- Lower rank = more privileged. Used to stop a user editing someone above them.
  rank         int not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint roles_system_has_no_tenant check ((is_system and tenant_id is null) or (not is_system and tenant_id is not null))
);
create unique index roles_tenant_key_uniq on roles (tenant_id, key) nulls not distinct;
create index roles_tenant_idx on roles (tenant_id);
select app.attach_touch_trigger('roles');

create table role_permissions (
  role_id        uuid not null references roles (id) on delete cascade,
  permission_key text not null references permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);
create index role_permissions_permission_idx on role_permissions (permission_key);

-- -----------------------------------------------------------------------------
-- tenant_memberships — the join between a user and a club, carrying the role.
-- -----------------------------------------------------------------------------
create table tenant_memberships (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  user_id      uuid not null references profiles (id) on delete cascade,
  role_id      uuid not null references roles (id) on delete restrict,
  status       membership_status not null default 'ACTIVE',
  title        text,
  joined_at    timestamptz not null default now(),
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index tenant_memberships_user_idx on tenant_memberships (user_id) where status = 'ACTIVE';
create index tenant_memberships_tenant_idx on tenant_memberships (tenant_id, status);
create index tenant_memberships_role_idx on tenant_memberships (role_id);
select app.attach_touch_trigger('tenant_memberships');

-- Every tenant must keep at least one active Owner. Enforced by trigger in 0009.

-- -----------------------------------------------------------------------------
-- user_permission_overrides — explicit per-user ALLOW/DENY on top of the role.
-- Resolution order: override > role permission > deny.
-- -----------------------------------------------------------------------------
create table user_permission_overrides (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  user_id        uuid not null references profiles (id) on delete cascade,
  permission_key text not null references permissions (key) on delete cascade,
  effect         override_effect not null,
  reason         text,
  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, user_id, permission_key)
);
create index user_permission_overrides_lookup_idx on user_permission_overrides (tenant_id, user_id);
select app.attach_touch_trigger('user_permission_overrides');

-- -----------------------------------------------------------------------------
-- invitations — the only way into a tenant. Token is stored hashed.
-- -----------------------------------------------------------------------------
create table invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id) on delete cascade,
  email        text not null check (email = lower(email)),
  role_id      uuid not null references roles (id) on delete restrict,
  -- sha256 of the raw token. The raw token is shown to the inviter exactly once.
  token_hash   text not null,
  status       invitation_status not null default 'PENDING',
  message      text,
  expires_at   timestamptz not null,
  invited_by   uuid references profiles (id) on delete set null,
  accepted_by  uuid references profiles (id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint invitations_expiry_future check (expires_at > created_at)
);
create unique index invitations_token_hash_key on invitations (token_hash);
create unique index invitations_pending_uniq on invitations (tenant_id, email) where status = 'PENDING';
create index invitations_email_idx on invitations (email) where status = 'PENDING';
create index invitations_tenant_idx on invitations (tenant_id, status);
select app.attach_touch_trigger('invitations');

-- -----------------------------------------------------------------------------
-- Profile bootstrap: mirror auth.users into profiles.
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Phone-only signups have no email; there is nothing to mirror.
  if new.email is null then
    return new;
  end if;

  insert into profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(profiles.full_name, excluded.full_name),
        avatar_url = coalesce(profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function app.handle_new_user();
