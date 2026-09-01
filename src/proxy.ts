import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Session refresh plus a coarse authentication gate.
 *
 * Next 16 renamed the middleware convention to `proxy`; this runs in the same
 * place in the request lifecycle.
 *
 * This keeps the Supabase auth cookie fresh and bounces anonymous users away
 * from the app shell. It is *not* authorization: it knows nothing about
 * tenants or permissions. Every page and action re-resolves membership and
 * permissions server-side, and RLS guards the data underneath.
 */

/** Routes reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/invitation",
  "/auth/callback",
  "/auth/error",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (!userId && !isPublic(pathname)) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where they were heading so login can return them there.
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (userId && (pathname === "/login" || pathname === "/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation, so the session
     * cookie is refreshed on real navigations only.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
