import { useMemo, useRef, useState } from "react";
import type { ConnectorState, ConversationSummary, SessionInfo } from "../../../../shared/protocol";
import { LIMITS, Schemas } from "../../../../shared/schemas";
import { Isotype, Logotype } from "../../ui/brand";
import { Menu, Tooltip, type MenuItem } from "../../ui/floating";
import { Icon } from "../../ui/icons";
import { IconButton, StatusDot, useConfirm, useToast } from "../../ui/primitives";

function groupOf(ts: number) {
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  if (ts >= t0) return "Hoy";
  if (ts >= t0 - day) return "Ayer";
  if (ts >= t0 - 7 * day) return "Últimos 7 días";
  if (ts >= t0 - 30 * day) return "Últimos 30 días";
  return "Anteriores";
}

function Row({ c, active, onOpen, onRename, onDelete }: { c: ConversationSummary; active: boolean; onOpen: () => void; onRename: (t: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.title);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const save = () => {
    const r = Schemas.rename.safeParse({ title: value });
    if (!r.success) {
      toast("error", r.error.issues[0].message);
      return;
    }
    if (r.data.title !== c.title) onRename(r.data.title);
    setEditing(false);
  };
  if (editing) {
    return (
      <form
        className="conv conv--editing"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          className="conv__input"
          value={value}
          autoFocus
          maxLength={LIMITS.titleChars}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          aria-label="Nuevo título"
        />
      </form>
    );
  }
  return (
    <div className={`conv ${active ? "is-active" : ""}`} onMouseLeave={() => setConfirm(false)}>
      <button type="button" className="conv__open" onClick={onOpen} title={c.title}>
        <span className="conv__title">{c.title}</span>
      </button>
      <div className="conv__actions">
        {confirm ? (
          <button type="button" className="conv__confirm" onClick={onDelete} autoFocus onBlur={() => setConfirm(false)}>
            Borrar
          </button>
        ) : (
          <>
            <IconButton
              icon="pencil"
              size="sm"
              label="Renombrar"
              onClick={() => {
                setValue(c.title);
                setEditing(true);
              }}
            />
            <IconButton icon="trash" size="sm" label="Borrar" onClick={() => setConfirm(true)} />
          </>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  session,
  collapsed,
  mobileOpen,
  conversations,
  activeId,
  connectorsState,
  onToggle,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onConnectors,
  onOnboarding,
  onDeleteData,
  onLogout,
  onCloseMobile,
}: {
  session: SessionInfo;
  collapsed: boolean;
  mobileOpen: boolean;
  conversations: ConversationSummary[];
  activeId: string | null;
  connectorsState: ConnectorState | "busy";
  onToggle: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, t: string) => void;
  onDelete: (id: string) => void;
  onConnectors: () => void;
  onOnboarding: () => void;
  onDeleteData: () => Promise<void>;
  onLogout: () => void;
  onCloseMobile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const userBtn = useRef<HTMLButtonElement>(null);
  const confirm = useConfirm();
  // Con la barra contraída los nombres no se ven: el tooltip los muestra. Expandida, sobran.
  const tipOff = !collapsed || mobileOpen;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    const out = new Map<string, ConversationSummary[]>();
    for (const c of list) {
      const g = groupOf(c.updatedAt);
      out.set(g, [...(out.get(g) ?? []), c]);
    }
    return [...out.entries()];
  }, [conversations, query]);

  const name = session.user.name || "Tu cuenta";
  const initials = session.user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");

  const items: MenuItem[] = [
    { id: "conn", label: "Conectores", icon: "plug", onSelect: onConnectors },
    { id: "onb", label: "Configuración inicial", icon: "steps", onSelect: onOnboarding },
    { id: "sep1", separator: true },
    {
      id: "data",
      label: "Borrar historial y adjuntos",
      icon: "trash",
      danger: true,
      disabled: conversations.length === 0,
      onSelect: async () => {
        const ok = await confirm({
          title: "Borrar historial y adjuntos",
          message: "Se borran todas tus conversaciones y archivos adjuntos de este equipo. Lo registrado en Azure y Ripor no cambia. No se puede deshacer.",
          confirmLabel: "Borrar todo",
          tone: "danger",
        });
        if (ok) await onDeleteData();
      },
    },
    ...(session.tenancy === "multi" ? ([{ id: "sep2", separator: true }, { id: "out", label: "Cerrar sesión", icon: "logout", onSelect: onLogout }] as MenuItem[]) : []),
  ];

  return (
    <>
      <div className={`sidebar-scrim ${mobileOpen ? "is-open" : ""}`} onClick={onCloseMobile} aria-hidden="true" />
      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Barra lateral">
        <div className="sidebar__top">
          <Tooltip text="Expandir" side="right" disabled={!collapsed || mobileOpen}>
            <button type="button" className="brand-btn" onClick={collapsed ? onToggle : onNew} aria-label={collapsed ? "Expandir barra lateral" : "Linky"}>
              <span className="brand-btn__iso">
                <Isotype size={30} />
              </span>
              <span className="brand-btn__expand" aria-hidden="true">
                <Icon name="sidebar" size={18} />
              </span>
              <span className="brand-btn__word">
                <Logotype size={20} />
              </span>
            </button>
          </Tooltip>
          <IconButton icon="sidebar" label="Contraer barra lateral" side="bottom" onClick={onToggle} className="sidebar__toggle" tabIndex={collapsed ? -1 : 0} />
        </div>

        <nav className="sidebar__section">
          <Tooltip text="Nueva conversación" side="right" disabled={tipOff}>
            <button type="button" className="nav-btn nav-btn--primary" onClick={onNew}>
              <span className="nav-btn__icon">
                <Icon name="plus" size={18} />
              </span>
              <span className="nav-btn__label">Nueva conversación</span>
              <kbd className="nav-btn__kbd">Ctrl K</kbd>
            </button>
          </Tooltip>
          <Tooltip text="Conectores" side="right" disabled={tipOff}>
            <button type="button" className="nav-btn" onClick={onConnectors}>
              <span className="nav-btn__icon">
                <Icon name="plug" size={18} />
                <StatusDot state={connectorsState} />
              </span>
              <span className="nav-btn__label">Conectores</span>
            </button>
          </Tooltip>
          <Tooltip text="Configuración inicial" side="right" disabled={tipOff}>
            <button type="button" className="nav-btn" onClick={onOnboarding}>
              <span className="nav-btn__icon">
                <Icon name="steps" size={18} />
              </span>
              <span className="nav-btn__label">Configuración inicial</span>
            </button>
          </Tooltip>
        </nav>

        <div className="sidebar__list" aria-hidden={collapsed && !mobileOpen}>
          {conversations.length > 6 && (
            <label className="search">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Buscar conversaciones" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar conversaciones" />
            </label>
          )}
          {groups.map(([g, list]) => (
            <section key={g} className="conv-group">
              <h3 className="conv-group__title">{g}</h3>
              {list.map((c) => (
                <Row key={c.id} c={c} active={c.id === activeId} onOpen={() => onOpen(c.id)} onRename={(t) => onRename(c.id, t)} onDelete={() => onDelete(c.id)} />
              ))}
            </section>
          ))}
          {!conversations.length && <p className="sidebar__empty">Tus conversaciones aparecerán aquí.</p>}
          {!!conversations.length && !groups.length && <p className="sidebar__empty">Sin resultados.</p>}
        </div>

        <div className="sidebar__bottom">
          <Tooltip text={name} side="right" disabled={tipOff || menu}>
            <button ref={userBtn} type="button" className={`user-btn ${menu ? "is-open" : ""}`} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <span className="user-btn__avatar">{initials || <Icon name="account" size={16} />}</span>
              <span className="user-btn__meta">
                <span className="user-btn__name">{name}</span>
                <span className="user-btn__sub">
                  <Icon name="lock" size={11} /> Datos cifrados
                </span>
              </span>
              <Icon name="more" size={16} className="user-btn__more" />
            </button>
          </Tooltip>
          <Menu
            anchor={userBtn}
            open={menu}
            onClose={() => setMenu(false)}
            items={items}
            side={collapsed && !mobileOpen ? "right" : "top"}
            align="start"
            header={
              <>
                <span className="menu__title">{name}</span>
                <span className="menu__subtitle">Tus datos se guardan cifrados en este equipo.</span>
              </>
            }
          />
        </div>
      </aside>
    </>
  );
}
