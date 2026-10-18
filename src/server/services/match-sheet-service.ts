import "server-only";

import { ConflictError, NotFoundError, ValidationError, fromDatabaseError } from "@/lib/errors";
import { MAX_IMAGE_BYTES, isReadableImageType, type ReadableImageType } from "@/domain/ai";
import { readTeam, describeFailures, type TeamReading } from "@/domain/referto/reading";
import type { RefertoTranscription, SheetSide } from "@/domain/referto/transcription";
import { refertoTranscriptionSchema } from "@/lib/validation/referto";
import type { ImportSheetInput, ReviseSheetInput } from "@/lib/validation/referto";
import { assertPermission } from "@/server/auth/authorization";
import type { AuthContext } from "@/server/auth/context";
import { readReferto } from "@/server/ai/referto-reader";
import { AUDIT_ACTIONS, recordAudit } from "@/server/services/audit-service";
import { saveResult } from "@/server/services/match-service";
import type { MatchSheetRow, MatchSheetState } from "@/types/database";

/**
 * Uploaded game sheets: storing the photograph, having it read, and turning an
 * accepted reading into rows.
 *
 * The one rule that shapes this file: **nothing is written to a player's
 * record until a human has accepted a reading.** A model call produces a
 * transcription and a reading, both stored on the sheet row and neither
 * authoritative. `importSheet` is the only function here that touches
 * `attendance_records`, `match_box_scores` or `match_results`, and it is only
 * ever called from a review screen where somebody has looked at the derived
 * numbers next to the photograph.
 *
 * The document itself, and why its arithmetic can be checked at all, is
 * specified in docs/referto-import.md.
 */

const BUCKET = "match-sheets";
/** Long enough to look at a sheet and correct it; short enough not to leak. */
const SIGNED_URL_SECONDS = 60 * 30;

/** The reading as it is stored on the row, with the side it was read for. */
export interface StoredReading extends TeamReading {
  side: SheetSide;
}

export interface SheetView {
  id: string;
  registerId: string;
  state: MatchSheetState;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  readModel: string | null;
  failure: string | null;
  importedAt: string | null;
  /** Short-lived; minted per request after a permission check. */
  imageUrl: string | null;
  transcription: RefertoTranscription | null;
  reading: StoredReading | null;
}

/*
  The two JSON columns are `Json`, which is honest — Postgres will return
  whatever was put there, and a row written by an older version of this code is
  exactly the case a cast would hide. Transcriptions are re-validated through
  the same schema the model's reply goes through; a reading is re-derived from
  the transcription rather than trusted, so it needs no schema of its own.
*/
function toTranscription(value: unknown): RefertoTranscription | null {
  if (value === null || typeof value !== "object") return null;
  const parsed = refertoTranscriptionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toReading(value: unknown): StoredReading | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<StoredReading>;
  if (!Array.isArray(candidate.lines) || !Array.isArray(candidate.checks)) return null;
  if (candidate.side !== "a" && candidate.side !== "b") return null;
  return candidate as StoredReading;
}

async function view(context: AuthContext, row: MatchSheetRow): Promise<SheetView> {
  const { data: signed } = await context.db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);

  return {
    id: row.id,
    registerId: row.register_id,
    state: row.state,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    readModel: row.read_model,
    failure: row.failure,
    importedAt: row.imported_at,
    imageUrl: signed?.signedUrl ?? null,
    transcription: toTranscription(row.transcription),
    reading: toReading(row.reading),
  };
}

/* -------------------------------------------------------------------------- */
/* Uploading                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stores a photograph against a register.
 *
 * The register must already exist, which is the whole of the relationship
 * between a sheet and a match: a sheet is evidence about a match the club has
 * scheduled and marked, never the thing that creates one. A club that
 * photographs a friendly nobody opened a register for is told to open one.
 *
 * The object is uploaded before the row is inserted, and a failed insert
 * removes the object again. The other order would leave rows pointing at
 * nothing, which is the state that makes a gallery throw rather than apologise.
 */
