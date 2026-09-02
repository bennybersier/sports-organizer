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
import { createEventAction, updateEventAction } from "@/server/actions/calendar";

const TYPES = [
  "MATCH",
  "TOURNAMENT",
  "HOLIDAY",
  "BLACKOUT",
  "SPECIAL_EVENT",
  "MEETING",
] as const;

export interface EventFormValues {
  id: string;
  seasonId: string | null;
  type: string;
  title: string;
  gymId: string | null;
  trainerId: string | null;
  teamIds: string[];
  startAt: string;
  endAt: string;
  allDay: boolean;
  allowsGymSharing: boolean;
  blocksScheduling: boolean;
}

export interface EventDialogOptions {
  seasons: MultiSelectOption[];
  gyms: MultiSelectOption[];
  trainers: MultiSelectOption[];
  teams: MultiSelectOption[];
}

/**
 * Manual events, created and edited.
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
  event,
  open: controlledOpen,
  onOpenChange,
}: EventDialogOptions & {
  /** Present when editing an existing event. */
  event?: EventFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations("calendar");
  const tCommon = useTranslations("common");
  const isEdit = event !== undefined;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An existing event's instants are split back into the date and times the
  // form works in, using the browser's zone — the same one the inputs use.
  const local = (iso: string) => {
    const value = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
    };
  };

  const [type, setType] = useState<(typeof TYPES)[number]>(
    (event?.type as (typeof TYPES)[number]) ?? "MATCH",
  );
  const [title, setTitle] = useState(event?.title ?? "");
  const [seasonId, setSeasonId] = useState(event?.seasonId ?? seasons[0]?.value ?? "");
  const [gymId, setGymId] = useState(event?.gymId ?? "");
  const [trainerId, setTrainerId] = useState(event?.trainerId ?? "");
  const [teamIds, setTeamIds] = useState<string[]>(event?.teamIds ?? []);
  const [date, setDate] = useState(event ? local(event.startAt).date : "");
  const [start, setStart] = useState(event ? local(event.startAt).time : "18:00");
  const [end, setEnd] = useState(event ? local(event.endAt).time : "20:00");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [sharing, setSharing] = useState(event?.allowsGymSharing ?? false);
  const [blocking, setBlocking] = useState(event?.blocksScheduling ?? false);

  const [open, setOpen] = useFormDialog({
    open: controlledOpen,
    onOpenChange,
    onOpen: () => {
      if (isEdit) return;
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

    const payload = {
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
    };

    const result = isEdit
      ? await updateEventAction({ ...payload, id: event.id })
      : await createEventAction(payload);

    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    toast.success(
      isEdit
        ? t("updated", { title: result.data.title })
        : t("created", { title: result.data.title }),
    );
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isEdit ? null : (
        <DialogTrigger asChild>
          <Button>
            <Plus aria-hidden />
            {t("newEvent")}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editEvent") : t("newEvent")}</DialogTitle>
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
              isEdit ? t("saveEvent") : t("createEvent")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
