"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import type { Finding, PlacementSeverity } from "@/domain/scheduling/conflicts";
import { useFindingText } from "./use-finding-text";

const ICONS = {
  VALID: CheckCircle2,
  WARNING: AlertTriangle,
  CONFLICT: XCircle,
  INVALID: XCircle,
} as const;

const TONES = {
  VALID: "text-emerald-600 dark:text-emerald-400",
  WARNING: "text-amber-600 dark:text-amber-400",
  CONFLICT: "text-destructive",
  INVALID: "text-destructive",
} as const;

/**
 * Renders scheduling findings.
 *
 * The engine emits stable codes, never prose, so the same conflict reads
 * correctly in every language — and the icon is never the only signal, since
 * colour alone can't carry meaning.
 */
export function ConflictList({
  severity,
  findings,
}: {
  severity: PlacementSeverity;
  findings: Finding[];
}) {
  const t = useTranslations("conflicts");
  const findingText = useFindingText();

  if (findings.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />
        {t("VALID")}
      </p>
    );
  }

  return (
    <ul className="space-y-1.5" aria-label={t(severity)}>
      {findings.map((finding, index) => {
        const Icon = ICONS[finding.severity] ?? Info;
        return (
          <li key={`${finding.code}-${index}`} className="flex items-start gap-2 text-sm">
            <Icon className={`mt-0.5 size-4 shrink-0 ${TONES[finding.severity]}`} aria-hidden />
            <span>
              <span className="sr-only">{t(finding.severity)}: </span>
              {findingText(finding.code, finding.values)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
