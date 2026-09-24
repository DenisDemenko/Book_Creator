/**
 * Три ролі AI семантичного ядра (Т0.9, ТЗ-11 13.2; план — PLAN_ENTITY_FEATURES §5).
 *
 *   AI-1 · класифікація — згадки сутностей в абзацах, зіставлення з наявними
 *          сутностями, первинні зв'язки;
 *   AI-2 · спеціалізований аналіз — персонаж, емоції, безперервність, стиль,
 *          переклад, тлумачення запиту (конкретне завдання задає викликач);
 *   AI-3 · візуальний аналіз — ознаки зовнішності, предмети, локації на
 *          зображенні, порівняння з описом.
 *
 * Кожна роль — ОКРЕМИЙ модуль «Ядра AI» (вкладка адміна): свій шаблон і своя
 * модель (`resolveModuleModelId`), тож роль замінюється незалежно; на MVP усі
 * три можуть іти на одній моделі з різними інструкціями.
 *
 * Відповідь усіх трьох — один договір (JSON нижче): список висновків, кожен
 * із доказом — id абзаців із вхідних даних (або id зображень для AI-3). Схема
 * перевіряється на сервері (`schema.ts`), і доказ звіряється з тим, що модель
 * справді отримала: висновок, що посилається на абзац, якого не було на вході,
 * не зберігається — хоч би що було написано в інструкції моделі.
 */

export type CoreAiRoleModule = 'coreAi1Classify' | 'coreAi2Analysis' | 'coreAi3Visual';

export const CORE_AI_ROLE_MODULE = {
  'AI-1': 'coreAi1Classify',
  'AI-2': 'coreAi2Analysis',
  'AI-3': 'coreAi3Visual',
} as const satisfies Record<'AI-1' | 'AI-2' | 'AI-3', CoreAiRoleModule>;

/** Плейсхолдери — однакові для трьох ролей. */
export const CORE_AI_ROLE_PLACEHOLDERS = ['{ЗАВДАННЯ}', '{АБЗАЦИ}', '{ЗОБРАЖЕННЯ}', '{МОВА}'];

/** Маркер жорсткого контракту — той самий, що в решти модулів ядра (coreAiRegistry.ts). */
const CONTRACT = `⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ
Поверни ЛИШЕ JSON-об'єкт без пояснень і без markdown:
{
  "findings": [
    {
      "kind": "коротка назва виду висновку латиницею, напр. mention, trait, emotion, relation, inconsistency, visual_feature",
      "entity_type": "тип сутності з реєстру ядра без слеша (character, emotion, location…), якщо висновок про сутність",
      "entity_name": "назва сутності так, як у тексті",
      "summary": "висновок одним-двома реченнями",
      "paragraph_ids": ["id абзаців із вхідних даних, на яких тримається висновок"],
      "image_ids": ["id зображень із вхідних даних (лише для візуального аналізу)"],
      "quote": "дослівна коротка цитата-доказ, якщо є",
      "confidence": 0.0,
      "insufficient_data": false
    }
  ]
}
Правила: кожен висновок має доказ — paragraph_ids або image_ids ЛИШЕ з тих, що є у вхідних даних.
Якщо доказу немає — "insufficient_data": true і порожні списки. Нічого не вигадуй.
confidence — від 0 до 1. Порожній список findings — нормальна відповідь.`;

const SYSTEM: Record<CoreAiRoleModule, string> = {
  coreAi1Classify: `Ти — AI-1, класифікатор семантичного ядра письменницької студії.
Твоя робота — знайти в абзацах книги згадки сутностей (персонажі, місця, події, емоції, цілі, предмети…),
зіставити їх з уже відомими сутностями і помітити очевидні первинні зв'язки між ними.
Ти лише ПРОПОНУЄШ: автор підтверджує або відхиляє кожен висновок. Ти не оцінюєш якість тексту й не переписуєш його.
Відповідай мовою {МОВА}.

${CONTRACT}`,
  coreAi2Analysis: `Ти — AI-2, аналітик семантичного ядра письменницької студії.
Ти виконуєш одне конкретне завдання аналізу (воно нижче): персонаж, емоції, безперервність, стиль, переклад
чи тлумачення запиту — і спираєшся ЛИШЕ на подані абзаци.
Ти лише ПРОПОНУЄШ: автор підтверджує або відхиляє кожен висновок; затверджене автором ти не змінюєш.
Відповідай мовою {МОВА}.

${CONTRACT}`,
  coreAi3Visual: `Ти — AI-3, візуальний аналітик семантичного ядра письменницької студії.
Ти розглядаєш ілюстрації книги: ознаки зовнішності персонажів, предмети, локації; пропонуєш зв'язки з сутностями
й порівнюєш зображення з описом у тексті, якщо абзаци подано.
Ти лише ПРОПОНУЄШ: автор підтверджує або відхиляє кожен висновок.
Відповідай мовою {МОВА}.

${CONTRACT}`,
};

const USER = `Завдання:
{ЗАВДАННЯ}

Абзаци книги (у квадратних дужках — id абзацу, на нього й посилайся):
{АБЗАЦИ}

Зображення (id і опис):
{ЗОБРАЖЕННЯ}`;

export function factoryCoreAiRoleTemplate(module: CoreAiRoleModule): { system: string; user: string } {
  return { system: SYSTEM[module], user: USER };
}

export interface CoreAiRoleFields {
  task?: string;
  /** Уже відформатовані абзаци: `[id] текст` через порожній рядок. */
  paragraphs?: string;
  images?: string;
  language?: string;
}

function fill(text: string, f: CoreAiRoleFields): string {
  return text
    .replaceAll('{ЗАВДАННЯ}', (f.task || '').trim() || '(не задано)')
    .replaceAll('{АБЗАЦИ}', (f.paragraphs || '').trim() || '(немає)')
    .replaceAll('{ЗОБРАЖЕННЯ}', (f.images || '').trim() || '(немає)')
    .replaceAll('{МОВА}', (f.language || '').trim() || 'українська');
}

export function renderCoreAiRoleTemplate(
  template: { system: string; user: string },
  fields: CoreAiRoleFields,
): { system: string; user: string } {
  return { system: fill(template.system, fields), user: fill(template.user, fields) };
}

/** JSON Schema відповіді — одна для трьох ролей (перевіряється `schema.ts`). */
export const CORE_AI_ROLE_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['findings'],
  additionalProperties: true,
  properties: {
    findings: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['kind', 'summary', 'confidence'],
        additionalProperties: true,
        properties: {
          kind: { type: 'string', minLength: 1, maxLength: 60 },
          entity_type: { type: 'string', maxLength: 60 },
          entity_name: { type: 'string', maxLength: 300 },
          summary: { type: 'string', minLength: 1, maxLength: 2000 },
          paragraph_ids: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 50 },
          image_ids: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 20 },
          quote: { type: 'string', maxLength: 1000 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          insufficient_data: { type: 'boolean' },
        },
      },
    },
  },
} as const;
