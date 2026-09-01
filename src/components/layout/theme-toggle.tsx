"use client";

import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", icon: Sun, labelKey: "themeLight" },
  { value: "dark", icon: Moon, labelKey: "themeDark" },
  { value: "system", icon: Monitor, labelKey: "themeSystem" },
] as const;

/**
 * Light / dark / system picker, rendered inside the account menu.
 *
 * `theme` is undefined until next-themes has read localStorage on the client,
 * so the radio group is left unset on the first paint rather than flashing the
 * wrong selection.
 */
export function ThemeToggle() {
  const t = useTranslations("common");
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
      {OPTIONS.map((option) => (
        <DropdownMenuRadioItem
          key={option.value}
          value={option.value}
          // The default radio indicator would sit where the icon belongs.
          className="[&>span:first-child]:hidden pl-2"
        >
          <option.icon className="mr-2 size-4" aria-hidden />
          <span className="flex-1">{t(option.labelKey)}</span>
          {theme === option.value ? <Check className="size-4" aria-hidden /> : null}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
