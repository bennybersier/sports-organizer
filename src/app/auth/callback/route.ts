import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link / password-recovery landing point.
 *
 * Supabase redirects here with a one-time `code`, which we exchange for a
 * session server-side so the tokens are written straight into HttpOnly cookies
 * and never pass through client JavaScript.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  // Supabase reports failures (denied consent, expired link) as query params.
  const authError = searchParams.get("error_description") ?? searchParams.get("error");
  if (authError) {
    return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(authError)}`, origin));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/auth/error?reason=missing_code", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/auth/error?reason=exchange_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}

/** Relative same-origin paths only, so `next` can never become an open redirect. */
function sanitizeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
