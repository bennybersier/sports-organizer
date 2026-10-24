import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A section that folds away.
 *
 * Built on `<details>` rather than a controlled component, so it works in a
 * Server Component, survives a page refresh without state, and can be opened by
 * the browser's own find-in-page. The cost is that the chevron has to be drawn
 * by hand: Tailwind's reset removes the native marker, and giving `<summary>`
 * a flex layout removes it again in WebKit, which is how a disclosure ends up
 * looking like a heading nobody thinks to click.
 *
 * So the chevron is explicit, and it rotates on open through the `group-open`
 * variant — no JavaScript, and it animates the same way whether the section was
 * opened by a click or rendered open.
 */
export function Disclosure({
  title,
  meta,
  defaultOpen = false,
  className,
  children,
}: {
  title: ReactNode;
  /** A quiet line beside the title — a count, a total, a status. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("group rounded-md border", className)} open={defaultOpen}>
      <summary
        className={cn(
          "flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium",
          "select-none hover:bg-muted/40",
          // Both are needed: the first for WebKit's triangle, the second for
          // the list-item marker every other engine draws.
          "[&::-webkit-details-marker]:hidden [&::marker]:content-['']",
        )}
      >
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          aria-hidden
        />
        <span>{title}</span>
        {meta ? <span className="font-normal text-muted-foreground">{meta}</span> : null}
      </summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}
