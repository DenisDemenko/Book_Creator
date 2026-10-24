/**
 * Синхронізація версій однієї книги між двома серверами (локальна Студія ↔
 * продакшн): ЧИСТА логіка без мережі й бази, щоб її можна було перевірити
 * тестом.
 *
 * ПРАВИЛО (рішення власника): «завжди новіша версія перемагає». Три запобіжники,
 * бо мовчки втратити правки гірше, ніж спитати:
 *   1. Програш не губиться: приймаюча сторона зберігає книгу через `saveBook`,
 *      який кладе КОЖНУ ревізію в історію, тож попередню версію можна відкрити.
 *   2. Якщо обидві сторони змінилися після останньої узгодженої версії
 *      (`baseHash`), план позначається `diverged` — інтерфейс має показати
 *      це перед застосуванням, а не після.
 *   3. Якщо дві версії відрізняються менше ніж на `skewMs` за часом, годинникам
 *      двох машин вірити не можна — план `blocked`, потрібен явний напрям.
 *
 * Час береться з `updatedAt` кожного сервера, а рівність — за хешем вмісту, а
 * не за номером ревізії: лічильники ревізій двох серверів незалежні.
 */

import { createHash } from 'node:crypto';

export interface ChapterFingerprint {
  id: string;
  title: string;
  hash: string;
}

export interface BookSyncSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  /** Хеш усього вмісту книги: однаковий вміст = однаковий хеш на будь-якому сервері. */
  hash: string;
  chapters: ChapterFingerprint[];
}

export type SyncAction = 'none' | 'pull' | 'push';
export type SyncSide = 'local' | 'remote';

export interface ChapterDiffEntry {
  id: string;
  title: string;
  /** `only-local` / `only-remote` / `changed` / `same` */
  state: 'only-local' | 'only-remote' | 'changed' | 'same';
}

export interface SyncPlan {
  /** `pull` — взяти з віддаленого; `push` — віддати на віддалений; `none` — нічого. */
  action: SyncAction;
  /** Чия версія новіша (за часом), або `same` коли вміст збігається. */
  newer: SyncSide | 'same';
  /** Чому саме така дія — людською мовою, для інтерфейсу. */
  reason: string;
  /** Обидві сторони змінилися після останньої узгодженої версії. */
  diverged: boolean;
  /** Час двох версій надто близький: автоматично вибирати не можна. */
  blocked: boolean;
  /** Застосування затре правки програшної сторони (її версія лишиться в історії). */
  overwritesLoserEdits: boolean;
  chapters: ChapterDiffEntry[];
}

export interface PlanOptions {
  /** Хеш останньої узгодженої версії цієї книги (збережено при минулій синхронізації). */
  baseHash?: string | null;
  /** Різниця часу, менше за яку «новішу» визначати не береться. За замовчуванням 2 хв. */
  skewMs?: number;
}

export const DEFAULT_SKEW_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Відбиток вмісту
// ---------------------------------------------------------------------------

/** JSON із відсортованими ключами: порядок полів не змінює хеш. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Стислий опис книги для порівняння: без самого тексту, лише відбитки. */
export function summarizeBook(stored: {
  id: string;
  title?: string;
  revision: number;
  updatedAt: string;
  book: Record<string, unknown>;
}): BookSyncSummary {
  const book = stored.book || {};
  const rawChapters = Array.isArray((book as any).chapters) ? ((book as any).chapters as any[]) : [];
  const chapters: ChapterFingerprint[] = rawChapters.map((chapter, index) => ({
    id: String(chapter?.id ?? `#${index + 1}`),
    title: String(chapter?.title ?? ''),
    hash: hashValue(chapter),
  }));
  return {
    id: stored.id,
    title: String(stored.title ?? (book as any).title ?? ''),
    revision: stored.revision,
    updatedAt: stored.updatedAt,
    hash: hashValue(book),
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Різниця за главами
// ---------------------------------------------------------------------------

export function diffChapters(
  local: ChapterFingerprint[] | null | undefined,
  remote: ChapterFingerprint[] | null | undefined,
): ChapterDiffEntry[] {
  const l = new Map((local ?? []).map((c) => [c.id, c] as const));
  const r = new Map((remote ?? []).map((c) => [c.id, c] as const));
  const ids: string[] = [];
  for (const c of local ?? []) ids.push(c.id);
  for (const c of remote ?? []) if (!l.has(c.id)) ids.push(c.id);
  return ids.map((id) => {
    const a = l.get(id);
    const b = r.get(id);
    if (a && !b) return { id, title: a.title, state: 'only-local' as const };
    if (!a && b) return { id, title: b.title, state: 'only-remote' as const };
    return { id, title: (a ?? b)!.title, state: a!.hash === b!.hash ? ('same' as const) : ('changed' as const) };
  });
}

// ---------------------------------------------------------------------------
// План
// ---------------------------------------------------------------------------

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function planBookSync(
  local: BookSyncSummary | null,
  remote: BookSyncSummary | null,
  options: PlanOptions = {},
): SyncPlan {
  const skewMs = options.skewMs ?? DEFAULT_SKEW_MS;
  const base = options.baseHash ?? null;
  const chapters = diffChapters(local?.chapters, remote?.chapters);

  if (!local && !remote) {
    return { action: 'none', newer: 'same', reason: 'Книги немає ні тут, ні там.', diverged: false, blocked: false, overwritesLoserEdits: false, chapters };
  }
  if (!local) {
    return { action: 'pull', newer: 'remote', reason: 'Книга є лише на віддаленому сервері — створити тут.', diverged: false, blocked: false, overwritesLoserEdits: false, chapters };
  }
  if (!remote) {
    return { action: 'push', newer: 'local', reason: 'Книга є лише тут — створити на віддаленому сервері.', diverged: false, blocked: false, overwritesLoserEdits: false, chapters };
  }
  if (local.hash === remote.hash) {
    return { action: 'none', newer: 'same', reason: 'Версії однакові.', diverged: false, blocked: false, overwritesLoserEdits: false, chapters };
  }

  // Обидві сторони відрізняються від останньої узгодженої → хтось із двох
  // змінював паралельно. Без бази (ніколи не синхронізували) вважаємо так само:
  // нема доказу, що одна версія — нащадок іншої.
  const diverged = base === null || (local.hash !== base && remote.hash !== base);

  const delta = ms(local.updatedAt) - ms(remote.updatedAt);
  if (Math.abs(delta) < skewMs) {
    return {
      action: 'none',
      newer: 'same',
      reason: `Час змін відрізняється менше ніж на ${Math.round(skewMs / 1000)} с — годиннику двох машин вірити не можна. Оберіть напрям вручну.`,
      diverged,
      blocked: true,
      overwritesLoserEdits: diverged,
      chapters,
    };
  }

  const newer: SyncSide = delta > 0 ? 'local' : 'remote';
  return {
    action: newer === 'local' ? 'push' : 'pull',
    newer,
    reason: newer === 'local'
      ? 'Локальна версія новіша — відправити на віддалений сервер.'
      : 'Віддалена версія новіша — взяти її сюди.',
    diverged,
    blocked: false,
    overwritesLoserEdits: diverged,
    chapters,
  };
}
