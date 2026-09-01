#!/usr/bin/env bash
#
# Applies supabase/migrations to the project named in .env.local.
#
# Two credential paths, either is enough:
#   SUPABASE_ACCESS_TOKEN  personal access token — the CLI acts as your account
#   SUPABASE_DB_PASSWORD   database password — connects straight to Postgres
#
# Neither is ever printed. .env.local is gitignored, so neither is committed.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.local ] || { echo "No .env.local found."; exit 1; }
set -a; . ./.env.local; set +a

# Derive the project ref from the URL: https://<ref>.supabase.co
REF="${NEXT_PUBLIC_SUPABASE_URL#https://}"
REF="${REF%%.supabase.co*}"
[ -n "$REF" ] || { echo "Could not read a project ref from NEXT_PUBLIC_SUPABASE_URL."; exit 1; }
echo "Project ref: $REF"

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  export SUPABASE_ACCESS_TOKEN
  echo "Using SUPABASE_ACCESS_TOKEN for CLI authentication."
fi

if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  export SUPABASE_DB_PASSWORD
  echo "Using SUPABASE_DB_PASSWORD for the database connection."
  supabase link --project-ref "$REF" --password "$SUPABASE_DB_PASSWORD" </dev/null
else
  supabase link --project-ref "$REF" </dev/null
fi

echo
echo "Applying migrations…"
supabase db push --include-all </dev/null
