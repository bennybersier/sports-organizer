# Sport Club Organizer SaaS — Master Development Prompt

## 1. ROLE

You are a senior staff-level full-stack engineer, software architect, security engineer, database engineer, and product engineer.

Build a production-grade multi-tenant SaaS platform for managing sports clubs, teams, athletes, trainers, gyms, recurring availability, calendars, seasons, and intelligent training schedule generation.

The application must be designed as a real SaaS product from the beginning.

Do not build a prototype, toy application, static mockup, or collection of disconnected CRUD screens.

All important functionality must be implemented end-to-end:

Frontend → authorization → server-side application logic → database → RLS/security → validation → error handling → UI state.

Do not fake functionality with hardcoded arrays or local-only state when the functionality is supposed to persist in the database.

---

# 2. CORE TECHNOLOGY STACK

Use:

- Next.js
- TypeScript
- Next.js App Router
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Row Level Security
- Supabase Storage where appropriate
- Supabase Realtime where appropriate
- Tailwind CSS
- shadcn/ui
- React
- Zod for validation
- React Hook Form where forms are appropriate

Use modern Next.js server-side patterns.

Prefer:

- Server Components for data-heavy read views
- Server Actions for mutations where appropriate
- Route Handlers for APIs/webhooks/integration endpoints
- Server-side authorization
- Database-side authorization through RLS

Avoid unnecessary client-side data fetching.

---

# 3. PRODUCT

The product is a sports club management and scheduling platform.

A tenant represents one sports club / organization.

A user can belong to multiple tenants.

Each tenant has isolated:

- users/memberships
- teams
- athletes
- trainers
- gyms
- seasons
- availabilities
- schedules
- events
- integrations
- AI configuration
- audit logs
- MCP credentials

No tenant must ever be able to access another tenant's data.

---

# 4. MULTI-TENANCY

Implement first-class multi-tenancy.

Core concepts:

- User
- Tenant
- Tenant Membership
- Role
- Permission
- User Permission Override

A user may belong to multiple tenants.

The active tenant must always be explicitly represented in the application context.

Never trust a tenant ID supplied by the client.

The server must resolve and validate:

```text
authenticated user
        ↓
tenant membership
        ↓
active tenant
        ↓
permissions
        ↓
authorized operation
```

Every tenant-owned record must contain a tenant_id either directly or through an explicitly justified relational structure.

Use database constraints and RLS to enforce isolation.

Do not rely exclusively on frontend checks.

---

# 5. AUTHENTICATION

Use Supabase Auth.

Supported authentication:

- Email/password
- Email invitation
- Google OAuth
- Password reset
- Email verification
- Session management

There is NO public self-registration.

Users can only enter the system through:

1. An administrator/owner invitation
2. An authorized Google OAuth flow associated with an existing/authorized membership

Do not automatically create arbitrary tenant memberships from a Google login.

A user may have multiple tenant memberships.

After authentication, provide a tenant selector when the user belongs to multiple tenants.

---

# 6. ROLES

Initial system roles:

1. Owner
2. Admin
3. Organizer
4. Trainer
5. Team Manager
6. Athlete

Do NOT implement a Viewer role.

Roles provide default permissions.

Permissions must be granular.

Examples:

```text
tenant.read
tenant.update
tenant.delete

members.read
members.invite
members.update
members.remove

roles.read
roles.update

teams.read
teams.create
teams.update
teams.delete

athletes.read
athletes.create
athletes.update
athletes.delete

trainers.read
trainers.create
trainers.update
trainers.delete

gyms.read
gyms.create
gyms.update
gyms.delete

availability.read
availability.create
availability.update
availability.delete

seasons.read
seasons.create
seasons.update
seasons.archive

calendar.read
calendar.create
calendar.update
calendar.delete

schedule.generate
schedule.review
schedule.publish

integrations.read
integrations.manage

ai.read
ai.manage

audit_logs.read

mcp.manage
```

The exact permission taxonomy can be expanded as implementation progresses.

---

# 7. USER PERMISSION OVERRIDES

Permissions are role-based by default.

However, individual users must support explicit permission overrides.

Example:

```text
Role:
Organizer

Default:
teams.delete = true

User override:
teams.delete = false
```

Another example:

```text
Role:
Trainer

Override:
calendar.create = true
```

Permission resolution:

```text
explicit user override
        >
role permission
        >
deny by default
```

Build one central authorization service.

Never duplicate permission logic throughout components.

Provide helpers such as:

```ts
requirePermission(...)
hasPermission(...)
requireTenantMembership(...)
requireRole(...)
```

Authorization must work identically for:

- server components
- server actions
- route handlers
- API endpoints
- MCP
- background jobs
- integrations

---

# 8. DATABASE

Design a normalized PostgreSQL schema.

At minimum include entities equivalent to:

