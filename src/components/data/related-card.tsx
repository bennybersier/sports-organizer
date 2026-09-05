import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One record on a detail page's "related" card.
 *
 * `meta` is the one line of context that makes the name useful — the sport, the
 * squads a coach reaches an athlete through, the town a hall is in. `tags` are
 * the short qualifiers that would otherwise need their own column.
 */
export interface RelatedItem {
  id: string;
  name: string;
  /** Omitted when the record has no page of its own, or the viewer may not open it. */
  href?: string;
  meta?: string | null;
  /** Rendered as a dot before the name, matching the colour used on the calendar. */
  color?: string | null;
  tags?: { label: string; variant?: "default" | "secondary" | "outline" | "destructive" }[];
}

/**
 * The related-records card.
 *
 * Every detail page in the club answers the same question in the same shape —
 * "what else does this touch?" — so it is one component rather than four
 * near-identical blocks. A count sits in the header because "how many athletes"
 * is asked far more often than any single name in the list, and the grid is
 * deliberately dense: these are pointers to elsewhere, not the page's subject.
 */
export function RelatedCard({
  icon: Icon,
  title,
  count,
  empty,
  items,
  action,
}: {
  icon: LucideIcon;
  title: string;
  /** Overrides the item count — for "12 of 40 shown" style headers. */
  count?: number;
  empty: string;
  items: RelatedItem[];
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" aria-hidden />
          {title}
          <Badge variant="secondary" className="tabular-nums">
            {count ?? items.length}
          </Badge>
        </CardTitle>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 items-start gap-2 rounded-lg border p-2.5"
              >
                {item.color ? (
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                    aria-hidden
                  />
                ) : null}

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium">{item.name}</span>
                    )}
                    {item.tags?.map((tag) => (
                      <Badge key={tag.label} variant={tag.variant ?? "outline"}>
                        {tag.label}
                      </Badge>
                    ))}
                  </div>
                  {item.meta ? (
                    <p className="truncate text-xs text-muted-foreground">{item.meta}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
