"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, CircleHelp } from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Answer, Question } from "@/domain/referto/questions";

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
  onAnswer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: Question[];
  imageUrl: string | null;
  /** Applied immediately; the caller re-derives and hands back a shorter list. */
  onAnswer: (answer: Answer) => void;
}) {
  const t = useTranslations("matches");
  const [index, setIndex] = useState(0);

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

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <ScrollArea className="max-h-72 pe-3">
            <QuestionBody question={question} onAnswer={answer} />
          </ScrollArea>

          {imageUrl ? (
            /*
              The paper, in the dialog. Answering "who scored to reach 65?"
              means finding 65 on the sheet, and a person who has to close the
              dialog to look will answer from memory instead.
              eslint-disable-next-line @next/next/no-img-element
            */
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden shrink-0 sm:block"
              title={t("openFullSize")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                className="h-40 w-28 rounded-md border object-cover transition-opacity hover:opacity-80"
              />
            </a>
          ) : null}
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

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {skipWarningOf(question, t)}
            </span>
            <Button variant="outline" size="sm" onClick={() => answer(skipAnswer(question))}>
              {t("skipQuestion")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Translator = ReturnType<typeof useTranslations<"matches">>;

function titleOf(question: Question, t: Translator): string {
  switch (question.kind) {
    case "SIDE":
      return t("qSideTitle");
    case "SCORER":
      return t("qScorerTitle", { total: question.total });
    case "PLAYER":
      return t("qPlayerTitle", { shirt: question.shirt });
    case "OPPONENT_SCORE":
      return t("qOpponentTitle", { club: question.clubName ?? t("opponent") });
  }
}

function bodyOf(question: Question, t: Translator): string {
  switch (question.kind) {
    case "SIDE":
      return t("qSideBody");
    case "SCORER":
      return t("qScorerBody", { worth: question.worth });
    case "PLAYER": {
      const why =
        question.reason === "NO_NUMBER_ON_FILE"
          ? t("qPlayerNoNumber", { shirt: question.shirt })
          : t("qPlayerTwice", { shirt: question.shirt });
      const onSheet = question.nameOnSheet
        ? ` ${t("qPlayerOnSheet", { name: question.nameOnSheet })}`
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
      );

    case "PLAYER":
      return question.options.length === 0 ? (
        <Alert>
          <AlertDescription>{t("qPlayerSkipWarning")}</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-1.5">
          {question.options.map((option) => (
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
              {option.name}
            </Button>
          ))}
        </div>
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
