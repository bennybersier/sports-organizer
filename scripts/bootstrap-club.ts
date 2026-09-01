/**
 * Creates the very first club and its Owner.
 *
 * The product has no public sign-up: every account arrives through an
 * invitation, and an invitation has to come from someone who is already an
 * Owner. This script breaks that cycle once, at install time, from a machine
 * that already holds the secret key.
 *
 *   pnpm bootstrap:club --email you@club.example --name "Riverside Athletics"
 *
 * Optional: --slug, --timezone, --password (otherwise an invite email is sent).
 */
import { randomUUID } from "node:crypto";

import { adminClient, arg } from "./lib/admin";

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  const password = arg("password");
  const timezone = arg("timezone") ?? "Europe/Zurich";
  const slug = arg("slug") ?? slugify(name ?? "");

  if (!email || !name) {
    console.error(
      'Usage: pnpm bootstrap:club --email you@club.example --name "Your Club"\n' +
        "       [--slug your-club] [--timezone Europe/Zurich] [--password <initial password>]",
    );
    process.exit(1);
  }

  const supabase = adminClient();

  // 1. Find or create the auth user.
  let userId: string | undefined;

  const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  userId = existing?.users.find((user) => user.email?.toLowerCase() === email)?.id;

  if (userId) {
    console.log(`• Using existing account for ${email}`);
  } else if (password) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`• Created account for ${email} with the password you supplied`);
  } else {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
    if (error) throw error;
    userId = data.user.id;
    console.log(`• Invited ${email} — check that inbox to set a password`);
  }

  // 2. Provision the club. The RPC creates the tenant, the Owner membership and
  //    the onboarding record in one transaction.
  const { data: tenantId, error: provisionError } = await supabase.rpc(
    "provision_tenant" as never,
    {
      p_name: name,
      p_slug: slug,
      p_owner_id: userId,
      p_timezone: timezone,
    } as never,
  );

  if (provisionError) {
    // provision_tenant lives in the private `app` schema, which PostgREST does
    // not expose. Fall back to doing the same work over three statements.
    console.log("• Provisioning directly (app.provision_tenant is not exposed via the API)");
    await provisionDirectly(supabase, { name, slug, timezone, userId });
  } else {
    console.log(`• Created club "${name}" (${tenantId})`);
  }

  console.log("\nDone. Sign in at /login and you'll land on the dashboard as Owner.");
}

async function provisionDirectly(
  supabase: ReturnType<typeof adminClient>,
  input: { name: string; slug: string; timezone: string; userId: string },
) {
  const { data: ownerRole, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("key", "OWNER")
    .is("tenant_id", null)
    .single();

  if (roleError || !ownerRole) {
    throw new Error(
      "The OWNER role is missing. Run `pnpm db:push` to apply migrations first.",
    );
  }

  const tenantId = randomUUID();

  const { error: tenantError } = await supabase.from("tenants").insert({
    id: tenantId,
    name: input.name,
    slug: input.slug,
    timezone: input.timezone,
    created_by: input.userId,
  });
  if (tenantError) throw tenantError;

  const { error: membershipError } = await supabase.from("tenant_memberships").insert({
    tenant_id: tenantId,
    user_id: input.userId,
    role_id: ownerRole.id,
    created_by: input.userId,
  });
  if (membershipError) {
    // Don't leave a club nobody can administer.
    await supabase.from("tenants").delete().eq("id", tenantId);
    throw membershipError;
  }

  await supabase.from("onboarding_progress").insert({ tenant_id: tenantId });
  console.log(`• Created club "${input.name}" (${tenantId})`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

main().catch((error) => {
  console.error("\nBootstrap failed:", error.message ?? error);
  process.exit(1);
});
