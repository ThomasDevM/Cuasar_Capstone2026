#!/usr/bin/env sh
# Respaldo diario de la base de datos (PostgreSQL en Docker). Conserva 30 días.
# Programar con cron, por ejemplo:   0 2 * * *  cd /ruta/al/proyecto && sh deploy/backup.sh
set -eu
DIR="${BACKUP_DIR:-./backups}"; mkdir -p "$DIR"
ARCHIVO="$DIR/deva_$(date +%Y-%m-%d_%H%M).sql.gz"
docker compose exec -T db pg_dump -U deva -d deva | gzip > "$ARCHIVO"
find "$DIR" -name 'deva_*.sql.gz' -mtime +30 -delete
echo "Respaldo creado: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
