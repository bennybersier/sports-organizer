"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

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
import type { MultiSelectOption } from "@/components/data/multi-select";
import { useFormDialog } from "@/hooks/use-form-dialog";
import { useAction } from "@/hooks/use-action";
import { createCompetitionAction, updateCompetitionAction } from "@/server/actions/competitions";

const FORMATS = ["LEAGUE", "CONCENTRATION"] as const;
const PHASES = ["SINGLE", "GROUP", "GOLD", "SILVER", "BRONZE", "PLAYOFF"] as const;

export interface CompetitionFormValues {
  id?: string;
  seasonId: string;
  teamId: string;
  name: string;
  format: string;
  phase: string;
  parentId: string | null;
  expectedClubs: number | null;
  homeBufferBeforeMinutes: number;
  homeBufferAfterMinutes: number;
  notes: string | null;
}

export function CompetitionFormDialog({
  mode,
  competition,
  seasons,
  teams,
  defaultSeasonId,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  competition?: CompetitionFormValues;
  seasons: MultiSelectOption[];
  teams: MultiSelectOption[];
  defaultSeasonId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("competitions");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { run, isPending } = useAction();

  const blank = {
    seasonId: defaultSeasonId ?? seasons[0]?.value ?? "",
    teamId: "",
    name: "",
    format: "LEAGUE",
    phase: "SINGLE",
    expectedClubs: "",
    // A senior fixture needs an hour and a half of setup; the club can lower it
    // for a minibasket concentration rather than raise it for every match.
    before: "60",
    after: "30",
    notes: "",
  };

  const [values, setValues] = useState(
    competition
      ? {
          seasonId: competition.seasonId,
          teamId: competition.teamId,
          name: competition.name,
          format: competition.format,
          phase: competition.phase,
          expectedClubs: competition.expectedClubs ? String(competition.expectedClubs) : "",
          before: String(competition.homeBufferBeforeMinutes),
          after: String(competition.homeBufferAfterMinutes),
          notes: competition.notes ?? "",
        }
      : blank,
  );

  const [open, setOpen] = useFormDialog({
    open: controlledOpen,
    onOpenChange,
    onOpen: () => {
      if (mode === "create") setValues(blank);
    },
  });

  const set = (key: keyof typeof blank, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  function submit() {
    const payload = {
      ...(mode === "edit" ? { id: competition?.id } : {}),
      seasonId: values.seasonId,
      teamId: values.teamId,
      name: values.name,
      format: values.format,
      phase: values.phase,
      parentId: competition?.parentId ?? "",
      expectedClubs: values.expectedClubs,
      homeBufferBeforeMinutes: values.before,
      homeBufferAfterMinutes: values.after,
      notes: values.notes,
    };

    run(
      () =>
        mode === "create" ? createCompetitionAction(payload) : updateCompetitionAction(payload),
      {
        success: (data) => t(mode === "create" ? "created" : "updated", { name: data.name }),
        onSuccess: (data) => {
          setOpen(false);
          if (mode === "create") router.push(`/competitions/${data.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus aria-hidden />
            {t("new")}
          </Button>
        </DialogTrigger>
      ) : null}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(mode === "create" ? "new" : "edit")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label htmlFor="competition-name">{t("name")}</Label>
            <Input
              id="competition-name"
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="competition-team">{t("team")}</Label>
              <Select value={values.teamId} onValueChange={(value) => set("teamId", value)}>
                <SelectTrigger id="competition-team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.value} value={team.value}>
                      {team.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="competition-season">{tCommon("season")}</Label>
              <Select value={values.seasonId} onValueChange={(value) => set("seasonId", value)}>
                <SelectTrigger id="competition-season">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {seasons.map((season) => (
                    <SelectItem key={season.value} value={season.value}>
                      {season.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="competition-format">{t("format")}</Label>
              <Select value={values.format} onValueChange={(value) => set("format", value)}>
                <SelectTrigger id="competition-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((format) => (
                    <SelectItem key={format} value={format}>
                      {t(format)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="competition-phase">{t("phase")}</Label>
              <Select value={values.phase} onValueChange={(value) => set("phase", value)}>
                <SelectTrigger id="competition-phase">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHASES.map((phase) => (
                    <SelectItem key={phase} value={phase}>
                      {t(phase)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Only meaningful before a draw, which is when a phase is declared. */}
          {values.phase !== "SINGLE" ? (
            <div className="grid gap-1">
              <Label htmlFor="competition-expected">{t("expectedClubs")}</Label>
              <Input
                id="competition-expected"
                type="number"
                min={2}
                max={40}
                className="sm:max-w-32"
                value={values.expectedClubs}
                onChange={(event) => set("expectedClubs", event.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t("expectedClubsHint")}</p>
            </div>
          ) : null}

          <div className="grid gap-2 rounded-lg border p-3">
            <Label>{t("homeBuffers")}</Label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="competition-before" className="text-xs font-normal">
                  {t("bufferBefore")}
                </Label>
                <Input
                  id="competition-before"
                  type="number"
                  min={0}
                  max={240}
                  step={15}
                  value={values.before}
                  onChange={(event) => set("before", event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="competition-after" className="text-xs font-normal">
                  {t("bufferAfter")}
                </Label>
                <Input
                  id="competition-after"
                  type="number"
                  min={0}
                  max={240}
                  step={15}
                  value={values.after}
                  onChange={(event) => set("after", event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="competition-notes">{tCommon("notes")}</Label>
            <Textarea
              id="competition-notes"
              rows={2}
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={submit} disabled={isPending || !values.name || !values.teamId}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tCommon(mode === "create" ? "create" : "save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
