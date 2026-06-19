const SESSION_COOKIE = 'cv_session';
const SESSION_DAYS = 7;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'yonetici',
  'yönetici',
  'panel',
  'adminpanel',
  'admin-panel',
  'yoneticipanel',
  'yöneticipanel',
  'moderator',
  'mod',
  'root',
  'system',
  'sistem',
  'support',
  'destek',
  'cineverse',
  'owner',
  'sahip'
]);

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const method = context.request.method.toUpperCase();

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const db = getDb(context.env);
    if (!db) return json({ error: 'D1 binding missing. Add a DB or CINEVERSE_DB binding.' }, 500);

    await ensureLibrarySchema(db);
    await ensureInitialAdmin(db, context.env);

    const user = await getCurrentUser(context.request, db);

    if (path === 'auth/me' && method === 'GET') return json({ user: publicUser(user) });
    if (path === 'auth/login' && method === 'POST') {
      const limited = await enforceRateLimit(db, context.request, 'auth-login', 8, 60);
      if (limited) return limited;
      return login(context.request, db, url);
    }
    if (path === 'auth/logout' && method === 'POST') return logout(context.request, db, url);
    if (path === 'profile' && method === 'GET') return requireUser(user, () => getProfile(db, user));
    if (path === 'profile' && method === 'PATCH') return requireUser(user, () => updateProfile(context.request, db, user));
    if (path === 'notifications' && method === 'GET') return requireUser(user, () => listNotifications(db, user));
    if (/^notifications\/[^/]+\/read$/.test(path) && method === 'POST') {
      return requireUser(user, () => markNotificationRead(path.split('/')[1], db, user));
    }
    if (path === 'notifications/read-all' && method === 'POST') return requireUser(user, () => markAllNotificationsRead(db, user));

    if (path === 'contents' && method === 'GET') return listContents(url, db);
    if (path === 'contents' && method === 'POST') {
      const limited = await enforceRateLimit(db, context.request, 'content-submit', 12, 300);
      if (limited) return limited;
      return createContent(context.request, db, user);
    }
    if (/^contents\/[^/]+$/.test(path) && method === 'PATCH') return updateContent(path.split('/')[1], context.request, db, user);
    if (/^contents\/[^/]+$/.test(path) && method === 'DELETE') return deleteContent(path.split('/')[1], db, user);
    if (/^contents\/[^/]+\/moderation-notes$/.test(path) && method === 'GET') {
      return requireUser(user, () => listModerationNotes(path.split('/')[1], db, user));
    }
    if (/^contents\/[^/]+\/moderation-notes$/.test(path) && method === 'POST') {
      return requireContentModerator(user, () => createModerationNote(path.split('/')[1], context.request, db, user));
    }

    if (path === 'series' && method === 'GET') return listSeries(url, db);
    if (path === 'series' && method === 'POST') return requireLibraryManager(user, () => createSeries(context.request, db, user));
    if (/^series\/[^/]+$/.test(path) && method === 'PATCH') return requireLibraryManager(user, () => updateSeries(path.split('/')[1], context.request, db));
    if (/^series\/[^/]+$/.test(path) && method === 'DELETE') return requireAdmin(user, () => deleteSeries(path.split('/')[1], db));
    if (/^series\/[^/]+\/episodes$/.test(path) && method === 'POST') {
      return requireLibraryManager(user, () => createSeriesEpisode(path.split('/')[1], context.request, db, user));
    }

    if (path === 'watchlist' && method === 'GET') return requireUser(user, () => listWatchlist(db, user));
    if (path === 'watchlist' && method === 'POST') return requireUser(user, () => setWatchlist(context.request, db, user));
    if (path === 'submissions/mine' && method === 'GET') return requireUser(user, () => listMySubmissions(db, user));
    if (path === 'tags' && method === 'GET') return listTags(db);

    if (path === 'progress' && method === 'GET') return requireUser(user, () => listProgress(db, user));
    if (path === 'progress' && method === 'POST') return requireUser(user, () => setProgress(context.request, db, user));

    if (path === 'rooms' && method === 'GET') return listRooms(db);
    if (path === 'rooms' && method === 'POST') {
      const limited = await enforceRateLimit(db, context.request, 'room-registry', 120, 60);
      if (limited) return limited;
      return upsertRoom(context.request, db);
    }
    if (/^rooms\/[^/]+$/.test(path) && method === 'PATCH') {
      const limited = await enforceRateLimit(db, context.request, 'room-registry', 120, 60);
      if (limited) return limited;
      return updateRoom(path.split('/')[1], context.request, db);
    }
    if (/^rooms\/[^/]+$/.test(path) && method === 'DELETE') return deleteRoom(path.split('/')[1], context.request, db);

    if (path === 'tmdb/search' && method === 'GET') return requireUser(user, () => searchTmdb(url, context.env));

    if (path === 'admin/users' && method === 'GET') return requireAdmin(user, () => listUsers(db));
    if (path === 'admin/users' && method === 'POST') return requireAdmin(user, () => createUser(context.request, db));
    if (/^admin\/users\/[^/]+$/.test(path) && method === 'PATCH') {
      return requireAdmin(user, () => updateUser(path.split('/')[2], context.request, db, user));
    }
    if (path === 'admin/submissions' && method === 'GET') return requireContentModerator(user, () => listSubmissions(db));
    if (path === 'admin/stats' && method === 'GET') return requireAdmin(user, () => getAdminStats(db));
    if (/^admin\/contents\/[^/]+\/check$/.test(path) && method === 'POST') {
      return requireAnyRole(user, ['admin', 'uploader', 'moderator'], () => checkContentLinks(path.split('/')[2], db));
    }
    if (/^admin\/submissions\/[^/]+\/approve$/.test(path) && method === 'POST') {
      return requireContentModerator(user, () => moderateSubmission(path.split('/')[2], context.request, db, user, 'approved'));
    }
    if (/^admin\/submissions\/[^/]+\/reject$/.test(path) && method === 'POST') {
      return requireContentModerator(user, () => moderateSubmission(path.split('/')[2], context.request, db, user, 'rejected'));
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Server error', detail: err.message }, 500);
  }
}

function getDb(env) {
  return env.DB || env.CINEVERSE_DB;
}

