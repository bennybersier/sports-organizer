import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

import { SectionHeader } from "./section";

export interface LinkedItem {
  id: string;
  name: string;
  href?: string;
  meta?: string | null;
  /** Short text in the leading tile — the shirt worn for this side, say. */
  badge?: string | null;
  color?: string | null;
}

/**
 * The squads and coaches at the foot of the athlete page.
 *
 * Narrower than the shared related-records card, because here it sits three to
 * a row: one record per line, a tile in front carrying the one fact that
 * pairs the record with this athlete, and a chevron where it leads somewhere.
 */
export function LinkedCard({
  index,
  eyebrow,
  title,
  empty,
  items,
  action,
}: {
  index: number;
  eyebrow: string;
  title: string;
  empty: string;
  items: LinkedItem[];
  action?: ReactNode;
}) {
  return (
    <Card className="h-full">
      <SectionHeader
        index={index}
        eyebrow={eyebrow}
        title={title}
        aside={
          <>
            {action}
            <span className="flex size-6 items-center justify-center rounded-full bg-muted font-mono text-xs">
              {items.length}
            </span>
          </>
        }
      />
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const body = (
                <>
                  {item.badge ? (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-orange-500/15 font-mono text-xs font-bold text-orange-700 dark:text-orange-400">
                      {item.badge}
                    </span>
                  ) : (
                    <span
                      className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                      style={item.color ? { backgroundColor: item.color } : undefined}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    {item.meta ? (
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {item.meta}
                      </span>
                    ) : null}
                  </span>
                  {item.href ? (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                </>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="flex items-center gap-3 rounded-md border bg-muted/30 p-2.5 transition-colors hover:bg-muted/60"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2.5">
                      {body}
                    </div>
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