export async function uploadSheet(
  context: AuthContext,
  input: { registerId: string; fileName: string; mimeType: string; bytes: ArrayBuffer },
): Promise<SheetView> {
  assertPermission(context, "attendance.record");

  if (!isReadableImageType(input.mimeType)) {
    throw new ValidationError("That file type can't be read.", {
      fieldErrors: {
        file: ["Upload a JPEG, PNG or WebP photograph. An iPhone HEIC must be converted first."],
      },
    });
  }
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ValidationError("That file is too large.", {
      fieldErrors: { file: [`Keep the photograph under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`] },
    });
  }

  const { data: register, error: registerError } = await context.db
    .from("attendance_registers")
    .select("id, occasion, team_id, event_id")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.registerId)
    .maybeSingle();
  if (registerError) throw fromDatabaseError(registerError, { resource: "register" });
  if (!register) throw new NotFoundError("register");
  if (register.occasion !== "MATCH") {
    throw new ConflictError("A game sheet belongs to a match, not a training session.");
  }

  /*
    The tenant id leads the key because the storage policies read it back out
    of the path — see migration 0026. The extension is derived from the mime
    type rather than the uploaded name, so a file called `sheet.jpg.exe` is
    stored as the JPEG it actually is.
  */
  const extension = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
  const id = crypto.randomUUID();
  const path = `${context.tenant.id}/${input.registerId}/${id}.${extension}`;

  const { error: uploadError } = await context.db.storage
    .from(BUCKET)
    .upload(path, input.bytes, { contentType: input.mimeType, upsert: false });
  if (uploadError) {
    throw new ConflictError("The photograph could not be stored. Try again.", {
      cause: uploadError,
    });
  }

  const { data: row, error } = await context.db
    .from("match_sheets")
    .insert({
      id,
      tenant_id: context.tenant.id,
      register_id: input.registerId,
      storage_path: path,
      mime_type: input.mimeType,
      byte_size: input.bytes.byteLength,
      uploaded_by: context.user.id,
    })
    .select("*")
    .single();

  if (error) {
    // Leave no orphan object behind. A failure here is already an error path;
    // a failure to clean up should not replace the error that caused it.
    await context.db.storage.from(BUCKET).remove([path]);
    throw fromDatabaseError(error, { resource: "game sheet" });
  }

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MATCH_SHEET_UPLOADED,
    resourceType: "attendance_register",
    resourceId: input.registerId,
    newValue: { sheet: row.id, bytes: input.bytes.byteLength },
  });

  return view(context, row);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export async function listSheets(
  context: AuthContext,
  registerId: string,
): Promise<SheetView[]> {
  assertPermission(context, "attendance.read");

  const { data, error } = await context.db
    .from("match_sheets")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("register_id", registerId)
    .order("created_at", { ascending: false });
  if (error) throw fromDatabaseError(error, { resource: "game sheet" });

  return Promise.all((data ?? []).map((row) => view(context, row)));
}

export async function getSheet(context: AuthContext, sheetId: string): Promise<SheetView> {
  assertPermission(context, "attendance.read");

  const { data, error } = await context.db
    .from("match_sheets")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", sheetId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "game sheet" });
  if (!data) throw new NotFoundError("game sheet");

  return view(context, data);
}

/**
 * Has a model transcribe the photograph, then derives and checks a reading.
 *
 * Which side of the sheet is ours is decided here rather than asked of the
 * model: it is the side whose transcribed club name is closest to our club's,
 * and when that is not decidable both readings are computed and the one that
 * reconciles is preferred. Getting it wrong imports the opponent's statistics
 * into our athletes' seasons, so the review screen always shows which side was
 * chosen and lets it be changed without a second model call.
 */
