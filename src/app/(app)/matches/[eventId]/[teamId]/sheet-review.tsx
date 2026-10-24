"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  Loader2,
  Pencil,
  RefreshCw,
  Upload,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { SCROLLING_GRID } from "@/components/attendance/scrolling-grid";
import { Disclosure } from "@/components/data/disclosure";
import { useAction } from "@/hooks/use-action";
import {
  NotationError,
  formatLadder,
  formatPeriods,
  formatRoster,
  parseLadder,
  parsePeriods,
  parseRoster,
} from "@/domain/referto/notation";
import { readTeam } from "@/domain/referto/reading";
import {
  applyAnswer,
  askQuestions,
  certainties,
  suggestAssignments,
  type Answer,
  type Certainty,
  type ReviewState,
} from "@/domain/referto/questions";
import type { RefertoTranscription, SheetSide } from "@/domain/referto/transcription";
import { importSheetAction, reviseSheetAction } from "@/server/actions/matches";
import type { SheetView } from "@/server/services/match-sheet-service";
import type { SquadMember } from "@/server/services/match-service";

import { SheetQuestions } from "./sheet-questions";

/**
 * Checking a read sheet before anything is written.
 *
 * The screen is in four parts, in this order deliberately:
 *
 *   1. **What the reader is sure about** — a list, confirmed in one action.
 *      Most of a good photograph lands here, and none of it is worth a prompt.
 *   2. **Questions** — only the things with a finite set of answers that the
 *      code can apply. Asked one at a time in a dialog, with the photograph
 *      beside them. `src/domain/referto/questions.ts` decides what qualifies.
 *   3. **Problems** — what disagrees with something else on the same sheet.
 *      Not questions: there is no option that fixes "the points add to 65 but
 *      the final score says 67", only a person reading the paper. The
 *      correction panel is for these.
 *   4. **Confirm** — the uploader presses import. Nothing before this point has
 *      touched the database.
 *
 * Everything on screen is derived from one piece of state, the transcription,
 * so the checks can never be shown stale. `readTeam` is pure and runs in the
 * browser, which is why answering a question updates the whole screen with no
 * round trip — and the server re-derives the same way before writing, so what
 * is shown is what lands.
 */
