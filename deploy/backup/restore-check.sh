#!/bin/sh
# Proves the logical backup restores (plan T13: "tested, not assumed"): pulls a snapshot from restic into a scratch
# database, counts a few tables, prints how long it took against the RTO of 2 hours, and drops the scratch database.
# The scratch name is generated here, short and unique, and createdb refuses one that exists — so this script can only
# ever drop the database it created itself, never the live one or anything else on a shared server.
#
#   restore-check.sh [snapshot-id]    (default: latest)
set -eu
set -o pipefail
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}"
case "$RESTIC_REPOSITORY" in s3:*) : "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" ;; esac
snapshot="${1:-latest}"
BACKUP_HOST="${BACKUP_HOST:-pospay-$PGDATABASE}"
started="$(date +%s)"
scratch="restore_check_${started}_$$"

createdb "$scratch"
trap 'dropdb "$scratch" || true' EXIT
restic dump --tag logical --host "$BACKUP_HOST" "$snapshot" "$PGDATABASE.dump" \
  | pg_restore --exit-on-error --dbname "$scratch"
psql -X -v ON_ERROR_STOP=1 -d "$scratch" -Atc \
  "select 'companies=' || count(*) from companies union all select 'migrations=' || count(*) from drizzle.__drizzle_migrations"
echo "restored $snapshot into $scratch in $(( $(date +%s) - started ))s (RTO 7200s)"