async function ensureInitialAdmin(db, env) {
  const username = env.CV_ADMIN_USERNAME || env.ADMIN_USERNAME;
  const password = env.CV_ADMIN_PASSWORD || env.ADMIN_PASSWORD;
  if (!username || !password) return;

  const existing = await db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first();
  if (existing) return;

  await db.prepare(
    'INSERT INTO users (id, username, password_hash, role, active) VALUES (?, ?, ?, ?, 1)'
  ).bind(crypto.randomUUID(), username.trim(), await hashPassword(password), 'admin').run();
}

async function ensureLibrarySchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      poster_url TEXT,
      tmdb_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `).run();

  await ignoreDuplicateColumn(db.prepare('ALTER TABLE contents ADD COLUMN series_id TEXT REFERENCES series(id) ON DELETE CASCADE').run());
  await ignoreDuplicateColumn(db.prepare('ALTER TABLE contents ADD COLUMN subtitle_url TEXT').run());
  await ignoreDuplicateColumn(db.prepare('ALTER TABLE contents ADD COLUMN genre TEXT').run());
  await ignoreDuplicateColumn(db.prepare('ALTER TABLE contents ADD COLUMN release_year INTEGER').run());
  await ignoreDuplicateColumn(db.prepare('ALTER TABLE contents ADD COLUMN runtime_minutes INTEGER').run());
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_series_created_by ON series(created_by)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_series_title ON series(title)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_contents_series_order ON contents(series_id, season, episode)').run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      host_name TEXT NOT NULL,
      host_token_hash TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
      member_count INTEGER NOT NULL DEFAULT 1,
      content_title TEXT,
      room_name TEXT,
      room_description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await ignoreDuplicateColumn(db.prepare('ALTER TABLE rooms ADD COLUMN room_name TEXT').run());
  await ignoreDuplicateColumn(db.prepare('ALTER TABLE rooms ADD COLUMN room_description TEXT').run());
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rooms_visibility_seen ON rooms(visibility, last_seen_at)').run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_rate_limits (
      key TEXT PRIMARY KEY,
      route TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_api_rate_limits_reset ON api_rate_limits(reset_at)').run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      bio TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS content_tags (
      content_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (content_id, tag),
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_content_tags_tag ON content_tags(tag)').run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS content_checks (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      check_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed')),
      message TEXT,
      checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_content_checks_content ON content_checks(content_id, check_type)').run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS moderation_notes (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      user_id TEXT,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_moderation_notes_content ON moderation_notes(content_id, created_at)').run();
}

async function ignoreDuplicateColumn(promise) {
  try {
    await promise;
  } catch (err) {
    if (!/duplicate column|already exists/i.test(String(err?.message || err))) throw err;
  }
}

async function enforceRateLimit(db, request, route, limit, windowSeconds) {
  const ip = getClientIp(request);
  const key = `${route}:${ip}`;
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000).toISOString();
  await db.prepare("DELETE FROM api_rate_limits WHERE reset_at < datetime('now', '-10 minutes')").run();

  const current = await db.prepare('SELECT count, reset_at AS resetAt FROM api_rate_limits WHERE key = ? LIMIT 1')
    .bind(key).first();

  if (!current || new Date(current.resetAt).getTime() <= now.getTime()) {
    await db.prepare(`
      INSERT INTO api_rate_limits (key, route, count, reset_at, updated_at)
      VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at, updated_at = CURRENT_TIMESTAMP
    `).bind(key, route, resetAt).run();
    return null;
  }

  if (Number(current.count || 0) >= limit) {
    return json({
      error: 'Cox sorgu gonderildi. Biraz sonra tekrar yoxla.',
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(current.resetAt).getTime() - now.getTime()) / 1000))
    }, 429);
  }

  await db.prepare('UPDATE api_rate_limits SET count = count + 1, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
    .bind(key).run();
  return null;
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'local';
}

async function login(request, db, url) {
  const body = await readJson(request);
  const username = cleanText(body.username).toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) return json({ error: 'Kullanici adi ve sifre gerekli' }, 400);

  const user = await db.prepare(
    'SELECT id, username, password_hash, role, active FROM users WHERE lower(username) = ? LIMIT 1'
  ).bind(username).first();

  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: 'Kullanici adi veya sifre hatali' }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), user.id, tokenHash, expires).run();

  return json(
    { user: publicUser(user) },
    200,
    { 'Set-Cookie': makeSessionCookie(token, url, SESSION_DAYS * 24 * 60 * 60) }
  );
}

async function logout(request, db, url) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }

  return json({ ok: true }, 200, { 'Set-Cookie': makeSessionCookie('', url, 0) });
}

async function getCurrentUser(request, db) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`
    SELECT users.id, users.username, users.role, users.active
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first();

  return row || null;
}

