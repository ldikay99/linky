/**
 * Lo que Linky recuerda de la persona: visible, editable y borrable por ella (transparencia y control de sus datos).
 */
import { useCallback, useEffect, useState } from "react";
import { MSG } from "../../../../shared/messages";
import { LIMITS, memorySchema } from "../../../../shared/schemas";
import { api, type MemoryFact } from "../../api";
import { Icon } from "../../ui/icons";
import { Button, IconButton, Overlay, Spinner, TextArea, useConfirm, useToast } from "../../ui/primitives";

export function MemoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [chunks, setChunks] = useState(0);
  const [semantic, setSemantic] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await api.memory();
      setFacts(r.facts);
      setChunks(r.chunks);
      setSemantic(r.semantic);
    } catch (e) {
      setFacts([]);
      toast("error", (e as Error).message);
    }
  }, [toast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const add = async () => {
    // Misma regla que el servidor (incluye el guardián de secretos).
    const v = memorySchema.safeParse({ text });
    if (!v.success) return setError(v.error.issues[0].message);
    setError(null);
    setBusy(true);
    try {
      const r = await api.addMemory(v.data.text);
      setText("");
      toast("ok", r.duplicate ? "Linky ya lo recordaba." : "Guardado en la memoria.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay open={open} onClose={onClose} kind="sheet" label="Memoria">
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <h2>Memoria</h2>
            <p className="sheet__sub">
              <Icon name="lock" size={13} /> Lo que Linky recuerda de ti para trabajar a tu manera. Cifrado y solo tuyo.
            </p>
          </div>
          <div className="sheet__actions">
            <IconButton icon="x" label="Cerrar" side="bottom" onClick={onClose} />
          </div>
        </header>
        <div className="sheet__body">
          <section className="mem-add">
            <TextArea
              rows={2}
              value={text}
              maxLength={LIMITS.memoryChars}
              placeholder="Ej.: Las Tasks de IA llevan las etiquetas DAVIS DIAZ y 005-SGDEA."
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add();
              }}
              aria-label="Algo que Linky debe recordar"
              aria-invalid={!!error}
            />
            <div className="mem-add__row">
              {error ? <p className="field__error">{error}</p> : <p className="field__hint">Linky también aprende solo mientras conversan. Nunca guarda claves ni tokens.</p>}
              <Button variant="primary" size="sm" icon="plus" loading={busy} onClick={() => void add()}>
                Recordar
              </Button>
            </div>
          </section>

          {facts === null ? (
            <div className="center pad">
              <Spinner size={20} />
            </div>
          ) : facts.length ? (
            <ul className="mem-list">
              {facts.map((f) => (
                <li key={f.id} className="mem">
                  <p className="mem__text">{f.text}</p>
                  <span className="mem__date">{new Date(f.createdAt).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}</span>
                  <IconButton
                    icon="trash"
                    size="sm"
                    label="Olvidar"
                    onClick={async () => {
                      const ok = await confirm({ title: "Olvidar este recuerdo", message: `Linky dejará de tener en cuenta: “${f.text.slice(0, 140)}${f.text.length > 140 ? "…" : ""}”`, confirmLabel: "Olvidar", tone: "danger" });
                      if (!ok) return;
                      try {
                        await api.deleteMemory(f.id);
                        setFacts((xs) => xs?.filter((x) => x.id !== f.id) ?? null);
                      } catch (e) {
                        toast("error", (e as Error).message);
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small center pad">Aún no hay recuerdos. Linky los irá guardando cuando aprenda cómo trabajas.</p>
          )}

          <section className="mem-foot">
            <p className="muted small">
              {chunks.toLocaleString("es-CO")} fragmento(s) de tus conversaciones están indexados para encontrarlos después {semantic ? "(búsqueda por significado)" : "(búsqueda por palabras)"}. Se borran al borrar la conversación.
            </p>
            {!!facts?.length && (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={async () => {
                  const ok = await confirm({ title: "Borrar toda la memoria", message: "Linky olvidará todo lo que aprendió de cómo trabajas. Tus conversaciones no se borran. No se puede deshacer.", confirmLabel: "Borrar memoria", tone: "danger" });
                  if (!ok) return;
                  try {
                    const r = await api.clearMemory();
                    toast("ok", `Se olvidaron ${r.deleted} recuerdo(s).`);
                    await load();
                  } catch (e) {
                    toast("error", (e as Error).message ?? MSG.internal);
                  }
                }}
              >
                Borrar toda la memoria
              </Button>
            )}
          </section>
        </div>
      </div>
    </Overlay>
  );
}
