import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarDays, MapPin, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { getRegisterSheet } from "@/server/services/attendance-service";
import { listBoxScores } from "@/server/services/performance-service";

import { BoxScoreEditor } from "./box-score-editor";
import { RegisterSheetEditor } from "./register-sheet";
import { RegisterStateActions } from "./register-state-actions";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "attendance.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("attendance");
  const format = await getFormatter();

  const sheet = await getRegisterSheet(context, id);
  const isMatch = sheet.register.occasion === "MATCH";
  // Only offered where somebody actually keeps a scoresheet: showing the grid
  // to a minibasket instructor is how a feature gets a reputation.
  const boxScores = isMatch && sheet.team.tracksBoxScore ? await listBoxScores(context, id) : [];
  const start = new Date(sheet.register.starts_at);

  const subtitleParts = [
    format.dateTime(start, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }),
    sheet.gym?.name,
    isMatch && sheet.fixture?.opponent
      ? t("versus", { opponent: sheet.fixture.opponent })
      : undefined,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/attendance">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={sheet.team.name}
        description={subtitleParts.join(" · ")}
        action={
          <RegisterStateActions
            registerId={sheet.register.id}
            state={sheet.register.state}
            canRecord={hasPermission(context, "attendance.record")}
            canManage={hasPermission(context, "attendance.manage")}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {isMatch ? <Users aria-hidden /> : <CalendarDays aria-hidden />}
          {isMatch ? t("match") : t("training")}
        </Badge>
        <Badge variant={sheet.register.state === "RECORDED" ? "default" : "outline"}>
          {t(`registerState.${sheet.register.state}`)}
        </Badge>
        {isMatch && sheet.fixture?.competition ? (
          <Badge variant="outline">{sheet.fixture.competition}</Badge>
        ) : null}
        {isMatch && sheet.fixture?.isHome !== null && sheet.fixture !== null ? (
          <Badge variant="outline">{sheet.fixture.isHome ? t("home") : t("away")}</Badge>
        ) : null}
        {sheet.gym ? (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            {sheet.gym.name}
          </span>
        ) : null}
      </div>

      <RegisterSheetEditor sheet={sheet} />

      {isMatch && sheet.team.tracksBoxScore ? (
        <BoxScoreEditor
          registerId={sheet.register.id}
          lines={sheet.lines.filter((line) => line.calledUp)}
          existing={boxScores}
          editable={sheet.editable}
        />
      ) : null}
    </div>
  );
}
