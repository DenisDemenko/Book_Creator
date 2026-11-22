/**
 * Справжній запис результату відправки й справжній текстовий прохід (A2).
 * Маршрути (photoDraftRoutes.ts) тестуються з підставними реалізаціями цих
 * інтерфейсів і не тягнуть ні базу курсів, ні мережевих провайдерів.
 */

import { createHash } from 'node:crypto';
import { GEMINI_MODEL, generateText } from '../aiCore';
import { engineConfigured, resolveEngine, ENGINE_ENV_KEY } from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';
import { resolveModuleModelId } from '../coreModuleModels';
import { createCourse } from '../courseStore';
import { createDraft as createExpressDraft } from '../expressStore';
import { listUsageSince } from '../store';
import { createScan, listScans, updateScan } from './externalApiStore';
import { getBook, saveBook } from '../bookStore';
import { attachAssetsToBook, getAsset, updateMediaProvenance } from '../media/mediaLibraryStore';
import { buildBookFromManuscript } from '../../src/utils/manuscriptBook';
import { joinManuscriptPages } from '../../src/utils/manuscriptBatch';
import { buildDescriptionDraft, descriptionWordCount } from '../../src/utils/describeCharacterTransfer';
import type { Book, Section, UserRole } from '../../src/types';
import type { BookIdea, DraftModule } from '../../shared/photoDraftContract';
import type { CourseInput, InboxItem } from './photoDraftMapping';
import type { WriteTextParams } from './photoDraftRoutes';

export async function writeWithCoreText(p: WriteTextParams): Promise<{ text: string; modelId: string }> {
  // Модуль «Розгортання інструкції» — звичайна текстова модель адміна; своєї
  // прив'язки проходи GrabFusion не мають, доки не з'ясується, що потрібна.
  const modelId = (await resolveModuleModelId('instructionElaboration')) || GEMINI_MODEL;
  const engine = resolveEngine(modelId);
  const userKey = await resolveEngineKey(p.ownerId, engine, 'photo-draft');
  if (!userKey && !engineConfigured(engine)) {
    throw new Error(`Модель не налаштована: потрібен ${ENGINE_ENV_KEY[engine]} на сервері або власний ключ автора.`);
  }
  const result = await generateText({
    engine,
    modelId,
    prompt: p.prompt,
    systemInstruction: p.system,
    apiKeyOverride: userKey,
    json: true,
    generation: { temperature: 0.4, maxTokens: p.maxTokens, timeoutMs: 170_000 },
    req: p.req,
    label: p.label,
  });
  return { text: result.text, modelId };
}

/**
 * Скільки ШІ коштувала чернетка: записи журналу витрат викладача, у підписі яких
 * є id чернетки (описи кадрів і проходи 2–3). Не вдалося прочитати — `null`:
 * відправку це не блокує.
 */
export async function aiUsageForDraft(p: { ownerId: string; draftId: string; since: string }): Promise<{ calls: number; costUsd: number } | null> {
  try {
    const rows = (await listUsageSince(p.since)).filter((r) => r.userId === p.ownerId && typeof r.context === 'string' && r.context.includes(p.draftId));
    const costUsd = Math.round(rows.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0) * 10_000) / 10_000;
    return { calls: rows.length, costUsd };
  } catch {
    return null;
  }
}

export async function createCourseDraft(ownerId: string, input: CourseInput): Promise<string> {
  return createCourse(ownerId, input).id;
}

export async function createExpressInstruction(ownerId: string, payload: Record<string, unknown>): Promise<string> {
  return createExpressDraft(ownerId, payload as any).id;
}

/**
 * По одному запису у «Вхідних» на урок (або на сторінку рукопису); повертає id першого
 * (на нього веде посилання). З `batch` записи складають пакет: порядок = порядок `items`,
 * `bookId` може бути порожнім (нова книга без запису на сервері).
 */
export async function createInboxScans(p: {
  ownerId: string;
  bookId: string;
  items: InboxItem[];
  tokenId?: string | null;
  batch?: { id: string; bookTitle?: string | null };
}): Promise<string> {
  let first = '';
  let order = 0;
  for (const item of p.items) {
    order += 1;
    const scan = await createScan({
      ownerId: p.ownerId,
      bookId: p.bookId,
      assetId: item.assetId,
      imageUrl: item.imageUrl,
      tokenId: p.tokenId ?? null,
      ...(p.batch ? { batch: { id: p.batch.id, order, bookTitle: p.batch.bookTitle ?? null } } : {}),
    });
    await updateScan(scan.id, p.ownerId, {
      status: 'submitted',
      recognizedText: item.text,
      text: item.text,
      chapterTitle: item.chapterTitle,
      sectionTitle: item.sectionTitle,
      modelId: 'grabfusion',
    });
    if (!first) first = scan.id;
  }
  return first;
}

