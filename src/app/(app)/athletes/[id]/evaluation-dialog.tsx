"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { saveEvaluationAction } from "@/server/actions/attendance";

/**
 * The coach's read on a player, for a period.
 *
 * Four axes because that is the rubric Italian coaching already uses — tecnica,
 * tattica, fisico, atteggiamento — so nobody has to be taught it, and five
 * points because a coach who is offered ten will use three of them.
 *
 * Per period rather than per session. A coach asked to rate sixteen players
 * after every training rates nobody after the third week; asked four times a
 * year they will, and four honest points make a better curve than ninety
 * abandoned ones.
 */

const AXES = ["technique", "tactical", "physical", "attitude"] as const;
type Axis = (typeof AXES)[number];

export function EvaluationDialog({
  athleteId,
  teams,
  defaultPeriod,
}: {
  athleteId: string;
  teams: { id: string; name: string }[];
  defaultPeriod: { start: string; end: string };
}) {
  const t = useTranslations("attendance.evaluation");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();

  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);
  const [scores, setScores] = useState<Record<Axis, number | null>>({
    technique: null,
    tactical: null,
    physical: null,
    attitude: null,
  });
  const [strengths, setStrengths] = useState("");
  const [development, setDevelopment] = useState("");

  // Mirrors evaluations_not_empty: a row that scores nothing and says nothing
  // is not an assessment.
  const empty =
    AXES.every((axis) => scores[axis] === null) && !strengths.trim() && !development.trim();

  if (teams.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SquarePen aria-hidden />
          {t("write")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("help")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {teams.length > 1 ? (
            <div className="space-y-1.5">
              <Label>{t("team")}</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period-start">{t("periodStart")}</Label>
              <Input
                id="period-start"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-end">{t("periodEnd")}</Label>
              <Input
                id="period-end"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            {AXES.map((axis) => (
              <div key={axis} className="flex items-center justify-between gap-3">
                <Label className="text-sm font-normal">{t(axis)}</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <Button
                      key={score}
                      type="button"
                      size="icon"
                      variant={scores[axis] === score ? "default" : "outline"}
                      aria-pressed={scores[axis] === score}
                      aria-label={`${t(axis)} ${score}`}
                      className={cn("size-8 text-xs tabular-nums")}
                      onClick={() =>
                        setScores((current) => ({
                          ...current,
                          // Tapping the same score again clears it, so a coach
                          // can leave an axis unanswered rather than guessing.
                          [axis]: current[axis] === score ? null : score,
                        }))
                      }
                    >
                      {score}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="strengths">{t("strengths")}</Label>
            <Textarea
              id="strengths"
              rows={2}
              value={strengths}
              onChange={(event) => setStrengths(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="development">{t("development")}</Label>
            <Textarea
              id="development"
              rows={2}
              value={development}
              onChange={(event) => setDevelopment(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={isPending || empty || !teamId || periodEnd < periodStart}
            onClick={() =>
              run(
                () =>
                  saveEvaluationAction({
                    athleteId,
                    teamId,
                    periodStart,
                    periodEnd,
                    technique: scores.technique,
                    tactical: scores.tactical,
                    physical: scores.physical,
                    attitude: scores.attitude,
                    strengths: strengths || undefined,
                    development: development || undefined,
                  }),
                {
                  success: () => t("saved"),
                  onSuccess: () => setOpen(false),
                },
              )
            }
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
