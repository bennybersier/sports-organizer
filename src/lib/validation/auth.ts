import { z } from "zod";

/** Shared auth input schemas — used by both the forms and the server actions. */

export const emailSchema = z
  .email({ error: "Enter a valid email address." })
  .trim()
  .toLowerCase()
  .max(254);

/**
 * Deliberately length-based rather than a character-class gauntlet: length is
 * what actually resists guessing, and complexity rules push people toward
 * predictable substitutions. Supabase enforces its own minimum on top.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Passwords can be at most 72 characters.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The two passwords don't match.",
    path: ["confirmPassword"],
  });

export const acceptInvitationSchema = z.object({
  token: z.string().min(20, "That invitation link looks incomplete."),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
