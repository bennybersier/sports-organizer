/**
 * Development seed data.
 *
 * Builds one realistic club: a season, five teams across two sports, three
 * gyms, six trainers, ~60 athletes, recurring availability and training
 * requirements.
 *
 * The numbers are chosen so the schedule is *tight but solvable*, with two
 * deliberate pressure points so the conflict UI has something real to show:
 *
 *   - U16 Boys and U18 Boys both want Tuesday evening in the only hall large
 *     enough for them, and their sessions overlap.
 *   - Coach Nadia is the only qualified trainer for two teams whose preferred
 *     slots collide on Thursday.
 *
 * Refuses to run against production.
 *
 *   pnpm db:seed                 # seeds the only club, or --tenant <slug>
 *   pnpm db:seed --reset         # deletes seeded rows first
 */
import { adminClient, arg } from "./lib/admin";

const RESET = process.argv.includes("--reset");

if (process.env.APP_ENV === "production") {
  console.error("Refusing to seed a production environment.");
  process.exit(1);
}

const SPORTS = { volleyball: "Volleyball", basketball: "Basketball" } as const;

async function main() {
  const supabase = adminClient();
  const slug = arg("tenant");

  // --- Resolve the club -----------------------------------------------------
  const { data: tenants, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, slug, timezone")
    .is("deleted_at", null);

  if (tenantError) throw tenantError;
  if (!tenants || tenants.length === 0) {
    console.error("No clubs found. Run `pnpm bootstrap:club` first.");
    process.exit(1);
  }

  const tenant = slug ? tenants.find((t) => t.slug === slug) : tenants[0];
  if (!tenant) {
    console.error(
      `No club with slug "${slug}". Available: ${tenants.map((t) => t.slug).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Seeding "${tenant.name}" (${tenant.slug})\n`);
  const tenantId = tenant.id;

  if (RESET) {
    console.log("• Removing existing seeded data");
    // Ordered so foreign keys are satisfied without relying on cascade order.
    await supabase.from("schedule_entries").delete().eq("tenant_id", tenantId);
    await supabase.from("schedule_versions").delete().eq("tenant_id", tenantId);
    await supabase.from("calendar_event_teams").delete().eq("tenant_id", tenantId);
    await supabase.from("calendar_events").delete().eq("tenant_id", tenantId);
    await supabase.from("team_training_requirements").delete().eq("tenant_id", tenantId);
    await supabase.from("athlete_teams").delete().eq("tenant_id", tenantId);
    await supabase.from("trainer_teams").delete().eq("tenant_id", tenantId);
    await supabase.from("team_availability").delete().eq("tenant_id", tenantId);
    await supabase.from("trainer_availability").delete().eq("tenant_id", tenantId);
    await supabase.from("trainer_availability_exceptions").delete().eq("tenant_id", tenantId);
    await supabase.from("gym_availability").delete().eq("tenant_id", tenantId);
    await supabase.from("gym_availability_exceptions").delete().eq("tenant_id", tenantId);
    await supabase.from("athletes").delete().eq("tenant_id", tenantId);
    await supabase.from("teams").delete().eq("tenant_id", tenantId);
    await supabase.from("trainers").delete().eq("tenant_id", tenantId);
    await supabase.from("gyms").delete().eq("tenant_id", tenantId);
    await supabase.from("seasons").delete().eq("tenant_id", tenantId);
  }

  // --- Season ---------------------------------------------------------------
  const seasonYear = new Date().getFullYear();
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .insert({
      tenant_id: tenantId,
      name: `${seasonYear}/${seasonYear + 1}`,
      start_date: `${seasonYear}-08-15`,
      end_date: `${seasonYear + 1}-06-30`,
      status: "ACTIVE",
      description: "Seeded development season.",
    })
    .select("id")
    .single();
  if (seasonError) throw seasonError;
  const seasonId = season.id;
  console.log(`• Season ${seasonYear}/${seasonYear + 1}`);

  // --- Gyms -----------------------------------------------------------------
  // Only Hall A fits a full-size court, which is what makes the U16/U18 clash
  // on Tuesday genuinely unresolvable without a compromise.
  const { data: gyms, error: gymError } = await supabase
    .from("gyms")
    .insert([
      {
        tenant_id: tenantId,
        name: "Riverside Hall A",
        capacity: 120,
        city: "Riverside",
        sport_types: [SPORTS.volleyball, SPORTS.basketball],
        equipment: ["Full-size court", "Scoreboard", "Changing rooms"],
        color: "#2563eb",
      },
      {
        tenant_id: tenantId,
        name: "Riverside Hall B",
        capacity: 60,
        city: "Riverside",
        sport_types: [SPORTS.volleyball],
        equipment: ["Half court", "Net posts"],
        color: "#16a34a",
      },
      {
        tenant_id: tenantId,
        name: "Northside Gym",
        capacity: 40,
        city: "Northside",
        sport_types: [SPORTS.basketball],
        equipment: ["Half court"],
        color: "#f59e0b",
      },
    ])
    .select("id, name");
  if (gymError) throw gymError;
  const gymByName = Object.fromEntries(gyms.map((g) => [g.name, g.id]));
  console.log(`• ${gyms.length} gyms`);

  // Halls open weekday evenings; Hall A also opens Saturday morning.
  const gymAvailability = [];
  for (const [name, days] of [
    ["Riverside Hall A", [1, 2, 3, 4, 5]],
    ["Riverside Hall B", [1, 2, 3, 4]],
    ["Northside Gym", [2, 3, 4, 5]],
  ] as [string, number[]][]) {
    for (const weekday of days) {
      gymAvailability.push({
        tenant_id: tenantId,
        gym_id: gymByName[name],
        iso_weekday: weekday as 1 | 2 | 3 | 4 | 5,
        start_time: "16:00",
        end_time: "22:00",
        valid_from: `${seasonYear}-08-15`,
      });
    }
  }
  gymAvailability.push({
    tenant_id: tenantId,
    gym_id: gymByName["Riverside Hall A"],
    iso_weekday: 6 as const,
    start_time: "09:00",
    end_time: "13:00",
    valid_from: `${seasonYear}-08-15`,
  });
  const { error: gymAvailError } = await supabase.from("gym_availability").insert(gymAvailability);
  if (gymAvailError) throw gymAvailError;

  // A week-long hall closure, so the calendar has a real blackout to render.
  const { error: gymExcError } = await supabase.from("gym_availability_exceptions").insert({
    tenant_id: tenantId,
    gym_id: gymByName["Riverside Hall B"],
    exception_date: `${seasonYear}-10-21`,
    type: "UNAVAILABLE",
    reason: "Floor resurfacing",
  });
  if (gymExcError) throw gymExcError;
  console.log(`• ${gymAvailability.length} gym availability windows`);

  // --- Trainers -------------------------------------------------------------
  const trainerSeed = [
    { first: "Nadia", last: "Kovač", quals: ["Volleyball L2", "Basketball L1"], days: [1, 2, 4] },
    { first: "Tomas", last: "Lindqvist", quals: ["Volleyball L3"], days: [1, 3, 5] },
    { first: "Amina", last: "Diallo", quals: ["Basketball L2"], days: [2, 3, 4] },
    { first: "Ruben", last: "Ortiz", quals: ["Volleyball L1"], days: [2, 4] },
    { first: "Elin", last: "Mattsson", quals: ["Basketball L2", "Strength & Conditioning"], days: [3, 5] },
    { first: "Jonas", last: "Weber", quals: ["Volleyball L2"], days: [1, 4, 6] },
  ];

  const { data: trainers, error: trainerError } = await supabase
    .from("trainers")
    .insert(
      trainerSeed.map((trainer, index) => ({
        tenant_id: tenantId,
        first_name: trainer.first,
        last_name: trainer.last,
        email: `${trainer.first.toLowerCase()}.${slugPart(trainer.last)}@club.example`,
        phone: `+41 79 ${100 + index} ${2000 + index}`,
        qualifications: trainer.quals,
      })),
    )
    .select("id, first_name");
  if (trainerError) throw trainerError;
  const trainerByName = Object.fromEntries(trainers.map((t) => [t.first_name, t.id]));
  console.log(`• ${trainers.length} trainers`);

  const trainerAvailability = trainerSeed.flatMap((trainer) =>
    trainer.days.map((weekday) => ({
      tenant_id: tenantId,
      trainer_id: trainerByName[trainer.first],
      iso_weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6,
      // Saturday coaching starts in the morning; evenings otherwise.
      start_time: weekday === 6 ? "09:00" : "17:00",
      end_time: weekday === 6 ? "13:00" : "22:00",
      valid_from: `${seasonYear}-08-15`,
    })),
  );
  const { error: trainerAvailError } = await supabase
    .from("trainer_availability")
    .insert(trainerAvailability);
  if (trainerAvailError) throw trainerAvailError;

  const { error: trainerExcError } = await supabase.from("trainer_availability_exceptions").insert([
    {
      tenant_id: tenantId,
      trainer_id: trainerByName["Tomas"],
      exception_date: `${seasonYear}-11-04`,
      type: "UNAVAILABLE",
      reason: "Coaching course",
    },
    {
      tenant_id: tenantId,
      trainer_id: trainerByName["Amina"],
      exception_date: `${seasonYear}-12-02`,
      start_time: "17:00",
      end_time: "19:00",
      type: "UNAVAILABLE",
      reason: "Medical appointment",
    },
  ]);
  if (trainerExcError) throw trainerExcError;
  console.log(`• ${trainerAvailability.length} trainer availability windows, 2 exceptions`);

  // --- Teams ----------------------------------------------------------------
  const teamSeed = [
    {
      name: "U16 Boys Volleyball",
      sport: SPORTS.volleyball,
      category: "Youth",
      age: "U16",
      gender: "MALE" as const,
      color: "#2563eb",
      trainers: ["Nadia", "Tomas"],
      sessions: 3,
      duration: 90,
      // Contends with U18 Boys for Tuesday in Hall A.
      preferredWeekdays: [2, 4],
      preferredGyms: ["Riverside Hall A"],
      allowedGyms: ["Riverside Hall A", "Riverside Hall B"],
    },
    {
      name: "U18 Boys Volleyball",
      sport: SPORTS.volleyball,
      category: "Youth",
      age: "U18",
      gender: "MALE" as const,
      color: "#7c3aed",
      trainers: ["Tomas", "Jonas"],
      sessions: 3,
      duration: 105,
      preferredWeekdays: [2, 4],
      preferredGyms: ["Riverside Hall A"],
      allowedGyms: ["Riverside Hall A"],
    },
    {
      name: "U14 Girls Volleyball",
      sport: SPORTS.volleyball,
      category: "Youth",
      age: "U14",
      gender: "FEMALE" as const,
      color: "#db2777",
      trainers: ["Ruben"],
      sessions: 2,
      duration: 75,
      preferredWeekdays: [1, 3],
      preferredGyms: ["Riverside Hall B"],
      allowedGyms: ["Riverside Hall A", "Riverside Hall B"],
    },
    {
      name: "U16 Girls Basketball",
      sport: SPORTS.basketball,
      category: "Youth",
      age: "U16",
      gender: "FEMALE" as const,
      color: "#f59e0b",
      // Nadia is the pinch point: also on U16 Boys, and both want Thursday.
      trainers: ["Amina", "Nadia"],
      sessions: 3,
      duration: 90,
      preferredWeekdays: [2, 4],
      preferredGyms: ["Northside Gym"],
      allowedGyms: ["Northside Gym", "Riverside Hall A"],
    },
    {
      name: "Seniors Basketball",
      sport: SPORTS.basketball,
      category: "Senior",
      age: "Adult",
      gender: "MIXED" as const,
      color: "#16a34a",
      trainers: ["Elin"],
      sessions: 2,
      duration: 120,
      preferredWeekdays: [3, 5],
      preferredGyms: ["Riverside Hall A"],
      allowedGyms: ["Riverside Hall A", "Northside Gym"],
    },
  ];

  const { data: teams, error: teamError } = await supabase
    .from("teams")
    .insert(
      teamSeed.map((team) => ({
        tenant_id: tenantId,
        season_id: seasonId,
        name: team.name,
        sport: team.sport,
        category: team.category,
        age_group: team.age,
        gender: team.gender,
        color: team.color,
      })),
    )
    .select("id, name");
  if (teamError) throw teamError;
  const teamByName = Object.fromEntries(teams.map((t) => [t.name, t.id]));
  console.log(`• ${teams.length} teams`);

  const { error: trainerTeamError } = await supabase.from("trainer_teams").insert(
    teamSeed.flatMap((team) =>
      team.trainers.map((trainerName, index) => ({
        tenant_id: tenantId,
        team_id: teamByName[team.name],
        trainer_id: trainerByName[trainerName],
        is_head_coach: index === 0,
      })),
    ),
  );
  if (trainerTeamError) throw trainerTeamError;

  const { error: requirementError } = await supabase.from("team_training_requirements").insert(
    teamSeed.map((team) => ({
      tenant_id: tenantId,
      team_id: teamByName[team.name],
      season_id: seasonId,
      sessions_per_week: team.sessions,
      duration_minutes: team.duration,
      allowed_weekdays: [1, 2, 3, 4, 5] as (1 | 2 | 3 | 4 | 5)[],
      earliest_start: "16:30",
      latest_end: "22:00",
      min_days_between: 1,
      preferred_weekdays: team.preferredWeekdays as (1 | 2 | 3 | 4 | 5)[],
      preferred_start: "18:00",
      preferred_end: "20:30",
      allowed_gym_ids: team.allowedGyms.map((name) => gymByName[name]),
      preferred_gym_ids: team.preferredGyms.map((name) => gymByName[name]),
    })),
  );
  if (requirementError) throw requirementError;
  console.log(`• Training requirements for ${teamSeed.length} teams`);

  // --- Athletes -------------------------------------------------------------
  const athleteRows = [];
  const assignments: { team: string; index: number }[] = [];
  let athleteIndex = 0;

  for (const team of teamSeed) {
    const squadSize = team.category === "Senior" ? 14 : 12;
    for (let member = 0; member < squadSize; member += 1) {
      const first = FIRST_NAMES[athleteIndex % FIRST_NAMES.length];
      const last = LAST_NAMES[(athleteIndex * 7) % LAST_NAMES.length];
      const birthYear =
        team.age === "U14" ? seasonYear - 13
        : team.age === "U16" ? seasonYear - 15
        : team.age === "U18" ? seasonYear - 17
        : seasonYear - 24;

      athleteRows.push({
        tenant_id: tenantId,
        first_name: first,
        last_name: last,
        date_of_birth: `${birthYear}-${pad((athleteIndex % 12) + 1)}-${pad((athleteIndex % 27) + 1)}`,
        gender: team.gender === "MIXED" ? ("UNSPECIFIED" as const) : team.gender,
        email: `${first.toLowerCase()}.${slugPart(last)}${athleteIndex}@example.test`,
        emergency_contact_name: `${FIRST_NAMES[(athleteIndex + 5) % FIRST_NAMES.length]} ${last}`,
        emergency_contact_phone: `+41 79 ${300 + athleteIndex} 4000`,
        emergency_contact_relation: athleteIndex % 2 === 0 ? "Parent" : "Guardian",
      });
      assignments.push({ team: team.name, index: athleteIndex });
      athleteIndex += 1;
    }
  }

  const { data: athletes, error: athleteError } = await supabase
    .from("athletes")
    .insert(athleteRows)
    .select("id");
  if (athleteError) throw athleteError;
  console.log(`• ${athletes.length} athletes`);

  const { error: athleteTeamError } = await supabase.from("athlete_teams").insert(
    assignments.map((assignment, position) => ({
      tenant_id: tenantId,
      athlete_id: athletes[assignment.index].id,
      team_id: teamByName[assignment.team],
      jersey_number: (position % 20) + 1,
    })),
  );
  if (athleteTeamError) throw athleteTeamError;

  // Two athletes train up an age group as well — the many-to-many case.
  const { error: doubleUpError } = await supabase.from("athlete_teams").insert([
    {
      tenant_id: tenantId,
      athlete_id: athletes[0].id,
      team_id: teamByName["U18 Boys Volleyball"],
      jersey_number: 21,
    },
    {
      tenant_id: tenantId,
      athlete_id: athletes[1].id,
      team_id: teamByName["U18 Boys Volleyball"],
      jersey_number: 22,
    },
  ]);
  if (doubleUpError) throw doubleUpError;

  // --- Calendar events ------------------------------------------------------
  const { data: event, error: eventError } = await supabase
    .from("calendar_events")
    .insert({
      tenant_id: tenantId,
      season_id: seasonId,
      type: "TOURNAMENT",
      title: "Club in-house tournament",
      description: "All volleyball teams share Hall A — the one case gym sharing is intended.",
      gym_id: gymByName["Riverside Hall A"],
      start_at: `${seasonYear}-11-15T08:00:00Z`,
      end_at: `${seasonYear}-11-15T17:00:00Z`,
      allows_gym_sharing: true,
      blocks_scheduling: true,
      color: "#7c3aed",
    })
    .select("id")
    .single();
  if (eventError) throw eventError;

  const { error: eventTeamError } = await supabase.from("calendar_event_teams").insert(
    ["U16 Boys Volleyball", "U18 Boys Volleyball", "U14 Girls Volleyball"].map((name) => ({
      tenant_id: tenantId,
      event_id: event.id,
      team_id: teamByName[name],
    })),
  );
  if (eventTeamError) throw eventTeamError;

  const { error: holidayError } = await supabase.from("calendar_events").insert({
    tenant_id: tenantId,
    season_id: seasonId,
    type: "HOLIDAY",
    title: "Autumn break — no training",
    start_at: `${seasonYear}-10-19T00:00:00Z`,
    end_at: `${seasonYear}-10-27T00:00:00Z`,
    all_day: true,
    blocks_scheduling: true,
  });
  if (holidayError) throw holidayError;
  console.log("• 2 calendar events (in-house tournament, autumn break)");

  console.log("\nSeeded. Two deliberate pressure points are in the data:");
  console.log("  1. U16 Boys and U18 Boys both want Tuesday evening in Hall A.");
  console.log("  2. Nadia coaches two teams whose preferred Thursday slots collide.");
}

const FIRST_NAMES = [
  "Léa", "Noah", "Mia", "Liam", "Emma", "Luca", "Sofia", "Nino", "Alba", "Elias",
  "Nora", "Matteo", "Ilaria", "Jonas", "Anouk", "Levi", "Zoé", "Samir", "Maya", "Théo",
];

const LAST_NAMES = [
  "Meier", "Rossi", "Dubois", "Keller", "Bianchi", "Favre", "Brunner", "Moretti",
  "Girard", "Schmid", "Conti", "Perret", "Frei", "Ricci", "Aebi", "Marti", "Bosch",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

main().catch((error) => {
  console.error("\nSeed failed:", error.message ?? error);
  if (error.details) console.error("  ", error.details);
  process.exit(1);
});
