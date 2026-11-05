import { describeLocalOsReminderMethods, type PatLifecycleProfile } from "./patLifecycle.js";

export type LocalReminderPlan = {
  enabled: false | true;
  methods: string[];
  sampleCommands: string[];
  warning: string;
};

/** Genera plan documental; nunca ejecuta instalación. */
export function planLocalOsReminder(life: PatLifecycleProfile): LocalReminderPlan {
  return {
    enabled: life.localOsReminderOptIn === true,
    methods: describeLocalOsReminderMethods(),
    sampleCommands: [
      '# Ejemplo documental Windows (NO auto):',
      'schtasks /Create /TN "LinkyPatReminder" /TR "npm run linky -- status" /SC DAILY /ST 09:00',
      '# Ejemplo documental Linux systemd user (NO auto): ver docs/RECORDATORIO-PAT.md',
    ],
    warning:
      life.localOsReminderOptIn
        ? "Opt-in marcado: debes instalar el scheduler tú mismo; Linky no lo activa solo."
        : "Recordatorio OS desactivado (default). El CLI igual muestra días restantes al arrancar.",
  };
}
