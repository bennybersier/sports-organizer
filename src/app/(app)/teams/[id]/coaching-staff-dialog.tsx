"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { setTeamTrainersAction } from "@/server/actions/relations";

/**
 * Who coaches this side, and which of them leads it.
 *
 * One dialog rather than two, because "these are the coaches and this one is
 * head" is a single decision. Split into a staff list and a separate promotion
 * step, a team can briefly have a head coach who is no longer on its staff —
 * and the database, which allows exactly one head per team, would be the thing
 * that found out.
 *
 * The role belongs to the assignment, not to the person: the same coach heads
 * the U13 and assists on the U15, which is how a club with more teams than
 * staff actually works. So this is asked here, per team, and never on the
 * coach's own record.
 */
export function CoachingStaffDialog({
  teamId,
  trainers,
  selected,
  headCoachId,
}: {
  teamId: string;
  trainers: { id: string; name: string }[];
  selected: string[];
  headCoachId: string | null;
}) {
  const t = useTranslations("related");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();

  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<string[]>(selected);
  const [head, setHead] = useState<string | null>(headCoachId);

  function toggle(trainerId: string) {
    setStaff((current) => {
      const next = current.includes(trainerId)
        ? current.filter((id) => id !== trainerId)
        : [...current, trainerId];
      // Dropping someone from the staff cannot leave them leading it.
      if (!next.includes(trainerId) && head === trainerId) setHead(null);
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening after a cancel should show what is saved, not the
        // half-made decision that was abandoned.
        if (next) {
          setStaff(selected);
          setHead(headCoachId);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("manageStaff")}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("trainers")}</DialogTitle>
          <DialogDescription>{t("headCoachHint")}</DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {trainers.map((trainer) => {
            const onStaff = staff.includes(trainer.id);
            const isHead = head === trainer.id;
            return (
              <li key={trainer.id} className="flex items-center gap-3 p-3">
                <Checkbox
                  id={`coach-${trainer.id}`}
                  checked={onStaff}
                  onCheckedChange={() => toggle(trainer.id)}
                />
                <label
                  htmlFor={`coach-${trainer.id}`}
                  className="min-w-0 flex-1 cursor-pointer truncate text-sm"
                >
                  {trainer.name}
                </label>

                {/* Only a coach on the staff can lead it. */}
                <Button
                  type="button"
                  size="sm"
                  variant={isHead ? "default" : "outline"}
                  disabled={!onStaff}
                  aria-pressed={isHead}
                  onClick={() => setHead(isHead ? null : trainer.id)}
                >
                  <Star className={cn("size-3.5", isHead && "fill-current")} aria-hidden />
                  {isHead ? t("headCoach") : t("makeHeadCoach")}
                </Button>
              </li>
            );
          })}
        </ul>

        {staff.length > 0 && !head ? (
          <p className="text-xs text-muted-foreground">{t("noHeadCoach")}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  setTeamTrainersAction({
                    id: teamId,
                    relatedIds: staff,
                    headCoachId: head ?? "",
                  }),
                { onSuccess: () => setOpen(false) },
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
