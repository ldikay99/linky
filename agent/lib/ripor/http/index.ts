import type { SecretStore } from "../../security/secretStore.js";
import type { RiporProfile, RiporTransportOption } from "../types.js";
import { createHttpRiporAdapter } from "./adapter.js";
import { createRiporHttpClient } from "./client.js";
import { loadRiporSession, resolveRiporSecretStore, saveRiporSession, type RiporSession } from "./session.js";

export * from "./adapter.js";
export * from "./client.js";
export * from "./devalue.js";
export * from "./reports.js";
export * from "./session.js";

/**
 * Opciones de transporte tal como las define el formulario oficial de Ripor
 * (bundle público de /u/horas, verificado 2026-11-05). label = "icono nombre", formValue = id.
 */
export const KNOWN_RIPOR_TRANSPORTS: RiporTransportOption[] = [
  { label: "🚗 Vehículo particular", formValue: "vehiculo_particular", verifiedFromUi: true },
  { label: "🏍️ Moto particular", formValue: "moto_particular", verifiedFromUi: true },
  { label: "🚌 Transporte público", formValue: "transporte_publico", verifiedFromUi: true },
  { label: "🚲 Bicicleta", formValue: "bicicleta", verifiedFromUi: true },
  { label: "🛴 Patineta eléctrica", formValue: "patineta_electrica", verifiedFromUi: true },
  { label: "🚶 Caminata", formValue: "caminata", verifiedFromUi: true },
  { label: "🚗 Carro Compartido", formValue: "carpooling", verifiedFromUi: true },
  { label: "📱 Apps de movilidad (Uber, Picap, etc.)", formValue: "apps_movilidad", verifiedFromUi: true },
  { label: "🏠 Trabajo Remoto", formValue: "trabajo_remoto", verifiedFromUi: true },
];

export async function openRiporHttp(
  profile: RiporProfile,
  opts?: { store?: SecretStore; fetchImpl?: typeof fetch },
) {
  const store = opts?.store ?? (await resolveRiporSecretStore());
  const session = await loadRiporSession(store);
  if (!session) {
    throw new Error("No hay sesión Ripor. Ejecuta: npm run linky -- ripor login (o ripor login --paste).");
  }
  let current: RiporSession = session;
  const client = createRiporHttpClient(
    {
      cookies: () => current.cookies,
      async onRefresh(jar) {
        current = { cookies: jar, savedAt: new Date().toISOString(), source: "refresh" };
        if (session.source !== "env") await saveRiporSession(current, store);
      },
    },
    opts?.fetchImpl,
  );
  return { client, adapter: createHttpRiporAdapter({ client, profile }), session: () => current };
}
