import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, SessionInfo } from "../../shared/protocol";
import { ApiError, api, setCsrf } from "./api";
import { ChatView } from "./features/chat/ChatView";
import { ConnectorsPanel, useConnectors } from "./features/connectors/Connectors";
import { Onboarding } from "./features/onboarding/Onboarding";
import { Sidebar } from "./features/sidebar/Sidebar";
import { FileViewer } from "./features/viewer/FileViewer";
import { SessionContext } from "./state/session";
import { useChat } from "./state/useChat";
import { Isotype } from "./ui/brand";
import { Spinner, useToast } from "./ui/primitives";

const COLLAPSE_KEY = "linky.sidebar.collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function Locked({ message }: { message: string }) {
  return (
    <div className="locked">
      <Isotype size={64} />
      <h1>Entra a Linky desde tu enlace</h1>
      <p>{message}</p>
      <p className="muted small">
        Ejecuta <code>npm run web</code> en tu equipo y abre el enlace que aparece. Por seguridad vale 10 minutos y sirve una sola vez.
      </p>
    </div>
  );
}

function Workspace({ session, onSession }: { session: SessionInfo; onSession: (s: SessionInfo) => void }) {
  const toast = useToast();
  const onError = useCallback((m: string) => toast("error", m), [toast]);
  const chat = useChat(onError);
  const connectors = useConnectors();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [onboarding, setOnboarding] = useState(!session.onboarded);
  const [viewer, setViewer] = useState<{ items: Attachment[]; index: number } | null>(null);
  const isMobile = useRef(window.matchMedia("(max-width: 860px)"));

  const loadConnectors = connectors.load;
  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        void chat.open(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chat]);

  const toggleSidebar = () => (isMobile.current.matches ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));
  const closeMobile = () => setMobileOpen(false);

  const finishOnboarding = async () => {
    setOnboarding(false);
    if (!session.onboarded) {
      await api.completeOnboarding().catch(() => undefined);
      onSession({ ...session, onboarded: true });
    }
  };

  if (onboarding) {
    // "Terminar después" también cuenta como visto: la configuración sigue disponible en la barra lateral.
    return <Onboarding session={session} connectors={connectors.data} reload={() => void connectors.load(true)} onClose={() => void finishOnboarding()} onFinish={() => void finishOnboarding()} />;
  }

  return (
    <div className={`app ${collapsed ? "is-collapsed" : ""}`}>
      <Sidebar
        session={session}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        conversations={chat.conversations}
        activeId={chat.activeId}
        connectorsState={connectors.loading && !connectors.data ? "busy" : connectors.aggregate}
        onToggle={toggleSidebar}
        onNew={() => {
          void chat.open(null);
          closeMobile();
        }}
        onOpen={(id) => {
          void chat.open(id);
          closeMobile();
        }}
        onRename={(id, t) => void chat.rename(id, t)}
        onDelete={(id) => void chat.remove(id)}
        onConnectors={() => {
          setPanel(true);
          closeMobile();
        }}
        onOnboarding={() => {
          setOnboarding(true);
          closeMobile();
        }}
        onLogout={async () => {
          await api.logout().catch(() => undefined);
          window.location.replace("/");
        }}
        onCloseMobile={closeMobile}
      />
      <ChatView
        chat={chat}
        session={session}
        sidebarCollapsed={collapsed}
        onToggleSidebar={toggleSidebar}
        onOpenFile={(a, all) => setViewer({ items: all, index: Math.max(0, all.findIndex((x) => x.id === a.id)) })}
        onAction={(a) => (a === "open-connectors" ? setPanel(true) : setOnboarding(true))}
      />
      <ConnectorsPanel open={panel} onClose={() => setPanel(false)} state={connectors} onAsk={(t) => void chat.send(t, [])} />
      <FileViewer items={viewer?.items ?? []} index={viewer?.index ?? 0} onClose={() => setViewer(null)} onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))} />
      {!session.ai.configured && <span className="sr-only">Modo de acciones directas: el asistente de IA no está configurado.</span>}
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [locked, setLocked] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const m = /[#&]t=([A-Za-z0-9_-]{32,128})/.exec(window.location.hash);
      if (m) {
        // El token del enlace se cambia por la cookie de sesión y desaparece de la barra de direcciones.
        history.replaceState(null, "", window.location.pathname);
        try {
          await api.exchange(m[1]);
        } catch (e) {
          setLocked((e as Error).message);
          return;
        }
      }
      try {
        const s = await api.session();
        setCsrf(s.csrf);
        setSession(s);
      } catch (e) {
        setLocked(e instanceof ApiError && e.status === 401 ? "Tu sesión no está activa." : (e as Error).message);
      }
    })();
  }, []);

  if (locked) return <Locked message={locked} />;
  if (!session) {
    return (
      <div className="boot">
        <Isotype size={56} animated />
        <Spinner size={18} />
      </div>
    );
  }
  return (
    <SessionContext.Provider value={session}>
      <Workspace session={session} onSession={setSession} />
    </SessionContext.Provider>
  );
}
