"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { setEntriesAction } from "@/server/actions/competitions";
import { leagueShape } from "@/domain/competitions/fixtures";

export interface EntryView {
  id: string;
  clubName: string;
  town: string | null;
  isUs: boolean;
}

/**
 * The clubs, as a block of text.
 *
 * A fixture list arrives pasted out of an email, so the input that matches it is
 * a textarea rather than a row of fields with an add button. The club's own team
 * is not in the box: it was added with the competition and removing it would
 * make home and away meaningless.
 */
export function EntriesCard({
  competitionId,
  entries,
  canEdit,
}: {
  competitionId: string;
  entries: EntryView[];
  canEdit: boolean;
}) {
  const t = useTranslations("competitions");
  const { run, isPending } = useAction();

  const ours = entries.find((entry) => entry.isUs);
  const opponents = entries.filter((entry) => !entry.isUs);

  const [text, setText] = useState(
    opponents.map((entry) => (entry.town ? `${entry.clubName} — ${entry.town}` : entry.clubName)).join("\n"),
  );

  const shape = leagueShape(entries.length);

  function save() {
    // "Club — Town" on one line, so a town can be given without tabbing into a
    // second field. Either dash, since which one you get depends on the keyboard.
    const clubs = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [clubName, town] = line.split(/\s+[—–-]\s+/);
        return { clubName: clubName.trim(), town: town?.trim() ?? "", venue: "" };
      });

    run(() => setEntriesAction({ competitionId, clubs }), {
      success: (data) => t("clubsSaved", { clubs: data.clubs }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" aria-hidden />
          {t("clubsCard")}
        </CardTitle>
        <CardDescription>
          {entries.length > 1
            ? t("shape", {
                clubs: entries.length,
                matchdays: shape.matchdays,
                home: shape.home,
                away: shape.away,
              })
            : t("noClubs")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {ours ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{ours.clubName}</Badge>
            <span className="text-muted-foreground text-xs">{t("team")}</span>
          </div>
        ) : null}

        {canEdit ? (
          <>
            <Textarea
              rows={8}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("clubsPlaceholder")}
              className="font-mono text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">{t("clubsHint")}</p>
              <Button size="sm" onClick={save} disabled={isPending}>
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t("saveClubs")}
              </Button>
            </div>
          </>
        ) : (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {opponents.map((entry) => (
              <li key={entry.id}>
                {entry.clubName}
                {entry.town ? <span className="text-muted-foreground"> · {entry.town}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