async function listContents(url, db) {
  const type = normalizeType(url.searchParams.get('type'), true);
  const q = cleanText(url.searchParams.get('q'));
  const tag = normalizeTag(url.searchParams.get('tag'));
  const includeEpisodes = url.searchParams.get('includeEpisodes') === '1' || url.searchParams.get('includeEpisodes') === 'true';
  const clauses = ["status = 'approved'"];
  const values = [];

  if (!includeEpisodes) {
    clauses.push('series_id IS NULL');
  }
  if (type) {
    clauses.push('type = ?');
    values.push(type);
  }
  if (q) {
    clauses.push(`(title LIKE ? OR description LIKE ? OR url LIKE ? OR EXISTS (
      SELECT 1 FROM content_tags WHERE content_tags.content_id = contents.id AND content_tags.tag LIKE ?
    ))`);
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (tag) {
    clauses.push('EXISTS (SELECT 1 FROM content_tags WHERE content_tags.content_id = contents.id AND content_tags.tag = ?)');
    values.push(tag);
  }

  const rows = await db.prepare(`
    SELECT id, url, title, description, poster_url AS posterUrl, subtitle_url AS subtitleUrl,
      type, series_id AS seriesId,
      season, episode, tmdb_id AS tmdbId, genre, release_year AS releaseYear, runtime_minutes AS runtimeMinutes,
      status, submitted_by AS submittedBy, created_at AS createdAt, updated_at AS updatedAt,
      (SELECT group_concat(tag, ',') FROM content_tags WHERE content_tags.content_id = contents.id ORDER BY tag) AS tags,
      (SELECT status FROM content_checks WHERE content_checks.content_id = contents.id ORDER BY checked_at DESC, created_at DESC LIMIT 1) AS checkStatus
    FROM contents
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT 100
  `).bind(...values).all();

  return json({ contents: mapContentRows(rows.results || []) });
}

async function listSeries(url, db) {
  const q = cleanText(url.searchParams.get('q'));
  const tag = normalizeTag(url.searchParams.get('tag'));
  const includeEpisodes = url.searchParams.get('includeEpisodes') === '1' || url.searchParams.get('includeEpisodes') === 'true';
  const clauses = [];
  const values = [];

  if (q) {
    clauses.push('(series.title LIKE ? OR series.description LIKE ?)');
    values.push(`%${q}%`, `%${q}%`);
  }
  if (tag) {
    clauses.push(`EXISTS (
      SELECT 1 FROM contents tagged_content
      JOIN content_tags ON content_tags.content_id = tagged_content.id
      WHERE tagged_content.series_id = series.id AND tagged_content.status = 'approved' AND content_tags.tag = ?
    )`);
    values.push(tag);
  }

  const rows = await db.prepare(`
    SELECT series.id, series.title, series.description, series.poster_url AS posterUrl,
      series.tmdb_id AS tmdbId, series.created_by AS createdBy, series.created_at AS createdAt,
      series.updated_at AS updatedAt, users.username AS createdByName,
      COUNT(contents.id) AS episodeCount
    FROM series
    LEFT JOIN users ON users.id = series.created_by
    LEFT JOIN contents ON contents.series_id = series.id AND contents.status = 'approved'
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    GROUP BY series.id
    ORDER BY series.updated_at DESC
    LIMIT 100
  `).bind(...values).all();

  const series = rows.results || [];
  if (!includeEpisodes || !series.length) return json({ series });

  const placeholders = series.map(() => '?').join(', ');
  const episodeRows = await db.prepare(`
    SELECT id, url, title, description, poster_url AS posterUrl, subtitle_url AS subtitleUrl,
      type, series_id AS seriesId,
      season, episode, tmdb_id AS tmdbId, genre, release_year AS releaseYear, runtime_minutes AS runtimeMinutes,
      status, submitted_by AS submittedBy,
      created_at AS createdAt, updated_at AS updatedAt,
      (SELECT group_concat(tag, ',') FROM content_tags WHERE content_tags.content_id = contents.id ORDER BY tag) AS tags,
      (SELECT status FROM content_checks WHERE content_checks.content_id = contents.id ORDER BY checked_at DESC, created_at DESC LIMIT 1) AS checkStatus
    FROM contents
    WHERE status = 'approved' AND series_id IN (${placeholders})
      ${tag ? "AND EXISTS (SELECT 1 FROM content_tags WHERE content_tags.content_id = contents.id AND content_tags.tag = ?)" : ''}
    ORDER BY series_id ASC, COALESCE(season, 0) ASC, COALESCE(episode, 0) ASC, created_at ASC
  `).bind(...series.map(item => item.id), ...(tag ? [tag] : [])).all();

  const episodesBySeries = new Map();
  mapContentRows(episodeRows.results || []).forEach(episode => {
    const list = episodesBySeries.get(episode.seriesId) || [];
    list.push(episode);
    episodesBySeries.set(episode.seriesId, list);
  });

  return json({
    series: series.map(item => ({
      ...item,
      episodes: episodesBySeries.get(item.id) || []
    }))
  });
}

async function createSeries(request, db, user) {
  const input = normalizeSeriesInput(await readJson(request));
  if (!input.title) return json({ error: 'Dizi basligi gerekli' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO series (id, title, description, poster_url, tmdb_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, input.title, input.description, input.posterUrl, input.tmdbId, user.id).run();

  return json({ id, message: 'Dizi olusturuldu' }, 201);
}

async function updateSeries(id, request, db) {
  const input = normalizeSeriesInput(await readJson(request));
  if (!input.title) return json({ error: 'Dizi basligi gerekli' }, 400);

  await db.prepare(`
    UPDATE series
    SET title = ?, description = ?, poster_url = ?, tmdb_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(input.title, input.description, input.posterUrl, input.tmdbId, id).run();

  return json({ ok: true });
}

async function deleteSeries(id, db) {
  await db.prepare('DELETE FROM contents WHERE series_id = ?').bind(id).run();
  await db.prepare('DELETE FROM series WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function createSeriesEpisode(id, request, db, user) {
  const series = await db.prepare('SELECT id, title, description, poster_url AS posterUrl, tmdb_id AS tmdbId FROM series WHERE id = ? LIMIT 1')
    .bind(id).first();
  if (!series) return json({ error: 'Dizi bulunamadi' }, 404);

  const input = normalizeEpisodeInput(await readJson(request));
  if (!input.url) return json({ error: 'Bolum linki gerekli' }, 400);
  if (input.season == null || input.episode == null) return json({ error: 'Sezon ve bolum gerekli' }, 400);

  const contentId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO contents (id, url, title, description, poster_url, subtitle_url, type, series_id, season, episode, tmdb_id, genre, release_year, runtime_minutes, status, submitted_by, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, 'series', ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
  `).bind(
    contentId,
    input.url,
    input.title || `${series.title} S${input.season}E${input.episode}`,
    input.description || null,
    input.posterUrl || series.posterUrl || null,
    input.subtitleUrl || null,
    id,
    input.season,
    input.episode,
    input.tmdbId || series.tmdbId || null,
    input.genre,
    input.releaseYear,
    input.runtimeMinutes,
    user.id,
    user.id
  ).run();

  await db.prepare('UPDATE series SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();
  await saveContentTags(db, contentId, input.tags);

  return json({ id: contentId, message: 'Bolum eklendi' }, 201);
}

async function createContent(request, db, user) {
  if (!user) return json({ error: 'Kalici kutuphaneye eklemek icin giris yapmalisin' }, 401);

  const body = await readJson(request);
  const content = normalizeContentInput(body, user.role === 'admin' || user.role === 'uploader');
  if (!content.url) return json({ error: 'Link gerekli' }, 400);
  const duplicate = await db.prepare('SELECT id, title, status FROM contents WHERE url = ? LIMIT 1').bind(content.url).first();
  if (duplicate) {
    return json({ error: `Bu link zaten kutuphanede var: ${duplicate.title || duplicate.status || duplicate.id}` }, 409);
  }

  const canApprove = user.role === 'admin' || user.role === 'uploader';
  const status = canApprove ? 'approved' : 'pending';
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO contents (id, url, title, description, poster_url, subtitle_url, type, series_id, season, episode, tmdb_id, genre, release_year, runtime_minutes, status, submitted_by, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    content.url,
    content.title,
    content.description,
    content.posterUrl,
    content.subtitleUrl,
    content.type,
    content.seriesId,
    content.season,
    content.episode,
    content.tmdbId,
    content.genre,
    content.releaseYear,
    content.runtimeMinutes,
    status,
    user.id,
    canApprove ? user.id : null
  ).run();
  await saveContentTags(db, id, content.tags);

  return json({ id, status, message: status === 'pending' ? 'Link təsdiqə göndərildi' : 'Link kitabxanaya əlavə edildi' }, 201);
}

async function updateContent(id, request, db, user) {
  if (!user || !['admin', 'uploader'].includes(user.role)) return json({ error: 'Admin və ya uploader səlahiyyəti lazımdır' }, 403);

  const body = await readJson(request);
  const content = normalizeContentInput(body, true);
  const status = ['pending', 'approved', 'rejected'].includes(body.status) ? body.status : 'approved';
  if (!content.url) return json({ error: 'Link gerekli' }, 400);
  if (content.type === 'series' && (!content.seriesId || content.season == null || content.episode == null)) {
    return json({ error: 'Dizi, sezon ve bolum gerekli' }, 400);
  }

  await db.prepare(`
    UPDATE contents
    SET url = ?, title = ?, description = ?, poster_url = ?, subtitle_url = ?, type = ?, series_id = ?, season = ?, episode = ?,
      tmdb_id = ?, genre = ?, release_year = ?, runtime_minutes = ?, status = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    content.url,
    content.title,
    content.description,
    content.posterUrl,
    content.subtitleUrl,
    content.type,
    content.seriesId,
    content.season,
    content.episode,
    content.tmdbId,
    content.genre,
    content.releaseYear,
    content.runtimeMinutes,
    status,
    status,
    user.id,
    id
  ).run();
  await saveContentTags(db, id, content.tags);

  return json({ ok: true });
}

async function deleteContent(id, db, user) {
  if (!user || user.role !== 'admin') return json({ error: 'Admin yetkisi gerekli' }, 403);
  await db.prepare('DELETE FROM contents WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function listWatchlist(db, user) {
  const rows = await db.prepare(`
    SELECT watchlist.status AS listStatus, watchlist.updated_at AS listUpdatedAt,
      contents.id, contents.url, contents.title, contents.description, contents.poster_url AS posterUrl,
      contents.subtitle_url AS subtitleUrl,
      contents.type, contents.series_id AS seriesId, contents.season, contents.episode, contents.tmdb_id AS tmdbId,
      contents.genre, contents.release_year AS releaseYear, contents.runtime_minutes AS runtimeMinutes
    FROM watchlist
    JOIN contents ON contents.id = watchlist.content_id
    WHERE watchlist.user_id = ? AND contents.status = 'approved'
    ORDER BY watchlist.updated_at DESC
  `).bind(user.id).all();

  return json({ items: rows.results || [] });
}

async function setWatchlist(request, db, user) {
  const body = await readJson(request);
  const contentId = cleanText(body.contentId);
  const status = ['planned', 'watching', 'watched'].includes(body.status) ? body.status : '';
  if (!contentId || !status) return json({ error: 'Icerik ve liste durumu gerekli' }, 400);

  await db.prepare(`
    INSERT INTO watchlist (user_id, content_id, status, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, content_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, contentId, status).run();

  return json({ ok: true });
}

async function listMySubmissions(db, user) {
  const rows = await db.prepare(`
    SELECT contents.id, contents.url, contents.title, contents.description, contents.poster_url AS posterUrl,
      contents.subtitle_url AS subtitleUrl, contents.type, contents.series_id AS seriesId, contents.season,
      contents.episode, contents.tmdb_id AS tmdbId, contents.genre, contents.release_year AS releaseYear,
      contents.runtime_minutes AS runtimeMinutes, contents.status, contents.created_at AS createdAt,
      contents.updated_at AS updatedAt,
      (SELECT group_concat(tag, ',') FROM content_tags WHERE content_tags.content_id = contents.id ORDER BY tag) AS tags,
      (SELECT note FROM moderation_notes WHERE moderation_notes.content_id = contents.id ORDER BY created_at DESC LIMIT 1) AS moderationNote
    FROM contents
    WHERE contents.submitted_by = ?
    ORDER BY contents.created_at DESC
    LIMIT 30
  `).bind(user.id).all();

  return json({ submissions: mapContentRows(rows.results || []) });
}

async function listTags(db) {
  const rows = await db.prepare(`
    SELECT tag, COUNT(*) AS count
    FROM content_tags
    JOIN contents ON contents.id = content_tags.content_id
    WHERE contents.status = 'approved'
    GROUP BY tag
    ORDER BY count DESC, tag ASC
    LIMIT 80
  `).all();
  return json({ tags: rows.results || [] });
}

async function listProgress(db, user) {
  const rows = await db.prepare(`
    SELECT progress.position_seconds AS positionSeconds, progress.duration_seconds AS durationSeconds,
      progress.updated_at AS progressUpdatedAt,
      contents.id, contents.url, contents.title, contents.description, contents.poster_url AS posterUrl,
      contents.subtitle_url AS subtitleUrl,
      contents.type, contents.series_id AS seriesId, contents.season, contents.episode, contents.tmdb_id AS tmdbId,
      contents.genre, contents.release_year AS releaseYear, contents.runtime_minutes AS runtimeMinutes
    FROM progress
    JOIN contents ON contents.id = progress.content_id
    WHERE progress.user_id = ? AND contents.status = 'approved'
    ORDER BY progress.updated_at DESC
    LIMIT 30
  `).bind(user.id).all();

  return json({ items: rows.results || [] });
}

async function setProgress(request, db, user) {
  const body = await readJson(request);
  const contentId = cleanText(body.contentId);
  const position = Number(body.positionSeconds);
  const duration = body.durationSeconds == null ? null : Number(body.durationSeconds);
  if (!contentId || !Number.isFinite(position)) return json({ error: 'Icerik ve sure gerekli' }, 400);

  await db.prepare(`
    INSERT INTO progress (user_id, content_id, position_seconds, duration_seconds, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, content_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, contentId, Math.max(0, position), Number.isFinite(duration) ? Math.max(0, duration) : null).run();

  await db.prepare(`
    INSERT INTO watchlist (user_id, content_id, status, updated_at)
    VALUES (?, ?, 'watching', CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, content_id) DO UPDATE SET
      status = CASE WHEN watchlist.status = 'watched' THEN watchlist.status ELSE 'watching' END,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, contentId).run();

  return json({ ok: true });
}

async function getProfile(db, user) {
  await db.prepare('INSERT OR IGNORE INTO profiles (user_id, display_name) VALUES (?, ?)')
    .bind(user.id, user.username).run();

  const profile = await db.prepare(`
    SELECT profiles.display_name AS displayName, profiles.bio,
      users.username, users.role, users.created_at AS createdAt
    FROM users
    LEFT JOIN profiles ON profiles.user_id = users.id
    WHERE users.id = ?
    LIMIT 1
  `).bind(user.id).first();

  const watchlist = await db.prepare('SELECT COUNT(*) AS total FROM watchlist WHERE user_id = ?').bind(user.id).first();
  const progress = await db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(position_seconds), 0) AS watchedSeconds
    FROM progress
    WHERE user_id = ?
  `).bind(user.id).first();

  const recent = await db.prepare(`
    SELECT progress.position_seconds AS positionSeconds, progress.updated_at AS updatedAt,
      contents.id, contents.title, contents.url, contents.poster_url AS posterUrl, contents.type
    FROM progress
    JOIN contents ON contents.id = progress.content_id
    WHERE progress.user_id = ? AND contents.status = 'approved'
    ORDER BY progress.updated_at DESC
    LIMIT 5
  `).bind(user.id).all();

  return json({
    profile: {
      username: profile?.username || user.username,
      role: profile?.role || user.role,
      displayName: profile?.displayName || user.username,
      bio: profile?.bio || '',
      createdAt: profile?.createdAt || null
    },
    stats: {
      watchlistCount: Number(watchlist?.total || 0),
      progressCount: Number(progress?.total || 0),
      watchedSeconds: Number(progress?.watchedSeconds || 0)
    },
    recent: recent.results || []
  });
}

async function updateProfile(request, db, user) {
  const body = await readJson(request);
  const displayName = cleanText(body.displayName || body.display_name).slice(0, 40) || user.username;
  const bio = cleanText(body.bio).slice(0, 240) || null;

  await db.prepare(`
    INSERT INTO profiles (user_id, display_name, bio, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name = excluded.display_name,
      bio = excluded.bio,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, displayName, bio).run();

  return getProfile(db, user);
}

async function listNotifications(db, user) {
  const rows = await db.prepare(`
    SELECT id, type, title, body, read_at AS readAt, created_at AS createdAt
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 40
  `).bind(user.id).all();

  const notifications = rows.results || [];
  const unread = notifications.filter(item => !item.readAt).length;
  return json({ notifications, unread });
}

async function markNotificationRead(id, db, user) {
  await db.prepare(`
    UPDATE notifications
    SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND user_id = ?
  `).bind(id, user.id).run();
  return json({ ok: true });
}

async function markAllNotificationsRead(db, user) {
  await db.prepare(`
    UPDATE notifications
    SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE user_id = ? AND read_at IS NULL
  `).bind(user.id).run();
  return json({ ok: true });
}

async function listRooms(db) {
  await db.prepare("DELETE FROM rooms WHERE last_seen_at < datetime('now', '-5 minutes')").run();

  const rows = await db.prepare(`
    SELECT room_id AS roomId, host_name AS hostName, member_count AS memberCount,
      content_title AS contentTitle, room_name AS roomName, room_description AS roomDescription,
      updated_at AS updatedAt, last_seen_at AS lastSeenAt
    FROM rooms
    WHERE visibility = 'public' AND last_seen_at >= datetime('now', '-45 seconds')
    ORDER BY last_seen_at DESC
    LIMIT 50
  `).all();

  return json({ rooms: rows.results || [] });
}

async function upsertRoom(request, db) {
  const input = normalizeRoomInput(await readJson(request));
  if (!input.roomId || !input.hostName || !input.hostToken) {
    return json({ error: 'Oda bilgisi eksik' }, 400);
  }

  const tokenHash = await sha256Hex(input.hostToken);
  const existing = await db.prepare(`
    SELECT host_token_hash AS hostTokenHash,
      last_seen_at < datetime('now', '-2 minutes') AS stale
    FROM rooms
    WHERE room_id = ?
    LIMIT 1
  `).bind(input.roomId).first();

  if (existing && existing.hostTokenHash !== tokenHash && Number(existing.stale) !== 1) {
    return json({ error: 'Bu oda baska bir host tarafindan yonetiliyor' }, 403);
  }

  await db.prepare(`
    INSERT INTO rooms (room_id, host_name, host_token_hash, visibility, member_count, content_title, room_name, room_description, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(room_id) DO UPDATE SET
      host_name = excluded.host_name,
      host_token_hash = excluded.host_token_hash,
      visibility = excluded.visibility,
      member_count = excluded.member_count,
      content_title = excluded.content_title,
      room_name = excluded.room_name,
      room_description = excluded.room_description,
      updated_at = CURRENT_TIMESTAMP,
      last_seen_at = CURRENT_TIMESTAMP
  `).bind(
    input.roomId,
    input.hostName,
    tokenHash,
    input.visibility,
    input.memberCount,
    input.contentTitle,
    input.roomName,
    input.roomDescription
  ).run();

  if (input.visibility === 'public') {
    await notifyPublicRoomActive(db, input);
  }

  return json({ ok: true });
}

async function updateRoom(id, request, db) {
  const input = normalizeRoomInput({ ...(await readJson(request)), roomId: id });
  if (!input.roomId || !input.hostToken) return json({ error: 'Oda bilgisi eksik' }, 400);

  const tokenHash = await sha256Hex(input.hostToken);
  const existing = await db.prepare('SELECT host_token_hash AS hostTokenHash FROM rooms WHERE room_id = ? LIMIT 1')
    .bind(input.roomId).first();
  if (!existing) return json({ error: 'Oda bulunamadi' }, 404);
  if (existing.hostTokenHash !== tokenHash) return json({ error: 'Sadece host guncelleyebilir' }, 403);

  await db.prepare(`
    UPDATE rooms
    SET visibility = ?, member_count = ?, content_title = ?, room_name = ?, room_description = ?,
      updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
    WHERE room_id = ?
  `).bind(input.visibility, input.memberCount, input.contentTitle, input.roomName, input.roomDescription, input.roomId).run();

  return json({ ok: true });
}

async function deleteRoom(id, request, db) {
  const body = await readJson(request);
  const roomId = cleanRoomId(id);
  const hostToken = cleanText(body.hostToken);
  if (!roomId || !hostToken) return json({ error: 'Oda bilgisi eksik' }, 400);

  const tokenHash = await sha256Hex(hostToken);
  await db.prepare('DELETE FROM rooms WHERE room_id = ? AND host_token_hash = ?').bind(roomId, tokenHash).run();
  return json({ ok: true });
}

async function listUsers(db) {
  const rows = await db.prepare(`
    SELECT id, username, role, active, created_at AS createdAt, updated_at AS updatedAt
    FROM users
    ORDER BY created_at DESC
  `).all();
  return json({ users: rows.results || [] });
}

async function getAdminStats(db) {
  const [users, contents, pending, publicRooms, recent] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS total FROM users WHERE active = 1').first(),
    db.prepare("SELECT COUNT(*) AS total FROM contents WHERE status = 'approved'").first(),
    db.prepare("SELECT COUNT(*) AS total FROM contents WHERE status = 'pending'").first(),
    db.prepare("SELECT COUNT(*) AS total FROM rooms WHERE visibility = 'public' AND last_seen_at >= datetime('now', '-45 seconds')").first(),
    db.prepare(`
      SELECT id, title, url, type, created_at AS createdAt
      FROM contents
      ORDER BY created_at DESC
      LIMIT 5
    `).all()
  ]);

  return json({
    stats: {
      users: Number(users?.total || 0),
      approvedContents: Number(contents?.total || 0),
      pendingSubmissions: Number(pending?.total || 0),
      activePublicRooms: Number(publicRooms?.total || 0)
    },
    recentContents: recent.results || []
  });
}

async function createUser(request, db) {
  const body = await readJson(request);
  const username = cleanText(body.username);
  const password = String(body.password || '');
  const role = ['admin', 'moderator', 'uploader', 'user'].includes(body.role) ? body.role : 'user';

  if (!username || username.length < 3) return json({ error: 'Kullanici adi en az 3 karakter olmali' }, 400);
  if (isReservedUsername(username)) return json({ error: 'Bu kullanici adi sistem icin ayrildi' }, 400);
  if (password.length < 6) return json({ error: 'Sifre en az 6 karakter olmali' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO users (id, username, password_hash, role, active) VALUES (?, ?, ?, ?, 1)'
  ).bind(id, username, await hashPassword(password), role).run();

  return json({ id, username, role }, 201);
}

async function updateUser(id, request, db, currentUser) {
  const body = await readJson(request);
  const role = ['admin', 'moderator', 'uploader', 'user'].includes(body.role) ? body.role : null;
  const active = body.active === false || body.active === 0 ? 0 : 1;
  const password = String(body.password || '');

  if (id === currentUser.id && active === 0) return json({ error: 'Kendi hesabini pasif yapamazsin' }, 400);

  if (role) {
    await db.prepare('UPDATE users SET role = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(role, active, id).run();
  } else {
    await db.prepare('UPDATE users SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(active, id).run();
  }

  if (password) {
    if (password.length < 6) return json({ error: 'Sifre en az 6 karakter olmali' }, 400);
    await db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(await hashPassword(password), id).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }

  return json({ ok: true });
}

async function listSubmissions(db) {
  const rows = await db.prepare(`
    SELECT contents.id, contents.url, contents.title, contents.description, contents.poster_url AS posterUrl,
      contents.subtitle_url AS subtitleUrl,
      contents.type, contents.series_id AS seriesId, contents.season, contents.episode, contents.tmdb_id AS tmdbId,
      contents.genre, contents.release_year AS releaseYear, contents.runtime_minutes AS runtimeMinutes,
      contents.status, contents.created_at AS createdAt, users.username AS submittedByName,
      (SELECT group_concat(tag, ',') FROM content_tags WHERE content_tags.content_id = contents.id ORDER BY tag) AS tags,
      (SELECT status FROM content_checks WHERE content_checks.content_id = contents.id ORDER BY checked_at DESC, created_at DESC LIMIT 1) AS checkStatus,
      (SELECT note FROM moderation_notes WHERE moderation_notes.content_id = contents.id ORDER BY created_at DESC LIMIT 1) AS moderationNote
    FROM contents
    LEFT JOIN users ON users.id = contents.submitted_by
    WHERE contents.status = 'pending'
    ORDER BY contents.created_at ASC
  `).all();
  return json({ submissions: mapContentRows(rows.results || []) });
}

async function moderateSubmission(id, request, db, user, status) {
  const body = await readJson(request);
  const reason = cleanText(body.reason || body.note).slice(0, 800);
  const content = await db.prepare('SELECT id, title, url, submitted_by AS submittedBy FROM contents WHERE id = ? LIMIT 1')
    .bind(id).first();
  if (!content) return json({ error: 'Təklif tapılmadı' }, 404);

  await db.prepare(`
    UPDATE contents SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(status, status === 'approved' ? user.id : null, id).run();

  if (reason) {
    await addModerationNote(db, id, user.id, reason);
  }
  if (content.submittedBy) {
    await notifyUser(db, content.submittedBy, {
      type: status === 'approved' ? 'submission_approved' : 'submission_rejected',
      title: status === 'approved' ? 'Təklif təsdiqləndi' : 'Təklif rədd edildi',
      body: status === 'approved'
        ? `${content.title || content.url} kitabxanaya əlavə edildi.`
        : (reason || `${content.title || content.url} rədd edildi.`)
    });
  }

  return json({ ok: true });
}

async function listModerationNotes(id, db, user) {
  const content = await db.prepare('SELECT submitted_by AS submittedBy FROM contents WHERE id = ? LIMIT 1').bind(id).first();
  if (!content) return json({ error: 'Kontent tapılmadı' }, 404);
  if (!isContentModerator(user) && content.submittedBy !== user.id) {
    return json({ error: 'Bu qeydləri görmək üçün səlahiyyət lazımdır' }, 403);
  }

  const rows = await db.prepare(`
    SELECT moderation_notes.id, moderation_notes.note, moderation_notes.created_at AS createdAt,
      users.username AS createdByName
    FROM moderation_notes
    LEFT JOIN users ON users.id = moderation_notes.user_id
    WHERE moderation_notes.content_id = ?
    ORDER BY moderation_notes.created_at DESC
    LIMIT 30
  `).bind(id).all();
  return json({ notes: rows.results || [] });
}

async function createModerationNote(id, request, db, user) {
  const body = await readJson(request);
  const note = cleanText(body.note).slice(0, 800);
  if (!note) return json({ error: 'Qeyd mətni lazımdır' }, 400);
  await addModerationNote(db, id, user.id, note);
  return json({ ok: true });
}

async function addModerationNote(db, contentId, userId, note) {
  await db.prepare(`
    INSERT INTO moderation_notes (id, content_id, user_id, note)
    VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), contentId, userId, note).run();
}

async function checkContentLinks(id, db) {
  const content = await db.prepare(`
    SELECT id, url, subtitle_url AS subtitleUrl, poster_url AS posterUrl
    FROM contents
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();
  if (!content) return json({ error: 'Kontent tapılmadı' }, 404);

  const targets = [
    { type: 'video', url: content.url },
    { type: 'subtitle', url: content.subtitleUrl },
    { type: 'poster', url: content.posterUrl }
  ].filter(item => item.url);

  if (!targets.length) return json({ checks: [] });

  const checks = [];
  for (const target of targets) {
    const result = await probeUrl(target.url);
    const row = {
      id: crypto.randomUUID(),
      contentId: id,
      checkType: target.type,
      status: result.status,
      message: result.message
    };
    checks.push(row);
    await db.prepare(`
      INSERT INTO content_checks (id, content_id, check_type, status, message, checked_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(row.id, id, target.type, result.status, result.message).run();
  }

  return json({ checks });
}

async function probeUrl(url) {
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'CineVerse-LinkChecker/1.0' }
    });

    if ([405, 403, 501].includes(response.status)) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0', 'User-Agent': 'CineVerse-LinkChecker/1.0' }
      });
    }

    if (response.ok || response.status === 206) {
      return { status: 'ok', message: `HTTP ${response.status}` };
    }
    return { status: 'failed', message: `HTTP ${response.status}` };
  } catch (err) {
    return { status: 'failed', message: `Yoxlama alınmadı: ${String(err?.message || err).slice(0, 120)}` };
  }
}

