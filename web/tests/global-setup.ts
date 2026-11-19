/** Corre una vez en el proceso principal de vitest: deja claro si las pruebas de PostgreSQL se saltan. */
import { PG_SKIP_NOTE } from "./stores.js";

export default function setup() {
  if (!process.env.LINKY_TEST_DATABASE_URL?.trim()) process.stdout.write(`\n  Aviso: ${PG_SKIP_NOTE}\n\n`);
  else process.stdout.write("\n  PostgreSQL: las pruebas del store corren también contra LINKY_TEST_DATABASE_URL.\n\n");
}
