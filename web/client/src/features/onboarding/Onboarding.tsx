import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectorsResponse, MeetingItem, OnboardingStepId, ProfileForm, SessionInfo } from "../../../../shared/protocol";
import { api } from "../../api";
import { Isotype, Logotype } from "../../ui/brand";
import { Icon, type IconName } from "../../ui/icons";
import { Button, Field, Input, Select, Spinner, StatusDot, TextArea, useToast } from "../../ui/primitives";
import { AzureConnect, DevRepos, LoginAction } from "../connectors/Connectors";

type Step = { id: OnboardingStepId; title: string; caption: string; icon: IconName; optional?: boolean };

const STEPS: Step[] = [
  { id: "azure", title: "Azure DevOps", caption: "Tu organización y tu token", icon: "boards" },
  { id: "profile", title: "Tu perfil", caption: "Proyecto, rol y horario", icon: "account" },
  { id: "google", title: "Google", caption: "Calendar, Gmail y Ripor", icon: "mail" },
  { id: "ripor", title: "Ripor", caption: "Tu reporte diario", icon: "clock" },
  { id: "chat", title: "Google Chat", caption: "Inicio y cierre de jornada", icon: "message", optional: true },
  { id: "meetings", title: "Reuniones", caption: "Qué cuenta como trabajo", icon: "calendar" },
  { id: "dev", title: "Repositorios", caption: "Si desarrollas", icon: "branch", optional: true },
  { id: "review", title: "Revisión", caption: "Todo en orden", icon: "shield" },
];

function stateFor(data: ConnectorsResponse | null, id: string) {
  return data?.connectors.find((c) => c.id === id)?.state;
}

function Welcome({ name, onStart, onSkip }: { name: string; onStart: () => void; onSkip: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome__glow" aria-hidden="true" />
      <div className="welcome__grid" aria-hidden="true" />
      <div className="welcome__content">
        <Isotype size={92} animated />
        <div className="welcome__word">
          <Logotype size={54} />
        </div>
        <p className="welcome__tag">Tu día de trabajo, reportado por tu IA.</p>
        <p className="welcome__lead">
          {name.trim() ? `Hola, ${name.trim().split(/\s+/)[0]}.` : "Hola."} Linky reúne lo que hiciste en Azure DevOps, tus reuniones y correos, y lo deja registrado en Azure y Ripor. Tú solo revisas y apruebas.
        </p>
        <ul className="welcome__points">
          <li>
            <Icon name="shield" size={16} /> Nada se escribe sin tu aprobación.
          </li>
          <li>
            <Icon name="lock" size={16} /> Credenciales y conversaciones cifradas.
          </li>
          <li>
            <Icon name="mic" size={16} /> Escribe, dicta o adjunta evidencias.
          </li>
        </ul>
        <div className="welcome__actions">
          <Button variant="primary" size="lg" icon="arrowRight" onClick={onStart}>
            Comenzar
          </Button>
          <Button variant="ghost" size="lg" onClick={onSkip}>
            Ya tengo todo listo
          </Button>
        </div>
        <p className="welcome__credit">por Jonathan Contreras</p>
      </div>
    </div>
  );
}

const DEFAULT_PROFILE: ProfileForm = {
  organizationUrl: "",
  project: "",
  occupation: "",
  projectContext: "",
  assignedDisplayName: "",
  responsibleTag: "",
  mondayToThursday: { start: "08:30", end: "18:00" },
  friday: { start: "08:00", end: "17:00" },
  lunchStart: "12:45",
  lunchEnd: "13:45",
  huCreation: "scrum_or_third_party_only",
  taskClose: "scrum_or_third_party",
  huClose: "scrum_or_third_party",
};

