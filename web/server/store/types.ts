/**
 * Contrato del almacenamiento de la web. Lo cumplen SQLite (equipo de una persona) y PostgreSQL (servidor del área):
 * las rutas, el chat y la memoria solo conocen esta interfaz.
 * Todo el contenido de la persona entra y sale en claro por aquí y se guarda cifrado (ver sealed.ts).
 */
import type { ConversationSummary, UiMessage } from "../../shared/protocol.js";

export type Role = "owner" | "admin" | "member";
export type UserRow = { id: string; name: string; email: string | null; role: Role; onboarded: boolean; createdAt: number };
export type SessionRow = { userId: string; csrf: string; expiresAt: number };
export type FileRow = { id: string; userId: string; name: string; mediaType: string; kind: string; size: number; sha256: string; createdAt: number };
export type ApprovalRow = { id: string; userId: string; conversationId: string; toolCallId: string; toolName: string; input: Record<string, unknown>; status: string };
export type ApprovalStatus = "approved" | "rejected";

/**
 * Historial del modelo tal como lo guarda Linky: los adjuntos van por id y se hidratan al enviar.
 * `summary` resume lo anterior a `summarizedUpTo` (el historial completo nunca se borra; solo deja de enviarse).
 */
export type StoredHistory = { messages: unknown[]; previews: Record<string, string>; dayPreviewFile?: string; summary?: string; summarizedUpTo?: number };

export type StoredConversation = { title: string; transcript: UiMessage[]; history: StoredHistory; updatedAt: number };

/** fact: lo que Linky debe recordar de la persona (entre chats). chunk: fragmento de una conversación, para buscar. */
export type MemoryKind = "fact" | "chunk";
export type MemoryRow = { id: string; kind: MemoryKind; conversationId: string | null; text: string; vector: number[] | null; createdAt: number };
export type NewMemory = { id: string; userId: string; kind: MemoryKind; conversationId: string | null; text: string; vector: number[] | null };

/** PostgreSQL: conexión ya validada (ver config.ts y postgres.ts). Sin ella se usa SQLite en el directorio de datos. */
export type DatabaseConfig = {
  url: string;
  /** Contraseña leída de un archivo de secreto; tiene prioridad sobre la de la URL. */
  password?: string;
  /** Certificado de la autoridad que firmó el del servidor (PEM), para verificar la conexión TLS. */
  ca?: string;
  /** 1 solo en una red privada del mismo anfitrión (p. ej. la red interna de Docker Compose). */
  allowPlaintext?: boolean;
  /** Esquema propio (pruebas aisladas). Por defecto, el del usuario de la base. */
  schema?: string;
};

export interface Store {
  readonly backend: "sqlite" | "postgres";
  close(): Promise<void>;

  /** Auditoría: acción, resultado y conteos; nunca contenido ni secretos. */
  audit(userId: string | null, action: string, detail?: string): Promise<void>;

  // ---- usuarios
  userById(id: string): Promise<UserRow | null>;
  owner(): Promise<UserRow | null>;
  createUser(name: string, email: string | null, role: Role): Promise<UserRow>;
  updateUser(id: string, patch: { name?: string; onboarded?: boolean }): Promise<void>;

  // ---- invitaciones y sesiones (solo hashes: un volcado de la base no da acceso)
  createInvite(tokenHash: string, userId: string, ttlMs: number): Promise<void>;
  consumeInvite(tokenHash: string): Promise<string | null>;
  createSession(idHash: string, userId: string, csrf: string, ttlMs: number): Promise<void>;
  session(idHash: string): Promise<SessionRow | null>;
  deleteSession(idHash: string): Promise<void>;
  purgeExpired(): Promise<void>;

  // ---- conversaciones
  listConversations(userId: string): Promise<ConversationSummary[]>;
  createConversation(userId: string, title: string): Promise<string>;
  conversation(userId: string, id: string): Promise<StoredConversation | null>;
  saveConversation(userId: string, id: string, data: { transcript: UiMessage[]; history: StoredHistory }): Promise<void>;
  renameConversation(userId: string, id: string, title: string): Promise<boolean>;
  deleteConversation(userId: string, id: string): Promise<boolean>;
  /** Borra conversaciones (y sus aprobaciones y fragmentos) y el registro de adjuntos de la persona. Los blobs los borra Files. */
  deleteUserData(userId: string): Promise<{ conversations: number; files: number }>;

  // ---- archivos (el contenido va cifrado en disco; aquí solo metadatos)
  addFile(f: FileRow): Promise<void>;
  file(userId: string, id: string): Promise<FileRow | null>;

  // ---- memoria (texto y vector cifrados: un vector también puede revelar el contenido)
  addMemory(m: NewMemory): Promise<void>;
  memories(userId: string, kind?: MemoryKind, limit?: number): Promise<MemoryRow[]>;
  countMemories(userId: string, kind: MemoryKind): Promise<number>;
  deleteMemory(userId: string, id: string): Promise<boolean>;
  deleteMemories(userId: string, kind: MemoryKind): Promise<number>;

  // ---- aprobaciones (escrituras que esperan el sí de la persona)
  addApproval(a: Omit<ApprovalRow, "status">): Promise<void>;
  approval(userId: string, id: string): Promise<ApprovalRow | null>;
  /** Pasa de pending al estado nuevo una sola vez (dos clics no aplican dos veces). */
  settleApproval(userId: string, id: string, status: ApprovalStatus): Promise<boolean>;
  pendingApprovals(userId: string, conversationId: string): Promise<string[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Los ids de Linky son UUID; uno que no lo es no existe (en PostgreSQL, además, la columna lo rechazaría con error). */
export const isUuid = (v: string) => UUID.test(v);