```text
profiles
tenants
tenant_memberships
roles
permissions
role_permissions
user_permission_overrides

seasons

teams
athletes
athlete_teams

trainers

gyms

team_training_requirements

trainer_availability
trainer_availability_exceptions

gym_availability
gym_availability_exceptions

team_availability / team_preferences

schedule_versions
schedule_entries

calendar_events

notifications

audit_logs

integrations

ai_provider_configurations

oauth_connections

mcp_api_keys
```

Use UUID primary keys.

Use timestamps consistently.

Use created_at and updated_at where appropriate.

Use soft deletion where historical relationships require preservation.

Use database constraints wherever possible.

---

# 9. SEASONS

Season is a first-class entity.

Example:

```text
2026/2027
```

A tenant can have multiple seasons.

A season has:

- name
- start date
- end date
- status
- configuration
- created_by

Statuses:

```text
DRAFT
ACTIVE
ARCHIVED
```

Allow administrators/organizers to duplicate/copy relevant configuration from a previous season.

The season duplication flow should be explicit and reviewable.

Do not blindly copy historical schedule events.

---

# 10. TEAMS

A team contains at minimum:

- name
- sport
- category
- age group
- gender/category where relevant
- color
- season
- notes
- status

Support assignment of:

- athletes
- trainers
- training requirements
- preferences

A team may have multiple trainers.

A trainer may train multiple teams.

A team can belong to multiple training schedule entries per week.

---

# 11. ATHLETES

Athlete fields should include:

- first name
- last name
- date of birth
- gender
- email
- phone
- address
- emergency contact information
- membership status
- notes
- profile metadata

An athlete can belong to multiple teams.

Use a many-to-many relationship:

```text
athletes
    ↕
athlete_teams
    ↕
teams
```

Preserve historical team membership where appropriate.

Support optional linking of an athlete to a user account.

Do not require every athlete to have a login account.

---

# 12. TRAINERS

Trainer fields:

- first name
- last name
- email
- phone
- qualifications
- notes
- status

Support trainer-to-team assignments.

A trainer can have recurring weekly availability.

Example:

```text
Monday:
16:00–21:00

Wednesday:
17:00–22:00
```

Availability must support:

- weekday
- start time
- end time
- timezone if necessary
- active date range

Also support date-specific exceptions:

```text
vacation
sick leave
holiday
special unavailable date
special available date
```

Recurring availability must never be treated as the only source of truth.

---

# 13. GYMS

Gym fields:

- name
- address
- description
- capacity
- sport types
- equipment
- notes
- status

Gyms have recurring weekly availability.

Example:

```text
Monday:
16:00–22:00

Tuesday:
16:00–22:00
```

Also support exceptions.

Normal smart scheduling rule:

> One team per gym per time slot.

The scheduling engine must not assign two teams to the same gym/time slot.

However, the data model must support exceptional manually-created events where multiple teams can occupy the same gym.

Example:

```text
in-house match
tournament
special event
```

The optimizer must NOT use this exception automatically.

---

# 14. TEAM TRAINING REQUIREMENTS

Teams must define training requirements.

Example:

```text
Trainings per week: 3
Duration: 90 minutes
```

Support:

- sessions per week
- duration
- preferred weekdays
- allowed weekdays
- preferred time ranges
- allowed time ranges
- preferred gyms
- minimum gap between sessions
- maximum gap between sessions
- other scheduling preferences

Distinguish between:

## Hard constraints

The schedule MUST satisfy these.

Examples:

- trainer unavailable
- gym unavailable
- team unavailable
- training outside allowed hours
- required number of sessions
- duration impossible
- trainer conflict
- gym conflict

## Soft constraints

These influence optimization but can be violated if necessary.

Examples:

- preferred gym
- preferred weekday
- preferred time
- trainer preference
- minimize gaps
- balanced gym utilization

---

# 15. AVAILABILITY MODEL

Use recurring weekly availability plus exceptions.

For every availability domain support:

```text
weekday
start_time
end_time
valid_from
valid_until
```

Exceptions support:

```text
date
start_time
end_time
type
reason
```

Types can include:

```text
UNAVAILABLE
AVAILABLE_OVERRIDE
```

Correctly handle:

- overlapping availability
- overlapping exceptions
- midnight boundaries
- timezone
- daylight saving time
- invalid ranges

Never silently accept contradictory availability data.

---

# 16. CALENDAR

Create a powerful calendar interface.

Views:

- Day
- Week
- Month
- Agenda

Filtering:

- Season
- Team
- Trainer
- Gym
- Sport
- Category
- Event type
- Status

Calendar should visually distinguish:

- training
- match
- tournament
- holiday
- unavailable
- special event

Support:

- drag and drop
- resize
- manual event creation
- event editing
- cancellation
- duplication

When moving/resizing a training event, immediately validate:

- trainer availability
- gym availability
- team availability
- conflicts
- season constraints

