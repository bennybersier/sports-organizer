import { Badge } from "@/components/ui/badge";
import type { MatchResultSummary } from "@/server/services/match-service";

/**
 * A result, in the smallest space that still says who won.
 *
 * Our score first always, rather than home first. A club reading its own list
 * wants to know whether it won, and making that depend on remembering which
 * side of the fixture it was turns a glance into arithmetic. The outcome is
 * carried by the badge's variant as well as by the figures, so it survives
 * being skimmed.
 */
export function ScoreBadge({
  result,
  labels,
}: {
  result: MatchResultSummary | null;
  labels: { notPlayed: string; pending: string; forfeit: string; abandoned: string };
}) {
  if (result === null || result.state === "PENDING") {
    return (
      <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
        {labels.pending}
      </Badge>
    );
  }

  if (result.ourScore === null || result.theirScore === null) {
    return <Badge variant="outline" className="shrink-0">{labels.notPlayed}</Badge>;
  }

  const won = result.ourScore > result.theirScore;
  const drawn = result.ourScore === result.theirScore;

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Badge
        variant={drawn ? "secondary" : won ? "default" : "destructive"}
        className="tabular-nums"
      >
        {result.ourScore}–{result.theirScore}
      </Badge>
      {result.state === "FORFEIT" ? (
        <Badge variant="outline" className="font-normal">{labels.forfeit}</Badge>
      ) : null}
      {result.state === "ABANDONED" ? (
        <Badge variant="outline" className="font-normal">{labels.abandoned}</Badge>
      ) : null}
    </span>
  );
}
