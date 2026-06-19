/**
 * Cloudflare Pages Function - HLS proxy
 * URL: /hls?url=https%3A%2F%2Fexample.com%2Fmaster.m3u8
 *
 * Keeps cross-origin HLS playlists and segments controllable from the app's
 * own <video> element, so custom controls and room sync keep working.
 */
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const target = requestUrl.searchParams.get('url');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (!target) {
    return jsonError('url parametresi gerekli', 400);
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return jsonError('Gecersiz url', 400);
  }

  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) {
    return jsonError('Sadece http/https desteklenir', 400);
  }

  try {
    const upstream = await fetch(upstreamUrl.href, {
      method: context.request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: buildUpstreamHeaders(context.request, upstreamUrl),
      redirect: 'follow',
    });

    const responseHeaders = buildResponseHeaders(upstream.headers);
    const contentType = upstream.headers.get('Content-Type') || '';
    const isPlaylist = looksLikePlaylist(upstreamUrl, contentType);

    if (isPlaylist && context.request.method !== 'HEAD') {
      const playlist = await upstream.text();
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      responseHeaders.delete('Content-Length');
      return new Response(rewritePlaylist(playlist, upstreamUrl), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return jsonError('HLS baglanti hatasi', 502, err.message);
  }
}

function buildUpstreamHeaders(request, upstreamUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
    'Referer': `${upstreamUrl.origin}/`,
  };

  const range = request.headers.get('Range');
  if (range) headers.Range = range;

  return headers;
}

function buildResponseHeaders(upstreamHeaders) {
  const headers = corsHeaders();
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=60');

  for (const header of ['Content-Type', 'Content-Length', 'Content-Range']) {
    const value = upstreamHeaders.get(header);
    if (value) headers.set(header, value);
  }

  return headers;
}

function looksLikePlaylist(url, contentType) {
  return /\.m3u8(?:$|[?#])/i.test(url.href) || /mpegurl|m3u8/i.test(contentType);
}

function rewritePlaylist(playlist, baseUrl) {
  return playlist
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxiedUrl(uri, baseUrl)}"`);
      }

      return line.replace(trimmed, proxiedUrl(trimmed, baseUrl));
    })
    .join('\n');
}

function proxiedUrl(value, baseUrl) {
  try {
    const absolute = new URL(value, baseUrl).href;
    return `/hls?url=${encodeURIComponent(absolute)}`;
  } catch {
    return value;
  }
}

function corsHeaders() {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
  });
}

function jsonError(error, status, detail) {
  return new Response(JSON.stringify({ error, detail }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
