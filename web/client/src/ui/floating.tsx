/**
 * Capas flotantes (tooltips y menús) que siempre quedan dentro de la ventana: se ubican en el lado pedido, se
 * voltean si no caben y se ajustan a los bordes. Se dibujan en un portal para que ningún contenedor las recorte.
 */
import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

export type Side = "top" | "bottom" | "left" | "right";
const MARGIN = 8;

export function place(anchor: DOMRect, w: number, h: number, side: Side, gap = 8, align: "center" | "start" | "end" = "center") {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits: Record<Side, boolean> = {
    top: anchor.top - gap - h >= MARGIN,
    bottom: anchor.bottom + gap + h <= vh - MARGIN,
    left: anchor.left - gap - w >= MARGIN,
    right: anchor.right + gap + w <= vw - MARGIN,
  };
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const order: Side[] = [side, opposite[side], ...(["top", "bottom", "right", "left"] as Side[]).filter((s) => s !== side && s !== opposite[side])];
  const chosen = order.find((s) => fits[s]) ?? side;
  let x: number;
  let y: number;
  if (chosen === "top" || chosen === "bottom") {
    y = chosen === "top" ? anchor.top - gap - h : anchor.bottom + gap;
    x = align === "start" ? anchor.left : align === "end" ? anchor.right - w : anchor.left + anchor.width / 2 - w / 2;
  } else {
    x = chosen === "left" ? anchor.left - gap - w : anchor.right + gap;
    y = anchor.top + anchor.height / 2 - h / 2;
  }
  x = Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - w - MARGIN));
  y = Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - h - MARGIN));
  return { x, y, side: chosen };
}

/** Tooltip con retraso, por puntero o foco; desactivable (p. ej. si la etiqueta ya se ve). */
export function Tooltip({ text, side = "top", disabled, children }: { text: string; side?: Side; disabled?: boolean; children: ReactElement<Record<string, unknown>> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(() => {
    if (disabled || window.matchMedia("(hover: none)").matches) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 420);
  }, [disabled]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);
  useEffect(() => {
    if (!open) return;
    const close = () => hide();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, hide]);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const r = tip.current.getBoundingClientRect();
    const p = place(anchor.current.getBoundingClientRect(), r.width, r.height, side);
    setPos({ x: p.x, y: p.y });
  }, [open, side, text]);

  const childRef = children.props.ref as ((el: HTMLElement | null) => void) | RefObject<HTMLElement | null> | undefined;
  const child = cloneElement(children, {
    // Se conserva la ref propia del hijo (p. ej. el ancla de un menú) además de la del tooltip.
    ref: (el: HTMLElement | null) => {
      anchor.current = el;
      if (typeof childRef === "function") childRef(el);
      else if (childRef) childRef.current = el;
    },
    onMouseEnter: (e: unknown) => {
      show();
      (children.props.onMouseEnter as ((e: unknown) => void) | undefined)?.(e);
    },
    onMouseLeave: (e: unknown) => {
      hide();
      (children.props.onMouseLeave as ((e: unknown) => void) | undefined)?.(e);
    },
    onFocus: (e: unknown) => {
      show();
      (children.props.onFocus as ((e: unknown) => void) | undefined)?.(e);
    },
    onBlur: (e: unknown) => {
      hide();
      (children.props.onBlur as ((e: unknown) => void) | undefined)?.(e);
    },
    onPointerDown: (e: unknown) => {
      hide();
      (children.props.onPointerDown as ((e: unknown) => void) | undefined)?.(e);
    },
  });

  return (
    <>
      {child}
      {open &&
        createPortal(
          <div ref={tip} role="tooltip" className={`tooltip ${pos ? "is-visible" : ""}`} style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}

export type MenuItem = { id: string; label: string; icon?: IconName; danger?: boolean; disabled?: boolean; hint?: string; onSelect: () => void } | { id: string; separator: true };

/** Menú anclado: se abre hacia donde haya espacio, se cierra con clic fuera, Escape o al cambiar el tamaño. */
export function Menu({ anchor, open, onClose, items, side = "top", align = "start", header }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; items: MenuItem[]; side?: Side; align?: "start" | "center" | "end"; header?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    setPos(place(anchor.current.getBoundingClientRect(), r.width, r.height, side, 8, align));
  }, [open, anchor, side, align, items.length]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    const onResize = () => onClose();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      role="menu"
      className={`menu ${pos ? `is-visible menu--${pos.side}` : ""}`}
      style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}
    >
      {header && <div className="menu__header">{header}</div>}
      {items.map((it) =>
        "separator" in it ? (
          <div key={it.id} className="menu__sep" role="separator" />
        ) : (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className={`menu__item ${it.danger ? "is-danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon && <Icon name={it.icon} size={16} />}
            <span className="menu__label">{it.label}</span>
            {it.hint && <span className="menu__hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
