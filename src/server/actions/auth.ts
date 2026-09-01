"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/env";
import { runAction, parseInput, type ActionResult } from "@/lib/action";
import { AuthenticationError, ValidationError, fromDatabaseError } from "@/lib/errors";
import { hashSecret } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  acceptInvitationSchema,
} from "@/lib/validation/auth";
import { ACTIVE_TENANT_COOKIE, getMemberships } from "@/server/auth/context";

const TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.APP_ENV !== "development",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export async function signIn(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const { email, password, next } = parseInput(signInSchema, input);
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // One message for both "no such user" and "wrong password", so the form
      // cannot be used to discover which addresses have accounts.
      throw new AuthenticationError("That email and password don't match an account.");
    }

    return { redirectTo: safeRedirect(next) };
  });
}

export async function signInWithGoogle(next?: string): Promise<ActionResult<never>> {
  const supabase = await createClient();
  const callback = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
  if (next) callback.searchParams.set("next", safeRedirect(next));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  if (error || !data.url) {
    return { ok: false, error: { code: "EXTERNAL_SERVICE_ERROR", message: "Google sign-in is unavailable right now." } };
  }

  redirect(data.url);
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_TENANT_COOKIE);

  redirect("/login");
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { email } = parseInput(forgotPasswordSchema, input);
    const supabase = await createClient();

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/auth/callback?next=/reset-password", env.NEXT_PUBLIC_APP_URL).toString(),
    });

    // Always report success: whether an address has an account is not something
    // an unauthenticated caller gets to learn.
    return null;
  });
}

export async function updatePassword(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { password } = parseInput(resetPasswordSchema, input);
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new AuthenticationError("Your reset link has expired. Request a new one.");
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new ValidationError(error.message, { fieldErrors: { password: [error.message] } });

    return null;
  });
}

/**
 * Redeems an invitation for the signed-in user.
 *
 * The raw token never touches the database: we hash it and let
 * `accept_invitation` match on the hash, verify the email matches the signed-in
 * account, and create the membership in one transaction.
 */
export async function acceptInvitation(input: unknown): Promise<ActionResult<{ tenantId: string }>> {
  return runAction(async () => {
    const { token } = parseInput(acceptInvitationSchema, input);
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AuthenticationError();

    const { data, error } = await supabase.rpc("accept_invitation", {
      p_token_hash: hashSecret(token),
    });

    if (error) throw fromDatabaseError(error, { resource: "invitation" });

    const tenantId = data as unknown as string;
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, TENANT_COOKIE_OPTIONS);

    return { tenantId };
  });
}

/**
 * Switches the active club.
 *
 * The cookie only ever *selects* among clubs the user already belongs to —
 * membership is re-verified here before it is written, and again on every
 * server request that reads it.
 */
export async function setActiveTenant(tenantId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const memberships = await getMemberships();
    if (!memberships.some((membership) => membership.tenantId === tenantId)) {
      throw new AuthenticationError("You don't have access to that club.");
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, TENANT_COOKIE_OPTIONS);
    return null;
  });
}

/** Only same-origin relative paths survive, so `next` can't become an open redirect. */
function safeRedirect(next: string | undefined): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}
