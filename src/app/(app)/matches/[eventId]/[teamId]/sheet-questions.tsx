"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Loader2, ScanLine, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { Answer, Question } from "@/domain/referto/questions";
import type { Region, SheetRegions, SheetSide } from "@/domain/referto/transcription";

import { isPdf } from "@/domain/ai";
import { useAction } from "@/hooks/use-action";
import { readSheetAction } from "@/server/actions/matches";

import { SheetAsk } from "./sheet-ask";
import { SheetCrop, ladderRowRegion } from "./sheet-crop";

/**
 * The questions, one at a time, with the photograph beside them.
 *
 * One per screen rather than a form of twelve: each of these is a decision
 * about a different part of the paper, and the only way to answer "who scored
 * to reach 65?" is to find 65 on the sheet. A dense form invites people to
 * answer the easy ones and guess the rest.
 *
 * Three things the flow guarantees:
 *
 * - **Nothing is saved here.** Answers are applied to the caller's working copy
 *   as they are given, the reading re-derives, and the whole lot is written only
 *   when the uploader presses confirm on the page behind this.
 * - **"I don't know" is a first-class answer**, and it says what skipping costs:
 *   a skipped player is left out of the import, a skipped scorer stops the sheet
 *   reconciling altogether. A forced choice would be a guess, and a guess is the
 *   one thing the whole design is built to avoid.
 * - **Answers can be revisited.** Back moves through the list, and the dialog can
 *   be reopened from the page, because the question that makes you realise the
 *   previous answer was wrong is usually the next one.
 */
