/**
 * Сховище реєстру сутностей ядра: читання словника й індекс згадок у чаті.
 *
 * ДВІ РІЗНІ РЕЧІ В ОДНОМУ ФАЙЛІ, І ЦЕ НАВМИСНО.
 *
 *   1. СЛОВНИК (core_entities / core_entity_relations) — 118 типів сутностей
 *      і 39 типів зв'язків (37 із документа власника + 2 часові з ТЗ «11 сторінок»). Він ЗАВЖДИ є: якщо SQLite
 *      недоступний, дані беруться з того самого модуля, яким ця таблиця
 *      засіяна (`src/utils/coreEntities.ts`). Тому тут немає `requireDb()`,
 *      як у решті сховищ: відсутність бази не робить словник недоступним, а
 *      `null`-кидок у цьому випадку був би брехнею про можливості.
 *
 *   2. ІНДЕКС ЗГАДОК У ЧАТІ (chat_message_entities) — навпаки, без SQLite
 *      неможливий: самі повідомлення живуть у ній (chat_messages), і
 *      індексувати нічого, якщо чат не працює. Тут `requireDb()` доречний.
 *
 * Запис у chat_message_entities робиться НА ЗАПИСІ повідомлення, а не при
 * читанні: групування в чаті — це запит «де згадано /threshold», тобто
 * вибірка по сутності. Парсити всі повідомлення користувача на кожен такий
 * запит означало б квадратичну роботу там, де достатньо одного індексу.
 */

import { randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';
import {
  CORE_ENTITIES,
  CORE_ENTITY_RELATIONS,
  CORE_ENTITY_GROUPS,
  duplicateColors,
  parseEntityTags,
  registryStats,
} from '../src/utils/coreEntities';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Сутності ядра потребують SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

export interface StoredCoreEntity {
  slug: string;
  tag: string;
  nameUk: string;
  nameEn: string;
  groupId: string;
  color: string;
  characteristics: string[];
  registry: 'base' | 'critic';
}

export interface StoredCoreRelation {
  key: string;
  nameUk: string;
  example: string;
  /** `spec` — зв'язки з ТЗ «11 сторінок» (`follows`, `overlaps`), запис #238. */
  registry: 'base' | 'critic' | 'spec';
}

export interface StoredChatMessageEntity {
  slug: string;
  textValue: string;
  position: number;
  color?: string;
}

interface EntityRow {
  slug: string;
  tag: string;
  name_uk: string;
  name_en: string;
  group_id: string;
  color: string;
  characteristics: string;
  registry: string;
}

function toEntity(row: EntityRow): StoredCoreEntity {
  let characteristics: string[] = [];
  try {
    const parsed = JSON.parse(row.characteristics);
    if (Array.isArray(parsed)) characteristics = parsed.map(String);
  } catch {
    // Зіпсований JSON в одному рядку не має валити весь перелік — автор
    // побачить сутність без підказок характеристик, а не порожню панель.
    characteristics = [];
  }
  return {
    slug: row.slug,
    tag: row.tag,
    nameUk: row.name_uk,
    nameEn: row.name_en,
    groupId: row.group_id,
    color: row.color,
    characteristics,
    registry: row.registry === 'critic' ? 'critic' : 'base',
  };
}

/**
 * Словник сутностей. З бази (щоб серверні читачі — аналітика, майбутні
 * правила сортування — бачили ту саму таблицю, що й решта SQL) або з коду,
 * якщо бази немає.
 */
export async function listCoreEntities(): Promise<StoredCoreEntity[]> {
  const db = getDb();
  if (!db) return CORE_ENTITIES.map((e) => ({ ...e, characteristics: [...e.characteristics] }));
  try {
    const rows = db
      .prepare('SELECT * FROM core_entities ORDER BY sort_order ASC')
      .all() as EntityRow[];
    if (rows.length === 0) {
      // Таблиця порожня (база створена до появи насіння й не перезапускалась) —
      // віддаємо код, а не порожній перелік: «у реєстрі немає жодної
      // сутності» — це стан, якого не буває за жодних обставин.
      return CORE_ENTITIES.map((e) => ({ ...e, characteristics: [...e.characteristics] }));
    }
    return rows.map(toEntity);
  } catch (err) {
    console.warn('[coreEntityStore] Читання core_entities не вдалося, віддаю реєстр із коду:', err);
    return CORE_ENTITIES.map((e) => ({ ...e, characteristics: [...e.characteristics] }));
  }
}

export async function listCoreRelations(): Promise<StoredCoreRelation[]> {
  const db = getDb();
  if (!db) return CORE_ENTITY_RELATIONS.map((r) => ({ ...r }));
  try {
    const rows = db
      .prepare('SELECT * FROM core_entity_relations ORDER BY sort_order ASC')
      .all() as { key: string; name_uk: string; example: string; registry: string }[];
    if (rows.length === 0) return CORE_ENTITY_RELATIONS.map((r) => ({ ...r }));
    return rows.map((r) => ({
      key: r.key,
      nameUk: r.name_uk,
      example: r.example,
      registry: r.registry === 'critic' ? ('critic' as const) : r.registry === 'spec' ? ('spec' as const) : ('base' as const),
    }));
  } catch (err) {
    console.warn('[coreEntityStore] Читання core_entity_relations не вдалося, віддаю з коду:', err);
    return CORE_ENTITY_RELATIONS.map((r) => ({ ...r }));
  }
}

/** Зведення для заголовка панелі й для перевірок: скільки саме чого в базі. */
export async function coreEntityStats(): Promise<{
  entities: number;
  relations: number;
  groups: number;
  base: number;
  critic: number;
  duplicateColors: number;
}> {
  const [entities, relations] = await Promise.all([listCoreEntities(), listCoreRelations()]);
  const code = registryStats();
  return {
    entities: entities.length,
    relations: relations.length,
    groups: CORE_ENTITY_GROUPS.length,
    base: entities.filter((e) => e.registry === 'base').length,
    critic: entities.filter((e) => e.registry === 'critic').length,
    // Повтори кольорів рахуємо по КОДУ, а не по базі: документ попереджає
    // про них прямо в тексті, і ця цифра — довідка про документ, не стан БД.
    duplicateColors: code.duplicateColors || duplicateColors().length,
  };
}

// ---------------------------------------------------------------------------
// Згадки сутностей у чаті ШІ
// ---------------------------------------------------------------------------

/**
 * Розбирає текст повідомлення й записує знайдені теги як індекс.
 *
 * Ідемпотентно: повторний виклик для того самого повідомлення не плодить
 * дублікати (так буває при повторному збереженні відповіді після збою
 * мережі). Теги, яких немає в реєстрі, теж записуються — автор міг
 * помилитись у ключі, і мовчки викинути його означало б приховати помилку.
 */
export async function indexChatMessageEntities(input: {
  messageId: string;
  sessionId: string;
  userId: string;
  text: string;
}): Promise<StoredChatMessageEntity[]> {
  const tags = parseEntityTags(input.text);
  if (tags.length === 0) return [];

  // Без SQLite індексувати нікуди — і це НЕ привід валити надсилання
  // повідомлення. Чат на JSON-бекенді (старі середовища) працює, просто без
  // групування: автор відправить репліку й отримає відповідь, а згадки
  // лишаться тільки в тексті. Кидати тут означало б зробити надсилання
  // залежним від наявності бази, хоч сама репліка врятується деінде.
  const db = getDb();
  if (!db) return tags.map((tag, index) => ({ slug: tag.slug, textValue: tag.value, position: index, color: tag.entity?.color }));
  const now = new Date().toISOString();
  db.prepare('DELETE FROM chat_message_entities WHERE message_id = ?').run(input.messageId);

  const insert = db.prepare(
    `INSERT INTO chat_message_entities (id, message_id, session_id, user_id, slug, text_value, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  tags.forEach((tag, index) => {
    insert.run(randomUUID(), input.messageId, input.sessionId, input.userId, tag.slug, tag.value, index, now);
  });

  return tags.map((tag, index) => ({
    slug: tag.slug,
    textValue: tag.value,
    position: index,
    color: tag.entity?.color,
  }));
}

/**
 * Згадки ВСІХ повідомлень сесії одним запитом, зібрані за message_id.
 *
 * Навіщо не по одному повідомленню: історія розмови — це десятки реплік, і
 * запит на кожну з них давав би N звернень до бази там, де досить одного.
 * Саме тому це окрема функція, а не цикл навколо `listChatMessageEntities`.
 */
export async function listSessionMessageEntities(
  sessionId: string
): Promise<Record<string, StoredChatMessageEntity[]>> {
  const db = getDb();
  if (!db) return {};
  try {
    const rows = db
      .prepare(
        'SELECT message_id, slug, text_value, position FROM chat_message_entities WHERE session_id = ? ORDER BY message_id, position ASC'
      )
      .all(sessionId) as { message_id: string; slug: string; text_value: string; position: number }[];
    const byMessage: Record<string, StoredChatMessageEntity[]> = {};
    for (const row of rows) {
      const list = byMessage[row.message_id] || (byMessage[row.message_id] = []);
      list.push({
        slug: row.slug,
        textValue: row.text_value,
        position: row.position,
        color: CORE_ENTITIES.find((e) => e.slug === row.slug)?.color,
      });
    }
    return byMessage;
  } catch (err) {
    console.warn('[coreEntityStore] читання згадок сесії не вдалося:', err);
    return {};
  }
}

/** Сутності одного повідомлення — для показу групи під реплікою в чаті. */
export async function listChatMessageEntities(messageId: string): Promise<StoredChatMessageEntity[]> {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare('SELECT slug, text_value, position FROM chat_message_entities WHERE message_id = ? ORDER BY position ASC')
    .all(messageId) as { slug: string; text_value: string; position: number }[];
  return rows.map((r) => ({
    slug: r.slug,
    textValue: r.text_value,
    position: r.position,
    color: CORE_ENTITIES.find((e) => e.slug === r.slug)?.color,
  }));
}

/**
 * Згадки по всій сесії — «які сутності автор чіпав у цій розмові».
 * Повертає унікальні ключі разом із кількістю згадок: саме це показує
 * групування в чаті, і саме за цим автор бачить, що розмова насправді
 * точилася навколо /threshold, а не навколо /character.
 */
export async function listChosenChatEntityGroups(
  sessionId: string
): Promise<{ slug: string; count: number; values: string[]; color?: string }[]> {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT slug, COUNT(*) AS n, GROUP_CONCAT(text_value, '||') AS vals
       FROM chat_message_entities WHERE session_id = ? GROUP BY slug ORDER BY n DESC`
    )
    .all(sessionId) as { slug: string; n: number; vals: string | null }[];
  return rows.map((r) => ({
    slug: r.slug,
    count: r.n,
    values: (r.vals || '')
      .split('||')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 8),
    color: CORE_ENTITIES.find((e) => e.slug === r.slug)?.color,
  }));
}

/** Сесії, у яких згадано цю сутність — основа фільтра «показати розмови про…». */
export async function listSessionsMentioningEntity(
  userId: string,
  slug: string
): Promise<{ sessionId: string; count: number }[]> {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT session_id, COUNT(*) AS n FROM chat_message_entities
       WHERE user_id = ? AND slug = ? GROUP BY session_id ORDER BY n DESC`
    )
    .all(userId, slug) as { session_id: string; n: number }[];
  return rows.map((r) => ({ sessionId: r.session_id, count: r.n }));
}