async function searchTmdb(url, env) {
  const query = cleanText(url.searchParams.get('q'));
  const type = normalizeType(url.searchParams.get('type'), true) || 'movie';
  if (!query) return json({ results: [] });

  const bearer = env.TMDB_ACCESS_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!bearer && !apiKey) return json({ results: [], disabled: true });

  const endpointType = type === 'series' ? 'tv' : 'movie';
  const auth = { bearer, apiKey };
  const tmdbUrl = new URL(`https://api.themoviedb.org/3/search/${endpointType}`);
  tmdbUrl.searchParams.set('query', query);
  tmdbUrl.searchParams.set('language', 'az-AZ');
  tmdbUrl.searchParams.set('include_adult', 'false');
  if (apiKey) tmdbUrl.searchParams.set('api_key', apiKey);

  const response = await fetch(tmdbUrl, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}
  });
  if (!response.ok) return json({ error: 'TMDB aramasi basarisiz' }, 502);

  const data = await response.json();
  const results = await Promise.all((data.results || []).slice(0, 8).map(async item => {
    const details = await getTmdbDetails(endpointType, item.id, auth);
    const genres = Array.isArray(details?.genres) ? details.genres.map(genre => genre.name).filter(Boolean) : [];
    const runtime = type === 'series'
      ? (Array.isArray(details?.episode_run_time) ? details.episode_run_time[0] : null)
      : details?.runtime;
    const year = (item.release_date || item.first_air_date || details?.release_date || details?.first_air_date || '').slice(0, 4);
    return {
      tmdbId: String(item.id),
      title: item.title || item.name || details?.title || details?.name || '',
      description: item.overview || details?.overview || '',
      posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : (details?.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : ''),
      type,
      year,
      releaseYear: year ? Number(year) : null,
      runtimeMinutes: Number.isFinite(Number(runtime)) ? Number(runtime) : null,
      genre: genres[0] || '',
      tags: genres
    };
  }));

  return json({ results });
}

