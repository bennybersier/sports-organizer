/**
 * Cross-tenant isolation suite.
 *
 * The spec asks for security tests that *specifically attempt* cross-tenant
 * access, so this does exactly that: it builds two real clubs with real data,
 * then tries — as an authenticated member of club A, and as an MCP key issued
 * in club A — to read, write, update and destroy club B.
 *
 * Every assertion is phrased as an attack that must fail. A passing run means
 * the attack was refused; a failing run names the vector that got through.
 *
 *   pnpm test:security
 *
 * Runs against whatever .env.local points at. It creates two throwaway clubs
 * and removes them, plus every account it made, whether or not it passes.
 */
import { randomBytes, createHash } from "node:crypto";

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

if (!U || !SECRET || !PUBLISHABLE) {
  console.error("Missing Supabase configuration. Fill in .env.local first.");
  process.exit(1);
}

const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let passed = 0;
const failures: string[] = [];

function blocked(what: string, wasBlocked: boolean, detail?: unknown) {
  if (wasBlocked) {
    console.log(`  \x1b[32m✓\x1b[0m ${what}`);
    passed += 1;
  } else {
    console.log(`  \x1b[31m✗ ${what}\x1b[0m`);
    if (detail !== undefined) console.log(`      got: ${String(detail).slice(0, 180)}`);
    failures.push(what);
  }
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${U}/rest/v1/${path}`, init);
  const body = await response.text();
  let parsed: unknown = body;
  try { parsed = JSON.parse(body); } catch { /* keep raw */ }
  return { status: response.status, ok: response.ok, body: parsed };
}

const asAdmin = (path: string, init: RequestInit = {}) =>
  api(path, { ...init, headers: { ...admin, ...(init.headers ?? {}) } });

async function seed(name: string) {
  // Slugs are lowercase by constraint; the display name keeps its capital.
  const slug = `zz-sec-${name.toLowerCase()}-${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const created = await asAdmin("tenants", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: `ZZ Sec ${name}`, slug, timezone: "Europe/Zurich" }),
  });
  if (!created.ok) throw new Error(`Could not seed club ${name}: ${JSON.stringify(created.body)}`);
  const tenantId = (created.body as { id: string }[])[0].id;

  const roleId = ((await asAdmin("roles?key=eq.OWNER&tenant_id=is.null&select=id")).body as { id: string }[])[0].id;
  const email = `zz-sec-${name}-${Date.now()}@example.test`;
  const password = `zz-${randomBytes(9).toString("base64url")}-Aa1!`;

  const user = (await (await fetch(`${U}/auth/v1/admin/users`, {
    method: "POST", headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })).json()) as { id: string };

  await asAdmin("tenant_memberships", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, user_id: user.id, role_id: roleId }),
  });

  const season = ((await asAdmin("seasons", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: tenantId, name: "2026/2027", start_date: "2026-09-07", end_date: "2027-06-30", status: "ACTIVE" }),
  })).body as { id: string }[])[0];

  const gym = ((await asAdmin("gyms", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: tenantId, name: `${name} Hall` }),
  })).body as { id: string }[])[0];

  const team = ((await asAdmin("teams", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: tenantId, season_id: season.id, name: `${name} U16`, sport: "Volleyball" }),
  })).body as { id: string }[])[0];

  const athlete = ((await asAdmin("athletes", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ tenant_id: tenantId, first_name: name, last_name: "Athlete" }),
  })).body as { id: string }[])[0];

  await asAdmin("audit_logs", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId, action: "SEEDED", resource_type: "test" }),
  });

  const session = (await (await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: PUBLISHABLE!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })).json()) as { access_token: string };

  return {
    tenantId, userId: user.id, email, token: session.access_token,
    seasonId: season.id, gymId: gym.id, teamId: team.id, athleteId: athlete.id,
    headers: { apikey: PUBLISHABLE!, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
  };
}

const clubs: string[] = [];
const accounts: string[] = [];

