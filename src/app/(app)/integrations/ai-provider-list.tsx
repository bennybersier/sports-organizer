"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { PROVIDER_LABELS, type AiProviderId } from "@/domain/ai";
import {
  deleteAiConfigAction,
  setDefaultProviderAction,
  verifyAiConfigAction,
} from "@/server/actions/ai";
import type { AiConfigView } from "@/server/services/ai-config-service";

import { AiProviderDialog } from "./ai-provider-dialog";

/**
 * Configured AI providers.
 *
 * A key is never displayed — only its last four characters, and only so an
 * admin can tell which key is in place without revealing it. "Test key" is the
 * only way to find out whether it works, which is honest: we cannot know
 * without asking the provider.
 */
export function AiProviderList({
  configs,
  canManage,
}: {
  configs: AiConfigView[];
  canManage: boolean;
}) {
  const t = useTranslations("integrations");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { run, isPending } = useAction();

  const [editing, setEditing] = useState<AiConfigView | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AiProviderId | null>(null);

  const configured = new Set(configs.map((config) => config.provider));
  const available = (Object.keys(PROVIDER_LABELS) as AiProviderId[]).filter(
    (id) => !configured.has(id),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4" aria-hidden />
                {t("ai")}
              </CardTitle>
              <CardDescription>{t("aiSubtitle")}</CardDescription>
            </div>
            {canManage && available.length > 0 ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {t("add")}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle aria-hidden />
            <AlertDescription>{t("aiGuardrail")}</AlertDescription>
          </Alert>

          {configs.length === 0 ? (
            <div className="rounded-lg border p-4 text-center">
              <p className="font-medium">{t("noProviders")}</p>
              <p className="text-sm text-muted-foreground">{t("noProvidersBody")}</p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {configs.map((config) => (
                <li key={config.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{PROVIDER_LABELS[config.provider]}</span>
                    {config.isDefault ? (
                      <Badge>{t("active")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("inactive")}</Badge>
                    )}
                    {!config.isEnabled ? (
                      <Badge variant="secondary">{tCommon("INACTIVE")}</Badge>
                    ) : null}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {config.model} · {t("keyEnding", { hint: config.keyHint })}
                  </p>

                  {config.lastError ? (
                    <p className="flex items-center gap-1.5 text-sm text-destructive">
                      <AlertCircle className="size-4 shrink-0" aria-hidden />
                      {config.lastError}
                    </p>
                  ) : config.lastVerifiedAt ? (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                      {t("verifiedAt", {
                        date: format.dateTime(new Date(config.lastVerifiedAt), {
                          dateStyle: "medium",
                        }),
                      })}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("neverVerified")}</p>
                  )}

                  {canManage ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          run(() => verifyAiConfigAction(config.provider), {
                            success: (data) =>
                              data.ok ? t("verified") : (data.message ?? t("neverVerified")),
                          })
                        }
                      >
                        {isPending ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : null}
                        {t("verify")}
                      </Button>

                      <Button size="sm" variant="outline" onClick={() => setEditing(config)}>
                        {t("edit")}
                      </Button>

                      {!config.isDefault ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            run(() => setDefaultProviderAction(config.provider), {
                              success: () => t("saved"),
                            })
                          }
                        >
                          {t("makeDefault")}
                        </Button>
                      ) : null}

                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-8"
                        aria-label={tCommon("remove")}
                        onClick={() => setRemoving(config.provider)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {adding ? (
        <AiProviderDialog
          available={available}
          open={adding}
          onOpenChange={setAdding}
        />
      ) : null}

      {editing ? (
        <AiProviderDialog
          available={[editing.provider]}
          existing={editing}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("removeConfirmTitle")}
        description={t("removeConfirmBody")}
        confirmLabel={tCommon("remove")}
        onConfirm={() =>
          run(() => deleteAiConfigAction(removing!), {
            success: () => t("removed"),
            onSuccess: () => setRemoving(null),
          })
        }
      />
    </>
  );
}
