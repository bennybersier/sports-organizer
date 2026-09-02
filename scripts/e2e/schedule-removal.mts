/**
 * End-to-end check of the schedule removal paths, against the real database.
 * Creates a throwaway club, publishes a schedule, then exercises every path a
 * user now has to take training off the calendar. Cleans up either way.
 */
import { randomBytes } from "node:crypto";

const U = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let pass = 0; const fails: string[] = [];
function check(what: string, ok: boolean, detail?: unknown) {
  if (ok) { console.log(`  \x1b[32m✓\x1b[0m ${what}`); pass++; }
  else { console.log(`  \x1b[31m✗ ${what}\x1b[0m`); if (detail !== undefined) console.log(`      got: ${String(JSON.stringify(detail)).slice(0,200)}`); fails.push(what); }
}
async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(`${U}/rest/v1/${path}`, init);
  const text = await r.text(); let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, body };
}
const asAdmin = (p: string, i: RequestInit = {}) => api(p, { ...i, headers: { ...admin, ...(i.headers ?? {}) } });
const rep = { Prefer: "return=representation" };

let tenantId = ""; let userId = "";
try {
  const slug = `zz-rm-${Date.now()}${Math.random().toString(36).slice(2,6)}`;
  tenantId = ((await asAdmin("tenants", { method: "POST", headers: rep, body: JSON.stringify({ name: "ZZ Removal", slug, timezone: "Europe/Zurich" }) })).body as {id:string}[])[0].id;
  const roleId = ((await asAdmin("roles?key=eq.OWNER&tenant_id=is.null&select=id")).body as {id:string}[])[0].id;
  const email = `zz-rm-${Date.now()}@example.test`; const password = `zz-${randomBytes(9).toString("base64url")}-Aa1!`;
  userId = ((await (await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: admin, body: JSON.stringify({ email, password, email_confirm: true }) })).json()) as {id:string}).id;
  await asAdmin("tenant_memberships", { method: "POST", body: JSON.stringify({ tenant_id: tenantId, user_id: userId, role_id: roleId }) });

  const season = ((await asAdmin("seasons", { method: "POST", headers: rep, body: JSON.stringify({ tenant_id: tenantId, name: "2026/2027", start_date: "2026-09-07", end_date: "2027-06-30", status: "ACTIVE" }) })).body as {id:string}[])[0];
  const gym = ((await asAdmin("gyms", { method: "POST", headers: rep, body: JSON.stringify({ tenant_id: tenantId, name: "Hall" }) })).body as {id:string}[])[0];
  const team = ((await asAdmin("teams", { method: "POST", headers: rep, body: JSON.stringify({ tenant_id: tenantId, season_id: season.id, name: "U16", sport: "Volleyball" }) })).body as {id:string}[])[0];
  const version = ((await asAdmin("schedule_versions", { method: "POST", headers: rep, body: JSON.stringify({ tenant_id: tenantId, season_id: season.id, status: "GENERATED", applies_from: "2026-09-07", applies_until: "2027-06-30" }) })).body as {id:string}[])[0];
  const entries = (await asAdmin("schedule_entries", { method: "POST", headers: rep, body: JSON.stringify([
    { tenant_id: tenantId, season_id: season.id, schedule_version_id: version.id, team_id: team.id, gym_id: gym.id, start_at: "2026-09-08T16:00:00Z", end_at: "2026-09-08T18:00:00Z", status: "SCHEDULED" },
    { tenant_id: tenantId, season_id: season.id, schedule_version_id: version.id, team_id: team.id, gym_id: gym.id, start_at: "2026-09-10T16:00:00Z", end_at: "2026-09-10T18:00:00Z", status: "SCHEDULED" },
  ]) })).body as {id:string}[];

  const session = (await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json()) as {access_token:string};
  const h = { apikey: PUBLISHABLE, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
  const asUser = (p: string, i: RequestInit = {}) => api(p, { ...i, headers: { ...h, ...(i.headers ?? {}) } });

  console.log("\nPublishing, then removing:");
  const published = await fetch(`${U}/rest/v1/rpc/publish_schedule_version`, { method: "POST", headers: h, body: JSON.stringify({ p_version_id: version.id }) });
  check("schedule publishes", published.ok, await published.clone().text());

  // 1. Cancel a single session.
  const cancelled = await asUser(`schedule_entries?id=eq.${entries[0].id}`, { method: "PATCH", headers: rep, body: JSON.stringify({ status: "CANCELLED" }) });
  check("one session can be cancelled", Array.isArray(cancelled.body) && cancelled.body.length === 1, cancelled.body);

  // The cancelled session must still be visible — struck through, not vanished.
  const stillThere = await asUser(`schedule_entries?id=eq.${entries[0].id}&select=status`);
  check("cancelled session stays on the calendar", (stillThere.body as {status:string}[])?.[0]?.status === "CANCELLED", stillThere.body);

  // 2. Restore it.
  const restored = await asUser(`schedule_entries?id=eq.${entries[0].id}&status=eq.CANCELLED`, { method: "PATCH", headers: rep, body: JSON.stringify({ status: "SCHEDULED" }) });
  check("a cancelled session can be restored", Array.isArray(restored.body) && restored.body.length === 1, restored.body);

  // 3. A published version must still resist outright deletion.
  const deletePublished = await asUser(`schedule_versions?id=eq.${version.id}`, { method: "DELETE", headers: rep });
  check("published schedule still cannot be deleted outright", Array.isArray(deletePublished.body) && deletePublished.body.length === 0, deletePublished.body);

  // 4. Withdraw it.
  const withdrawn = await asUser(`schedule_versions?id=eq.${version.id}`, { method: "PATCH", headers: rep, body: JSON.stringify({ status: "ARCHIVED", archived_at: new Date().toISOString() }) });
  check("published schedule can be withdrawn", Array.isArray(withdrawn.body) && withdrawn.body.length === 1, withdrawn.body);

  // 5. The calendar reads only the published version, so it must now be empty.
  const stillPublished = await asUser(`schedule_versions?tenant_id=eq.${tenantId}&status=eq.PUBLISHED&select=id`);
  check("no published schedule remains — calendar is clear", Array.isArray(stillPublished.body) && stillPublished.body.length === 0, stillPublished.body);

  // 6. Sessions survive the withdrawal, so history is intact.
  const survived = await asUser(`schedule_entries?schedule_version_id=eq.${version.id}&select=id`);
  check("withdrawn sessions are kept, not destroyed", Array.isArray(survived.body) && survived.body.length === 2, survived.body);

  // 7. And it can now be discarded for good.
  const discarded = await asUser(`schedule_versions?id=eq.${version.id}`, { method: "DELETE", headers: rep });
  check("a withdrawn schedule can then be discarded", Array.isArray(discarded.body) && discarded.body.length === 1, discarded.body);
} finally {
  if (tenantId) await asAdmin(`tenants?id=eq.${tenantId}`, { method: "DELETE" });
  if (userId) await fetch(`${U}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: admin });
}
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
