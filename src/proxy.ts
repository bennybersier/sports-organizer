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

/** Routes reachable without a session cookie. */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/invitation",
  "/auth/callback",
  "/auth/error",
];

/**
 * Routes that authenticate themselves.
 *
 * `/api/mcp` presents an API key, not a session cookie. Redirecting it to the
 * login page would hand a machine client an HTML page and an HTTP 200 where it
 * expected JSON and a 401 — so the gate below steps aside and lets the route
 * answer for itself.
 */
const SELF_AUTHENTICATING_PREFIXES = ["/api/mcp"];

function isPublic(pathname: string): boolean {
  return [...PUBLIC_PREFIXES, ...SELF_AUTHENTICATING_PREFIXES].some(
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

  // "/" and "/login" resolve server-side, where membership and staff status are
  // known — the proxy deliberately does not guess between /dashboard and /admin.
  if (userId && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
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
