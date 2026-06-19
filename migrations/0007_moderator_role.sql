PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'moderator', 'uploader', 'user')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users_new (id, username, password_hash, role, active, created_at, updated_at)
SELECT id, username, password_hash,
  CASE WHEN role IN ('admin', 'moderator', 'uploader', 'user') THEN role ELSE 'user' END,
  active, created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

PRAGMA foreign_keys=on;
