"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface RosterMember {
  id: string;
  name: string;
  jerseyNumber: number | null;
  position: string | null;
  /** Set only when it is worth saying — anything but an active member. */
  membership: string | null;
}

/**
 * The squad as a grid of shirts, in shirt order, the way it is read off a
 * bench sheet. The filter is for the club with forty under-13s across three
 * sides: finding one name in a grid that long is otherwise a scroll.
 */
export function RosterGrid({
  members,
  actions,
  canOpen,
}: {
  members: RosterMember[];
  actions?: ReactNode;
  /** Whether a tile leads to the athlete's page. */
  canOpen: boolean;
}) {
  const t = useTranslations("teams");
  const tRelated = useTranslations("related");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown = members
    .filter(
      (member) =>
        !needle ||
        member.name.toLowerCase().includes(needle) ||
        String(member.jerseyNumber ?? "").includes(needle),
    )
    .sort((a, b) => {
      if (a.jerseyNumber !== null && b.jerseyNumber !== null) return a.jerseyNumber - b.jerseyNumber;
      if (a.jerseyNumber !== null) return -1;
      if (b.jerseyNumber !== null) return 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-4 text-orange-500" aria-hidden />
          {t("rosterTitle")}
          <span className="label-caps rounded-full bg-orange-500/15 px-2 py-1 text-orange-700 dark:text-orange-400">
            {t("athletesCount", { count: members.length })}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {members.length > 8 ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("filterAthletes")}
                aria-label={t("filterAthletes")}
                className="h-8 w-44 ps-8 text-xs"
              />
            </div>
          ) : null}
          {actions}
        </div>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tRelated("noAthletes")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
            {shown.map((member) => {
              const tile = (
                <>
                  <span className="flex items-start justify-between gap-2">
                    <span className="label-caps truncate text-muted-foreground">
                      {member.position ?? ""}
                    </span>
                    {member.jerseyNumber !== null ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-bold">
                        #{member.jerseyNumber}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-3 block truncate text-sm font-semibold">{member.name}</span>
                  {member.membership ? (
                    <span className="label-caps mt-0.5 block truncate text-muted-foreground">
                      {member.membership}
                    </span>
                  ) : null}
                </>
              );
              return (
                <li key={member.id}>
                  {canOpen ? (
                    <Link
                      href={`/athletes/${member.id}`}
                      className="block h-full rounded-md border bg-muted/20 p-2.5 transition-colors hover:border-orange-500/50 hover:bg-muted/40"
                    >
                      {tile}
                    </Link>
                  ) : (
                    <div className="h-full rounded-md border bg-muted/20 p-2.5">{tile}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
