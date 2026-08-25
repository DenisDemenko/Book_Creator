/**
 * Промпт AI-асистента письменника (чат-сесія) — винесено з chatRoutes.ts
 * у чистий файл за тим самим принципом, що й manuscriptImagePrompt.ts:
 * жодних роутів, жодного стану, лише побудова тексту, яку може
 * використовувати і сервер (реальний виклик), і клієнт-адмін
 * («Ядро AI» → живий перегляд і тестовий виклик, server/promptTemplates.ts).
 *
 * `buildPromptContext` НЕ шаблонізується — це протокол передачі історії
 * розмови моделі («Автор: … / Асистент: …», ковзне вікно останніх N
 * реплік), а не текст-інструкція. Ламати його редагуванням у конструкторі
 * небезпечно: результат розбирає МОДЕЛЬ, а не читає людина.
 */

/** Скільки останніх реплік віддаємо моделі як контекст. */
export const CONTEXT_WINDOW_MESSAGES = 20;

/**
 * Збирає контекст для моделі — «ковзне вікно останніх N реплік», а не вся
 * історія: вартість запиту росте лінійно з довжиною контексту, тож
 * віддавати сесію на 200 повідомлень цілком означало б платити за неї
 * щоразу. N=20 покриває практичну глибину посилань у розмові («а що ти
 * казав про Олену?»).
 */
export function buildPromptContext(
  history: { role: 'user' | 'assistant'; content: string }[],
  newMessage: string
): string {
  const window = history.slice(-CONTEXT_WINDOW_MESSAGES);
  const transcript = window
    .map((m) => `${m.role === 'user' ? 'Автор' : 'Асистент'}: ${m.content}`)
    .join('\n');
  return transcript ? `${transcript}\n\nНова репліка автора: ${newMessage}` : `Автор: ${newMessage}`;
}

/** Значення, які підставляються в редагований шаблон системної інструкції чату. */
export interface ChatSystemPromptValues {
  /**
   * `modelLabel` — з'явився після реального бага: автор перемкнув модель
   * посеред розмови, а нова модель побачила в контексті репліку
   * попередньої моделі, де та назвала себе («Я — Claude від Anthropic»), і
   * за інерцією продовжила видавати себе за неї. Явне нагадування «ти
   * зараз саме ця модель» прибирає цю плутанину.
   */
  modelLabel?: string;
  styleGuide?: string;
  bookTitle?: string;
  bookGenre?: string;
  bookSynopsis?: string;
}

/** Ліміт файлу стилю в системному промпті — той самий, що й у решті AI-ядра. */
const MAX_STYLE_GUIDE_CHARS = 3000;
const MAX_SYNOPSIS_CHARS = 500;

/**
 * Заводський шаблон системного промту чату — редагований адміном текст
 * («Ядро AI»). Головна інструкція + три плейсхолдери, кожен зникає своїм
 * абзацом, якщо даних нема (та сама механіка, що в manuscriptImagePrompt).
 */
export function factoryChatSystemTemplate(): string {
  return [
    'Ти помічник письменника. Відповідай лаконічно, ділово й натхненно, українською мовою.',
    'Зараз тебе викликано як модель «{МОВА_МОДЕЛІ}». Якщо в попередній історії розмови нижче репліка ' +
      'асистента називає себе іншою моделлю чи іншим провайдером — це залишок від попереднього вибору ' +
      'автора в цій самій розмові, а НЕ твоя ідентичність. Відповідай від імені «{МОВА_МОДЕЛІ}» і не ' +
      'повторюй чужого самоназивання.',
    'Ось файл стилю автора — враховуй його в порадах:\n{СТИЛЬ}',
    'Книга автора: «{НАЗВА_КНИГИ}» (жанр: {ЖАНР}). Синопсис: {СИНОПСИС}',
  ].join('\n\n');
}

/**
 * Підставляє значення в шаблон системного промту чату. Абзац, що тримається
 * лише на порожньому плейсхолдері, викидається цілком — та сама поведінка,
 * що й `renderTemplate` у promptTemplates.ts (навмисно та сама механіка,
 * інша функція — бо плейсхолдери тут інші й специфічні для чату).
 */
export function renderChatSystemTemplate(template: string, values: ChatSystemPromptValues): string {
  const map: Record<string, string | undefined> = {
    '{МОВА_МОДЕЛІ}': values.modelLabel?.trim() || undefined,
    '{СТИЛЬ}': values.styleGuide?.trim().slice(0, MAX_STYLE_GUIDE_CHARS) || undefined,
    '{НАЗВА_КНИГИ}': values.bookTitle?.trim() || undefined,
    // Без дефолту "не вказано": з ним плейсхолдер ніколи не «зникає», і
    // весь абзац про книгу лишався б навіть без назви книги взагалі —
    // та сама вакансуюча механіка, що й у решти плейсхолдерів.
    '{ЖАНР}': values.bookGenre?.trim() || undefined,
    '{СИНОПСИС}': values.bookSynopsis?.trim().slice(0, MAX_SYNOPSIS_CHARS) || undefined,
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

/** Заводська поведінка (без адмінського шаблону) — точна копія того, що chatRoutes.ts робив до появи «Ядра AI». */
export function buildSystemPrompt(
  styleGuide: string | null,
  bookContext?: { title?: string; genre?: string; synopsis?: string },
  modelLabel?: string
): string {
  return renderChatSystemTemplate(factoryChatSystemTemplate(), {
    modelLabel,
    styleGuide: styleGuide || undefined,
    bookTitle: bookContext?.title,
    bookGenre: bookContext?.genre,
    bookSynopsis: bookContext?.synopsis,
  });
}
