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
 * Which squad the report is about.
 *
 * Kept in the URL rather than in component state, so a coach can send "look at
 * this" as a link — which is the whole reason anyone reads a report together.
 */
export function TeamPicker({
  teams,
  value,
}: {
  teams: { id: string; name: string }[];
  value: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("attendance");

  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        const query = new URLSearchParams(params);
        query.set("team", next);
        router.replace(`/attendance?${query}`, { scroll: false });
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-72">
        <SelectValue placeholder={t("pickTeam")} />
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
