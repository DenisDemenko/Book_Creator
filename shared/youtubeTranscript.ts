export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
export interface TranscriptSegment { start: number; duration: number; text: string }
export interface TranscriptSource { videoId: string; url: string; title: string; language: string; origin: 'author' | 'automatic' | 'manual'; importedAt: string; segments: TranscriptSegment[] }
export function youtubeVideoId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Некоректне посилання YouTube.');
  let u: URL; try { u = new URL(raw); } catch { throw new Error('Некоректне посилання YouTube.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('Потрібне HTTPS-посилання YouTube.');
  let id: string | null = null;
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1] ?? null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('Некоректне посилання YouTube.');
  return id;
}
export function cleanCaption(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, v => {
    const named: Record<string,string> = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
    if (named[v]) return named[v];
    const n = parseInt(v.slice(v[2]?.toLowerCase() === 'x' ? 3 : 2, -1), v[2]?.toLowerCase() === 'x' ? 16 : 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/\s+/g, ' ').trim();
}
export function normalizeSegments(input: TranscriptSegment[]): TranscriptSegment[] {
  if (input.length > 20000) throw new Error('Забагато сегментів.');
  const out: TranscriptSegment[] = [];
  let length = 0;
  for (const raw of input) {
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.duration) || raw.start < 0 || raw.duration < 0 || raw.start + raw.duration > 86400 || typeof raw.text !== 'string') throw new Error('Некоректний таймкод субтитрів.');
    const text = cleanCaption(raw.text); if (!text) continue;
    if (out.length && raw.start < out[out.length - 1].start) throw new Error('Сегменти мають бути у часовому порядку.');
    // Only identical overlapping cues are duplicates; spoken repetitions after a gap survive.
    const prev = out[out.length - 1];
    if (prev && prev.text === text && raw.start < prev.start + prev.duration) { prev.duration = Math.max(prev.duration, raw.start + raw.duration - prev.start); continue; }
    length += text.length; if (length > MAX_TRANSCRIPT_BYTES) throw new Error('Розшифровка завелика.');
    out.push({start: raw.start, duration: raw.duration, text});
  }
  if (!out.length) throw new Error('Розшифровка порожня.');
  return out;
}
function seconds(raw: string): number {
  const m = raw.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!m || +m[2] > 59 || +m[3] > 59) throw new Error('Некоректний таймкод субтитрів.');
  return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}
export function parseSubtitles(raw: string, format: 'srt' | 'vtt' | 'text'): TranscriptSegment[] {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_TRANSCRIPT_BYTES) throw new Error('Файл завеликий (максимум 2 МБ).');
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (format === 'text') {
    if (!text) throw new Error('Розшифровка порожня.');
    return [{start: 0, duration: 0, text: text.replace(/<[^>]*>/g, '')}];
  }
  const cues: TranscriptSegment[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) throw new Error('Некоректний блок субтитрів.');
    const parts = lines[i].split('-->');
    const start = seconds(parts[0].trim()), end = seconds(parts[1].trim().split(/\s+/)[0]);
    if (end < start) throw new Error('Кінець сегмента передує початку.');
    cues.push({start, duration: end-start, text: lines.slice(i+1).join(' ')});
  }
  return normalizeSegments(cues);
}
export const transcriptText = (segments: TranscriptSegment[]) => segments.map(s => s.text).join('\n');
