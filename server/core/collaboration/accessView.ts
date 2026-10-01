/**
 * Книга очима обмеженого учасника (Т6.2, `PLAN_ACCESS.md`): що йому
 * віддати й що з його правки прийняти. Чисті функції — без бази й мережі.
 *
 * Обрізана книга: лише розділи, у яких є хоч одна дозволена сцена, і лише
 * дозволені сцени (зміст повністю); картки героїв — лише ті, на кого є
 * доступ (за `externalRef` сутності ядра); решта полів книги — порожні
 * (сюжетна дошка, нотатки, біблія, ілюстрації, курс…; обов'язкові — порожні),
 * бо в них — зміст усієї книги.
 *
 * Злиття правки: від обмеженого учасника приймається лише зміст сцен, які він
 * може редагувати; структуру книги (розділи, сцени, порядок) він не змінює, і
 * недозволене лишається таким, як на сервері.
 */

import type { EffectiveAccess } from './access';
import { canRead, canWrite, sceneLevel } from './access';

type AnyBook = Record<string, any>;

/** Поля книги, що лишаються обмеженому учаснику: назва, мова, автор — без змісту. */
const KEEP_FIELDS = ['id', 'title', 'titleEn', 'subtitle', 'subtitleEn', 'author', 'authorEn', 'language', 'genre', 'version', 'revisionNumber', 'status', 'createdAt', 'updatedAt'];
/** Поля-масиви, які обнуляються (а не зникають), щоб інтерфейс не ламався. */
const EMPTY_ARRAYS = ['characters', 'illustrations', 'footnotes', 'qrTags', 'versionHistory', 'customDictionary', 'skillSnapshots', 'knowledgeFiles'];
/** Поля сцени, які несуть її зміст і які обмежений редактор може змінювати. */
export const SECTION_CONTENT_FIELDS = ['content', 'contentEn', 'wordCount', 'characterCount', 'paragraphIds', 'paragraphHashes', 'lastModified', 'footnotes'];

/**
 * Що з книги бачить учасник. `characterRefs` — `externalRef` (id картки героя
 * в Студії) сутностей-персонажів, на які є доступ.
 */
export function restrictBook(book: AnyBook | null | undefined, eff: EffectiveAccess, characterRefs: Set<string> = new Set()): AnyBook | null {
  if (!book) return null;
  if (eff.full || !eff.restricted) return book;
  const out: AnyBook = {};
  for (const k of KEEP_FIELDS) if (book[k] !== undefined) out[k] = book[k];
  for (const k of EMPTY_ARRAYS) out[k] = [];
  // Обов'язкові поля книги — порожні, а не відсутні (інтерфейс на них розраховує).
  out.synopsis = '';
  out.logline = '';
  out.theme = '';
  // Налаштування макета змісту не несуть; обкладинка — без тексту звороту.
  if (book.layoutConfig !== undefined) out.layoutConfig = book.layoutConfig;
  if (book.coverConfig && typeof book.coverConfig === 'object') out.coverConfig = { ...book.coverConfig, backDescription: '', authorBio: undefined, tagline: undefined };
  // Стиль-біблія — окрема область (застосування — Т7): поки порожня.
  const vb = book.visualBible && typeof book.visualBible === 'object' ? book.visualBible : {};
  out.visualBible = { id: vb.id ?? '', bookId: vb.bookId ?? book.id, styleName: '', artStyle: '', colorPalette: [], lighting: '', mood: '', referenceNotes: '', keyMotifs: [], aspectRatio: vb.aspectRatio ?? '' };
  out.chapters = (Array.isArray(book.chapters) ? book.chapters : [])
    .map((ch: AnyBook) => {
      const sections = (Array.isArray(ch.sections) ? ch.sections : []).filter((s: AnyBook) => canRead(sceneLevel(eff, ch.id, s.id)));
      if (!sections.length) return null;
      // Опис розділу й склад героїв розділу — теж зміст: лише якщо розділ дозволено цілком.
      const wholeChapter = canRead(eff.chapters[ch.id] ?? 'none');
      return { id: ch.id, bookId: ch.bookId, title: ch.title, titleEn: ch.titleEn, order: ch.order, ...(wholeChapter ? { description: ch.description, descriptionEn: ch.descriptionEn } : {}), sections };
    })
    .filter(Boolean);
  out.characters = (Array.isArray(book.characters) ? book.characters : []).filter((c: AnyBook) => characterRefs.has(String(c.id)));
  out.accessRestricted = true;
  return out;
}

