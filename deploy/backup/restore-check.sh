#!/bin/sh
# Proves the logical backup restores (plan T13: "tested, not assumed"): pulls a snapshot from restic into a scratch
# database, counts a few tables, prints how long it took against the RTO of 2 hours, and drops the scratch database.
# Never restores over PGDATABASE — the scratch name must differ from it, or the script stops.
#
#   restore-check.sh [snapshot-id]    (default: latest)
set -eu
set -o pipefail
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}"
case "$RESTIC_REPOSITORY" in s3:*) : "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" ;; esac
snapshot="${1:-latest}"
scratch="${RESTORE_DATABASE:-${PGDATABASE}_restore_check}"
[ "$scratch" != "$PGDATABASE" ] || { echo "RESTORE_DATABASE must differ from PGDATABASE"; exit 1; }

started="$(date +%s)"
dropdb --if-exists "$scratch"
createdb "$scratch"
trap 'dropdb --if-exists "$scratch" || true' EXIT
restic dump --tag logical "$snapshot" "$PGDATABASE.dump" \
  | pg_restore --exit-on-error --dbname "$scratch"
psql -X -v ON_ERROR_STOP=1 -d "$scratch" -Atc \
  "select 'companies=' || count(*) from companies union all select 'migrations=' || count(*) from drizzle.__drizzle_migrations"
echo "restored $snapshot into $scratch in $(( $(date +%s) - started ))s (RTO 7200s)"
