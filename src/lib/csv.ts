/**
 * Writing CSV that Excel will actually open.
 *
 * A fixture list leaves this app to be read in a spreadsheet, and plain
 * comma-separated UTF-8 is the one thing Excel handles badly: it assumes the
 * system code page, so Cantù arrives as CantÃ¹ and Sant'Angelo loses its
 * apostrophe. Two conventions fix it, and both are Excel's rather than CSV's.
 *
 * A byte-order mark, so the file is recognised as UTF-8 rather than guessed at.
 * And a semicolon delimiter, which is what Excel expects wherever the comma is
 * a decimal separator — most of Europe, and certainly Italy. Anything that
 * reads real CSV copes with either; Excel only copes with these.
 */

const BOM = "﻿";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * A field, quoted only when it has to be.
 *
 * Quotes are doubled inside a quoted field — the escape CSV actually defines,
 * rather than a backslash, which spreadsheets do not understand.
 */
function escape(value: string | number | null | undefined, delimiter: string): string {
  if (value === null || value === undefined) return "";

  const text = String(value);
  const needsQuotes =
    text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");

  return needsQuotes ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  options: { delimiter?: string; bom?: boolean } = {},
): string {
  const delimiter = options.delimiter ?? ";";
  const lines = [
    columns.map((column) => escape(column.header, delimiter)).join(delimiter),
    ...rows.map((row) =>
      columns.map((column) => escape(column.value(row), delimiter)).join(delimiter),
    ),
  ];

  // CRLF, because that is what the format specifies and what Excel on Windows
  // expects; everything else has coped with it for thirty years.
  return (options.bom === false ? "" : BOM) + lines.join("\r\n");
}

/**
 * Hands the file to the browser.
 *
 * A blob and a synthetic click, because there is nothing to fetch — the file
 * was built here from data already on the page, and a round trip to ask the
 * server for something it just sent would be slower and no more correct.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Safe for a filename on any of the three desktop operating systems. */
export function slugForFile(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
