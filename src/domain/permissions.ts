/**
 * The permission taxonomy, mirroring supabase/migrations/*_0007_permissions_seed.sql.
 *
 * This file exists so the UI and server code get compile-time checking on
 * permission strings. The database remains authoritative at runtime — RLS calls
 * `app.has_permission`, and the authorization service resolves permissions from
 * the same tables. A typo here is a build error; a permission missing from the
 * migration is a runtime denial, never an accidental grant.
 */

export const PERMISSIONS = [
  "tenant.read",
  "tenant.update",
  "tenant.delete",

  "members.read",
  "members.invite",
  "members.update",
  "members.remove",

  "roles.read",
  "roles.update",

  "seasons.read",
  "seasons.create",
  "seasons.update",
  "seasons.archive",

  "teams.read",
  "teams.create",
  "teams.update",
  "teams.delete",

  "athletes.read",
  "athletes.create",
  "athletes.update",
  "athletes.delete",

  "trainers.read",
  "trainers.create",
  "trainers.update",
  "trainers.delete",

  "gyms.read",
  "gyms.create",
  "gyms.update",
  "gyms.delete",

  "availability.read",
  "availability.create",
  "availability.update",
  "availability.delete",

  "calendar.read",
  "calendar.create",
  "calendar.update",
  "calendar.delete",

  "schedule.generate",
  "schedule.review",
  "schedule.publish",

  "integrations.read",
  "integrations.manage",

  "ai.read",
  "ai.manage",

  "mcp.manage",

  "audit_logs.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * System roles, ordered by rank. Lower rank = more privileged.
 *
 * The rank is what stops an Admin from editing an Owner: a user may only act on
 * memberships whose rank is strictly greater than their own.
 */
export const SYSTEM_ROLES = {
  OWNER: { key: "OWNER", name: "Owner", rank: 0 },
  ADMIN: { key: "ADMIN", name: "Admin", rank: 10 },
  ORGANIZER: { key: "ORGANIZER", name: "Organizer", rank: 20 },
  TRAINER: { key: "TRAINER", name: "Trainer", rank: 30 },
  TEAM_MANAGER: { key: "TEAM_MANAGER", name: "Team Manager", rank: 40 },
  ATHLETE: { key: "ATHLETE", name: "Athlete", rank: 50 },
} as const;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return value in SYSTEM_ROLES;
}