Show clear conflict explanations.

---

# 17. SCHEDULE ENTRIES

A schedule entry should contain concepts equivalent to:

```text
tenant_id
season_id
team_id
trainer_id
gym_id

start_at
end_at

type
status

schedule_version_id

created_by
updated_by
```

Training events should normally represent one team, one trainer, one gym.

Support special events that may involve multiple teams.

Never hardcode assumptions into UI only.

Enforce important scheduling constraints server-side/database-side.

---

# 18. SCHEDULE VERSIONS

Do not modify the published schedule directly when generating a new schedule.

Use schedule versions.

Example:

```text
Current Published Schedule
        ↓
Generate New Draft
        ↓
Schedule Version #2
        ↓
Review
        ↓
Modify
        ↓
Publish
```

Statuses:

```text
DRAFT
GENERATING
GENERATED
UNDER_REVIEW
PUBLISHED
ARCHIVED
FAILED
```

Publishing should be transactional.

The application must retain enough history to understand how a schedule changed.

---

# 19. SMART ORGANIZER

Build a deterministic schedule optimization engine.

This is one of the most important parts of the application.

The organizer receives:

```text
Teams
Trainers
Gyms
Availability
Training requirements
Preferences
Existing constraints
Season configuration
```

It generates a proposed schedule for all teams.

The optimizer must:

1. Load all relevant constraints.
2. Generate possible candidate slots.
3. Eliminate impossible slots.
4. Assign teams to valid combinations.
5. Optimize according to weighted preferences.
6. Detect unsatisfied requirements.
7. Generate a schedule proposal.
8. Explain conflicts and compromises.

---

# 20. OPTIMIZATION

Start with a deterministic constraint/optimization architecture.

Do NOT delegate schedule correctness to an LLM.

The scheduling engine must be deterministic and testable.

Represent constraints independently.

Conceptually:

```text
HardConstraint
SoftConstraint
Preference
Penalty
Score
```

Example:

```text
Hard:
trainer_available = true
gym_available = true
team_available = true
no_trainer_overlap = true
no_gym_overlap = true
duration_valid = true

Soft:
preferred_weekday
preferred_time
preferred_gym
trainer_preference
balanced_utilization
minimize_schedule_gaps
```

Allow weights for soft constraints.

---

# 21. OPTIMIZER PRIORITIES

Initial optimization priorities:

1. No trainer conflicts
2. No gym conflicts
3. Fulfill team training requirements
4. Respect hard availability
5. Respect team allowed times
6. Respect trainer preferences
7. Respect team preferred times
8. Respect preferred gym
9. Minimize gaps in trainer schedules
10. Minimize gaps in gym schedules
11. Balance gym utilization
12. Minimize unnecessary schedule fragmentation

Make this configurable rather than scattering numeric weights throughout the code.

---

# 22. OPTIMIZER EXPLANATIONS

Every generated schedule should have explainability metadata.

For a schedule entry, be able to show:

```text
Why this slot?

✓ Trainer available
✓ Gym available
✓ Team allowed time
✓ Meets required weekly training
✓ No conflicts

Preference score:
82/100

Trade-off:
Preferred Gym B unavailable at this time.
Gym A selected instead.
```

For impossible schedules, show:

```text
Team U16 could not receive its 3rd weekly session.

Reasons:
- Trainer unavailable on Monday
- Gym unavailable Wednesday
- Remaining Thursday slot conflicts with trainer assignment
```

This is a core UX feature.

---

# 23. SMART ORGANIZER UI

Create a multi-step workflow:

```text
1. Select Season
2. Select Teams
3. Select Trainers
4. Select Gyms
5. Configure constraints
6. Review availability
7. Generate Schedule
8. Analyze result
9. Review proposed calendar
10. Resolve conflicts
11. Publish
```

Generation must show progress.

Do not block the UI during long-running optimization.

Use a background-job architecture where necessary.

The UI must show:

- progress
- generated entries
- conflicts
- warnings
- unsatisfied requirements
- optimization score
- alternative suggestions

---

# 24. MANUAL OVERRIDES

After automatic generation, organizers can manually change entries.

Manual changes must trigger validation.

Do not prevent all changes merely because the optimizer would not have chosen them.

Instead distinguish:

```text
VALID
WARNING
CONFLICT
INVALID
```

Allow authorized organizers/admins to override certain soft constraints.

Hard safety/business constraints should not be bypassed accidentally.

If a user intentionally overrides a constraint, record:

- user
- timestamp
- reason
- previous value
- new value

in the audit log.

---

# 25. AI INTEGRATIONS

Each tenant can configure its own AI provider credentials.

Initial supported providers:

- Google Gemini
- Anthropic Claude
- OpenAI / GPT

The exact provider SDK/API versions should be determined from current official documentation during implementation.

Never expose provider API keys to the browser.

Store secrets securely.

