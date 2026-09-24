/**
 * Сутності ядра в промптах ШІ-коуча тренажерів майстерності (запис #237).
 *
 * ЧОМУ ОКРЕМИЙ МОДУЛЬ. Два ендпойнти (`/api/ai/coach-feedback` і
 * `/api/ai/generate-exercise`) говорять із моделлю про ті самі сутності; тут
 * — чисті функції, які можна перевірити тестом без мережі й без моделі.
 *
 * ДОВІРА. Назви й характеристики сутностей НЕ беруться з тіла запиту: з
 * клієнта приходить лише ключ, а все інше підставляється з реєстру
 * (`src/utils/coreEntities.ts`). Інакше в системний промпт можна було б
 * пронести довільний текст під виглядом «назви сутності».
 */
import { entityBySlug, entityTagRegexp } from '../src/utils/coreEntities';

export interface PromptEntity {
  slug: string;
  nameUk: string;
  characteristics: string[];
}

/** Найбільше сутностей, про які розповідаємо моделі за раз (вправа «Квест» має 12). */
export const MAX_PROMPT_ENTITIES = 16;

/** Ключі з тіла запиту → сутності реєстру (невідомі й повтори відкидаються). */
export function normalizePromptEntities(raw: unknown): PromptEntity[] {
  const out: PromptEntity[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const slug = typeof item === 'string' ? item : (item && typeof item === 'object' ? (item as any).slug : '');
    const entity = typeof slug === 'string' ? entityBySlug(slug) : undefined;
    if (!entity || out.some((e) => e.slug === entity.slug)) continue;
    out.push({ slug: entity.slug, nameUk: entity.nameUk, characteristics: entity.characteristics });
    if (out.length >= MAX_PROMPT_ENTITIES) break;
  }
  return out;
}

/** Чи є в тексті хоча б один канонічний тег сутності. */
export function hasEntityTags(text: string): boolean {
  return entityTagRegexp().test(String(text || ''));
}

const describe = (e: PromptEntity) => `- [/${e.slug}:…] — ${e.nameUk} (характеристики: ${e.characteristics.join(', ')})`;

/**
 * Блок системного промпту коуча про сутності.
 *
 * Дві незалежні частини:
 *   • оцінка розмітки — лише коли у вправи є сутності;
 *   • збереження тегів — ЗАВЖДИ, коли теги є в тексті автора: уривок із книги
 *     може містити теги, поставлені в редакторі, і «виправлена версія», що
 *     повертається в розділ, не має їх губити чи перекручувати.
 */
export function buildCoachEntityInstruction(entities: PromptEntity[], entityStep: string | undefined, draft: string): string {
  const parts: string[] = [];
  if (entities.length > 0) {
    parts.push(`СУТНОСТІ ВПРАВИ (реєстр ядра студії). Автор позначає їх у тексті тегами виду [/ключ:значення]:
${entities.map(describe).join('\n')}
${entityStep ? `Крок розмітки з умови вправи: ${String(entityStep).slice(0, 800)}\n` : ''}Оціни розмітку: для КОЖНОЇ сутності зі списку поверни в "entityFeedback" об'єкт { "slug": "ключ", "used": true/false, "comment": "коротко: чи тег стоїть у правильному місці й чи значення після двокрапки відповідає характеристикам" }. Якщо тега немає — "used": false і порада, куди його поставити.`);
  }
  if (hasEntityTags(draft)) {
    parts.push(`ТЕГИ СУТНОСТЕЙ У ТЕКСТІ. Фрагменти виду [/ключ:значення] — службова розмітка автора (у книзі вона прихована від читача). Не оцінюй їх як стиль і не рахуй у довжину тексту. У "rewrittenExample" та "correctedFullText" зберігай кожен тег БЕЗ ЗМІН — той самий ключ і те саме значення, у тому самому місці відносно речення, яке він позначає; не додавай нових тегів і не перекладай ключі.`);
  }
  return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

/** Поле entityFeedback з відповіді моделі — лише сутності вправи, у порядку вправи. */
export function normalizeEntityFeedback(raw: unknown, entities: PromptEntity[]): { slug: string; used: boolean; comment: string }[] {
  if (!Array.isArray(raw) || entities.length === 0) return [];
  const bySlug = new Map<string, { used: boolean; comment: string }>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entity = entityBySlug(String((item as any).slug || ''));
    if (!entity) continue;
    bySlug.set(entity.slug, {
      used: (item as any).used === true,
      comment: String((item as any).comment || '').slice(0, 500),
    });
  }
  return entities
    .filter((e) => bySlug.has(e.slug))
    .map((e) => ({ slug: e.slug, ...bySlug.get(e.slug)! }));
}

/** Блок промпту генератора вправ: вправа має спиратися на сутності тренажера. */
export function buildExerciseEntityInstruction(entities: PromptEntity[]): string {
  if (entities.length === 0) return '';
  return `

Сутності цього тренажера (реєстр ядра студії):
${entities.map(describe).join('\n')}
Обери з них 2–5, які природно випливають із завдання, і додай до JSON два поля:
  "entities": ["ключ", ...] — лише ключі з переліку вище;
  "entityStep": "крок розмітки: які теги [/ключ:значення] і де автор ставить у своєму тексті" — кожну обрану сутність назви тегом.`;
}

/** Поля entities/entityStep згенерованої вправи — лише сутності тренажера. */
export function normalizeGeneratedEntities(result: any, entities: PromptEntity[]): { entities: string[]; entityStep: string } {
  const allowed = new Set(entities.map((e) => e.slug));
  const picked = normalizePromptEntities(Array.isArray(result?.entities) ? result.entities : [])
    .map((e) => e.slug)
    .filter((slug) => allowed.has(slug));
  const entityStep = picked.length && typeof result?.entityStep === 'string' ? result.entityStep.slice(0, 1200) : '';
  return { entities: entityStep ? picked : [], entityStep };
}
