"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * A filter dropdown you can type into.
 *
 * Replaces `Select` wherever the list is a *filter* rather than a short fixed
 * choice, for two reasons that both bite on a phone.
 *
 * **Searching.** A club with thirty sides cannot find one by scrolling a list
 * that opens over the thumb. Typing two letters is the only way that scales,
 * and it is the same gesture on a laptop.
 *
 * **Scrolling.** Radix's `Select` scrolls its own viewport through step
 * buttons, which a touch drag does not drive — the list opens and then will not
 * move. `Command`'s list is an ordinary overflowing div, so a finger drags it
 * like any other scroll area. `overscroll-contain` keeps that drag from
 * turning into a page scroll once it reaches the end.
 *
 * The trigger carries the chosen label rather than a placeholder, so the active
 * filter is readable without opening anything.
 */
export function FilterCombobox({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  className,
  /** Shown first and selected when nothing is chosen — "All teams". */
  allOption,
}: {
  value: string | null;
  options: ComboboxOption[];
  onChange: (value: string | null) => void;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
  allOption?: { value: string; label: string };
}) {
  const t = useTranslations("list");
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);
  const label = selected?.label ?? allOption?.label ?? placeholder;

  function choose(next: string | null) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          // min-w-0 and truncate so a long club name shortens the label rather
          // than widening the row it sits in.
          className={cn("min-w-0 justify-between gap-2 font-normal", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // Matches the trigger so the open list lines up under what opened it,
        // and never spills past the viewport on a narrow screen.
        className="w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] p-0"
      >
        <Command>
          <CommandInput placeholder={t("searchPlaceholder")} />
          <CommandList className="overscroll-contain">
            <CommandEmpty>{t("noMatches")}</CommandEmpty>
            <CommandGroup>
              {allOption ? (
                <CommandItem value={allOption.label} onSelect={() => choose(null)}>
                  <Check
                    className={cn("size-4", value === null ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {allOption.label}
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // cmdk filters on this string, so it must be the label a
                  // person would type, never the id.
                  value={option.label}
                  onSelect={() => choose(option.value)}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
