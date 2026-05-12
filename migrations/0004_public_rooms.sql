CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  host_name TEXT NOT NULL,
  host_token_hash TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  member_count INTEGER NOT NULL DEFAULT 1,
  content_title TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rooms_visibility_seen ON rooms(visibility, last_seen_at);