export function SheetQuestions({
  open,
  onOpenChange,
  questions,
  imageUrl,
  sheetId,
  mimeType,
  regions,
  side,
  onAnswer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: Question[];
  imageUrl: string | null;
  /** Which sheet this is, so a question about it can be asked of the model. */
  sheetId: string;
  /** How the sheet was uploaded — a PDF is shown rather than cropped. */
  mimeType: string;
  /** Where the blocks are on the photograph, so a question can point at one. */
  regions: SheetRegions | null;
  /** Which block is ours — picks the roster a player question is about. */
  side: SheetSide;
  /** Applied immediately; the caller re-derives and hands back a shorter list. */
  onAnswer: (answer: Answer) => void;
}) {
  const t = useTranslations("matches");
  const [index, setIndex] = useState(0);
  // Re-reading replaces the whole reading, so this is an ordinary action with
  // a refresh behind it — the dialog's own answers are discarded with it,
  // which is correct: they were answers about a different transcription.
  const { run: reread, isPending: isRereading } = useAction();

  /*
    Answering removes a question from the list the parent hands back, so the
    index would otherwise point past the end. Clamping here rather than tracking
    it means the dialog cannot get out of step with the queue.
  */
  const position = Math.min(index, Math.max(questions.length - 1, 0));
  const question = questions[position];

  if (!question) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("allAnswered")}</DialogTitle>
            <DialogDescription>{t("certainHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{t("finishQuestions")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  function answer(value: Answer) {
    onAnswer(value);
    // Stay on the same index: the answered question leaves the list, so the
    // next one slides into this slot.
    setIndex(position);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CircleHelp className="size-3.5" aria-hidden />
            {t("questionStep", { current: position + 1, total: questions.length })}
          </div>
          <Progress
            value={questions.length === 0 ? 100 : (position / questions.length) * 100}
            className="h-1"
          />
          <DialogTitle className="pt-2">{titleOf(question, t)}</DialogTitle>
          <DialogDescription>{bodyOf(question, t)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/*
            The paper first, and only the part being asked about.

            It was a thumbnail of the whole A4 beside the answers, which on a
            page of three-millimetre handwriting is a grey rectangle — so the
            question got answered from memory, or from the wrong column. The
            crop goes above the answers rather than beside them because the
            shapes demand it: a strip of the ladder is wide and short.
          */}
          <SheetCrop
            imageUrl={imageUrl}
            mimeType={mimeType}
            region={regionFor(question, regions, side)}
            highlight={highlightFor(question, regions)}
            className="h-36 w-full sm:h-44"
          />

          {/*
            A reading taken before the model was asked where anything was can
            only show the whole page, and at this size that is a grey
            rectangle — indistinguishable from a broken feature. Saying so was
            not enough on its own: the fix is a re-read, and a re-read was two
            screens away behind a closed dialog. So the button is here.
          */}
          {regions === null && !isPdf(mimeType) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2.5">
              <p className="min-w-40 flex-1 text-xs text-muted-foreground">
                {t("cropNoRegion")}
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={isRereading}
                onClick={() =>
                  reread(() => readSheetAction({ sheetId }), { success: () => t("checks") })
                }
              >
                {isRereading ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <ScanLine aria-hidden />
                )}
                {t("rereadNow")}
              </Button>
            </div>
          ) : null}

          <QuestionBody question={question} onAnswer={answer} />
          <SheetAsk sheetId={sheetId} situation={situationOf(question, t)} />
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={position === 0}
              onClick={() => setIndex(position - 1)}
            >
              <ArrowLeft aria-hidden />
              {t("backQuestion")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={position >= questions.length - 1}
              onClick={() => setIndex(position + 1)}
            >
              {t("nextQuestion")}
              <ArrowRight aria-hidden />
            </Button>
          </div>

          {/* The warning shows on a phone too: what skipping costs is the point. */}
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-xs text-muted-foreground">
              {skipWarningOf(question, t)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => answer(skipAnswer(question))}
            >
              {t("skipQuestion")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Translator = ReturnType<typeof useTranslations<"matches">>;

/**
 * The part of the photograph this question is about.
 *
 * Null falls back to the whole sheet, which is what happens for a reading
 * taken before the model was asked where anything was, and for a block it
 * could not locate.
 */
function regionFor(
  question: Question,
  regions: SheetRegions | null,
  side: SheetSide,
): Region | null {
  if (!regions) return null;

  switch (question.kind) {
    case "SCORER":
      return ladderRowRegion(regions.ladder, question.total);
    case "PLAYER":
      // The roster block, where the shirt number in question is written.
      return (side === "a" ? regions.rosterA : regions.rosterB) ?? null;
    case "SIDE":
      // Both rosters at once is the whole sheet, which is the right answer
      // here: the question is which half of it is ours.
      return null;
    case "OPPONENT_SCORE":
      return null;
  }
}

/**
 * The box to draw a frame around, inside the crop.
 *
 * Only the ladder has one: a rung is a single row among the nine the crop
 * shows, and pointing at it is the difference between "somewhere here" and
 * "this one". A roster block has no such sub-row worth framing — the crop is
 * already twelve lines of names.
 */
function highlightFor(
  question: Question,
  regions: SheetRegions | null,
): Region | null {
  if (!regions || question.kind !== "SCORER") return null;
  return ladderRowRegion(regions.ladder, question.total, 0);
}

/**
 * What the app is unsure about, in a sentence the model can use.
 *
 * Carried into the prompt so a three-word question — "is that a 7?" — arrives
 * with the context that makes it answerable. It is the question as asked,
 * which is also what the reader can see on screen, so there is nothing hidden
 * going to the provider that is not in front of them.
 */
function situationOf(question: Question, t: Translator): string {
  return `${titleOf(question, t)} ${bodyOf(question, t)}`;
}

function titleOf(question: Question, t: Translator): string {
  switch (question.kind) {
    case "SIDE":
      return t("qSideTitle");
    case "SCORER":
      // Unreadable and misread are different predicaments: one asks you to
      // read a number, the other tells you which number to disbelieve.
      return question.readAs === null
        ? t("qScorerTitle", { total: question.total, side: question.side.toUpperCase() })
        : t("qScorerTitleMisread", {
            total: question.total,
            side: question.side.toUpperCase(),
          });
    case "PLAYER":
      return t("qPlayerTitle", { shirt: question.shirt });
    case "OPPONENT_SCORE":
      return t("qOpponentTitle", { club: question.clubName ?? t("opponent") });
  }
}

function bodyOf(question: Question, t: Translator): string {
  switch (question.kind) {
    case "SIDE":
      /*
        Two different situations behind one question. Nothing known is a blank
        header; a conflict is the fixture and the paper disagreeing, which is a
        sharper warning and deserves to say so.
      */
      return question.conflict ? t("qSideBody") + " " + t("qSideConflictShort") : t("qSideBody");
    case "SCORER":
      return question.readAs === null
        ? t("qScorerBody", {
            worth: question.worth,
            total: question.total,
            side: question.side.toUpperCase(),
          })
        : t("qScorerBodyMisread", {
            worth: question.worth,
            total: question.total,
            side: question.side.toUpperCase(),
            readAs: question.readAs,
          });
    case "PLAYER": {
      const why =
        question.reason === "NO_NUMBER_ON_FILE"
          ? t("qPlayerNoNumber", { shirt: question.shirt })
          : t("qPlayerTwice", { shirt: question.shirt });
      /*
        Trailing full stops come off the name: a referto's Nome column is
        initials, so the surname arrives as "ROSSANO T." and the sentence
        around it ended "ROSSANO T..".
      */
      const onSheet = question.nameOnSheet
        ? ` ${t("qPlayerOnSheet", { name: question.nameOnSheet.replace(/\.+$/, "") })}`
        : "";
      return `${why}${onSheet} ${t("qPlayerPoints", { points: question.points })}`;
    }
    case "OPPONENT_SCORE":
      return question.suggestion !== null
        ? `${t("qOpponentBody")} ${t("qOpponentSuggestion", { suggestion: question.suggestion })}`
        : t("qOpponentBody");
  }
}

function skipWarningOf(question: Question, t: Translator): string {
  switch (question.kind) {
    case "SIDE":
      return "";
    case "SCORER":
      return t("qScorerSkipWarning");
    case "PLAYER":
      return t("qPlayerSkipWarning");
    case "OPPONENT_SCORE":
      return t("qOpponentSkipWarning");
  }
}

/**
 * The squad, searchable.
 *
 * A dozen buttons is a list you read; a full squad is a list you scroll past,
 * and the name you want is the one below the fold. Typing filters on both the
 * name and the number on file, because a secretary who knows the squad thinks
 * in numbers and one who does not thinks in names.
 */
function PlayerOptions({
  question,
  onAnswer,
}: {
  question: Extract<Question, { kind: "PLAYER" }>;
  onAnswer: (answer: Answer) => void;
}) {
  const t = useTranslations("matches");
  const [term, setTerm] = useState("");

  const needle = term.trim().toLowerCase();
  const shown = needle
    ? question.options.filter(
        (option) =>
          option.name.toLowerCase().includes(needle) ||
          String(option.jerseyNumber ?? "").includes(needle),
      )
    : question.options;

  return (
    <div className="space-y-2">
      {question.options.length > 6 ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("qPlayerSearch")}
            aria-label={t("qPlayerSearch")}
            className="pl-8"
          />
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t("qPlayerNoMatch")}</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((option) => (
            <Button
              key={option.athleteId}
              variant="outline"
              className="w-full justify-start font-normal"
              onClick={() =>
                onAnswer({
                  kind: "PLAYER",
                  shirt: question.shirt,
                  athleteId: option.athleteId,
                })
              }
            >
              {option.jerseyNumber !== null ? (
                <Badge variant="secondary" className="me-2 tabular-nums">
                  {option.jerseyNumber}
                </Badge>
              ) : null}
              <span className="truncate">{option.name}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What "I don't know" means for each kind — never a guess. */
function skipAnswer(question: Question): Answer {
  switch (question.kind) {
    case "SIDE":
      // Squadra A is the home side and the more likely photograph, and this is
      // the one question where leaving it unset is not an option: some side has
      // to be read. The page still shows which was chosen.
      return { kind: "SIDE", side: "a" };
    case "SCORER":
      return { kind: "SCORER", ladderIndex: question.ladderIndex, shirt: null };
    case "PLAYER":
      return { kind: "PLAYER", shirt: question.shirt, athleteId: null };
    case "OPPONENT_SCORE":
      return { kind: "OPPONENT_SCORE", score: null };
  }
}

function QuestionBody({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (answer: Answer) => void;
}) {
  const t = useTranslations("matches");
  const [score, setScore] = useState(
    question.kind === "OPPONENT_SCORE" ? (question.suggestion?.toString() ?? "") : "",
  );
  /** A shirt number, or part of a name, typed rather than chosen. */
  const [typed, setTyped] = useState("");

  switch (question.kind) {
    case "SIDE":
      return (
        <RadioGroup
          onValueChange={(value) => onAnswer({ kind: "SIDE", side: value as "a" | "b" })}
          className="gap-3"
        >
          {question.options.map((option) => (
            <Label
              key={option.side}
              className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal hover:bg-muted/50"
            >
              <RadioGroupItem value={option.side} />
              <span>
                {t("qSideOption", {
                  club: option.clubName ?? t("qSideUnknown"),
                  players: option.players,
                  points: option.points,
                })}
              </span>
            </Label>
          ))}
        </RadioGroup>
      );

    case "SCORER":
      return (
        <div className="space-y-4">
          {/*
            A grid of bare numbers does not say what the numbers are. They are
            shirt numbers, not totals, not points — and both of those are also
            numbers on this sheet.
          */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t("qScorerPick")}</p>
            <div className="flex flex-wrap gap-2">
              {question.options.map((shirt) => (
                <Button
                  key={shirt}
                  variant="outline"
                  className="h-11 w-14 text-base tabular-nums"
                  onClick={() =>
                    onAnswer({ kind: "SCORER", ladderIndex: question.ladderIndex, shirt })
                  }
                >
                  {shirt}
                </Button>
              ))}
            </div>
          </div>

          {/*
            And a box to type one in.

            The buttons are the shirts the roster says took part, which is the
            right shortlist and not always the right list: the roster line
            itself may have been misread. Whoever is holding the paper can see
            a number the reading never did, and refusing it would make them
            correct the roster first to answer a question about the ladder.
          */}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const shirt = Number.parseInt(typed, 10);
              if (!Number.isFinite(shirt) || shirt < 0) return;
              onAnswer({ kind: "SCORER", ladderIndex: question.ladderIndex, shirt });
              setTyped("");
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="scorer-other" className="text-xs font-normal text-muted-foreground">
                {t("qScorerOther")}
              </Label>
              <Input
                id="scorer-other"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className="w-24 tabular-nums"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={typed.trim() === ""}>
              <Check aria-hidden />
              {t("qUse")}
            </Button>
          </form>

          {/*
            The way out when the basket is not ours. Without it the only
            answers are a shirt number, which invents a scorer, and "I don't
            know", which leaves a basket nobody scored and stops the sheet
            reconciling for good.
          */}
          <div className="space-y-1 border-t pt-3">
            {/*
              An outline button, not a ghost one. As quiet text under a row of
              numbered buttons it read as a caption, and the one question where
              it is the right answer is the one where nothing else can be — so
              it has to look like something you can press.
            */}
            <Button
              variant="outline"
              size="sm"
              className="h-auto py-2 text-left font-normal"
              onClick={() =>
                onAnswer({
                  kind: "SCORER",
                  ladderIndex: question.ladderIndex,
                  shirt: null,
                  remove: true,
                })
              }
            >
              {t("qScorerAbsent")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("qScorerAbsentHint", {
                total: question.total,
                side: question.side.toUpperCase(),
              })}
            </p>
          </div>
        </div>
      );

    case "PLAYER":
      return question.options.length === 0 ? (
        <Alert>
          <AlertDescription>{t("qPlayerSkipWarning")}</AlertDescription>
        </Alert>
      ) : (
        <PlayerOptions question={question} onAnswer={onAnswer} />
      );

    case "OPPONENT_SCORE":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            inputMode="numeric"
            aria-label={t("theirScore")}
            className="w-24 text-center text-lg tabular-nums"
            value={score}
            onChange={(event) => setScore(event.target.value.replace(/\D/g, ""))}
          />
          <Button
            disabled={score === ""}
            onClick={() => onAnswer({ kind: "OPPONENT_SCORE", score: Number(score) })}
          >
            {t("nextQuestion")}
          </Button>
        </div>
      );
  }
}
