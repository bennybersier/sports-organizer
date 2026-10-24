/**
 * Keeps a `Table` a grid on a phone, scrolling sideways, instead of the stack
 * of cards `components/ui/table` turns it into below `lg`.
 *
 * For box scores only. A box score is read across a row and down a column at
 * once — who scored the threes, did the totals add up — and as cards it becomes
 * a dozen cards of six labelled numbers that cannot be compared with each other.
 *
 * Put it on the element wrapping the `Table`. The descendant selectors outrank
 * the single-class `max-lg:*` utilities on the table's own parts, so nothing in
 * the shared component has to know about the exception.
 */
export const SCROLLING_GRID = [
  "overflow-x-auto",
  "max-lg:[&_table]:table",
  "max-lg:[&_thead]:table-header-group",
  "max-lg:[&_tbody]:table-row-group",
  "max-lg:[&_tr]:static max-lg:[&_tr]:table-row max-lg:[&_tr]:rounded-none",
  "max-lg:[&_tr]:border-0 max-lg:[&_tr]:border-b max-lg:[&_tr]:p-0",
  "max-lg:[&_td]:table-cell max-lg:[&_td]:p-2 max-lg:[&_td]:whitespace-nowrap",
  "max-lg:[&_td]:before:content-none",
].join(" ");
