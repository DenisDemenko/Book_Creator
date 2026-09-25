/**
 * Шаблон і схема `searchInterpret` (Т1.3) — окремо від логіки, щоб реєстр
 * «Ядра AI» (coreAiRegistry.ts) брав їх без ланцюжка пошуку. Що робить
 * модуль — див. `interpret.ts`.
 */

export const SEARCH_INTERPRET_MODULE = 'coreSearchInterpret' as const;
export const SEARCH_INTERPRET_PLACEHOLDERS = ['{ЗАПИТ}', '{СУТНОСТІ}', '{ГЛАВИ}', '{МОВА}'];

const CONTRACT = `⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ
Поверни ЛИШЕ JSON-об'єкт без пояснень і без markdown:
{
  "text": "слова запиту для пошуку в тексті, БЕЗ імен і назв, які ти виніс у entities (може бути порожнім рядком)",
  "entities": [
    { "type": "тип сутності з переліку (character, emotion, scene, event, location…)", "name": "назва ТОЧНО як у переліку відомих сутностей" }
  ],
  "chapters": [номери глав з переліку, лише якщо запит їх прямо називає],
  "status": "any | confirmed | suggested"
}
Правила: сутності — лише ті, що названі або однозначно мають на увазі в запиті; назви — з переліку відомих.
Якщо сутності немає в переліку, але запит її явно називає — все одно поверни її з назвою як у запиті.
status: "confirmed" — якщо автор просить лише підтверджене, "suggested" — лише запропоноване ШІ, інакше "any".
Не відповідай на запит і не вигадуй нічого про книгу.`;

export function factorySearchInterpretTemplate(): { system: string; user: string } {
  return {
    system: `Ти — AI-2 письменницької студії в ролі тлумача пошукового запиту.
Автор шукає абзаци у своїй книзі й пише запит звичайною мовою. Твоя робота — ЛИШЕ розкласти запит на фільтри:
сутності книги (персонажі, емоції, сцени, події, місця…), номери глав і слова для пошуку в тексті.
Ти не відповідаєш на запит і не знаєш змісту книги — пошук зробить система, а автор побачить знайдені абзаци.
Відповідай мовою {МОВА}.

${CONTRACT}`,
    user: `Запит автора: {ЗАПИТ}

Відомі сутності книги (тип: назва):
{СУТНОСТІ}

Глави книги (номер. назва):
{ГЛАВИ}`,
  };
}

export interface SearchInterpretFields {
  query?: string;
  entities?: string;
  chapters?: string;
  language?: string;
}

function fill(text: string, f: SearchInterpretFields): string {
  return text
    .replaceAll('{ЗАПИТ}', (f.query || '').trim() || '(порожньо)')
    .replaceAll('{СУТНОСТІ}', (f.entities || '').trim() || '(поки немає)')
    .replaceAll('{ГЛАВИ}', (f.chapters || '').trim() || '(немає)')
    .replaceAll('{МОВА}', (f.language || '').trim() || 'українська');
}

export function renderSearchInterpretTemplate(template: { system: string; user: string }, f: SearchInterpretFields) {
  return { system: fill(template.system, f), user: fill(template.user, f) };
}

export const SEARCH_INTERPRET_SCHEMA = {
  type: 'object',
  required: ['text', 'entities'],
  additionalProperties: true,
  properties: {
    text: { type: 'string', maxLength: 500 },
    entities: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['type', 'name'],
        additionalProperties: true,
        properties: { type: { type: 'string', maxLength: 60 }, name: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
    chapters: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1, maximum: 10000 } },
    status: { type: 'string', enum: ['any', 'confirmed', 'suggested'] },
  },
} as const;

