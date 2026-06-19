CREATE TABLE IF NOT EXISTS content_tags (
  content_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (content_id, tag),
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_tags_tag ON content_tags(tag);

CREATE TABLE IF NOT EXISTS content_checks (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed')),
  message TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_checks_content ON content_checks(content_id, check_type);

CREATE TABLE IF NOT EXISTS moderation_notes (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  user_id TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_notes_content ON moderation_notes(content_id, created_at);
