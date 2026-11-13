#!/usr/bin/env sh
# Restaura un respaldo:  sh deploy/restore.sh backups/deva_2026-12-01_0200.sql.gz
# ATENCIÓN: reemplaza los datos actuales. Detenga la aplicación antes:  docker compose stop app
set -eu
[ $# -eq 1 ] || { echo "Uso: sh deploy/restore.sh <archivo.sql.gz>"; exit 1; }
docker compose exec -T db psql -U deva -d postgres -c "DROP DATABASE IF EXISTS deva;" -c "CREATE DATABASE deva OWNER deva;"
gunzip -c "$1" | docker compose exec -T db psql -U deva -d deva
echo "Restauración completada. Inicie la aplicación:  docker compose start app"
