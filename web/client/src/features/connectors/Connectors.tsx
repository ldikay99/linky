import { useCallback, useEffect, useState } from "react";
import type { Connector, ConnectorsResponse } from "../../../../shared/protocol";
import { api } from "../../api";
import { useSession } from "../../state/session";
import { Icon, type IconName } from "../../ui/icons";
import { Button, Field, IconButton, Input, Overlay, SecretInput, Spinner, StatusDot, Switch, useToast } from "../../ui/primitives";

const ICON: Record<Connector["id"], IconName> = { azure: "boards", google: "account", ripor: "clock", chat: "message", dev: "branch" };
const STATE_TEXT: Record<Connector["state"], string> = { connected: "Conectado", attention: "Revisar", disconnected: "Sin conectar", optional: "Opcional" };

export function useConnectors() {
  const [data, setData] = useState<ConnectorsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.connectors(force));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  const aggregate = !data ? "busy" : data.connectors.some((c) => !c.optional && c.state === "disconnected") ? "disconnected" : data.connectors.some((c) => c.state === "attention") ? "attention" : "connected";
  return { data, loading, error, load, aggregate: aggregate as Connector["state"] | "busy" };
}

export function AzureConnect({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const [org, setOrg] = useState("https://dev.azure.com/");
  const [pat, setPat] = useState("");
  const [primary, setPrimary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const orgOk = /^https:\/\/(dev\.azure\.com\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}|[A-Za-z0-9-]+\.visualstudio\.com)\/?$/.test(org.trim());
  return (
    <form
      className={`form ${compact ? "form--compact" : ""}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!orgOk || pat.trim().length < 20) return;
        setBusy(true);
        setError(null);
        try {
          const r = await api.connectAzure(org.trim(), pat.trim(), primary);
          setPat("");
          toast("ok", r.user ? `Azure conectado como ${r.user}.` : "Azure conectado.");
          onDone?.();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Organización" hint="La dirección de tu organización en Azure DevOps.">
        {(id) => <Input id={id} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="https://dev.azure.com/tu-organizacion" inputMode="url" autoComplete="off" spellCheck={false} />}
      </Field>
      <Field
        label="Token personal (PAT)"
        error={error}
        hint={
          <>
            Créalo en Azure: <em>User settings → Personal access tokens</em>, con <strong>Full access</strong> y <strong>90 días</strong>. Se guarda cifrado y no se vuelve a mostrar.
          </>
        }
      >
        {(id) => <SecretInput id={id} value={pat} onChange={setPat} placeholder="Pega tu token" />}
      </Field>
      <Switch checked={primary} onChange={setPrimary} label="Usar como organización principal" />
      <div className="form__actions">
        <Button type="submit" variant="primary" icon="lock" loading={busy} disabled={!orgOk || pat.trim().length < 20}>
          Conectar de forma segura
        </Button>
      </div>
    </form>
  );
}

export function LoginAction({ which, label, onDone }: { which: "google" | "ripor" | "chat"; label: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const session = useSession();
  if (session && !session.interactiveLogin) {
    return (
      <p className="login-action__hint">
        <Icon name="info" size={14} /> En este servidor el inicio de sesión de {which === "ripor" ? "Ripor" : "Google"} llega con la integración directa de Google Cloud. Mientras tanto, conéctalo desde Linky en tu equipo.
      </p>
    );
  }
  return (
    <div className="login-action">
      <Button
        variant="primary"
        icon="external"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.login(which);
            toast("ok", "Sesión iniciada.");
            onDone?.();
          } catch (e) {
            toast("error", (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {busy && <p className="login-action__hint">Se abrió una ventana de inicio de sesión en este equipo. Completa el acceso ahí; esta pantalla se actualiza sola.</p>}
    </div>
  );
}

type Repo = { name?: string; path?: string; remote?: string };

export function DevRepos({ onChange }: { onChange?: () => void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = useCallback(async () => {
    const r = await api.devRepos().catch(() => null);
    const d = r?.data as { repos?: Repo[] } | Repo[] | null;
    setRepos(Array.isArray(d) ? d : (d?.repos ?? []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="dev">
      <form
        className="dev__scan"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!root.trim()) return;
          setBusy(true);
          try {
            await api.devScan(root.trim());
            toast("ok", "Repositorios registrados.");
            await load();
            onChange?.();
          } catch (err) {
            toast("error", (err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="Carpeta donde tienes tus repositorios" aria-label="Carpeta de repositorios" spellCheck={false} />
        <Button type="submit" icon="search" loading={busy} disabled={!root.trim()}>
          Buscar
        </Button>
      </form>
      {repos === null ? (
        <Spinner />
      ) : repos.length ? (
        <ul className="dev__list">
          {repos.map((r) => (
            <li key={r.path ?? r.name}>
              <Icon name="branch" size={15} />
              <span className="dev__name">{r.name ?? r.path}</span>
              <IconButton
                icon="x"
                size="sm"
                label="Quitar"
                onClick={async () => {
                  await api.devRemove(r.path ?? r.name ?? "").catch((e: Error) => toast("error", e.message));
                  await load();
                  onChange?.();
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aún no hay repositorios. Busca en la carpeta donde clonas tus proyectos.</p>
      )}
    </div>
  );
}

function ConnectorCard({ c, onChanged, onAsk }: { c: Connector; onChanged: () => void; onAsk: (text: string) => void }) {
  const [open, setOpen] = useState(c.state !== "connected" && !c.optional);
  return (
    <section className={`conn conn--${c.state} ${open ? "is-open" : ""}`}>
      <button type="button" className="conn__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="conn__icon">
          <Icon name={ICON[c.id]} size={20} />
        </span>
        <span className="conn__meta">
          <span className="conn__name">{c.name}</span>
          <span className="conn__desc">{c.description}</span>
        </span>
        <span className={`pill pill--${c.state}`}>
          <StatusDot state={c.state} />
          {STATE_TEXT[c.state]}
        </span>
        <Icon name="chevronDown" size={16} className="conn__chev" />
      </button>
      <div className="conn__body">
        <div className="conn__inner">
          {!!c.details.length && (
            <ul className="conn__details">
              {c.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          {/* Los arreglos del CLI ("npm run linky -- …") aquí se hacen con los botones de abajo. */}
          {c.fix && !/npm run|linky --/.test(c.fix) && (
            <p className="conn__fix">
              <Icon name="info" size={14} /> {c.fix}
            </p>
          )}
          {c.id === "azure" && <AzureConnect compact onDone={onChanged} />}
          {c.id === "google" && <LoginAction which="google" label={c.state === "connected" ? "Volver a iniciar sesión" : "Iniciar sesión con Google"} onDone={onChanged} />}
          {c.id === "ripor" && (
            <div className="conn__row">
              <LoginAction which="ripor" label={c.state === "connected" ? "Renovar sesión de Ripor" : "Iniciar sesión en Ripor"} onDone={onChanged} />
              <Button variant="ghost" icon="chat" onClick={() => onAsk("Ayúdame a configurar Ripor: lee mi catálogo y propón el proyecto de área, la tarea y el transporte.")}>
                Configurar con el asistente
              </Button>
            </div>
          )}
          {c.id === "chat" && <LoginAction which="chat" label="Conectar el chat de reporte" onDone={onChanged} />}
          {c.id === "dev" && <DevRepos onChange={onChanged} />}
        </div>
      </div>
    </section>
  );
}

export function ConnectorsPanel({ open, onClose, state, onAsk }: { open: boolean; onClose: () => void; state: ReturnType<typeof useConnectors>; onAsk: (text: string) => void }) {
  const { data, loading, error, load } = state;
  useEffect(() => {
    if (open && !data && !loading) void load();
  }, [open, data, loading, load]);
  return (
    <Overlay open={open} onClose={onClose} kind="sheet" label="Conectores">
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <h2>Conectores</h2>
            <p className="sheet__sub">
              <Icon name="lock" size={13} /> Tus credenciales se guardan cifradas y nunca se muestran de nuevo.
            </p>
          </div>
          <div className="sheet__actions">
            <IconButton icon="refresh" label="Volver a revisar" onClick={() => void load(true)} disabled={loading} className={loading ? "is-spinning" : ""} />
            <IconButton icon="x" label="Cerrar" onClick={onClose} />
          </div>
        </header>
        <div className="sheet__body">
          {error && (
            <div className="notice notice--error">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}
          {!data && loading && (
            <div className="skeletons">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
              <p className="muted center">Revisando tus conexiones…</p>
            </div>
          )}
          {data?.connectors.map((c) => (
            <ConnectorCard key={c.id} c={c} onChanged={() => void load(true)} onAsk={(t) => { onClose(); onAsk(t); }} />
          ))}
          {!!data?.problems.length && (
            <section className="problems">
              <h3>Otros avisos</h3>
              <ul>
                {data.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>
          )}
          {data && <p className="muted small center">Revisado {new Date(data.checkedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
      </div>
    </Overlay>
  );
}
