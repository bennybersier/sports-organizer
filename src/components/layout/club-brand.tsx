import { Loader2 } from "lucide-react";

/**
 * The club at the top of the sidebar: a mark and its name.
 *
 * There is no uploaded crest to show, so the mark is the club's initials. A
 * name written with a slash — "Robur / FBL", two clubs that field one side —
 * keeps the slash and puts the second half in the accent colour, which is how
 * such clubs write themselves.
 */
export function ClubBrand({
  name,
  subtitle,
  pending = false,
}: {
  name: string;
  subtitle?: string;
  pending?: boolean;
}) {
  const [first, ...rest] = name.split("/").map((part) => part.trim());

  return (
    <>
      <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : initials(name)}
      </span>
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate text-base font-extrabold tracking-tight uppercase">
          {first}
          {rest.length > 0 ? (
            <span className="text-sidebar-primary"> / {rest.join(" / ")}</span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="label-caps truncate text-sidebar-foreground/60">
            {subtitle}
          </span>
        ) : null}
      </span>
    </>
  );
}

function initials(name: string): string {
  const words = name.split(/[\s/]+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
