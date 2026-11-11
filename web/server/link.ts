/**
 * Genera un enlace de entrada nuevo (un solo uso, 10 minutos) sin reiniciar el servidor.
 *   npm run link                              (equipo local)
 *   docker compose exec linky-web npm run link  (contenedor)
 */
import { loadConfig } from "./config.js";
import { createAuth } from "./security/auth.js";
import { KeyRing, resolveMasterKey } from "./security/crypto.js";
import { openStore } from "./store/db.js";

const config = loadConfig();
const store = openStore(config.dataDir, new KeyRing(await resolveMasterKey(config.masterKey)));
const owner = store.owner();
if (!owner) {
  process.stderr.write("Todavía no hay usuario: arranca el servidor una vez.\n");
  process.exit(1);
}
process.stdout.write(`${createAuth(config, store).launchLink(owner)}\n`);
store.close();
