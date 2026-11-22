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
import { cn } from "@/lib/utils";
import { setSquadNumbersAction } from "@/server/actions/relations";

/**
 * Who wears which shirt, for one squad.
 *
 * Opened from the team page and from a match's squad selection — the second
 * because that is where a missing number shows: a newcomer with no shirt has
 * nothing beside their name, and a referto names its scorers by shirt.
 *
 * The whole squad in one form, because two players wearing the same number is
 * a fact about the squad rather than either of them, and the place to see it
 * is with both names on screen.
 */
export function ShirtNumbersDialog({
  teamId,
  members,
}: {
  teamId: string;
  members: { id: string; name: string; jerseyNumber: number | null }[];
}) {
  const t = useTranslations("related");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { run, isPending } = useAction();

  const initial = () =>
    Object.fromEntries(
      members.map((member) => [member.id, member.jerseyNumber?.toString() ?? ""]),
    );

  const [open, setOpen] = useState(false);
  const [numbers, setNumbers] = useState<Record<string, string>>(initial);

  const parsed = members.map((member) => {
    const raw = numbers[member.id]?.trim() ?? "";
    return { athleteId: member.id, jerseyNumber: raw === "" ? null : Number(raw) };
  });
  const counts = new Map<number, number>();
  for (const { jerseyNumber } of parsed) {
    if (jerseyNumber !== null) counts.set(jerseyNumber, (counts.get(jerseyNumber) ?? 0) + 1);
  }
  const isClash = (value: number | null) => value !== null && (counts.get(value) ?? 0) > 1;
  const invalid = parsed.some(
    ({ jerseyNumber }) =>
      jerseyNumber !== null &&
      (!Number.isInteger(jerseyNumber) || jerseyNumber < 0 || jerseyNumber > 999),
  );
  const clashes = parsed.some(({ jerseyNumber }) => isClash(jerseyNumber));

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
          <DialogDescription>{t("shirtNumbersHint")}</DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {members.map((member, index) => (
            <li key={member.id} className="flex items-center gap-3 p-2.5">
              <label
                htmlFor={`shirt-${member.id}`}
                className="min-w-0 flex-1 truncate text-sm"
              >
                {member.name}
              </label>
              <Input
                id={`shirt-${member.id}`}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                className={cn(
                  "w-20 text-end tabular-nums",
                  isClash(parsed[index].jerseyNumber) &&
                    "border-destructive focus-visible:ring-destructive/40",
                )}
                value={numbers[member.id] ?? ""}
                aria-invalid={isClash(parsed[index].jerseyNumber) || undefined}
                onChange={(event) =>
                  setNumbers((current) => ({
                    ...current,
                    [member.id]: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </li>
          ))}
        </ul>

        {clashes ? <p className="text-xs text-destructive">{t("shirtClash")}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={isPending || clashes || invalid}
            onClick={() =>
              run(() => setSquadNumbersAction({ id: teamId, numbers: parsed }), {
                onSuccess: () => {
                  setOpen(false);
                  // The register and the box score read numbers off the squad.
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
