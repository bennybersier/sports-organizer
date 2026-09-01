import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/types/database";

/**
 * Secret-key client for CLI scripts.
 *
 * Kept separate from src/lib/supabase/admin.ts because that module is
 * `server-only` and pulls in the Next.js request context. Scripts read
 * .env.local via tsx's --env-file-if-exists flag (see package.json).
 */
export function adminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.\n" +
        "Copy .env.example to .env.local and fill them in first.",
    );
    process.exit(1);
  }

  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Reads `--flag value` and `--flag=value` from argv. */
export function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) {
    return argv[index + 1];
  }
  const inline = argv.find((entry) => entry.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}
