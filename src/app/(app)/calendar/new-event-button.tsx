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
import { toInstant, toWallClock } from "@/domain/scheduling/timezone";
import { fromMinutes, toMinutes } from "@/domain/availability";
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

/** Opponent, home/away and competition only mean anything on these. */
const FIXTURE_TYPES = new Set(["MATCH", "TOURNAMENT"]);

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
  opponent: string | null;
  isHome: boolean | null;
  competition: string | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

export interface EventDialogOptions {
  seasons: MultiSelectOption[];
  gyms: MultiSelectOption[];
  trainers: MultiSelectOption[];
  teams: MultiSelectOption[];
  /**
   * The club's scheduling timezone.
   *
   * Load-bearing, not cosmetic: what a coach types here decides which date a
   * fixture falls on, and a fixture's date decides which training disappears.
   * Reading the browser's zone instead would move a late Saturday game to
   * Sunday for anyone travelling, and take the wrong session with it.
   */
  timeZone: string;
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
  timeZone,
  event,
  defaultDate,
  defaultTeamIds,
  open: controlledOpen,
  onOpenChange,
}: EventDialogOptions & {
  /** Present when editing an existing event. */
  event?: EventFormValues;
  /**
   * The day a "+" was pressed on, as a club-local `YYYY-MM-DD`. Prefilling it
   * is the whole point of the per-day buttons: the date is the one thing the
   * click already said.
   */
  defaultDate?: string;
  /** Preselected squads — the team page knows which team you are looking at. */
  defaultTeamIds?: string[];
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
  // The club's wall clock, not this laptop's.
  const local = (iso: string) => {
    const wall = toWallClock(iso, timeZone);
    return { date: wall.date, time: fromMinutes(wall.minutes) };
  };

  const [type, setType] = useState<(typeof TYPES)[number]>(
    (event?.type as (typeof TYPES)[number]) ?? "MATCH",
  );
  const [title, setTitle] = useState(event?.title ?? "");
  const [seasonId, setSeasonId] = useState(event?.seasonId ?? seasons[0]?.value ?? "");
  const [gymId, setGymId] = useState(event?.gymId ?? "");
  const [trainerId, setTrainerId] = useState(event?.trainerId ?? "");
  const [teamIds, setTeamIds] = useState<string[]>(event?.teamIds ?? defaultTeamIds ?? []);
  const [date, setDate] = useState(event ? local(event.startAt).date : (defaultDate ?? ""));
  const [start, setStart] = useState(event ? local(event.startAt).time : "18:00");
  const [end, setEnd] = useState(event ? local(event.endAt).time : "20:00");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [sharing, setSharing] = useState(event?.allowsGymSharing ?? false);
  const [blocking, setBlocking] = useState(event?.blocksScheduling ?? false);
  const [opponent, setOpponent] = useState(event?.opponent ?? "");
  const [homeAway, setHomeAway] = useState<"" | "home" | "away">(
    event?.isHome === true ? "home" : event?.isHome === false ? "away" : "",
  );
  const [competition, setCompetition] = useState(event?.competition ?? "");
  const [bufferBefore, setBufferBefore] = useState(event?.bufferBeforeMinutes ?? 0);
  const [bufferAfter, setBufferAfter] = useState(event?.bufferAfterMinutes ?? 0);

  const isFixture = FIXTURE_TYPES.has(type);

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
      setTeamIds(defaultTeamIds ?? []);
      setDate(defaultDate ?? "");
      setStart("18:00");
      setEnd("20:00");
      setAllDay(false);
      setSharing(false);
      setBlocking(false);
      setOpponent("");
      setHomeAway("");
      setCompetition("");
      setBufferBefore(0);
      setBufferAfter(0);
    },
  });

  async function submit() {
    setError(null);
    setPending(true);

    // Read in the club's timezone, which is what governs scheduling. 18:00
    // means six in the evening in Codogno wherever the person typing it is.
    const toIso = (time: string) => toInstant(date, toMinutes(time), timeZone).toISOString();

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
      opponent: isFixture ? opponent : "",
      isHome: isFixture ? homeAway : "",
      competition: isFixture ? competition : "",
      // An all-day event already holds the whole day; the database refuses a
      // buffer on one.
      bufferBeforeMinutes: allDay ? 0 : bufferBefore,
      bufferAfterMinutes: allDay ? 0 : bufferAfter,
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
      {/*
        Editing, and the per-day "+" buttons, both open this from outside — the
        built-in trigger is only for the page header's own button.
      */}
      {isEdit || controlledOpen !== undefined ? null : (
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

            {isFixture ? (
              <div className="grid gap-4 rounded-lg border p-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="event-opponent">{t("opponent")}</Label>
                    <Input
                      id="event-opponent"
                      value={opponent}
                      onChange={(e) => setOpponent(e.target.value)}
                      placeholder={t("opponentPlaceholder")}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="event-homeaway">{t("homeAway")}</Label>
                    <Select
                      value={homeAway || "unset"}
                      onValueChange={(value) =>
                        setHomeAway(value === "unset" ? "" : (value as "home" | "away"))
                      }
                    >
                      <SelectTrigger id="event-homeaway">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Neither, for a derby between two of our own teams. */}
                        <SelectItem value="unset">{t("inHouse")}</SelectItem>
                        <SelectItem value="home">{t("home")}</SelectItem>
                        <SelectItem value="away">{t("away")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="event-competition">{t("competition")}</Label>
                  <Input
                    id="event-competition"
                    value={competition}
                    onChange={(e) => setCompetition(e.target.value)}
                    placeholder={t("competitionPlaceholder")}
                  />
                </div>
              </div>
            ) : null}

            {!allDay ? (
              <div className="grid gap-2 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label>{t("hallHeld")}</Label>
                  <p className="text-muted-foreground text-xs">{t("hallHeldHint")}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="event-buffer-before" className="text-xs font-normal">
                      {t("bufferBefore")}
                    </Label>
                    <Input
                      id="event-buffer-before"
                      type="number"
                      min={0}
                      max={240}
                      step={15}
                      value={bufferBefore}
                      onChange={(e) => setBufferBefore(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="event-buffer-after" className="text-xs font-normal">
                      {t("bufferAfter")}
                    </Label>
                    <Input
                      id="event-buffer-after"
                      type="number"
                      min={0}
                      max={240}
                      step={15}
                      value={bufferAfter}
                      onChange={(e) => setBufferAfter(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

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
