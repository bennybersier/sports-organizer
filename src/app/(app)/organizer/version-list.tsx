"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarDays, Eye, Loader2, Trash2, Undo2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import {
  discardVersionAction,
  previewVersionWeekAction,
  publishScheduleAction,
  withdrawScheduleAction,
} from "@/server/actions/organizer";
import type { TrainingWeek } from "@/server/services/calendar-service";

import { VersionPreview } from "./version-preview";

export interface VersionSummary {
  id: string;
  number: number;
  name: string | null;
  status: string;
  summary: {
    score?: number;
    stats?: { sessionsScheduled?: number; sessionsRequested?: number };
    unmet?: { teamName: string; scheduled: number; requested: number }[];
  };
  createdAt: string;
}

/**
 * Draft schedules, newest first.
 *
 * Publishing is a separate, deliberate step — generating never touches what the
 * club is currently running. A published version can't be discarded; the way to
 * replace it is to publish another, which archives this one rather than
 * deleting it.
 */
export function VersionList({
  versions,
  canPublish,
  canReview,
  timezone,
}: {
  versions: VersionSummary[];
  canPublish: boolean;
  canReview: boolean;
  /** The club's zone: session times must read as the club's clock, not the browser's. */
  timezone: string;
}) {
  const t = useTranslations("organizer");
  const format = useFormatter();
  const { run, isPending } = useAction();
  const [publishing, setPublishing] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  // Holds the fetched week alongside the version, so the dialog mounts with
  // content rather than loading itself into existence.
  const [preview, setPreview] = useState<{
    version: VersionSummary;
    week: TrainingWeek;
  } | null>(null);
  // Its own transition: loading a preview must not disable publish and discard
  // on every other row.
  const [isLoadingPreview, startPreview] = useTransition();
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("versions")}</CardTitle>
          <CardDescription>{t("publishConfirmBody")}</CardDescription>
        </CardHeader>

        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {versions.map((version) => {
                const scheduled = version.summary?.stats?.sessionsScheduled ?? 0;
                const requested = version.summary?.stats?.sessionsRequested ?? 0;
                const unmet = version.summary?.unmet?.length ?? 0;
                const isPublished = version.status === "PUBLISHED";

                return (
                  <li key={version.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {version.name ?? t("versionNumber", { number: version.number })}
                        </span>
                        <Badge variant={isPublished ? "default" : "secondary"}>
                          {t(version.status as "GENERATED")}
                        </Badge>
                        {unmet > 0 ? <Badge variant="outline">{unmet}</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {scheduled}/{requested} · {t("score")} {version.summary?.score ?? 0} ·{" "}
                        {format.dateTime(new Date(version.createdAt), { dateStyle: "medium" })}
                      </p>
                    </div>

                    {/*
                      A draft is not on the calendar, so linking there showed an
                      empty week. Drafts preview in place; only the published
                      schedule has a calendar to open.
                    */}
                    {isPublished ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href="/calendar">
                          <CalendarDays aria-hidden />
                          {t("openInCalendar")}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isLoadingPreview}
                        onClick={() => {
                          setLoadingPreview(version.id);
                          startPreview(async () => {
                            const result = await previewVersionWeekAction(version.id);
                            if (result.ok) setPreview({ version, week: result.data });
                            else toast.error(result.error.message);
                            setLoadingPreview(null);
                          });
                        }}
                      >
                        {isLoadingPreview && loadingPreview === version.id ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Eye aria-hidden />
                        )}
                        {t("preview")}
                      </Button>
                    )}

                    {canPublish && !isPublished ? (
                      <Button size="sm" disabled={isPending} onClick={() => setPublishing(version.id)}>
                        <Upload aria-hidden />
                        {t("publishAction")}
                      </Button>
                    ) : null}

                    {/*
                      Without this a published schedule was permanent: nothing
                      could take it back off the club's calendar.
                    */}
                    {canPublish && isPublished ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => setWithdrawing(version.id)}
                      >
                        <Undo2 aria-hidden />
                        {t("withdraw")}
                      </Button>
                    ) : null}

                    {canReview && !isPublished ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={isPending}
                        aria-label={t("discard")}
                        onClick={() => setDiscarding(version.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={publishing !== null}
        onOpenChange={(open) => !open && setPublishing(null)}
        title={t("publishConfirmTitle")}
        description={t("publishConfirmBody")}
        confirmLabel={t("publishAction")}
        onConfirm={() =>
          run(() => publishScheduleAction(publishing!), {
            success: () => t("published"),
            onSuccess: () => setPublishing(null),
          })
        }
      />

      {preview ? (
        <VersionPreview
          versionId={preview.version.id}
          versionLabel={
            preview.version.name ?? t("versionNumber", { number: preview.version.number })
          }
          timezone={timezone}
          initialWeek={preview.week}
          onOpenChange={(next) => !next && setPreview(null)}
        />
      ) : null}

      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => !open && setWithdrawing(null)}
        title={t("withdrawConfirmTitle")}
        description={t("withdrawConfirmBody")}
        confirmLabel={t("withdraw")}
        onConfirm={() =>
          run(() => withdrawScheduleAction(withdrawing!), {
            success: () => t("withdrawn"),
            onSuccess: () => setWithdrawing(null),
          })
        }
      />

      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        title={t("discardConfirmTitle")}
        description={t("discardConfirmBody")}
        confirmLabel={t("discard")}
        onConfirm={() =>
          run(() => discardVersionAction(discarding!), {
            success: () => t("discarded"),
            onSuccess: () => setDiscarding(null),
          })
        }
      />
    </>
  );
}
