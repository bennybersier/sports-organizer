import "server-only";

import { z } from "zod";

/**
 * Shared list-query plumbing.
 *
 * Every collection page needs the same four things — search, filter, sort,
 * paginate — done server-side. The spec is explicit that large collections must
 * not be pulled into the browser to be filtered there, so this is the only way
 * list pages read data.
 */

export const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export const listParamsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
  sort: z.string().max(40).optional(),
  dir: z.enum(["asc", "desc"]).catch("asc"),
});

export type ListParams = z.infer<typeof listParamsSchema>;

/**
 * Parses raw searchParams. Malformed values fall back to defaults rather than
 * throwing: a hand-edited URL should degrade to a sane list, not a crash.
 */
export function parseListParams(
  searchParams: Record<string, string | string[] | undefined>,
): ListParams {
  const flat = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  return listParamsSchema.parse(flat);
}

export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** True when a search or filter is active — drives "no results" vs "nothing yet". */
  filtered: boolean;
}

export function paginationRange(params: ListParams): { from: number; to: number } {
  const from = (params.page - 1) * params.pageSize;
  return { from, to: from + params.pageSize - 1 };
}

export function buildListResult<T>(
  rows: T[],
  total: number,
  params: ListParams,
  filtered: boolean,
): ListResult<T> {
  return {
    rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.max(1, Math.ceil(total / params.pageSize)),
    filtered,
  };
}

/**
 * Escapes a user search term for PostgREST's `or=(...)` filter syntax.
 *
 * Commas and parentheses are structural in that grammar, and `%` / `_` are
 * wildcards in LIKE — an unescaped term like `a,b)` would otherwise be parsed
 * as filter syntax rather than searched for.
 */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[%_\\]/g, (match) => `\\${match}`).replace(/[(),]/g, " ");
}

/** Builds a PostgREST `or` expression matching `term` across several columns. */
export function searchAcross(columns: string[], term: string): string {
  const safe = escapeSearchTerm(term);
  return columns.map((column) => `${column}.ilike.*${safe}*`).join(",");
}

/**
 * Counts related rows for a page of parents, in one query.
 *
 * PostgREST can embed `teams(count)` directly, but that needs relationship
 * metadata the hand-written schema types don't carry yet. Fetching the keys and
 * tallying them here is one extra indexed query per page — not an N+1 — and
 * stays correct regardless. Swap to an embed once `pnpm db:types` can run.
 */
export function tally(rows: { [key: string]: unknown }[], key: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "string") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
