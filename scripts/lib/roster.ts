/**
 * Squads for the Robur / FBL fixture.
 *
 * A club's roster is not filler: it is the thing that makes a hall booking
 * either fine or illegal, and the thing every screen in the app is really
 * about. So the numbers here follow the club's own shape rather than a flat
 * "twelve per team" — the FBL sides carry a full sixteen, the minibasket
 * centres run ten to fifteen depending on whether they are one of Codogno's
 * own groups or a village satellite, and the seniors sit where a Serie C and
 * two regional squads actually sit.
 *
 * Everything is derived from a per-team seed, so the same team always gets the
 * same squad: re-running the seed does not reshuffle names, and a diff of two
 * runs is empty rather than four hundred lines of noise.
 */

/** What the generator needs to know about a team. Less than a TeamSpec. */
export interface RosterTeam {
  name: string;
  category: string;
  /** "U13", "U15", … or null for the seniors. */
  ageGroup: string | null;
  gender: "MALE" | "FEMALE" | "MIXED";
  /** Home town — the players live near the hall they train in. */
  city: string;
  /** The team's first session; nobody joined the club before it. */
  startsOn: string;
}

export interface RosterAthlete {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "MALE" | "FEMALE";
  email: string;
  phone: string | null;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  membershipStatus: "ACTIVE" | "TRIAL" | "SUSPENDED";
  notes: string | null;
}

export interface RosterMember {
  /** Index into the flat athlete list returned alongside. */
  athlete: number;
  team: string;
  jerseyNumber: number | null;
  position: string | null;
  joinedAt: string;
}

