/**
 * The only environment values allowed to cross into the browser bundle.
 *
 * Kept separate from `src/env.ts` (which is `server-only`) so client components
 * can read configuration without pulling server secrets into their import
 * graph. Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so these
 * must be referenced as full literals rather than looked up dynamically.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
