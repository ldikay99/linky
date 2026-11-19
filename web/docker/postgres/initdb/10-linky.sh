#!/usr/bin/env bash
# Corre una sola vez, cuando el volumen de PostgreSQL está vacío (lo ejecuta el entrypoint de la imagen oficial).
# Crea el rol de la aplicación sin superusuario ni BYPASSRLS (así Row Level Security sí aplica) y sus dos bases:
# linky (desarrollo) y linky_test (pruebas). La contraseña sale del secreto de Docker; nunca se imprime.
# Funciona ejecutado o leído con `source` (el entrypoint hace lo segundo si el archivo no es ejecutable).
set -Eeo pipefail

pass="$(cat "${LINKY_DB_PASSWORD_FILE:?falta LINKY_DB_PASSWORD_FILE}")"
if [ -z "$pass" ]; then
  echo "El secreto de la contraseña de la aplicación está vacío." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pass="$pass" <<'SQL'
CREATE ROLE linky LOGIN PASSWORD :'pass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE linky OWNER linky;
CREATE DATABASE linky_test OWNER linky;
-- Solo su dueña entra a cada base.
REVOKE ALL ON DATABASE linky FROM PUBLIC;
REVOKE ALL ON DATABASE linky_test FROM PUBLIC;
SQL
unset pass
