import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, MapPin } from "lucide-react";

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
import {
  listAvailability,
  listExceptions,
} from "@/server/services/availability-service";
import { getGym } from "@/server/services/gym-service";
import { getAvailabilityAnchorDate } from "@/server/services/season-service";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const context = await requireAuthContext();
  if (!hasPermission(context, "gyms.read")) return {};
  try {
    const gym = await getGym(context, (await params).id);
    return { title: gym.name };
  } catch {
    return {};
  }
}

export default async function GymDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "gyms.read")) return <AccessDenied />;

  const { id } = await params;
  const t = await getTranslations("gyms");
  const tCommon = await getTranslations("common");

  let gym;
  try {
    gym = await getGym(context, id);
  } catch (error) {
    // A missing gym is a 404, not an error screen.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canEditAvailability = hasPermission(context, "availability.create");
  const canReadAvailability = hasPermission(context, "availability.read");

  const today = new Date().toISOString().slice(0, 10);
  const [windows, exceptions, seasonStart] = await Promise.all([
    canReadAvailability ? listAvailability(context, "gym", id) : Promise.resolve([]),
    canReadAvailability
      ? listExceptions(context, "gym", id, { from: today })
      : Promise.resolve([]),
    getAvailabilityAnchorDate(context),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/gyms">
          <ArrowLeft aria-hidden />
          {t("title")}
        </Link>
      </Button>

      <PageHeader
        title={gym.name}
        description={[gym.address_line1, gym.city].filter(Boolean).join(", ") || undefined}
        action={<StatusBadge status={gym.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" aria-hidden />
            {tCommon("description")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("capacity")}</dt>
            <dd className="text-sm font-medium tabular-nums">{gym.capacity ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("sportTypes")}</dt>
            <dd className="flex flex-wrap gap-1 pt-0.5">
              {gym.sport_types.length === 0 ? (
                <span className="text-sm">—</span>
              ) : (
                gym.sport_types.map((sport) => (
                  <Badge key={sport} variant="outline">
                    {sport}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          {gym.equipment.length > 0 ? (
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">{t("equipment")}</dt>
              <dd className="flex flex-wrap gap-1 pt-0.5">
                {gym.equipment.map((item) => (
                  <Badge key={item} variant="secondary">
                    {item}
                  </Badge>
                ))}
              </dd>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canReadAvailability ? (
        <>
          <WeeklyAvailabilityEditor
            domain="gym"
            ownerId={gym.id}
            windows={windows}
            seasonStart={seasonStart}
            canEdit={canEditAvailability}
          />
          <ExceptionsEditor
            domain="gym"
            ownerId={gym.id}
            exceptions={exceptions}
            canEdit={canEditAvailability}
          />
        </>
      ) : null}
    </div>
  );
}
