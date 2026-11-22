import { z } from "zod";

import {
  hexColorSchema,
  nameSchema,
  optionalText,
  stringArray,
  uuidSchema,
} from "./common";

const baseGym = z.object({
  name: nameSchema(150),
  description: optionalText(1000),
  addressLine1: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(120),
  country: optionalText(120),
  capacity: z
    .union([z.literal(""), z.coerce.number().int().positive().max(100_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  /**
   * Whether this hall can hold two teams at the changeover, and for how long.
   *
   * Exposed as a switch plus a short list rather than a free number, because a
   * club typing 90 here does not mean a changeover — it means two sessions at
   * once, which is a different decision about a different hall.
   */
  sharesHall: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional()
    .transform((v) => v === true || v === "on"),
  /*
    Only meaningful when the hall shares. A hall that does not is stored with
    0, and the edit form sends that 0 back from its hidden field — so the
    15–45 range is checked against sharing below, not on the bare number,
    or no non-sharing hall could ever be saved again.
  */
  sharedOverlapMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(45)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? 30 : v)),
  /*
    Optional with no default, like an athlete's consent: an update that does
    not mention it — an MCP tool, say — must not turn an away hall into one the
    generator would schedule training in. The column default covers creation.
  */
  isAway: z.boolean().optional(),
  sportTypes: stringArray,
  equipment: stringArray,
  color: z.union([z.literal(""), hexColorSchema]).optional().transform((v) => v || null),
  notes: optionalText(2000),
});

/** The changeover tolerance must be a real one whenever the hall shares. */
function sharingNeedsOverlap(
  gym: { sharesHall: boolean; sharedOverlapMinutes: number },
  ctx: z.RefinementCtx,
) {
  if (gym.sharesHall && gym.sharedOverlapMinutes < 15) {
    ctx.addIssue({
      code: "custom",
      path: ["sharedOverlapMinutes"],
      message: "Choose between 15 and 45 minutes.",
    });
  }
}

export const createGymSchema = baseGym.superRefine(sharingNeedsOverlap);
export const updateGymSchema = baseGym
  .extend({ id: uuidSchema })
  .superRefine(sharingNeedsOverlap);

export type CreateGymInput = z.infer<typeof createGymSchema>;
export type UpdateGymInput = z.infer<typeof updateGymSchema>;
