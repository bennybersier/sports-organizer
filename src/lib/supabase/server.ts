import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/env";
import type { Database } from "@/types/database";

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Supabase client bound to the signed-in user's session.
 *
 * Every query through this client is subject to RLS, which is our second line
 * of defence: even a bug in an application-level permission check cannot read
 * another tenant's rows through it.
 *
 * This is the default client. Reach for `createAdminClient` only when a
 * request genuinely cannot carry a user JWT (background jobs, MCP, secret
 * decryption) — and only after checking permissions in application code.
 *
 * One per request: the auth context, the page and its services all share it,
 * so the session is read from the cookie once rather than per caller.
 */
export const createClient = cache(async (): Promise<TypedSupabaseClient> => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
});
