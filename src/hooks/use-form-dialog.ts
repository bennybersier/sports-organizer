"use client";

import { useState } from "react";

/**
 * Open state for a dialog that must start blank every time.
 *
 * The problem this solves: a dialog's `useForm` and `useState` live in the
 * component that *renders* the dialog, not inside it. Radix unmounts the
 * content when it closes, but the parent stays mounted — so the form keeps
 * whatever was last typed, and the next "Add team" shows the previous team.
 *
 * Resetting after a successful save is not enough: cancelling, pressing Escape
 * and clicking outside all leave the old values behind too. Resetting on *open*
 * covers every path with one rule.
 *
 * Done in the event handler rather than an effect, so there is no second render
 * pass and no window in which the stale values are visible.
 */
export function useFormDialog(options: {
  /** Supplied when the dialog's open state is owned by a parent (edit mode). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called just before the dialog opens. Clear the form here. */
  onOpen?: () => void;
}): [boolean, (open: boolean) => void] {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = options.open ?? uncontrolled;

  function setOpen(next: boolean) {
    if (next) options.onOpen?.();

    if (options.onOpenChange) options.onOpenChange(next);
    else setUncontrolled(next);
  }

  return [open, setOpen];
}
