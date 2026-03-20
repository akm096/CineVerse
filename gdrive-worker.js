/**
 * CineVerse — Google Drive Video Proxy
 * Cloudflare Worker (ayrı worker olaraq yaradılmalı)
 *
 * İstifadə: https://YOUR-WORKER.workers.dev/?id=GOOGLE_DRIVE_FILE_ID
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('id');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
        },
      });
    }

    if (!fileId) {
      return new Response(
        '{"error":"id parametresi gerekli","example":"/?id=GOOGLE_DRIVE_FILE_ID"}',
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // Google Drive direct download URL
    const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;

    try {
      // Build request headers
      const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://drive.google.com/',
      };

      // Forward Range header for video seeking
      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        fetchHeaders['Range'] = rangeHeader;
      }

      const upstream = await fetch(driveUrl, {
        method: 'GET',
        headers: fetchHeaders,
        redirect: 'follow',
      });

      // Check if Google returned an error page instead of video
      const contentType = upstream.headers.get('Content-Type') || '';
      if (contentType.includes('text/html')) {
        return new Response(
          '{"error":"Google Drive dosyaya erişemiyor. Dosyanın paylaşım ayarını kontrol edin (Bağlantıya sahip olan herkes)."}',
          { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        );
      }

      // Build response headers
      const responseHeaders = new Headers();
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      responseHeaders.set('Accept-Ranges', 'bytes');
      responseHeaders.set('Cache-Control', 'public, max-age=3600');

      // Pass through content headers
      const passHeaders = ['Content-Length', 'Content-Range', 'Content-Disposition'];
      for (const h of passHeaders) {
        const val = upstream.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      // Set correct content type
      if (contentType && contentType !== 'application/octet-stream') {
        responseHeaders.set('Content-Type', contentType);
      } else {
        responseHeaders.set('Content-Type', 'video/mp4');
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Bağlantı hatası', detail: err.message }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }
  },
};
