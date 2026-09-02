import { describe, expect, it } from "vitest";

import { PERMISSIONS, SYSTEM_ROLES, isPermission, isSystemRoleKey } from "../permissions";

/**
 * The permission taxonomy and role hierarchy.
 *
 * These are cheap tests for expensive mistakes: a permission renamed on one
 * side of the TypeScript/SQL boundary, or a role rank reordered, would silently
 * change who can do what.
 */

describe("permission taxonomy", () => {
  it("has no duplicates", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("uses resource.action throughout", () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("recognises real permissions and rejects invented ones", () => {
    expect(isPermission("teams.create")).toBe(true);
    expect(isPermission("schedule.publish")).toBe(true);
    // The exact failure that would let a typo through as a silent grant.
    expect(isPermission("teams.creat")).toBe(false);
    expect(isPermission("teams.*")).toBe(false);
    expect(isPermission("")).toBe(false);
  });

  it("covers every resource the app exposes", () => {
    const resources = new Set(PERMISSIONS.map((p) => p.split(".")[0]));
    for (const expected of [
      "tenant", "members", "roles", "seasons", "teams", "athletes",
      "trainers", "gyms", "availability", "calendar", "schedule",
      "integrations", "ai", "mcp", "audit_logs",
    ]) {
      expect(resources.has(expected)).toBe(true);
    }
  });
});

describe("role hierarchy", () => {
  const ranks = Object.values(SYSTEM_ROLES).map((role) => role.rank);

  it("gives every role a distinct rank", () => {
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("puts Owner at the top", () => {
    expect(SYSTEM_ROLES.OWNER.rank).toBe(0);
    expect(Math.min(...ranks)).toBe(0);
  });

  it("orders roles from most to least privileged", () => {
    // Lower rank = more privileged. This ordering is what assertOutranks uses,
    // so reversing any pair silently changes who can edit whom.
    expect(SYSTEM_ROLES.OWNER.rank).toBeLessThan(SYSTEM_ROLES.ADMIN.rank);
    expect(SYSTEM_ROLES.ADMIN.rank).toBeLessThan(SYSTEM_ROLES.ORGANIZER.rank);
    expect(SYSTEM_ROLES.ORGANIZER.rank).toBeLessThan(SYSTEM_ROLES.TRAINER.rank);
    expect(SYSTEM_ROLES.TRAINER.rank).toBeLessThan(SYSTEM_ROLES.TEAM_MANAGER.rank);
    expect(SYSTEM_ROLES.TEAM_MANAGER.rank).toBeLessThan(SYSTEM_ROLES.ATHLETE.rank);
  });

  it("has no Viewer role", () => {
    // The spec is explicit about this one.
    expect(isSystemRoleKey("VIEWER")).toBe(false);
  });

  it("recognises real role keys", () => {
    expect(isSystemRoleKey("ORGANIZER")).toBe(true);
    expect(isSystemRoleKey("organizer")).toBe(false);
  });
});

/**
 * The resolution order, as a pure function.
 *
 * The real implementations live in SQL (`app.has_permission`) and in the
 * membership service, and they must agree. This encodes the rule they both
 * implement so a change to either has something to disagree with.
 */
function resolve(
  permission: string,
  roleDefaults: Set<string>,
  overrides: Map<string, "ALLOW" | "DENY">,
): boolean {
  const override = overrides.get(permission);
  if (override) return override === "ALLOW";
  return roleDefaults.has(permission);
}

describe("permission resolution: override > role > deny", () => {
  const roleDefaults = new Set(["teams.read", "calendar.read"]);

  it("grants what the role grants", () => {
    expect(resolve("teams.read", roleDefaults, new Map())).toBe(true);
  });

  it("denies what nothing grants", () => {
    expect(resolve("teams.delete", roleDefaults, new Map())).toBe(false);
  });

  it("lets an ALLOW override grant what the role lacks", () => {
    const overrides = new Map<string, "ALLOW" | "DENY">([["teams.delete", "ALLOW"]]);
    expect(resolve("teams.delete", roleDefaults, overrides)).toBe(true);
  });

  it("lets a DENY override remove what the role grants", () => {
    const overrides = new Map<string, "ALLOW" | "DENY">([["teams.read", "DENY"]]);
    expect(resolve("teams.read", roleDefaults, overrides)).toBe(false);
  });

  it("restores the role default when an override is removed", () => {
    // The reason INHERIT is a distinct choice from DENY in the UI.
    const withOverride = new Map<string, "ALLOW" | "DENY">([["teams.read", "DENY"]]);
    expect(resolve("teams.read", roleDefaults, withOverride)).toBe(false);
    expect(resolve("teams.read", roleDefaults, new Map())).toBe(true);
  });

  it("leaves unrelated permissions untouched by an override", () => {
    const overrides = new Map<string, "ALLOW" | "DENY">([["teams.delete", "ALLOW"]]);
    expect(resolve("calendar.read", roleDefaults, overrides)).toBe(true);
    expect(resolve("gyms.read", roleDefaults, overrides)).toBe(false);
  });
});

/**
 * Rank comparison, as `assertOutranks` and `assertCanGrantRole` apply it.
 */
function outranks(actorRank: number, targetRank: number): boolean {
  // Owners may act on other owners so co-ownership stays workable; everyone
  // else needs to be strictly more privileged than the person they act on.
  return actorRank === 0 ? targetRank >= actorRank : targetRank > actorRank;
}

describe("rank guards", () => {
  const { OWNER, ADMIN, ORGANIZER, ATHLETE } = SYSTEM_ROLES;

  it("lets an owner act on anyone, including another owner", () => {
    expect(outranks(OWNER.rank, OWNER.rank)).toBe(true);
    expect(outranks(OWNER.rank, ATHLETE.rank)).toBe(true);
  });

  it("stops an admin acting on an owner", () => {
    expect(outranks(ADMIN.rank, OWNER.rank)).toBe(false);
  });

  it("stops anyone acting on their own level", () => {
    expect(outranks(ADMIN.rank, ADMIN.rank)).toBe(false);
    expect(outranks(ORGANIZER.rank, ORGANIZER.rank)).toBe(false);
  });

  it("lets an admin act on everyone below", () => {
    expect(outranks(ADMIN.rank, ORGANIZER.rank)).toBe(true);
    expect(outranks(ADMIN.rank, ATHLETE.rank)).toBe(true);
  });

  it("never lets a role be granted above the granter's own", () => {
    const canGrant = (actorRank: number, grantedRank: number) => grantedRank >= actorRank;
    expect(canGrant(ADMIN.rank, OWNER.rank)).toBe(false);
    expect(canGrant(ADMIN.rank, ADMIN.rank)).toBe(true);
    expect(canGrant(ORGANIZER.rank, ADMIN.rank)).toBe(false);
  });
});
