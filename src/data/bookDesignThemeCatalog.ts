import type { Book } from '../types';

export type BookDesignThemeId =
  | 'classic'
  | 'modern-fiction'
  | 'sci-fi'
  | 'fantasy'
  | 'dark-fantasy'
  | 'thriller'
  | 'noir-detective'
  | 'romance'
  | 'poetry-literary'
  | 'non-fiction'
  | 'academic-research'
  | 'business-premium'
  | 'children'
  | 'graphic-story'
  | 'experimental-art';

export type BookDesignThemeCategory =
  | 'fiction'
  | 'genre-fiction'
  | 'literary'
  | 'non-fiction'
  | 'academic'
  | 'children'
  | 'visual';

export interface BookDesignThemeCard {
  id: BookDesignThemeId;
  label: string;
  taglineUk: string;
  category: BookDesignThemeCategory;
  recommendedFor: readonly string[];
  preview: {
    chapterNumber: 'quiet' | 'display' | 'technical' | 'ornamental';
    align: 'left' | 'center';
    accent: 'serif' | 'sans' | 'mono';
    sceneBreak: string;
  };
}

export interface BookDesignRecommendation {
  themeId: BookDesignThemeId;
  score: number;
  reasonsUk: string[];
}

/**
 * Client-safe public catalog. It mirrors public ids from the DesignCraft
 * server theme system, but deliberately contains no renderer implementation.
 * This lets the writer browse themes without bundling server/pdf into Vite.
 */
export const BOOK_DESIGN_THEME_CARDS: readonly BookDesignThemeCard[] = [
  { id: 'classic', label: 'Classic', taglineUk: 'Літературна класика, епіграф і спокійний книжковий ритм.', category: 'fiction', recommendedFor: ['класичний роман', 'історична проза', 'мемуари'], preview: { chapterNumber: 'quiet', align: 'center', accent: 'serif', sceneBreak: '❦' } },
  { id: 'modern-fiction', label: 'Modern Fiction', taglineUk: 'Сучасна проза з великим номером глави та повітряною асиметрією.', category: 'fiction', recommendedFor: ['сучасний роман', 'психологічна проза', 'міська проза'], preview: { chapterNumber: 'display', align: 'left', accent: 'sans', sceneBreak: '· · ·' } },
  { id: 'sci-fi', label: 'Sci‑Fi', taglineUk: 'Локація, час, системні повідомлення та технологічна типографіка.', category: 'genre-fiction', recommendedFor: ['science fiction', 'кіберпанк', 'технотрилер', 'космічна опера'], preview: { chapterNumber: 'technical', align: 'left', accent: 'mono', sceneBreak: '◇' } },
  { id: 'fantasy', label: 'Fantasy', taglineUk: 'Міфологічний характер, легенди, епіграфи й декоративні переходи.', category: 'genre-fiction', recommendedFor: ['fantasy', 'фентезі', 'міфологія', 'пригоди'], preview: { chapterNumber: 'ornamental', align: 'center', accent: 'serif', sceneBreak: '✦' } },
  { id: 'dark-fantasy', label: 'Dark Fantasy', taglineUk: 'Похмуріший ритм, пророцтва та виразні внутрішні монологи.', category: 'genre-fiction', recommendedFor: ['dark fantasy', 'horror', 'готичний роман'], preview: { chapterNumber: 'ornamental', align: 'left', accent: 'serif', sceneBreak: '†' } },
  { id: 'thriller', label: 'Thriller', taglineUk: 'Швидкий темп, дата/час/локація, повідомлення та доказові блоки.', category: 'genre-fiction', recommendedFor: ['трилер', 'кримінальна проза', 'шпигунський роман'], preview: { chapterNumber: 'technical', align: 'left', accent: 'sans', sceneBreak: '— • —' } },
  { id: 'noir-detective', label: 'Noir / Detective', taglineUk: 'Кінематографічна стриманість, досьє, записки та докази.', category: 'genre-fiction', recommendedFor: ['детектив', 'noir', 'mystery'], preview: { chapterNumber: 'display', align: 'left', accent: 'sans', sceneBreak: '◆' } },
  { id: 'romance', label: 'Romance', taglineUk: 'М’яка емоційна система для листів, спогадів і внутрішньої мови.', category: 'genre-fiction', recommendedFor: ['романтика', 'любовний роман', 'сімейна сага'], preview: { chapterNumber: 'quiet', align: 'center', accent: 'serif', sceneBreak: '♡' } },
  { id: 'poetry-literary', label: 'Poetry / Literary', taglineUk: 'Білий простір, гнучкий ритм і сильна авторська пауза.', category: 'literary', recommendedFor: ['поезія', 'есе', 'літературна проза'], preview: { chapterNumber: 'quiet', align: 'center', accent: 'serif', sceneBreak: '⁂' } },
  { id: 'non-fiction', label: 'Non‑fiction', taglineUk: 'Чітка ієрархія, тези, приклади й зручне сканування сторінки.', category: 'non-fiction', recommendedFor: ['популярна наука', 'психологія', 'освітня книга', 'довідник'], preview: { chapterNumber: 'quiet', align: 'left', accent: 'sans', sceneBreak: '—' } },
  { id: 'academic-research', label: 'Academic / Research', taglineUk: 'Нумерація, цитати, виноски та дисциплінована академічна подача.', category: 'academic', recommendedFor: ['дослідження', 'монографія', 'навчальний посібник'], preview: { chapterNumber: 'quiet', align: 'left', accent: 'serif', sceneBreak: '§' } },
  { id: 'business-premium', label: 'Business / Premium', taglineUk: 'Преміальна executive-подача з кейсами та ключовими ідеями.', category: 'non-fiction', recommendedFor: ['бізнес', 'менеджмент', 'стартапи', 'self-development'], preview: { chapterNumber: 'display', align: 'left', accent: 'sans', sceneBreak: '—' } },
  { id: 'children', label: 'Children', taglineUk: 'Великий дружній набір, короткі рядки та більше місця для ілюстрацій.', category: 'children', recommendedFor: ['дитяча книга', 'раннє читання', 'освітня історія'], preview: { chapterNumber: 'display', align: 'center', accent: 'sans', sceneBreak: '✦' } },
  { id: 'graphic-story', label: 'Graphic Story', taglineUk: 'Великі зображення, scene cards, captions і візуальний темп.', category: 'visual', recommendedFor: ['графічна історія', 'артбук', 'візуальний роман'], preview: { chapterNumber: 'display', align: 'left', accent: 'sans', sceneBreak: '▰' } },
  { id: 'experimental-art', label: 'Experimental / Art Book', taglineUk: 'Нестандартні розвороти, великі цитати й мінливий ритм сторінки.', category: 'visual', recommendedFor: ['артбук', 'фото-книга', 'експериментальна проза'], preview: { chapterNumber: 'display', align: 'left', accent: 'sans', sceneBreak: '○' } },
] as const;

