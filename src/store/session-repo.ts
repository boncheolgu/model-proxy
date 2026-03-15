import type { DbHandle } from './db.js';

export type SessionRow = {
  tenantId: string;
  conversationKey: string;
  claudeSessionId: string | null;
  activeCli: string;
  model: string;
  invalidatedAt: string | null;
};

export class SessionRepo {
  constructor(private readonly db: DbHandle) {}

  get(tenantId: string, conversationKey: string): SessionRow | null {
    const row = this.db
      .prepare(
        `SELECT tenant_id, conversation_key, claude_session_id, active_cli, model, invalidated_at
         FROM conversation_sessions WHERE tenant_id = ? AND conversation_key = ?`,
      )
      .get(tenantId, conversationKey) as
      | {
          tenant_id: string;
          conversation_key: string;
          claude_session_id: string | null;
          active_cli: string;
          model: string;
          invalidated_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      conversationKey: row.conversation_key,
      claudeSessionId: row.claude_session_id,
      activeCli: row.active_cli,
      model: row.model,
      invalidatedAt: row.invalidated_at,
    };
  }

  upsert(input: {
    tenantId: string;
    conversationKey: string;
    claudeSessionId: string | null;
    model: string;
    activeCli?: string;
    invalidatedAt?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO conversation_sessions(tenant_id, conversation_key, claude_session_id, active_cli, model, invalidated_at)
         VALUES(?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, conversation_key)
         DO UPDATE SET
           claude_session_id = excluded.claude_session_id,
           active_cli = excluded.active_cli,
           model = excluded.model,
           invalidated_at = excluded.invalidated_at,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        input.tenantId,
        input.conversationKey,
        input.claudeSessionId,
        input.activeCli ?? 'claude',
        input.model,
        input.invalidatedAt ?? null,
      );
  }

  invalidate(tenantId: string, conversationKey: string) {
    this.db
      .prepare(
        `UPDATE conversation_sessions
         SET claude_session_id = NULL,
             invalidated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ? AND conversation_key = ?`,
      )
      .run(tenantId, conversationKey);
  }
}
