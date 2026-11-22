import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarDays, Dumbbell, MapPin, Trophy, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getPublicTeamPage,
  type PublicMatch,
  type PublicVenue,
} from "@/server/services/public-team-service";
import type { Outcome } from "@/domain/competitions/record";

/**
 * The parents' page: fixtures, results and training for one team, opened from
 * a share link with no account. What it may show is decided in
 * `public-team-service.ts`; this file only lays it out.
 */

/** Shared by the metadata and the page, so the token is looked up once. */
const load = cache(getPublicTeamPage);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const page = await load((await params).token);
  return page ? { title: `${page.team.name} · ${page.clubName}` } : {};
}

const OUTCOME_STYLE: Record<Outcome, string> = {
  WIN: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  LOSS: "bg-red-500/15 text-red-700 dark:text-red-400",
  DRAW: "bg-muted text-muted-foreground",
};

export default async function PublicTeamPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const page = await load((await params).token);
  if (!page) notFound();

  const t = await getTranslations("publicTeam");
  const tMatches = await getTranslations("matches");
  const tGender = await getTranslations("gender");
  const format = await getFormatter();
  const timeZone = page.timeZone;

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { weekday: "short", day: "numeric", month: "short", timeZone });
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone });

  const subtitle = [
    page.team.sport,
    page.team.gender === "UNSPECIFIED" ? null : tGender(page.team.gender),
    page.team.ageGroup ?? page.team.category,
    page.team.season,
  ]
    .filter(Boolean)
    .join(" · ");

  const { record } = page;

  return (
    <div className="flex flex-col gap-4">
      <header className="space-y-1.5 px-1">
        <p className="label-caps text-muted-foreground">{page.clubName}</p>
        <h1 className="flex items-center gap-3 text-[28px] leading-8 font-extrabold tracking-[-0.02em] text-balance sm:text-4xl">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: page.team.color }}
            aria-hidden
          />
          {page.team.name}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        {page.homeVenue ? (
          <p className="text-sm text-muted-foreground">
            {t("homeVenue")}: <Venue venue={page.homeVenue} />
          </p>
        ) : null}
      </header>

      {record.played > 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="label-caps text-muted-foreground">{tMatches("record")}</p>
              <p className="font-mono text-2xl font-bold">
                {record.drawn > 0
                  ? tMatches("recordLineWithDraws", {
                      won: record.won,
                      lost: record.lost,
                      drawn: record.drawn,
                    })
                  : tMatches("recordLine", { won: record.won, lost: record.lost })}
              </p>
              <p className="text-xs text-muted-foreground">
                {tMatches("pointsFor")} {record.pointsFor} · {tMatches("pointsAgainst")}{" "}
                {record.pointsAgainst}
              </p>
            </div>
            {record.form.length > 0 ? (
              <div className="space-y-1">
                <p className="label-caps text-muted-foreground">{tMatches("form")}</p>
                <ol className="flex gap-1" aria-label={tMatches("formHint")}>
                  {record.form.map((outcome, index) => (
                    <li
                      key={index}
                      className={cn(
                        "flex size-7 items-center justify-center rounded font-mono text-xs font-bold",
                        OUTCOME_STYLE[outcome],
                      )}
                      title={tMatches(outcome)}
                    >
                      {t(`short${outcome}`)}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Section icon={<CalendarDays aria-hidden />} title={t("upcoming")}>
        {page.upcoming.length === 0 ? (
          <Empty>{t("noUpcoming")}</Empty>
        ) : (
          <ul className="divide-y">
            {page.upcoming.map((match) => (
              <MatchRow key={match.startsAt + match.opponent} match={match} day={day} time={time} />
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Dumbbell aria-hidden />} title={t("training")} hint={t("trainingHint")}>
        {page.training.length === 0 ? (
          <Empty>{t("noTraining")}</Empty>
        ) : (
          <ul className="divide-y">
            {page.training.map((session) => (
              <li
                key={session.startsAt}
                className={cn(
                  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5",
                  session.cancelled && "text-muted-foreground",
                )}
              >
                <span className={cn("font-medium", session.cancelled && "line-through")}>
                  {day(session.startsAt)}
                  <span className="ml-2 font-mono text-sm">
                    {time(session.startsAt)}–{time(session.endsAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {session.cancelled ? (
                    <Badge variant="outline">{t("cancelled")}</Badge>
                  ) : null}
                  {session.venue ? <Venue venue={session.venue} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {page.roster.length > 0 ? (
        <Section icon={<Users aria-hidden />} title={t("roster")}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            {page.roster.map((name, index) => (
              <li key={index} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section icon={<Trophy aria-hidden />} title={t("results")}>
        {page.past.length === 0 ? (
          <Empty>{tMatches("recordEmpty")}</Empty>
        ) : (
          <ul className="divide-y">
            {page.past.map((match) => (
              <MatchRow key={match.startsAt + match.opponent} match={match} day={day} time={time} />
            ))}
          </ul>
        )}
      </Section>

      <p className="px-1 text-center text-xs text-muted-foreground">
        {t("footer", { club: page.clubName, timeZone })}
      </p>
    </div>
  );
}

async function MatchRow({
  match,
  day,
  time,
}: {
  match: PublicMatch;
  day: (iso: string) => string;
  time: (iso: string) => string;
}) {
  const tMatches = await getTranslations("matches");
  const result = match.result;
  const hasScore = result && result.ourScore !== null && result.theirScore !== null;
  const periods =
    result?.ourPeriods && result.theirPeriods && result.ourPeriods.length > 0
      ? result.ourPeriods.map((ours, index) => `${ours}–${result.theirPeriods![index] ?? "?"}`)
      : null;

  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-muted-foreground">
          {day(match.startsAt)} · <span className="font-mono">{time(match.startsAt)}</span>
          {match.competition ? <> · {match.competition}</> : null}
        </p>
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="break-words">{tMatches("versus", { opponent: match.opponent })}</span>
          {match.isHome !== null ? (
            <span className="label-caps rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {match.isHome ? tMatches("home") : tMatches("away")}
            </span>
          ) : null}
        </p>
        {match.venue ? (
          <p className="text-sm text-muted-foreground">
            <Venue venue={match.venue} />
          </p>
        ) : null}
        {periods ? (
          <p className="font-mono text-[11px] text-muted-foreground">{periods.join(" · ")}</p>
        ) : null}
      </div>

      {result && result.state !== "PENDING" ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {hasScore ? (
            <span className="font-mono text-lg font-bold tabular-nums">
              {result.ourScore}–{result.theirScore}
            </span>
          ) : null}
          {result.state === "PLAYED" && result.outcome ? (
            <span
              className={cn("label-caps rounded px-1.5 py-0.5", OUTCOME_STYLE[result.outcome])}
            >
              {tMatches(result.outcome)}
            </span>
          ) : (
            <span className="label-caps rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {tMatches(result.state)}
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** A hall, linked to a map search so a parent can get directions from the page. */
function Venue({ venue }: { venue: PublicVenue }) {
  const query = [venue.name, venue.address].filter(Boolean).join(", ");
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
    >
      <MapPin className="size-3.5 shrink-0" aria-hidden />
      <span>
        {venue.name}
        {venue.address ? <span className="text-muted-foreground"> · {venue.address}</span> : null}
      </span>
    </a>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}