async function getTmdbDetails(endpointType, id, auth) {
  if (!id) return null;
  const tmdbUrl = new URL(`https://api.themoviedb.org/3/${endpointType}/${id}`);
  tmdbUrl.searchParams.set('language', 'az-AZ');
  if (auth.apiKey) tmdbUrl.searchParams.set('api_key', auth.apiKey);
  try {
    const response = await fetch(tmdbUrl, {
      headers: auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function requireUser(user, fn) {
  if (!user) return json({ error: 'Giris gerekli' }, 401);
  return fn();
}

function requireAdmin(user, fn) {
  if (!user || user.role !== 'admin') return json({ error: 'Admin yetkisi gerekli' }, 403);
  return fn();
}

function requireContentModerator(user, fn) {
  if (!isContentModerator(user)) return json({ error: 'Moderator səlahiyyəti lazımdır' }, 403);
  return fn();
}

function requireAnyRole(user, roles, fn) {
  if (!user || !roles.includes(user.role)) return json({ error: 'Bu əməliyyat üçün səlahiyyət lazımdır' }, 403);
  return fn();
}

function isContentModerator(user) {
  return Boolean(user && ['admin', 'moderator'].includes(user.role));
}

function requireLibraryManager(user, fn) {
  if (!user || !['admin', 'uploader'].includes(user.role)) {
    return json({ error: 'Admin veya uploader yetkisi gerekli' }, 403);
  }
  return fn();
}

function normalizeContentInput(body, approvedPath) {
  return {
    url: cleanUrl(body.url),
    title: cleanText(body.title) || null,
    description: cleanText(body.description) || null,
    posterUrl: cleanText(body.posterUrl || body.poster_url) || null,
    subtitleUrl: cleanUrl(body.subtitleUrl || body.subtitle_url) || null,
    type: normalizeType(body.type, false),
    seriesId: cleanText(body.seriesId || body.series_id) || null,
    season: numberOrNull(body.season),
    episode: numberOrNull(body.episode),
    tmdbId: cleanText(body.tmdbId || body.tmdb_id) || null,
    genre: cleanText(body.genre).slice(0, 80) || null,
    tags: normalizeTags(body.tags || body.tagList || body.contentTags),
    releaseYear: yearOrNull(body.releaseYear || body.release_year),
    runtimeMinutes: numberOrNull(body.runtimeMinutes || body.runtime_minutes),
    approvedPath
  };
}

function normalizeSeriesInput(body) {
  return {
    title: cleanText(body.title),
    description: cleanText(body.description) || null,
    posterUrl: cleanText(body.posterUrl || body.poster_url) || null,
    tmdbId: cleanText(body.tmdbId || body.tmdb_id) || null
  };
}

function normalizeEpisodeInput(body) {
  return {
    url: cleanUrl(body.url),
    title: cleanText(body.title) || null,
    description: cleanText(body.description) || null,
    posterUrl: cleanText(body.posterUrl || body.poster_url) || null,
    subtitleUrl: cleanUrl(body.subtitleUrl || body.subtitle_url) || null,
    season: numberOrNull(body.season),
    episode: numberOrNull(body.episode),
    tmdbId: cleanText(body.tmdbId || body.tmdb_id) || null,
    genre: cleanText(body.genre).slice(0, 80) || null,
    tags: normalizeTags(body.tags || body.tagList || body.contentTags),
    releaseYear: yearOrNull(body.releaseYear || body.release_year),
    runtimeMinutes: numberOrNull(body.runtimeMinutes || body.runtime_minutes)
  };
}

async function saveContentTags(db, contentId, tags) {
  await db.prepare('DELETE FROM content_tags WHERE content_id = ?').bind(contentId).run();
  const cleanTags = normalizeTags(tags);
  for (const tag of cleanTags) {
    await db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag) VALUES (?, ?)')
      .bind(contentId, tag).run();
  }
}

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw
    .map(tag => normalizeTag(tag))
    .filter(Boolean))]
    .slice(0, 12);
}

