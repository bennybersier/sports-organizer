"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SCROLLING_GRID } from "@/components/attendance/scrolling-grid";
import { cn } from "@/lib/utils";

export interface BoxScoreRow {
  id: string;
  shirt: number | null;
  name: string;
  /** Null when the viewer may not open the athlete's page. */
  href: string | null;
  started: boolean;
  twos: number;
  threes: number;
  freeThrows: number;
  points: number;
  fouls: number;
  fromSheet: boolean;
}

type Filter = "ALL" | "STARTERS" | "BENCH";

/**
 * Our box score, highest scorer first, with the starting five starred.
 *
 * The filter is the one question a coach asks of it that the order does not
 * answer: what did the bench give us. The totals row follows the filter, so
 * "bench points" is read off the bottom rather than added up by eye.
 */
export function BoxScoreTable({ rows }: { rows: BoxScoreRow[] }) {
  const t = useTranslations("matches");
  const [filter, setFilter] = useState<Filter>("ALL");

  const starters = rows.filter((row) => row.started).length;
  const shown = rows
    .filter((row) =>
      filter === "ALL" ? true : filter === "STARTERS" ? row.started : !row.started,
    )
    .sort((a, b) => b.points - a.points);
  const top = Math.max(0, ...rows.map((row) => row.points));
  const total = (pick: (row: BoxScoreRow) => number) =>
    shown.reduce((sum, row) => sum + pick(row), 0);

  /*
    The shirt column is exactly as wide as the widest number in it. Set inline
    because SCROLLING_GRID gives every cell its own padding below lg, and its
    selectors outrank a utility on the cell. On a phone the shirt and the name
    are both pinned while the figures scroll, so the name is pinned at the
    shirt column's width.
  */
  const digits = Math.max(1, ...rows.map((row) => String(row.shirt ?? "").length));
  const shirtWidth = `${digits * 0.5 + 0.75}rem`;
  const shirtStyle = {
    width: shirtWidth,
    minWidth: shirtWidth,
    maxWidth: shirtWidth,
    paddingInline: "0.375rem",
  };
  const nameStyle = { left: shirtWidth };

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "ALL", label: t("filterAll"), count: rows.length },
    { value: "STARTERS", label: t("filterStarters"), count: starters },
    { value: "BENCH", label: t("filterBench"), count: rows.length - starters },
  ];

  return (
    <div className="space-y-3">
      {/* Only worth offering once the starters are known. */}
      {starters > 0 ? (
        <div className="inline-flex rounded-md border p-0.5" role="group">
          {filters.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={filter === entry.value}
              onClick={() => setFilter(entry.value)}
              className={cn(
                "label-caps rounded px-3 py-1.5 text-muted-foreground",
                filter === entry.value && "bg-muted text-foreground",
              )}
            >
              {entry.label} <span className="tabular-nums">({entry.count})</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* A grid on a phone too, scrolling sideways: see SCROLLING_GRID. */}
      <div className={SCROLLING_GRID}>
        <Table className="[&_th]:label-caps">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="text-end max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:bg-card" style={shirtStyle}>
                {t("shirt")}
              </TableHead>
              {/* Pinned on a phone, so the numbers keep a name beside them. */}
              <TableHead className="max-sm:sticky max-sm:z-10 max-sm:bg-card" style={nameStyle}>
                {t("player")}
              </TableHead>
              <TableHead className="text-end">{t("twos")}</TableHead>
              <TableHead className="text-end">{t("threes")}</TableHead>
              <TableHead className="text-end">{t("freeThrows")}</TableHead>
              <TableHead className="text-end">{t("points")}</TableHead>
              <TableHead className="text-end">{t("fouls")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.id}>
                {/* The sheet names a scorer by shirt, so this reads the same way round. */}
                <TableCell
                  className={cn(
                    "text-end font-mono max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:bg-card",
                    row.started ? "font-semibold" : "text-muted-foreground",
                  )}
                  style={shirtStyle}
                >
                  {row.shirt ?? "—"}
                </TableCell>
                <TableCell
                  className="whitespace-nowrap max-sm:sticky max-sm:z-10 max-sm:bg-card"
                  style={nameStyle}
                >
                  <span className="flex items-center gap-1.5">
                    {/*
                      Through to the player's own page, which is where the
                      season behind this one line is. Absent for a coach who
                      may see a box score but not the athlete register.
                    */}
                    {row.href ? (
                      <Link
                        href={row.href}
                        className={cn(
                          "underline-offset-4 hover:underline",
                          row.started && "font-semibold",
                        )}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className={cn(row.started && "font-semibold")}>{row.name}</span>
                    )}
                    {/* After the name, so every name starts on the same line. */}
                    {row.started ? (
                      <Star
                        className="size-3.5 shrink-0 fill-current text-orange-500"
                        aria-label={t("started")}
                      />
                    ) : null}
                    {top > 0 && row.points === top ? (
                      <Badge className="label-caps bg-orange-500/15 text-orange-700 max-sm:hidden dark:text-orange-400">
                        {t("topScorer")}
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-end font-mono">{row.twos}</TableCell>
                <TableCell className="text-end font-mono">{row.threes}</TableCell>
                <TableCell className="text-end font-mono">{row.freeThrows}</TableCell>
                <TableCell className="text-end font-mono font-semibold">
                  {row.points}
                </TableCell>
                <TableCell className="text-end font-mono">
                  {/* Five is fouled out. */}
                  <span className={cn(row.fouls >= 5 && "font-semibold text-destructive")}>
                    {row.fouls}
                  </span>
                </TableCell>
                <TableCell>
                  {row.fromSheet ? (
                    <Badge variant="outline" className="font-normal">
                      {t("fromSheet")}
                    </Badge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell className="text-end font-mono max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:bg-card" style={shirtStyle}>
                {shown.length}
              </TableCell>
              <TableCell
                className="label-caps max-sm:sticky max-sm:z-10 max-sm:bg-card"
                style={nameStyle}
              >
                {t("totals")}
              </TableCell>
              <TableCell className="text-end font-mono">{total((row) => row.twos)}</TableCell>
              <TableCell className="text-end font-mono">{total((row) => row.threes)}</TableCell>
              <TableCell className="text-end font-mono">
                {total((row) => row.freeThrows)}
              </TableCell>
              <TableCell className="text-end font-mono text-lg text-orange-600 dark:text-orange-400">
                {total((row) => row.points)}
              </TableCell>
              <TableCell className="text-end font-mono">{total((row) => row.fouls)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {shown.some((row) => row.fouls >= 5) ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono font-semibold text-destructive">5</span> {t("fouledOut")}
        </p>
      ) : null}
    </div>
  );
}
