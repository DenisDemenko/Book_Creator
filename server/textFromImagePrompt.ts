/**
 * Промпт «Текст за фото» на вкладці «Ілюстрації» — винесено з
 * textFromImage.ts (де `buildPrompt` була приватною функцією) у чистий
 * файл за принципом manuscriptImagePrompt.ts, щоб «Ядро AI» могло
 * показувати й редагувати той самий текст, що реально йде в модель.
 *
 * На відміну від manuscriptImagePrompt.ts, тут немає кількості абзаців чи
 * контексту сусідніх абзаців — це окрема, простіша функція: один
 * фіксований обсяг (200-350 слів), викликається з вкладки «Ілюстрації», а
 * не з правого кліку по фото в тексті розділу.
 */

export interface TextFromImagePromptValues {
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  /** Підказка автора — вільний текст, що спрямовує модель («герой сумний», «зима»). */
  captionHint?: string;
}

/** Системна інструкція — та сама, що вже й для manuscriptImagePrompt.ts (та сама роль: редактор-співавтор). */
export function textFromImageSystemInstruction(): string {
  return 'Ти — професійний український літературний редактор і письменник-співавтор.';
}

/**
 * Заводський шаблон промту користувача. Кожен необов'язковий плейсхолдер —
 * ОКРЕМИЙ абзац, а не частина спільного речення: механіка «зникає, якщо
 * порожньо» діє на рівні цілого абзацу (utils/promptTemplates.ts), тож
 * якщо покласти «жанр» і «розділ» в одне речення з завжди заповненою
 * назвою книги, порожній жанр лишив би по собі биту фразу на кшталт
 * «у жанрі «»» замість того, щоб зникнути цілком.
 */
export function factoryTextFromImageTemplate(): string {
  return [
    'Ти — досвідчений український письменник-співавтор. Перед тобою ілюстрація до книги «{НАЗВА_КНИГИ}».',
    'Жанр: {ЖАНР}.',
    'Розділ: {РОЗДІЛ}.',
    'Підказка від автора: {ПІДКАЗКА}',
    'Уважно роздивись зображення і напиши УКРАЇНСЬКОЮ мовою художній текст сцени (200-350 слів), яку воно ' +
      'ілюструє: що відбувається, атмосфера, деталі, які можна прочитати з картинки. Пиши як фрагмент прози ' +
      'для книги — з абзацами, живими деталями, без списків і без службових приміток. Не додавай заголовків ' +
      'і не пиши нічого, крім самого тексту сцени.',
  ].join('\n\n');
}

/** Підставляє значення в шаблон; абзац, що тримається лише на порожньому плейсхолдері, зникає цілком. */
export function renderTextFromImageTemplate(template: string, values: TextFromImagePromptValues): string {
  const map: Record<string, string | undefined> = {
    '{НАЗВА_КНИГИ}': values.bookTitle?.trim() || 'без назви',
    '{ЖАНР}': values.genre?.trim() || undefined,
    '{РОЗДІЛ}': values.chapterTitle?.trim() || undefined,
    '{ПІДКАЗКА}': values.captionHint?.trim() || undefined,
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

/** Заводська поведінка (без адмінського шаблону) — точна копія колишньої приватної buildPrompt із textFromImage.ts. */
export function buildTextFromImagePrompt(values: TextFromImagePromptValues): string {
  return renderTextFromImageTemplate(factoryTextFromImageTemplate(), values);
}