function normalizeTag(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function mapContentRows(rows) {
  return rows.map(row => ({
    ...row,
    tags: row.tags ? String(row.tags).split(',').filter(Boolean) : []
  }));
}

async function notifyUser(db, userId, notification) {
  if (!userId) return;
  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    cleanText(notification.type).slice(0, 80),
    cleanText(notification.title).slice(0, 160),
    cleanText(notification.body).slice(0, 500) || null
  ).run();
}

async function notifyPublicRoomActive(db, room) {
  const recent = await db.prepare(`
    SELECT id FROM notifications
    WHERE type = 'public_room_active' AND body LIKE ? AND created_at >= datetime('now', '-10 minutes')
    LIMIT 1
  `).bind(`%${room.roomId}%`).first();
  if (recent) return;

  const users = await db.prepare('SELECT id FROM users WHERE active = 1 LIMIT 100').all();
  await Promise.all((users.results || []).map(item => notifyUser(db, item.id, {
    type: 'public_room_active',
    title: 'Public otaq aktivdir',
    body: `${room.roomName || room.contentTitle || room.hostName || 'Otaq'} (${room.roomId}) qoşulmaq üçün açıqdır.`
  })));
}

function normalizeRoomInput(body) {
  return {
    roomId: cleanRoomId(body.roomId || body.room_id),
    hostName: cleanText(body.hostName || body.host_name).slice(0, 40),
    hostToken: cleanText(body.hostToken || body.host_token),
    visibility: body.visibility === 'public' ? 'public' : 'private',
    memberCount: clampInteger(body.memberCount || body.member_count, 1, 999),
    contentTitle: cleanText(body.contentTitle || body.content_title).slice(0, 120) || null,
    roomName: cleanText(body.roomName || body.room_name).slice(0, 60) || null,
    roomDescription: cleanText(body.roomDescription || body.room_description).slice(0, 160) || null
  };
}

