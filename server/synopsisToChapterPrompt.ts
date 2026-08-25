/**
 * Промпт «Синопсис → глава» — НОВИЙ модуль (не існував до появи «Ядра AI»).
 *
 * Задум: автор пише короткий синопсис майбутньої глави (кілька речень
 * плану), модель розгортає його в чернетку прозового тексту. За рішенням,
 * прийнятим у grilling-сесії, — сьогодні це ЛИШЕ адмінський пункт
 * конструктора: шаблон + серверний маршрут, що реально викликає модель, але
 * БЕЗ жодної кнопки в інтерфейсі письменника. Прив'язку до UI виносимо в
 * окреме майбутнє завдання, коли промт буде доведено до потрібної якості —
 * тюнити текст інструкції має сенс ДО того, як під нього будується
 * інтерфейс, інакше довелося б переробляти і те, і те одночасно.
 *
 * Побудований за тим самим принципом, що й manuscriptImagePrompt.ts:
 * звичайний текстовий вихід (не JSON), плейсхолдери зникають абзацом, якщо
 * даних нема.
 */

export interface SynopsisToChapterPromptValues {
  synopsis: string;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  styleGuide?: string;
  /** Орієнтовний обсяг глави в словах (напр. «1500-2500»). */
  wordBudget?: string;
}

const MAX_STYLE_GUIDE_CHARS = 3000;
const MAX_SYNOPSIS_CHARS = 4000;

export function synopsisToChapterSystemInstruction(): string {
  return 'Ти — досвідчений український письменник-співавтор, що перетворює план глави на прозовий текст.';
}

/** Заводський шаблон промту користувача — плейсхолдери зникають своїм абзацом, якщо даних нема. */
export function factorySynopsisToChapterTemplate(): string {
  return [
    // {ЖАНР} і {РОЗДІЛ} — ОКРЕМІ абзаци, не частина речення з завжди
    // заповненою {НАЗВА_КНИГИ}: інакше порожній жанр лишив би по собі
    // биту фразу «у жанрі «»» замість того, щоб зникнути цілком.
    'Перед тобою синопсис (короткий план) глави книги «{НАЗВА_КНИГИ}».',
    'Жанр: {ЖАНР}.',
    'Розділ: {РОЗДІЛ}.',
    'Ось аналіз авторського стилю цього письменника — пиши СУВОРО в цій манері, зберігаючи лексику, ' +
      'ритм речень і характерні звороти:\n"""\n{СТИЛЬ}\n"""',
    'СИНОПСИС ГЛАВИ:\n"""\n{СИНОПСИС}\n"""',
    'Розгорни цей синопсис у прозовий текст глави УКРАЇНСЬКОЮ мовою, орієнтовний обсяг — {ОБСЯГ} слів. ' +
      'Дотримуйся сюжетних подій із синопсису в тому ж порядку, додай художні деталі, діалоги й атмосферу, ' +
      'де це доречно. Пиши як фрагмент готового тексту книги: без заголовків, без списків, без службових ' +
      'приміток чи пояснень — лише сам текст, готовий для вставки в рукопис. Розділяй абзаци порожнім рядком.',
  ].join('\n\n');
}

/** Підставляє значення; абзац, що тримається лише на порожньому плейсхолдері, зникає цілком. */
export function renderSynopsisToChapterTemplate(template: string, values: SynopsisToChapterPromptValues): string {
  const map: Record<string, string | undefined> = {
    '{НАЗВА_КНИГИ}': values.bookTitle?.trim() || 'без назви',
    '{ЖАНР}': values.genre?.trim() || undefined,
    '{РОЗДІЛ}': values.chapterTitle?.trim() || undefined,
    '{СТИЛЬ}': values.styleGuide?.trim().slice(0, MAX_STYLE_GUIDE_CHARS) || undefined,
    '{СИНОПСИС}': values.synopsis?.trim().slice(0, MAX_SYNOPSIS_CHARS) || '',
    '{ОБСЯГ}': values.wordBudget?.trim() || '800-1500',
  };

  const paragraphs = template.split(/\n{2,}/);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const tokens = Object.keys(map).filter((tk) => paragraph.includes(tk));
    const missing = tokens.filter((tk) => map[tk] === undefined);
    if (tokens.length > 0 && missing.length === tokens.length) continue;
    let text = paragraph;
    for (const tk of tokens) text = text.split(tk).join(map[tk] ?? '');
    kept.push(text.trim());
  }
  return kept.filter(Boolean).join('\n\n');
}

/** Заводська поведінка (без адмінського шаблону). */
export function buildSynopsisToChapterPrompt(values: SynopsisToChapterPromptValues): { system: string; user: string } {
  return {
    system: synopsisToChapterSystemInstruction(),
    user: renderSynopsisToChapterTemplate(factorySynopsisToChapterTemplate(), values),
  };
}
