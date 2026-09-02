import "server-only";

import { ConflictError, NotFoundError, fromDatabaseError } from "@/lib/errors";
import { generateToken, hashSecret } from "@/lib/crypto";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/auth/context";
import { assertCanGrantRole, assertOutranks, assertPermission } from "@/server/auth/authorization";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import type { Permission } from "@/domain/permissions";
import type {
  ChangeRoleInput,
  InviteMemberInput,
  SetOverrideInput,
} from "@/lib/validation/member";

const INVITATION_TTL_DAYS = 14;

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleRank: number;
  status: string;
  joinedAt: string;
  overrideCount: number;
  isSelf: boolean;
}

export interface InvitationRowView {
  id: string;
  email: string;
  roleName: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export async function listMembers(context: AuthContext): Promise<MemberRow[]> {
  assertPermission(context, "members.read");

  const { data, error } = await context.db
    .from("tenant_memberships")
    .select("id, user_id, role_id, status, joined_at")
    .eq("tenant_id", context.tenant.id)
    .order("joined_at");

  if (error) throw fromDatabaseError(error, { resource: "member" });
  const memberships = data ?? [];
  if (memberships.length === 0) return [];

  const [profiles, roles, overrides] = await Promise.all([
    context.db
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .in("id", memberships.map((m) => m.user_id)),
    context.db.from("roles").select("id, key, name, rank"),
    context.db
      .from("user_permission_overrides")
      .select("user_id")
      .eq("tenant_id", context.tenant.id),
  ]);

  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const roleById = new Map((roles.data ?? []).map((r) => [r.id, r]));
  const overrideCounts = new Map<string, number>();
  for (const row of overrides.data ?? []) {
    overrideCounts.set(row.user_id, (overrideCounts.get(row.user_id) ?? 0) + 1);
  }

  return memberships
    .map((membership) => {
      const profile = profileById.get(membership.user_id);
      const role = roleById.get(membership.role_id);
      return {
        membershipId: membership.id,
        userId: membership.user_id,
        email: profile?.email ?? "",
        fullName: profile?.full_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        roleId: membership.role_id,
        roleKey: role?.key ?? "",
        roleName: role?.name ?? "",
        roleRank: role?.rank ?? 99,
        status: membership.status,
        joinedAt: membership.joined_at,
        overrideCount: overrideCounts.get(membership.user_id) ?? 0,
        isSelf: membership.user_id === context.user.id,
      };
    })
    .sort((a, b) => a.roleRank - b.roleRank || a.email.localeCompare(b.email));
}

export async function listPendingInvitations(context: AuthContext): Promise<InvitationRowView[]> {
  assertPermission(context, "members.read");

  const { data, error } = await context.db
    .from("invitations")
    .select("id, email, role_id, status, expires_at, created_at")
    .eq("tenant_id", context.tenant.id)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false });

  if (error) throw fromDatabaseError(error, { resource: "invitation" });

  const { data: roles } = await context.db.from("roles").select("id, name");
  const roleName = new Map((roles ?? []).map((role) => [role.id, role.name]));

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    roleName: roleName.get(row.role_id) ?? "",
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function listAssignableRoles(context: AuthContext) {
  assertPermission(context, "members.read");

  const { data, error } = await context.db
    .from("roles")
    .select("id, key, name, rank")
    .is("tenant_id", null)
    .order("rank");

  if (error) throw fromDatabaseError(error, { resource: "role" });

  // You can never hand out more access than you hold yourself.
  return (data ?? []).filter((role) => role.rank >= context.role.rank);
}

/**
 * Invites someone to the club.
 *
 * The raw token is returned exactly once, to the inviter. Only its hash is
 * stored, so a leaked database gives nobody a way in. Until email delivery
 * lands, the link is shown in the UI for the inviter to pass on — which is
 * honest about what the system can actually do today.
 */
