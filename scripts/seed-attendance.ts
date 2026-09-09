/**
 * A few weeks of registers, so the module has something to say.
 *
 * Marks every published training session that has already happened, plus any
 * fixture in the past, with attendance that behaves like a real squad's rather
 * than a coin toss: most players turn up most of the time, one or two in each
 * group are unreliable, and absences cluster (a boy with flu misses the week,
 * he does not miss alternate Tuesdays).
 *
 * That shape matters. Uniform random attendance produces a report where every
 * finding fires for everybody, which is indistinguishable from a report where
 * none fire at all — and the findings are the whole point of collecting this.
 *
 *   pnpm db:seed:attendance --dry-run   # say what it would write
 *   pnpm db:seed:attendance --wipe      # clear registers first, then seed
 */
import { adminClient, arg } from "./lib/admin";
import { toInstant } from "../src/domain/scheduling/timezone";
import { toMinutes, type IsoWeekday } from "../src/domain/availability";

const TENANT_SLUG = arg("tenant") ?? "robur-fbl";
const DRY_RUN = process.argv.includes("--dry-run");
const WIPE = process.argv.includes("--wipe");

if (process.env.APP_ENV === "production") {
  console.error("Refusing to seed a production environment.");
  process.exit(1);
}

/** Deterministic, so a re-run does not reshuffle a season. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

const REASONS = ["INJURY", "ILLNESS", "SCHOOL", "FAMILY", "HOLIDAY", "TRANSPORT"] as const;

/**
 * How reliable each athlete is, fixed for the season.
 *
 * Drawn once per athlete rather than per session, which is what turns noise
 * into a pattern a coach would recognise — and what makes "has missed the last
 * three" mean something when it appears.
 */
function reliabilityOf(athleteId: string): number {
  const random = rng(hash(athleteId));
  const roll = random();
  if (roll < 0.08) return 0.55; // The one the coach worries about.
  if (roll < 0.25) return 0.8;
  return 0.94;
}

