"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { useFormDialog } from "@/hooks/use-form-dialog";
import { createEventAction } from "@/server/actions/calendar";

const TYPES = [
  "MATCH",
  "TOURNAMENT",
  "HOLIDAY",
  "BLACKOUT",
  "SPECIAL_EVENT",
  "MEETING",
] as const;

/**
 * Manual event creation.
 *
 * Deliberately not for training: training belongs to a schedule version and is
 * created by the organizer workflow. This covers everything else a club puts on
 * a calendar — including the in-house events that are the one legitimate reason
 * several teams share a hall.
 */
export function NewEventButton({
  seasons,
  gyms,
  trainers,
  teams,
}: {
  seasons: MultiSelectOption[];
  gyms: MultiSelectOption[];
  trainers: MultiSelectOption[];
  teams: MultiSelectOption[];
}) {
  const router = useRouter();
  const t = useTranslations("calendar");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<(typeof TYPES)[number]>("MATCH");
  const [title, setTitle] = useState("");
  const [seasonId, setSeasonId] = useState(seasons[0]?.value ?? "");
  const [gymId, setGymId] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [allDay, setAllDay] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const [open, setOpen] = useFormDialog({
    onOpen: () => {
      setError(null);
      setType("MATCH");
      setTitle("");
      setSeasonId(seasons[0]?.value ?? "");
      setGymId("");
      setTrainerId("");
      setTeamIds([]);
      setDate("");
      setStart("18:00");
      setEnd("20:00");
      setAllDay(false);
      setSharing(false);
      setBlocking(false);
    },
  });

  async function submit() {
    setError(null);
    setPending(true);

    // Sent as instants with the browser's offset; the server re-reads them in
    // the club's timezone, which is what actually governs scheduling.
    const toIso = (time: string) => new Date(`${date}T${time}:00`).toISOString();

    const result = await createEventAction({
      seasonId,
      type,
      title,
      gymId,
      trainerId,
      teamIds,
      startAt: allDay ? toIso("00:00") : toIso(start),
      endAt: allDay ? toIso("23:59") : toIso(end),
      allDay,
      allowsGymSharing: sharing,
      blocksScheduling: blocking,
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    toast.success(t("created", { title: result.data.title }));
    setOpen(false);
    setTitle("");
    setDate("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {t("newEvent")}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newEvent")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4">
            <div className="grid gap-1">
              <Label htmlFor="event-title">{t("eventTitle")}</Label>
              <Input
                id="event-title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="event-type">{t("eventType")}</Label>
                <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                  <SelectTrigger id="event-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1">
                <Label htmlFor="event-date">{t("starts")}</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="event-allday"
                checked={allDay}
                onCheckedChange={(value) => setAllDay(value === true)}
              />
              <Label htmlFor="event-allday" className="font-normal">
                {t("allDay")}
              </Label>
            </div>

            {!allDay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="event-start">{t("starts")}</Label>
                  <Input
                    id="event-start"
                    type="time"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="event-end">{t("ends")}</Label>
                  <Input
                    id="event-end"
                    type="time"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </div>
              </div>
            ) : null}

            {seasons.length > 1 ? (
              <div className="grid gap-1">
                <Label htmlFor="event-season">{tCommon("season")}</Label>
                <Select value={seasonId} onValueChange={setSeasonId}>
                  <SelectTrigger id="event-season">
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
            ) : null}

            {gyms.length > 0 ? (
              <div className="grid gap-1">
                <Label htmlFor="event-gym">{t("gym")}</Label>
                <Select value={gymId || "none"} onValueChange={(v) => setGymId(v === "none" ? "" : v)}>
                  <SelectTrigger id="event-gym">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noGym")}</SelectItem>
                    {gyms.map((gym) => (
                      <SelectItem key={gym.value} value={gym.value}>
                        {gym.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {trainers.length > 0 ? (
              <div className="grid gap-1">
                <Label htmlFor="event-trainer">{t("trainer")}</Label>
                <Select
                  value={trainerId || "none"}
                  onValueChange={(value) => setTrainerId(value === "none" ? "" : value)}
                >
                  <SelectTrigger id="event-trainer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tCommon("none")}</SelectItem>
                    {trainers.map((trainer) => (
                      <SelectItem key={trainer.value} value={trainer.value}>
                        {trainer.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {teams.length > 0 ? (
              <div className="grid gap-1">
                <Label>{t("teams")}</Label>
                <MultiSelect
                  options={teams}
                  value={teamIds}
                  onChange={setTeamIds}
                  placeholder={t("teams")}
                  emptyText={tCommon("none")}
                />
              </div>
            ) : null}

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="event-sharing"
                  checked={sharing}
                  onCheckedChange={(value) => setSharing(value === true)}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="event-sharing" className="font-normal">
                    {t("allowsGymSharing")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("allowsGymSharingHint")}</p>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="event-blocking"
                  checked={blocking}
                  onCheckedChange={(value) => setBlocking(value === true)}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="event-blocking" className="font-normal">
                    {t("blocksScheduling")}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t("blocksSchedulingHint")}</p>
                </div>
              </div>
            </div>
          </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !title || !date}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                {tCommon("saving")}
              </>
            ) : (
              t("createEvent")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