/** Чи бачить учасник сцену (для точкових правок кімнати). */
export function canSeeSection(eff: EffectiveAccess, chapterId: string, sectionId: string): boolean {
  return canRead(sceneLevel(eff, chapterId, sectionId));
}

export function canEditSection(eff: EffectiveAccess, chapterId: string, sectionId: string): boolean {
  return canWrite(sceneLevel(eff, chapterId, sectionId));
}

/** Що кімната знає про учасника з частковим доступом. */
export interface RoomView {
  eff: EffectiveAccess;
  characterRefs: Set<string>;
}

/**
 * Подія кімнати очима учасника з частковим доступом: книга — обрізана, чужі
 * точкові правки недозволених сцен — не надходять, журнал правок і знімки
 * версій (там зміст усієї книги) — лише тому, хто бачить книгу. null — не
 * надсилати.
 */
export function shapeRoomEvent(event: AnyBook, view: RoomView | null | undefined): AnyBook | null {
  if (!view || view.eff.full) return event;
  const { eff, characterRefs } = view;
  const p = event?.payload ?? {};
  switch (event?.type) {
    case 'book:remote_update':
      return { ...event, payload: { ...p, book: restrictBook(p.book, eff, characterRefs), ...(eff.restricted ? { logEntry: undefined } : {}) } };
    case 'version:snapshot_created':
      if (eff.restricted) return { ...event, payload: { book: restrictBook(p.book, eff, characterRefs) } };
      return event;
    case 'section:remote_patch':
      return p.patch && canSeeSection(eff, String(p.patch.chapterId), String(p.patch.sectionId)) ? event : null;
    default:
      return event;
  }
}

/**
 * Злити правку обмеженого учасника в серверну книгу: лише зміст сцен, які
 * він може редагувати. Повертає нову книгу й перелік змінених сцен (порожній —
 * нічого прийняти).
 */
export function mergeRestrictedUpdate(serverBook: AnyBook, clientBook: AnyBook, eff: EffectiveAccess): { book: AnyBook; changed: string[] } {
  const merged: AnyBook = JSON.parse(JSON.stringify(serverBook));
  const changed: string[] = [];
  const clientSections = new Map<string, AnyBook>();
  for (const ch of Array.isArray(clientBook?.chapters) ? clientBook.chapters : []) for (const s of Array.isArray(ch.sections) ? ch.sections : []) clientSections.set(`${ch.id}\u0000${s.id}`, s);
  for (const ch of merged.chapters ?? []) {
    for (const s of ch.sections ?? []) {
      if (!canEditSection(eff, ch.id, s.id)) continue;
      const incoming = clientSections.get(`${ch.id}\u0000${s.id}`);
      if (!incoming) continue;
      let touched = false;
      for (const f of SECTION_CONTENT_FIELDS) {
        if (incoming[f] !== undefined && JSON.stringify(incoming[f]) !== JSON.stringify(s[f])) {
          s[f] = incoming[f];
          touched = true;
        }
      }
      if (touched) changed.push(s.id);
    }
  }
  if (changed.length) merged.updatedAt = clientBook?.updatedAt && Date.parse(clientBook.updatedAt) > Date.parse(serverBook.updatedAt ?? 0) ? clientBook.updatedAt : new Date().toISOString();
  return { book: merged, changed };
}
