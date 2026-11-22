"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";

/**
 * The call-up message, as the coach sends it to the team's WhatsApp group.
 *
 * Built from the squad as it is ticked on screen, saved or not — the message
 * usually goes out the moment the twelve are picked. The meeting time, closing
 * note and signature are the parts a coach changes, so they are fields; the
 * note and signature are remembered in this browser, since they are the same
 * week after week.
 */

const NOTE_KEY = "call-up-message:note";
const SIGNATURE_KEY = "call-up-message:signature";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the fields still work, just unremembered.
  }
}

export interface CallUpDetails {
  /** Our side as it reads on the message: the club's name. */
  clubName: string;
  opponent: string;
  /** Null when not recorded; read as a home game. */
  isHome: boolean | null;
  startsAt: string;
  bufferBeforeMinutes: number;
  venue: { name: string; address: string | null } | null;
  /** Default signature: the signed-in coach's first name. */
  signature: string;
  timeZone: string;
}

export function CallUpMessageDialog({
  details,
  players,
}: {
  details: CallUpDetails;
  /** Called-up players in sheet order. */
  players: { firstName: string; lastName: string }[];
}) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const start = new Date(details.startsAt);
  const time = (date: Date) =>
    new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: details.timeZone,
    }).format(date);
  // A team is asked to arrive an hour early unless the booking says otherwise.
  const defaultMeet = time(
    new Date(start.getTime() - (details.bufferBeforeMinutes || 60) * 60_000),
  );

  // Away halls are rarely in the club's own list, so this is a field too.
  const defaultVenue = details.venue
    ? [details.venue.name, details.venue.address].filter(Boolean).join(" – ")
    : "";

  const [meet, setMeet] = useState(defaultMeet);
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState("");
  const [venue, setVenue] = useState(defaultVenue);

  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: details.timeZone,
  }).format(start);
  const date = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: details.timeZone,
  }).format(start);

  const fixture = details.isHome === false
    ? `${details.opponent} vs ${details.clubName}`
    : `${details.clubName} vs ${details.opponent}`;

  const message = [
    t("callUpGreeting"),
    t("callUpHeading", { date: `${weekday} ${date}` }),
    "",
    ...(meet ? [t("callUpMeetLine", { time: meet })] : []),
    t("callUpStartLine", { time: time(start) }),
    "",
    fixture,
    ...(venue.trim() ? ["", t("callUpAddress", { address: venue.trim() })] : []),
    "",
    ...players.map(
      (player) => `- ${`${player.lastName} ${player.firstName}`.trim().toLocaleUpperCase(locale)}`,
    ),
    ...(note.trim() ? ["", note.trim()] : []),
    "",
    t("callUpSignoff"),
    ...(signature.trim() ? [signature.trim()] : []),
  ].join("\n");

  async function copy() {
    store(NOTE_KEY, note);
    store(SIGNATURE_KEY, signature);
    try {
      await navigator.clipboard.writeText(message);
      toast.success(t("callUpCopied"));
    } catch {
      toast.error(t("callUpCopyFailed"));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMeet(defaultMeet);
          setVenue(defaultVenue);
          setNote(readStored(NOTE_KEY) ?? t("callUpDefaultNote"));
          setSignature(readStored(SIGNATURE_KEY) ?? details.signature);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={players.length === 0}>
          <MessageSquareText aria-hidden />
          {t("callUpButton")}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("callUpTitle")}</DialogTitle>
          <DialogDescription>{t("callUpHint")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="call-up-meet">{t("callUpMeet")}</Label>
            <Input
              id="call-up-meet"
              type="time"
              value={meet}
              onChange={(event) => setMeet(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="call-up-signature">{t("callUpSignature")}</Label>
            <Input
              id="call-up-signature"
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="call-up-venue">{t("callUpVenue")}</Label>
            <Input
              id="call-up-venue"
              value={venue}
              onChange={(event) => setVenue(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="call-up-note">{t("callUpNote")}</Label>
            <Textarea
              id="call-up-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="call-up-preview">{t("callUpPreview")}</Label>
          <Textarea
            id="call-up-preview"
            readOnly
            value={message}
            rows={Math.min(24, message.split("\n").length)}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>

        <DialogFooter>
          <Button onClick={copy}>
            <Copy aria-hidden />
            {t("callUpCopy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