Prefer encrypted-at-rest storage with encryption/decryption performed server-side.

Never write raw API keys into logs.

Never return raw keys through API responses.

---

# 26. AI PROVIDER ABSTRACTION

Create a provider interface:

```ts
interface AIProvider {
  generate(...)
  stream(...)
}
```

Implement adapters such as:

```text
GeminiProvider
ClaudeProvider
OpenAIProvider
```

The application should not depend directly on one provider.

The tenant selects their preferred provider.

AI configuration can include:

- provider
- encrypted API key
- model
- enabled/disabled
- optional configuration
- created_by
- updated_at

---

# 27. AI USE CASES

The AI layer can assist with:

- interpreting natural-language scheduling preferences
- explaining scheduling conflicts
- summarizing schedule changes
- generating administrative messages
- answering tenant-specific operational questions
- suggesting schedule adjustments

However:

> AI must NEVER be the authoritative source of schedule validity.

The deterministic scheduling engine remains authoritative.

AI-generated actions must pass through the same application services and authorization checks as normal user actions.

---

# 28. GOOGLE OAUTH / GOOGLE ACCOUNT INTEGRATION

Support connecting a user's Google account through OAuth 2.0.

This is separate from authentication.

Authentication:

```text
Supabase Auth → Google login
```

Integration:

```text
Application → Google OAuth 2.0 → user's Google account
```

Support appropriate Google Calendar synchronization.

Store OAuth credentials securely.

Never expose refresh tokens to the browser.

Encrypt sensitive OAuth tokens at rest.

Support:

- connect
- disconnect
- token refresh
- connection status
- scopes
- last synchronization
- synchronization errors

Design synchronization to avoid duplicate events.

Use stable external IDs.

Handle:

- events created externally
- events updated externally
- events deleted externally
- recurring events
- timezone differences
- sync failures

The exact Google API implementation should follow current official Google documentation.

---

# 29. INTEGRATION ARCHITECTURE

Create a generic integration abstraction.

Examples:

```text
GoogleCalendarIntegration
AIIntegration
FutureIntegration
```

Each integration should have:

```text
tenant/user ownership
provider
status
credentials
scopes
metadata
last_sync_at
error state
```

Do not hardcode integrations into unrelated business logic.

---

# 30. MCP

Build an MCP-compatible integration/API layer.

MCP access must support separate credentials per tenant/user.

MCP credentials should have:

- ID
- tenant ID
- user ID
- name
- hashed secret
- scopes
- created_at
- expires_at
- last_used_at
- revoked_at

Never store raw MCP secrets.

Display the secret only once at creation time.

Allow:

- create
- list
- revoke
- rotate

MCP requests must resolve:

```text
MCP credential
        ↓
user
        ↓
tenant
        ↓
scopes
        ↓
application permissions
        ↓
requested operation
```

MCP must use the same domain/application services as the web UI.

Do not create duplicate business logic.

---

# 31. MCP TOOLS

Design tools around business capabilities.

Examples:

```text
list_teams
get_team
list_athletes
get_athlete
list_trainers
list_gyms
get_availability
get_calendar
find_schedule_conflicts
generate_schedule
get_schedule_generation_status
publish_schedule
create_training_event
update_training_event
cancel_training_event
```

Every tool must enforce permissions.

Sensitive operations such as publishing a schedule require explicit authorization.

---

# 32. AUDIT LOGGING

Create a comprehensive audit system.

Record important mutations:

```text
user
tenant
action
resource_type
resource_id
old_value
new_value
metadata
timestamp
```

Examples:

```text
TEAM_CREATED
TEAM_UPDATED
ATHLETE_ASSIGNED
TRAINER_ASSIGNED
GYM_UPDATED
SCHEDULE_GENERATED
SCHEDULE_PUBLISHED
SCHEDULE_ENTRY_MOVED
PERMISSION_CHANGED
MEMBER_INVITED
MEMBER_REMOVED
AI_CONFIGURATION_CHANGED
GOOGLE_INTEGRATION_CONNECTED
MCP_KEY_CREATED
MCP_KEY_REVOKED
```

Never log:

- passwords
- raw OAuth tokens
- raw AI API keys
- raw MCP secrets

Provide an audit log UI for authorized roles.

---

# 33. NOTIFICATIONS

Implement an extensible notification system.

Channels:

- in-app
- email

Support notifications for:

- invitation
- schedule published
- schedule changed
- training cancelled
- trainer assignment
- team assignment
- important announcements
- integration failures

Users should have notification preferences.

Do not send duplicate notifications for repeated updates.

---

# 34. EMAIL

Use an email abstraction rather than coupling business logic to one email provider.

Templates should exist for:

- invitations
- password-related events
- schedule publication
- schedule changes
- cancellations
- notifications

Email sending should be asynchronous where appropriate.

---

# 35. DASHBOARD

Create a tenant dashboard.

