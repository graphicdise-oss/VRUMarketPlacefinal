#!/usr/bin/env bash
#
# Restores a backup run produced by backup.sh: the database and the uploads volume, together
# — restoring only one half would leave rows pointing at files that do not exist, or files
# nothing references.
#
# ⚠️ DESTRUCTIVE. Overwrites the current database (pg_restore --clean) and the current
# contents of the uploads volume. No confirmation prompt — this is a tool for someone who
# already knows they are restoring, not a button that should be reachable by accident. Read
# it before running it on anything that matters.
#
# Usage: ./restore.sh <path to a backup.sh run directory, e.g. .../20260920T030000Z>

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

RUN_DIR="${1:-}"
if [[ -z "$RUN_DIR" ]]; then
  echo "Usage: $0 <run directory>" >&2
  echo "Example: $0 \"\$BACKUP_DEST_DIR/20260920T030000Z\"" >&2
  exit 1
fi
if [[ ! -f "$RUN_DIR/database.dump" || ! -f "$RUN_DIR/uploads.tar.gz" ]]; then
  echo "$RUN_DIR does not look like a backup.sh run — expected database.dump and uploads.tar.gz in it." >&2
  exit 1
fi

: "${COMPOSE_PROJECT_DIR:?Set COMPOSE_PROJECT_DIR in backup.env}"
: "${POSTGRES_DB:=vru_marketplace}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_SERVICE:=postgres}"
: "${API_SERVICE:=api}"

cd "$COMPOSE_PROJECT_DIR"

echo "Restoring from $RUN_DIR"
echo "This will OVERWRITE the current database and uploads volume. Ctrl-C now to abort."
sleep 5

echo "restoring database..."
# --clean --if-exists: drops existing objects before recreating them, so this works whether
# the target database is empty or already has a (possibly different) schema in it — the same
# reasoning prisma migrate deploy's own idempotency follows, applied to a full restore.
docker compose exec -T "$POSTGRES_SERVICE" \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < "$RUN_DIR/database.dump"

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

echo "restoring uploads volume ($UPLOADS_VOLUME)..."
# Clears the volume first (--delete on an empty source vs full extract would leave stray
# files that were never in this backup), then extracts the archive over it.
docker run --rm \
  -v "$UPLOADS_VOLUME":/data \
  -v "$RUN_DIR":/backup \
  alpine:3 \
  sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar xzf /backup/uploads.tar.gz -C /data"

echo "restore complete — restart the api service so it reconnects with a warm cache: docker compose restart $API_SERVICE"
