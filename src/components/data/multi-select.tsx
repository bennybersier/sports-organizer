"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Searchable multi-select, used for assigning trainers to a team and teams to
 * an athlete.
 *
 * Selected items stay visible as removable chips below the trigger, so a long
 * selection doesn't have to be reopened to be read or corrected.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  disabled,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  emptyText: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tCommon = useTranslations("common");

  const selected = options.filter((option) => value.includes(option.value));

  function toggle(optionValue: string) {
    onChange(
      value.includes(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue],
    );
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || options.length === 0}
            className="w-full justify-between font-normal"
          >
            <span className={cn(selected.length === 0 && "text-muted-foreground")}>
              {selected.length === 0
                ? options.length === 0
                  ? emptyText
                  : placeholder
                : `${selected.length} ${tCommon("of")} ${options.length}`}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => toggle(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value.includes(option.value) ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {selected.map((option) => (
            <li key={option.value}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {option.label}
                <button
                  type="button"
                  onClick={() => toggle(option.value)}
                  aria-label={`${tCommon("remove")}: ${option.label}`}
                  className="rounded-sm hover:bg-muted-foreground/20"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
