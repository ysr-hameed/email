CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  local_part TEXT NOT NULL UNIQUE,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender TEXT NOT NULL,
  recipients_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '(no subject)',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  message_id TEXT,
  in_reply_to TEXT,
  alias_id TEXT REFERENCES aliases(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received',
  read_at TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  trashed INTEGER NOT NULL DEFAULT 0,
  received_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS messages_mailbox_idx ON messages(direction, archived, trashed, created_at);
CREATE INDEX IF NOT EXISTS messages_message_id_idx ON messages(message_id);

INSERT OR IGNORE INTO aliases (id, local_part, display_name) VALUES
  ('alias-support', 'support', 'Support'),
  ('alias-hello', 'hello', 'Hello');
