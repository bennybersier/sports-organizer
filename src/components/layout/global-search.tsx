"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dumbbell,
  Loader2,
  MapPin,
  Search,
  Swords,
  Trophy,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAVIGATION } from "@/domain/navigation";
import { globalSearchAction, type SearchHit, type SearchKind } from "@/server/actions/search";

/** Long enough to cover the gap between letters, short enough to feel live. */
const DEBOUNCE_MS = 250;

const KINDS: { kind: SearchKind; icon: LucideIcon; label: "athletes" | "teams" | "trainers" | "gyms" | "competitions" | "matches" }[] = [
  { kind: "athlete", icon: Dumbbell, label: "athletes" },
  { kind: "team", icon: Users, label: "teams" },
  { kind: "match", icon: Trophy, label: "matches" },
  { kind: "trainer", icon: UserCog, label: "trainers" },
  { kind: "gym", icon: MapPin, label: "gyms" },
  { kind: "competition", icon: Swords, label: "competitions" },
];

/**
 * The search in the top bar — every kind of record from one box.
 *
 * Opened by clicking the box or by ⌘K / Ctrl+K from anywhere, because a
 * search people reach for mid-task is used from the keyboard. The app's own
 * pages are matched in the browser, instantly; records are asked of the
 * server once two letters are typed, so a single letter is not a query over
 * every table in the club.
 *
 * `shouldFilter` is off on the command list: the server has already decided
 * what matches, and cmdk's own fuzzy filter would hide a hit whose match was
 * in the line beneath its title.
 */
export function GlobalSearch({ permissions }: { permissions: string[] }) {
  const t = useTranslations("search");
  const tNav = useTranslations("nav");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  // The query the hits on screen belong to, so stale results never show.
  const [answered, setAnswered] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = query.trim();

  // Asking the server is an external effect; the timer debounces the typing.
  useEffect(() => {
    if (term.length < 2) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await globalSearchAction({ q: term });
        setHits(result.ok ? result.data : []);
        setAnswered(term);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const granted = useMemo(() => new Set(permissions), [permissions]);
  const pages = useMemo(() => {
    const needle = term.toLowerCase();
    return NAVIGATION.flatMap((section) => section.items)
      .filter((item) => !item.permission || granted.has(item.permission))
      .filter((item) => !needle || tNav(item.titleKey).toLowerCase().includes(needle));
  }, [granted, term, tNav]);

  const shown = term.length >= 2 && answered === term ? hits : [];
  const waiting = term.length >= 2 && (isPending || answered !== term);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      {/* A box on a wide screen, so it reads as a search; an icon on a phone. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ms-auto flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted max-sm:size-9 max-sm:justify-center max-sm:px-0 sm:w-72"
        aria-label={t("open")}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left max-sm:hidden">{t("placeholder")}</span>
        <kbd className="hidden rounded border bg-background px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        title={t("open")}
        description={t("placeholder")}
        className="sm:max-w-xl"
      >
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("placeholder")} />
          <CommandList className="max-h-[min(60dvh,28rem)] overscroll-contain">
            {waiting ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("searching")}
              </div>
            ) : null}

            {!waiting && term.length >= 2 && shown.length === 0 && pages.length === 0 ? (
              <CommandEmpty>{t("noResults", { query: term })}</CommandEmpty>
            ) : null}

            {KINDS.map(({ kind, icon: Icon, label }) => {
              const group = shown.filter((hit) => hit.kind === kind);
              if (group.length === 0) return null;
              return (
                <CommandGroup key={kind} heading={tNav(label)}>
                  {group.map((hit) => (
                    <CommandItem key={hit.id} value={`${kind}:${hit.id}`} onSelect={() => go(hit.href)}>
                      {hit.color ? (
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: hit.color }}
                          aria-hidden
                        />
                      ) : (
                        <Icon className="text-muted-foreground" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{hit.title}</span>
                        {hit.meta ? (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {hit.meta}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}

            {pages.length > 0 ? (
              <CommandGroup heading={t("pages")}>
                {pages.map((item) => (
                  <CommandItem key={item.href} value={`page:${item.href}`} onSelect={() => go(item.href)}>
                    <item.icon className="text-muted-foreground" aria-hidden />
                    {tNav(item.titleKey)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {term.length < 2 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t("hint")}</p>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
