/**
 * Cloudflare Pages Function — Google Drive Stream Proxy
 * URL: /proxy?id=FILE_ID
 *
 * Bu fayl Cloudflare Pages'ın Functions özelliğini kullanır.
 * watchbuddy/functions/proxy.js olarak repoya ekle → otomatik çalışır.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const fileId = url.searchParams.get('id');

  // CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range',
      },
    });
  }

  if (!fileId) {
    return new Response(
      JSON.stringify({ error: 'id parametresi gerekli', example: '/proxy?id=FILE_ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  // Google Drive direct download endpoint
  const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;

  try {
    const upstream = await fetch(driveUrl, {
      method: context.request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Referer': 'https://drive.google.com/',
        // Forward Range header for seeking support
        ...(context.request.headers.get('Range')
          ? { 'Range': context.request.headers.get('Range') }
          : {}),
      },
      redirect: 'follow',
    });

    // Build response headers
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    responseHeaders.set('Accept-Ranges', 'bytes');

    // Pass through content headers
    const passThrough = ['Content-Type', 'Content-Length', 'Content-Range', 'Content-Disposition'];
    for (const header of passThrough) {
      const val = upstream.headers.get(header);
      if (val) responseHeaders.set(header, val);
    }

    // Force video/mp4 if content type is not set or is octet-stream
    const ct = responseHeaders.get('Content-Type') || '';
    if (!ct || ct === 'application/octet-stream') {
      responseHeaders.set('Content-Type', 'video/mp4');
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Google Drive bağlantı hatası', detail: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
