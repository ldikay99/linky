import { useMemo, useState } from "react";
import type { ConnectorState, ConversationSummary, SessionInfo } from "../../../../shared/protocol";
import { Imagotype, Isotype } from "../../ui/brand";
import { Icon } from "../../ui/icons";
import { IconButton, StatusDot, Tooltip } from "../../ui/primitives";

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
  if (editing) {
    return (
      <form
        className="conv conv--editing"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onRename(value.trim());
          setEditing(false);
        }}
      >
        <input className="conv__input" value={value} autoFocus maxLength={120} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} aria-label="Nuevo título" />
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
          <button type="button" className="conv__confirm" onClick={onDelete}>
            Borrar
          </button>
        ) : (
          <>
            <IconButton
              icon="pencil"
              size="sm"
              label="Renombrar"
              tooltip={false}
              onClick={() => {
                setValue(c.title);
                setEditing(true);
              }}
            />
            <IconButton icon="trash" size="sm" label="Borrar" tooltip={false} onClick={() => setConfirm(true)} />
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
  onLogout: () => void;
  onCloseMobile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
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
  const initials = session.user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <>
      <div className={`sidebar-scrim ${mobileOpen ? "is-open" : ""}`} onClick={onCloseMobile} aria-hidden="true" />
      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Barra lateral">
        <div className="sidebar__top">
          <div className="sidebar__brand">{collapsed ? <Isotype size={30} /> : <Imagotype size={30} />}</div>
          <IconButton icon="sidebar" label={collapsed ? "Expandir" : "Contraer"} onClick={onToggle} className="sidebar__toggle" />
        </div>

        <div className="sidebar__section">
          <Tooltip text="Nueva conversación" side="right">
            <button type="button" className="nav-btn nav-btn--primary" onClick={onNew}>
              <Icon name="plus" size={18} />
              <span className="nav-btn__label">Nueva conversación</span>
              <kbd className="nav-btn__kbd">Ctrl K</kbd>
            </button>
          </Tooltip>
          <Tooltip text="Conectores" side="right">
            <button type="button" className="nav-btn" onClick={onConnectors}>
              <span className="nav-btn__icon">
                <Icon name="plug" size={18} />
                <StatusDot state={connectorsState} />
              </span>
              <span className="nav-btn__label">Conectores</span>
            </button>
          </Tooltip>
          <Tooltip text="Configuración inicial" side="right">
            <button type="button" className="nav-btn" onClick={onOnboarding}>
              <Icon name="steps" size={18} />
              <span className="nav-btn__label">Configuración inicial</span>
            </button>
          </Tooltip>
        </div>

        <div className="sidebar__list">
          {conversations.length > 6 && (
            <label className="search">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Buscar conversaciones" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar conversaciones" />
            </label>
          )}
          {groups.map(([g, items]) => (
            <section key={g} className="conv-group">
              <h3 className="conv-group__title">{g}</h3>
              {items.map((c) => (
                <Row key={c.id} c={c} active={c.id === activeId} onOpen={() => onOpen(c.id)} onRename={(t) => onRename(c.id, t)} onDelete={() => onDelete(c.id)} />
              ))}
            </section>
          ))}
          {!conversations.length && <p className="sidebar__empty">Tus conversaciones aparecerán aquí.</p>}
        </div>

        <div className="sidebar__bottom">
          <div className={`user ${menu ? "is-open" : ""}`}>
            <button type="button" className="user__btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              <span className="user__avatar">{initials || <Icon name="account" size={16} />}</span>
              <span className="user__meta">
                <span className="user__name">{session.user.name || "Tu cuenta"}</span>
                <span className="user__sub">
                  <Icon name="lock" size={11} /> Datos cifrados
                </span>
              </span>
              <Icon name="chevronDown" size={15} className="user__chev" />
            </button>
            {menu && (
              <div className="user__menu" role="menu">
                <button type="button" role="menuitem" onClick={onLogout}>
                  <Icon name="logout" size={16} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
