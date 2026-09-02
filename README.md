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
| `pnpm platform:admin` | Grant, revoke or list platform administrators |
| `pnpm i18n:check` | Verify every locale has every message key |

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

### Platform administrators

A platform admin is staff of the *system*, not a member of any club: they hold
no `tenant_membership` yet can administer every club, for support and
operations. Granted only from the command line:

```bash
pnpm platform:admin --list
pnpm platform:admin --email you@example.com --note "why they have this"
pnpm platform:admin --email you@example.com --revoke
```

This deliberately punches a hole in tenant isolation, so it is built to be
narrow and observable:

- The grant lives in `platform_admins`, a table with **no privileges for
  `authenticated`** — it is emphatically *not* a boolean on `profiles`, which
  carries a self-update policy and would therefore make the flag
  self-assignable.
- The bypass is folded into `app.is_tenant_member()` and `app.has_permission()`,
  so it takes effect in exactly one place rather than as a special case across
  ~40 policies — and any policy added later inherits it automatically.
- Entering a club is written to *that club's* audit log, and the app shows a
  persistent banner while staff are inside a club they don't belong to.

Verified against the live database: a signed-in non-admin cannot read or write
`platform_admins` (403 both ways), `profiles` exposes no privilege column, and
`admin_list_tenants()` returns nothing to anyone who isn't staff.

### Bootstrapping: who invites the first person?

There is no public sign-up, so account creation always traces back to an
authority. That creates a chicken-and-egg problem at the very start — a club
needs an Owner with an account, and an account needs an invitation, which needs
a club — and it is broken in exactly two places:

1. `pnpm bootstrap:club`, run from a machine holding the secret key.
2. A platform admin creating a club. If the owner's address has no account, one
   is created and an invitation link is issued in the same step.

Neither is a loophole: both require an authority that already exists. Everything
after that flows through ordinary club invitations.

Until email lands in Phase 7, that invitation link is handed back in the UI for
the admin to pass on. It is generated with `generateLink` rather than
`inviteUserByEmail` deliberately — the latter depends on SMTP being configured,
and would otherwise half-succeed by creating an account whose invitation email
silently failed to send.

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

36 tables across 12 versioned migrations in [`supabase/migrations/`](supabase/migrations/).

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
| `0011_platform_admin` | System staff: the grant table, the bypass, and the admin console RPCs |
| `0012_error_messages_and_owner_guard` | Owner guard no longer blocks club deletion; user-facing messages survive the error mapper |

**Availability model.** Recurring weekly windows plus date-specific exceptions.
Weekdays are ISO-8601 (1 = Monday … 7 = Sunday, matching `extract(isodow)`).
Times are wall-clock in the club's scheduling timezone; a window running to
midnight uses `end_time = '24:00'`, and one that truly crosses midnight is stored
as two rows, so every row satisfies `start < end`. Overlapping windows for the
same owner are rejected by exclusion constraints rather than silently merged.

**Error messages.** SQLSTATEs alone can't distinguish "Postgres rejected a
constraint" (technical, must not be shown) from "our function raised copy
written for a human". Deliberate raises therefore carry
`HINT = 'SCO_USER_MESSAGE'`, which Postgres never sets itself; `fromDatabaseError`
shows those messages verbatim and falls back to a generic one for everything
else. Without it, "No account exists for that email" surfaced as "That club
could not be found" — unhelpful, and untrue.

**Delete behaviour.** Historical scheduling data is never destroyed to tidy up a
roster. Entities soft-delete (`deleted_at`); seasons and schedule versions
archive; team and trainer assignments keep `left_at` / `unassigned_at` so past
squads remain reconstructable.

---

## Collections

Every list page works the same way, and all of it happens in Postgres:

- **Search, filter, sort and paging live in the URL.** The server component
  reads `searchParams`, so a filtered view is linkable and survives a refresh —
  and no page ever pulls a table into the browser to filter it there.
- **Empty states distinguish "nothing yet" from "nothing matched".** The first
  needs a way to create something; the second needs a way to clear the filter.
- **Permission-denied is its own state.** Pages check before reading, so a user
  without `gyms.read` sees an explanation rather than "Something went wrong".
  The service still asserts underneath — that is the control, this is the face.
- **Archive, not delete.** Past sessions reference teams, gyms and trainers, so
  everything archives. Removing a trainer from a team sets `unassigned_at`, and
  an athlete leaving a squad sets `left_at`, keeping the record of who trained
  what and when.

Related counts use a grouped query rather than a PostgREST embed — embeds need
relationship metadata the hand-written schema types don't carry yet. That is one
extra indexed query per page, not an N+1, and it becomes an embed the day
`pnpm db:types` can run.

## Internationalisation

English and Italian, with no locale URL prefix. The whole app sits behind
authentication and is marked `noindex`, so the SEO case for `/en/…` and `/it/…`
does not apply — and language is a property of the person, not the URL, so a
link shared between colleagues who read different languages still works for
both.

Locale resolves per request: the `sco_locale` cookie, then `Accept-Language`,
then English. Choosing a language writes both the cookie (what every request
reads, so no database round-trip per page) and the profile (what makes the
choice follow someone to a new device — signing in seeds the cookie from it).

```bash
pnpm i18n:check   # every en key exists in every other locale, no extras
```

English is the reference catalogue and is what types the keys, so `t("nav.tems")`
is a build error. TypeScript can't catch a key *missing from Italian* though —
that is what `i18n:check` is for, and it runs 163 keys against each locale.

One screen is deliberately untranslated: `global-error.tsx` renders when the
root layout itself failed, which means the provider never mounted.

Adding a language: drop `messages/<code>.json` in, add the code to `LOCALES` in
`src/i18n/config.ts`, run `pnpm i18n:check`.

## Theming

Light, dark and system, via `next-themes` with a `class` strategy and tokens
defined for both in `globals.css`. The picker sits in the account menu next to
the language picker. `suppressHydrationWarning` on `<html>` is required and
intentional: the theme class is applied by a blocking inline script before
first paint, so the server-rendered markup cannot match.

Fonts are the platform's own UI stack — nothing is downloaded, so there is no
font request and no swap flash.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: schema, RLS, auth, tenancy, RBAC, app shell | **Done** |
| 2 | Seasons, teams, athletes, trainers, gyms | **Done** |
| 3 | Availability editors, exceptions, team preferences | Next |
| 4 | Calendar: views, filters, drag/drop, conflict detection | |
| 5 | Scheduling engine: constraints, candidates, optimizer, explanations | |
| 6 | Review and publishing workflow | |
| 7 | Invitations, notifications, audit UI, settings, onboarding | |
| 8 | Google Calendar sync, AI provider configuration | |
| 9 | MCP server: credentials, scopes, tools | |
| 10 | Hardening: tests, security tests, performance, a11y, observability | |
