#!/usr/bin/env bash
#
# One backup run: pg_dump the database and tar the uploads volume, together, timestamped
# together, in the same folder. See README.md for why they can never be taken separately
# (a row pointing at a missing file is as bad as a missing row) and for what every config
# variable below means.
#
# Exit code is the whole point of this script for cron: 0 means both artifacts exist and are
# non-empty, anything else means the run did not produce a usable backup and should not be
# silently treated as one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${BACKUP_CONFIG_FILE:-$SCRIPT_DIR/backup.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
else
  echo "No config file at $CONFIG_FILE — copy backup.env.example to backup.env and fill it in first." >&2
  exit 1
fi

: "${COMPOSE_PROJECT_DIR:?Set COMPOSE_PROJECT_DIR in backup.env}"
: "${BACKUP_DEST_DIR:?Set BACKUP_DEST_DIR in backup.env — must be a separate disk/mount, see README.md}"
: "${POSTGRES_DB:=vru_marketplace}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_SERVICE:=postgres}"
: "${API_SERVICE:=api}"
: "${RETENTION_DAYS:=30}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$BACKUP_DEST_DIR/$TIMESTAMP"

echo "[$TIMESTAMP] backup starting -> $RUN_DIR"
mkdir -p "$RUN_DIR"

cd "$COMPOSE_PROJECT_DIR"

# 1. Database — pg_dump runs *inside* the postgres container, through the same binary that
# wrote the data, so there is never a client/server version mismatch to worry about.
echo "[$TIMESTAMP] dumping database..."
docker compose exec -T "$POSTGRES_SERVICE" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$RUN_DIR/database.dump"

# 2. Uploads volume — resolve the real (compose-prefixed) Docker volume name from the api
# container's own mounts, rather than guessing the prefix, so this keeps working whatever the
# compose project name happens to be on this host.
UPLOADS_VOLUME="${UPLOADS_VOLUME:-}"
if [[ -z "$UPLOADS_VOLUME" ]]; then
  API_CONTAINER_ID="$(docker compose ps -q "$API_SERVICE")"
  if [[ -z "$API_CONTAINER_ID" ]]; then
    echo "Could not find a running '$API_SERVICE' container to resolve the uploads volume from." >&2
    echo "Either start it first, or set UPLOADS_VOLUME explicitly in backup.env." >&2
    exit 1
  fi
  UPLOADS_VOLUME="$(
    docker inspect "$API_CONTAINER_ID" \
      --format '{{ range .Mounts }}{{ if eq .Destination "/var/lib/vru-marketplace/uploads" }}{{ .Name }}{{ end }}{{ end }}'
  )"
fi
: "${UPLOADS_VOLUME:?Could not resolve the uploads volume name — set UPLOADS_VOLUME explicitly in backup.env}"

echo "[$TIMESTAMP] archiving uploads volume ($UPLOADS_VOLUME)..."
docker run --rm \
  -v "$UPLOADS_VOLUME":/data:ro \
  -v "$RUN_DIR":/backup \
  alpine:3 \
  tar czf /backup/uploads.tar.gz -C /data .

# Both artifacts must exist and be non-empty, or this run is not a valid backup — never leave
# a half-written run directory that a later restore would silently trust.
if [[ ! -s "$RUN_DIR/database.dump" ]]; then
  echo "database.dump is missing or empty — this run failed." >&2
  exit 1
fi
if [[ ! -s "$RUN_DIR/uploads.tar.gz" ]]; then
  echo "uploads.tar.gz is missing or empty — this run failed." >&2
  exit 1
fi

echo "$TIMESTAMP OK" > "$RUN_DIR/STATUS"
# What an external monitor watches: file exists, mtime is recent, contents say OK. Nothing in
# this repo wires an actual alert to it — that assignment is the project owner's to make
# (see README.md "เหลืออะไรให้คนตัดสิน").
echo "$TIMESTAMP OK $RUN_DIR" > "$BACKUP_DEST_DIR/latest-status"

# Retention: delete run directories older than RETENTION_DAYS. -mindepth/-maxdepth 1 so this
# only ever touches the timestamped subfolders this script itself created, never
# BACKUP_DEST_DIR's own latest-status file sitting beside them.
find "$BACKUP_DEST_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} +

echo "[$TIMESTAMP] backup complete: $RUN_DIR"
