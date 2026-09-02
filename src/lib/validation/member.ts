import { z } from "zod";

import { emailSchema } from "./auth";
import { optionalText, uuidSchema } from "./common";

export const inviteMemberSchema = z.object({
  email: emailSchema,
  roleId: uuidSchema,
  message: optionalText(500),
});

export const changeRoleSchema = z.object({
  membershipId: uuidSchema,
  roleId: uuidSchema,
});

export const setOverrideSchema = z.object({
  userId: uuidSchema,
  permissionKey: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  /** ALLOW and DENY are explicit; INHERIT removes the override entirely. */
  effect: z.enum(["ALLOW", "DENY", "INHERIT"]),
  reason: optionalText(300),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type SetOverrideInput = z.infer<typeof setOverrideSchema>;
