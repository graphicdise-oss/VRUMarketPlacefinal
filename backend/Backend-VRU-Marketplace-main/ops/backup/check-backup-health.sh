#!/usr/bin/env bash
#
# Answers one question: "is the backup still working?" — the "รู้ได้ยังไง" half of #21's
# acceptance criteria. Who gets told is still a person's call (see README.md); this script is
# the thing they point their monitor, their cron mail, or their own eyes at.
#
# Silent and exit 0 when healthy, loud on stderr and exit 1 when not. That shape is deliberate:
# cron mails whatever a job prints, so a healthy run must print nothing or the mail becomes
# noise people learn to ignore — and a backup alert people ignore is the same as no alert.
#
# It deliberately does NOT trust the last run's own success message alone. The failure this
# project is actually exposed to is not "backup.sh crashed" (cron mails that already), it is
# the quiet one: the NAS unmounts, or the mount goes read-only, and every run afterwards
# writes into an empty local directory that looks fine from the outside. So the artifacts
# named by the last run are re-checked for real, on disk, every time.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${BACKUP_CONFIG_FILE:-$SCRIPT_DIR/backup.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
else
  echo "BACKUP UNHEALTHY: no config file at $CONFIG_FILE" >&2
  exit 1
fi

: "${BACKUP_DEST_DIR:?Set BACKUP_DEST_DIR in backup.env}"
# Daily cron plus half a day of slack, so a single late or slow run does not page anyone but
# a skipped one does. Raise it if backup.sh is scheduled less often than daily.
: "${MAX_AGE_HOURS:=36}"

fail() {
  echo "BACKUP UNHEALTHY: $1" >&2
  echo "  destination: $BACKUP_DEST_DIR" >&2
  exit 1
}

# A missing destination directory usually means the mount is gone, not that someone deleted a
# folder — which is exactly the case where backup.sh would otherwise keep "succeeding".
[[ -d "$BACKUP_DEST_DIR" ]] || fail "destination directory does not exist (is the disk/NAS still mounted?)"

STATUS_FILE="$BACKUP_DEST_DIR/latest-status"
[[ -f "$STATUS_FILE" ]] || fail "no latest-status file — backup.sh has never completed a run here"

STATUS_LINE="$(cat "$STATUS_FILE")"
read -r STATUS_TIMESTAMP STATUS_WORD STATUS_RUN_DIR <<<"$STATUS_LINE"

[[ "$STATUS_WORD" == "OK" ]] || fail "last run did not report OK: $STATUS_LINE"

# Age is measured from the file's mtime rather than by parsing the timestamp in it, so a
# destination that silently stopped accepting writes shows up as stale even if the line inside
# still reads OK from an older successful run.
NOW_EPOCH="$(date -u +%s)"
STATUS_EPOCH="$(date -u -r "$STATUS_FILE" +%s)"
AGE_HOURS=$(( (NOW_EPOCH - STATUS_EPOCH) / 3600 ))

if (( AGE_HOURS > MAX_AGE_HOURS )); then
  fail "last successful backup was ${AGE_HOURS}h ago, over the ${MAX_AGE_HOURS}h limit (run at $STATUS_TIMESTAMP)"
fi

# Re-check the artifacts themselves. Retention pruning, a full disk, or a half-restored
# destination can all leave latest-status pointing at a run directory that is no longer there.
[[ -n "${STATUS_RUN_DIR:-}" ]] || fail "latest-status names no run directory: $STATUS_LINE"
[[ -d "$STATUS_RUN_DIR" ]] || fail "run directory from latest-status is gone: $STATUS_RUN_DIR"
[[ -s "$STATUS_RUN_DIR/database.dump" ]] || fail "database.dump missing or empty in $STATUS_RUN_DIR"
[[ -s "$STATUS_RUN_DIR/uploads.tar.gz" ]] || fail "uploads.tar.gz missing or empty in $STATUS_RUN_DIR"

# Only reached when there is nothing to say. --verbose exists for the person running it by
# hand who wants confirmation rather than silence.
if [[ "${1:-}" == "--verbose" ]]; then
  echo "BACKUP HEALTHY: last run $STATUS_TIMESTAMP (${AGE_HOURS}h ago) at $STATUS_RUN_DIR"
fi
