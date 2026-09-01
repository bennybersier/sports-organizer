/** The JSON shape Postgres `jsonb` columns round-trip through PostgREST. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];
