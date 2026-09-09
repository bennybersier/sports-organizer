"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save, Sigma } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { saveBoxScoresAction } from "@/server/actions/attendance";
import type { RegisterLine } from "@/server/services/attendance-service";
import type { MatchBoxScoreRow } from "@/types/database";

/**
 * The scoresheet, typed up afterwards.
 *
 * A wide grid rather than a form per player, because it is copied from a piece
 * of paper that is itself a wide grid — whoever is entering it is reading
 * across a row, and anything that made them open twelve dialogs would guarantee
 * the job stops being done in November.
 *
 * Points and valutazione are shown live but never sent: they are generated
 * columns, computed by the database from the shots they are made of, so there
 * is nothing here that can disagree with them.
 */

interface Column {
  key: keyof Line;
  labelKey:
    | "min" | "twoPointMade" | "twoPointAttempted" | "threePointMade" | "threePointAttempted"
    | "freeThrowMade" | "freeThrowAttempted" | "offensiveRebounds" | "defensiveRebounds"
    | "assists" | "steals" | "blocks" | "turnovers" | "foulsCommitted" | "foulsDrawn";
}

interface Line {
  athleteId: string;
  min: number;
  twoPointMade: number;
  twoPointAttempted: number;
  threePointMade: number;
  threePointAttempted: number;
  freeThrowMade: number;
  freeThrowAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  foulsCommitted: number;
  foulsDrawn: number;
}

const COLUMNS: Column[] = [
  { key: "min", labelKey: "min" },
  { key: "twoPointMade", labelKey: "twoPointMade" },
  { key: "twoPointAttempted", labelKey: "twoPointAttempted" },
  { key: "threePointMade", labelKey: "threePointMade" },
  { key: "threePointAttempted", labelKey: "threePointAttempted" },
  { key: "freeThrowMade", labelKey: "freeThrowMade" },
  { key: "freeThrowAttempted", labelKey: "freeThrowAttempted" },
  { key: "offensiveRebounds", labelKey: "offensiveRebounds" },
  { key: "defensiveRebounds", labelKey: "defensiveRebounds" },
  { key: "assists", labelKey: "assists" },
  { key: "steals", labelKey: "steals" },
  { key: "blocks", labelKey: "blocks" },
  { key: "turnovers", labelKey: "turnovers" },
  { key: "foulsCommitted", labelKey: "foulsCommitted" },
  { key: "foulsDrawn", labelKey: "foulsDrawn" },
];

