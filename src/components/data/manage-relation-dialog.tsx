"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiSelect, type MultiSelectOption } from "@/components/data/multi-select";
import { useAction } from "@/hooks/use-action";
import type { ActionResult } from "@/lib/action";

/**
 * Changing what a record is linked to, from the page that shows the links.
 *
 * Every detail page answers the same question — what else does this touch — so
 * changing the answer is one component rather than four. A card that lists two
 * coaches and cannot change them sends somebody to a form three fields away
 * from what they were looking at, and they lose their place.
 *
 * The whole list is sent, not a diff. The service works out what was added and
 * what was removed, which is the only way two people editing the same squad
 * from different pages end up with a sensible result rather than a race.
 */
export function ManageRelationDialog({
  title,
  description,
  options,
  selected,
  save,
  label,
}: {
  title: string;
  description?: string;
  options: MultiSelectOption[];
  /** Ids currently linked. The dialog opens showing exactly these. */
  selected: string[];
  save: (relatedIds: string[]) => Promise<ActionResult<{ count: number }>>;
  /** Overrides the pencil, where a card would rather say "Add athletes". */
  label?: string;
}) {
  const tCommon = useTranslations("common");
  const { run, isPending } = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string[]>(selected);

  return (
    <>
      <Button
        variant="ghost"
        size={label ? "sm" : "icon-xs"}
        aria-label={label ?? title}
        title={label ?? title}
        onClick={() => {
          // Reopening after a save should show what is there now, not the
          // selection somebody abandoned last time.
          setValue(selected);
          setOpen(true);
        }}
      >
        <Pencil aria-hidden />
        {label}
      </Button>

      {open ? (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>

            <MultiSelect
              options={options}
              value={value}
              onChange={setValue}
              placeholder={title}
              emptyText={tCommon("none")}
              disabled={isPending}
            />

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={() =>
                  run(() => save(value), {
                    success: () => tCommon("saved"),
                    onSuccess: () => setOpen(false),
                  })
                }
                disabled={isPending}
              >
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tCommon("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
