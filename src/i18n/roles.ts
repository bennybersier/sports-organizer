/**
 * Role names come from the database (`roles.name`), which is a single English
 * string shared by every tenant. System roles have stable keys, so those are
 * translated; a tenant's own custom role keeps whatever name it was given.
 */
import type messages from "../../messages/en.json";

type RoleKey = keyof typeof messages.roles;

export function roleLabel(
  t: (key: RoleKey) => string,
  key: string,
  fallback: string,
): string {
  return isRoleKey(key) ? t(key) : fallback;
}

function isRoleKey(key: string): key is RoleKey {
  return [
    "OWNER",
    "ADMIN",
    "ORGANIZER",
    "TRAINER",
    "TEAM_MANAGER",
    "ATHLETE",
    "PLATFORM_ADMIN",
  ].includes(key);
}
