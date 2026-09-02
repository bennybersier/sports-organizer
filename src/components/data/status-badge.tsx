import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

/**
 * Status pill.
 *
 * Colour alone never carries the meaning — the label is always present — which
 * is both an accessibility requirement and simply clearer.
 */
export function StatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" | "ARCHIVED" }) {
  const t = useTranslations("common");

  return (
    <Badge
      variant={status === "ACTIVE" ? "secondary" : "outline"}
      className={status === "ARCHIVED" ? "text-muted-foreground" : undefined}
    >
      {t(status)}
    </Badge>
  );
}
