/**
 * Ciclo de vida del PAT: fechas USER-REPORTED + reloj del dispositivo.
 * Nunca deriva expiry del string del token ni afirma inspeccionar scopes vía PAT.
 */
export type PatScopeChoice = "work_items_rw" | "full_access";

export type PatLifecycleProfile = {
  /** Siempre user_reported para fechas; no hay verificación oficial vía PAT simple. */
  dateSource: "user_reported";
  /** YYYY-MM-DD opcional (fecha de creación informada por el usuario). */
  createdOn?: string;
  /** YYYY-MM-DD requerido para recordatorios. */
  expiresOn: string;
  /** IANA tz del dispositivo (confirmada). */
  deviceTimeZone: string;
  scopeChoice: PatScopeChoice;
  /** Usuario reconoció amplitud de Full access. */
  fullAccessAcknowledged?: boolean;
  /**
   * Opt-in para instalar recordatorio en el SO.
   * false por defecto; no se activa al instalar Linky.
   */
  localOsReminderOptIn: false | true;
  reminderDaysBefore: 7;
  notes?: string[];
};

export type Clock = {
  /** Instant UTC ms. */
  nowMs: () => number;
};

export const systemClock: Clock = {
  nowMs: () => Date.now(),
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function detectDeviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch {
    /* ignore */
  }
  return "UTC";
}

export function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Fecha civil YYYY-MM-DD en la zona IANA dada (reloj del dispositivo / fake). */
export function civilDateInTimeZone(ms: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ms)); // en-CA → YYYY-MM-DD
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  if (!DATE_RE.test(ymd)) throw new Error(`Fecha inválida (use YYYY-MM-DD): ${ymd}`);
  const [y, m, d] = ymd.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Fecha inválida: ${ymd}`);
  // Validar calendario con UTC noon trick
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`Fecha inválida (día no existe): ${ymd}`);
  }
  return { y, m, d };
}

export function validatePatLifecycleInput(input: {
  createdOn?: string;
  expiresOn: string;
  deviceTimeZone: string;
  scopeChoice: PatScopeChoice;
  fullAccessAcknowledged?: boolean;
  nowMs?: number;
  clock?: Clock;
}): { ok: true; value: Omit<PatLifecycleProfile, "localOsReminderOptIn" | "reminderDaysBefore"> & { localOsReminderOptIn: false; reminderDaysBefore: 7 } } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isValidIanaTimeZone(input.deviceTimeZone)) {
    errors.push(`Zona IANA inválida: ${input.deviceTimeZone}`);
  }
  try {
    parseYmd(input.expiresOn);
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (input.createdOn) {
    try {
      parseYmd(input.createdOn);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (input.scopeChoice === "full_access" && input.fullAccessAcknowledged !== true) {
    errors.push(
      "Full access requiere fullAccessAcknowledged=true (aviso de amplitud). Recomendado: work_items_rw.",
    );
  }
  if (input.scopeChoice !== "work_items_rw" && input.scopeChoice !== "full_access") {
    errors.push("scopeChoice debe ser work_items_rw (recomendado) o full_access.");
  }

  if (!errors.length && input.createdOn) {
    if (input.createdOn >= input.expiresOn) {
      errors.push("createdOn debe ser anterior a expiresOn.");
    }
  }

  const clock = input.clock ?? systemClock;
  const nowMs = input.nowMs ?? clock.nowMs();
  if (!errors.length && isValidIanaTimeZone(input.deviceTimeZone)) {
    const today = civilDateInTimeZone(nowMs, input.deviceTimeZone);
    if (input.expiresOn <= today) {
      errors.push(`expiresOn debe ser una fecha futura en ${input.deviceTimeZone} (hoy local=${today}).`);
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      dateSource: "user_reported",
      createdOn: input.createdOn,
      expiresOn: input.expiresOn,
      deviceTimeZone: input.deviceTimeZone,
      scopeChoice: input.scopeChoice,
      fullAccessAcknowledged: input.scopeChoice === "full_access" ? true : undefined,
      localOsReminderOptIn: false,
      reminderDaysBefore: 7,
      notes: [
        "Fechas user_reported: Azure PAT no expone expiry/scopes de forma confiable vía el string del token.",
        "Linky no afirma haber verificado metadata oficial de vencimiento.",
        input.scopeChoice === "full_access"
          ? "Usuario eligió Full access conscientemente; alternativa recomendada: Work Items Read & Write."
          : "Scope recomendado: Work Items Read & Write.",
      ],
    },
  };
}

export type PatReminderStatus = {
  dateSource: "user_reported";
  deviceTimeZone: string;
  expiresOn: string;
  todayLocal: string;
  daysRemaining: number;
  level: "ok" | "warn_7_days" | "expired";
  message: string;
  /** Nunca incluye token. */
};

/** Diferencia de fechas civiles en días (expiry - today) en la misma zona. */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  const from = Date.UTC(a.y, a.m - 1, a.d);
  const to = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((to - from) / 86_400_000);
}

export function evaluatePatReminder(
  life: Pick<PatLifecycleProfile, "expiresOn" | "deviceTimeZone" | "reminderDaysBefore" | "dateSource">,
  clock: Clock = systemClock,
): PatReminderStatus {
  const todayLocal = civilDateInTimeZone(clock.nowMs(), life.deviceTimeZone);
  const daysRemaining = daysBetweenYmd(todayLocal, life.expiresOn);
  const window = life.reminderDaysBefore ?? 7;
  if (daysRemaining < 0) {
    return {
      dateSource: "user_reported",
      deviceTimeZone: life.deviceTimeZone,
      expiresOn: life.expiresOn,
      todayLocal,
      daysRemaining,
      level: "expired",
      message: `PAT (fecha user-reported) venció hace ${Math.abs(daysRemaining)} día(s) en ${life.deviceTimeZone}. Renueva el token y actualiza expiresOn.`,
    };
  }
  if (daysRemaining <= window) {
    return {
      dateSource: "user_reported",
      deviceTimeZone: life.deviceTimeZone,
      expiresOn: life.expiresOn,
      todayLocal,
      daysRemaining,
      level: "warn_7_days",
      message: `Faltan ${daysRemaining} día(s) para el vencimiento user-reported (${life.expiresOn}, tz=${life.deviceTimeZone}). Renueva el PAT a tiempo.`,
    };
  }
  return {
    dateSource: "user_reported",
    deviceTimeZone: life.deviceTimeZone,
    expiresOn: life.expiresOn,
    todayLocal,
    daysRemaining,
    level: "ok",
    message: `Vencimiento user-reported en ${daysRemaining} día(s) (${life.expiresOn}).`,
  };
}

export const FULL_ACCESS_WARNING =
  "Full access concede muchos más permisos de los necesarios. Recomendado: Work Items (Read & Write). Solo elige Full access si entiendes el riesgo y lo confirmas explícitamente.";

/**
 * Documentación de recordatorio OS opt-in. No instala nada.
 * No promete notificar si Linky/el scheduler no está corriendo.
 */
export function describeLocalOsReminderMethods(): string[] {
  return [
    "Opt-in únicamente: Linky NO instala schedulers al hacer npm install ni onboarding.",
    "Windows: Task Scheduler (schtasks) apuntando a `npm run linky -- status` (salida local).",
    "macOS: launchd LaunchAgent con StartCalendarInterval.",
    "Linux: systemd --user timer o cron del usuario.",
    "Sin scheduler instalado/activo, NO hay garantía de aviso mientras la app no corre; el CLI sí avisa al arrancar status/plan/preview/apply.",
  ];
}
