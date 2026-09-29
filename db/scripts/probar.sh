#!/usr/bin/env bash
# Recrea la BD de prueba desde cero y ejecuta todas las pruebas.
# Uso: bash scripts/probar.sh   (requiere PostgreSQL local y usuario postgres)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # carpeta db/
TMP="$(mktemp -d)"; cp "$DIR"/0*.sql "$TMP"/; chmod 755 "$TMP"; chmod 644 "$TMP"/*.sql
su postgres -c "psql -q -c 'drop database if exists esmeralda_test' -c 'create database esmeralda_test'"
for f in 01_esquema 02_seed 03_datos_demo; do
  su postgres -c "psql -v ON_ERROR_STOP=1 -q -d esmeralda_test -f $TMP/$f.sql" > /dev/null
done
su postgres -c "psql -d esmeralda_test -f $TMP/04_pruebas.sql" 2>&1 | grep -E 'OK  →|FALLO|ERROR|===|PASARON'