Show useful operational information:

- active season
- number of teams
- number of athletes
- number of trainers
- number of gyms
- upcoming training
- upcoming events
- schedule conflicts
- availability issues
- incomplete configuration
- recent activity

The dashboard should be actionable, not merely decorative.

---

# 36. ONBOARDING

After a tenant is created, provide an onboarding flow:

```text
Club information
      ↓
Create season
      ↓
Add teams
      ↓
Add trainers
      ↓
Add gyms
      ↓
Configure availability
      ↓
Assign athletes
      ↓
Configure training requirements
      ↓
Generate first schedule
```

Show onboarding progress.

Allow users to skip steps and return later.

---

# 37. MEMBERS / INVITATIONS

Tenant admins can:

- invite users
- resend invitations
- revoke invitations
- remove members
- change roles
- configure permission overrides

Invitation tokens must be secure, expiring, and single-use.

Never allow invitation tokens to reveal tenant data.

---

# 38. SETTINGS

Tenant settings should include:

- organization profile
- timezone
- locale
- week start
- scheduling defaults
- notification settings
- AI settings
- integrations
- members
- roles
- permissions
- audit logs
- security

User settings should include:

- name
- profile
- language
- timezone
- notification preferences
- connected accounts

---

# 39. TIMEZONE

Timezone is critical.

The tenant should have a default timezone.

Store timestamps appropriately.

Recurring weekly availability should be interpreted in the tenant's scheduling timezone.

Calendar rendering should respect the user's selected timezone where appropriate.

DST transitions must be handled correctly.

Never implement scheduling by naïvely comparing strings such as:

```text
"18:00" < "20:00"
```

without considering date/time semantics.

---

# 40. VALIDATION

Use Zod for application-level validation.

Validate:

- forms
- server actions
- route inputs
- API inputs
- MCP tool inputs

Database constraints remain the final safety layer.

Never trust client validation.

---

# 41. ERROR HANDLING

Implement structured errors.

Differentiate:

```text
ValidationError
AuthorizationError
NotFoundError
ConflictError
IntegrationError
SchedulingError
ExternalServiceError
InternalError
```

Show useful human-readable errors to users.

Do not leak:

- SQL errors
- secrets
- stack traces
- provider credentials
- internal infrastructure details

to normal users.

---

# 42. UI DESIGN

Use shadcn/ui consistently.

Build a professional SaaS dashboard.

Layout:

```text
Sidebar
  Dashboard
  Calendar
  Teams
  Athletes
  Trainers
  Gyms
  Seasons
  Organizer
  Members
  Notifications
  Integrations
  Settings
```

Use contextual navigation depending on permissions.

Do not display navigation items for resources the user cannot access.

However, hiding UI is NOT authorization.

Server authorization remains mandatory.

---

# 43. UI COMPONENT ARCHITECTURE

Create reusable components for:

- Data tables
- Search
- Filters
- Pagination
- Empty states
- Loading states
- Error states
- Confirmation dialogs
- Forms
- Comboboxes
- Date/time selectors
- Availability editor
- Calendar events
- Conflict indicators
- Permission matrix
- Role editor
- User invitation
- Schedule cards
- Schedule generation progress
- Schedule conflict panel

Avoid giant components.

Keep business logic out of presentation components.

---

# 44. ACCESSIBILITY

The application must be accessible.

Follow WCAG principles.

Ensure:

- keyboard navigation
- visible focus
- semantic HTML
- accessible dialogs
- proper labels
- screen-reader-friendly tables
- sufficient contrast
- no color-only status indicators

---

# 45. RESPONSIVE DESIGN

Support:

- desktop
- tablet
- mobile

The calendar may use a specialized mobile experience.

Do not simply shrink desktop tables onto mobile.

---

# 46. SEARCH AND FILTERING

Large collections must support server-side filtering/search.

Examples:

Teams:

```text
search
sport
category
season
status
```

Athletes:

```text
name
team
season
status
```

Trainers:

```text
name
team
availability
status
```

Gyms:

```text
name
location
sport
status
```

Calendar:

```text
season
team
trainer
gym
event type
date range
```

---

# 47. PAGINATION

Use pagination for potentially large datasets.

Do not fetch thousands of records merely to render a table.

Use appropriate database indexes.

---

# 48. DATABASE INDEXING

Add indexes based on actual access patterns.

At minimum consider indexes for:

```text
tenant_id
season_id
team_id
trainer_id
gym_id
start_at
end_at
status
created_at
```

Composite indexes should be used where queries justify them.

Avoid blindly indexing every column.

---

# 49. RLS

Supabase RLS is mandatory.

Every tenant-owned table must have appropriate policies.

Policies must enforce:

```text
user belongs to tenant
AND
user has appropriate permission
```

Do not rely on:

```text
WHERE tenant_id = currentTenant
```

in frontend code as a security mechanism.

