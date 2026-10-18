"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Team and competition, both in the URL.
 *
 * In the URL rather than in state for the usual reason — "look at this" has to
 * be sendable as a link — and also because the page is a Server Component that
 * queries by these two values, so they have to arrive as `searchParams` anyway.
 *
 * `ALL` is a sentinel rather than an empty string: Radix treats "" as "nothing
 * selected" and would show the placeholder instead of "All teams", which reads
 * as a filter nobody has set rather than one deliberately cleared.
 */
const ALL = "ALL";

export function MatchFilters({
  teams,
  competitions,
  team,
  competition,
}: {
  teams: { id: string; name: string }[];
  competitions: { id: string; name: string }[];
  team: string | null;
  competition: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("matches");

  function set(key: string, value: string) {
    const query = new URLSearchParams(params);
    if (value === ALL) query.delete(key);
    else query.set(key, value);
    router.replace(`/matches?${query}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={team ?? ALL} onValueChange={(next) => set("team", next)}>
        <SelectTrigger size="sm" className="w-full sm:w-56">
          <SelectValue placeholder={t("allTeams")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allTeams")}</SelectItem>
          {teams.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {competitions.length > 0 ? (
        <Select
          value={competition ?? ALL}
          onValueChange={(next) => set("competition", next)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-64">
            <SelectValue placeholder={t("allCompetitions")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allCompetitions")}</SelectItem>
            {competitions.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
