const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: JSON_HEADERS });
  }

  if (context.request.method !== 'GET') {
    return json({ error: 'Sadece GET desteklenir' }, 405);
  }

  const requestUrl = new URL(context.request.url);
  const input = requestUrl.searchParams.get('url') || requestUrl.searchParams.get('video') || '';
  if (!input) {
    return json({ error: 'url parametresi gerekli', example: '/sibnet?url=https://video.sibnet.ru/video5894911-...' }, 400);
  }

  let sourcePage;
  try {
    sourcePage = normalizeSibnetUrl(input);
  } catch (err) {
    return json({ error: err.message || 'Gecersiz Sibnet linki' }, 400);
  }

  try {
    const resolved = await resolveSibnetSource(sourcePage);
    return json(resolved, 200, cacheHeaders(resolved));
  } catch (err) {
    return json({ error: 'Sibnet MP4 linki alinamadi', detail: String(err?.message || err).slice(0, 180) }, 502);
  }
}

async function resolveSibnetSource(sourcePage) {
  if (isDirectMp4(sourcePage.href)) {
    return {
      url: sourcePage.href,
      sourceUrl: sourcePage.href,
      expiresAt: getExpiresAt(sourcePage.href),
      provider: 'sibnet',
    };
  }

  const videoId = getVideoId(sourcePage);
  if (!videoId) throw new Error('Sibnet video id tapilmadi');

  const shellUrls = [
    new URL(`/shell.php?videoid=${videoId}`, 'https://video.sibnet.ru').href,
    new URL(`/shell.php?videoid=${videoId}`, 'http://video.sibnet.ru').href,
    sourcePage.href,
  ];

  const html = await fetchFirstText(shellUrls, sourcePage.href);
  const mediaPath = extractMp4Url(html);
  if (!mediaPath) throw new Error('Player icinde MP4 menbeyi tapilmadi');

  const mediaUrl = new URL(decodeHtml(mediaPath), 'https://video.sibnet.ru').href;
  const signedUrl = await resolveRedirect(mediaUrl, sourcePage.href);

  return {
    url: signedUrl,
    sourceUrl: mediaUrl,
    expiresAt: getExpiresAt(signedUrl),
    provider: 'sibnet',
  };
}

function normalizeSibnetUrl(input) {
  const raw = String(input || '').trim();
  const url = /^\d+$/.test(raw)
    ? new URL(`/shell.php?videoid=${raw}`, 'https://video.sibnet.ru')
    : new URL(raw);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Sadece http/https linkleri desteklenir');
  }

  const host = url.hostname.toLowerCase();
  const allowed = host === 'video.sibnet.ru'
    || host.endsWith('.sibnet.ru')
    || /^dv\d+\.sibnet\.ru$/.test(host);
  if (!allowed) throw new Error('Bu endpoint yalniz Sibnet linkleri ucundur');

  return url;
}

function getVideoId(url) {
  const direct = url.searchParams.get('videoid') || url.searchParams.get('id');
  if (/^\d+$/.test(direct || '')) return direct;

  const match = url.pathname.match(/\/video(\d+)(?:[-_/]|$)/i);
  return match ? match[1] : '';
}

async function fetchFirstText(urls, referer) {
  const errors = [];
  for (const url of urls) {
    try {
      return await fetchText(url, referer);
    } catch (err) {
      errors.push(`${url}: ${String(err?.message || err)}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function fetchText(url, referer) {
  const response = await fetch(url, {
    headers: browserHeaders(referer),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Sibnet HTTP ${response.status}`);
  return response.text();
}

function extractMp4Url(html) {
  const decoded = decodeHtml(html);
  const patterns = [
    /\b(?:src|file)\s*:\s*["']([^"']+\.mp4(?:\?[^"']*)?)["']/i,
    /<source[^>]+src=["']([^"']+\.mp4(?:\?[^"']*)?)["']/i,
    /["'](\/v\/[^"']+\.mp4(?:\?[^"']*)?)["']/i,
    /(https?:)?\/\/[^"'\s<>]+\.sibnet\.ru\/[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?/i,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) return match[1] || match[0];
  }

  return '';
}

async function resolveRedirect(mediaUrl, referer) {
  const response = await fetch(mediaUrl, {
    method: 'HEAD',
    headers: browserHeaders(referer, { Accept: '*/*' }),
    redirect: 'manual',
  });

  const location = response.headers.get('Location');
  if (location) return new URL(location, mediaUrl).href;
  return response.url || mediaUrl;
}

function isDirectMp4(url) {
  return /\.mp4(?:$|[?#])/i.test(url);
}

function getExpiresAt(url) {
  try {
    const expires = Number(new URL(url).searchParams.get('e'));
    if (Number.isFinite(expires) && expires > 0) return new Date(expires * 1000).toISOString();
  } catch {
    // no-op
  }
  return null;
}

function cacheHeaders(result) {
  const headers = {};
  const expiresAt = result?.expiresAt ? new Date(result.expiresAt).getTime() : 0;
  const secondsLeft = Math.floor((expiresAt - Date.now()) / 1000);
  const maxAge = secondsLeft > 90 ? Math.min(300, secondsLeft - 60) : 30;
  headers['Cache-Control'] = `public, max-age=${maxAge}`;
  return headers;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function browserUserAgent() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
}

function browserHeaders(referer, overrides = {}) {
  return {
    'User-Agent': browserUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': referer || 'https://video.sibnet.ru/',
    ...overrides,
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}