const WORD_RULES: ReadonlyArray<{
  words: readonly string[];
  scores: Partial<Record<BookDesignThemeId, number>>;
  reasonUk: string;
}> = [
  { words: ['sci-fi', 'science fiction', 'кібер', 'косм', 'майбут', 'робот', 'андроїд', 'штучн', 'технолог'], scores: { 'sci-fi': 8, 'modern-fiction': 3, thriller: 2 }, reasonUk: 'У книзі є технологічні або футуристичні мотиви.' },
  { words: ['фентезі', 'fantasy', 'магі', 'чакл', 'дракон', 'королів', 'міф', 'легенд'], scores: { fantasy: 8, 'dark-fantasy': 3, classic: 2 }, reasonUk: 'У книзі є фантастичний або міфологічний світ.' },
  { words: ['жах', 'horror', 'темн', 'демон', 'проклят', 'готич'], scores: { 'dark-fantasy': 7, thriller: 3, 'experimental-art': 1 }, reasonUk: 'Атмосфера книги тяжіє до темної жанрової прози.' },
  { words: ['трилер', 'thriller', 'шпиг', 'небезп', 'переслід', 'злочин'], scores: { thriller: 8, 'noir-detective': 4, 'modern-fiction': 2 }, reasonUk: 'Сюжет має напружений або кримінальний характер.' },
  { words: ['детектив', 'detective', 'mystery', 'розсліду', 'доказ', 'вбив'], scores: { 'noir-detective': 8, thriller: 4, classic: 1 }, reasonUk: 'Структура нагадує детектив або розслідування.' },
  { words: ['романтик', 'кохан', 'любов', 'relationship', 'romance'], scores: { romance: 8, 'modern-fiction': 3, classic: 1 }, reasonUk: 'Емоційні стосунки є важливим центром книги.' },
  { words: ['вірш', 'поез', 'poetry', 'есе'], scores: { 'poetry-literary': 9, 'experimental-art': 3, classic: 2 }, reasonUk: 'Текст тяжіє до поезії, есеїстики або літературного експерименту.' },
  { words: ['бізнес', 'business', 'менедж', 'стартап', 'продаж', 'маркетинг', 'підприєм'], scores: { 'business-premium': 9, 'non-fiction': 5, 'academic-research': 1 }, reasonUk: 'Книга має бізнесову або практичну спрямованість.' },
  { words: ['дослідж', 'research', 'науков', 'академ', 'монограф', 'методолог'], scores: { 'academic-research': 9, 'non-fiction': 5, 'business-premium': 1 }, reasonUk: 'Книга має наукову або дослідницьку структуру.' },
  { words: ['дитяч', 'children', 'казка', 'для дітей', 'школяр'], scores: { children: 9, 'graphic-story': 5, fantasy: 2 }, reasonUk: 'Цільова аудиторія або жанр орієнтовані на дітей.' },
  { words: ['мемуар', 'історич', 'біограф', 'спогад'], scores: { classic: 7, 'modern-fiction': 3, 'poetry-literary': 1 }, reasonUk: 'Книзі пасує традиційна літературна подача.' },
];