try {
  console.log("Building two clubs with separate owners and data…\n");
  const a = await seed("A");
  const b = await seed("B");
  clubs.push(a.tenantId, b.tenantId);
  accounts.push(a.userId, b.userId);

  const asA = (path: string, init: RequestInit = {}) =>
    api(path, { ...init, headers: { ...a.headers, ...(init.headers ?? {}) } });

  const empty = (body: unknown) => Array.isArray(body) && body.length === 0;
  const rejected = (r: { ok: boolean; body: unknown }) => !r.ok || empty(r.body);

  // -------------------------------------------------------------------------
  console.log("Reading club B's data as a member of club A:");
  for (const table of [
    "tenants", "seasons", "teams", "athletes", "trainers", "gyms",
    "schedule_versions", "schedule_entries", "calendar_events",
    "tenant_memberships", "user_permission_overrides", "audit_logs",
    "gym_availability", "team_training_requirements", "notifications",
    "competitions", "competition_entries", "fixtures",
  ]) {
    const column = table === "tenants" ? "id" : "tenant_id";
    const result = await asA(`${table}?${column}=eq.${b.tenantId}&select=*`);
    blocked(`${table} — returns nothing`, rejected(result), JSON.stringify(result.body).slice(0, 120));
  }

  // -------------------------------------------------------------------------
  console.log("\nReading club B's secrets:");
  for (const table of ["ai_provider_configurations", "mcp_api_keys", "oauth_connections", "calendar_sync_links", "email_outbox", "platform_admins"]) {
    const result = await asA(`${table}?select=*`);
    blocked(`${table} — unreachable by any client`, rejected(result), result.status);
  }
  const invitationHash = await asA("invitations?select=token_hash");
  blocked("invitations.token_hash — not a selectable column", !invitationHash.ok, invitationHash.status);

  // -------------------------------------------------------------------------
  console.log("\nWriting into club B:");
  const insertions: [string, Record<string, unknown>][] = [
    ["teams", { tenant_id: b.tenantId, season_id: b.seasonId, name: "Injected", sport: "V" }],
    ["athletes", { tenant_id: b.tenantId, first_name: "In", last_name: "Jected" }],
    ["gyms", { tenant_id: b.tenantId, name: "Injected Hall" }],
    ["seasons", { tenant_id: b.tenantId, name: "Injected", start_date: "2026-01-01", end_date: "2026-12-01" }],
    ["calendar_events", { tenant_id: b.tenantId, type: "MATCH", title: "Injected", start_at: "2026-09-08T16:00:00Z", end_at: "2026-09-08T17:00:00Z" }],
    ["competitions", { tenant_id: b.tenantId, season_id: b.seasonId, team_id: b.teamId, name: "Injected Cup" }],
    ["audit_logs", { tenant_id: b.tenantId, action: "FORGED", resource_type: "test" }],
    ["user_permission_overrides", { tenant_id: b.tenantId, user_id: a.userId, permission_key: "tenant.delete", effect: "ALLOW" }],
    ["tenant_memberships", { tenant_id: b.tenantId, user_id: a.userId, role_id: ((await asAdmin("roles?key=eq.OWNER&tenant_id=is.null&select=id")).body as { id: string }[])[0].id }],
  ];
  for (const [table, row] of insertions) {
    const result = await asA(table, { method: "POST", body: JSON.stringify(row) });
    blocked(`insert into ${table} — refused`, !result.ok, `${result.status} ${JSON.stringify(result.body).slice(0, 90)}`);
  }

  // -------------------------------------------------------------------------
  console.log("\nModifying club B:");
  const rename = await asA(`teams?id=eq.${b.teamId}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: "Renamed by A" }),
  });
  blocked("rename club B's team — no rows affected", rejected(rename), JSON.stringify(rename.body).slice(0, 90));

  const stillNamed = ((await asAdmin(`teams?id=eq.${b.teamId}&select=name`)).body as { name: string }[])[0];
  blocked("club B's team keeps its name", stillNamed?.name === "B U16", stillNamed?.name);

  const deletion = await asA(`athletes?id=eq.${b.athleteId}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
  blocked("delete club B's athlete — no rows affected", rejected(deletion), JSON.stringify(deletion.body).slice(0, 90));

  const survived = (await asAdmin(`athletes?id=eq.${b.athleteId}&select=id`)).body as unknown[];
  blocked("club B's athlete survives", survived.length === 1, survived.length);

  const dropClub = await asA(`tenants?id=eq.${b.tenantId}`, { method: "DELETE" });
  const clubSurvived = ((await asAdmin(`tenants?id=eq.${b.tenantId}&select=id`)).body as unknown[]).length === 1;
  blocked("delete club B entirely — refused", clubSurvived, dropClub.status);

  // -------------------------------------------------------------------------
  console.log("\nSmuggling club B's rows into club A:");
  const crossFk = await asA("teams", {
    method: "POST",
    // A team in *my* club, pointing at *their* season.
    body: JSON.stringify({ tenant_id: a.tenantId, season_id: b.seasonId, name: "Cross", sport: "V" }),
  });
  blocked("team in A referencing B's season — refused by trigger", !crossFk.ok, `${crossFk.status} ${JSON.stringify(crossFk.body).slice(0, 90)}`);

  const crossEntry = await asA("schedule_entries", {
    method: "POST",
    body: JSON.stringify({ tenant_id: a.tenantId, season_id: a.seasonId, schedule_version_id: a.seasonId, team_id: b.teamId, gym_id: b.gymId, start_at: "2026-09-08T16:00:00Z", end_at: "2026-09-08T17:00:00Z" }),
  });
  blocked("schedule entry in A using B's team and gym — refused", !crossEntry.ok, crossEntry.status);

  // -------------------------------------------------------------------------
  console.log("\nEscalating inside club A:");
  const selfGrant = await asA("user_permission_overrides", {
    method: "POST",
    body: JSON.stringify({ tenant_id: a.tenantId, user_id: a.userId, permission_key: "tenant.delete", effect: "ALLOW" }),
  });
  // An Owner legitimately holds roles.update, so this one *is* allowed —
  // the check that matters is that it cannot be done to another club, above.
  console.log(`      (self-override inside own club: ${selfGrant.ok ? "allowed for an Owner, as designed" : "refused"})`);

  const becomePlatformAdmin = await asA("platform_admins", {
    method: "POST", body: JSON.stringify({ user_id: a.userId, note: "self-granted" }),
  });
  blocked("grant self platform-admin — refused", !becomePlatformAdmin.ok, becomePlatformAdmin.status);

  const forgeProfileFlag = await asA(`profiles?id=eq.${a.userId}`, {
    method: "PATCH", body: JSON.stringify({ is_platform_admin: true }),
  });
  blocked("no privilege column on profiles to flip", !forgeProfileFlag.ok, forgeProfileFlag.status);

  // -------------------------------------------------------------------------
  console.log("\nForging the active-club cookie:");
  const encoded = "base64-" + Buffer.from(JSON.stringify({ access_token: a.token, token_type: "bearer", user: { id: a.userId } })).toString("base64");
  const ref = U!.replace("https://", "").split(".")[0];
  const forged = await fetch(`${APP}/teams`, {
    headers: { cookie: `sb-${ref}-auth-token=${encoded}; sco_active_tenant=${b.tenantId}; sco_locale=en` },
  });
  const html = (await forged.text()).replace(/<script[\s\S]*?<\/script>/g, "");
  blocked("pointing the cookie at club B shows none of its data", !html.includes("B U16"), html.match(/B U16/)?.[0]);

  // -------------------------------------------------------------------------
  console.log("\nUsing club A's MCP key against club B:");
  const rawKey = `sco_test_${randomBytes(32).toString("base64url")}`;
  await asAdmin("mcp_api_keys", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: a.tenantId, user_id: a.userId, name: "Isolation probe",
      secret_hash: createHash("sha256").update(rawKey).digest("hex"),
      key_prefix: rawKey.slice(0, 16), scopes: [],
    }),
  });

  const mcp = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${APP}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rawKey}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = await response.json() as { result?: { isError?: boolean; content?: { text: string }[] } };
    return body.result?.content?.[0]?.text ?? "";
  };

  const mcpTeams = await mcp("list_teams", {});
  blocked("MCP list_teams returns only club A's teams", mcpTeams.includes("A U16") && !mcpTeams.includes("B U16"), mcpTeams.slice(0, 120));

  const mcpTeam = await mcp("get_team", { teamId: b.teamId });
  blocked("MCP get_team on club B's team — refused", !mcpTeam.includes("B U16"), mcpTeam.slice(0, 120));

  const mcpAvailability = await mcp("get_availability", { domain: "gym", ownerId: b.gymId });
  blocked("MCP get_availability on club B's gym — returns nothing", !mcpAvailability.includes("weekly\":[{"), mcpAvailability.slice(0, 120));

  console.log(`\n${passed} attacks blocked, ${failures.length} succeeded.`);
  if (failures.length > 0) {
    console.log("\n\x1b[31mVectors that got through:\x1b[0m");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
} catch (error) {
  console.error("\nSuite error:", (error as Error).message);
  failures.push("suite error");
} finally {
  for (const id of clubs) await asAdmin(`tenants?id=eq.${id}`, { method: "DELETE" });
  for (const id of accounts) await fetch(`${U}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: admin });
  console.log("Test clubs and accounts removed.");
  process.exit(failures.length === 0 ? 0 : 1);
}
