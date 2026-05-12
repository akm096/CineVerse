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
    const db = getDb(context.env);
    if (!db) return json({ error: 'D1 binding missing. Add a DB or CINEVERSE_DB binding.' }, 500);

    await ensureLibrarySchema(db);
    await ensureInitialAdmin(db, context.env);

    const url = new URL(context.request.url);
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const method = context.request.method.toUpperCase();

    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const user = await getCurrentUser(context.request, db);

    if (path === 'auth/me' && method === 'GET') return json({ user: publicUser(user) });
    if (path === 'auth/login' && method === 'POST') return login(context.request, db, url);
    if (path === 'auth/logout' && method === 'POST') return logout(context.request, db, url);

    if (path === 'contents' && method === 'GET') return listContents(url, db);
    if (path === 'contents' && method === 'POST') return createContent(context.request, db, user);
    if (/^contents\/[^/]+$/.test(path) && method === 'PATCH') return updateContent(path.split('/')[1], context.request, db, user);
    if (/^contents\/[^/]+$/.test(path) && method === 'DELETE') return deleteContent(path.split('/')[1], db, user);

    if (path === 'series' && method === 'GET') return listSeries(url, db);
    if (path === 'series' && method === 'POST') return requireLibraryManager(user, () => createSeries(context.request, db, user));
    if (/^series\/[^/]+$/.test(path) && method === 'PATCH') return requireLibraryManager(user, () => updateSeries(path.split('/')[1], context.request, db));
    if (/^series\/[^/]+$/.test(path) && method === 'DELETE') return requireAdmin(user, () => deleteSeries(path.split('/')[1], db));
    if (/^series\/[^/]+\/episodes$/.test(path) && method === 'POST') {
      return requireLibraryManager(user, () => createSeriesEpisode(path.split('/')[1], context.request, db, user));
    }

    if (path === 'watchlist' && method === 'GET') return requireUser(user, () => listWatchlist(db, user));
    if (path === 'watchlist' && method === 'POST') return requireUser(user, () => setWatchlist(context.request, db, user));

    if (path === 'progress' && method === 'GET') return requireUser(user, () => listProgress(db, user));
    if (path === 'progress' && method === 'POST') return requireUser(user, () => setProgress(context.request, db, user));

    if (path === 'rooms' && method === 'GET') return listRooms(db);
    if (path === 'rooms' && method === 'POST') return upsertRoom(context.request, db);
    if (/^rooms\/[^/]+$/.test(path) && method === 'PATCH') return updateRoom(path.split('/')[1], context.request, db);
    if (/^rooms\/[^/]+$/.test(path) && method === 'DELETE') return deleteRoom(path.split('/')[1], context.request, db);

    if (path === 'tmdb/search' && method === 'GET') return requireUser(user, () => searchTmdb(url, context.env));

    if (path === 'admin/users' && method === 'GET') return requireAdmin(user, () => listUsers(db));
    if (path === 'admin/users' && method === 'POST') return requireAdmin(user, () => createUser(context.request, db));
    if (/^admin\/users\/[^/]+$/.test(path) && method === 'PATCH') {
      return requireAdmin(user, () => updateUser(path.split('/')[2], context.request, db, user));
    }
    if (path === 'admin/submissions' && method === 'GET') return requireAdmin(user, () => listSubmissions(db));
    if (/^admin\/submissions\/[^/]+\/approve$/.test(path) && method === 'POST') {
      return requireAdmin(user, () => moderateSubmission(path.split('/')[2], db, user, 'approved'));
    }
    if (/^admin\/submissions\/[^/]+\/reject$/.test(path) && method === 'POST') {
      return requireAdmin(user, () => moderateSubmission(path.split('/')[2], db, user, 'rejected'));
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rooms_visibility_seen ON rooms(visibility, last_seen_at)').run();
}