export function SheetReview({
  sheet,
  squad,
  canRecord,
  /** False when the club has already typed the result in by hand. */
  needsResult = true,
}: {
  sheet: SheetView;
  squad: SquadMember[];
  canRecord: boolean;
  needsResult?: boolean;
}) {
  const t = useTranslations("matches");
  const { run, isPending } = useAction();

  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [withResult, setWithResult] = useState(true);

  const [state, setState] = useState<ReviewState | null>(() => {
    if (!sheet.transcription) return null;
    const side = sheet.reading?.side ?? "a";
    return {
      transcription: sheet.transcription,
      side,
      assignments: suggestAssignments(
        sheet.transcription.teams[side].players.map((player) => player.shirt),
        squad,
      ),
    };
  });

  const derived = useMemo(() => {
    if (!state) return null;
    const team = state.transcription.teams[state.side];
    const reading = readTeam(team);
    const options = {
      needsOpponentScore: needsResult && withResult,
      // Why we believe this is our block — home and away first, the club name
      // only as a cross-check. Recorded when the sheet was read.
      side: sheet.reading?.evidence,
    };
    return {
      team,
      reading,
      questions: askQuestions(state, reading, squad, options),
      sure: certainties(state, reading, options),
    };
  }, [state, squad, needsResult, withResult, sheet.reading?.evidence]);

  if (!state || !derived) {
    return (
      <Alert>
        <AlertDescription>{t("sheetState.UPLOADED")}</AlertDescription>
      </Alert>
    );
  }

  const { team, reading, questions, sure } = derived;
  /*
    A non-null alias for the handlers below. TypeScript drops the narrowing
    from the guard above once it crosses into a closure, since nothing promises
    the closure runs before the next render.
  */
  const review = state;

  const hardFailures = reading.checks.filter(
    (check) => check.severity === "HARD" && !check.passed,
  );
  const softFailures = reading.checks.filter(
    (check) => check.severity === "SOFT" && !check.passed,
  );

  const rows = reading.lines.filter((line) => line.played || line.points > 0);
  const chosen = rows.filter((line) => (state.assignments[line.shirt] ?? null) !== null);

  function answer(value: Answer) {
    setState((current) => (current ? applyAnswer(current, value, squad) : current));
  }

  function recheck() {
    run(
      () =>
        reviseSheetAction({
          sheetId: sheet.id,
          side: review.side,
          transcription: review.transcription,
        }),
      { success: () => t("revised"), onSuccess: () => setEditing(false) },
    );
  }

  function commit() {
    run(
      () =>
        importSheetAction({
          sheetId: sheet.id,
          side: review.side,
          withResult,
          // As reviewed, not as first read: the answers above may have changed it.
          transcription: review.transcription,
          assignments: chosen.map((line) => ({
            shirt: line.shirt,
            athleteId: review.assignments[line.shirt]!,
          })),
        }),
      {
        success: (outcome) =>
          outcome.resultRecorded
            ? t("imported", { count: outcome.imported })
            : t("importedNoResult", { count: outcome.imported }),
      },
    );
  }

  return (
    <div className="space-y-5">
      {/* 1 — what needs no decision. */}
      <section className="space-y-2">
        <div>
          <h4 className="text-sm font-medium">{t("certain")}</h4>
          <p className="text-xs text-muted-foreground">{t("certainHint")}</p>
        </div>

        {sure.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("checksBlocked")}</p>
        ) : (
          <ul className="space-y-1.5 rounded-md border bg-muted/30 p-3">
            {sure.map((entry) => (
              <li key={entry.kind} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{describe(entry, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2 — the questions, if any. */}
      <section className="space-y-2">
        {questions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="size-4" aria-hidden />
            {t("questionsNone")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <CircleHelp className="size-4" aria-hidden />
                  {t("questionsTitle", { count: questions.length })}
                </h4>
                <p className="text-xs text-muted-foreground">{t("questionsHint")}</p>
              </div>
              {canRecord ? (
                <Button size="sm" onClick={() => setAsking(true)}>
                  {t("answerQuestions", { count: questions.length })}
                </Button>
              ) : null}
            </div>

            {/* A standing summary, so the page says what is outstanding even
                once the dialog is closed. */}
            <ul className="space-y-1 text-sm">
              {questions.slice(0, 5).map((question) => (
                <li key={question.id} className="text-muted-foreground">
                  ·{" "}
                  {question.kind === "PLAYER"
                    ? t("qPlayerTitle", { shirt: question.shirt })
                    : question.kind === "SCORER"
                      ? t("qScorerTitle", { total: question.total })
                      : question.kind === "SIDE"
                        ? t("qSideTitle")
                        : t("qOpponentTitle", { club: question.clubName ?? t("opponent") })}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 3 — what disagrees with the rest of the sheet. Not questions. */}
      {hardFailures.length > 0 || softFailures.length > 0 ? (
        <section className="space-y-2">
          <div>
            <h4 className="text-sm font-medium">{t("problems")}</h4>
            <p className="text-xs text-muted-foreground">{t("problemsHint")}</p>
          </div>

          {hardFailures.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertDescription>
                <ul className="list-disc space-y-1 ps-4">
                  {hardFailures.map((check) => (
                    <li key={check.id}>{check.detail}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {softFailures.length > 0 ? (
            <Alert>
              <AlertTriangle aria-hidden />
              <AlertDescription>
                <p className="font-medium">{t("checksWarn")}</p>
                <ul className="list-disc space-y-1 ps-4">
                  {softFailures.map((check) => (
                    <li key={check.id}>{check.detail}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </section>
      ) : null}

      {/* The lines themselves, for the final read-through before confirming. */}
      <Disclosure title={t("boxScore")} meta={String(reading.points)}>
        {/* Read against the paper, so a grid on a phone too: see SCROLLING_GRID. */}
        <div className={SCROLLING_GRID}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t("shirt")}</TableHead>
                <TableHead>{t("onSheet")}</TableHead>
                <TableHead>{t("player")}</TableHead>
                <TableHead className="w-14 text-end">{t("twos")}</TableHead>
                <TableHead className="w-14 text-end">{t("threes")}</TableHead>
                <TableHead className="w-14 text-end">{t("freeThrows")}</TableHead>
                <TableHead className="w-14 text-end">{t("points")}</TableHead>
                <TableHead className="w-14 text-end">{t("fouls")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((line) => {
                const player = team.players.find((entry) => entry.shirt === line.shirt);
                const athleteId = state.assignments[line.shirt] ?? null;
                return (
                  <TableRow key={line.shirt}>
                    <TableCell className="font-medium tabular-nums">{line.shirt}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {player
                        ? [player.surname, player.givenName].filter(Boolean).join(" ")
                        : "—"}
                      {line.starter ? (
                        <Badge variant="outline" className="ms-1.5 font-normal">
                          {t("starter")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {athleteId ? (
                        squad.find((member) => member.athleteId === athleteId)?.name
                      ) : (
                        <span className="text-muted-foreground">{t("unassigned")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{line.twoPointMade}</TableCell>
                    <TableCell className="text-end tabular-nums">{line.threePointMade}</TableCell>
                    <TableCell className="text-end tabular-nums">{line.freeThrowMade}</TableCell>
                    <TableCell className="text-end font-medium tabular-nums">
                      {line.points}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{line.foulsCommitted}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Disclosure>

      {/* The correction path, for the problems above. */}
      {canRecord ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing((open) => !open)}>
              <Pencil aria-hidden />
              {t("revise")}
            </Button>
            {questions.length === 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
                <CircleHelp aria-hidden />
                {t("reopenQuestions")}
              </Button>
            ) : null}
          </div>

          {editing ? (
            <TranscriptionEditor
              transcription={state.transcription}
              side={state.side}
              onChange={(next) =>
                setState((current) => (current ? { ...current, transcription: next } : current))
              }
            />
          ) : null}
        </div>
      ) : null}

      {/* 4 — the confirmation. */}
      {canRecord ? (
        <div className="space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={commit}
              disabled={
                isPending || !reading.ok || questions.length > 0 || chosen.length === 0
              }
            >
              {isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              {t("confirmImport", { count: chosen.length })}
            </Button>

            {needsResult ? (
              <Label className="flex items-center gap-2 text-sm font-normal">
                <Checkbox
                  checked={withResult}
                  onCheckedChange={(value) => setWithResult(value === true)}
                />
                {t("withResult")}
              </Label>
            ) : null}

            {editing ? (
              <Button variant="ghost" size="sm" onClick={recheck} disabled={isPending}>
                <RefreshCw aria-hidden />
                {t("recheck")}
              </Button>
            ) : null}
          </div>

          {questions.length > 0 ? (
            <p className="text-xs text-muted-foreground">{t("blockedByQuestions")}</p>
          ) : !reading.ok ? (
            <p className="text-xs text-muted-foreground">{t("blockedByProblems")}</p>
          ) : chosen.length < rows.length ? (
            <p className="text-xs text-muted-foreground">
              {t("assignSkipped", {
                shirts: rows
                  .filter((line) => (state.assignments[line.shirt] ?? null) === null)
                  .map((line) => line.shirt)
                  .join(", "),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <SheetQuestions
        open={asking}
        onOpenChange={setAsking}
        questions={questions}
        imageUrl={sheet.imageUrl}
        onAnswer={answer}
      />
    </div>
  );
}

/** One certainty, as a sentence. */
function describe(entry: Certainty, t: ReturnType<typeof useTranslations<"matches">>): string {
  switch (entry.kind) {
    case "SIDE":
      /*
        The reason is the useful half. "Squadra B, because we played away" is
        checkable at a glance by whoever was there; the club name alone is not,
        which is exactly how the wrong side got chosen before.
      */
      if (entry.because === "HOME_AWAY") {
        return entry.isHome
          ? t("certainSideHome", { club: entry.clubName })
          : t("certainSideAway", { club: entry.clubName });
      }
      return t("certainSide", { club: entry.clubName });
    case "PLAYERS_MATCHED":
      return t("certainPlayers", { matched: entry.matched, total: entry.total });
    case "POINTS":
      return t("certainPoints", { points: entry.points });
    case "QUARTERS":
      return t("certainQuarters", { periods: entry.periods.join(" · ") });
    case "STARTERS":
      return t("certainStarters", { shirts: entry.shirts.join(", ") });
    case "FOULS":
      return t("certainFouls", { players: entry.players });
    case "SCORE":
      return t("certainScore", { ourScore: entry.ourScore, theirScore: entry.theirScore });
  }
}

/**
 * Editing what the reader saw.
 *
 * For the problems the questions cannot cover: a total misread mid-ladder, a
 * quarter that does not reconcile. Text areas in the notation from
 * `src/domain/referto/notation.ts`, parsed on every keystroke so the checks
 * above update live. A parse failure shows its line number and keeps the last
 * good value, so a half-typed line never blanks the table being corrected.
 */
function TranscriptionEditor({
  transcription,
  side,
  onChange,
}: {
  transcription: RefertoTranscription;
  side: SheetSide;
  onChange: (next: RefertoTranscription) => void;
}) {
  const t = useTranslations("matches");
  const team = transcription.teams[side];
  const other: SheetSide = side === "a" ? "b" : "a";
  const theirs = transcription.teams[other];

  const [ladderText, setLadderText] = useState(() => formatLadder(team.ladder));
  const [rosterText, setRosterText] = useState(() => formatRoster(team.players));
  const [periodsText, setPeriodsText] = useState(() => formatPeriods(team.periods));
  const [theirPeriodsText, setTheirPeriodsText] = useState(() => formatPeriods(theirs.periods));
  const [error, setError] = useState<string | null>(null);

  function apply(
    mutate: () => Partial<typeof team>,
    mutateOther?: () => Partial<typeof theirs>,
  ) {
    try {
      const patch = mutate();
      const otherPatch = mutateOther?.() ?? {};
      setError(null);
      onChange({
        ...transcription,
        teams: {
          ...transcription.teams,
          [side]: { ...team, ...patch },
          [other]: { ...theirs, ...otherPatch },
        } as RefertoTranscription["teams"],
      });
    } catch (failure) {
      setError(
        failure instanceof NotationError
          ? t("parseError", { line: failure.line, detail: failure.detail })
          : String(failure),
      );
    }
  }

  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4">
      <p className="text-xs text-muted-foreground">{t("reviseHint")}</p>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ourFinal">{t("ourFinal")}</Label>
          <Input
            id="ourFinal"
            inputMode="numeric"
            className="w-24 tabular-nums"
            defaultValue={team.finalScore?.toString() ?? ""}
            onChange={(event) =>
              apply(() => ({
                finalScore: event.target.value === "" ? null : Number(event.target.value),
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="theirFinal">{t("theirFinal")}</Label>
          <Input
            id="theirFinal"
            inputMode="numeric"
            className="w-24 tabular-nums"
            defaultValue={theirs.finalScore?.toString() ?? ""}
            onChange={(event) =>
              apply(
                () => ({}),
                () => ({
                  finalScore: event.target.value === "" ? null : Number(event.target.value),
                }),
              )
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ourQuarters">{t("ourQuarters")}</Label>
          <Input
            id="ourQuarters"
            value={periodsText}
            onChange={(event) => {
              setPeriodsText(event.target.value);
              apply(() => ({ periods: parsePeriods(event.target.value) }));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="theirQuarters">{t("theirQuarters")}</Label>
          <Input
            id="theirQuarters"
            value={theirPeriodsText}
            onChange={(event) => {
              setTheirPeriodsText(event.target.value);
              apply(
                () => ({}),
                () => ({ periods: parsePeriods(event.target.value) }),
              );
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="roster">{t("roster")}</Label>
        <p className="text-xs text-muted-foreground">{t("rosterHint")}</p>
        <Textarea
          id="roster"
          rows={13}
          // Only from md up: below it the textarea's own 16px is what keeps iOS
          // from zooming the page on focus.
          className="font-mono md:text-xs"
          value={rosterText}
          onChange={(event) => {
            setRosterText(event.target.value);
            apply(() => ({ players: parseRoster(event.target.value) }));
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ladder">{t("ladder")}</Label>
        <p className="text-xs text-muted-foreground">{t("ladderHint")}</p>
        <Textarea
          id="ladder"
          rows={14}
          className="font-mono md:text-xs"
          value={ladderText}
          onChange={(event) => {
            setLadderText(event.target.value);
            apply(() => ({ ladder: parseLadder(event.target.value) }));
          }}
        />
      </div>
    </div>
  );
}
