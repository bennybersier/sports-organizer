/**
 * Robur / FBL — the real club, as a schedule-generation fixture.
 *
 * The generic dev seed (`scripts/seed.ts`) builds five invented teams in two
 * sports. That is enough to exercise the UI and nothing like enough to tell you
 * whether the optimizer copes with a real club: thirty teams from Serie C down
 * to Pulcini, fourteen coaches covering two or three groups each, and ten halls
 * of which the club owns exactly one.
 *
 * The numbers here are the club's own, not decoration. Session length follows
 * age (U15 and up train two hours) and session count follows level (the top
 * sides train four times a week, minibasket twice), which is the only reading
 * of the club's brief that is self-consistent.
 *
 * The fixture is deliberately tight — roughly 120 hall-hours of demand against
 * 160 usable — with one genuine pinch point at San Colombano, where one hall
 * and one coach carry two minibasket groups. A fixture that fits comfortably
 * proves nothing.
 *
 *   pnpm db:seed:robur --dry-run        # validate the fixture, write nothing
 *   pnpm db:seed:robur --wipe --yes     # delete the club's data, then seed
 *
 * The dry run is not a formality. It builds the same ScheduleInput the server
 * would, runs the real optimizer in memory, and refuses to go on if any team
 * comes up short — so a mistyped coaching hour is caught here rather than
 * surfacing later as a mysterious shortfall that looks like an algorithm bug.
 */
import { adminClient, arg } from "./lib/admin";
import { planFixtures, type FixturePool } from "./lib/fixture-generator";
import { fromMinutes, toMinutes, type IsoWeekday, type MinuteWindow } from "../src/domain/availability";
import { analyseWeekdays, weeklyCeiling } from "../src/domain/scheduling/capacity";
import { generateSchedule } from "../src/domain/scheduling/optimizer";
import type {
  EngineGym,
  EngineTeam,
  EngineTrainer,
  ScheduleInput,
} from "../src/domain/scheduling/types";

const TENANT_SLUG = arg("tenant") ?? "robur-fbl";
const DRY_RUN = process.argv.includes("--dry-run");
const WIPE = process.argv.includes("--wipe");
const CONFIRMED = process.argv.includes("--yes");
const SKIP_CHECK = process.argv.includes("--no-check");
const NO_FIXTURES = process.argv.includes("--no-fixtures");

