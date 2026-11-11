/**
 * Estado del chat: conversaciones, mensajes y el turno en curso (texto en streaming, herramientas, aprobaciones).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalPart, Attachment, ConversationSummary, StreamEvent, ToolPart, UiMessage, UiPart } from "../../../shared/protocol";
import { api, stream } from "../api";

export type ChatState = ReturnType<typeof useChat>;

export function useChat(onError: (message: string) => void) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refreshList = useCallback(async () => {
    try {
      setConversations(await api.conversations());
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const open = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort();
      setActiveId(id);
      if (!id) {
        setMessages([]);
        return;
      }
      setLoading(true);
      try {
        const c = await api.conversation(id);
        if (activeRef.current === id) setMessages(c.messages);
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  /** Aplica cada evento del stream sobre el último mensaje del asistente. */
  const apply = useCallback((e: StreamEvent) => {
    const mutateLast = (fn: (parts: UiPart[]) => UiPart[]) =>
      setMessages((ms) => {
        const i = ms.length - 1;
        if (i < 0 || ms[i].role !== "assistant") return ms;
        const copy = ms.slice();
        copy[i] = { ...ms[i], parts: fn(ms[i].parts ?? []) };
        return copy;
      });
    switch (e.type) {
      case "conversation":
        setActiveId(e.id);
        setConversations((cs) => {
          const rest = cs.filter((c) => c.id !== e.id);
          return [{ id: e.id, title: e.title, updatedAt: Date.now() }, ...rest];
        });
        break;
      case "message":
        setMessages((ms) => [...ms, e.message]);
        break;
      case "text":
        mutateLast((parts) => {
          const last = parts[parts.length - 1];
          if (last?.type === "text") return [...parts.slice(0, -1), { ...last, text: last.text + e.delta }];
          return [...parts, { type: "text", text: e.delta }];
        });
        break;
      case "part":
        mutateLast((parts) => [...parts, e.part]);
        break;
      case "part-update":
        // Una aprobación puede estar en un mensaje anterior: se busca en todos.
        setMessages((ms) =>
          ms.map((m) =>
            m.parts?.some((p) => (p.type === "tool" || p.type === "approval") && p.id === e.id)
              ? { ...m, parts: m.parts.map((p) => ((p.type === "tool" || p.type === "approval") && p.id === e.id ? ({ ...p, ...e.patch } as ToolPart | ApprovalPart) : p)) }
              : m,
          ),
        );
        break;
      case "error":
        setMessages((ms) => [...ms, { id: crypto.randomUUID(), role: "assistant", createdAt: Date.now(), parts: [{ type: "notice", tone: "error", text: e.message }] }]);
        break;
      case "done":
        break;
    }
  }, []);

  const run = useCallback(
    async (body: unknown) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      try {
        await stream(body, apply, ctrl.signal);
      } catch (e) {
        if (!ctrl.signal.aborted) apply({ type: "error", message: (e as Error).message });
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
        void refreshList();
      }
    },
    [apply, refreshList],
  );

  const send = useCallback(
    async (text: string, attachments: Attachment[]) => {
      if (busy) return;
      setMessages((ms) => [...ms, { id: crypto.randomUUID(), role: "user", createdAt: Date.now(), text, attachments }]);
      await run({ kind: "message", conversationId: activeRef.current ?? undefined, text, attachmentIds: attachments.map((a) => a.id) });
    },
    [busy, run],
  );

  const decide = useCallback(
    async (approvalId: string, approve: boolean) => {
      if (busy || !activeRef.current) return;
      await run({ kind: "approval", conversationId: activeRef.current, approvalId, approve });
    },
    [busy, run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const rename = useCallback(
    async (id: string, title: string) => {
      setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
      await api.rename(id, title).catch((e: Error) => onError(e.message));
    },
    [onError],
  );

  const remove = useCallback(
    async (id: string) => {
      setConversations((cs) => cs.filter((c) => c.id !== id));
      if (activeRef.current === id) void open(null);
      await api.remove(id).catch((e: Error) => onError(e.message));
    },
    [onError, open],
  );

  return { conversations, activeId, messages, busy, loading, open, send, decide, stop, rename, remove };
}
