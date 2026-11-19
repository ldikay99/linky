-- 0002 · Índices para los borrados en cascada, las aprobaciones pendientes y la purga de sesiones.
-- Sin ellos, borrar una conversación o purgar sesiones recorre la tabla completa. Mismos índices que PostgreSQL.
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS invites_user ON invites(user_id);
CREATE INDEX IF NOT EXISTS invites_expires ON invites(expires_at);
CREATE INDEX IF NOT EXISTS files_user ON files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approvals_conversation ON approvals(conversation_id);
CREATE INDEX IF NOT EXISTS approvals_pending ON approvals(user_id, conversation_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS memories_conversation ON memories(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
