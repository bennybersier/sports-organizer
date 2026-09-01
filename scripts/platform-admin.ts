/**
 * Grants, revokes and lists platform administrators.
 *
 * A platform admin is staff of the system, not a member of any club: they hold
 * no tenant_membership yet can administer every club. That is a deliberate hole
 * in tenant isolation, so the grant is only ever made from a machine holding
 * the secret key — never from the app, and never by a user on themselves.
 *
 *   pnpm platform:admin --list
 *   pnpm platform:admin --email you@example.com --note "Founder, runs support"
 *   pnpm platform:admin --email you@example.com --revoke
 */
import { adminClient, arg } from "./lib/admin";

const REVOKE = process.argv.includes("--revoke");
const LIST = process.argv.includes("--list");

async function main() {
  const supabase = adminClient();

  if (LIST) return list(supabase);

  const email = arg("email")?.toLowerCase().trim();
  if (!email) {
    console.error(
      "Usage:\n" +
        "  pnpm platform:admin --list\n" +
        '  pnpm platform:admin --email you@example.com --note "why they have this"\n' +
        "  pnpm platform:admin --email you@example.com --revoke",
    );
    process.exit(1);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", email)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) {
    console.error(
      `No account for ${email}.\n` +
        "Create the user in Supabase Auth first — this grants access to an " +
        "existing identity, it never creates one.",
    );
    process.exit(1);
  }

  if (REVOKE) {
    const { error } = await supabase
      .from("platform_admins")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", profile.id)
      .is("revoked_at", null);
    if (error) throw error;
    console.log(`Revoked platform administrator access for ${email}.`);
    return list(supabase);
  }

  const note = arg("note");
  if (!note) {
    console.error(
      'A --note is required: an unexplained grant is one nobody can review later.\n' +
        '  pnpm platform:admin --email you@example.com --note "Founder, runs support"',
    );
    process.exit(1);
  }

  const { error } = await supabase
    .from("platform_admins")
    .upsert(
      { user_id: profile.id, note, granted_at: new Date().toISOString(), revoked_at: null },
      { onConflict: "user_id" },
    );
  if (error) throw error;

  console.log(`Granted platform administrator access to ${email}.`);
  console.log(
    "\nThis account can now read and administer every club in the system.\n" +
      "Its actions are audited as PLATFORM_ADMIN and the app shows a banner\n" +
      "whenever it is acting inside a club it does not belong to.",
  );
  return list(supabase);
}

async function list(supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id, note, granted_at, revoked_at, profiles!platform_admins_user_id_fkey(email)")
    .order("granted_at", { ascending: false });

  if (error) throw error;

  console.log("\nPlatform administrators:");
  if (!data || data.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const row of data as unknown as {
    note: string;
    granted_at: string;
    revoked_at: string | null;
    profiles: { email: string } | null;
  }[]) {
    const state = row.revoked_at ? "REVOKED" : "active ";
    console.log(
      `  ${state}  ${(row.profiles?.email ?? "unknown").padEnd(32)} ${row.note}`,
    );
  }
}

main().catch((error) => {
  console.error("\nFailed:", error.message ?? error);
  process.exit(1);
});
