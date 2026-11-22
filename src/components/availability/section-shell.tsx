import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The frame an availability editor sits in.
 *
 * A card of its own on a trainer's or a hall's page, where the hours are the
 * subject. Embedded — a row inside the team's requirements card — on a team's
 * page, where they are one more input to the same scheduler and read as part
 * of the rules rather than beside them.
 */
export function SectionShell({
  embedded,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  embedded: boolean;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  if (embedded) {
    return (
      <section className="space-y-3 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Icon className="mt-0.5 size-4 shrink-0 text-orange-500" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          {action}
        </div>
        {children}
      </section>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className="size-4 text-orange-500" aria-hidden />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {action}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
