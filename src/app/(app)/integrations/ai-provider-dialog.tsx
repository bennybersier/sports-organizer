"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { DEFAULT_MODELS, PROVIDER_LABELS, type AiProviderId } from "@/domain/ai";
import { saveAiConfigAction } from "@/server/actions/ai";
import type { AiConfigView } from "@/server/services/ai-config-service";

export function AiProviderDialog({
  available,
  existing,
  open,
  onOpenChange,
}: {
  available: AiProviderId[];
  existing?: AiConfigView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("integrations");
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();

  const [provider, setProvider] = useState<AiProviderId>(existing?.provider ?? available[0]);
  const [model, setModel] = useState(existing?.model ?? DEFAULT_MODELS[available[0]]);
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(existing?.isEnabled ?? true);
  const [makeDefault, setMakeDefault] = useState(existing?.isDefault ?? true);

  function changeProvider(next: AiProviderId) {
    setProvider(next);
    // Follow the provider's default model unless the admin typed their own.
    if (!existing) setModel(DEFAULT_MODELS[next]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? t("edit") : t("add")}</DialogTitle>
          <DialogDescription>{t("aiSubtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1">
            <Label htmlFor="ai-provider">{t("provider")}</Label>
            <Select
              value={provider}
              onValueChange={(value) => changeProvider(value as AiProviderId)}
              disabled={Boolean(existing)}
            >
              <SelectTrigger id="ai-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((id) => (
                  <SelectItem key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="ai-model">{t("model")}</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="font-mono text-sm"
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="ai-key">{t("apiKey")}</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={existing ? "••••••••" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {existing ? t("apiKeyKeep") : t("apiKeyHint")}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="ai-enabled"
                checked={isEnabled}
                onCheckedChange={(value) => setIsEnabled(value === true)}
              />
              <Label htmlFor="ai-enabled" className="font-normal">
                {t("enabled")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="ai-default"
                checked={makeDefault}
                onCheckedChange={(value) => setMakeDefault(value === true)}
              />
              <Label htmlFor="ai-default" className="font-normal">
                {t("makeDefault")}
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={isPending || !model || (!existing && apiKey.length < 10)}
            onClick={() =>
              run(
                () =>
                  saveAiConfigAction({
                    provider,
                    model,
                    apiKey: apiKey || undefined,
                    isEnabled,
                    makeDefault,
                  }),
                { success: () => t("saved"), onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
