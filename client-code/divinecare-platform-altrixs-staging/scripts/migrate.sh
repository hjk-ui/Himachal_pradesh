#!/usr/bin/env bash
# ============================================================================
# scripts/migrate.sh: apply hand-written SQL migrations with a ledger.
#
# Each file in prisma/migrations/*.sql (plus the one legacy Prisma folder
# prisma/migrations/*/migration.sql) is applied at most once, in filename order
# (byte order, LC_ALL=C), and recorded in _altrixs_migrations with its sha256.
#
#   scripts/migrate.sh              apply every file not yet recorded
#   scripts/migrate.sh --status     list applied / pending / changed files, apply nothing
#   scripts/migrate.sh --baseline   record every file as applied WITHOUT running it
#                                   (use once on a database that already has them all)
#   scripts/migrate.sh --baseline --through 20261018_valant_payers.sql
#                                   record only files up to and including that name; the
#                                   later ones stay pending for a normal run
#
# Options: --dir <path> (default prisma/migrations), --env-file <path> (default .env,
# read only when DATABASE_URL is not already set).
#
# Each file runs inside one transaction (psql -1 -v ON_ERROR_STOP=1) together with its
# ledger row, so a failure leaves neither half-applied SQL nor a ledger row. Files that
# cannot run in a transaction (CREATE/DROP INDEX CONCURRENTLY, REINDEX CONCURRENTLY,
# VACUUM, ALTER SYSTEM, or their own BEGIN/COMMIT), or that carry the marker comment
# `-- altrixs:no-transaction`, run statement by statement; their ledger row is written
# only after psql succeeds. All migrations must stay idempotent so a re-run is safe.
#
# Exits 1 when a recorded file's checksum changed (edit a NEW migration instead), when a
# migration fails, or when DATABASE_URL is missing.
# ============================================================================
set -euo pipefail

MODE=apply
DIR=prisma/migrations
ENV_FILE=.env
THROUGH=

while [ $# -gt 0 ]; do
  case "$1" in
    --baseline) MODE=baseline ;;
    --status) MODE=status ;;
    --through) THROUGH="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --env-file) ENV_FILE="$2"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "migrate: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  # Read only the DATABASE_URL line; do not source the whole .env.
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$ENV_FILE" | tail -n 1 || true)"
  if [ -n "$line" ]; then
    DATABASE_URL="${line#*DATABASE_URL=}"
    DATABASE_URL="${DATABASE_URL%$'\r'}"
    DATABASE_URL="${DATABASE_URL#\"}"; DATABASE_URL="${DATABASE_URL%\"}"
    DATABASE_URL="${DATABASE_URL#\'}"; DATABASE_URL="${DATABASE_URL%\'}"
  fi
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "migrate: DATABASE_URL is not set (and not found in $ENV_FILE)" >&2
  exit 1
fi

# psql rejects Prisma-only query parameters (schema, connection_limit, pool_timeout,
# pgbouncer, ...). Drop them and keep the libpq ones (sslmode, sslrootcert, ...).
psql_url() {
  local url="$1" base query out="" kv
  case "$url" in *\?*) base="${url%%\?*}"; query="${url#*\?}" ;; *) echo "$url"; return ;; esac
  IFS='&' read -r -a parts <<< "$query"
  for kv in "${parts[@]}"; do
    case "${kv%%=*}" in
      schema|connection_limit|pool_timeout|pgbouncer|statement_cache_size|socket_timeout|connect_timeout_ms) ;;
      *) out="${out:+$out&}$kv" ;;
    esac
  done
  if [ -n "$out" ]; then echo "$base?$out"; else echo "$base"; fi
}
PGURL="$(psql_url "$DATABASE_URL")"

APPLIED_BY="${MIGRATE_APPLIED_BY:-$(whoami 2>/dev/null || echo unknown)@$(hostname 2>/dev/null || echo unknown)}"
if REV="$(git rev-parse --short HEAD 2>/dev/null)"; then APPLIED_BY="$APPLIED_BY ($REV)"; fi

PSQL=(psql "$PGURL" -X -q -v ON_ERROR_STOP=1)

sql_literal() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

# sha256 of the file with CR stripped, so a CRLF checkout hashes the same as LF.
checksum() { tr -d '\r' < "$1" | sha256sum | awk '{print $1}'; }

