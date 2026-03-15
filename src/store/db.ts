import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function createDb(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      tenant_id TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      claude_session_id TEXT,
      active_cli TEXT NOT NULL DEFAULT 'claude',
      model TEXT NOT NULL,
      invalidated_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, conversation_key)
    );
  `);
  return db;
}

export type DbHandle = ReturnType<typeof createDb>;
