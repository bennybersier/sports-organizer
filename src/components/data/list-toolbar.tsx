"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ToolbarFilter {
  /** Query-string key this filter writes to. */
  name: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
}

/**
 * Search + filters for a list page.
 *
 * State lives in the URL, not in React: the server component reads it, so the
 * filtering actually happens in Postgres. It also means a filtered view is
 * linkable and survives a refresh.
 */
export function ListToolbar({
  filters = [],
  placeholder,
}: {
  filters?: ToolbarFilter[];
  placeholder: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("list");
  const [isPending, startTransition] = useTransition();

  const urlTerm = searchParams.get("q") ?? "";
  const [term, setTerm] = useState(urlTerm);

  // Keep the box in step when the URL changes from elsewhere — back button,
  // "clear filters" — without fighting the user mid-keystroke. Adjusting during
  // render rather than in an effect avoids a second render pass and the
  // cascading-update it would cause.
  const [syncedTerm, setSyncedTerm] = useState(urlTerm);
  if (urlTerm !== syncedTerm) {
    setSyncedTerm(urlTerm);
    setTerm(urlTerm);
  }

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    // Any change to the query resets paging: page 7 of a new filter is rarely
    // where the user meant to land.
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  // Debounce typing so each keystroke isn't a database round-trip. This effect
  // writes to an external system (the URL), which is what effects are for.
  useEffect(() => {
    if (term === urlTerm) return;
    const timer = setTimeout(() => apply({ q: term || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, urlTerm]);

  const hasFilters =
    (searchParams.get("q") ?? "") !== "" ||
    filters.some((filter) => searchParams.get(filter.name));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pl-8"
        />
        {isPending ? (
          <Loader2
            className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      {filters.map((filter) => (
        <Select
          key={filter.name}
          value={searchParams.get(filter.name) ?? "all"}
          onValueChange={(value) => apply({ [filter.name]: value })}
        >
          <SelectTrigger className="w-auto min-w-36" aria-label={filter.label}>
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{filter.allLabel}</SelectItem>
            {filter.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm("");
            apply(Object.fromEntries([["q", null], ...filters.map((f) => [f.name, null])]));
          }}
        >
          <X aria-hidden />
          {t("clear")}
        </Button>
      ) : null}
    </div>
  );
}
