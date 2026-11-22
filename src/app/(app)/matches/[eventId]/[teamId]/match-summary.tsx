import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, ChartColumn, FileText, Flag, MessageSquareQuote, ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isPdf } from "@/domain/ai";
import { cn } from "@/lib/utils";
import type { MatchResultSummary } from "@/server/services/match-service";
import type { SheetView } from "@/server/services/match-sheet-service";

import type { BoxScoreRow } from "./box-score-table";
import { TabLink } from "./match-tabs";

/*
  The summary half of the match page: what the score was, how it was made, and
  what the sheet behind it says. All of it is read-only and derived from what
  the page already loaded — the forms that change any of it live in the tabs.
*/

const ACCENT = "text-orange-600 dark:text-orange-400";

/**
 * A side's name on the scoreboard — a link through to the team's page for our
 * side, plain text for theirs, which is not a team of ours to open.
 */
function TeamName({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link href={href} className="underline-offset-4 hover:underline">
      {name}
    </Link>
  ) : (
    <>{name}</>
  );
}

/** One decimal, the way a share of the points is quoted. */
function percentOf(part: number, whole: number): string {
  return whole > 0 ? ((part / whole) * 100).toFixed(1) : "0";
}

/** The final score, quarter by quarter, and the coach's note. */
export async function Scoreboard({
  teamName,
  teamHref,
  opponent,
  isHome,
  result,
  kickoff,
}: {
  teamName: string;
  /** Our team's own page, when the viewer may open it. */
  teamHref: string | null;
  opponent: string;
  isHome: boolean | null;
  result: MatchResultSummary | null;
  kickoff: string;
}) {
  const t = await getTranslations("matches");

  const played =
    result !== null &&
    result.state !== "PENDING" &&
    result.ourScore !== null &&
    result.theirScore !== null;
  const margin = played ? result.ourScore! - result.theirScore! : 0;
  const ours = result?.ourPeriods ?? [];
  const theirs = result?.theirPeriods ?? [];
  const quarters = Array.from({ length: Math.max(ours.length, theirs.length) }, (_, index) => ({
    ours: ours[index] ?? 0,
    theirs: theirs[index] ?? 0,
  }));

  /*
    The home side on the left, as a referto and every scoreboard in the sport
    write it — so an away match reads "them – us". Where the fixture does not
    say, we go first.
  */
  const weAreRight = isHome === false;
  const us = {
    name: teamName,
    href: teamHref,
    label: `${t("ourScore")}${isHome !== null ? ` · ${isHome ? t("home") : t("away")}` : ""}`,
    venue: isHome === null ? null : isHome ? t("home") : t("away"),
    score: result?.ourScore ?? null,
    leads: margin >= 0,
    won: played && margin > 0,
    accent: true,
  };
  const them = {
    name: opponent,
    label: `${t("theirScore")}${isHome !== null ? ` · ${isHome ? t("away") : t("home")}` : ""}`,
    venue: isHome === null ? null : isHome ? t("away") : t("home"),
    score: result?.theirScore ?? null,
    leads: margin < 0,
    won: played && margin < 0,
    accent: false,
    href: null as string | null,
  };
  const [left, right] = weAreRight ? [them, us] : [us, them];

  return (
    <Card className="overflow-hidden bg-linear-to-br from-orange-500/10 via-card to-card">
      <CardContent className="space-y-6">
        {/*
          On a phone the two sides stack, home on top — the same order the
          wide layout reads left to right — each with its score at the end of
          its own row, and the winner's row outlined.
        */}
        <div className="space-y-2 sm:hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="label-caps text-muted-foreground">
              {played ? t("finalScore") : t("notPlayedYet")}
            </p>
            {played ? (
              <span
                className={cn(
                  "label-caps rounded-full px-2.5 py-1",
                  margin > 0 && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                  margin < 0 && "bg-destructive/15 text-destructive",
                  margin === 0 && "bg-muted",
                )}
              >
                {margin > 0
                  ? t("wonBy", { margin })
                  : margin < 0
                    ? t("lostBy", { margin: -margin })
                    : t("DRAW")}
              </span>
            ) : (
              <span className="text-sm font-medium">{kickoff}</span>
            )}
          </div>
          {[left, right].map((side) => (
            <div
              key={side.name}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-background/60 p-3",
                side.won && "border-orange-500/60 bg-orange-500/5",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={cn("font-bold text-balance break-words", side.accent && ACCENT)}>
                  <TeamName name={side.name} href={side.href} />
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {side.venue ? (
                    <span className="label-caps rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      {side.venue}
                    </span>
                  ) : null}
                  {side.won ? (
                    <span className="label-caps rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                      {t("winner")}
                    </span>
                  ) : null}
                </div>
              </div>
              {played ? (
                <span
                  className={cn(
                    "font-mono text-4xl font-bold tracking-tighter",
                    side.won && "text-orange-600 dark:text-orange-400",
                  )}
                >
                  {side.score}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="hidden items-center gap-4 rounded-xl border bg-background/60 p-6 sm:grid sm:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0 text-center sm:text-start">
            <p className={cn("text-xl font-bold text-balance break-words", left.accent && ACCENT)}>
              <TeamName name={left.name} href={left.href} />
            </p>
            <p className="text-sm text-muted-foreground">{left.label}</p>
          </div>

          <div className="text-center">
            <p className="label-caps text-muted-foreground">
              {played ? t("finalScore") : t("notPlayedYet")}
            </p>
            {played ? (
              <>
                <p className="font-mono text-5xl font-bold tracking-tighter sm:text-6xl">
                  <span className={cn(left.leads && ACCENT)}>{left.score}</span>
                  <span className="mx-2 text-3xl text-muted-foreground">:</span>
                  <span className={cn(right.leads && ACCENT)}>{right.score}</span>
                </p>
                <span className="label-caps mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5">
                  <Flag className="size-3" aria-hidden />
                  {margin > 0
                    ? t("wonBy", { margin })
                    : margin < 0
                      ? t("lostBy", { margin: -margin })
                      : t("DRAW")}
                </span>
              </>
            ) : (
              <p className="mt-1 text-lg font-semibold">{kickoff}</p>
            )}
          </div>

          <div className="min-w-0 text-center sm:text-end">
            <p className={cn("text-xl font-bold text-balance break-words", right.accent && ACCENT)}>
              <TeamName name={right.name} href={right.href} />
            </p>
            <p className="text-sm text-muted-foreground">{right.label}</p>
          </div>
        </div>

        {/* Each side's share of the points, home from the left. */}
        {played && result.ourScore! + result.theirScore! > 0 ? (
          <div className="space-y-1.5">
            <div className="label-caps flex justify-between gap-2 text-muted-foreground">
              <span className={cn(left.accent && ACCENT)}>
                {left.name} {percentOf(left.score!, result.ourScore! + result.theirScore!)}%
              </span>
              <span className={cn("text-end", right.accent && ACCENT)}>
                {right.name} {percentOf(right.score!, result.ourScore! + result.theirScore!)}%
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={left.accent ? "bg-orange-500" : "bg-muted-foreground/50"}
                style={{
                  width: `${percentOf(left.score!, result.ourScore! + result.theirScore!)}%`,
                }}
              />
              <div className={cn("flex-1", right.accent ? "bg-orange-500" : "bg-muted-foreground/50")} />
            </div>
          </div>
        ) : null}

        {quarters.length > 0 ? (
          <div className="space-y-2">
            <p className="label-caps text-muted-foreground">
              {t("quarterByQuarter")}
            </p>
            <ul className="grid grid-cols-4 gap-2">
              {quarters.map((quarter, index) => {
                // Signed from our side, wherever we sit.
                const diff = quarter.ours - quarter.theirs;
                const share =
                  quarter.ours + quarter.theirs > 0
                    ? (quarter.ours / (quarter.ours + quarter.theirs)) * 100
                    : 50;
                const [leftPoints, rightPoints] = weAreRight
                  ? [quarter.theirs, quarter.ours]
                  : [quarter.ours, quarter.theirs];
                return (
                  <li key={index} className="space-y-2 rounded-lg border bg-background/60 p-2 sm:p-3">
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span className="label-caps text-muted-foreground">
                        {t("quarterShort", { quarter: index + 1 })}
                      </span>
                      <span
                        className={cn(
                          "font-mono font-semibold",
                          diff > 0 && "text-emerald-600 dark:text-emerald-400",
                          diff < 0 && "text-destructive",
                        )}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="font-mono text-base font-bold sm:text-2xl">{leftPoints}</span>
                      <span className="label-caps hidden text-muted-foreground sm:inline">
                        {t("vs")}
                      </span>
                      <span className="text-muted-foreground sm:hidden">–</span>
                      <span className="font-mono text-base font-bold sm:text-2xl">{rightPoints}</span>
                    </div>
                    {/* Our share of the quarter's points, growing from our side. */}
                    <div
                      className={cn(
                        "flex h-1.5 overflow-hidden rounded-full bg-muted",
                        weAreRight && "flex-row-reverse",
                      )}
                    >
                      <div className="bg-orange-500" style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {result?.notes ? (
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-lg border bg-background/60 p-3 text-sm">
            <span className={cn("flex items-center gap-1.5 font-semibold", ACCENT)}>
              <MessageSquareQuote className="size-4" aria-hidden />
              {t("coachNote")}
            </span>
            <p className="min-w-0 basis-full border-l-2 border-orange-500 ps-3 text-muted-foreground italic sm:flex-1 sm:basis-auto">
              “{result.notes}”
            </p>
            <TabLink value="match" className="text-xs text-muted-foreground hover:underline">
              {t("editNote")}
            </TabLink>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Where the points came from.
 *
 * Only what a referto can support: baskets made by kind, free throws made,
 * fouls. No percentages — the sheet never records an attempt.
 */
export async function ScoringSplit({ rows }: { rows: BoxScoreRow[] }) {
  const t = await getTranslations("matches");

  const sum = (pick: (row: BoxScoreRow) => number) => rows.reduce((n, row) => n + pick(row), 0);
  const twos = sum((row) => row.twos);
  const threes = sum((row) => row.threes);
  const freeThrows = sum((row) => row.freeThrows);
  const fouls = sum((row) => row.fouls);
  const points = sum((row) => row.points);
  const starterPoints = rows.filter((row) => row.started).reduce((n, row) => n + row.points, 0);
  const hasStarters = rows.some((row) => row.started);

  const share = (value: number) => (points > 0 ? (value / points) * 100 : 0);
  const splits = [
    { label: t("twoPointers"), made: twos, points: twos * 2, bar: "bg-orange-500" },
    { label: t("threePointers"), made: threes, points: threes * 3, bar: "bg-indigo-400" },
    { label: t("freeThrowsMade"), made: freeThrows, points: freeThrows, bar: "bg-emerald-500" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ChartColumn className="size-4 text-orange-500" aria-hidden />
          {t("scoringSplit")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("boxScoreEmpty")}</p>
        ) : (
          <>
            {splits.map((split) => (
              <div key={split.label} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{split.label}</span>
                  <span className="font-mono font-semibold">
                    {t("madeCount", { made: split.made })}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({t("pointsTotal", { points: split.points })})
                    </span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", split.bar)}
                    style={{ width: `${share(split.points)}%` }}
                  />
                </div>
              </div>
            ))}

            <div className="flex items-baseline justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground">{t("teamFouls")}</span>
              <span className="font-mono font-semibold text-destructive">
                {t("foulsTotal", { count: fouls })}
              </span>
            </div>

            {hasStarters ? (
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-emerald-500" aria-hidden />
                {t("startersShare", {
                  scored: starterPoints,
                  total: points,
                  percent: points > 0 ? Math.round((starterPoints / points) * 100) : 0,
                })}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The same split as three tiles, under the box score where a phone reads it. */
export async function ScoringTiles({ rows }: { rows: BoxScoreRow[] }) {
  const t = await getTranslations("matches");
  if (rows.length === 0) return null;

  const sum = (pick: (row: BoxScoreRow) => number) => rows.reduce((n, row) => n + pick(row), 0);
  const twos = sum((row) => row.twos);
  const threes = sum((row) => row.threes);
  const freeThrows = sum((row) => row.freeThrows);
  const tiles = [
    { label: t("twoPointers"), made: twos, points: twos * 2, tint: ACCENT },
    { label: t("threePointers"), made: threes, points: threes * 3, tint: "text-indigo-500" },
    {
      label: t("freeThrowsMade"),
      made: freeThrows,
      points: freeThrows,
      tint: "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="label-caps text-muted-foreground">{t("scoringSplit")}</CardTitle>
        <span className="font-mono text-xs text-destructive">
          {t("foulsTotal", { count: sum((row) => row.fouls) })}
        </span>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <li key={tile.label} className="space-y-1 rounded-lg border bg-muted/40 p-2.5 text-center">
              <p className="label-caps text-muted-foreground">{tile.label}</p>
              <p className={cn("font-mono text-lg font-bold", tile.tint)}>{tile.made}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {t("pointsTotal", { points: tile.points })}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The photograph behind the numbers, and whether it added up. */
export async function SheetSummary({ sheet }: { sheet: SheetView | undefined }) {
  const t = await getTranslations("matches");

  const checks = sheet?.reading?.checks ?? [];
  const passed = checks.filter((check) => check.passed).length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="size-4 text-orange-500" aria-hidden />
          {t("sheets")}
        </CardTitle>
        {sheet ? (
          <Badge
            variant={
              sheet.state === "IMPORTED"
                ? "default"
                : sheet.state === "FAILED"
                  ? "destructive"
                  : "outline"
            }
          >
            {t(`sheetState.${sheet.state}`)}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {!sheet ? (
          <p className="text-sm text-muted-foreground">{t("noSheets")}</p>
        ) : (
          <>
            {sheet.imageUrl && !isPdf(sheet.mimeType) ? (
              // Signed and short-lived, so a plain <img>: see SheetsCard.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sheet.imageUrl}
                alt=""
                className="hidden aspect-[4/3] w-full rounded-lg border object-cover lg:block"
              />
            ) : (
              <div className="hidden aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-lg border bg-muted/40 text-muted-foreground lg:flex">
                <FileText className="size-8" aria-hidden />
                <span className="text-xs font-medium">PDF</span>
              </div>
            )}

            <dl className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
              {sheet.readModel ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("readWith")}</dt>
                  <dd className="truncate font-mono font-medium">{sheet.readModel}</dd>
                </div>
              ) : null}
              {checks.length > 0 ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("checks")}</dt>
                  <dd
                    className={cn(
                      "font-mono font-semibold",
                      passed === checks.length
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-500",
                    )}
                  >
                    {t("checksPassed", { passed, total: checks.length })}
                  </dd>
                </div>
              ) : null}
              {sheet.reading ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t("pointsRead")}</dt>
                  <dd className="font-mono font-medium">{sheet.reading.points}</dd>
                </div>
              ) : null}
            </dl>
          </>
        )}

        <TabLink
          value="sheet"
          className="label-caps flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-primary-foreground hover:bg-primary/90"
        >
          <ScanLine className="size-4" aria-hidden />
          {sheet ? t("openSheet") : t("upload")}
        </TabLink>
      </CardContent>
    </Card>
  );
}
