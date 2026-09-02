"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A table on a desktop, a stack of cards on a phone or a tablet held upright.
 *
 * A seven-column table on a 390px screen is either a horizontal scroll nobody
 * finds or a column of unreadable slivers. Below `lg` the same markup collapses
 * into one card per row, each cell becoming a labelled line — so a page
 * describes its data once and gets both layouts, and no page can drift out of
 * step with the other.
 *
 * Labels come from `data-label` on each cell, because a collapsed cell has lost
 * the header that explained it.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full lg:overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm max-lg:block", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // The headers are the cards' labels on mobile, printed per cell instead.
      className={cn("[&_tr]:border-b max-lg:hidden", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0",
        "max-lg:flex max-lg:flex-col max-lg:gap-2",
        className
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        // `relative` so the actions cell can sit in the card's top corner.
        "max-lg:relative max-lg:block max-lg:rounded-lg max-lg:border max-lg:p-3",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * `primary` is the cell that names the row — it keeps the full width of the
 * card and needs no label, because a name explains itself. `actions` is the row
 * menu, pinned to the card's top corner where a thumb expects it.
 */
function TableCell({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"td"> & { variant?: "default" | "primary" | "actions" }) {
  return (
    <td
      data-slot="table-cell"
      data-variant={variant}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        variant === "default" &&
          cn(
            "max-lg:flex max-lg:items-baseline max-lg:justify-between max-lg:gap-3",
            "max-lg:px-0 max-lg:py-1 max-lg:whitespace-normal",
            // The header's text, reprinted where the column used to be.
            "max-lg:before:content-[attr(data-label)] max-lg:before:shrink-0",
            "max-lg:before:text-xs max-lg:before:text-muted-foreground",
          ),
        variant === "primary" &&
          "max-lg:block max-lg:px-0 max-lg:pt-0 max-lg:pb-2 max-lg:pr-10 max-lg:whitespace-normal",
        variant === "actions" && "max-lg:absolute max-lg:top-2 max-lg:right-2 max-lg:p-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
