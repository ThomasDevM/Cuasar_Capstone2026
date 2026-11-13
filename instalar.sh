#!/usr/bin/env sh
# Instalación en Linux/macOS con Docker: crea .env con claves seguras e inicia el sistema.
set -eu
cd "$(dirname "$0")"
command -v docker >/dev/null 2>&1 || { echo "Falta Docker. Instálelo desde https://docs.docker.com/engine/install/ y vuelva a ejecutar."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker no está en ejecución (o su usuario no tiene permiso). Inícielo y reintente."; exit 1; }
if [ ! -f .env ]; then
  echo "Creando .env con claves seguras…"
  gen() { openssl rand -hex "$1"; }
  clave() { openssl rand -base64 18 | tr -dc 'A-HJ-NP-Za-km-z2-9' | cut -c1-12; }
  ADMIN_PASS="$(clave)"; PROF_PASS="$(clave)"
  sed -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(gen 16)|" -e "s|^JWT_SECRET=.*|JWT_SECRET=$(gen 48)|" \
      -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMIN_PASS|" -e "s|^PROFESIONAL_PASSWORD=.*|PROFESIONAL_PASSWORD=$PROF_PASS|" .env.example > .env
  chmod 600 .env
  {
    echo "CLAVES INICIALES - Deva Aesthetic House"
    echo "(Guarde este archivo en un lugar seguro y cambie estas claves al ingresar por primera vez)"
    echo
    echo "Direccion (Sandra):   usuario: sandra         clave: $ADMIN_PASS"
    echo "Profesional:          usuario: profesional    clave: $PROF_PASS   (debe cambiarla al primer ingreso)"
  } > CLAVES-INICIALES.txt
  chmod 600 CLAVES-INICIALES.txt
fi
echo "Construyendo e iniciando (la primera vez demora varios minutos)…"
docker compose up -d --build
echo; echo "Listo: http://localhost:3000   · claves iniciales en CLAVES-INICIALES.txt"