if (process.env.APP_ENV === "production") {
  console.error("Refusing to seed a production environment.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Halls
// ---------------------------------------------------------------------------

/** Opening hours per ISO weekday (1 = Monday). Absent means shut. */
type Hours = Partial<Record<IsoWeekday, [string, string]>>;

interface GymSpec {
  key: string;
  name: string;
  city: string;
  capacity: number;
  color: string;
  hours: Hours;
  note: string;
}

const WEEK: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Every day, same hours — the club's own hall is the only one like this. */
function everyDay(from: string, until: string): Hours {
  return Object.fromEntries(WEEK.map((day) => [day, [from, until]])) as Hours;
}

/**
 * Nine of the ten halls belong to a town or a school and are shared with other
 * sports, so their gaps are the point: San Colombano opens three days a week,
 * Lodi has no Friday, Lodi Vecchio no Monday or Thursday.
 */
const GYMS: GymSpec[] = [
  {
    key: "CAMPUS",
    name: "Codogno Campus",
    city: "Codogno",
    capacity: 250,
    color: "#1d4ed8",
    hours: everyDay("13:00", "23:00"),
    note: "The club's own hall. The only one available every day, and the only one it does not have to share.",
  },
  {
    key: "COMUNALE",
    name: "Codogno Comunale",
    city: "Codogno",
    capacity: 300,
    color: "#0891b2",
    hours: {
      1: ["15:30", "22:30"],
      2: ["15:30", "22:30"],
      3: ["15:30", "22:30"],
      4: ["15:30", "22:30"],
      5: ["15:30", "22:30"],
      6: ["09:00", "19:00"],
    },
    note: "Town hall. The club has it every weekday evening and Saturday afternoon.",
  },
  {
    key: "CASALE",
    name: "Casalpusterlengo",
    city: "Casalpusterlengo",
    capacity: 200,
    color: "#16a34a",
    hours: {
      1: ["16:30", "19:00"],
      2: ["16:30", "22:00"],
      3: ["16:30", "19:00"],
      4: ["16:30", "22:00"],
      5: ["16:30", "22:00"],
      6: ["09:00", "12:00"],
    },
    note: "Town hall, shared with the local volleyball club on Monday and Wednesday evenings.",
  },
  {
    key: "SANCOLOMBANO",
    name: "San Colombano",
    city: "San Colombano al Lambro",
    capacity: 120,
    color: "#f59e0b",
    hours: { 1: ["16:30", "19:30"], 3: ["16:30", "19:30"], 6: ["10:00", "13:00"] },
    note: "School gym, three afternoons a week. The tightest hall the club uses.",
  },
  {
    key: "SANMARTINO",
    name: "San Martino",
    city: "San Martino in Strada",
    capacity: 120,
    color: "#7c3aed",
    hours: {
      1: ["16:30", "21:00"],
      3: ["16:30", "21:00"],
      4: ["16:30", "19:00"],
      5: ["16:30", "21:00"],
    },
    note: "Town hall. No Tuesday — the hall is booked for five-a-side.",
  },
  {
    key: "LODI",
    name: "Lodi",
    city: "Lodi",
    capacity: 400,
    color: "#db2777",
    hours: {
      1: ["17:30", "22:30"],
      2: ["17:30", "22:30"],
      3: ["17:30", "22:30"],
      4: ["17:30", "22:30"],
      6: ["15:00", "20:00"],
    },
    note: "The big hall in Lodi, evenings only, no Friday.",
  },
  {
    key: "LODIVECCHIO",
    name: "Lodi Vecchio",
    city: "Lodi Vecchio",
    capacity: 150,
    color: "#64748b",
    hours: { 2: ["16:30", "20:30"], 3: ["16:30", "20:30"], 5: ["16:30", "20:30"], 6: ["10:00", "12:00"] },
    note: "School gym, three afternoons plus Saturday morning.",
  },
  {
    key: "SOMAGLIA",
    name: "Somaglia",
    city: "Somaglia",
    capacity: 80,
    color: "#0d9488",
    hours: { 2: ["17:00", "19:30"], 4: ["17:00", "19:30"] },
    note: "Village hall, two afternoons. Minibasket only — it is too small for anything else.",
  },
  {
    key: "MIRADOLO",
    name: "Miradolo Terme",
    city: "Miradolo Terme",
    capacity: 80,
    color: "#0d9488",
    hours: { 1: ["17:00", "19:30"], 4: ["17:00", "19:30"] },
    note: "Village hall, two afternoons.",
  },
  {
    key: "SANTANGELO",
    name: "Sant'Angelo Lodigiano",
    city: "Sant'Angelo Lodigiano",
    capacity: 100,
    color: "#0d9488",
    hours: { 2: ["17:00", "19:30"], 5: ["17:00", "19:30"] },
    note: "School gym, two afternoons.",
  },
];

// ---------------------------------------------------------------------------
// Training profiles
// ---------------------------------------------------------------------------

interface Profile {
  sessions: number;
  duration: number;
  priority: number;
  earliest: string;
  latest: string;
  preferredStart: string;
  preferredEnd: string;
}

/**
 * Length follows age, count follows level.
 *
 * Minibasket's window opens at 09:00 not because anyone trains then, but so
 * Saturday morning in the village halls is reachable. The halls do the real
 * constraining; the window only has to not get in their way.
 */
const PROFILES = {
  SENIOR: { sessions: 4, duration: 120, priority: 2, earliest: "18:00", latest: "23:00", preferredStart: "19:00", preferredEnd: "22:30" },
  ECCELLENZA: { sessions: 4, duration: 120, priority: 2, earliest: "17:00", latest: "23:00", preferredStart: "18:30", preferredEnd: "22:00" },
  REGIONALE_U15: { sessions: 3, duration: 120, priority: 3, earliest: "17:00", latest: "22:30", preferredStart: "18:00", preferredEnd: "21:30" },
  GOLD: { sessions: 4, duration: 90, priority: 3, earliest: "16:30", latest: "22:00", preferredStart: "18:00", preferredEnd: "21:00" },
  REGIONALE: { sessions: 3, duration: 90, priority: 3, earliest: "16:30", latest: "21:30", preferredStart: "17:30", preferredEnd: "20:30" },
  ESORDIENTI: { sessions: 3, duration: 60, priority: 4, earliest: "09:00", latest: "20:00", preferredStart: "17:00", preferredEnd: "19:00" },
  MINI: { sessions: 2, duration: 60, priority: 5, earliest: "09:00", latest: "20:00", preferredStart: "17:00", preferredEnd: "19:00" },
} satisfies Record<string, Profile>;

type ProfileKey = keyof typeof PROFILES;

/**
 * When each group actually starts.
 *
 * The seniors are back in late August; the youth sections wait for the school
 * term, and minibasket for October, when the primary-school timetable settles.
 */
/**
 * How much shortfall is a finding rather than a fault.
 *
 * The club is genuinely short of hall time in the Codogno evenings, and a
 * seed that papered over that by inventing opening hours would make the
 * optimizer look better than the club's week actually is.
 */
const MAX_UNMET_SESSIONS = 3;

const START_SENIOR = "2026-08-24";
const START_YOUTH = "2026-09-14";
const START_MINI = "2026-10-05";

interface TeamSpec {
  name: string;
  profile: ProfileKey;
  category: string;
  ageGroup: string | null;
  gender: "MALE" | "MIXED";
  color: string;
  weekdays: IsoWeekday[];
  preferredWeekdays: IsoWeekday[];
  gyms: string[];
  preferredGyms: string[];
  startsOn: string;
  /** Overrides the profile where a specific side differs. */
  sessions?: number;
  priority?: number;
  /**
   * Days either side of a fixture this side keeps clear.
   *
   * Only the first team, and deliberately. Playing on Sunday and resting the
   * Saturday and Monday around it leaves Tuesday to Friday for four sessions —
   * exactly enough, which is the kind of pressure worth watching. Applying it
   * to every senior side would take four Mondays a week out of the Codogno
   * evenings and turn a tight fixture into an unsolvable one.
   */
  restDays?: number;
}

const TEAMS: TeamSpec[] = [
  // --- Senior -------------------------------------------------------------
  {
    name: "Serie C / Serie C Silver",
    profile: "SENIOR",
    category: "Senior",
    ageGroup: null,
    gender: "MALE",
    color: "#1d4ed8",
    // The first team, and the only one locked to the club's own hall.
    priority: 1,
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [2, 4],
    gyms: ["CAMPUS"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_SENIOR,
    restDays: 1,
  },
  {
    name: "Divisione Regionale 1",
    profile: "SENIOR",
    category: "Senior",
    ageGroup: null,
    gender: "MALE",
    color: "#2563eb",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [1, 3, 5],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_SENIOR,
  },
  {
    name: "Divisione Regionale 2",
    profile: "SENIOR",
    category: "Senior",
    ageGroup: null,
    gender: "MALE",
    color: "#3b82f6",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [1, 3, 4],
    gyms: ["CAMPUS", "COMUNALE", "CASALE"],
    preferredGyms: ["COMUNALE"],
    startsOn: START_SENIOR,
  },

  // --- Giovanili Robur ----------------------------------------------------
  {
    name: "Under 15 Robur",
    profile: "REGIONALE_U15",
    category: "Giovanili",
    ageGroup: "U15",
    gender: "MALE",
    color: "#2563eb",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [2, 4, 5],
    gyms: ["CAMPUS", "COMUNALE", "CASALE"],
    // Prefers the town hall, so the first team and DR1 are not fighting it
    // for the same Campus evenings.
    preferredGyms: ["COMUNALE"],
    startsOn: START_YOUTH,
  },
  {
    name: "Under 14 Robur",
    profile: "REGIONALE",
    category: "Giovanili",
    ageGroup: "U14",
    gender: "MALE",
    color: "#2563eb",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [1, 3, 5],
    gyms: ["COMUNALE", "CAMPUS", "CASALE"],
    preferredGyms: ["COMUNALE"],
    startsOn: START_YOUTH,
  },
  {
    name: "Under 13 Robur",
    profile: "REGIONALE",
    category: "Giovanili",
    ageGroup: "U13",
    gender: "MALE",
    color: "#3b82f6",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [2, 4, 5],
    gyms: ["COMUNALE", "CAMPUS", "CASALE"],
    preferredGyms: ["COMUNALE"],
    startsOn: START_YOUTH,
  },
  {
    name: "Under 13 Regionale Bianco",
    profile: "REGIONALE",
    category: "Giovanili",
    ageGroup: "U13",
    gender: "MALE",
    color: "#60a5fa",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [2, 4, 5],
    gyms: ["CASALE", "COMUNALE", "CAMPUS"],
    preferredGyms: ["CASALE"],
    startsOn: START_YOUTH,
  },
  {
    name: "Under 13 Regionale Blu",
    profile: "REGIONALE",
    category: "Giovanili",
    ageGroup: "U13",
    gender: "MALE",
    color: "#60a5fa",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [1, 3, 5],
    gyms: ["CASALE", "COMUNALE", "CAMPUS"],
    preferredGyms: ["CASALE"],
    startsOn: START_YOUTH,
  },

  // --- Future Basket Lodigiano -------------------------------------------
  {
    name: "Under 15 Eccellenza FBL",
    profile: "ECCELLENZA",
    category: "Giovanili FBL",
    ageGroup: "U15",
    gender: "MALE",
    color: "#16a34a",
    weekdays: [1, 2, 3, 4, 6],
    preferredWeekdays: [1, 2, 4],
    gyms: ["LODI", "CAMPUS"],
    preferredGyms: ["LODI"],
    startsOn: START_SENIOR,
  },
  {
    name: "Under 14 Gold FBL",
    profile: "GOLD",
    category: "Giovanili FBL",
    ageGroup: "U14",
    gender: "MALE",
    color: "#16a34a",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [1, 3, 4, 5],
    gyms: ["LODI", "SANMARTINO", "LODIVECCHIO"],
    preferredGyms: ["LODI"],
    startsOn: START_YOUTH,
  },
  {
    name: "Under 13 Gold FBL",
    profile: "GOLD",
    category: "Giovanili FBL",
    ageGroup: "U13",
    gender: "MALE",
    color: "#22c55e",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [1, 2, 3, 5],
    gyms: ["LODIVECCHIO", "SANMARTINO", "LODI"],
    preferredGyms: ["LODIVECCHIO"],
    startsOn: START_YOUTH,
  },
  {
    name: "Esordienti FBL",
    profile: "ESORDIENTI",
    category: "Giovanili FBL",
    ageGroup: "U13",
    gender: "MIXED",
    color: "#22c55e",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [2, 3, 5],
    gyms: ["LODIVECCHIO", "SANMARTINO"],
    preferredGyms: ["LODIVECCHIO"],
    startsOn: START_MINI,
  },

  // --- ABA / progetto di eccellenza ---------------------------------------
  {
    name: "Under 19 Eccellenza",
    profile: "ECCELLENZA",
    category: "Eccellenza ABA",
    ageGroup: "U19",
    gender: "MALE",
    color: "#7c3aed",
    // Matches are Tue/Wed/Thu, but that is a per-date matter for the fixture
    // list, not a standing ban: closing three weekdays here would cap the side
    // at two sessions a week.
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [1, 2, 4],
    gyms: ["CAMPUS", "LODI", "CASALE"],
    preferredGyms: ["LODI"],
    startsOn: START_SENIOR,
  },
  {
    name: "Under 17 Eccellenza",
    profile: "ECCELLENZA",
    category: "Eccellenza ABA",
    ageGroup: "U17",
    gender: "MALE",
    color: "#8b5cf6",
    weekdays: [1, 2, 3, 4, 5],
    preferredWeekdays: [2, 3, 4, 5],
    gyms: ["CAMPUS", "CASALE", "LODI"],
    preferredGyms: ["CASALE"],
    startsOn: START_SENIOR,
  },

  // --- Minibasket ---------------------------------------------------------
  {
    name: "Esordienti Robur",
    profile: "ESORDIENTI",
    category: "Minibasket",
    ageGroup: "U13",
    gender: "MIXED",
    color: "#f59e0b",
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [1, 3, 5],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["COMUNALE"],
    startsOn: START_MINI,
  },
  {
    name: "Esordienti Bianco",
    profile: "ESORDIENTI",
    category: "Minibasket",
    ageGroup: "U13",
    gender: "MIXED",
    color: "#f59e0b",
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [2, 4],
    gyms: ["COMUNALE", "CAMPUS"],
    preferredGyms: ["COMUNALE"],
    startsOn: START_MINI,
  },
  {
    name: "Esordienti Blu",
    profile: "ESORDIENTI",
    category: "Minibasket",
    ageGroup: "U13",
    gender: "MIXED",
    color: "#fbbf24",
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [1, 4],
    gyms: ["COMUNALE", "CAMPUS"],
    preferredGyms: ["COMUNALE"],
    startsOn: START_MINI,
  },
  {
    name: "Aquilotti 2014 Codogno",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U12",
    gender: "MIXED",
    color: "#fb923c",
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [1, 3],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_MINI,
  },
  {
    name: "Aquilotti 2015 Codogno",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U11",
    gender: "MIXED",
    color: "#fb923c",
    weekdays: [1, 2, 3, 5, 6],
    preferredWeekdays: [2, 5],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_MINI,
  },
  {
    name: "Aquilotti San Colombano",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U11",
    gender: "MIXED",
    color: "#fb923c",
    weekdays: [1, 3, 6],
    preferredWeekdays: [3, 6],
    gyms: ["SANCOLOMBANO"],
    preferredGyms: ["SANCOLOMBANO"],
    startsOn: START_MINI,
  },
  {
    name: "Aquilotti San Martino–Sant'Alberto Lodi",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U11",
    gender: "MIXED",
    color: "#fb923c",
    weekdays: [1, 3, 4, 5],
    preferredWeekdays: [1, 4],
    gyms: ["SANMARTINO"],
    preferredGyms: ["SANMARTINO"],
    startsOn: START_MINI,
  },
  {
    name: "Scoiattoli 2016/17 Codogno",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U10",
    gender: "MIXED",
    color: "#db2777",
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [2, 5],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_MINI,
  },
  {
    name: "Pulcini 2018/19 Codogno",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U8",
    gender: "MIXED",
    color: "#db2777",
    weekdays: [1, 2, 3, 5, 6],
    preferredWeekdays: [1, 3],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_MINI,
  },
  {
    name: "Pulcini/Scoiattoli Casalpusterlengo",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U9",
    gender: "MIXED",
    color: "#db2777",
    weekdays: [1, 2, 3, 4, 5, 6],
    preferredWeekdays: [2, 4],
    gyms: ["CASALE"],
    preferredGyms: ["CASALE"],
    startsOn: START_MINI,
  },
  {
    name: "Pulcini/Scoiattoli Somaglia",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U9",
    gender: "MIXED",
    color: "#0d9488",
    weekdays: [2, 4],
    preferredWeekdays: [2, 4],
    gyms: ["SOMAGLIA"],
    preferredGyms: ["SOMAGLIA"],
    startsOn: START_MINI,
  },
  {
    name: "Pulcini/Scoiattoli San Colombano",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U9",
    gender: "MIXED",
    color: "#0d9488",
    weekdays: [1, 3, 6],
    preferredWeekdays: [1, 6],
    gyms: ["SANCOLOMBANO"],
    preferredGyms: ["SANCOLOMBANO"],
    startsOn: START_MINI,
  },
  {
    name: "Pulcini/Scoiattoli San Martino–Sant'Alberto Lodi",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U9",
    gender: "MIXED",
    color: "#0d9488",
    weekdays: [1, 3, 4, 5],
    preferredWeekdays: [3, 5],
    gyms: ["SANMARTINO"],
    preferredGyms: ["SANMARTINO"],
    startsOn: START_MINI,
  },
  {
    name: "Corso Avviamento allo Sport Codogno",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U7",
    gender: "MIXED",
    color: "#0891b2",
    weekdays: [1, 2, 3, 5, 6],
    preferredWeekdays: [2, 5],
    gyms: ["CAMPUS", "COMUNALE"],
    preferredGyms: ["CAMPUS"],
    startsOn: START_MINI,
  },
  {
    name: "Centro Minibasket Miradolo Terme",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U9",
    gender: "MIXED",
    color: "#0891b2",
    weekdays: [1, 4],
    preferredWeekdays: [1, 4],
    gyms: ["MIRADOLO"],
    preferredGyms: ["MIRADOLO"],
    startsOn: START_MINI,
  },
  {
    name: "Centro Minibasket Sant'Angelo Lodigiano",
    profile: "MINI",
    category: "Minibasket",
    ageGroup: "U9",
    gender: "MIXED",
    color: "#0891b2",
    weekdays: [2, 5],
    preferredWeekdays: [2, 5],
    gyms: ["SANTANGELO"],
    preferredGyms: ["SANTANGELO"],
    startsOn: START_MINI,
  },
];

// ---------------------------------------------------------------------------
// Coaches
// ---------------------------------------------------------------------------

interface CoachSpec {
  first: string;
  last: string;
  quals: string[];
  hours: Hours;
  /** Teams by name. The first is the head coach. */
  teams: string[];
}

/**
 * Fourteen people for thirty groups, which is what a club this size actually
 * has. The bands matter as much as the names: a senior coach who finishes work
 * at six cannot take a minibasket group at half past four, and the village
 * instructors only travel on the days their own hall is open.
 */
const COACHES: CoachSpec[] = [
  {
    first: "Marco",
    last: "Bellini",
    quals: ["Allenatore Senior", "Preparatore atletico"],
    hours: { 1: ["18:00", "23:00"], 2: ["18:00", "23:00"], 3: ["18:00", "23:00"], 4: ["18:00", "23:00"], 5: ["18:00", "23:00"], 6: ["14:00", "20:00"] },
    teams: ["Serie C / Serie C Silver", "Divisione Regionale 1"],
  },
  {
    first: "Andrea",
    last: "Ferrari",
    quals: ["Allenatore Senior"],
    hours: { 1: ["17:30", "23:00"], 2: ["17:30", "23:00"], 3: ["17:30", "23:00"], 4: ["17:30", "23:00"], 5: ["17:30", "23:00"], 6: ["14:00", "20:00"] },
    teams: ["Divisione Regionale 2", "Under 19 Eccellenza"],
  },
  {
    first: "Luca",
    last: "Riva",
    quals: ["Allenatore Giovanile", "Eccellenza"],
    hours: { 1: ["17:00", "22:30"], 2: ["17:00", "22:30"], 3: ["17:00", "22:30"], 4: ["17:00", "22:30"], 5: ["17:00", "22:30"], 6: ["14:00", "19:00"] },
    teams: ["Under 17 Eccellenza", "Under 15 Robur", "Under 14 Robur"],
  },
  {
    first: "Paolo",
    last: "Grandi",
    quals: ["Allenatore Giovanile", "Eccellenza"],
    hours: { 1: ["17:00", "22:30"], 2: ["17:00", "22:30"], 3: ["17:00", "22:30"], 4: ["17:00", "22:30"], 5: ["17:00", "22:30"], 6: ["14:00", "20:00"] },
    teams: ["Under 15 Eccellenza FBL", "Under 14 Gold FBL"],
  },
  {
    first: "Stefano",
    last: "Curioni",
    quals: ["Allenatore Giovanile"],
    hours: { 1: ["16:30", "21:30"], 2: ["16:30", "21:30"], 3: ["16:30", "21:30"], 4: ["16:30", "21:30"], 5: ["16:30", "21:30"] },
    teams: ["Under 14 Robur", "Under 13 Regionale Blu", "Under 13 Robur"],
  },
  {
    first: "Davide",
    last: "Moretti",
    quals: ["Allenatore Giovanile"],
    hours: { 1: ["16:30", "21:30"], 2: ["16:30", "21:30"], 3: ["16:30", "21:30"], 4: ["16:30", "21:30"], 5: ["16:30", "21:30"] },
    teams: ["Under 13 Robur", "Under 13 Regionale Bianco", "Under 14 Robur"],
  },
  {
    first: "Elena",
    last: "Sartori",
    quals: ["Istruttore Minibasket"],
    hours: { 1: ["15:30", "20:00"], 2: ["15:30", "20:00"], 3: ["15:30", "20:00"], 4: ["15:30", "20:00"], 5: ["15:30", "20:00"], 6: ["09:00", "18:00"] },
    teams: ["Esordienti Robur", "Esordienti Bianco", "Scoiattoli 2016/17 Codogno"],
  },
  {
    first: "Giulia",
    last: "Ravelli",
    quals: ["Istruttore Minibasket"],
    hours: { 1: ["15:30", "20:00"], 2: ["15:30", "20:00"], 3: ["15:30", "20:00"], 4: ["15:30", "20:00"], 5: ["15:30", "20:00"], 6: ["09:00", "18:00"] },
    teams: ["Esordienti Blu", "Aquilotti 2014 Codogno", "Pulcini 2018/19 Codogno"],
  },
  {
    first: "Chiara",
    last: "Boselli",
    quals: ["Istruttore Minibasket"],
    hours: { 1: ["15:30", "20:00"], 2: ["15:30", "20:00"], 3: ["15:30", "20:00"], 5: ["15:30", "20:00"], 6: ["09:00", "18:00"] },
    teams: ["Aquilotti 2015 Codogno", "Corso Avviamento allo Sport Codogno"],
  },
  {
    first: "Fabio",
    last: "Zanetti",
    quals: ["Istruttore Minibasket", "Allenatore Giovanile"],
    hours: { 1: ["16:30", "22:00"], 2: ["16:30", "22:00"], 3: ["16:30", "22:00"], 4: ["16:30", "22:00"], 5: ["16:30", "22:00"], 6: ["09:00", "13:00"] },
    teams: ["Pulcini/Scoiattoli Casalpusterlengo", "Pulcini/Scoiattoli Somaglia"],
  },
  {
    first: "Simone",
    last: "Locatelli",
    quals: ["Allenatore Giovanile"],
    hours: { 1: ["16:30", "22:00"], 2: ["16:30", "22:00"], 3: ["16:30", "22:00"], 4: ["16:30", "22:00"], 5: ["16:30", "22:00"], 6: ["14:00", "19:00"] },
    teams: ["Under 13 Gold FBL", "Esordienti FBL"],
  },
  {
    first: "Martina",
    last: "Gozzi",
    quals: ["Istruttore Minibasket"],
    hours: { 1: ["16:30", "20:00"], 3: ["16:30", "20:00"], 4: ["16:30", "20:00"], 5: ["16:30", "20:00"] },
    teams: [
      "Aquilotti San Martino–Sant'Alberto Lodi",
      "Pulcini/Scoiattoli San Martino–Sant'Alberto Lodi",
    ],
  },
  {
    first: "Roberto",
    last: "Uggeri",
    quals: ["Istruttore Minibasket"],
    hours: { 2: ["16:30", "20:30"], 3: ["16:30", "20:30"], 5: ["16:30", "20:30"], 6: ["10:00", "12:00"] },
    teams: ["Centro Minibasket Sant'Angelo Lodigiano"],
  },
  {
    first: "Nicola",
    last: "Pedrazzini",
    quals: ["Allenatore Senior", "Eccellenza"],
    hours: { 1: ["17:30", "23:00"], 2: ["17:30", "23:00"], 3: ["17:30", "23:00"], 4: ["17:30", "23:00"], 5: ["17:30", "23:00"], 6: ["14:00", "20:00"] },
    teams: ["Divisione Regionale 2", "Under 19 Eccellenza", "Under 15 Eccellenza FBL"],
  },
  {
    first: "Ilaria",
    last: "Vismara",
    quals: ["Istruttore Minibasket"],
    hours: { 1: ["15:30", "20:00"], 2: ["15:30", "20:00"], 3: ["15:30", "20:00"], 4: ["15:30", "20:00"], 5: ["15:30", "20:00"], 6: ["09:00", "18:00"] },
    teams: ["Aquilotti 2014 Codogno", "Scoiattoli 2016/17 Codogno", "Aquilotti 2015 Codogno"],
  },
  {
    // One coach, one hall, two groups plus the Miradolo centre. The tightest
    // person in the club, and deliberately so — a fixture with no pinch point
    // tells you nothing about how the optimizer behaves under pressure.
    first: "Alberto",
    last: "Codecasa",
    quals: ["Istruttore Minibasket"],
    hours: { 1: ["16:00", "19:30"], 3: ["16:00", "19:30"], 4: ["17:00", "19:30"], 6: ["10:00", "13:00"] },
    teams: [
      "Aquilotti San Colombano",
      "Pulcini/Scoiattoli San Colombano",
      "Centro Minibasket Miradolo Terme",
    ],
  },
];

// ---------------------------------------------------------------------------
// The season's fixtures
// ---------------------------------------------------------------------------

/**
 * Who plays when.
 *
 * Home games for the senior and Eccellenza sides are at the club's own hall:
 * it is the only one open on a Sunday, and a club plays its home fixtures in
 * its main hall whatever the training pattern says. The youth and minibasket
 * groups play where they train.
 *
 * The U19 midweek rotation is the case the whole per-date blocking mechanism
 * exists for. Closing Tuesday, Wednesday and Thursday to U19 training
 * permanently — the obvious reading of "U19 play midweek" — would cap the side
 * at two sessions a week and contradict its Eccellenza load. Playing on one of
 * the three, and losing only that evening, is what actually happens.
 */
const FIXTURE_POOLS: Record<string, FixturePool> = {
  SENIOR: {
    competition: "Serie C / Divisione Regionale",
    weekdays: [7],
    tipOffs: [17 * 60 + 30, 20 * 60],
    durationMinutes: 120,
    rounds: 22,
    bufferBefore: 90,
    bufferAfter: 60,
    opponents: [
      { club: "Virtus Cremona", town: "Cremona" },
      { club: "Pallacanestro Crema", town: "Crema" },
      { club: "Basket Pavia", town: "Pavia" },
      { club: "Vigevano Basket", town: "Vigevano" },
      { club: "Piacenza Bakery", town: "Piacenza" },
      { club: "Sansebasket Cremona", town: "Cremona" },
      { club: "Social Osa Milano", town: "Milano" },
      { club: "Gorla Basket", town: "Gorla" },
      { club: "Rovello Porro", town: "Rovello Porro" },
      { club: "Busnago Basket", town: "Busnago" },
      { club: "Sesto Basket", town: "Sesto San Giovanni" },
    ],
  },
  U19: {
    competition: "Under 19 Eccellenza",
    // Tuesday, Wednesday, Thursday in rotation.
    weekdays: [2, 3, 4],
    tipOffs: [20 * 60 + 30],
    durationMinutes: 120,
    rounds: 20,
    bufferBefore: 90,
    bufferAfter: 60,
    opponents: [
      { club: "Olimpia Milano U19", town: "Milano" },
      { club: "Cantù U19", town: "Cantù" },
      { club: "Varese U19", town: "Varese" },
      { club: "Bergamo Basket U19", town: "Bergamo" },
      { club: "Brescia Leonessa U19", town: "Brescia" },
      { club: "Cremona U19", town: "Cremona" },
      { club: "Pavia U19", town: "Pavia" },
      { club: "Treviglio U19", town: "Treviglio" },
    ],
  },
  ECCELLENZA: {
    competition: "Eccellenza Regionale",
    weekdays: [7],
    tipOffs: [13 * 60, 15 * 60],
    durationMinutes: 120,
    rounds: 20,
    bufferBefore: 90,
    bufferAfter: 60,
    opponents: [
      { club: "Cantù Giovanile", town: "Cantù" },
      { club: "Varese Giovanile", town: "Varese" },
      { club: "Bergamo Giovanile", town: "Bergamo" },
      { club: "Brescia Giovanile", town: "Brescia" },
      { club: "Cremona Giovanile", town: "Cremona" },
      { club: "Monza Giovanile", town: "Monza" },
      { club: "Treviglio Giovanile", town: "Treviglio" },
      { club: "Pavia Giovanile", town: "Pavia" },
    ],
  },
  YOUTH: {
    competition: "Campionato Regionale",
    weekdays: [6],
    tipOffs: [14 * 60, 16 * 60, 18 * 60],
    durationMinutes: 90,
    rounds: 18,
    bufferBefore: 60,
    bufferAfter: 0,
    opponents: [
      { club: "Basket Lodi", town: "Lodi" },
      { club: "Sant'Angelo Basket", town: "Sant'Angelo Lodigiano" },
      { club: "Melegnano Basket", town: "Melegnano" },
      { club: "Crema Giovanile", town: "Crema" },
      { club: "Pizzighettone", town: "Pizzighettone" },
      { club: "Casale Basket", town: "Casalpusterlengo" },
      { club: "Borghetto Lodigiano", town: "Borghetto Lodigiano" },
      { club: "Castiglione d'Adda", town: "Castiglione d'Adda" },
    ],
  },
  MINI: {
    // Minibasket plays concentrations rather than a league, so far fewer
    // dates — and on Saturday morning, when the halls are otherwise quiet.
    competition: "Concentramento Minibasket",
    weekdays: [6],
    tipOffs: [9 * 60 + 30, 10 * 60 + 45, 12 * 60],
    durationMinutes: 60,
    rounds: 8,
    bufferBefore: 60,
    bufferAfter: 0,
    opponents: [
      { club: "Minibasket Lodi", town: "Lodi" },
      { club: "Minibasket Crema", town: "Crema" },
      { club: "Minibasket Melegnano", town: "Melegnano" },
      { club: "Minibasket Casale", town: "Casalpusterlengo" },
      { club: "Minibasket Piacenza", town: "Piacenza" },
      { club: "Minibasket Pavia", town: "Pavia" },
    ],
  },
};

/** Which competition a side plays in, from what it is. */
function poolOf(team: TeamSpec): string {
  if (team.name.startsWith("Under 19")) return "U19";
  if (team.profile === "SENIOR") return "SENIOR";
  if (team.profile === "ECCELLENZA") return "ECCELLENZA";
  if (team.profile === "MINI" || team.profile === "ESORDIENTI") return "MINI";
  return "YOUTH";
}

/**
 * Where a side hosts.
 *
 * The senior and Eccellenza sides play at the Campus: it is the only hall open
 * on a Sunday, and it is the club's own. Everyone else hosts where they train.
 */
function homeGymFor(team: TeamSpec, pool: string, gymIds: Record<string, string>): string | null {
  if (pool === "SENIOR" || pool === "U19" || pool === "ECCELLENZA") return gymIds.CAMPUS;
  return gymIds[team.preferredGyms[0]] ?? null;
}

// ---------------------------------------------------------------------------
// Feasibility — run the real engine over the fixture before touching the DB
// ---------------------------------------------------------------------------

function windows(hours: Hours): Record<number, MinuteWindow[]> {
  const result: Record<number, MinuteWindow[]> = {};
  for (const [day, span] of Object.entries(hours)) {
    result[Number(day)] = [{ start: toMinutes(span[0]), end: toMinutes(span[1]) }];
  }
  return result;
}

function profileOf(team: TeamSpec): Profile {
  return PROFILES[team.profile];
}

function sessionsOf(team: TeamSpec): number {
  return team.sessions ?? profileOf(team).sessions;
}

function priorityOf(team: TeamSpec): number {
  return team.priority ?? profileOf(team).priority;
}

/** Ids are the fixture keys in a dry run and real uuids after seeding. */
function buildInput(gymIds: Record<string, string>, teamIds: Record<string, string>): ScheduleInput {
  const gyms: EngineGym[] = GYMS.map((gym) => ({
    id: gymIds[gym.key],
    name: gym.name,
    availability: windows(gym.hours),
    hasConfiguredAvailability: true,
  }));

  const trainers: EngineTrainer[] = COACHES.map((coach) => ({
    id: `${coach.first} ${coach.last}`,
    name: `${coach.first} ${coach.last}`,
    availability: windows(coach.hours),
    hasConfiguredAvailability: true,
    teamIds: coach.teams.map((name) => teamIds[name]),
  }));

  const teams: EngineTeam[] = TEAMS.map((team) => {
    const profile = profileOf(team);
    return {
      id: teamIds[team.name],
      name: team.name,
      availability: {},
      sessionsPerWeek: sessionsOf(team),
      durationMinutes: profile.duration,
      priority: priorityOf(team),
      allowedWeekdays: team.weekdays,
      earliestStart: toMinutes(profile.earliest),
      latestEnd: toMinutes(profile.latest),
      minDaysBetween: 1,
      maxDaysBetween: null,
      allowedGymIds: team.gyms.map((key) => gymIds[key]),
      preferredWeekdays: team.preferredWeekdays,
      preferredStart: toMinutes(profile.preferredStart),
      preferredEnd: toMinutes(profile.preferredEnd),
      preferredGymIds: team.preferredGyms.map((key) => gymIds[key]),
    };
  });

  return { teams, trainers, gyms, blockedSlots: [] };
}

function hoursOf(hours: Hours): number {
  return Object.values(hours).reduce(
    (total, [from, until]) => total + (toMinutes(until) - toMinutes(from)) / 60,
    0,
  );
}

/**
 * Demand against supply, then the engine itself.
 *
 * The global ratio is the least interesting number here: what decides whether a
 * fixture is solvable is whether each *subset* of halls can carry the teams
 * locked to it. A club can be at 70% overall and still have a village hall that
 * cannot fit its own two groups.
 */
function report(input: ScheduleInput, gymIds: Record<string, string>): boolean {
  const demand = TEAMS.reduce(
    (total, team) => total + (sessionsOf(team) * profileOf(team).duration) / 60,
    0,
  );
  const supply = GYMS.reduce((total, gym) => total + hoursOf(gym.hours), 0);

  console.log("\nDemand and supply");
  console.log(`  ${TEAMS.length} teams, ${TEAMS.reduce((n, t) => n + sessionsOf(t), 0)} sessions/week, ${demand.toFixed(1)} hall-hours`);
  console.log(`  ${GYMS.length} halls, ${supply.toFixed(1)} hall-hours open`);
  console.log(`  ${((demand / supply) * 100).toFixed(0)}% of nominal capacity\n`);

  console.log("Halls locked to a subset of teams");
  for (const gym of GYMS) {
    const locked = TEAMS.filter((team) => team.gyms.length === 1 && team.gyms[0] === gym.key);
    if (locked.length === 0) continue;
    const need = locked.reduce((t, team) => t + (sessionsOf(team) * profileOf(team).duration) / 60, 0);
    const have = hoursOf(gym.hours);
    console.log(
      `  ${gym.name.padEnd(24)} ${need.toFixed(1)}h needed / ${have.toFixed(1)}h open` +
        `  (${((need / have) * 100).toFixed(0)}%)  ${locked.length} team(s)`,
    );
  }

  let ok = true;

  console.log("\nWeekday ceilings");
  for (const team of input.teams) {
    const days = analyseWeekdays(team, input.gyms, input.trainers);
    const ceiling = weeklyCeiling(team, days);
    if (ceiling !== null && ceiling < team.sessionsPerWeek) {
      ok = false;
      const blocked = days.filter((day) => day.blocker !== "USABLE");
      console.log(
        `  FAIL ${team.name}: wants ${team.sessionsPerWeek}, only ${ceiling} usable day(s).` +
          ` Blocked: ${blocked.map((d) => `${d.isoWeekday}=${d.blocker}`).join(", ")}`,
      );
    }
  }
  if (ok) console.log("  every team has enough usable weekdays");

  const result = generateSchedule(input);
  console.log("\nGeneration");
  console.log(`  ${result.stats.sessionsScheduled}/${result.stats.sessionsRequested} sessions placed, score ${result.score}`);

  const byName = new Map(input.gyms.map((gym) => [gym.id, gym.name]));
  for (const [gymId, count] of Object.entries(result.stats.gymUtilisation).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(byName.get(gymId) ?? gymId).padEnd(24)} ${count} sessions`);
  }

  // Where the week is actually tight. The totals above hide this: a hall can be
  // at 60% for the week and shut on the only evening a group could use it.
  console.log("\n  Hall pressure, placed hours / open hours");
  console.log("  " + "".padEnd(24) + WEEK.map((d) => "MTWTFSS"[d - 1].padStart(9)).join(""));
  for (const gym of GYMS) {
    const cells = WEEK.map((day) => {
      const open = gym.hours[day];
      if (!open) return "       - ";
      const used = result.assignments
        .filter((a) => a.gymId === gymIds[gym.key] && a.isoWeekday === day)
        .reduce((total, a) => total + (a.window.end - a.window.start) / 60, 0);
      const span = (toMinutes(open[1]) - toMinutes(open[0])) / 60;
      return `${used.toFixed(1)}/${span.toFixed(0)}`.padStart(9);
    });
    console.log(`  ${gym.name.padEnd(24)}${cells.join("")}`);
  }

  if (result.unmet.length > 0) {
    console.log("\nUnmet");
    for (const unmet of result.unmet) {
      const placed = result.assignments
        .filter((a) => a.teamId === unmet.teamId)
        .map((a) => `${"MTWTFSS"[a.isoWeekday - 1]} ${fromMinutes(a.window.start)}`)
        .join(", ");
      console.log(
        `  ${unmet.teamName}: ${unmet.scheduled}/${unmet.requested}` +
          ` — ${unmet.reasons.map((r) => r.code).join(", ")}`,
      );
      console.log(`      got: ${placed || "nothing"}`);
    }

    // Contention is the point of this fixture — a club whose halls all fit
    // comfortably would tell us nothing about the optimizer. What must not
    // happen is a team that cannot be placed *in principle*: no coach, no
    // hall, or not enough usable weekdays. Those are mistakes in the data
    // here, not findings about the club, and they are what this gate catches.
    const STRUCTURAL = new Set([
      "NO_ASSIGNED_TRAINER",
      "NO_TRAINER_AVAILABILITY",
      "NO_TRAINER_AVAILABLE",
      "NO_ELIGIBLE_GYM",
      "NO_GYM_AVAILABILITY",
      "WEEKLY_CAPACITY",
      "NO_ALLOWED_WEEKDAY",
      "NO_OVERLAPPING_AVAILABILITY",
      "SESSION_LONGER_THAN_WINDOW",
    ]);

    const structural = result.unmet.filter((unmet) =>
      unmet.reasons.some((reason) => STRUCTURAL.has(reason.code)),
    );
    const missing = result.stats.sessionsRequested - result.stats.sessionsScheduled;
    const starved = result.unmet.filter((unmet) => unmet.scheduled === 0);

    if (structural.length > 0) {
      ok = false;
      console.log(
        `\n  ${structural.length} team(s) cannot be placed at all — that is a mistake in this` +
          ` fixture, not contention. Check their coaches and halls.`,
      );
    }
    if (starved.length > 0) {
      ok = false;
      console.log(`\n  ${starved.length} team(s) got nothing at all.`);
    }
    if (missing > MAX_UNMET_SESSIONS) {
      ok = false;
      console.log(`\n  ${missing} sessions short, more than the ${MAX_UNMET_SESSIONS} this fixture tolerates.`);
    }
  }

  return ok;
}

// ---------------------------------------------------------------------------

async function main() {
  const fixtureIds = Object.fromEntries(GYMS.map((gym) => [gym.key, gym.key]));
  const fixtureTeamIds = Object.fromEntries(TEAMS.map((team) => [team.name, team.name]));

  if (DRY_RUN) {
    console.log("Dry run — nothing will be written.");
    const ok = report(buildInput(fixtureIds, fixtureTeamIds), fixtureIds);
    if (!ok) {
      console.error("\nThe fixture does not fit. Fix it before seeding.");
      process.exit(1);
    }
    console.log("\nFixture is solvable.");
    return;
  }

  const supabase = adminClient();

  const { data: tenants, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, slug, timezone")
    .is("deleted_at", null);
  if (tenantError) throw tenantError;

  const tenant = tenants?.find((candidate) => candidate.slug === TENANT_SLUG);
  if (!tenant) {
    console.error(
      `No club with slug "${TENANT_SLUG}". Available: ${(tenants ?? []).map((t) => t.slug).join(", ")}`,
    );
    process.exit(1);
  }
  const tenantId = tenant.id;

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date")
    .eq("tenant_id", tenantId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season) {
    console.error("No ACTIVE season. Create one before seeding.");
    process.exit(1);
  }

  console.log(`Club:   ${tenant.name} (${tenant.slug})`);
  console.log(`Season: ${season.name} (${season.start_date} to ${season.end_date})\n`);

  // Counts first, so the operator sees what is about to go.
  const TABLES = [
    "schedule_entries",
    "schedule_versions",
    "calendar_event_teams",
    "calendar_events",
    "team_training_requirements",
    "athlete_teams",
    "trainer_teams",
    "team_availability",
    "team_availability_exceptions",
    "trainer_availability",
    "trainer_availability_exceptions",
    "gym_availability",
    "gym_availability_exceptions",
    "athletes",
    "teams",
    "trainers",
    "gyms",
  ] as const;

  console.log("Existing data");
  let existing = 0;
  for (const table of TABLES) {
    const { count, error } = await supabase
      .from(table)
      // "*" rather than "id": calendar_event_teams is a join table with a
      // composite primary key and no id column of its own.
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    // PostgREST returns an empty error object for a head request it cannot
    // serve, so name the table or this is undebuggable.
    if (error) throw new Error(`counting ${table}: ${error.message || JSON.stringify(error)}`);
    existing += count ?? 0;
    if (count) console.log(`  ${table.padEnd(34)} ${count}`);
  }
  if (existing === 0) console.log("  (none)");

  if (existing > 0 && !WIPE) {
    console.error("\nThis club already holds data. Re-run with --wipe --yes to replace it.");
    process.exit(1);
  }
  if (WIPE && !CONFIRMED) {
    console.error("\n--wipe deletes all of the above, irreversibly. Add --yes to confirm.");
    process.exit(1);
  }

  if (WIPE) {
    // schedule_entries.gym_id is ON DELETE RESTRICT — the only one in the
    // schema — so the schedules have to go before the halls they reference.
    // The season, the tenant and its memberships are kept.
    console.log("\nDeleting");
    for (const table of TABLES) {
      const { error } = await supabase.from(table).delete().eq("tenant_id", tenantId);
      if (error) throw new Error(`deleting ${table}: ${error.message || JSON.stringify(error)}`);
    }
    console.log(`  ${TABLES.length} tables cleared`);
  }

  const seasonId = season.id;
  const validFrom = season.start_date;

  // --- Gyms ---------------------------------------------------------------
  const { data: gymRows, error: gymError } = await supabase
    .from("gyms")
    .insert(
      GYMS.map((gym) => ({
        tenant_id: tenantId,
        name: gym.name,
        city: gym.city,
        capacity: gym.capacity,
        color: gym.color,
        sport_types: ["Basket"],
        notes: gym.note,
      })),
    )
    .select("id, name");
  if (gymError) throw gymError;
  const gymIdByName = Object.fromEntries(gymRows.map((row) => [row.name, row.id]));
  const gymIds = Object.fromEntries(GYMS.map((gym) => [gym.key, gymIdByName[gym.name]]));
  console.log(`\n• ${gymRows.length} halls`);

  const gymAvailability = GYMS.flatMap((gym) =>
    Object.entries(gym.hours).map(([day, [from, until]]) => ({
      tenant_id: tenantId,
      gym_id: gymIds[gym.key],
      iso_weekday: Number(day) as IsoWeekday,
      start_time: from,
      end_time: until,
      valid_from: validFrom,
    })),
  );
  const { error: gymAvailError } = await supabase.from("gym_availability").insert(gymAvailability);
  if (gymAvailError) throw gymAvailError;
  console.log(`• ${gymAvailability.length} hall availability windows`);

  // --- Coaches ------------------------------------------------------------
  const { data: coachRows, error: coachError } = await supabase
    .from("trainers")
    .insert(
      COACHES.map((coach) => ({
        tenant_id: tenantId,
        first_name: coach.first,
        last_name: coach.last,
        email: `${coach.first}.${coach.last}@roburfbl.example`.toLowerCase(),
        qualifications: coach.quals,
      })),
    )
    .select("id, first_name, last_name");
  if (coachError) throw coachError;
  const coachIds = Object.fromEntries(
    coachRows.map((row) => [`${row.first_name} ${row.last_name}`, row.id]),
  );
  console.log(`• ${coachRows.length} coaches`);

  const coachAvailability = COACHES.flatMap((coach) =>
    Object.entries(coach.hours).map(([day, [from, until]]) => ({
      tenant_id: tenantId,
      trainer_id: coachIds[`${coach.first} ${coach.last}`],
      iso_weekday: Number(day) as IsoWeekday,
      start_time: from,
      end_time: until,
      valid_from: validFrom,
    })),
  );
  const { error: coachAvailError } = await supabase
    .from("trainer_availability")
    .insert(coachAvailability);
  if (coachAvailError) throw coachAvailError;
  console.log(`• ${coachAvailability.length} coach availability windows`);

  // --- Teams --------------------------------------------------------------
  const { data: teamRows, error: teamError } = await supabase
    .from("teams")
    .insert(
      TEAMS.map((team) => ({
        tenant_id: tenantId,
        season_id: seasonId,
        name: team.name,
        sport: "Basket",
        category: team.category,
        age_group: team.ageGroup,
        gender: team.gender,
        color: team.color,
      })),
    )
    .select("id, name");
  if (teamError) throw teamError;
  const teamIds = Object.fromEntries(teamRows.map((row) => [row.name, row.id]));
  console.log(`• ${teamRows.length} teams`);

  // One head coach per team, enforced by a partial unique index. Decided per
  // team — the first coach listed against it — rather than per coach, so that
  // two people sharing a group cannot both claim to head it.
  const headCoach = new Map<string, string>();
  for (const coach of COACHES) {
    for (const teamName of coach.teams) {
      if (!headCoach.has(teamName)) headCoach.set(teamName, `${coach.first} ${coach.last}`);
    }
  }

  const { error: trainerTeamError } = await supabase.from("trainer_teams").insert(
    COACHES.flatMap((coach) =>
      coach.teams.map((teamName) => ({
        tenant_id: tenantId,
        team_id: teamIds[teamName],
        trainer_id: coachIds[`${coach.first} ${coach.last}`],
        is_head_coach: headCoach.get(teamName) === `${coach.first} ${coach.last}`,
      })),
    ),
  );
  if (trainerTeamError) throw trainerTeamError;

  const { error: requirementError } = await supabase.from("team_training_requirements").insert(
    TEAMS.map((team) => {
      const profile = profileOf(team);
      return {
        tenant_id: tenantId,
        team_id: teamIds[team.name],
        season_id: seasonId,
        sessions_per_week: sessionsOf(team),
        duration_minutes: profile.duration,
        priority: priorityOf(team),
        starts_on: team.startsOn,
        match_rest_days: team.restDays ?? 0,
        allowed_weekdays: team.weekdays,
        earliest_start: profile.earliest,
        latest_end: profile.latest,
        min_days_between: 1,
        preferred_weekdays: team.preferredWeekdays,
        preferred_start: profile.preferredStart,
        preferred_end: profile.preferredEnd,
        allowed_gym_ids: team.gyms.map((key) => gymIds[key]),
        preferred_gym_ids: team.preferredGyms.map((key) => gymIds[key]),
      };
    }),
  );
  if (requirementError) throw requirementError;
  console.log(`• Training requirements for ${TEAMS.length} teams`);

  // --- Fixtures -----------------------------------------------------------
  if (!NO_FIXTURES) {
    const planned = planFixtures({
      teams: TEAMS.map((team) => {
        const pool = poolOf(team);
        return {
          id: teamIds[team.name],
          name: team.name,
          pool,
          homeGymId: homeGymFor(team, pool, gymIds),
          startsOn: team.startsOn,
        };
      }),
      pools: FIXTURE_POOLS,
      seasonStart: season.start_date,
      seasonEnd: season.end_date,
      timeZone: tenant.timezone,
    });

    // Chunked, mirroring the schedule writer: a season of fixtures for thirty
    // teams is a few hundred rows and PostgREST would rather have them in
    // batches than one statement.
    const CHUNK = 500;
    let written = 0;
    for (let index = 0; index < planned.length; index += CHUNK) {
      const batch = planned.slice(index, index + CHUNK);

      const { data: rows, error } = await supabase
        .from("calendar_events")
        .insert(
          batch.map((fixture) => ({
            tenant_id: tenantId,
            season_id: seasonId,
            type: "MATCH" as const,
            title: fixture.title,
            opponent: fixture.opponent,
            is_home: fixture.isHome,
            competition: fixture.competition,
            gym_id: fixture.gymId,
            location: fixture.location,
            start_at: fixture.startAt,
            end_at: fixture.endAt,
            buffer_before_minutes: fixture.bufferBeforeMinutes,
            buffer_after_minutes: fixture.bufferAfterMinutes,
          })),
        )
        .select("id");
      if (error) throw new Error(`inserting fixtures: ${error.message}`);

      const { error: linkError } = await supabase.from("calendar_event_teams").insert(
        rows.map((row, position) => ({
          tenant_id: tenantId,
          event_id: row.id,
          team_id: batch[position].teamId,
        })),
      );
      if (linkError) throw new Error(`linking fixtures: ${linkError.message}`);

      written += rows.length;
    }

    const home = planned.filter((fixture) => fixture.isHome).length;
    console.log(
      `• ${written} fixtures (${home} at home), U19 midweek and everyone else at the weekend`,
    );
  }

  if (!SKIP_CHECK) {
    const ok = report(buildInput(gymIds, teamIds), gymIds);
    if (!ok) {
      console.error("\nSeeded, but the fixture does not fully fit — see above.");
      process.exit(1);
    }
    console.log("\nSeeded, and the fixture is solvable.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