function ProfileStep({ session, onDone }: { session: SessionInfo; onDone: () => void }) {
  const [f, setF] = useState<ProfileForm>({ ...DEFAULT_PROFILE, assignedDisplayName: session.user.name });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = f.organizationUrl && f.project && f.occupation.length > 1 && f.projectContext.length > 1 && f.assignedDisplayName;
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.saveProfile(f);
          toast("ok", "Perfil guardado.");
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form__grid">
        <Field label="Organización de Azure">{(id) => <Input id={id} value={f.organizationUrl} onChange={(e) => set("organizationUrl", e.target.value)} placeholder="https://dev.azure.com/tu-organizacion" spellCheck={false} />}</Field>
        <Field label="Proyecto (nombre exacto)">{(id) => <Input id={id} value={f.project} onChange={(e) => set("project", e.target.value)} placeholder="Como aparece en Azure" />}</Field>
        <Field label="¿A qué te dedicas?" hint="Tu rol, para redactar HU y Tasks a tu medida.">{(id) => <Input id={id} value={f.occupation} onChange={(e) => set("occupation", e.target.value)} placeholder="Analista, desarrolladora, coordinador…" />}</Field>
        <Field label="Nombre como aparece en Azure">{(id) => <Input id={id} value={f.assignedDisplayName} onChange={(e) => set("assignedDisplayName", e.target.value)} />}</Field>
      </div>
      <Field label="¿De qué trata tu proyecto?">{(id) => <TextArea id={id} rows={3} value={f.projectContext} onChange={(e) => set("projectContext", e.target.value)} placeholder="Una o dos frases sobre el proyecto y su propósito." />}</Field>
      <div className="form__grid form__grid--4">
        <Field label="Lun–Jue entrada">{(id) => <Input id={id} type="time" value={f.mondayToThursday.start} onChange={(e) => set("mondayToThursday", { ...f.mondayToThursday, start: e.target.value })} />}</Field>
        <Field label="Lun–Jue salida">{(id) => <Input id={id} type="time" value={f.mondayToThursday.end} onChange={(e) => set("mondayToThursday", { ...f.mondayToThursday, end: e.target.value })} />}</Field>
        <Field label="Viernes entrada">{(id) => <Input id={id} type="time" value={f.friday.start} onChange={(e) => set("friday", { ...f.friday, start: e.target.value })} />}</Field>
        <Field label="Viernes salida">{(id) => <Input id={id} type="time" value={f.friday.end} onChange={(e) => set("friday", { ...f.friday, end: e.target.value })} />}</Field>
        <Field label="Almuerzo desde">{(id) => <Input id={id} type="time" value={f.lunchStart} onChange={(e) => set("lunchStart", e.target.value)} />}</Field>
        <Field label="Almuerzo hasta">{(id) => <Input id={id} type="time" value={f.lunchEnd} onChange={(e) => set("lunchEnd", e.target.value)} />}</Field>
      </div>
      <div className="form__grid">
        <Field label="¿Quién crea las HU?">
          {(id) => (
            <Select
              id={id}
              value={f.huCreation}
              onChange={(v) => set("huCreation", v)}
              options={[
                { value: "scrum_or_third_party_only", label: "Mi líder o el scrum" },
                { value: "user_or_ai_with_approval", label: "Yo, con mi aprobación" },
              ]}
            />
          )}
        </Field>
        <Field label="¿Quién cierra tus Tasks?">
          {(id) => (
            <Select
              id={id}
              value={f.taskClose}
              onChange={(v) => set("taskClose", v)}
              options={[
                { value: "scrum_or_third_party", label: "Mi líder o el scrum" },
                { value: "same_user", label: "Yo" },
                { value: "ask_each_time", label: "Preguntar cada vez" },
              ]}
            />
          )}
        </Field>
      </div>
      {error && (
        <div className="notice notice--error">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="form__actions">
        <Button type="submit" variant="primary" icon="check" loading={busy} disabled={!valid}>
          Guardar perfil
        </Button>
      </div>
    </form>
  );
}

function MeetingsStep() {
  const [items, setItems] = useState<MeetingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const load = useCallback(async () => {
    setItems(null);
    try {
      const r = await api.meetings();
      setItems(r.items);
      setError(r.error ?? null);
    } catch (e) {
      setItems([]);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const classify = async (title: string, action: "confirm" | "ignore") => {
    setItems((xs) => xs?.map((x) => (x.title === title ? { ...x, status: action === "confirm" ? "confirmed" : "ignored" } : x)) ?? null);
    await api.classifyMeeting(title, action).catch((e: Error) => toast("error", e.message));
  };
  if (!items) {
    return (
      <div className="center pad">
        <Spinner size={22} />
        <p className="muted">Leyendo tu calendario…</p>
      </div>
    );
  }
  return (
    <div className="meetings">
      {error && <p className="muted">No se pudo leer el calendario ({error}). Puedes seguir y hacerlo luego desde el chat.</p>}
      {!items.length && !error && <p className="muted">No hay eventos por clasificar hoy.</p>}
      <ul className="meetings__list">
        {items.map((m) => (
          <li key={m.title} className={`meeting meeting--${m.status}`}>
            <span className="meeting__title">{m.title}</span>
            <div className="seg">
              <button type="button" className={m.status === "confirmed" ? "is-on" : ""} onClick={() => void classify(m.title, "confirm")}>
                Reunión de trabajo
              </button>
              <button type="button" className={m.status === "ignored" ? "is-on" : ""} onClick={() => void classify(m.title, "ignore")}>
                Evento general
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Onboarding({ session, connectors, reload, onClose, onFinish }: { session: SessionInfo; connectors: ConnectorsResponse | null; reload: () => void; onClose: () => void; onFinish: () => void }) {
  const [phase, setPhase] = useState<"welcome" | "steps">(session.onboarded ? "steps" : "welcome");
  const [index, setIndex] = useState(0);
  const step = STEPS[index];

  const done = useMemo(() => {
    const s = (id: string) => stateFor(connectors, id) === "connected";
    return {
      azure: s("azure") || stateFor(connectors, "azure") === "attention",
      profile: !!connectors?.connectors.find((c) => c.id === "azure")?.details.some((d) => d.startsWith("perfil")),
      google: s("google"),
      ripor: s("ripor"),
      chat: s("chat"),
      meetings: false,
      dev: s("dev"),
      review: false,
    } as Record<OnboardingStepId, boolean>;
  }, [connectors]);

  const next = () => (index < STEPS.length - 1 ? setIndex(index + 1) : onFinish());

  if (phase === "welcome") return <Welcome name={session.user.name} onStart={() => setPhase("steps")} onSkip={onFinish} />;

  return (
    <div className="onb">
      <aside className="onb__rail">
        <div className="onb__brand">
          <Isotype size={30} />
          <span>Configuración inicial</span>
        </div>
        <ol className="onb__steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={`onb__step ${i === index ? "is-current" : ""} ${done[s.id] ? "is-done" : ""}`} onClick={() => setIndex(i)}>
                <span className="onb__num">{done[s.id] ? <Icon name="check" size={13} strokeWidth={2.2} /> : i + 1}</span>
                <span className="onb__label">
                  <span>{s.title}</span>
                  <small>{s.optional ? "Opcional" : s.caption}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <Button variant="ghost" icon="x" onClick={onClose} className="onb__exit">
          Terminar después
        </Button>
      </aside>
      <section className="onb__main">
        <div className="onb__progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${(index + 1) / STEPS.length})` }} />
        </div>
        <div className="onb__card" key={step.id}>
          <div className="onb__icon">
            <Icon name={step.icon} size={22} />
          </div>
          <p className="onb__eyebrow">
            Paso {index + 1} de {STEPS.length}
            {step.optional ? " · Opcional" : ""}
          </p>
          <h2 className="onb__title">{step.title}</h2>
          <div className="onb__body">
            {step.id === "azure" && (
              <>
                <p className="lead">Conecta tu organización de Azure DevOps con un token personal. Es la base para leer tu actividad y registrar tus Tasks.</p>
                {done.azure && (
                  <p className="ok-line">
                    <StatusDot state="connected" /> Ya tienes Azure conectado. Puedes agregar otra organización o continuar.
                  </p>
                )}
                <AzureConnect onDone={reload} />
              </>
            )}
            {step.id === "profile" && (
              <>
                <p className="lead">Con esto Linky redacta tus HU y Tasks en el contexto de tu trabajo y respeta tu jornada.</p>
                {done.profile && (
                  <p className="ok-line">
                    <StatusDot state="connected" /> Tu perfil ya existe; guardarlo de nuevo lo actualiza.
                  </p>
                )}
                <ProfileStep session={session} onDone={() => { reload(); next(); }} />
              </>
            )}
            {step.id === "google" && (
              <>
                <p className="lead">Un solo inicio de sesión habilita tu Calendar y Gmail como evidencias y el acceso a Ripor con tu cuenta.</p>
                {done.google ? (
                  <p className="ok-line">
                    <StatusDot state="connected" /> Sesión de Google activa.
                  </p>
                ) : (
                  <LoginAction which="google" label="Iniciar sesión con Google" onDone={reload} />
                )}
              </>
            )}
            {step.id === "ripor" && (
              <>
                <p className="lead">Inicia sesión en Ripor. Después, el asistente lee tu catálogo y configura tu proyecto de área, tarea y transporte.</p>
                {done.ripor ? (
                  <p className="ok-line">
                    <StatusDot state="connected" /> Ripor listo.
                  </p>
                ) : (
                  <LoginAction which="ripor" label="Iniciar sesión en Ripor" onDone={reload} />
                )}
              </>
            )}
            {step.id === "chat" && (
              <>
                <p className="lead">Solo si tu equipo reporta el inicio y cierre de jornada en Google Chat. Si no, sáltalo.</p>
                {done.chat ? (
                  <p className="ok-line">
                    <StatusDot state="connected" /> Chat de reporte conectado.
                  </p>
                ) : (
                  <LoginAction which="chat" label="Elegir el chat de reporte" onDone={reload} />
                )}
              </>
            )}
            {step.id === "meetings" && (
              <>
                <p className="lead">Marca qué eventos son reuniones de trabajo. Las pausas y charlas generales no cuentan como horas.</p>
                <MeetingsStep />
              </>
            )}
            {step.id === "dev" && (
              <>
                <p className="lead">Si desarrollas, tus commits y PR sirven como evidencia. Indica la carpeta donde tienes tus repositorios.</p>
                <DevRepos onChange={reload} />
              </>
            )}
            {step.id === "review" && (
              <>
                <p className="lead">Así quedó todo. Puedes volver a cualquier paso o empezar a registrar tu día.</p>
                <ul className="review">
                  {connectors?.connectors.map((c) => (
                    <li key={c.id}>
                      <StatusDot state={c.state} />
                      <span>{c.name}</span>
                      <small>{c.state === "connected" ? "Conectado" : c.state === "optional" ? "Opcional" : c.state === "attention" ? "Revisar" : "Sin conectar"}</small>
                    </li>
                  )) ?? <Spinner />}
                </ul>
              </>
            )}
          </div>
          <footer className="onb__foot">
            <Button variant="ghost" icon="chevronLeft" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              Atrás
            </Button>
            <div className="spacer" />
            {step.optional && step.id !== "review" && (
              <Button variant="ghost" onClick={next}>
                Saltar
              </Button>
            )}
            <Button variant={step.id === "review" ? "primary" : "secondary"} icon={step.id === "review" ? "chat" : "arrowRight"} onClick={next}>
              {step.id === "review" ? "Ir al chat" : "Continuar"}
            </Button>
          </footer>
        </div>
      </section>
    </div>
  );
}
