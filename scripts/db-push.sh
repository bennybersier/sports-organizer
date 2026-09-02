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

# `supabase link` calls a management endpoint this account cannot reach, and it
# is not needed to apply migrations: connecting straight to Postgres works and
# depends on nothing but the database password.
#
# The URL contains the password, so every byte of output from here on is piped
# through a redactor. The CLI prints the connection string on failure.
redact() { sed -E 's#postgres(ql)?://[^[:space:]]*#[connection string redacted]#g'; }

if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "Connecting directly with SUPABASE_DB_PASSWORD."
  # Percent-encode the password: a `@` or `/` in it would otherwise split the URL.
  ENCODED=$(PW="$SUPABASE_DB_PASSWORD" python3 -c \
    'import os,urllib.parse;print(urllib.parse.quote(os.environ["PW"],safe=""))')
  DB_URL="postgresql://postgres:${ENCODED}@db.${REF}.supabase.co:5432/postgres"

  echo
  echo "Applying migrations…"
  supabase db push --db-url "$DB_URL" --include-all </dev/null 2>&1 | redact
  exit "${PIPESTATUS[0]}"
fi

supabase link --project-ref "$REF" </dev/null

echo
echo "Applying migrations…"
supabase db push --include-all </dev/null 2>&1 | redact
