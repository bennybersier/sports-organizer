import { getTranslations } from "next-intl/server";
import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { FINDING_THRESHOLDS } from "@/domain/attendance/statistics";
import type { SquadPerformance } from "@/server/services/performance-service";

/**
 * A squad's season, and what to do about it.
 *
 * The findings come first on purpose. A table of sixteen percentages is
 * something a coach scans and forgets; "Nicolò has not been picked for four
 * matches" is the sentence that makes the club act, and burying it under the
 * table would waste the whole exercise.
 *
 * Percentages are shown as "—" rather than 0% where there is nothing to divide
 * by. A player who joined last week has no turnout, and printing 0% for them is
 * how a coach learns not to trust the page.
 */
export async function SquadReport({ report }: { report: SquadPerformance }) {
  const t = await getTranslations("attendance");

  const nameById = new Map(report.members.map((member) => [member.athleteId, member.name]));

  return (
    <div className="space-y-4">
      {report.findings.length > 0 ? (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600 dark:text-amber-500" aria-hidden />
              {t("findings.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {report.findings.map((finding, index) => (
                <li key={`${finding.kind}:${finding.athleteId}:${index}`}>
                  <span className="font-medium">{nameById.get(finding.athleteId)}</span>{" "}
                  <span className="text-muted-foreground">
                    {t(`findings.${finding.kind}`, {
                      value:
                        finding.kind === "LOW_TURNOUT"
                          ? Math.round(finding.value * 100)
                          : finding.value,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40">{t("squadReport")}</TableHead>
              <TableHead className="text-right">{t("stats.sessions")}</TableHead>
              <TableHead className="text-right">{t("stats.turnout")}</TableHead>
              <TableHead className="text-right">{t("stats.absent")}</TableHead>
              <TableHead className="text-right">{t("stats.matches")}</TableHead>
              <TableHead className="text-right">{t("stats.calledUp")}</TableHead>
              <TableHead className="text-right">{t("stats.started")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.members.map((member) => (
              <TableRow key={member.athleteId}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {member.jerseyNumber !== null ? (
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold tabular-nums">
                        {member.jerseyNumber}
                      </span>
                    ) : null}
                    {member.name}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {member.training.eligible}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Percent
                    value={member.training.turnout}
                    // Below a handful of sessions a percentage is noise, so it
                    // is shown without the colour that invites a judgement.
                    muted={member.training.eligible < FINDING_THRESHOLDS.minimumSessions}
                  />
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    member.training.unexplained > 0 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
                  )}
                >
                  {member.training.unexplained}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {member.matches.eligible}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.matches.eligible === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Badge variant="secondary" className="tabular-nums">
                      {member.matches.calledUp}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {member.matches.started}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** A ratio, or an em dash where there was nothing to divide by. */
function Percent({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;

  const percent = Math.round(value * 100);
  return (
    <span
      className={cn(
        muted && "text-muted-foreground",
        !muted && percent < 60 && "text-amber-600 dark:text-amber-500",
      )}
    >
      {percent}%
    </span>
  );
}
