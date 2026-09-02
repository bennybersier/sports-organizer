/**
 * Checks that the application and the database still agree.
 *
 * Three things are defined in two places by necessity, and a silent divergence
 * in any of them changes who can do what without anything failing:
 *
 *   - the permission taxonomy (TypeScript union vs. the `permissions` table)
 *   - the role hierarchy (SYSTEM_ROLES vs. the `roles` table)
 *   - RLS coverage (every tenant-owned table must have it enabled)
 *
 *   pnpm test:schema
 */
import { PERMISSIONS, SYSTEM_ROLES } from "../../src/domain/permissions";

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!U || !SECRET || !PUBLISHABLE) {
  console.error("Missing Supabase configuration.");
  process.exit(1);
}

const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };
const anon = { apikey: PUBLISHABLE };
const get = async (path: string, headers = admin) =>
  (await (await fetch(`${U}/rest/v1/${path}`, { headers })).json()) as unknown;

let failures = 0;
const ok = (l: string) => console.log(`  \x1b[32m✓\x1b[0m ${l}`);
const bad = (l: string, d?: unknown) => {
  console.log(`  \x1b[31m✗ ${l}\x1b[0m`);
  if (d !== undefined) console.log(`      ${String(d).slice(0, 200)}`);
  failures += 1;
};

console.log("Permission taxonomy:");
const dbPermissions = ((await get("permissions?select=key")) as { key: string }[]).map((r) => r.key);
const inCode = new Set<string>(PERMISSIONS);
const inDb = new Set(dbPermissions);

const missingFromDb = [...inCode].filter((key) => !inDb.has(key));
const missingFromCode = [...inDb].filter((key) => !inCode.has(key));

if (missingFromDb.length === 0) {
  ok(`all ${inCode.size} TypeScript permissions exist in the database`);
} else {
  bad("permissions in code but not in the database — checks against them always deny", missingFromDb.join(", "));
}

if (missingFromCode.length === 0) {
  ok("no database permissions are unknown to the application");
} else {
  bad("permissions in the database but not in code — unreachable from the UI", missingFromCode.join(", "));
}

console.log("\nRole hierarchy:");
const dbRoles = (await get("roles?tenant_id=is.null&select=key,rank,name")) as {
  key: string; rank: number; name: string;
}[];

for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
  const match = dbRoles.find((r) => r.key === key);
  if (!match) { bad(`system role ${key} is missing from the database`); continue; }
  if (match.rank === role.rank) ok(`${key} rank ${role.rank} matches`);
  else bad(`${key} rank differs — code says ${role.rank}, database says ${match.rank}`);
}

const extraRoles = dbRoles.filter((r) => !(r.key in SYSTEM_ROLES));
if (extraRoles.length === 0) ok("no system roles the application doesn't know about");
else bad("unknown system roles", extraRoles.map((r) => r.key).join(", "));

console.log("\nRole grants are still bounded:");
const grants = (await get("role_permissions?select=role_id,permission_key")) as {
  role_id: string; permission_key: string;
}[];
const roleIds = (await get("roles?tenant_id=is.null&select=id,key")) as { id: string; key: string }[];
const byRole = new Map(roleIds.map((r) => [r.id, r.key]));

const ownerId = roleIds.find((r) => r.key === "OWNER")?.id;
const ownerGrants = grants.filter((g) => g.role_id === ownerId).length;
if (ownerGrants === dbPermissions.length) ok(`Owner holds all ${ownerGrants} permissions`);
else bad("Owner does not hold every permission", `${ownerGrants} of ${dbPermissions.length}`);

const adminId = roleIds.find((r) => r.key === "ADMIN")?.id;
const adminHasDelete = grants.some((g) => g.role_id === adminId && g.permission_key === "tenant.delete");
if (!adminHasDelete) ok("Admin cannot delete the club");
else bad("Admin holds tenant.delete");

const athleteId = roleIds.find((r) => r.key === "ATHLETE")?.id;
const athleteGrants = grants.filter((g) => g.role_id === athleteId).map((g) => g.permission_key);
const athleteWrites = athleteGrants.filter((p) => !p.endsWith(".read"));
if (athleteWrites.length === 0) ok(`Athlete holds ${athleteGrants.length} permissions, all read-only`);
else bad("Athlete holds write permissions", athleteWrites.join(", "));

for (const [id, key] of byRole) {
  const count = grants.filter((g) => g.role_id === id).length;
  if (count === 0) bad(`${key} has no permissions at all`);
}

console.log("\nRLS coverage — anonymous access to every tenant-owned table:");
const TENANT_TABLES = [
  "tenants", "seasons", "teams", "athletes", "trainers", "gyms",
  "athlete_teams", "trainer_teams", "team_training_requirements",
  "gym_availability", "gym_availability_exceptions",
  "trainer_availability", "trainer_availability_exceptions",
  "team_availability", "team_availability_exceptions",
  "schedule_versions", "schedule_entries", "calendar_events", "calendar_event_teams",
  "jobs", "audit_logs", "notifications", "notification_preferences",
  "onboarding_progress", "integrations", "invitations",
  "tenant_memberships", "user_permission_overrides",
];

let leaks = 0;
for (const table of TENANT_TABLES) {
  const response = await fetch(`${U}/rest/v1/${table}?select=*&limit=1`, { headers: anon });
  const body = await response.json().catch(() => null);
  const exposed = Array.isArray(body) && body.length > 0;
  if (exposed) { bad(`${table} returns rows to an anonymous caller`, JSON.stringify(body).slice(0, 100)); leaks += 1; }
}
if (leaks === 0) ok(`all ${TENANT_TABLES.length} tenant-owned tables return nothing to anonymous callers`);

console.log("\nSecret tables reject anonymous access outright:");
for (const table of ["ai_provider_configurations", "mcp_api_keys", "oauth_connections", "calendar_sync_links", "email_outbox", "platform_admins"]) {
  const response = await fetch(`${U}/rest/v1/${table}?select=*&limit=1`, { headers: anon });
  if (response.status === 401 || response.status === 403) ok(`${table} — ${response.status}`);
  else bad(`${table} did not refuse`, response.status);
}

console.log(failures === 0 ? "\nApplication and database agree." : `\n${failures} discrepancies.`);
process.exit(failures === 0 ? 0 : 1);
