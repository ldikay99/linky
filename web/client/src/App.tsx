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
      <h1>No se pudo abrir Linky</h1>
      <p>{message}</p>
      <button type="button" className="btn btn--primary btn--md" onClick={() => window.location.reload()}>
        <span>Reintentar</span>
      </button>
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
      try {
        const s = await api.session();
        setCsrf(s.csrf);
        setSession(s);
      } catch (e) {
        setLocked(e instanceof ApiError && e.status === 0 ? "No hay conexión con el servidor de Linky." : (e as Error).message);
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
