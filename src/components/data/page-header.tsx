import type { ReactNode } from "react";

/**
 * Title, optional description, and a slot for the primary action.
 *
 * The title is the design system's headline — heavy and tightly tracked — and
 * an optional eyebrow above it in small capitals carries the one fact that
 * frames the page, such as how many records it holds.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      {/* `min-w-0` so an unbroken name or email wraps instead of widening the page. */}
      <div className="min-w-0 space-y-1 break-words">
        {eyebrow ? <p className="label-caps text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-2xl leading-7 font-bold tracking-[-0.01em] sm:text-[32px] sm:leading-[38px] sm:tracking-[-0.02em]">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
