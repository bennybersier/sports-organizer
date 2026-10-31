"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { FilterCombobox } from "@/components/data/filter-combobox";

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

  function set(key: string, value: string | null) {
    const query = new URLSearchParams(params);
    if (value === null || value === ALL) query.delete(key);
    else query.set(key, value);
    router.replace(`/matches?${query}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <FilterCombobox
        value={team}
        options={teams.map((entry) => ({ value: entry.id, label: entry.name }))}
        onChange={(next) => set("team", next)}
        placeholder={t("allTeams")}
        allOption={{ value: ALL, label: t("allTeams") }}
        className="w-full sm:w-56"
      />

      {competitions.length > 0 ? (
        <FilterCombobox
          value={competition}
          options={competitions.map((entry) => ({ value: entry.id, label: entry.name }))}
          onChange={(next) => set("competition", next)}
          placeholder={t("allCompetitions")}
          allOption={{ value: ALL, label: t("allCompetitions") }}
          className="w-full sm:w-64"
        />
      ) : null}
    </div>
  );
}