Test cross-tenant access explicitly.

A user from Tenant A must never be able to:

- select Tenant B records
- insert records into Tenant B
- update Tenant B
- delete Tenant B
- access Tenant B storage
- access Tenant B integration credentials
- access Tenant B MCP credentials

---

# 50. STORAGE

If files/documents are implemented, use Supabase Storage with tenant-aware paths and policies.

Example conceptual structure:

```text
tenant/{tenantId}/athletes/{athleteId}/...
tenant/{tenantId}/teams/{teamId}/...
```

Storage policies must enforce tenant isolation.

Never expose private files through unrestricted public URLs.

---

# 51. REALTIME

Use Supabase Realtime where it provides meaningful value.

Potential uses:

- schedule generation status
- schedule updates
- notifications
- collaborative schedule review

Do not add realtime merely because it is available.

---

# 52. BACKGROUND JOBS

Long-running operations must not depend on a single HTTP request remaining open.

Potential background jobs:

- schedule generation
- email sending
- Google Calendar synchronization
- notification delivery
- integration synchronization

Jobs must be:

- idempotent
- retryable
- observable
- tenant-aware
- authorization-safe

---

# 53. SECURITY

Apply secure defaults everywhere.

Requirements:

- no secrets in frontend bundles
- no secrets in logs
- encrypted integration credentials
- secure OAuth handling
- CSRF-safe mutation architecture
- input validation
- authorization checks
- RLS
- rate limiting where appropriate
- secure cookies/session handling
- secure invitation tokens
- MCP secret hashing
- audit logging
- least privilege

---

# 54. API DESIGN

Keep domain/application services independent from transport.

Conceptually:

```text
UI
 ↓
Server Action / Route / MCP
 ↓
Authorization
 ↓
Application Service
 ↓
Domain Logic
 ↓
Database
```

Do not put important business rules directly into React components.

---

# 55. DOMAIN SERVICES

Create clear services/modules for major domains:

```text
TenantService
MembershipService
PermissionService
SeasonService
TeamService
AthleteService
TrainerService
GymService
AvailabilityService
CalendarService
SchedulingService
ScheduleOptimizationService
NotificationService
AuditService
AIService
GoogleCalendarService
MCPService
```

Keep domain boundaries clear.

---

# 56. SCHEDULING ENGINE TESTABILITY

The scheduling engine must be testable independently from Next.js and the database.

It should accept structured input and return structured output.

Example:

```ts
const result = await generateSchedule(input)
```

The engine should not directly depend on React.

Ideally, most optimizer tests can run with pure in-memory data.

---

# 57. SCHEDULING TEST CASES

Create tests for:

### Basic

- one team
- one trainer
- one gym
- one available slot

### Conflicts

- trainer conflict
- gym conflict
- team conflict
- unavailable trainer
- unavailable gym
- unavailable team

### Capacity

- many teams
- insufficient gyms
- insufficient trainers
- insufficient available hours

### Preferences

- preferred weekday
- preferred time
- preferred gym

### Exceptions

- vacation
- holiday
- date-specific unavailability

### Optimization

- competing preferences
- schedule balancing
- minimizing gaps

### Impossible scenarios

The engine must return an understandable explanation rather than silently creating an invalid schedule.

---

# 58. TRANSACTIONS

Use transactions for multi-step critical operations.

Examples:

- publishing schedules
- deleting tenants
- changing memberships
- applying bulk assignments
- copying seasons

Do not leave the database half-updated if a multi-step operation fails.

---

# 59. BULK OPERATIONS

Support useful bulk operations:

- assign athletes to teams
- assign trainers
- copy season configuration
- import teams
- import athletes
- generate schedule
- publish schedule

Bulk operations should validate everything before applying destructive changes where possible.

---

# 60. IMPORT / EXPORT

Design for CSV import/export.

Useful imports:

- athletes
- teams
- trainers
- gyms

Provide:

```text
Upload
↓
Parse
↓
Preview
↓
Validate
↓
Show errors
↓
Confirm
↓
Import
```

Never silently skip malformed records.

---

# 61. OBSERVABILITY

Prepare for production observability.

Capture:

- application errors
- scheduling failures
- integration failures
- job failures
- authorization failures
- important performance metrics

Never include secrets or sensitive credential material in logs.

---

# 62. ENVIRONMENT CONFIGURATION

Separate:

```text
development
test
staging
production
```

Validate environment variables at startup.

Never silently continue when required secrets are missing.

Document all environment variables.

---

# 63. SEED DATA

Provide development seed data representing:

- one tenant
- multiple users
- multiple roles
- several teams
- athletes
- trainers
- gyms
- availability
- a season
- schedule entries

Include deliberately conflicting data so the scheduling UI can be tested.

Do not use seed data in production.

---

# 64. TESTING

Implement:

### Unit tests

For:

