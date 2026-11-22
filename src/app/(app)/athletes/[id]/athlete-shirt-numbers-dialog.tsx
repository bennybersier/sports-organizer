"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Hash, Loader2 } from "lucide-react";

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
import { useAction } from "@/hooks/use-action";
import { setAthleteNumbersAction } from "@/server/actions/relations";

/**
 * One player's shirt in each squad they are in.
 *
 * The squad-wide dialog on the team page is where clashes are easiest to see;
 * this is for the common case of a single newcomer who needs a number. The
 * server still refuses a number a teammate already wears.
 */
export function AthleteShirtNumbersDialog({
  athleteId,
  teams,
}: {
  athleteId: string;
  teams: { id: string; name: string; jerseyNumber: number | null }[];
}) {
  const t = useTranslations("related");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { run, isPending } = useAction();

  const initial = () =>
    Object.fromEntries(teams.map((team) => [team.id, team.jerseyNumber?.toString() ?? ""]));

  const [open, setOpen] = useState(false);
  const [numbers, setNumbers] = useState<Record<string, string>>(initial);

  const parsed = teams.map((team) => {
    const raw = numbers[team.id]?.trim() ?? "";
    return { teamId: team.id, jerseyNumber: raw === "" ? null : Number(raw) };
  });
  const invalid = parsed.some(
    ({ jerseyNumber }) =>
      jerseyNumber !== null &&
      (!Number.isInteger(jerseyNumber) || jerseyNumber < 0 || jerseyNumber > 999),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening after a cancel shows what is saved, not what was abandoned.
        if (next) setNumbers(initial());
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Hash aria-hidden />
          {t("shirtNumbers")}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shirtNumbers")}</DialogTitle>
          <DialogDescription>{t("athleteShirtNumbersHint")}</DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-3 p-2.5">
              <label htmlFor={`shirt-${team.id}`} className="min-w-0 flex-1 truncate text-sm">
                {team.name}
              </label>
              <Input
                id={`shirt-${team.id}`}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                className="w-20 text-end tabular-nums"
                value={numbers[team.id] ?? ""}
                onChange={(event) =>
                  setNumbers((current) => ({
                    ...current,
                    [team.id]: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={isPending || invalid}
            onClick={() =>
              run(() => setAthleteNumbersAction({ id: athleteId, numbers: parsed }), {
                onSuccess: () => {
                  setOpen(false);
                  router.refresh();
                },
              })
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
