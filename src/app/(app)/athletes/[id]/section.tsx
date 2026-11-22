import type { ReactNode } from "react";

import { CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The header every section of the athlete page wears: a numbered eyebrow —
 * "02 / ATTENDANCE" — over its title, with anything that acts on the section
 * at the far end. The numbers are the page's table of contents; they are
 * passed in rather than counted, so a section the viewer may not see leaves
 * its gap instead of renumbering the rest.
 */
export function SectionHeader({
  index,
  eyebrow,
  title,
  aside,
}: {
  index: number;
  eyebrow: string;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="label-caps text-muted-foreground">
          {String(index).padStart(2, "0")} / {eyebrow}
        </p>
        <CardTitle className="text-lg leading-tight font-semibold tracking-tight">
          {title}
        </CardTitle>
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
    </CardHeader>
  );
}

const TONES = {
  default: "",
  accent: "text-orange-600 dark:text-orange-400",
  positive: "text-emerald-600 dark:text-emerald-400",
  info: "text-indigo-500 dark:text-indigo-300",
  warn: "text-amber-600 dark:text-amber-500",
} as const;

/** One figure in a tile: a small-caps label, the number, and what it is out of. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-md border bg-muted/30 p-3">
      <p className="label-caps truncate text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-3xl leading-none font-bold tracking-tight", TONES[tone])}>
        {value}
      </p>
      {hint ? <p className="font-mono text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A labelled fact in the details grid. */
export function DetailTile({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1 rounded-md border bg-muted/30 p-3", className)}>
      <dt className="label-caps text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** "6 GAMES LOGGED", "AVG 16.8" — a pill beside a section title. */
export function SectionChip({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "muted";
}) {
  return (
    <span
      className={cn(
        "label-caps rounded-full px-2.5 py-1",
        tone === "accent"
          ? "bg-orange-500/15 text-orange-700 dark:text-orange-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
