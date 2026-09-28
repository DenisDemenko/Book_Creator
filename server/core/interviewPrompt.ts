/**
 * Шаблон і схема модуля «Голос героя (допит)» — `coreCharacterVoice`
 * (Т2.7 В3, рішення власника §6 п.4 `PLAN_INTERVIEW.md`): окремий модуль
 * «Ядра AI» зі своїм шаблоном і моделлю, які адмін обирає окремо від AI-2.
 * Окремо від логіки допиту (`interview.ts`), щоб реєстр «Ядра AI» брав їх
 * без ланцюжка ядра.
 *
 * Модель отримує лише: знімок героя станом на сцену (його пам'ять — лише
 * його, без майбутнього), рішення Jev на цей хід, історію цього допиту й
 * питання автора. Пише відповідь від першої особи; результати для канону —
 * лише пропозиції (автор приймає окремо, В4).
 */

export const CHARACTER_VOICE_MODULE = 'coreCharacterVoice' as const;
export const CHARACTER_VOICE_PLACEHOLDERS = ['{ГЕРОЙ}', '{ЗНІМОК}', '{РІШЕННЯ}', '{ІСТОРІЯ}', '{ПИТАННЯ}', '{НОТАТКА}', '{МОВА}'];

const CONTRACT = `⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ
Поверни ЛИШЕ JSON-об'єкт без пояснень і без markdown:
{
  "reply": "відповідь героя від першої особи, 1–6 речень",
  "intent": "намір героя в цій відповіді одним реченням (для автора, не для героя)",
  "proposals": {
    "memories": [ { "type": "recollection | belief | consequence", "content": "що герой після цієї розмови пам'ятає чи в що вірить — від третьої особи" } ],
    "facts": [ { "statement": "факт про героя, який ця відповідь вигадала чи уточнила (гіпотеза, не канон)" } ],
    "fragment": { "text": "чистий фрагмент прози для книги за цією відповіддю, без тегів", "tags": ["[/emotion:… @Ім'я]", "…"] }
  }
}
proposals — необов'язкові: лише те, що справді варте авторового рішення (не більше 3 спогадів і 3 фактів).
Теги — лише в полі tags (у тексті фрагмента їх немає), у форматі тегів книги: [/тип:назва @Ім'я].`;

export function factoryCharacterVoiceTemplate(): { system: string; user: string } {
  return {
    system: `Ти — голос героя книги «{ГЕРОЙ}» на допиті в автора. Відповідай ВІД ПЕРШОЇ ОСОБИ, як сказав би цей герой, мовою {МОВА}.
Правила:
- Знаєш лише те, що є у знімку героя нижче (його канон, підтверджені факти, стани, стосунки, пам'ять — переконання можуть бути хибними, це його правда). Про пізніші події й чужі таємниці ти не знаєш нічого — не вигадуй і не натякай.
- Дотримуйся рішення, яке для героя ухвалено на цей хід (дія, мотив, страх): якщо рішення «ухилитися» — ухиляйся, «збрехати» — бреши так, як збрехав би цей герой.
- Пам'ятай попередні відповіді цього допиту й не суперечи їм, якщо рішення не велить інакше.
- Це дослідницька розмова, не канон книги: нічого не стверджуй як факт світу поза знімком.
{НОТАТКА}

${CONTRACT}`,
    user: `Знімок героя станом на цю сцену:
{ЗНІМОК}

Рішення на цей хід (Jev):
{РІШЕННЯ}

Попередні ходи цього допиту:
{ІСТОРІЯ}

Питання автора: {ПИТАННЯ}`,
  };
}

export interface CharacterVoiceFields {
  hero?: string;
  snapshot?: string;
  decision?: string;
  history?: string;
  question?: string;
  note?: string;
  language?: string;
}

function fill(text: string, f: CharacterVoiceFields): string {
  return text
    .replaceAll('{ГЕРОЙ}', (f.hero || '').trim() || 'герой')
    .replaceAll('{ЗНІМОК}', (f.snapshot || '').trim() || '(порожньо)')
    .replaceAll('{РІШЕННЯ}', (f.decision || '').trim() || '(рішення немає — відповідай за знімком)')
    .replaceAll('{ІСТОРІЯ}', (f.history || '').trim() || '(це перше питання)')
    .replaceAll('{ПИТАННЯ}', (f.question || '').trim() || '(порожньо)')
    .replaceAll('{НОТАТКА}', (f.note || '').trim() ? `- Нотатка автора про голос героя: ${(f.note || '').trim()}` : '')
    .replaceAll('{МОВА}', (f.language || '').trim() || 'українська');
}

export function renderCharacterVoiceTemplate(template: { system: string; user: string }, f: CharacterVoiceFields) {
  return { system: fill(template.system, f), user: fill(template.user, f) };
}

export const CHARACTER_VOICE_SCHEMA = {
  type: 'object',
  required: ['reply'],
  additionalProperties: true,
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: 4000 },
    intent: { type: 'string', maxLength: 500 },
    proposals: {
      type: 'object',
      additionalProperties: true,
      properties: {
        memories: {
          type: 'array',
          maxItems: 5,
          items: { type: 'object', required: ['content'], additionalProperties: true, properties: { type: { type: 'string', maxLength: 40 }, content: { type: 'string', minLength: 1, maxLength: 2000 } } },
        },
        facts: {
          type: 'array',
          maxItems: 5,
          items: { type: 'object', required: ['statement'], additionalProperties: true, properties: { statement: { type: 'string', minLength: 1, maxLength: 1000 } } },
        },
        fragment: {
          type: 'object',
          additionalProperties: true,
          properties: { text: { type: 'string', maxLength: 6000 }, tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 } } },
        },
      },
    },
  },
} as const;
