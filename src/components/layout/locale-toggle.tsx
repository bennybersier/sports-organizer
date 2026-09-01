"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { setLocale } from "@/server/actions/preferences";

/**
 * Language picker.
 *
 * Each language is named in its own language — someone looking for Italian
 * scans for "Italiano", not for "Italian" written in a language they can't read.
 */
export function LocaleToggle() {
  const current = useLocale();
  const t = useTranslations("errors");
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenuRadioGroup
      value={current}
      onValueChange={(next) =>
        startTransition(async () => {
          const result = await setLocale({ locale: next });
          if (!result.ok) toast.error(t(result.error.code));
        })
      }
    >
      {LOCALES.map((locale) => (
        <DropdownMenuRadioItem
          key={locale}
          value={locale}
          disabled={isPending}
          className="[&>span:first-child]:hidden pl-2"
        >
          <span className="mr-2 w-4 text-center text-xs font-medium uppercase text-muted-foreground">
            {locale}
          </span>
          <span className="flex-1">{LOCALE_NAMES[locale]}</span>
          {isPending && current !== locale ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : current === locale ? (
            <Check className="size-4" aria-hidden />
          ) : null}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
