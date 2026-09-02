import { z } from "zod";

/** Field primitives shared across the entity forms. */

export const uuidSchema = z.uuid("That doesn't look like a valid reference.");

export const nameSchema = (max = 150) =>
  z.string().trim().min(1, "This can't be empty.").max(max, `Keep this under ${max} characters.`);

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

export const optionalEmail = z
  .union([z.literal(""), z.email("Enter a valid email address.")])
  .optional()
  .transform((value) => (value ? value.toLowerCase() : null));

export const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((value) => (value ? value : null));

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.");

/** An ISO date (YYYY-MM-DD), which is how Postgres `date` columns round-trip. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.");

export const entityStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]);
export const genderSchema = z.enum(["MALE", "FEMALE", "MIXED", "OTHER", "UNSPECIFIED"]);
export const membershipStateSchema = z.enum(["ACTIVE", "TRIAL", "INACTIVE", "SUSPENDED"]);

/** Turns a multi-select's string[] into a clean, de-duplicated array. */
export const stringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return [...new Set(list.map((item) => item.trim()).filter(Boolean))];
  });