async function ignoreDuplicateColumn(promise) {
  try {
    await promise;
  } catch (err) {
    if (!/duplicate column|already exists/i.test(String(err?.message || err))) throw err;
  }
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
    clauses.push('(title LIKE ? OR description LIKE ? OR url LIKE ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await db.prepare(`
    SELECT id, url, title, description, poster_url AS posterUrl, subtitle_url AS subtitleUrl,
      type, series_id AS seriesId,
      season, episode, tmdb_id AS tmdbId,
      status, submitted_by AS submittedBy, created_at AS createdAt, updated_at AS updatedAt
    FROM contents
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT 100
  `).bind(...values).all();

  return json({ contents: rows.results || [] });
}

async function listSeries(url, db) {
  const q = cleanText(url.searchParams.get('q'));
  const includeEpisodes = url.searchParams.get('includeEpisodes') === '1' || url.searchParams.get('includeEpisodes') === 'true';
  const clauses = [];
  const values = [];

  if (q) {
    clauses.push('(series.title LIKE ? OR series.description LIKE ?)');
    values.push(`%${q}%`, `%${q}%`);
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
      season, episode, tmdb_id AS tmdbId, status, submitted_by AS submittedBy,
      created_at AS createdAt, updated_at AS updatedAt
    FROM contents
    WHERE status = 'approved' AND series_id IN (${placeholders})
    ORDER BY series_id ASC, COALESCE(season, 0) ASC, COALESCE(episode, 0) ASC, created_at ASC
  `).bind(...series.map(item => item.id)).all();

  const episodesBySeries = new Map();
  (episodeRows.results || []).forEach(episode => {
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
    INSERT INTO contents (id, url, title, description, poster_url, subtitle_url, type, series_id, season, episode, tmdb_id, status, submitted_by, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, 'series', ?, ?, ?, ?, 'approved', ?, ?)
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
    user.id,
    user.id
  ).run();

  await db.prepare('UPDATE series SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run();

  return json({ id: contentId, message: 'Bolum eklendi' }, 201);
}

async function createContent(request, db, user) {
  if (!user) return json({ error: 'Kalici kutuphaneye eklemek icin giris yapmalisin' }, 401);

  const body = await readJson(request);
  const content = normalizeContentInput(body, user.role === 'admin' || user.role === 'uploader');
  if (!content.url) return json({ error: 'Link gerekli' }, 400);

  const canApprove = user.role === 'admin' || user.role === 'uploader';
  const status = canApprove ? 'approved' : 'pending';
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO contents (id, url, title, description, poster_url, subtitle_url, type, series_id, season, episode, tmdb_id, status, submitted_by, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    status,
    user.id,
    canApprove ? user.id : null
  ).run();

  return json({ id, status, message: status === 'pending' ? 'Link admin onayina gonderildi' : 'Link kutuphaneye eklendi' }, 201);
}

async function updateContent(id, request, db, user) {
  if (!user || !['admin', 'uploader'].includes(user.role)) return json({ error: 'Admin veya uploader yetkisi gerekli' }, 403);

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
      tmdb_id = ?, status = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
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
    status,
    status,
    user.id,
    id
  ).run();

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
      contents.type, contents.series_id AS seriesId, contents.season, contents.episode, contents.tmdb_id AS tmdbId
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

async function listProgress(db, user) {
  const rows = await db.prepare(`
    SELECT progress.position_seconds AS positionSeconds, progress.duration_seconds AS durationSeconds,
      progress.updated_at AS progressUpdatedAt,
      contents.id, contents.url, contents.title, contents.description, contents.poster_url AS posterUrl,
      contents.subtitle_url AS subtitleUrl,
      contents.type, contents.series_id AS seriesId, contents.season, contents.episode, contents.tmdb_id AS tmdbId
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

async function listRooms(db) {
  await db.prepare("DELETE FROM rooms WHERE last_seen_at < datetime('now', '-5 minutes')").run();

  const rows = await db.prepare(`
    SELECT room_id AS roomId, host_name AS hostName, member_count AS memberCount,
      content_title AS contentTitle, updated_at AS updatedAt, last_seen_at AS lastSeenAt
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
    INSERT INTO rooms (room_id, host_name, host_token_hash, visibility, member_count, content_title, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(room_id) DO UPDATE SET
      host_name = excluded.host_name,
      host_token_hash = excluded.host_token_hash,
      visibility = excluded.visibility,
      member_count = excluded.member_count,
      content_title = excluded.content_title,
      updated_at = CURRENT_TIMESTAMP,
      last_seen_at = CURRENT_TIMESTAMP
  `).bind(
    input.roomId,
    input.hostName,
    tokenHash,
    input.visibility,
    input.memberCount,
    input.contentTitle
  ).run();

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
    SET visibility = ?, member_count = ?, content_title = ?, updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
    WHERE room_id = ?
  `).bind(input.visibility, input.memberCount, input.contentTitle, input.roomId).run();

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

async function createUser(request, db) {
  const body = await readJson(request);
  const username = cleanText(body.username);
  const password = String(body.password || '');
  const role = ['admin', 'uploader', 'user'].includes(body.role) ? body.role : 'user';

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
  const role = ['admin', 'uploader', 'user'].includes(body.role) ? body.role : null;
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
      contents.status, contents.created_at AS createdAt, users.username AS submittedByName
    FROM contents
    LEFT JOIN users ON users.id = contents.submitted_by
    WHERE contents.status = 'pending'
    ORDER BY contents.created_at ASC
  `).all();
  return json({ submissions: rows.results || [] });
}

async function moderateSubmission(id, db, user, status) {
  await db.prepare(`
    UPDATE contents SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(status, status === 'approved' ? user.id : null, id).run();
  return json({ ok: true });
}

async function searchTmdb(url, env) {
  const query = cleanText(url.searchParams.get('q'));
  const type = normalizeType(url.searchParams.get('type'), true) || 'movie';
  if (!query) return json({ results: [] });

  const bearer = env.TMDB_ACCESS_TOKEN;
  const apiKey = env.TMDB_API_KEY;
  if (!bearer && !apiKey) return json({ results: [], disabled: true });

  const endpointType = type === 'series' ? 'tv' : 'movie';
  const tmdbUrl = new URL(`https://api.themoviedb.org/3/search/${endpointType}`);
  tmdbUrl.searchParams.set('query', query);
  tmdbUrl.searchParams.set('language', 'tr-TR');
  tmdbUrl.searchParams.set('include_adult', 'false');
  if (apiKey) tmdbUrl.searchParams.set('api_key', apiKey);

  const response = await fetch(tmdbUrl, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}
  });
  if (!response.ok) return json({ error: 'TMDB aramasi basarisiz' }, 502);

  const data = await response.json();
  const results = (data.results || []).slice(0, 8).map(item => ({
    tmdbId: String(item.id),
    title: item.title || item.name || '',
    description: item.overview || '',
    posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
    type,
    year: (item.release_date || item.first_air_date || '').slice(0, 4)
  }));

  return json({ results });
}

function requireUser(user, fn) {
  if (!user) return json({ error: 'Giris gerekli' }, 401);
  return fn();
}

function requireAdmin(user, fn) {
  if (!user || user.role !== 'admin') return json({ error: 'Admin yetkisi gerekli' }, 403);
  return fn();
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
    tmdbId: cleanText(body.tmdbId || body.tmdb_id) || null
  };
}

function normalizeRoomInput(body) {
  return {
    roomId: cleanRoomId(body.roomId || body.room_id),
    hostName: cleanText(body.hostName || body.host_name).slice(0, 40),
    hostToken: cleanText(body.hostToken || body.host_token),
    visibility: body.visibility === 'public' ? 'public' : 'private',
    memberCount: clampInteger(body.memberCount || body.member_count, 1, 999),
    contentTitle: cleanText(body.contentTitle || body.content_title).slice(0, 120) || null
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