async function main() {
  const supabase = adminClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, slug, timezone")
    .eq("slug", TENANT_SLUG)
    .maybeSingle();
  if (!tenant) {
    console.error(`No club with slug "${TENANT_SLUG}".`);
    process.exit(1);
  }

  const { data: season } = await supabase
    .from("seasons")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!season) {
    console.error("No ACTIVE season.");
    process.exit(1);
  }

  console.log(`Club:   ${tenant.name}`);
  console.log(`Season: ${season.name}\n`);

  if (WIPE && !DRY_RUN) {
    // Records and box scores cascade from the register.
    const { error } = await supabase
      .from("attendance_registers")
      .delete()
      .eq("tenant_id", tenant.id);
    if (error) throw error;
    console.log("Cleared existing registers.\n");
  }

  const now = new Date().toISOString();

  /*
    Where the past comes from.

    A published schedule covers the weeks ahead; the weeks behind it may not be
    in any version at all — this club generated its first schedule today, so
    every entry it holds is in the future while the senior sides have been
    training since late August.

    Which is precisely the case the register was designed for. A register is a
    record of fact with a *nullable* pointer at the plan it came from, so a
    session that predates every schedule version is an ordinary register with no
    origin, not a special case. Past sessions are therefore reconstructed from
    each team's training requirements — the days and times they actually train —
    and any published entry already in the past is used directly.
  */
  const { data: version } = await supabase
    .from("schedule_versions")
    .select("id, applies_from")
    .eq("tenant_id", tenant.id)
    .eq("season_id", season.id)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  const { data: entries } = version
    ? await supabase
        .from("schedule_entries")
        .select("id, team_id, gym_id, trainer_id, start_at, end_at")
        .eq("tenant_id", tenant.id)
        .eq("schedule_version_id", version.id)
        .neq("status", "CANCELLED")
        .lte("start_at", now)
        .order("start_at")
    : { data: [] };

  // Everything before the published schedule starts, rebuilt from what each
  // team's week is supposed to look like.
  const reconstructUntil = version?.applies_from ?? now.slice(0, 10);
  const { data: requirements } = await supabase
    .from("team_training_requirements")
    .select("team_id, starts_on, duration_minutes, preferred_weekdays, allowed_weekdays, preferred_start, preferred_gym_ids, allowed_gym_ids")
    .eq("tenant_id", tenant.id)
    .eq("season_id", season.id)
    .lt("starts_on", reconstructUntil);

  interface Reconstructed {
    teamId: string;
    gymId: string | null;
    startAt: string;
    endAt: string;
  }
  const reconstructed: Reconstructed[] = [];

  for (const requirement of requirements ?? []) {
    const days = (requirement.preferred_weekdays?.length
      ? requirement.preferred_weekdays
      : requirement.allowed_weekdays) ?? [];
    if (days.length === 0) continue;

    const startMinutes = toMinutes(requirement.preferred_start ?? "18:00");
    const gymId =
      requirement.preferred_gym_ids?.[0] ?? requirement.allowed_gym_ids?.[0] ?? null;

    for (
      let day = new Date(`${requirement.starts_on}T00:00:00Z`);
      day.toISOString().slice(0, 10) < reconstructUntil;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const iso = day.toISOString().slice(0, 10);
      const weekday = (day.getUTCDay() === 0 ? 7 : day.getUTCDay()) as IsoWeekday;
      if (!days.includes(weekday)) continue;

      const start = toInstant(iso, startMinutes, tenant.timezone);
      const end = new Date(start.getTime() + requirement.duration_minutes * 60_000);
      reconstructed.push({
        teamId: requirement.team_id,
        gymId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
    }
  }

  const { data: fixtures } = await supabase
    .from("calendar_events")
    .select("id, gym_id, start_at, end_at")
    .eq("tenant_id", tenant.id)
    .in("type", ["MATCH", "TOURNAMENT"])
    .neq("status", "CANCELLED")
    .lte("start_at", now);

  const fixtureIds = (fixtures ?? []).map((f) => f.id);
  const { data: fixtureTeams } = fixtureIds.length
    ? await supabase
        .from("calendar_event_teams")
        .select("event_id, team_id")
        .in("event_id", fixtureIds)
    : { data: [] };

  console.log(
    `${entries?.length ?? 0} scheduled and ${reconstructed.length} reconstructed training sessions,` +
      ` plus ${fixtureTeams?.length ?? 0} team sheets, are in the past.`,
  );

  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
    return;
  }
  if (!entries?.length && !reconstructed.length && !fixtureTeams?.length) return;

  // Squads, once, for every team involved.
  const teamIds = [
    ...new Set([
      ...(entries ?? []).map((e) => e.team_id),
      ...reconstructed.map((s) => s.teamId),
      ...(fixtureTeams ?? []).map((f) => f.team_id),
    ]),
  ];
  const { data: links } = await supabase
    .from("athlete_teams")
    .select("team_id, athlete_id, joined_at")
    .eq("tenant_id", tenant.id)
    .in("team_id", teamIds)
    .is("left_at", null);

  const squadByTeam = new Map<string, { athleteId: string; joinedAt: string }[]>();
  for (const link of links ?? []) {
    const list = squadByTeam.get(link.team_id) ?? [];
    list.push({ athleteId: link.athlete_id, joinedAt: link.joined_at });
    squadByTeam.set(link.team_id, list);
  }

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, match_call_up_limit")
    .in("id", teamIds);
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  let registersWritten = 0;
  let recordsWritten = 0;

  const registerRows: Record<string, unknown>[] = [];
  const plan: {
    key: string;
    teamId: string;
    startsAt: string;
    occasion: "TRAINING" | "MATCH";
  }[] = [];

  for (const entry of entries ?? []) {
    registerRows.push({
      tenant_id: tenant.id,
      season_id: season.id,
      team_id: entry.team_id,
      occasion: "TRAINING",
      state: "RECORDED",
      schedule_entry_id: entry.id,
      gym_id: entry.gym_id,
      trainer_id: entry.trainer_id,
      starts_at: entry.start_at,
      ends_at: entry.end_at,
      recorded_at: entry.end_at,
    });
    plan.push({
      key: `entry:${entry.id}`,
      teamId: entry.team_id,
      startsAt: entry.start_at,
      occasion: "TRAINING",
    });
  }

  for (const [index, session] of reconstructed.entries()) {
    registerRows.push({
      tenant_id: tenant.id,
      season_id: season.id,
      team_id: session.teamId,
      occasion: "TRAINING",
      state: "RECORDED",
      // No origin: this session predates every schedule version, which the
      // register is built to allow.
      gym_id: session.gymId,
      starts_at: session.startAt,
      ends_at: session.endAt,
      recorded_at: session.endAt,
    });
    plan.push({
      key: `reconstructed:${index}`,
      teamId: session.teamId,
      startsAt: session.startAt,
      occasion: "TRAINING",
    });
  }

  const fixtureById = new Map((fixtures ?? []).map((f) => [f.id, f]));
  for (const link of fixtureTeams ?? []) {
    const fixture = fixtureById.get(link.event_id);
    if (!fixture) continue;
    registerRows.push({
      tenant_id: tenant.id,
      season_id: season.id,
      team_id: link.team_id,
      occasion: "MATCH",
      state: "RECORDED",
      event_id: fixture.id,
      gym_id: fixture.gym_id,
      starts_at: fixture.start_at,
      ends_at: fixture.end_at,
      call_up_limit: teamById.get(link.team_id)?.match_call_up_limit ?? null,
      recorded_at: fixture.end_at,
    });
    plan.push({
      key: `event:${fixture.id}:${link.team_id}`,
      teamId: link.team_id,
      startsAt: fixture.start_at,
      occasion: "MATCH",
    });
  }

  const CHUNK = 500;
  const registerIds: string[] = [];
  for (let index = 0; index < registerRows.length; index += CHUNK) {
    const { data, error } = await supabase
      .from("attendance_registers")
      .insert(registerRows.slice(index, index + CHUNK) as never)
      .select("id");
    if (error) throw new Error(`inserting registers: ${error.message}`);
    registerIds.push(...data.map((row) => row.id));
    registersWritten += data.length;
  }

  const records: Record<string, unknown>[] = [];

  for (const [index, registerId] of registerIds.entries()) {
    const item = plan[index];
    const day = item.startsAt.slice(0, 10);
    const squad = (squadByTeam.get(item.teamId) ?? []).filter((m) => m.joinedAt <= day);
    if (squad.length === 0) continue;

    if (item.occasion === "TRAINING") {
      for (const member of squad) {
        const random = rng(hash(`${registerId}:${member.athleteId}`));
        const roll = random();
        const reliability = reliabilityOf(member.athleteId);
        let state: string;
        let reason: string | null = null;

        if (roll < reliability) {
          state = random() < 0.08 ? "LATE" : "PRESENT";
        } else if (random() < 0.65) {
          state = "EXCUSED";
          reason = REASONS[Math.floor(random() * REASONS.length)];
        } else {
          state = "ABSENT";
        }

        records.push({
          tenant_id: tenant.id,
          register_id: registerId,
          athlete_id: member.athleteId,
          state,
          reason,
          minutes_late: state === "LATE" ? 5 + Math.floor(random() * 20) : null,
        });
      }
      continue;
    }

    // A match sheet: the twelve most reliable are picked, five start.
    const limit = teamById.get(item.teamId)?.match_call_up_limit ?? squad.length;
    const ranked = [...squad].sort(
      (a, b) =>
        reliabilityOf(b.athleteId) - reliabilityOf(a.athleteId) ||
        a.athleteId.localeCompare(b.athleteId),
    );
    const called = new Set(ranked.slice(0, limit).map((m) => m.athleteId));

    for (const [position, member] of ranked.entries()) {
      const random = rng(hash(`${registerId}:${member.athleteId}`));
      const isCalled = called.has(member.athleteId);
      records.push({
        tenant_id: tenant.id,
        register_id: registerId,
        athlete_id: member.athleteId,
        state: isCalled ? "PRESENT" : random() < 0.5 ? "ABSENT" : "EXCUSED",
        reason: isCalled ? null : random() < 0.5 ? "OTHER" : null,
        called_up: isCalled,
        started: isCalled ? position < 5 : null,
        // The last two on the sheet tend to be the ones who do not get on.
        bench_reason: isCalled && position >= limit - 2 ? "ROTATION" : null,
      });
    }
  }

  for (let index = 0; index < records.length; index += CHUNK) {
    const { error } = await supabase
      .from("attendance_records")
      .insert(records.slice(index, index + CHUNK) as never);
    if (error) throw new Error(`inserting records: ${error.message}`);
    recordsWritten += Math.min(CHUNK, records.length - index);
  }

  console.log(`\n• ${registersWritten} registers`);
  console.log(`• ${recordsWritten} attendance records`);

  // A handful of absences the club has been told about, ahead of time — so the
  // pre-fill has something to pre-fill with.
  const upcoming = [...squadByTeam.values()].flat().slice(0, 6);
  if (upcoming.length > 0) {
    const { error } = await supabase.from("athlete_availability_exceptions").insert(
      upcoming.map((member, index) => ({
        tenant_id: tenant.id,
        athlete_id: member.athleteId,
        starts_on: addDays(now.slice(0, 10), 1 + index),
        ends_on: addDays(now.slice(0, 10), 3 + index),
        reason: REASONS[index % REASONS.length],
        reported_by: index % 2 === 0 ? "Told the coach at training" : "Phoned in by a parent",
      })),
    );
    if (error) throw new Error(`inserting absences: ${error.message}`);
    console.log(`• ${upcoming.length} declared absences in the days ahead`);
  }
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