/** Map the approved plan to the same chapters and sections used by the Studio editor and scenario view. */
function importPhotoBook(
  book: Book,
  chapters: readonly DraftModule[],
  ideas: readonly BookIdea[],
): Book {
  const characters = ideas.filter((idea) => idea.accepted && idea.kind === 'character').map((idea): Book['characters'][number] => ({
    id: `char-gf-${idea.id}`,
    bookId: book.id,
    name: idea.title,
    role: 'minor',
    appearance: {},
    personality: { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' },
    biography: idea.text,
    relationships: [],
    tags: ['GrabFusion'],
  }));
  const scenes = ideas.filter((idea) => idea.accepted && idea.kind === 'scene');
  const claimed = new Set<string>();
  const approvedForLesson = new Map<string, BookIdea>();
  const unmatched = new Map<number, BookIdea[]>();
  const normalizedTitle = (title: string) => title.trim().toLocaleLowerCase('uk');
  const planned = chapters.flatMap((chapter, index) => chapter.lessons.map((lesson) => ({ index, lesson })));
  for (const scene of scenes) {
    const available = planned.filter(({ lesson }) => !claimed.has(lesson.lessonId));
    const sameSources = ({ lesson }: typeof planned[number]) =>
      lesson.photoIds.length > 0 && scene.photoIds.length === lesson.photoIds.length &&
      lesson.photoIds.every((id) => scene.photoIds.includes(id));
    const sameTitle = available.find(({ lesson }) =>
      normalizedTitle(lesson.title) === normalizedTitle(scene.title) &&
      lesson.photoIds.some((id) => scene.photoIds.includes(id)));
    const match = sameTitle ?? available.find(sameSources);
    if (match) {
      claimed.add(match.lesson.lessonId);
      approvedForLesson.set(match.lesson.lessonId, scene);
      continue;
    }
    const best = chapters.reduce((selected, chapter, index) => {
      const photoIds = new Set(chapter.lessons.flatMap((lesson) => lesson.photoIds));
      const overlap = scene.photoIds.filter((id) => photoIds.has(id)).length;
      return overlap > selected.overlap ? { index, overlap } : selected;
    }, { index: 0, overlap: 0 });
    unmatched.set(best.index, [...(unmatched.get(best.index) ?? []), scene]);
  }

  let timelineOrder = 0;
  const result = chapters.map((chapter, index): Book['chapters'][number] => {
    const chapterId = `chap-gf-${book.id}-${index + 1}`;
    const section = (title: string, body: string, goal: string, topics: string[], order: number, idea?: BookIdea): Section => {
      const id = `sec-gf-${book.id}-${index + 1}-${order}`;
      const summary = [idea?.text, goal].filter(Boolean).join('\n\n');
      const nameTokens = (value: string) => value.normalize('NFC').toLocaleLowerCase('uk').match(/[\p{L}\p{N}]+/gu)?.join(' ');
      const text = ` ${nameTokens(`${title} ${summary} ${body}`) ?? ''} `;
      const cast = characters.filter(({ name }) => {
        const normalized = nameTokens(name);
        return !!normalized && text.includes(` ${normalized} `);
      });
      return {
        id, chapterId, title, order, content: body ? buildDescriptionDraft(body) : '',
        wordCount: descriptionWordCount(body), lastModified: book.updatedAt,
        scene: {
          id: idea ? `scene-gf-${idea.id}` : `scene-${id}`, sectionId: id, title: idea?.title ?? title,
          summary, act: 1, location: idea?.location ?? '', timeOfDay: idea?.timeOfDay ?? '',
          timelineOrder: ++timelineOrder, intensityScore: 5, conflict: '', resolution: '',
          characters: cast.map(({ id: characterId }) => ({ characterId, goal: '', emotionalState: '', action: '', conflict: '' })),
          ...(topics.length ? { aiDramaturgyNotes: topics.join(', ') } : {}),
        },
      };
    };
    const sections = chapter.lessons.map((lesson, i) =>
      section(lesson.title, lesson.body?.trim() ?? '', lesson.goal ?? '', lesson.topics, i + 1, approvedForLesson.get(lesson.lessonId)));
    for (const idea of unmatched.get(index) ?? []) {
      sections.push(section(idea.title, '', '', [], sections.length + 1, idea));
    }
    return {
      id: chapterId, bookId: book.id, title: chapter.title, order: index + 1,
      description: chapter.summary ?? undefined, sections,
      cast: [...new Set(sections.flatMap((item) => item.scene?.characters.map((character) => character.characterId) ?? []))],
    };
  });
  const wordCount = result.reduce((total, chapter) => total + chapter.sections.reduce((acc, item) => acc + item.wordCount, 0), 0);
  return {
    ...book, characters, chapters: result,
    versionHistory: book.versionHistory?.map((version) => ({
      ...version, wordCount, chapterCount: result.length,
    })),
  };
}

/**
 * «Набір книги» без наявної книги (журнал #540): Studio САМА створює книгу з розпізнаним текстом (дашборд → «Книга & Текст»),
 * привʼязує фото сторінок до її медіатеки й лишає записи «Вхідних» як історію зі станом `inserted` — вставляти їх ще раз не треба
 * (текст уже в книзі). `null` — сторінки порожні (книги з нічого не робимо), тоді маршрут кладе пакет у «Вхідні», як раніше.
 */
export async function createBookFromManuscript(p: {
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  bookTitle: string;
  chapterTitle: string;
  items: InboxItem[];
  photoChapters?: DraftModule[];
  bookSynopsis?: string | null;
  bookConcept?: string | null;
  bookAudience?: string | null;
  bookIdeas?: BookIdea[];
  tokenId?: string | null;
  batchId: string;
}): Promise<{ bookId: string; chapterTitle: string; pages: number } | null> {
  const text = p.photoChapters
    ? p.photoChapters.flatMap((chapter) => chapter.lessons).find((lesson) => lesson.body?.trim())?.body ?? ''
    : joinManuscriptPages(p.items.map((i) => i.text));
  const photoBookId = p.photoChapters
    ? 'BK-GF-' + createHash('sha256').update(p.ownerId + ':' + p.batchId).digest('hex').slice(0, 24)
    : undefined;
  const previous = photoBookId ? await getBook(photoBookId) : null;
  if (previous && previous.ownerId !== p.ownerId) throw new Error('Немає доступу до книги.');
  const built = buildBookFromManuscript({
    title: p.bookTitle,
    chapterTitle: p.chapterTitle,
    text,
    author: p.ownerName || 'Автор',
    authorRole: p.ownerRole as UserRole,
    now: previous ? Date.parse(previous.createdAt) : Date.now(),
    bookId: photoBookId,
    pageCount: p.items.length,
    photoBook: !!p.photoChapters,
  });
  if (!built) return null;
  let book = built.book;
  if (p.photoChapters) {
    book = importPhotoBook(book, p.photoChapters, p.bookIdeas ?? []);
    const chapterOverviews = p.photoChapters.flatMap((chapter) => {
      const summary = chapter.summary || chapter.lessons.map((lesson) => lesson.goal || lesson.title).filter(Boolean).join(' · ');
      return summary ? [`${chapter.title} — ${summary}`] : [];
    });
    book.synopsis = p.bookSynopsis?.trim() || chapterOverviews.join('\n\n');
    book.logline = (p.bookConcept?.trim() || p.bookSynopsis?.trim() || p.photoChapters[0]?.summary || p.photoChapters[0]?.lessons[0]?.goal || '');
    book.targetAudience = p.bookAudience?.trim() || undefined;
  }
  const saved = previous ?? await saveBook({ book: book as unknown as Record<string, unknown>, ownerId: p.ownerId });
  for (const item of p.items) {
    if (!item.grabFusion) continue;
    const asset = await getAsset(item.assetId);
    if (!asset || asset.ownerId !== p.ownerId || asset.provenance.grabFusion) continue;
    await updateMediaProvenance(asset.id, p.ownerId, asset.provenance.revision, {
      ...asset.provenance, revision: asset.provenance.revision + 1, grabFusion: item.grabFusion,
    });
  }
  await attachAssetsToBook(p.items.map((i) => i.assetId), p.ownerId, saved.id);
  const savedChapters = (saved.book.chapters as Book['chapters'] | undefined) ?? book.chapters;
  const firstChapter = savedChapters[0] ?? book.chapters[0];
  const existingScans = p.photoChapters
    ? new Map((await listScans(p.ownerId, { bookId: saved.id })).filter((scan) => scan.batchId === p.batchId).map((scan) => [scan.batchOrder, scan]))
    : new Map();
  let order = 0;
  for (const item of p.items) {
    order += 1;
    const existing = existingScans.get(order);
    if (existing?.status === 'inserted') continue;
    const scan = existing ?? await createScan({
      ownerId: p.ownerId,
      bookId: saved.id,
      assetId: item.assetId,
      imageUrl: item.imageUrl,
      tokenId: p.tokenId ?? null,
      batch: { id: p.batchId, order, bookTitle: p.bookTitle || null },
    });
    const chapter = item.sourceChapterIndex === undefined ? firstChapter : savedChapters[item.sourceChapterIndex] ?? firstChapter;
    await updateScan(scan.id, p.ownerId, {
      status: 'inserted',
      recognizedText: item.text,
      text: item.text,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      sectionTitle: item.sectionTitle,
      modelId: 'grabfusion',
    });
  }
  return { bookId: saved.id, chapterTitle: firstChapter.title, pages: p.items.length };
}
