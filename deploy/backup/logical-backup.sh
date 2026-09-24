#!/bin/sh
# The logical backup path of plan T13 (T14 on the board): one nightly pg_dump, encrypted by restic into the
# Cloudflare R2 bucket (Waleed 2026-09-24, in place of B2), checked in to Healthchecks.io. It restores the whole
# database to last night; point-in-time recovery is the physical path, not this one.
#
# Every connection detail comes from libpq's own variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE), never from a URL
# on the command line, so no password shows in the process list. The dump runs as the migration owner: FORCE RLS
# would otherwise hide every tenant's rows from it.
set -eu
set -o pipefail
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}"
case "$RESTIC_REPOSITORY" in s3:*) : "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" ;; esac

# A missed or failed check-in is what alerts; the ping itself never fails the backup.
checkin() { [ -z "${HEALTHCHECK_URL:-}" ] || curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECK_URL$1" || true; }
trap 'status=$?; [ "$status" -eq 0 ] || checkin /fail' EXIT
checkin /start

# `restic init` refuses an existing repository, so it only ever runs once; any other failure stops the backup.
restic cat config >/dev/null 2>&1 || restic init
# --stdin-from-command fails the snapshot when pg_dump fails, so a truncated dump is never saved as a good one.
restic backup --tag logical --stdin-filename "$PGDATABASE.dump" --stdin-from-command -- \
  pg_dump --format=custom
restic forget --tag logical --prune \
  --keep-daily "${KEEP_DAILY:-14}" --keep-weekly "${KEEP_WEEKLY:-8}" --keep-monthly "${KEEP_MONTHLY:-6}"
checkin ''