export interface Rosters {
  athletes: RosterAthlete[];
  members: RosterMember[];
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and good enough to spread names about. */
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

/** FNV-1a over the team name, so squads do not depend on team order. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

// ---------------------------------------------------------------------------
// Names — Lodigiano, which is not the same pool as "Italian"
// ---------------------------------------------------------------------------

const MALE_NAMES = [
  "Alessandro", "Andrea", "Antonio", "Christian", "Cristian", "Daniele", "Davide", "Diego",
  "Edoardo", "Elia", "Emanuele", "Enrico", "Federico", "Filippo", "Francesco", "Gabriele",
  "Giacomo", "Gianluca", "Giovanni", "Giulio", "Jacopo", "Leonardo", "Lorenzo", "Luca",
  "Manuel", "Marco", "Mattia", "Matteo", "Michele", "Mirko", "Nicola", "Nicolò",
  "Paolo", "Pietro", "Riccardo", "Roberto", "Samuele", "Simone", "Stefano", "Tommaso",
  "Alberto", "Cesare", "Damiano", "Fabio", "Giorgio", "Ivan", "Kevin", "Martino",
  "Michael", "Omar", "Raffaele", "Sebastiano", "Thomas", "Valerio", "Vittorio", "Yuri",
];

const FEMALE_NAMES = [
  "Alessia", "Alice", "Anna", "Arianna", "Aurora", "Beatrice", "Camilla", "Carlotta",
  "Chiara", "Elena", "Elisa", "Emma", "Federica", "Francesca", "Gaia", "Giorgia",
  "Giulia", "Greta", "Ilaria", "Irene", "Laura", "Letizia", "Ludovica", "Marta",
  "Martina", "Matilde", "Michela", "Nicole", "Noemi", "Rebecca", "Sara", "Serena",
  "Silvia", "Sofia", "Valentina", "Vittoria",
];

/**
 * Surnames of the lower Lodigiano, with the share of southern and North
 * African families the province actually has — a club roster here is not
 * thirty Rossis.
 */
const SURNAMES = [
  "Anelli", "Bertoni", "Bianchi", "Boneschi", "Bonizzoni", "Brambilla", "Cappelletti",
  "Carminati", "Cavalli", "Cerri", "Chiesa", "Colombo", "Corti", "Cremonesi", "Curti",
  "Dossena", "Fadini", "Ferrari", "Ferrarini", "Fugazza", "Galbiati", "Gandini", "Gatti",
  "Ghisoni", "Grossi", "Guarneri", "Lombardi", "Maestri", "Maggi", "Mainardi", "Malinverno",
  "Manfredi", "Marchesi", "Mariani", "Martinelli", "Mazzola", "Merlini", "Milanesi",
  "Molinari", "Mombelli", "Moretti", "Negri", "Novati", "Oldani", "Pagani", "Pallavicini",
  "Passerini", "Pedrazzini", "Peviani", "Pizzamiglio", "Premoli", "Riva", "Rossetti",
  "Rossi", "Sacchi", "Salvaderi", "Sangiovanni", "Scotti", "Sfondrini", "Soresina",
  "Tansini", "Tinelli", "Toscani", "Uggeri", "Valsecchi", "Vecchi", "Verdelli", "Vigo",
  "Villa", "Zanaboni", "Zaninelli", "Zucchi",
  // Southern families, two generations in Codogno and Casale.
  "Amato", "Caruso", "Esposito", "Greco", "Lombardo", "Marino", "Messina", "Romano",
  "Russo", "Santoro",
  // And the families the province has had since the nineties.
  "Bekele", "Diallo", "El Amrani", "Hadid", "Kone", "Ndiaye", "Popescu", "Radu",
  "Shala", "Traore",
];

const PARENT_MALE = ["Alberto", "Claudio", "Fabrizio", "Giuseppe", "Luigi", "Massimo", "Maurizio", "Roberto", "Sergio", "Stefano"];
const PARENT_FEMALE = ["Antonella", "Barbara", "Cristina", "Daniela", "Elisabetta", "Manuela", "Monica", "Paola", "Raffaella", "Simona"];

const STREETS = [
  "Via Roma", "Via Garibaldi", "Via Cavour", "Via Mazzini", "Via Vittorio Emanuele",
  "Via della Repubblica", "Viale Trieste", "Via Manzoni", "Via San Biagio", "Via Gramsci",
  "Via IV Novembre", "Via Marconi", "Via Verdi", "Via Dante", "Via dei Tigli",
  "Via Alessandro Volta", "Via Papa Giovanni XXIII", "Via Fratelli Cervi", "Via Alcide De Gasperi",
];

/** Real CAPs — a fixture full of 00000 is no help when testing a mail merge. */
const POSTAL_CODES: Record<string, string> = {
  "Codogno": "26845",
  "Casalpusterlengo": "26841",
  "Lodi": "26900",
  "Lodi Vecchio": "26855",
  "San Colombano al Lambro": "20078",
  "San Martino in Strada": "26817",
  "Somaglia": "26867",
  "Sant'Angelo Lodigiano": "26866",
  "Miradolo Terme": "27010",
};

/**
 * How a basketball side is actually built. Dealt round rather than drawn one
 * by one, so a fourteen-man squad cannot come out with five centres and no
 * playmaker — which is what an independent draw does often enough to notice.
 */
const POSITIONS = [
  "Playmaker", "Guardia", "Ala piccola", "Ala grande", "Centro",
  "Playmaker", "Guardia", "Ala piccola", "Ala grande",
  "Guardia", "Ala piccola",
];

// ---------------------------------------------------------------------------
// Squad shape
// ---------------------------------------------------------------------------

interface Shape {
  /** Inclusive size range; the exact number is drawn from the team seed. */
  size: [number, number];
  /**
   * Birth years the group draws on, most common first. Youth sides are mostly
   * their own year with two or three playing up from below.
   */
  years: number[];
  /** Roles are named from Under 13 up; minibasket deliberately has none. */
  positions: boolean;
  /** Numbered shirts start at Aquilotti; the little ones wear bibs. */
  jerseys: boolean;
  /** Under 14s are reached through a parent's address and phone. */
  ownContact: boolean;
}

/**
 * Which intakes a group draws on.
 *
 * Minibasket is named, not numbered — Aquilotti, Scoiattoli, Pulcini each mean
 * fixed birth years, and the "U11" in the team record is the club's shorthand
 * rather than a competition band. So the denomination decides, and an explicit
 * year in the team's own name beats even that: Codogno splits its Aquilotti by
 * year where the villages run one combined group.
 *
 * Above minibasket the FIP bands apply: for 2026/27 Under 13 is born 2014, and
 * each band up is a year earlier.
 */
function birthYears(team: RosterTeam, seasonYear: number): number[] {
  const named = team.name.match(/(20\d\d)(?:\/(\d\d))?/);
  if (named) {
    const first = Number(named[1]);
    // "2016/17" — a single group covering two intakes.
    return named[2] ? [first, first + 1] : [first];
  }

  const back = (...offsets: number[]) => offsets.map((offset) => seasonYear - offset);

  if (team.name.startsWith("Corso Avviamento")) return back(6, 5);
  if (team.name.startsWith("Centro Minibasket")) return back(11, 10, 9, 8, 7);
  if (team.name.startsWith("Pulcini/Scoiattoli")) return back(10, 9, 8, 7);
  if (team.name.startsWith("Pulcini")) return back(8, 7);
  if (team.name.startsWith("Scoiattoli")) return back(10, 9);
  if (team.name.startsWith("Aquilotti")) return back(11, 10);
  if (team.name.startsWith("Esordienti")) return back(12);

  const age = team.ageGroup ? Number(team.ageGroup.slice(1)) : null;
  if (age === null) {
    // Seniors: a core in their twenties, a couple of veterans, and the two or
    // three teenagers who train up and sit on the Serie C bench.
    return back(24, 26, 22, 29, 21, 31, 19, 34);
  }

  const main = seasonYear - (age - 1);
  // The group's own year three times over, plus the sottoetà who train up.
  return [main, main, main, main + 1];
}

function shapeOf(team: RosterTeam, seasonYear: number): Shape {
  const years = birthYears(team, seasonYear);
  const isEsordienti = team.name.startsWith("Esordienti");
  const age = team.ageGroup ? Number(team.ageGroup.slice(1)) : 99;

  const common = {
    years,
    positions: age >= 13 && !isEsordienti && team.category !== "Minibasket",
    jerseys: age >= 11,
    ownContact: age >= 14,
  };

  // The club asked for sixteen on every FBL side, and gets exactly that: the
  // sections are run as full squads whatever the age band.
  if (team.category === "Giovanili FBL") return { ...common, size: [16, 16] };

  if (team.category === "Minibasket") {
    // Codogno's own centres fill; the village satellites are what a village
    // holds. Both inside the ten-to-fifteen the club quoted.
    const satellite = /San Colombano|San Martino|Somaglia|Miradolo|Sant'Angelo|Casalpusterlengo/.test(team.name);
    return { ...common, size: satellite ? [10, 12] : [13, 15] };
  }

  if (team.category === "Senior") {
    // Serie C and Serie C Silver are two registered squads sharing a group.
    return { ...common, size: team.name.includes("Silver") ? [17, 18] : [13, 14] };
  }

  // Eccellenza carries a tight squad — everyone in it is meant to play.
  if (team.category === "Eccellenza ABA") return { ...common, size: [12, 13] };

  // Robur's own regional youth: a full bench, and the U13s carry more.
  return { ...common, size: age <= 13 ? [15, 17] : [14, 15] };
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/** One position per shirt, dealt from the rotation and then shuffled. */
function positionsFor(size: number, random: () => number): string[] {
  const dealt = Array.from({ length: size }, (_, index) => POSITIONS[index % POSITIONS.length]);
  return shuffled(dealt, random);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Strips accents and apostrophes so the local part is a legal address. */
function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function phone(random: () => number): string {
  const prefix = pick(["320", "328", "333", "334", "338", "340", "342", "347", "349", "371"], random);
  const body = String(Math.floor(random() * 10_000_000)).padStart(7, "0");
  return `+39 ${prefix} ${body.slice(0, 3)} ${body.slice(3)}`;
}

/**
 * Builds every squad in one pass so that email addresses can be made unique
 * across the club — `athletes_tenant_email_uniq` does not care that two
 * Mattia Ferraris are in different age groups.
 */
export function planRosters(teams: RosterTeam[], seasonYear: number): Rosters {
  const athletes: RosterAthlete[] = [];
  const members: RosterMember[] = [];
  const takenEmails = new Set<string>();

  for (const team of teams) {
    const random = rng(hash(team.name));
    const shape = shapeOf(team, seasonYear);
    const [low, high] = shape.size;
    // A squad size is the whole roster, so the players coming up from the band
    // below are part of it: an FBL side of sixteen is fourteen of its own plus
    // two sottoetà, not eighteen.
    const drawn = low + Math.floor(random() * (high - low + 1));
    const size = Math.max(1, drawn - incoming(team.name));

    const numbers = shuffled([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 21, 23, 24, 30, 33], random);
    const roles = shape.positions ? positionsFor(size, random) : [];

    for (let index = 0; index < size; index += 1) {
      // Minibasket is genuinely mixed; the agonistica sides are not.
      const gender: "MALE" | "FEMALE" =
        team.gender === "MIXED" && random() < 0.38 ? "FEMALE" : team.gender === "MIXED" ? "MALE" : team.gender;

      const firstName = pick(gender === "FEMALE" ? FEMALE_NAMES : MALE_NAMES, random);
      const lastName = pick(SURNAMES, random);

      // Weighted to the group's own year, with a tail of sottoetà.
      const year = shape.years[Math.floor(random() * shape.years.length)];
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      const dateOfBirth = `${year}-${pad(month)}-${pad(day)}`;

      const parentIsMother = random() < 0.55;
      const parentFirst = pick(parentIsMother ? PARENT_FEMALE : PARENT_MALE, random);
      const parentName = `${parentFirst} ${lastName}`;
      const parentPhone = phone(random);

      // Under 14s are reached through the parent; from U14 the club has the
      // player's own mobile and mailbox.
      const mailboxOwner = shape.ownContact ? firstName : parentFirst;
      const email = uniqueEmail(slug(mailboxOwner), slug(lastName), takenEmails);

      athletes.push({
        firstName,
        lastName,
        dateOfBirth,
        gender,
        email,
        phone: shape.ownContact ? phone(random) : null,
        addressLine1: `${pick(STREETS, random)} ${1 + Math.floor(random() * 84)}`,
        postalCode: POSTAL_CODES[team.city] ?? "26845",
        city: team.city,
        country: "IT",
        emergencyContactName: parentName,
        emergencyContactPhone: parentPhone,
        emergencyContactRelation: parentIsMother ? "Madre" : "Padre",
        membershipStatus: membershipOf(team, random),
        notes: noteOf(random),
      });

      members.push({
        athlete: athletes.length - 1,
        team: team.name,
        jerseyNumber: shape.jerseys ? (numbers[index] ?? 34 + index) : null,
        position: roles[index] ?? null,
        joinedAt: team.startsOn,
      });
    }
  }

  addPlayUps(athletes, members, teams);

  return { athletes, members };
}

/**
 * Who trains a band up.
 *
 * Every club has them, and they are the only reason `athlete_teams` is a join
 * table rather than a column: the two best U14s are on the U15 roster as well,
 * and a couple of U19s sit on the Serie C bench on Sunday. A schedule that
 * puts both of their teams in a hall at once is a real clash, so the fixture
 * has to contain the case.
 */
const PLAY_UPS: { from: string; to: string; count: number }[] = [
  { from: "Under 13 Robur", to: "Under 14 Robur", count: 2 },
  { from: "Under 14 Robur", to: "Under 15 Robur", count: 2 },
  { from: "Under 13 Gold FBL", to: "Under 14 Gold FBL", count: 2 },
  { from: "Under 14 Gold FBL", to: "Under 15 Eccellenza FBL", count: 2 },
  { from: "Under 17 Eccellenza", to: "Under 19 Eccellenza", count: 3 },
  { from: "Under 19 Eccellenza", to: "Serie C / Serie C Silver", count: 2 },
];

/** How many of a squad's shirts are filled from the band below. */
function incoming(team: string): number {
  return PLAY_UPS.reduce((total, entry) => (entry.to === team ? total + entry.count : total), 0);
}

/**
 * Adds the second registration for each player who trains up, reusing the
 * athlete and picking a shirt the receiving squad has not taken.
 */
function addPlayUps(athletes: RosterAthlete[], members: RosterMember[], teams: RosterTeam[]): void {
  const byTeam = new Map<string, RosterMember[]>();
  for (const member of members) {
    const list = byTeam.get(member.team);
    if (list) list.push(member);
    else byTeam.set(member.team, [member]);
  }
  const joinedAt = Object.fromEntries(teams.map((team) => [team.name, team.startsOn]));

  for (const { from, to, count } of PLAY_UPS) {
    const source = byTeam.get(from);
    const target = byTeam.get(to);
    if (!source || !target) continue;

    // The oldest in the group are the ones who go up.
    const climbing = [...source]
      .sort((a, b) => athletes[a.athlete].dateOfBirth.localeCompare(athletes[b.athlete].dateOfBirth))
      .slice(0, count);

    const taken = new Set(target.map((member) => member.jerseyNumber));
    for (const member of climbing) {
      let shirt = member.jerseyNumber;
      while (shirt !== null && taken.has(shirt)) shirt += 1;
      taken.add(shirt);
      const promoted: RosterMember = {
        athlete: member.athlete,
        team: to,
        jerseyNumber: shirt,
        // Same player, same role — a point guard does not become a centre.
        position: member.position,
        // They join the senior group when it starts, not when their own does.
        joinedAt: joinedAt[to] ?? member.joinedAt,
      };
      members.push(promoted);
      target.push(promoted);
    }
  }
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function uniqueEmail(first: string, last: string, taken: Set<string>): string {
  const base = `${first}.${last}`;
  let candidate = `${base}@example.test`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}${suffix}@example.test`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Not everyone on a roster is paid up in October. Minibasket carries the
 * trials — a child who came to two sessions and has not signed yet — and the
 * older sides carry the odd suspension.
 */
function membershipOf(team: RosterTeam, random: () => number): "ACTIVE" | "TRIAL" | "SUSPENDED" {
  const roll = random();
  if (team.category === "Minibasket") return roll < 0.1 ? "TRIAL" : "ACTIVE";
  return roll < 0.04 ? "SUSPENDED" : "ACTIVE";
}

const NOTES = [
  "Certificato medico agonistico in scadenza a gennaio.",
  "Assente il martedì per catechismo.",
  "Trasporto condiviso con la famiglia Rossi.",
  "Rientro da infortunio al ginocchio, carichi ridotti.",
  "Fratello maggiore nella stessa società.",
  "In prova fino alla fine di novembre.",
];

function noteOf(random: () => number): string | null {
  return random() < 0.12 ? pick(NOTES, random) : null;
}
