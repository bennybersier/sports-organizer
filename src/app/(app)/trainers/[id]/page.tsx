import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { PageHeader } from "@/components/data/page-header";
import { StatusBadge } from "@/components/data/status-badge";
import { ExceptionsEditor } from "@/components/availability/exceptions-editor";
import { WeeklyAvailabilityEditor } from "@/components/availability/weekly-availability-editor";
import { isAppError } from "@/lib/errors";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAvailability, listExceptions } from "@/server/services/availability-service";
import { getAvailabilityAnchorDate } from "@/server/services/season-service";
import { getTrainer } from "@/server/services/trainer-service";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "trainers.read")) return {};
  try {
    const trainer = await getTrainer(context, (await params).id);
    return { title: `${trainer.first_name} ${trainer.last_name}` };
  } catch {
    return {};
  }
}

export default async function TrainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "trainers.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("trainers");
  const tCommon = await getTranslations("common");

  let trainer;
  try {
    trainer = await getTrainer(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  /*
    A trainer may edit their own availability without holding trainers.update —
    the Trainer role has availability.* precisely so coaches can keep their own
    hours current. The RLS policies allow the same thing at the database level.
  */
  const canEditAvailability = hasPermission(context, "availability.create");
  const canReadAvailability = hasPermission(context, "availability.read");

  const today = new Date().toISOString().slice(0, 10);
  const [windows, exceptions, seasonStart] = await Promise.all([
    canReadAvailability ? listAvailability(context, "trainer", id) : Promise.resolve([]),
    canReadAvailability
      ? listExceptions(context, "trainer", id, { from: today })
      : Promise.resolve([]),
    getAvailabilityAnchorDate(context),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/trainers">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={`${trainer.first_name} ${trainer.last_name}`}
        description={trainer.email ?? undefined}
        action={<StatusBadge status={trainer.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="size-4" aria-hidden />
            {tCommon("description")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{tCommon("phone")}</dt>
            <dd className="text-sm font-medium">{trainer.phone ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("qualifications")}</dt>
            <dd className="flex flex-wrap gap-1 pt-0.5">
              {trainer.qualifications.length === 0 ? (
                <span className="text-sm">—</span>
              ) : (
                trainer.qualifications.map((qualification) => (
                  <Badge key={qualification} variant="outline">
                    {qualification}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          {trainer.notes ? (
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">{tCommon("notes")}</dt>
              <dd className="text-sm whitespace-pre-line">{trainer.notes}</dd>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canReadAvailability ? (
        <>
          <WeeklyAvailabilityEditor
            domain="trainer"
            ownerId={trainer.id}
            windows={windows}
            seasonStart={seasonStart}
            canEdit={canEditAvailability}
          />
          <ExceptionsEditor
            domain="trainer"
            ownerId={trainer.id}
            exceptions={exceptions}
            canEdit={canEditAvailability}
          />
        </>
      ) : null}
    </div>
  );
}
