/**
 * Клієнтський виклик озвучення (server/narrationRoutes.ts). Один шар для
 * трьох місць виклику: виділений фрагмент у редакторі, розділ книги
 * (плейлист «Слухати книгу»), тег курсу — щоб формат помилки й кеш-логіка
 * на сервері не дублювались утретє в компонентах.
 */

export type NarrationLang = 'uk' | 'en';
export const NARRATION_LANGS: NarrationLang[] = ['uk', 'en'];
export const NARRATION_MAX_CHARS = 5000;

export interface NarrationRequest {
  text: string;
  lang: NarrationLang;
  scope?: 'selection' | 'section';
  bookId?: string;
  chapterId?: string;
  sectionId?: string;
}

export interface NarrationResult {
  audioUrl: string;
  cached: boolean;
  charCount: number;
}

export class NarrationClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind?: string
  ) {
    super(message);
    this.name = 'NarrationClientError';
  }
}

export async function synthesizeNarration(req: NarrationRequest): Promise<NarrationResult> {
  const res = await fetch('/api/narration/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ scope: 'selection', ...req }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new NarrationClientError(data?.error || `HTTP ${res.status}`, res.status, data?.kind);
  }
  return data as NarrationResult;
}

export interface NarrationStatus {
  configured: boolean;
  langs: NarrationLang[];
  maxChars: number;
}

export async function fetchNarrationStatus(): Promise<NarrationStatus | null> {
  try {
    const res = await fetch('/api/narration/status', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Розбиває довгий текст розділу на частини під NARRATION_MAX_CHARS, по межах речень. */
export function splitForNarration(text: string, limit = NARRATION_MAX_CHARS): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const parts: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const at = cut > limit * 0.5 ? cut + 1 : limit;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}