function normalizeType(type, allowEmpty) {
  if (type === 'series' || type === 'tv') return 'series';
  if (type === 'movie') return 'movie';
  return allowEmpty ? '' : 'movie';
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function yearOrNull(value) {
  const year = numberOrNull(value);
  const currentYear = new Date().getUTCFullYear() + 3;
  return year && year >= 1888 && year <= currentYear ? year : null;
}

function clampInteger(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function cleanRoomId(value) {
  const roomId = cleanText(value).toLowerCase();
  return /^cv-[a-z0-9]{8}$/.test(roomId) ? roomId : '';
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role };
}

function cleanText(value) {
  return String(value || '').trim().slice(0, 2000);
}

function cleanUrl(value) {
  return cleanText(value)
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&');
}

function isReservedUsername(username) {
  const normalized = String(username || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s._-]+/g, '');

  if (RESERVED_USERNAMES.has(normalized)) return true;
  return [...RESERVED_USERNAMES].some(name => normalized === name.replace(/[\s._-]+/g, ''));
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function hashPassword(password) {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256Hex(salt + password);
  return `sha256$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length === 3 && parts[0] === 'sha256') {
    return timingSafeHexEqual(await sha256Hex(parts[1] + password), parts[2]);
  }

  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  try {
    const iterations = Number(parts[1]);
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const encoded = new TextEncoder().encode(password);
    const key = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      expected.length * 8
    );

    return timingSafeEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function timingSafeHexEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes).replace(/[+/=]/g, char => ({ '+': '-', '/': '_', '=': '' }[char]));
}

function toBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.split(';').map(item => item.trim()).reduce((found, item) => {
    if (found) return found;
    const [key, ...rest] = item.split('=');
    return key === name ? decodeURIComponent(rest.join('=')) : '';
  }, '');
}

function makeSessionCookie(token, url, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function corsHeaders(extra = {}) {
  return {
    ...JSON_HEADERS,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(extraHeaders)
  });
}