function normalize(value: unknown): string {
  return String(value || '').toLocaleLowerCase('uk-UA');
}

function searchableBookText(book: Book): string {
  const chapterTitles = (book.chapters || []).map((chapter) => chapter.title || '').join(' ');
  return normalize([
    book.genre,
    book.targetAudience,
    book.synopsis,
    book.logline,
    book.theme,
    chapterTitles,
  ].join(' '));
}

/**
 * Fast deterministic first pass. It is explainable and stable: changing a
 * prompt/model cannot reshuffle the writer's recommended templates.
 * AI recommendations can be layered above this later, but never replace it.
 */
export function recommendBookDesignThemes(book: Book, limit = 3): BookDesignRecommendation[] {
  const scores = new Map<BookDesignThemeId, BookDesignRecommendation>();
  for (const card of BOOK_DESIGN_THEME_CARDS) {
    scores.set(card.id, { themeId: card.id, score: 0, reasonsUk: [] });
  }

  const text = searchableBookText(book);
  for (const rule of WORD_RULES) {
    if (!rule.words.some((word) => text.includes(normalize(word)))) continue;
    for (const [themeId, points] of Object.entries(rule.scores) as Array<[BookDesignThemeId, number]>) {
      const item = scores.get(themeId)!;
      item.score += points;
      if (!item.reasonsUk.includes(rule.reasonUk)) item.reasonsUk.push(rule.reasonUk);
    }
  }

  const illustrationCount = book.illustrations?.length || 0;
  if (illustrationCount >= Math.max(4, (book.chapters?.length || 1) / 2)) {
    for (const [themeId, points] of [['graphic-story', 3], ['children', 2], ['experimental-art', 2]] as Array<[BookDesignThemeId, number]>) {
      const item = scores.get(themeId)!;
      item.score += points;
      item.reasonsUk.push('У книзі багато ілюстрацій, тому важливий сильний візуальний ритм.');
    }
  }

  if ((book.footnotes?.length || 0) >= 3) {
    for (const [themeId, points] of [['academic-research', 3], ['non-fiction', 2], ['classic', 1]] as Array<[BookDesignThemeId, number]>) {
      const item = scores.get(themeId)!;
      item.score += points;
      item.reasonsUk.push('У книзі активно використовуються виноски.');
    }
  }

  // A neutral literary fallback guarantees useful suggestions even when the
  // author has not filled genre/synopsis yet.
  scores.get('modern-fiction')!.score += 1.2;
  scores.get('classic')!.score += 1;
  scores.get('non-fiction')!.score += /посіб|гайд|як |how to|інструк/i.test(text) ? 2 : 0.2;

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score || BOOK_DESIGN_THEME_CARDS.findIndex((x) => x.id === a.themeId) - BOOK_DESIGN_THEME_CARDS.findIndex((x) => x.id === b.themeId))
    .slice(0, Math.max(1, limit))
    .map((item) => ({
      ...item,
      reasonsUk: item.reasonsUk.length ? item.reasonsUk : ['Універсальний варіант, який добре працює як стартова точка.'],
    }));
}

export function getBookDesignThemeCard(id: BookDesignThemeId): BookDesignThemeCard {
  return BOOK_DESIGN_THEME_CARDS.find((theme) => theme.id === id) || BOOK_DESIGN_THEME_CARDS[0];
}
