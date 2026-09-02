"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CalendarView = "day" | "week" | "month" | "agenda";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * View switcher, date navigation and filters.
 *
 * All of it lives in the URL: a filtered week is a link someone can send to a
 * colleague, and the server does the filtering.
 */
export function CalendarToolbar({
  view,
  label,
  previousDate,
  nextDate,
  today,
  teams,
  trainers,
  gyms,
  types,
}: {
  view: CalendarView;
  label: string;
  previousDate: string;
  nextDate: string;
  today: string;
  teams: FilterOption[];
  trainers: FilterOption[];
  gyms: FilterOption[];
  types: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("calendar");

  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "all") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`);
  }

  const filters = [
    { name: "team", options: teams, all: t("allTeams") },
    { name: "trainer", options: trainers, all: t("allTrainers") },
    { name: "gym", options: gyms, all: t("allGyms") },
    { name: "type", options: types, all: t("allTypes") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("previous")}
            onClick={() => go({ date: previousDate })}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon" aria-label={t("next")} onClick={() => go({ date: nextDate })}>
            <ChevronRight aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => go({ date: today })}>
            {t("today")}
          </Button>
        </div>

        <p className="text-sm font-medium" aria-live="polite">
          {label}
        </p>

        <Tabs
          value={view}
          onValueChange={(value) => go({ view: value })}
          className="ml-auto w-auto"
        >
          <TabsList>
            <TabsTrigger value="day">{t("day")}</TabsTrigger>
            <TabsTrigger value="week">{t("week")}</TabsTrigger>
            <TabsTrigger value="month">{t("month")}</TabsTrigger>
            <TabsTrigger value="agenda">{t("agenda")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters
          .filter((filter) => filter.options.length > 0)
          .map((filter) => (
            <Select
              key={filter.name}
              value={searchParams.get(filter.name) ?? "all"}
              onValueChange={(value) => go({ [filter.name]: value })}
            >
              <SelectTrigger className="w-auto min-w-36" aria-label={filter.all}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{filter.all}</SelectItem>
                {filter.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
      </div>
    </div>
  );
}