export async function inviteMember(
  context: AuthContext,
  input: InviteMemberInput,
): Promise<{ invitationId: string; link: string; accountCreated: boolean }> {
  assertPermission(context, "members.invite");

  const role = await getRole(context, input.roleId);
  assertCanGrantRole(context, role.rank);

  const admin = createAdminClient();

  // Already a member? Say so plainly rather than issuing a dead invitation.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", input.email)
    .maybeSingle();

  if (profile) {
    const { data: existing } = await context.db
      .from("tenant_memberships")
      .select("id")
      .eq("tenant_id", context.tenant.id)
      .eq("user_id", profile.id)
      .maybeSingle();

    if (existing) throw new ConflictError("That person is already a member of this club.");
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

  // Written with the admin client: the inviter cannot read invitation rows back,
  // which is deliberate — the token hash must not be reachable from the client.
  const { data, error } = await admin
    .from("invitations")
    .insert({
      tenant_id: context.tenant.id,
      email: input.email,
      role_id: input.roleId,
      token_hash: hashSecret(token),
      message: input.message,
      expires_at: expiresAt,
      invited_by: context.user.id,
    })
    .select("id")
    .single();

  if (error) {
    throw fromDatabaseError(error, {
      resource: "invitation",
      conflictMessages: {
        invitations_pending_uniq: "There is already a pending invitation for that address.",
      },
    });
  }

  // An invitee with no account cannot accept, so provision one. A club admin
  // inviting someone is exactly the authority "no public sign-up" defers to.
  let accountCreated = false;
  if (!profile) {
    const { error: linkError } = await admin.auth.admin.generateLink({
      type: "invite",
      email: input.email,
      options: {
        redirectTo: new URL("/auth/callback?next=/reset-password", env.NEXT_PUBLIC_APP_URL).toString(),
      },
    });
    accountCreated = !linkError;
  }

  await queueInvitationEmail(context, input.email, token, expiresAt);

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MEMBER_INVITED,
    resourceType: "invitation",
    resourceId: data.id,
    // The token is never logged — only who was invited, as what.
    newValue: { email: input.email, role: role.name },
  });

  return {
    invitationId: data.id,
    link: new URL(`/invitation/${token}`, env.NEXT_PUBLIC_APP_URL).toString(),
    accountCreated,
  };
}

/** Queues the invitation email. Delivery is a background concern. */
async function queueInvitationEmail(
  context: AuthContext,
  email: string,
  token: string,
  expiresAt: string,
): Promise<void> {
  await createAdminClient()
    .from("email_outbox")
    .insert({
      tenant_id: context.tenant.id,
      to_email: email,
      template: "invitation",
      payload: {
        clubName: context.tenant.name,
        invitedBy: context.user.fullName ?? context.user.email,
        // The link is the payload's whole point; the outbox is service-role only.
        link: new URL(`/invitation/${token}`, env.NEXT_PUBLIC_APP_URL).toString(),
        expiresAt,
      },
      dedupe_key: `invitation:${context.tenant.id}:${email}:${Date.now()}`,
    });
}

export async function revokeInvitation(context: AuthContext, id: string): Promise<void> {
  assertPermission(context, "members.invite");

  const { error } = await context.db
    .from("invitations")
    .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .eq("status", "PENDING");

  if (error) throw fromDatabaseError(error, { resource: "invitation" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MEMBER_INVITATION_REVOKED,
    resourceType: "invitation",
    resourceId: id,
  });
}

export async function changeMemberRole(
  context: AuthContext,
  input: ChangeRoleInput,
): Promise<void> {
  assertPermission(context, "members.update");

  const member = await getMembership(context, input.membershipId);
  const currentRole = await getRole(context, member.role_id);
  const nextRole = await getRole(context, input.roleId);

  // Both directions are checked: you cannot act on someone above you, and you
  // cannot promote anyone above yourself.
  assertOutranks(context, currentRole.rank);
  assertCanGrantRole(context, nextRole.rank);

  if (member.user_id === context.user.id && nextRole.rank > context.role.rank) {
    throw new ConflictError("You can't reduce your own access. Ask another owner to do it.");
  }

  const { error } = await context.db
    .from("tenant_memberships")
    .update({ role_id: input.roleId })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.membershipId);

  if (error) {
    throw fromDatabaseError(error, {
      resource: "member",
      conflictMessages: {},
    });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
    resourceType: "tenant_membership",
    resourceId: input.membershipId,
    oldValue: { role: currentRole.name },
    newValue: { role: nextRole.name },
  });
}

