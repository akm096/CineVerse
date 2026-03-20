/**
 * WatchBuddy — Subtitle Parser & Renderer
 * Supports: SRT, VTT, JSON formats
 */
const SubtitleEngine = (() => {
  let cues = [];
  let activeCueIndex = -1;

  /**
   * Parse SRT format
   * Example:
   * 1
   * 00:00:01,000 --> 00:00:04,000
   * Hello world
   */
  function parseSRT(text) {
    const result = [];
    const blocks = text.trim().replace(/\r\n/g, '\n').split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      // Find the timestamp line
      let tsLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) { tsLine = i; break; }
      }
      if (tsLine === -1) continue;
      const match = lines[tsLine].match(
        /(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})/
      );
      if (!match) continue;
      const start = timeToSeconds(match[1]);
      const end = timeToSeconds(match[2]);
      const text_content = lines.slice(tsLine + 1).join('\n').trim();
      if (text_content) {
        result.push({ start, end, text: text_content });
      }
    }
    return result;
  }

  /**
   * Parse VTT format
   */
  function parseVTT(text) {
    // Remove WEBVTT header and optional metadata
    let cleaned = text.trim().replace(/\r\n/g, '\n');
    // Remove WEBVTT line and everything before first cue
    cleaned = cleaned.replace(/^WEBVTT[^\n]*\n/, '');
    // Remove NOTE blocks
    cleaned = cleaned.replace(/^NOTE[^\n]*\n(?:[^\n]+\n)*\n/gm, '');
    // Remove STYLE blocks
    cleaned = cleaned.replace(/^STYLE[^\n]*\n(?:[^\n]+\n)*\n/gm, '');
    return parseSRT(cleaned);
  }

  /**
   * Parse JSON subtitle format
   * Expected: [{start, end, text}] or [{startTime, endTime, text}] or [{from, to, content}]
   */
  function parseJSON(text) {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : (data.cues || data.subtitles || data.body || []);
      return arr.map(item => {
        const start = item.start ?? item.startTime ?? item.from ?? 0;
        const end = item.end ?? item.endTime ?? item.to ?? 0;
        const content = item.text ?? item.content ?? item.subtitle ?? '';
        return {
          start: typeof start === 'string' ? timeToSeconds(start) : start,
          end: typeof end === 'string' ? timeToSeconds(end) : end,
          text: content
        };
      }).filter(c => c.text);
    } catch (e) {
      console.error('JSON parse error:', e);
      return [];
    }
  }

  /**
   * Convert timestamp string to seconds
   * Handles: "00:01:30,500", "00:01:30.500", "01:30.500"
   */
  function timeToSeconds(ts) {
    ts = ts.replace(',', '.');
    const parts = ts.split(':');
    if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(ts) || 0;
  }

  /**
   * Auto-detect format and parse
   */
  function parse(text, filename) {
    text = text.trim();
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';

    if (ext === 'vtt' || text.startsWith('WEBVTT')) {
      return parseVTT(text);
    }
    if (ext === 'json' || text.startsWith('[') || text.startsWith('{')) {
      return parseJSON(text);
    }
    // Default: SRT
    return parseSRT(text);
  }

  /**
   * Load subtitles from text content
   */
  function load(text, filename) {
    cues = parse(text, filename);
    cues.sort((a, b) => a.start - b.start);
    activeCueIndex = -1;
    return cues.length;
  }

  /**
   * Get subtitle text for given video time
   */
  function getTextAt(currentTime) {
    // Binary search for active cue
    let lo = 0, hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid].end < currentTime) lo = mid + 1;
      else if (cues[mid].start > currentTime) hi = mid - 1;
      else {
        activeCueIndex = mid;
        // Clean tags like <i>, <b>, {\\an8} etc.
        return cleanTags(cues[mid].text);
      }
    }
    activeCueIndex = -1;
    return '';
  }

  /**
   * Clean HTML/ASS tags from subtitle text
   */
  function cleanTags(text) {
    return text
      .replace(/<[^>]+>/g, '')       // HTML tags
      .replace(/\{[^}]+\}/g, '')     // ASS tags like {\an8}
      .trim();
  }

  function clear() {
    cues = [];
    activeCueIndex = -1;
  }

  function getCueCount() { return cues.length; }

  return { load, getTextAt, clear, getCueCount };
})();
