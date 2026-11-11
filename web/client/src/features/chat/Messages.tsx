import { memo, useEffect, useState } from "react";
import type { ApprovalPart, Attachment, NoticePart, ToolPart, UiMessage } from "../../../../shared/protocol";
import { cachedUrl, getFile } from "../../fileCache";
import { Isotype } from "../../ui/brand";
import { Icon, kindIcon } from "../../ui/icons";
import { Markdown } from "../../ui/Markdown";
import { Button, IconButton, Spinner, formatBytes, useToast } from "../../ui/primitives";

function pretty(text?: string) {
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function ToolCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool tool--${part.status} ${open ? "is-open" : ""}`}>
      <button type="button" className="tool__head" onClick={() => part.output && setOpen((o) => !o)} aria-expanded={open}>
        <span className="tool__state">{part.status === "running" ? <Spinner size={14} /> : <Icon name={part.status === "error" ? "alert" : "check"} size={14} strokeWidth={2} />}</span>
        <span className="tool__label">
          {part.label}
          {part.status === "running" && <span className="shimmer" aria-hidden="true" />}
        </span>
        {part.ms != null && <span className="tool__ms">{part.ms < 1000 ? `${part.ms} ms` : `${(part.ms / 1000).toFixed(1)} s`}</span>}
        {part.output && <Icon name="chevronDown" size={15} className="tool__chev" />}
      </button>
      <div className="tool__body" hidden={!open}>
        <pre>{pretty(part.output)}</pre>
      </div>
    </div>
  );
}

function ApprovalCard({ part, onDecide, busy }: { part: ApprovalPart; onDecide: (id: string, approve: boolean) => void; busy: boolean }) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const pending = part.status === "pending";
  const working = pending && choice !== null && busy;
  const statusText = { pending: "Esperando tu aprobación", approved: "Aprobado y aplicado", rejected: "Rechazado", failed: "No se pudo aplicar" }[part.status];
  return (
    <div className={`approval approval--${part.status}`}>
      <div className="approval__head">
        <span className="approval__icon">
          <Icon name="shield" size={18} />
        </span>
        <div>
          <p className="approval__title">{part.title}</p>
          <p className="approval__status">{working ? "Aplicando…" : statusText}</p>
        </div>
      </div>
      <ul className="approval__summary">
        {part.summary.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {part.result && part.status !== "pending" && (
        <details className="approval__result">
          <summary>Ver resultado</summary>
          <pre>{pretty(part.result)}</pre>
        </details>
      )}
      {pending && (
        <div className="approval__actions">
          <Button
            variant="primary"
            icon="check"
            loading={working && choice === true}
            disabled={busy}
            onClick={() => {
              setChoice(true);
              onDecide(part.id, true);
            }}
          >
            Aprobar
          </Button>
          <Button
            variant="ghost"
            icon="x"
            loading={working && choice === false}
            disabled={busy}
            onClick={() => {
              setChoice(false);
              onDecide(part.id, false);
            }}
          >
            Rechazar
          </Button>
        </div>
      )}
    </div>
  );
}

function Notice({ part, onAction }: { part: NoticePart; onAction: (a: NonNullable<NoticePart["action"]>) => void }) {
  if (part.action) {
    return (
      <button type="button" className={`notice notice--${part.tone} notice--action`} onClick={() => onAction(part.action!)}>
        <Icon name={part.action === "open-connectors" ? "plug" : "steps"} size={16} />
        <span>{part.text}</span>
        <Icon name="arrowRight" size={15} />
      </button>
    );
  }
  return (
    <div className={`notice notice--${part.tone}`} role={part.tone === "error" ? "alert" : undefined}>
      <Icon name={part.tone === "error" ? "alert" : "info"} size={16} />
      <span>{part.text}</span>
    </div>
  );
}

/** URL local (en memoria) de un adjunto: se descarga una vez y la reusan miniatura y visor. */
function useFileUrl(id: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(() => (enabled ? cachedUrl(id) : null));
  useEffect(() => {
    if (!enabled || url) return;
    let alive = true;
    getFile(id)
      .then((e) => alive && setUrl(e.url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, enabled, url]);
  return url;
}

/** Al pasar el puntero se adelanta la descarga (y el visor de PDF), así abrir es inmediato. */
function warmUp(att: Attachment) {
  void getFile(att.id).catch(() => undefined);
  if (att.kind === "pdf") void import("pdfjs-dist").catch(() => undefined);
}

export function AttachmentTile({ att, onOpen }: { att: Attachment; onOpen: (a: Attachment) => void }) {
  const isImg = att.kind === "image" && /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon)$/.test(att.mediaType);
  const url = useFileUrl(att.id, isImg);
  return (
    <button type="button" className={`att ${isImg ? "att--image" : ""}`} onClick={() => onOpen(att)} onPointerEnter={() => warmUp(att)} onFocus={() => warmUp(att)} title={att.name}>
      {isImg ? (
        url ? <img src={url} alt={att.name} decoding="async" /> : <span className="att__loading" aria-hidden="true" />
      ) : (
        <>
          <span className={`att__icon att__icon--${att.kind}`}>
            <Icon name={kindIcon(att.kind)} size={20} />
          </span>
          <span className="att__meta">
            <span className="att__name">{att.name}</span>
            <span className="att__sub">{formatBytes(att.size)}</span>
          </span>
        </>
      )}
    </button>
  );
}

function copyText(m: UiMessage) {
  return (m.parts ?? []).filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n");
}

export const Message = memo(function Message({ m, streaming, busy, onDecide, onOpen, onAction }: { m: UiMessage; streaming: boolean; busy: boolean; onDecide: (id: string, a: boolean) => void; onOpen: (a: Attachment, all: Attachment[]) => void; onAction: (a: NonNullable<NoticePart["action"]>) => void }) {
  const toast = useToast();
  if (m.role === "user") {
    return (
      <div className="msg msg--user">
        {!!m.attachments?.length && (
          <div className="msg__atts">
            {m.attachments.map((a) => (
              <AttachmentTile key={a.id} att={a} onOpen={(x) => onOpen(x, m.attachments!)} />
            ))}
          </div>
        )}
        {m.text && <div className="bubble">{m.text}</div>}
      </div>
    );
  }
  const parts = m.parts ?? [];
  const lastIdx = parts.length - 1;
  return (
    <div className="msg msg--assistant">
      <div className="msg__avatar">
        <Isotype size={28} />
      </div>
      <div className="msg__content">
        {parts.length === 0 && streaming && (
          <div className="thinking" aria-label="Pensando">
            <span />
            <span />
            <span />
          </div>
        )}
        {parts.map((p, i) => {
          switch (p.type) {
            case "text":
              return <Markdown key={i} text={p.text} streaming={streaming && i === lastIdx} />;
            case "tool":
              return <ToolCard key={p.id} part={p} />;
            case "approval":
              return <ApprovalCard key={p.id} part={p} onDecide={onDecide} busy={busy} />;
            case "notice":
              return <Notice key={i} part={p} onAction={onAction} />;
          }
        })}
        {!streaming && copyText(m) && (
          <div className="msg__tools">
            <IconButton
              icon="copy"
              size="sm"
              label="Copiar respuesta"
              onClick={() => {
                void navigator.clipboard.writeText(copyText(m)).then(() => toast("ok", "Copiado."));
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
});
