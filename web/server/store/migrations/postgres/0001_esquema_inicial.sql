-- 0001 · Esquema inicial de la web en PostgreSQL (diseño en docs/MODELO-DE-DATOS.md).
-- Mismo modelo que SQLite con tipos propios: uuid, timestamptz, boolean y bytea para lo cifrado.
-- Lo cifrado (bytea) lo cifra Linky con AES-256-GCM y la clave de la persona: la base nunca ve la clave ni el texto.
-- Formato de cada valor cifrado: versión (1 byte) + IV (12) + etiqueta GCM (16) + contenido; por eso mide >= 29 bytes.
-- No se edita: los cambios van en una migración nueva.

-- Persona de la transacción en curso (la fija la web con set_config('linky.user_id', …, true) en cada operación).
-- Sin persona fijada devuelve NULL y las políticas de abajo no dejan ver ni escribir ninguna fila.
CREATE FUNCTION linky_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('linky.user_id', true), '')::uuid $$;

-- ---------- personas
CREATE TABLE users (
  id          uuid PRIMARY KEY,
  name        text NOT NULL CHECK (length(name) <= 200),
  email       text CHECK (email IS NULL OR (length(email) <= 320 AND position('@' IN email) > 1)),
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  onboarded   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;
-- Modo single: una sola dueña del equipo.
CREATE UNIQUE INDEX users_single_owner ON users (role) WHERE role = 'owner';

-- ---------- sesiones e invitaciones (solo el hash SHA-256 del token: un volcado no da acceso)
CREATE TABLE sessions (
  id_hash     text PRIMARY KEY CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf        text NOT NULL CHECK (length(csrf) BETWEEN 16 AND 128),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE invites (
  token_hash  text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX invites_user ON invites (user_id);
CREATE INDEX invites_expires ON invites (expires_at);

-- ---------- conversaciones (título, transcripción e historial del modelo, cifrados)
CREATE TABLE conversations (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       bytea NOT NULL CHECK (octet_length(title) >= 29),
  transcript  bytea NOT NULL CHECK (octet_length(transcript) >= 29),
  history     bytea NOT NULL CHECK (octet_length(history) >= 29),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Destino de las llaves compuestas: una aprobación o un fragmento solo cuelga de una conversación de su misma persona.
  UNIQUE (id, user_id)
);
CREATE INDEX conversations_user ON conversations (user_id, updated_at DESC);
-- Lo cifrado no se comprime: se guarda fuera de línea sin intentar comprimirlo.
ALTER TABLE conversations ALTER COLUMN transcript SET STORAGE EXTERNAL, ALTER COLUMN history SET STORAGE EXTERNAL;

-- ---------- adjuntos (el contenido va cifrado en disco; aquí metadatos y el nombre cifrado)
CREATE TABLE files (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        bytea NOT NULL CHECK (octet_length(name) >= 29),
  media_type  text NOT NULL CHECK (length(media_type) <= 255),
  kind        text NOT NULL CHECK (kind IN ('image', 'pdf', 'word', 'sheet', 'slides', 'text')),
  size        bigint NOT NULL CHECK (size > 0),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_user ON files (user_id, created_at DESC);

-- ---------- aprobaciones (escrituras que esperan el sí de la persona; la entrada de la herramienta va cifrada)
CREATE TABLE approvals (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  tool_call_id     text NOT NULL CHECK (length(tool_call_id) BETWEEN 1 AND 200),
  tool_name        text NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 100),
  input            bytea NOT NULL CHECK (octet_length(input) >= 29),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations (id, user_id) ON DELETE CASCADE
);
CREATE INDEX approvals_conversation ON approvals (conversation_id);
CREATE INDEX approvals_pending ON approvals (user_id, conversation_id) WHERE status = 'pending';

-- ---------- memoria (recuerdos y fragmentos de conversaciones; texto y vector cifrados)
CREATE TABLE memories (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('fact', 'chunk')),
  conversation_id  uuid,
  text             bytea NOT NULL CHECK (octet_length(text) >= 29),
  vector           bytea CHECK (vector IS NULL OR octet_length(vector) >= 29),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, user_id) REFERENCES conversations (id, user_id) ON DELETE CASCADE,
  -- Un recuerdo es de la persona; un fragmento, de una conversación.
  CHECK ((kind = 'fact') = (conversation_id IS NULL))
);
CREATE INDEX memories_user ON memories (user_id, kind, created_at DESC);
CREATE INDEX memories_conversation ON memories (conversation_id) WHERE conversation_id IS NOT NULL;

-- ---------- auditoría (acción, resultado y conteos; nunca contenido). Sin llave a users: sobrevive al borrado de la
-- cuenta con solo el id interno, que ya no se asocia a nadie.
CREATE TABLE audit (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  uuid,
  action   text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  detail   text CHECK (length(detail) <= 500),
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_at ON audit (at);
CREATE INDEX audit_user ON audit (user_id, at DESC) WHERE user_id IS NOT NULL;

-- La auditoría solo crece: no se corrige (la purga por plazo borra filas, no las cambia).
CREATE FUNCTION audit_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'La auditoría no se modifica.'; END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

-- ---------- aislamiento por persona (Row Level Security)
-- Cada tabla con contenido de la persona solo muestra y acepta filas de la persona fijada en la transacción.
-- FORCE la aplica también al dueño de las tablas (el usuario con que se conecta la web). No aplica a superusuarios
-- ni a roles con BYPASSRLS: la web avisa al arrancar si se conecta con uno.
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY solo_la_persona ON conversations USING (user_id = linky_current_user()) WITH CHECK (user_id = linky_current_user());
CREATE POLICY solo_la_persona ON files USING (user_id = linky_current_user()) WITH CHECK (user_id = linky_current_user());
CREATE POLICY solo_la_persona ON approvals USING (user_id = linky_current_user()) WITH CHECK (user_id = linky_current_user());
CREATE POLICY solo_la_persona ON memories USING (user_id = linky_current_user()) WITH CHECK (user_id = linky_current_user());
