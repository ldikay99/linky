/**
 * Piezas base de la interfaz: botones, campos, interruptor, tooltip, modal/hoja lateral y avisos.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Tooltip, type Side } from "./floating";
import { Icon, type IconName } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", size = "md", icon, loading, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; icon?: IconName; loading?: boolean }) {
  return (
    <button className={`btn btn--${variant} btn--${size} ${loading ? "is-loading" : ""} ${className}`} disabled={rest.disabled || loading} {...rest}>
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === "sm" ? 15 : 17} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, size = "md", active, className = "", tooltip = true, side = "top", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: "sm" | "md" | "lg"; active?: boolean; tooltip?: boolean; side?: Side }) {
  return (
    <Tooltip text={label} side={side} disabled={!tooltip}>
      <button aria-label={label} className={`icon-btn icon-btn--${size} ${active ? "is-active" : ""} ${className}`} {...rest}>
        <Icon name={icon} size={size === "sm" ? 16 : size === "lg" ? 20 : 18} />
      </button>
    </Tooltip>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export { Tooltip };

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {children(id)}
      {error ? <p className="field__error">{error}</p> : hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input input--area ${props.className ?? ""}`} />;
}

export function SecretInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> & { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="secret">
      <input
        {...rest}
        className="input"
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
      />
      <button type="button" className="secret__toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar" : "Mostrar"}>
        <Icon name={show ? "eyeOff" : "eye"} size={16} />
      </button>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, id }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; id?: string }) {
  return (
    <div className="select">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} className="select__chevron" />
    </div>
  );
}

export function StatusDot({ state }: { state: "connected" | "attention" | "disconnected" | "optional" | "busy" }) {
  return <span className={`dot dot--${state}`} aria-hidden="true" />;
}

/** Capa con foco atrapado, cierre con Escape y animación de entrada/salida. */
export function Overlay({ open, onClose, children, kind = "modal", label }: { open: boolean; onClose: () => void; children: ReactNode; kind?: "modal" | "sheet" | "viewer"; label: string }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement;
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 170); // = duración de salida (150 ms) + margen
      (lastFocus.current as HTMLElement | null)?.focus?.();
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mounted, onClose]);

  useEffect(() => {
    if (visible) panel.current?.querySelector<HTMLElement>("[data-autofocus], input, button")?.focus();
  }, [visible]);

  if (!mounted) return null;
  return createPortal(
    <div className={`overlay overlay--${kind} ${visible ? "is-open" : ""}`} role="presentation">
      <div className="overlay__scrim" onClick={onClose} />
      <div ref={panel} className={`overlay__panel overlay__panel--${kind}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---- avisos flotantes
type Toast = { id: number; tone: "info" | "ok" | "error"; text: string };
const ToastCtx = createContext<(tone: Toast["tone"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <Icon name={t.tone === "error" ? "alert" : t.tone === "ok" ? "check" : "info"} size={16} />
              <span>{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ---- confirmaciones (todo lo que borra o desvincula pasa por aquí)
type ConfirmOptions = { title: string; message: string; confirmLabel: string; tone?: "danger" | "default" };
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Overlay open={!!state} onClose={() => close(false)} kind="modal" label={state?.title ?? "Confirmar"}>
        {state && (
          <div className="confirm">
            <span className={`confirm__icon ${state.tone === "danger" ? "is-danger" : ""}`}>
              <Icon name={state.tone === "danger" ? "alert" : "info"} size={20} />
            </span>
            <h2 className="confirm__title">{state.title}</h2>
            <p className="confirm__text">{state.message}</p>
            <div className="confirm__actions">
              <Button variant="ghost" onClick={() => close(false)} data-autofocus>
                Cancelar
              </Button>
              <Button variant={state.tone === "danger" ? "danger" : "primary"} onClick={() => close(true)}>
                {state.confirmLabel}
              </Button>
            </div>
          </div>
        )}
      </Overlay>
    </ConfirmCtx.Provider>
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