export async function removeMember(context: AuthContext, membershipId: string): Promise<void> {
  assertPermission(context, "members.remove");

  const member = await getMembership(context, membershipId);
  const role = await getRole(context, member.role_id);
  assertOutranks(context, role.rank);

  if (member.user_id === context.user.id) {
    throw new ConflictError("You can't remove yourself from the club.");
  }

  const { error } = await context.db
    .from("tenant_memberships")
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("id", membershipId);

  if (error) throw fromDatabaseError(error, { resource: "member" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MEMBER_REMOVED,
    resourceType: "tenant_membership",
    resourceId: membershipId,
    oldValue: { role: role.name },
  });
}

/**
 * Per-user permission overrides.
 *
 * The distinctive part of the authorization model: a role is a default, and an
 * individual can be granted or denied a single permission on top of it.
 * Removing an override restores the role's default rather than denying — which
 * is why INHERIT is a separate choice from DENY.
 */
export async function setPermissionOverride(
  context: AuthContext,
  input: SetOverrideInput,
): Promise<void> {
  assertPermission(context, "roles.update");

  const { data: target } = await context.db
    .from("tenant_memberships")
    .select("role_id")
    .eq("tenant_id", context.tenant.id)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!target) throw new NotFoundError("member");
  assertOutranks(context, (await getRole(context, target.role_id)).rank);

  if (input.effect === "INHERIT") {
    const { error } = await context.db
      .from("user_permission_overrides")
      .delete()
      .eq("tenant_id", context.tenant.id)
      .eq("user_id", input.userId)
      .eq("permission_key", input.permissionKey);

    if (error) throw fromDatabaseError(error, { resource: "permission" });
  } else {
    const { error } = await context.db.from("user_permission_overrides").upsert(
      {
        tenant_id: context.tenant.id,
        user_id: input.userId,
        permission_key: input.permissionKey,
        effect: input.effect,
        reason: input.reason,
        created_by: context.user.id,
      },
      { onConflict: "tenant_id,user_id,permission_key" },
    );

    if (error) throw fromDatabaseError(error, { resource: "permission" });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.PERMISSION_CHANGED,
    resourceType: "user_permission_override",
    resourceId: input.userId,
    newValue: { permission: input.permissionKey, effect: input.effect },
    reason: input.reason,
  });
}

/** A member's effective permissions, and where each one comes from. */
export async function getMemberPermissions(
  context: AuthContext,
  userId: string,
): Promise<{ effective: Set<Permission>; overrides: Map<string, "ALLOW" | "DENY">; roleDefaults: Set<string> }> {
  assertPermission(context, "roles.read");

  const [membership, overrides, permissions] = await Promise.all([
    context.db
      .from("tenant_memberships")
      .select("role_id")
      .eq("tenant_id", context.tenant.id)
      .eq("user_id", userId)
      .maybeSingle(),
    context.db
      .from("user_permission_overrides")
      .select("permission_key, effect")
      .eq("tenant_id", context.tenant.id)
      .eq("user_id", userId),
    context.db.from("permissions").select("key, resource, action, description, category, sort_order"),
  ]);

  const roleDefaults = new Set<string>();
  if (membership.data) {
    const { data } = await context.db
      .from("role_permissions")
      .select("permission_key")
      .eq("role_id", membership.data.role_id);
    for (const row of data ?? []) roleDefaults.add(row.permission_key);
  }

  const overrideMap = new Map<string, "ALLOW" | "DENY">(
    (overrides.data ?? []).map((row) => [row.permission_key, row.effect]),
  );

  const effective = new Set<Permission>();
  for (const permission of permissions.data ?? []) {
    const override = overrideMap.get(permission.key);
    const granted = override ? override === "ALLOW" : roleDefaults.has(permission.key);
    if (granted) effective.add(permission.key as Permission);
  }

  return { effective, overrides: overrideMap, roleDefaults };
}

async function getMembership(context: AuthContext, id: string) {
  const { data } = await context.db
    .from("tenant_memberships")
    .select("id, user_id, role_id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", id)
    .maybeSingle();

  if (!data) throw new NotFoundError("member");
  return data;
}

async function getRole(context: AuthContext, id: string) {
  const { data } = await context.db.from("roles").select("id, key, name, rank").eq("id", id).maybeSingle();
  if (!data) throw new NotFoundError("role");
  return data;
}