- permission resolution
- availability calculations
- conflict detection
- scheduling constraints
- optimization
- utility functions

### Integration tests

For:

- database operations
- RLS
- authentication flows
- tenant isolation
- scheduling persistence

### End-to-end tests

For:

- login
- invitation
- tenant switching
- creating a team
- adding athletes
- creating availability
- generating a schedule
- reviewing conflicts
- publishing schedule
- changing permissions

Security tests must specifically attempt cross-tenant access.

---

# 65. PERFORMANCE

Avoid:

- N+1 queries
- unnecessary client-side fetching
- loading entire tables
- expensive unindexed queries
- serial database requests where parallelization is safe

Use appropriate caching where safe.

Never cache tenant-sensitive data in a way that can cross tenant boundaries.

---

# 66. DATA INTEGRITY

Use:

- foreign keys
- unique constraints
- check constraints
- enum/status validation
- transactional operations

Important invariants should be enforced as close to the database/domain layer as practical.

---

# 67. DELETE BEHAVIOR

Carefully distinguish:

- archive
- deactivate
- soft delete
- hard delete

Do not permanently delete historical scheduling information merely because a team is no longer active.

Preserve historical season data.

Tenant deletion must be a deliberate privileged operation with confirmation.

---

# 68. TENANT SWITCHING

If a user belongs to multiple clubs:

```text
Tenant A
Tenant B
Tenant C
```

Provide a tenant switcher.

Changing tenant must update the active tenant context.

Never rely solely on localStorage for authorization.

Every server request must resolve membership independently.

---

# 69. EMPTY / LOADING / ERROR STATES

Every page must have intentional:

- loading state
- empty state
- error state
- permission-denied state

Do not show blank screens.

Examples:

```text
No teams yet
→ Create your first team
```

```text
No trainers available
→ Add trainers before generating the schedule
```

```text
Schedule cannot be generated
→ 4 teams have no compatible trainer availability
```

---

# 70. DESIGN SYSTEM

Establish reusable design tokens and component patterns.

Use shadcn/ui rather than inventing custom components unnecessarily.

Maintain consistent:

- spacing
- typography
- buttons
- dialogs
- forms
- badges
- status indicators
- tables
- cards

The application should look like a polished modern SaaS product.

---

# 71. PRODUCT UX PRINCIPLE

Optimize for club organizers.

The main workflow should feel like:

```text
Configure
    ↓
Understand
    ↓
Generate
    ↓
Review
    ↓
Fix
    ↓
Publish
```

Do not force users through unnecessary CRUD screens.

Whenever possible, make workflows contextual.

---

# 72. FUTURE-PROOFING

Architect for future features without implementing unnecessary complexity now.

Potential future functionality:

- tournaments
- matches
- attendance
- payments
- memberships
- invoices
- SMS
- WhatsApp
- additional calendar providers
- additional AI providers
- mobile app
- public club portal
- athlete/parent portal
- statistics
- performance tracking

Do not implement these now unless required.

However, avoid architectural decisions that make them impossible later.

---

# 73. BILLING

Do NOT implement billing initially.

However, structure the tenant model so subscription/billing can be introduced later without redesigning tenancy.

Do not add Stripe merely for future-proofing.

---

# 74. IMPLEMENTATION ORDER

Build incrementally.

Recommended phases:

## Phase 1 — Foundation

- Next.js setup
- TypeScript
- Tailwind
- shadcn/ui
- Supabase
- authentication
- database
- migrations
- RLS
- tenant context
- membership
- permissions

## Phase 2 — Core entities

- seasons
- teams
- athletes
- trainers
- gyms

## Phase 3 — Availability

- recurring availability
- exceptions
- team preferences
- validation

## Phase 4 — Calendar

- calendar views
- filters
- event management
- conflict detection
- drag/drop

## Phase 5 — Scheduling engine

- constraints
- candidate slots
- optimizer
- schedule versions
- conflict explanations
- generation workflow

## Phase 6 — Publishing

- review
- manual modifications
- publishing
- audit history

## Phase 7 — SaaS operations

- invitations
- notifications
- audit logs
- settings
- onboarding

## Phase 8 — Integrations

- Google OAuth
- Google Calendar synchronization
- AI provider configuration

## Phase 9 — MCP

- MCP authentication
- tenant/user credentials
- scopes
- tools
- authorization

## Phase 10 — Hardening

- tests
- security tests
- performance
- accessibility
- observability
- production deployment

---

# 75. DEVELOPMENT RULES

Follow these rules throughout the implementation:

