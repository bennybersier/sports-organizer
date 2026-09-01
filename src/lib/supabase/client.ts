"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/public-env";
import type { Database } from "@/types/database";

/**
 * Browser client. Used only for things that genuinely belong on the client:
 * the auth flows (sign in, OAuth redirect, password reset) and Realtime
 * subscriptions. Data reads happen in Server Components.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
}
