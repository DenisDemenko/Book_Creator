/**
 * Постійні номери абзаців — задача Т0.5 дорожньої карти (`PLAN_ROADMAP.md`,
 * журнал #246; ТЗ «11 сторінок»: «незмінні paragraph_id»).
 *
 * ЩО ТАКЕ «АБЗАЦ» ТУТ. Блок верхнього рівня документа редактора — рівно те, на
 * що `markerStringToTiptapDoc` ділить текст розділу: абзац, заголовок, цитата,
 * таблиця, зображення, розділювач сцен, AI-чернетка. Той самий розбір читає й
 * сервер, тож «абзац № i» означає одне й те саме в браузері і в ядрі.
 *
 * ДЕ ЖИВЕ НОМЕР. Текст рукопису не змінюється (жодних прихованих міток у
 * рядку). Поруч із `Section.content` зберігаються два масиви того самого
 * порядку: `paragraphIds` (номер) і `paragraphHashes` (відбиток тексту блока).
 * Під час роботи в редакторі номер живе в атрибуті `pid` вузла
 * (`ParagraphIdExtension.ts`), і ProseMirror сам переносить його разом з
 * абзацом при правці, розбитті, злитті й перетягуванні.
 *
 * КОЛИ ТЕКСТ ЗМІНИВСЯ ПОЗА РЕДАКТОРОМ (правка ШІ, «Знайти й замінити», імпорт,
 * відновлення версії), збережені масиви вже не відповідають тексту. Тоді
 * `reconcileParagraphIds` зіставляє старі й нові блоки за відбитками (найдовша
 * спільна послідовність), блоки між збігами — за порядком («абзац
 * відредаговано на місці» зберігає номер), а справді нові отримують номер,
 * **обчислений** із розділу й відбитка. Обчислений, а не випадковий, —
 * навмисно: браузер і сервер, звіряючи той самий текст із тими самими
 * масивами, отримують однакові номери незалежно одне від одного.
 */
import { markerStringToTiptapDoc, tiptapDocToMarkerBlocks, type JSONContent } from './manuscriptDoc';

/** Відбиток тексту блока: cyrb53 (53 біти) у base36 + довжина. */
export function blockHash(block: string): string {
  const s = String(block ?? '');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + s.length.toString(36);
}

/** 32-бітний хеш рядка з «зерном» — для складання 128-бітного номера. */
function hash32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/**
 * Обчислений номер нового блока — у вигляді UUID (версія 8, «власна схема»):
 * той самий розділ, відбиток і порядковий номер однакового тексту дають той
 * самий номер на будь-якій машині.
 */
export function deterministicParagraphId(sectionId: string, hash: string, occurrence: number): string {
  const key = `${sectionId}\u0000${hash}\u0000${occurrence}`;
  const a = hex8(hash32(key, 0x811c9dc5));
  const b = hex8(hash32(key, 0x9e3779b9));
  const c = hex8(hash32(key, 0x85ebca6b));
  const d = hex8(hash32(key, 0xc2b2ae35));
  const variant = ((parseInt(d[0], 16) & 0x3) | 0x8).toString(16);
  return `${a}-${b.slice(0, 4)}-8${b.slice(5, 8)}-${variant}${d.slice(1, 4)}-${c}${d.slice(4, 8)}`;
}

/** Випадковий номер для блока, що з'явився в редакторі (розбиття абзацу, новий абзац). */
export function randomParagraphId(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const r = () => Math.floor(Math.random() * 0x100000000);
  const x = `${hex8(r())}${hex8(r())}${hex8(r())}${hex8(r())}`;
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

/** Текст кожного блока розділу в маркерах — у порядку документа. */
export function sectionBlocks(content: string): string[] {
  return tiptapDocToMarkerBlocks(markerStringToTiptapDoc(content || ''));
}

export interface ParagraphIdState {
  ids: string[];
  hashes: string[];
}

/** Найдовша спільна послідовність за відбитками: пари [старий, новий] за зростанням. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Номери для поточного тексту розділу з урахуванням збережених.
 *
 * Правила (у порядку сили): незмінений блок зберігає номер; блок між двома
 * незміненими на тому ж місці вважається відредагованим і теж зберігає номер;
 * решта — обчислений номер. Номери в результаті завжди унікальні.
 */
export function reconcileParagraphIds(params: {
  sectionId: string;
  content: string;
  prevIds?: string[];
  prevHashes?: string[];
}): ParagraphIdState & { changed: boolean } {
  const hashes = sectionBlocks(params.content).map(blockHash);
  const prevIds = Array.isArray(params.prevIds) ? params.prevIds : [];
  const prevHashes = Array.isArray(params.prevHashes) ? params.prevHashes : [];
  const usablePrev = prevIds.length === prevHashes.length && prevIds.length > 0;

  if (
    usablePrev &&
    prevIds.length === hashes.length &&
    prevHashes.every((h, i) => h === hashes[i]) &&
    new Set(prevIds).size === prevIds.length
  ) {
    return { ids: [...prevIds], hashes, changed: false };
  }

  const ids: (string | null)[] = new Array(hashes.length).fill(null);
  const used = new Set<string>();
  const take = (newIdx: number, id: string | undefined) => {
    if (!id || used.has(id)) return false;
    ids[newIdx] = id;
    used.add(id);
    return true;
  };

  if (usablePrev) {
    const pairs = lcsPairs(prevHashes, hashes);
    for (const [oi, ni] of pairs) take(ni, prevIds[oi]);
    // Проміжки між збігами: старі й нові блоки на тому самому місці
    // (відредаговано на місці) — за порядком.
    const bounds: [number, number][] = [[-1, -1], ...pairs, [prevHashes.length, hashes.length]];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [o0, n0] = bounds[k];
      const [o1, n1] = bounds[k + 1];
      const gapOld = o1 - o0 - 1;
      const gapNew = n1 - n0 - 1;
      for (let t = 0; t < Math.min(gapOld, gapNew); t++) take(n0 + 1 + t, prevIds[o0 + 1 + t]);
    }
  }

  const occurrences = new Map<string, number>();
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    const occ = occurrences.get(h) ?? 0;
    occurrences.set(h, occ + 1);
    if (ids[i]) continue;
    let n = occ;
    let id = deterministicParagraphId(params.sectionId, h, n);
    while (used.has(id)) id = deterministicParagraphId(params.sectionId, h, ++n + 1000);
    ids[i] = id;
    used.add(id);
  }

  const result = ids as string[];
  const changed =
    result.length !== prevIds.length ||
    result.some((id, i) => id !== prevIds[i]) ||
    hashes.some((h, i) => h !== prevHashes[i]);
  return { ids: result, hashes, changed };
}

/** Документ редактора з номерами блоків верхнього рівня (атрибут `pid`). */
export function markerStringToTiptapDocWithIds(content: string, ids: string[]): JSONContent {
  const doc = markerStringToTiptapDoc(content || '');
  (doc.content || []).forEach((node, i) => {
    if (ids[i]) node.attrs = { ...(node.attrs || {}), pid: ids[i] };
  });
  return doc;
}

/** Номери й відбитки з документа редактора (порядок — як у тексті розділу). */
export function paragraphStateFromDoc(doc: JSONContent): ParagraphIdState & { content: string } {
  const blocks = tiptapDocToMarkerBlocks(doc);
  const ids = (doc.content || []).map((node) => String(node.attrs?.pid || ''));
  return { ids, hashes: blocks.map(blockHash), content: blocks.join('\n\n') };
}

/** Однаковий вміст масивів — щоб не міняти посилання без потреби (патчі WebSocket). */
export function sameStrings(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