1. Never bypass authorization.
2. Never trust client-provided tenant IDs.
3. Never expose secrets to the client.
4. Never rely only on frontend authorization.
5. Never use mock data for implemented functionality.
6. Never create fake API responses.
7. Never silently ignore errors.
8. Never silently violate scheduling constraints.
9. Never let an LLM be the authority for schedule validity.
10. Never duplicate business logic between UI, API, and MCP.
11. Prefer reusable domain/application services.
12. Keep database migrations versioned.
13. Keep RLS policies versioned with migrations.
14. Add indexes based on real query patterns.
15. Write tests for security-critical functionality.
16. Make background jobs idempotent.
17. Make schedule generation reproducible where practical.
18. Preserve historical schedule versions.
19. Keep secrets encrypted/hashed appropriately.
20. Use least-privilege access everywhere.

---

# 76. ACCEPTANCE CRITERIA

The project is not considered complete merely because pages exist.

The application is complete only when:

### Authentication

- Users can sign in using Supabase email authentication.
- Users can sign in with Google.
- Public self-registration is disabled.
- Invitations work.
- Password reset works.

### Multi-tenancy

- Users can belong to multiple tenants.
- Tenant switching works.
- RLS prevents cross-tenant access.
- Server authorization prevents cross-tenant access.

### RBAC

- Roles work.
- Permissions work.
- Individual user overrides work.
- Permission checks work server-side.
- UI adapts to permissions.

### Teams

- Teams can be created/edited/archived.
- Training requirements work.
- Athletes can belong to multiple teams.
- Trainers can be assigned to multiple teams.

### Trainers

- Recurring availability works.
- Exceptions work.
- Conflicts are detected.

### Gyms

- Recurring availability works.
- Exceptions work.
- Normal scheduling enforces one team per gym/time slot.
- Special events can support multiple teams.

### Calendar

- Day/week/month/agenda views work.
- Filters work.
- Events can be moved.
- Conflicts are validated.

### Smart Organizer

- Receives teams/trainers/gyms.
- Reads availability.
- Applies hard constraints.
- Optimizes soft constraints.
- Generates a schedule.
- Explains conflicts.
- Produces a reviewable draft.
- Does not modify the published schedule directly.
- Supports manual review.
- Supports publishing.

### AI

- Tenant can configure their own provider.
- Secrets are not exposed.
- Provider abstraction works.
- AI cannot bypass authorization or scheduling validation.

### Google

- OAuth connection works.
- Tokens are protected.
- Calendar sync works.
- Duplicate events are avoided.
- Disconnect works.

### MCP

- Tenant/user-specific credentials work.
- Secrets are hashed.
- Credentials can be revoked.
- Scopes work.
- MCP operations use the same authorization layer.

### Audit

- Important changes are recorded.
- Sensitive secrets are never logged.

### Production quality

- Error handling works.
- Loading states work.
- Empty states work.
- Responsive UI works.
- Accessibility is considered.
- Automated tests cover critical paths.
- Database migrations are reproducible.
- Environment configuration is documented.

---

# 77. OUTPUT EXPECTATIONS FOR THE CODING AGENT

Before implementing large features:

1. Inspect the existing repository.
2. Understand existing architecture.
3. Do not overwrite existing functionality unnecessarily.
4. Identify missing pieces.
5. Propose the implementation plan.
6. Implement incrementally.
7. Run type checking.
8. Run linting.
9. Run tests.
10. Fix errors.
11. Review security implications.
12. Continue until the feature is actually functional.

When creating database changes:

- create migrations
- create/update RLS policies
- add indexes
- add constraints
- update types
- update seed data where appropriate

When creating a feature:

```text
Database
↓
RLS
↓
Domain/service layer
↓
Validation
↓
Server action/API
↓
UI
↓
Loading/error/empty states
↓
Tests
```

Do not stop after creating the UI.

---

# 78. IMPORTANT: DO NOT OVERENGINEER

Although this is a production-grade SaaS architecture, do not introduce unnecessary infrastructure.

Prefer the simplest reliable architecture.

Do not add:

- microservices
- Kubernetes
- unnecessary message brokers
- unnecessary Redis
- unnecessary separate databases

unless there is a demonstrated need.

Start as a modular monolith.

The architecture should allow extraction later if scale requires it.

---

# 79. IMPORTANT: DO NOT UNDERSPECIFY THE SCHEDULER

The smart organizer is a core product capability.

Treat it as a domain engine, not a simple CRUD feature.

The scheduler must be designed so that future optimization algorithms can be introduced without rewriting the rest of the application.

The application should clearly separate:

```text
Scheduling input
Scheduling constraints
Candidate generation
Constraint evaluation
Optimization
Conflict analysis
Schedule persistence
Schedule publishing
```

---

# 80. FINAL ARCHITECTURAL PRINCIPLE

The system should follow this fundamental rule:

> The web UI, API, AI integrations, Google integrations, and MCP are all different interfaces to the same secure application domain.

They must ultimately use the same:

- tenant context
- authorization model
- domain services
- validation
- business rules
- scheduling engine
- audit system

There must never be a privileged backdoor through MCP, AI, integrations, or server endpoints.

Build the system so that a club can safely depend on it for its real weekly training schedule.