export function BoxScoreEditor({
  registerId,
  lines,
  existing,
  editable,
}: {
  registerId: string;
  /** Only the players who were called up can have a line. */
  lines: RegisterLine[];
  existing: MatchBoxScoreRow[];
  editable: boolean;
}) {
  const t = useTranslations("attendance.box");
  const { run, isPending } = useAction();

  const byAthlete = useMemo(
    () => new Map(existing.map((row) => [row.athlete_id, row])),
    [existing],
  );

  const [rows, setRows] = useState<Line[]>(() =>
    lines.map((line) => {
      const row = byAthlete.get(line.athleteId);
      return {
        athleteId: line.athleteId,
        min: row ? Math.round(row.seconds_played / 60) : 0,
        twoPointMade: row?.two_point_made ?? 0,
        twoPointAttempted: row?.two_point_attempted ?? 0,
        threePointMade: row?.three_point_made ?? 0,
        threePointAttempted: row?.three_point_attempted ?? 0,
        freeThrowMade: row?.free_throw_made ?? 0,
        freeThrowAttempted: row?.free_throw_attempted ?? 0,
        offensiveRebounds: row?.offensive_rebounds ?? 0,
        defensiveRebounds: row?.defensive_rebounds ?? 0,
        assists: row?.assists ?? 0,
        steals: row?.steals ?? 0,
        blocks: row?.blocks ?? 0,
        turnovers: row?.turnovers ?? 0,
        foulsCommitted: row?.fouls_committed ?? 0,
        foulsDrawn: row?.fouls_drawn ?? 0,
      };
    }),
  );

  const nameById = new Map(lines.map((line) => [line.athleteId, line]));

  function update(athleteId: string, key: keyof Line, value: string) {
    const parsed = value === "" ? 0 : Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) return;
    setRows((current) =>
      current.map((row) => (row.athleteId === athleteId ? { ...row, [key]: parsed } : row)),
    );
  }

  /** Mirrors the generated columns, so the page agrees with the database. */
  function derive(row: Line) {
    const points = row.twoPointMade * 2 + row.threePointMade * 3 + row.freeThrowMade;
    const rebounds = row.offensiveRebounds + row.defensiveRebounds;
    const efficiency =
      points + rebounds + row.assists + row.steals + row.blocks + row.foulsDrawn -
      ((row.twoPointAttempted - row.twoPointMade) +
        (row.threePointAttempted - row.threePointMade) +
        (row.freeThrowAttempted - row.freeThrowMade) +
        row.turnovers + row.foulsCommitted);
    return { points, rebounds, efficiency };
  }

  const impossible = rows.some(
    (row) =>
      row.twoPointMade > row.twoPointAttempted ||
      row.threePointMade > row.threePointAttempted ||
      row.freeThrowMade > row.freeThrowAttempted,
  );

  if (lines.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sigma className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="sticky left-0 bg-background py-2 pr-3 text-left font-medium">
                  {t("player")}
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="px-1 py-2 text-center font-medium" title={t(`${column.labelKey}Full`)}>
                    {t(column.labelKey)}
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-medium">{t("pts")}</th>
                <th className="px-2 py-2 text-center font-medium">{t("val")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const player = nameById.get(row.athleteId)!;
                const derived = derive(row);
                return (
                  <tr key={row.athleteId} className="border-b last:border-0">
                    <td className="sticky left-0 bg-background py-1.5 pr-3 whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        {player.jerseyNumber !== null ? (
                          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold tabular-nums">
                            {player.jerseyNumber}
                          </span>
                        ) : null}
                        <span className="max-w-32 truncate">{player.name}</span>
                      </span>
                    </td>
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="px-0.5 py-1">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          disabled={!editable}
                          value={row[column.key] as number}
                          onChange={(event) => update(row.athleteId, column.key, event.target.value)}
                          className="h-8 w-12 px-1 text-center tabular-nums"
                          aria-label={`${player.name} — ${t(`${column.labelKey}Full`)}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 text-center font-semibold tabular-nums">{derived.points}</td>
                    <td className="px-2 text-center font-semibold tabular-nums">
                      {derived.efficiency}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editable ? (
          <div className="flex items-center justify-end gap-3">
            {impossible ? (
              <p className="text-sm text-destructive">{t("impossible")}</p>
            ) : null}
            <Button
              disabled={isPending || impossible}
              onClick={() =>
                run(
                  () =>
                    saveBoxScoresAction({
                      registerId,
                      lines: rows.map((row) => ({
                        athleteId: row.athleteId,
                        secondsPlayed: row.min * 60,
                        twoPointMade: row.twoPointMade,
                        twoPointAttempted: row.twoPointAttempted,
                        threePointMade: row.threePointMade,
                        threePointAttempted: row.threePointAttempted,
                        freeThrowMade: row.freeThrowMade,
                        freeThrowAttempted: row.freeThrowAttempted,
                        offensiveRebounds: row.offensiveRebounds,
                        defensiveRebounds: row.defensiveRebounds,
                        assists: row.assists,
                        steals: row.steals,
                        blocks: row.blocks,
                        turnovers: row.turnovers,
                        foulsCommitted: row.foulsCommitted,
                        foulsDrawn: row.foulsDrawn,
                      })),
                    }),
                  { success: () => t("saved") },
                )
              }
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              {t("save")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
