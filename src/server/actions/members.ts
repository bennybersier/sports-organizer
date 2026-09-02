"use server";

import { revalidatePath } from "next/cache";

import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { requirePermission } from "@/server/auth/authorization";
import {
  changeRoleSchema,
  inviteMemberSchema,
  setOverrideSchema,
} from "@/lib/validation/member";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
  setPermissionOverride,
} from "@/server/services/membership-service";

export async function inviteMemberAction(
  input: unknown,
): Promise<ActionResult<{ link: string; accountCreated: boolean }>> {
  return runAction(async () => {
    const context = await requirePermission("members.invite");
    const result = await inviteMember(context, parseInput(inviteMemberSchema, input));
    revalidatePath("/members");
    return { link: result.link, accountCreated: result.accountCreated };
  });
}

export async function revokeInvitationAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("members.invite");
    await revokeInvitation(context, id);
    revalidatePath("/members");
    return null;
  });
}

export async function changeRoleAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("members.update");
    await changeMemberRole(context, parseInput(changeRoleSchema, input));
    revalidatePath("/members");
    return null;
  });
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("members.remove");
    await removeMember(context, membershipId);
    revalidatePath("/members");
    return null;
  });
}

export async function setOverrideAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const context = await requirePermission("roles.update");
    await setPermissionOverride(context, parseInput(setOverrideSchema, input));
    revalidatePath("/members");
    return null;
  });
}
