# Sport Club Organizer

Multi-tenant SaaS for running a sports club: seasons, teams, athletes, trainers,
gyms, recurring availability, a calendar, and a deterministic engine that
generates a weekly training schedule the club can actually rely on.

**Status: Phase 1 (Foundation) complete.** See [Roadmap](#roadmap).

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Database | Postgres via Supabase, with Row Level Security on every table |
| Auth | Supabase Auth — email/password and Google. No public sign-up. |
| UI | Tailwind CSS 4, shadcn/ui |
| Validation | Zod 4 + React Hook Form |

---

## Getting started

### 1. Create a Supabase project

At [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
Then in **Project Settings → API Keys**, copy the project URL, the
**publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`).

> The older `anon` / `service_role` JWT keys still work and are accepted, but
> Supabase deprecates them at the end of 2026 — the app logs a warning if it
> sees one. Prefer the new keys.


### 2. Configure the environment

```bash
cp .env.example .env.local
openssl rand -base64 32   # paste into ENCRYPTION_KEY
```

Fill in the Supabase values. Every variable is validated at startup by
[`src/env.ts`](src/env.ts) — the app refuses to boot half-configured rather than
failing mysteriously later.

### 3. Apply the database schema

```bash
pnpm install
supabase login
pnpm db:link <your-project-ref>     # the ref is in your project URL
pnpm db:push                        # applies supabase/migrations in order
```

### 4. Turn off public sign-up

In **Authentication → Sign In / Providers**, disable *Allow new users to sign
up*. The product is invitation-only by design; this makes the database's
position and the auth provider's position agree.

While you're there, enable **Google** and add
`https://<your-project>.supabase.co/auth/v1/callback` as an authorized redirect
URI in the Google Cloud console.

### 5. Create the first club and its owner

There is no public sign-up, and invitations must come from an existing Owner —
so the very first account is created from the command line, from a machine
that already holds the secret key:

```bash
pnpm bootstrap:club --email you@club.example --name "Riverside Athletics"
```

Without `--password`, this sends a Supabase invite email so you can choose your
own. Add `--password '<something long>'` to skip the email in local development.

### 6. Optional: seed development data

```bash
pnpm db:seed
```

Creates a season, 5 teams, 6 trainers, 3 gyms, ~62 athletes and a full week of
availability — including two deliberate scheduling conflicts, so the conflict UI
has something real to render rather than a happy path.

### 7. Run it

```bash
pnpm dev
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:link <ref>` | Link the CLI to a Supabase project |
| `pnpm db:push` | Apply migrations |
| `pnpm db:diff <name>` | Generate a migration from dashboard changes |
| `pnpm db:types` | Regenerate `src/types/database.ts` from the live schema |
| `pnpm db:seed` | Seed development data (`--reset` to wipe first) |
| `pnpm bootstrap:club` | Create the first club and Owner |

---

## Architecture

The guiding rule: **the web UI, the API, AI, Google, and MCP are all different
interfaces to one secure application domain.** None of them gets a private door.

```
UI / Server Action / Route Handler / MCP tool / Background job
                          │
                   AuthContext          user + club + role + resolved permissions
                          │
              Authorization service     requirePermission / assertOutranks
                          │
                Application service     business rules, transactions, audit
                          │
                       Postgres         constraints + RLS as the final word
```

### Authorization

Permission resolution is defined once and implemented twice — identically — so
neither layer can be bypassed:

```
explicit user override  >  role permission  >  deny by default
```

- In TypeScript: [`src/server/auth/authorization.ts`](src/server/auth/authorization.ts)
- In SQL: `app.has_permission()` in
  [`…_0008_authorization.sql`](supabase/migrations/20260901120700_0008_authorization.sql),
  which every RLS policy calls

The application check is the first line of defence; RLS is the second. A bug in
the first cannot leak another club's data through a user-scoped client.

**Tenant resolution never trusts the client.** The active club lives in a
cookie, but the cookie only *selects* among clubs the user already belongs to —
membership is re-resolved from `auth.uid()` on every request. A forged value
resolves to nothing.

### Where the secret key is allowed

`createAdminClient()` uses `SUPABASE_SECRET_KEY` and bypasses RLS, so its uses
are deliberately few, and each performs its own authorization first:

- reading and writing secret-bearing tables (`ai_provider_configurations`,
  `oauth_connections`, `mcp_api_keys`, `calendar_sync_links`, `email_outbox`),
  which have **no grants at all** for `authenticated`
- writing `audit_logs`, which clients cannot insert into — an audit trail a
  client can write is not an audit trail
- issuing and previewing invitations, which must touch rows the recipient
  cannot yet read
- background jobs and MCP, which have no user JWT to present

### Secrets

| Secret | Treatment |
| --- | --- |
| Tenant AI provider keys | AES-256-GCM encrypted at rest, decrypted server-side only |
| Google OAuth refresh tokens | AES-256-GCM encrypted at rest, never sent to the browser |
| MCP API keys | SHA-256 hashed; the raw value is shown once at creation |
| Invitation tokens | SHA-256 hashed; matched by hash, never stored raw |

`src/server/services/audit-service.ts` additionally scrubs anything whose key
looks like a credential before writing, so a diff built from a row can't
smuggle one into the log.

### Scheduling (Phase 5)

The optimizer will be a **deterministic constraint engine**, not an LLM. It takes
structured input and returns structured output, testable with in-memory data and
no database. AI can explain a schedule, interpret a preference written in prose,
or suggest an adjustment — but it is never the authority on whether a schedule
is valid.

The database already enforces the hard invariants directly, via exclusion
constraints on `schedule_entries`: within a schedule version, no gym, trainer or
team can be double-booked. Overlapping availability windows are rejected the same
way.

---

## Database

35 tables across 10 versioned migrations in [`supabase/migrations/`](supabase/migrations/).

| Migration | Contents |
| --- | --- |
| `0001_foundation` | Extensions, private `app` schema, enums, `timerange` type |
| `0002_tenancy_rbac` | profiles, tenants, roles, permissions, memberships, overrides, invitations |
| `0003_domain_entities` | seasons, gyms, trainers, teams, athletes and their links |
| `0004_availability` | Recurring availability + exceptions, training requirements |
| `0005_scheduling` | Schedule versions, entries, calendar events, jobs |
| `0006_operations` | Audit, notifications, email outbox, AI config, OAuth, MCP keys |
| `0007_permissions_seed` | Permission catalogue and the role → permission matrix |
| `0008_authorization` | `app.has_permission` and friends — the RLS primitives |
| `0009_rls_policies` | RLS on every table |
| `0010_invariants_rpc` | Last-owner guard, tenant provisioning, invitation acceptance, transactional publish |

**Availability model.** Recurring weekly windows plus date-specific exceptions.
Weekdays are ISO-8601 (1 = Monday … 7 = Sunday, matching `extract(isodow)`).
Times are wall-clock in the club's scheduling timezone; a window running to
midnight uses `end_time = '24:00'`, and one that truly crosses midnight is stored
as two rows, so every row satisfies `start < end`. Overlapping windows for the
same owner are rejected by exclusion constraints rather than silently merged.

**Delete behaviour.** Historical scheduling data is never destroyed to tidy up a
roster. Entities soft-delete (`deleted_at`); seasons and schedule versions
archive; team and trainer assignments keep `left_at` / `unassigned_at` so past
squads remain reconstructable.

---

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: schema, RLS, auth, tenancy, RBAC, app shell | **Done** |
| 2 | Seasons, teams, athletes, trainers, gyms | Next |
| 3 | Availability editors, exceptions, team preferences | |
| 4 | Calendar: views, filters, drag/drop, conflict detection | |
| 5 | Scheduling engine: constraints, candidates, optimizer, explanations | |
| 6 | Review and publishing workflow | |
| 7 | Invitations, notifications, audit UI, settings, onboarding | |
| 8 | Google Calendar sync, AI provider configuration | |
| 9 | MCP server: credentials, scopes, tools | |
| 10 | Hardening: tests, security tests, performance, a11y, observability | |