export async function readSheet(context: AuthContext, sheetId: string): Promise<SheetView> {
  assertPermission(context, "attendance.record");
  assertPermission(context, "ai.read");

  const { data: row, error } = await context.db
    .from("match_sheets")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", sheetId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "game sheet" });
  if (!row) throw new NotFoundError("game sheet");
  if (row.state === "IMPORTED") {
    throw new ConflictError("That sheet has already been imported. Upload a new photograph to redo it.");
  }

  const { data: file, error: downloadError } = await context.db.storage
    .from(BUCKET)
    .download(row.storage_path);
  if (downloadError || !file) {
    throw new ConflictError("The stored photograph could not be read back.");
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mediaType = row.mime_type as ReadableImageType;

  let transcription: RefertoTranscription;
  let model: string;
  try {
    const result = await readReferto(context, { data, mediaType });
    transcription = result.transcription;
    model = result.model;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "The sheet could not be read.";
    await context.db
      .from("match_sheets")
      .update({ state: "FAILED", failure: message })
      .eq("tenant_id", context.tenant.id)
      .eq("id", sheetId);
    throw failure;
  }

  const side = chooseSide(transcription, context.tenant.name);
  const reading: StoredReading = { side, ...readTeam(transcription.teams[side]) };

  const { data: updated, error: updateError } = await context.db
    .from("match_sheets")
    .update({
      state: "READ",
      transcription: transcription as unknown as MatchSheetRow["transcription"],
      reading: reading as unknown as MatchSheetRow["reading"],
      read_model: model,
      // A reading that fails its checks is still a reading: the review screen
      // shows the failures beside the photograph. `failure` is for a sheet that
      // could not be read at all, which is why it is cleared here.
      failure: null,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", sheetId)
    .select("*")
    .single();
  if (updateError) throw fromDatabaseError(updateError, { resource: "game sheet" });

  return view(context, updated);
}

/**
 * Which roster block is ours.
 *
 * Name similarity first, because the club name is printed and usually legible.
 * Failing that, whichever side's arithmetic reconciles — a sheet where only one
 * block was transcribed cleanly is common when the photograph is cropped, and
 * the clean one is far more likely to be the one somebody photographed on
 * purpose. Squadra A when neither test decides, because A is the home side and
 * a club photographs more of its own home games.
 */
function chooseSide(transcription: RefertoTranscription, clubName: string): SheetSide {
  const ours = normalise(clubName);
  const a = normalise(transcription.teams.a.clubName ?? "");
  const b = normalise(transcription.teams.b.clubName ?? "");

  const aMatches = a.length > 0 && (a.includes(ours) || ours.includes(a));
  const bMatches = b.length > 0 && (b.includes(ours) || ours.includes(b));
  if (aMatches !== bMatches) return aMatches ? "a" : "b";

  const aOk = readTeam(transcription.teams.a).ok;
  const bOk = readTeam(transcription.teams.b).ok;
  if (aOk !== bOk) return aOk ? "a" : "b";

  return "a";
}

/** Lower-cased, de-punctuated, and without the club-form words that never help. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(a\.?s\.?d\.?|s\.?s\.?d\.?|a\.?p\.?s\.?|polisportiva|basket|pallacanestro)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Re-derives a reading from a transcription a human has corrected.
 *
 * No model call, which is the point of keeping transcription and reading apart:
 * the photograph is read once, and every correction after that is arithmetic.
 * It also means a secretary fixing the one digit the model got wrong is not
 * waiting on a vendor, and is not charged for it.
 */
export async function reviseSheet(
  context: AuthContext,
  input: ReviseSheetInput,
): Promise<SheetView> {
  assertPermission(context, "attendance.record");

  const { data: row, error } = await context.db
    .from("match_sheets")
    .select("id, state")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.sheetId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "game sheet" });
  if (!row) throw new NotFoundError("game sheet");
  if (row.state === "IMPORTED") {
    throw new ConflictError("That sheet has already been imported.");
  }

  const reading: StoredReading = {
    side: input.side,
    ...readTeam(input.transcription.teams[input.side]),
  };

  const { data: updated, error: updateError } = await context.db
    .from("match_sheets")
    .update({
      state: "READ",
      transcription: input.transcription as unknown as MatchSheetRow["transcription"],
      reading: reading as unknown as MatchSheetRow["reading"],
      failure: null,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.sheetId)
    .select("*")
    .single();
  if (updateError) throw fromDatabaseError(updateError, { resource: "game sheet" });

  return view(context, updated);
}

/* -------------------------------------------------------------------------- */
/* Importing                                                                  */
/* -------------------------------------------------------------------------- */

export interface ImportOutcome {
  /** Players whose line was written. */
  imported: number;
  /** Shirt numbers on the sheet that nobody claimed, and were therefore skipped. */
  unassigned: number[];
  resultRecorded: boolean;
}

/**
 * Writes an accepted reading into the register, the box score and the result.
 *
 * Refuses outright when a hard check has failed. There is no override: a sheet
 * whose points do not reconcile is a sheet somebody has misread, and importing
 * it anyway would put numbers into a child's season that nobody can later
 * explain. The way past a hard failure is to correct the transcription on the
 * review screen, which re-derives for free.
 *
 * Only our own side is ever imported. The opponent's roster is on the paper and
 * is not ours to keep.
 */
export async function importSheet(
  context: AuthContext,
  input: ImportSheetInput,
): Promise<ImportOutcome> {
  assertPermission(context, "attendance.record");

  const { data: row, error } = await context.db
    .from("match_sheets")
    .select("*")
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.sheetId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "game sheet" });
  if (!row) throw new NotFoundError("game sheet");
  if (row.state === "IMPORTED") throw new ConflictError("That sheet has already been imported.");

  /*
    What the reviewer confirmed, falling back to what was stored when the
    photograph was read. The stored one is only a starting point — a sheet whose
    unreadable scorer was answered on the review screen reconciles in the
    reviewer's copy and not in ours.
  */
  const transcription = input.transcription ?? toTranscription(row.transcription);
  if (!transcription) {
    throw new ConflictError("That sheet has not been read yet.");
  }

  // Derived again rather than read off the row: the stored reading is a cache of
  // an arithmetic function, and the arithmetic is cheap. If the two ever
  // disagreed, the fresh one is the one to trust.
  const reading = readTeam(transcription.teams[input.side]);
  if (!reading.ok) {
    throw new ConflictError(
      `This sheet does not reconcile, so it cannot be imported. ${describeFailures(reading)}`,
    );
  }

  const { data: register, error: registerError } = await context.db
    .from("attendance_registers")
    .select("id, team_id, event_id, occasion")
    .eq("tenant_id", context.tenant.id)
    .eq("id", row.register_id)
    .maybeSingle();
  if (registerError) throw fromDatabaseError(registerError, { resource: "register" });
  if (!register) throw new NotFoundError("register");

  /*
    Every assignment must name an athlete who is in this team's squad. The shirt
    number on the sheet is the number worn that day and is not trusted as a key
    — a borrowed shirt is a normal Saturday — so the mapping comes from the
    review screen and is checked here against the squad rather than inferred.
  */
  const athleteIds = [...new Set(input.assignments.map((assignment) => assignment.athleteId))];
  if (athleteIds.length !== input.assignments.length) {
    throw new ConflictError("Two shirt numbers are assigned to the same player.");
  }

  if (athleteIds.length > 0) {
    const { data: squad } = await context.db
      .from("athlete_teams")
      .select("athlete_id")
      .eq("tenant_id", context.tenant.id)
      .eq("team_id", register.team_id)
      .in("athlete_id", athleteIds);
    const inSquad = new Set((squad ?? []).map((link) => link.athlete_id));
    const stranger = athleteIds.find((id) => !inSquad.has(id));
    if (stranger) {
      throw new ConflictError("A player who is not in this squad cannot be given a line.");
    }
  }

  const byShirt = new Map(reading.lines.map((line) => [line.shirt, line]));
  const assigned = input.assignments.filter((assignment) => byShirt.has(assignment.shirt));
  const unassigned = reading.lines
    .filter(
      (line) =>
        (line.played || line.points > 0) &&
        !input.assignments.some((assignment) => assignment.shirt === line.shirt),
    )
    .map((line) => line.shirt);

  /*
    Attendance first, then the box score. `match_box_scores` is only meaningful
    for a player the register says was called up, and the import is often the
    thing that establishes that — a club that photographs the sheet rather than
    picking a squad in the app has no call-ups until this runs.
  */
  if (assigned.length > 0) {
    const { error: recordError } = await context.db.from("attendance_records").upsert(
      assigned.map((assignment) => {
        const line = byShirt.get(assignment.shirt)!;
        return {
          tenant_id: context.tenant.id,
          register_id: register.id,
          athlete_id: assignment.athleteId,
          // An X in E/N. is a player who was there and took part.
          state: "PRESENT" as const,
          called_up: true,
          started: line.starter,
          prefilled: false,
          recorded_by: context.user.id,
        };
      }),
      { onConflict: "register_id,athlete_id" },
    );
    if (recordError) throw fromDatabaseError(recordError, { resource: "register" });

    const { error: boxError } = await context.db.from("match_box_scores").upsert(
      assigned.map((assignment) => {
        const line = byShirt.get(assignment.shirt)!;
        return {
          tenant_id: context.tenant.id,
          register_id: register.id,
          athlete_id: assignment.athleteId,
          two_point_made: line.twoPointMade,
          three_point_made: line.threePointMade,
          free_throw_made: line.freeThrowMade,
          /*
            A referto records makes and never attempts, and the database
            enforces made <= attempted — so attempts are set equal to makes.
            `source` is what stops that from being read as a perfect shooting
            night: see docs/referto-import.md §6.
          */
          two_point_attempted: line.twoPointMade,
          three_point_attempted: line.threePointMade,
          free_throw_attempted: line.freeThrowMade,
          fouls_committed: line.foulsCommitted,
          // Not on the document at all. Left at zero rather than guessed.
          seconds_played: 0,
          source: "REFERTO" as const,
          created_by: context.user.id,
        };
      }),
      { onConflict: "register_id,athlete_id" },
    );
    if (boxError) throw fromDatabaseError(boxError, { resource: "box score" });
  }

  /*
    The result, from the two sides' finals rather than from our derived total:
    the import has already proved they agree, and the opponent's score is only
    ever on the paper.
  */
  const otherSide: SheetSide = input.side === "a" ? "b" : "a";
  const theirs = transcription.teams[otherSide];
  let resultRecorded = false;

  if (input.withResult && register.event_id !== null && theirs.finalScore !== null) {
    await saveResult(context, {
      eventId: register.event_id,
      teamId: register.team_id,
      state: "PLAYED",
      ourScore: reading.points,
      theirScore: theirs.finalScore,
      ourPeriods: reading.periods.length > 0 ? reading.periods : null,
      // Only when they add up, which the schema also checks: a misread
      // opponent's quarter must not fail the whole import.
      theirPeriods:
        theirs.periods.length > 0 &&
        theirs.periods.reduce((sum, period) => sum + period, 0) === theirs.finalScore
          ? theirs.periods
          : null,
      notes: null,
    });
    resultRecorded = true;
  }

  const { error: stateError } = await context.db
    .from("match_sheets")
    .update({
      state: "IMPORTED",
      // Both halves of what was imported from, so a figure disputed in March is
      // answerable: the transcription the reviewer accepted and the reading
      // derived from it.
      transcription: transcription as unknown as MatchSheetRow["transcription"],
      reading: { side: input.side, ...reading } as unknown as MatchSheetRow["reading"],
      imported_at: new Date().toISOString(),
      imported_by: context.user.id,
      failure: null,
    })
    .eq("tenant_id", context.tenant.id)
    .eq("id", input.sheetId);
  if (stateError) throw fromDatabaseError(stateError, { resource: "game sheet" });

  await recordAudit(context, {
    action: AUDIT_ACTIONS.MATCH_SHEET_IMPORTED,
    resourceType: "attendance_register",
    resourceId: register.id,
    newValue: {
      sheet: input.sheetId,
      players: assigned.length,
      unassigned,
      model: row.read_model,
    },
  });

  return { imported: assigned.length, unassigned, resultRecorded };
}

/**
 * Removes a sheet and its photograph.
 *
 * The row goes first: an object with no row is invisible and costs storage,
 * while a row with no object is a gallery that throws. Numbers already imported
 * are left alone — they are the club's record now, and deleting the evidence
 * must not silently revise a season.
 */
export async function deleteSheet(context: AuthContext, sheetId: string): Promise<void> {
  assertPermission(context, "attendance.manage");

  const { data: row, error } = await context.db
    .from("match_sheets")
    .select("id, storage_path")
    .eq("tenant_id", context.tenant.id)
    .eq("id", sheetId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, { resource: "game sheet" });
  if (!row) throw new NotFoundError("game sheet");

  const { error: deleteError } = await context.db
    .from("match_sheets")
    .delete()
    .eq("tenant_id", context.tenant.id)
    .eq("id", sheetId);
  if (deleteError) throw fromDatabaseError(deleteError, { resource: "game sheet" });

  await context.db.storage.from(BUCKET).remove([row.storage_path]);
}
