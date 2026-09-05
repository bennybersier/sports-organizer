import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ScrollText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AccessDenied } from "@/components/data/access-denied";
import { EmptyState } from "@/components/data/empty-state";
import { ListToolbar } from "@/components/data/list-toolbar";
import { PageHeader } from "@/components/data/page-header";
import { PaginationBar } from "@/components/data/pagination-bar";
import { hasPermission } from "@/server/auth/authorization";
import { requireAuthContext } from "@/server/auth/context";
import { listAuditActions, listAuditEntries } from "@/server/services/audit-query-service";
import { parseListParams } from "@/server/services/list-query";
import { SHORT_TIME_FORMAT } from "@/lib/time-format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAuthContext();
  if (!hasPermission(context, "audit_logs.read")) return <AccessDenied />;

  const t = await getTranslations("audit");
  const tCommon = await getTranslations("common");
  const tList = await getTranslations("list");
  const format = await getFormatter();

  const raw = await searchParams;
  const params = parseListParams(raw);
  const action = typeof raw.action === "string" ? raw.action : undefined;

  const [result, actions] = await Promise.all([
    listAuditEntries(context, params, { action }),
    listAuditActions(context),
  ]);

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <ListToolbar
        placeholder={t("searchPlaceholder")}
        filters={
          actions.length > 0
            ? [
                {
                  name: "action",
                  label: t("action"),
                  allLabel: t("allActions"),
                  options: actions.map((value) => ({ value, label: humanise(value) })),
                },
              ]
            : []
        }
      />

      {result.rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={result.filtered ? tList("noResults") : t("emptyTitle")}
          description={result.filtered ? tList("noResultsBody") : t("emptyBody")}
        />
      ) : (
        <>
          <Card className="p-0">
            <ul className="divide-y">
              {result.rows.map((entry) => (
                <li key={entry.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{humanise(entry.action)}</span>
                    <Badge variant="outline">{entry.resourceType}</Badge>
                    {entry.actorType !== "WEB" ? (
                      <Badge variant="secondary">{viaLabel(t, entry.actorType)}</Badge>
                    ) : null}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {format.dateTime(new Date(entry.createdAt), {
                        dateStyle: "medium",
                        ...SHORT_TIME_FORMAT,
                        timeZone: context.tenant.timezone,
                      })}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {entry.actorName ?? t("system")}
                  </p>

                  {entry.reason ? (
                    <p className="text-sm">
                      <span className="text-muted-foreground">{t("reason")}: </span>
                      {entry.reason}
                    </p>
                  ) : null}

                  {/* The diff is already scrubbed of anything credential-shaped
                      at write time; this only has to render it readably. */}
                  {entry.newValue ? (
                    <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">
                      {formatDiff(entry.oldValue, entry.newValue)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <PaginationBar
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={result.pageSize}
          />
        </>
      )}

      <p className="text-xs text-muted-foreground">{tCommon("notes")}: {t("subtitle")}</p>
    </div>
  );
}

/** SCHEDULE_ENTRY_MOVED -> "Schedule entry moved" */
function humanise(action: string): string {
  const words = action.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const VIA = [
  "WEB",
  "PLATFORM_ADMIN",
  "MCP",
  "AI",
  "JOB",
  "INTEGRATION",
  "SYSTEM",
] as const;

function viaLabel(t: Awaited<ReturnType<typeof getTranslations<"audit">>>, actorType: string) {
  return (VIA as readonly string[]).includes(actorType)
    ? t(`via${actorType as (typeof VIA)[number]}`)
    : actorType;
}

function formatDiff(oldValue: unknown, newValue: unknown): string {
  if (!oldValue) return JSON.stringify(newValue, null, 2);
  return `- ${JSON.stringify(oldValue)}\n+ ${JSON.stringify(newValue)}`;
}
