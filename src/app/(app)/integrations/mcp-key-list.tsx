"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AlertCircle, Check, Copy, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import {
  createMcpKeyAction,
  revokeMcpKeyAction,
  rotateMcpKeyAction,
} from "@/server/actions/mcp";
import type { McpKeyView } from "@/server/services/mcp-key-service";

/** Scopes worth offering; the rest are inherited from the owner's read access. */
const GRANTABLE = [
  "schedule.generate",
  "schedule.publish",
  "calendar.create",
  "calendar.update",
  "teams.update",
  "athletes.update",
] as const;

export function McpKeyList({
  keys,
  endpoint,
  availableScopes,
}: {
  keys: McpKeyView[];
  endpoint: string;
  availableScopes: string[];
}) {
  const t = useTranslations("mcp");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { run, isPending } = useAction();

  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ secret: string; name?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState("");

  // Only offer scopes the creator actually holds — a key can never exceed them.
  const offerable = GRANTABLE.filter((scope) => availableScopes.includes(scope));

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(tCommon("copied"));
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" aria-hidden />
                {t("title")}
              </CardTitle>
              <CardDescription>{t("subtitle")}</CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("create")}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle aria-hidden />
            <AlertDescription>{t("explainer")}</AlertDescription>
          </Alert>

          <div className="grid gap-1">
            <Label htmlFor="mcp-endpoint">{t("endpoint")}</Label>
            <div className="flex items-center gap-2">
              <Input id="mcp-endpoint" readOnly value={endpoint} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                aria-label={tCommon("copy")}
                onClick={() => copy(endpoint)}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("endpointHint")}</p>
          </div>

          {keys.length === 0 ? (
            <div className="rounded-lg border p-4 text-center">
              <p className="font-medium">{t("noKeys")}</p>
              <p className="text-sm text-muted-foreground">{t("noKeysBody")}</p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {keys.map((key) => (
                <li key={key.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{key.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{key.prefix}…</code>
                    {key.revokedAt ? (
                      <Badge variant="destructive">{t("revokedLabel")}</Badge>
                    ) : (
                      <Badge variant="outline">
                        {key.scopes.length === 0
                          ? t("allScopes")
                          : t("scopeCount", { count: key.scopes.length })}
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {t("owner")} {key.ownerEmail} ·{" "}
                    {key.lastUsedAt
                      ? t("lastUsed", {
                          date: format.dateTime(new Date(key.lastUsedAt), { dateStyle: "medium" }),
                        })
                      : t("neverUsed")}{" "}
                    ·{" "}
                    {key.expiresAt
                      ? t("expiresAt", {
                          date: format.dateTime(new Date(key.expiresAt), { dateStyle: "medium" }),
                        })
                      : t("noExpiry")}
                  </p>

                  {!key.revokedAt ? (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          run(() => rotateMcpKeyAction(key.id), {
                            success: () => t("rotated"),
                            onSuccess: (data) => setIssued({ secret: data.secret, name: key.name }),
                          })
                        }
                      >
                        <RefreshCw aria-hidden />
                        {t("rotate")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setRevoking(key.id)}
                      >
                        <Trash2 aria-hidden />
                        {t("revoke")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Creation */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("create")}</DialogTitle>
            <DialogDescription>{t("explainer")}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[55vh] pr-4">
            <div className="space-y-4">
              <div className="grid gap-1">
                <Label htmlFor="mcp-name">{t("name")}</Label>
                <Input
                  id="mcp-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("nameHint")}</p>
              </div>

              {offerable.length > 0 ? (
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">{t("scopes")}</legend>
                  {offerable.map((scope) => (
                    <div key={scope} className="flex items-center gap-2">
                      <Checkbox
                        id={`scope-${scope}`}
                        checked={scopes.includes(scope)}
                        onCheckedChange={(value) =>
                          setScopes((current) =>
                            value === true
                              ? [...current, scope]
                              : current.filter((item) => item !== scope),
                          )
                        }
                      />
                      <Label htmlFor={`scope-${scope}`} className="font-mono text-xs font-normal">
                        {scope}
                      </Label>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">{t("scopesHint")}</p>
                </fieldset>
              ) : null}

              <div className="grid gap-1">
                <Label htmlFor="mcp-expiry">{t("expires")}</Label>
                <Input
                  id="mcp-expiry"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">{t("expiresHint")}</p>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={isPending || !name}
              onClick={() =>
                run(() => createMcpKeyAction({ name, scopes, expiresInDays }), {
                  success: () => t("created"),
                  onSuccess: (data) => {
                    setIssued({ secret: data.secret, name: data.name });
                    setCreating(false);
                    setName("");
                    setScopes([]);
                    setExpiresInDays("");
                  },
                })
              }
            >
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The one and only time the secret exists in plaintext. */}
      <Dialog open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createdTitle")}</DialogTitle>
            <DialogDescription>{t("createdBody")}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <Input readOnly value={issued?.secret ?? ""} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              aria-label={tCommon("copy")}
              onClick={() => copy(issued!.secret)}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={() => setIssued(null)}>{tCommon("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("revokeConfirmTitle")}
        description={t("revokeConfirmBody")}
        confirmLabel={t("revoke")}
        onConfirm={() =>
          run(() => revokeMcpKeyAction(revoking!), {
            success: () => t("revoked"),
            onSuccess: () => setRevoking(null),
          })
        }
      />
    </>
  );
}