# true when the file cannot run inside a single transaction (comment lines ignored)
needs_no_transaction() {
  grep -qiE -- '--[[:space:]]*altrixs:no-transaction' "$1" && return 0
  sed -E 's/--.*$//' "$1" | tr -d '\r' | grep -qiE \
    '(CREATE([[:space:]]+UNIQUE)?[[:space:]]+INDEX[[:space:]]+CONCURRENTLY|DROP[[:space:]]+INDEX[[:space:]]+CONCURRENTLY|REINDEX[[:space:]].*CONCURRENTLY|^[[:space:]]*VACUUM|ALTER[[:space:]]+SYSTEM|^[[:space:]]*(BEGIN|COMMIT|START[[:space:]]+TRANSACTION)[[:space:]]*;)'
}

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS _altrixs_migrations (
  filename   text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text
);" >/dev/null

declare -A RECORDED=()
while IFS='|' read -r name sum; do
  [ -n "$name" ] && RECORDED["$name"]="$sum"
done < <("${PSQL[@]}" -At -c "SELECT filename || '|' || checksum FROM _altrixs_migrations")

mapfile -t FILES < <(cd "$DIR" && { ls -1 *.sql 2>/dev/null; ls -1 */migration.sql 2>/dev/null; } | LC_ALL=C sort)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "migrate: no .sql files in $DIR" >&2
  exit 1
fi

# 1) Refuse when any recorded file changed.
changed=0
for name in "${FILES[@]}"; do
  if [ -n "${RECORDED[$name]+x}" ]; then
    sum="$(checksum "$DIR/$name")"
    if [ "$sum" != "${RECORDED[$name]}" ]; then
      echo "migrate: CHECKSUM CHANGED for already-applied $name" >&2
      echo "         recorded ${RECORDED[$name]}" >&2
      echo "         on disk  $sum" >&2
      changed=1
    fi
  fi
done
if [ "$changed" -ne 0 ]; then
  echo "migrate: refusing to continue. Never edit an applied migration; add a new file." >&2
  exit 1
fi

pending=()
for name in "${FILES[@]}"; do
  [ -z "${RECORDED[$name]+x}" ] && pending+=("$name")
done

if [ -n "$THROUGH" ]; then
  if [ "$MODE" != baseline ]; then echo "migrate: --through is only for --baseline" >&2; exit 2; fi
  if [ ! -f "$DIR/$THROUGH" ]; then echo "migrate: --through file not found: $DIR/$THROUGH" >&2; exit 2; fi
  kept=()
  for name in "${pending[@]}"; do
    # byte order, same as the apply order
    if [ "$(printf '%s
%s
' "$name" "$THROUGH" | LC_ALL=C sort | head -n 1)" = "$name" ]; then kept+=("$name"); fi
  done
  pending=("${kept[@]}")
fi

if [ "$MODE" = status ]; then
  for name in "${FILES[@]}"; do
    if [ -n "${RECORDED[$name]+x}" ]; then echo "applied  $name"; else echo "PENDING  $name"; fi
  done
  echo "migrate: ${#pending[@]} pending of ${#FILES[@]}"
  exit 0
fi

if [ "${#pending[@]}" -eq 0 ]; then
  echo "migrate: up to date (${#FILES[@]} files recorded)"
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

record_sql() {
  printf 'INSERT INTO _altrixs_migrations (filename, checksum, applied_by) VALUES (%s, %s, %s);\n' \
    "$(sql_literal "$1")" "$(sql_literal "$2")" "$(sql_literal "$APPLIED_BY")" > "$TMP"
}

for name in "${pending[@]}"; do
  file="$DIR/$name"
  sum="$(checksum "$file")"
  record_sql "$name" "$sum"
  if [ "$MODE" = baseline ]; then
    "${PSQL[@]}" -f "$TMP"
    echo "baseline $name"
    continue
  fi
  if needs_no_transaction "$file"; then
    echo "apply    $name (no transaction)"
    "${PSQL[@]}" -f "$file"
    "${PSQL[@]}" -f "$TMP"
  else
    echo "apply    $name"
    # One transaction for the migration and its ledger row (psql 9.6+ wraps every -f in BEGIN/COMMIT).
    "${PSQL[@]}" -1 -f "$file" -f "$TMP"
  fi
done

echo "migrate: done (${#pending[@]} $([ "$MODE" = baseline ] && echo recorded || echo applied))"
