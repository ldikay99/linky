import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Attachment, NoticePart, SessionInfo } from "../../../../shared/protocol";
import type { ChatState } from "../../state/useChat";
import { Isotype } from "../../ui/brand";
import { Icon, type IconName } from "../../ui/icons";
import { IconButton, Spinner } from "../../ui/primitives";
import { Composer, type ComposerHandle } from "./Composer";
import { Message } from "./Messages";

const SUGGESTIONS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: "clock", title: "Revisa mi día", text: "Revisa todo lo que hice hoy y dime qué me falta registrar." },
  { icon: "calendar", title: "Ripor del mes", text: "¿Qué días me faltan en Ripor este mes?" },
  { icon: "boards", title: "Registrar en Azure", text: "Registra mi día de ayer en Azure con lo que hice." },
  { icon: "plug", title: "Mis conexiones", text: "Revisa el estado de mis conexiones." },
];

export function ChatView({ chat, session, onOpenFile, onAction, sidebarCollapsed, onToggleSidebar }: { chat: ChatState; session: SessionInfo; onOpenFile: (a: Attachment, all: Attachment[]) => void; onAction: (a: NonNullable<NoticePart["action"]>) => void; sidebarCollapsed: boolean; onToggleSidebar: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [stick, setStick] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const firstName = session.user.name.split(/\s+/)[0];

  const toBottom = useCallback((smooth = true) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Seguir el final mientras llega texto, salvo que la persona haya subido a leer.
  useLayoutEffect(() => {
    if (stick) toBottom(chat.busy);
  }, [chat.messages, stick, toBottom, chat.busy]);

  useEffect(() => {
    setStick(true);
    requestAnimationFrame(() => toBottom(false));
    composer.current?.focus();
  }, [chat.activeId, toBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const empty = chat.messages.length === 0 && !chat.loading;
  const title = chat.conversations.find((c) => c.id === chat.activeId)?.title ?? "Nueva conversación";
  const lastId = chat.messages[chat.messages.length - 1]?.id;

  return (
    <main
      className="chat"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composer.current?.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="chat__header">
        {/* Solo en móvil: abre el cajón. En escritorio la barra se expande desde su propio logo. */}
        <IconButton icon="sidebar" label="Abrir barra lateral" side="bottom" onClick={onToggleSidebar} className="chat__toggle" />
        <h1 className="chat__title">{empty ? "" : title}</h1>
        <div className={`ai-pill ${session.ai.configured ? "is-on" : ""}`} title={session.ai.configured ? `${session.ai.provider} · ${session.ai.model}` : "Sin proveedor de IA: modo de acciones directas"}>
          <span className="ai-pill__dot" />
          {session.ai.configured ? (session.ai.model ?? "IA") : "Acciones directas"}
        </div>
      </header>

      <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
        {chat.loading && (
          <div className="chat__loading">
            <Spinner size={22} />
          </div>
        )}
        {empty ? (
          <section className="hello">
            <Isotype size={64} animated />
            <h2 className="hello__title">{firstName ? `Hola, ${firstName}` : "Hola"}</h2>
            <p className="hello__sub">¿Qué registramos hoy? Puedes escribir, dictar o adjuntar evidencias.</p>
            <div className="hello__grid">
              {SUGGESTIONS.map((s, i) => (
                <button key={s.title} type="button" className="suggest" style={{ animationDelay: `${120 + i * 60}ms` }} onClick={() => void chat.send(s.text, [])}>
                  <span className="suggest__icon">
                    <Icon name={s.icon} size={18} />
                  </span>
                  <span className="suggest__title">{s.title}</span>
                  <span className="suggest__text">{s.text}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="thread">
            {chat.messages.map((m) => (
              <Message key={m.id} m={m} streaming={chat.busy && m.id === lastId && m.role === "assistant"} busy={chat.busy} onDecide={(id, a) => void chat.decide(id, a)} onOpen={onOpenFile} onAction={onAction} />
            ))}
            {chat.busy && chat.messages[chat.messages.length - 1]?.role === "user" && (
              <div className="msg msg--assistant">
                <div className="msg__avatar">
                  <Isotype size={28} />
                </div>
                <div className="thinking" aria-label="Pensando">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <button type="button" className={`to-bottom ${stick ? "" : "is-visible"}`} onClick={() => toBottom()} aria-label="Ir al final" tabIndex={stick ? -1 : 0}>
        <Icon name="arrowDown" size={16} />
      </button>

      <div className="chat__composer">
        <Composer ref={composer} busy={chat.busy} onSend={(t, a) => void chat.send(t, a)} onStop={chat.stop} stt={session.stt} maxUploadMb={session.maxUploadMb} onOpen={(a) => onOpenFile(a, [a])} placeholder="Escribe o dicta lo que hiciste…" />
      </div>

      <div className={`dropzone ${dragging ? "is-active" : ""}`} aria-hidden={!dragging}>
        <div className="dropzone__card">
          <Icon name="paperclip" size={26} />
          <p>Suelta tus evidencias aquí</p>
          <span>Imágenes, PDF, Word, Excel, PowerPoint y texto</span>
        </div>
      </div>
    </main>
  );
}
