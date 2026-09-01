import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/env";
import type { Database } from "@/types/database";

let cached: SupabaseClient<Database> | null = null;

/**
 * Service-role client. **Bypasses RLS entirely.**
 *
 * Legitimate uses, all of which perform their own authorization first:
 *   - reading/writing secret-bearing tables (AI keys, OAuth tokens, MCP keys),
 *     which have no `authenticated` grants at all
 *   - background jobs, which run without a user session
 *   - the MCP layer, which authenticates by API key rather than a JWT
 *   - invitation issuing, which must write rows the inviter cannot read back
 *
 * Never call this from a client component, and never pass a tenant id that
 * came from the client without validating membership first.
 */
export function createAdminClient(): SupabaseClient<Database> {
  cached ??= createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "x-application-name": "sport-club-organizer" } },
    },
  );
  return cached;
}
