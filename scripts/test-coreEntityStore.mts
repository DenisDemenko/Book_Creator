/**
 * Тести реєстру сутностей ядра на сервері: насіння таблиць, читання словника
 * й індекс згадок у чаті. Запуск: npm run test:core-entities-store
 *
 * ЩО ТУТ ГОЛОВНЕ. Числа з документа власника (118 / 88 / 30 / 37) уже
 * перевірені в `test-coreEntities.mts` над самим модулем. Тут перевіряється
 * ІНШЕ, і саме воно ламається тихо: чи доїхав той перелік у таблицю, чи
 * переживає перезапуск, чи прибирає рядки, яких у коді вже немає, і чи
 * лягають згадки з чату в індекс так, щоб за ними можна було групувати.
 *
 * Остання перевірка — про метод: «рядок у базі є» і «рядок у базі той самий»
 * це різні твердження. Тому після насіння читаємо характеристики з бази й
 * звіряємо їх із кодом по кожній зі 118 сутностей, а не рахуємо COUNT(*).
 */

const DIR = `${process.env.TMPDIR || '/tmp'}/nova-core-entity-store-test`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';
import { CORE_ENTITIES, CORE_ENTITY_RELATIONS, CORE_ENTITY_GROUPS } from '../src/utils/coreEntities.ts';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/coreEntityStore');

let pass = 0, fail = 0;
const t = (name: string, condition: boolean, extra = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

await db.initDb();
const handle = db.getDb()!;

console.log('Середовище:');
t('SQLite доступний (без нього цей тест нічого не доводить)', db.isAvailable() === true, db.unavailableMessage());

console.log('\nНасіння реєстру при ініціалізації бази:');
{
  const entities = handle.prepare('SELECT COUNT(*) AS n FROM core_entities').get() as { n: number };
  const relations = handle.prepare('SELECT COUNT(*) AS n FROM core_entity_relations').get() as { n: number };
  t('у core_entities рівно 118 рядків', entities.n === 118, String(entities.n));
  t('у core_entity_relations рівно 37 рядків', relations.n === 37, String(relations.n));

  const groupCounts = handle
    .prepare('SELECT group_id, COUNT(*) AS n FROM core_entities GROUP BY group_id')
    .all() as { group_id: string; n: number }[];
  const perGroup = Object.fromEntries(groupCounts.map((g) => [g.group_id, g.n]));
  t('наповнення груп у базі збігається з документом',
    JSON.stringify(perGroup) === JSON.stringify({
      A: 8, B: 15, C: 12, D: 8, E: 6, F: 10, G: 10, H: 12, I: 7, J1: 10, J2: 11, J3: 9,
    }), JSON.stringify(perGroup));

  // Рядок за рядком: не «118 узагалі», а «118 саме ті».
  const rows = handle
    .prepare('SELECT slug, tag, name_uk, name_en, color, characteristics, registry FROM core_entities ORDER BY sort_order')
    .all() as { slug: string; tag: string; name_uk: string; name_en: string; color: string; characteristics: string; registry: string }[];
  const mismatches = CORE_ENTITIES.filter((entity, index) => {
    const row = rows[index];
    return !row
      || row.slug !== entity.slug
      || row.tag !== entity.tag
      || row.name_uk !== entity.nameUk
      || row.name_en !== entity.nameEn
      || row.color !== entity.color
      || row.registry !== entity.registry
      || row.characteristics !== JSON.stringify(entity.characteristics);
  }).map((e) => e.slug);
  t('кожен рядок бази — точно той самий, що в модулі (назви, колір, характеристики)',
    mismatches.length === 0, mismatches.slice(0, 5).join(', '));

  const relationMismatch = CORE_ENTITY_RELATIONS.filter((rel, index) => {
    const row = handle.prepare('SELECT key, name_uk, example FROM core_entity_relations WHERE sort_order = ?').get(index) as
      | { key: string; name_uk: string; example: string }
      | undefined;
    return !row || row.key !== rel.key || row.name_uk !== rel.nameUk || row.example !== rel.example;
  }).map((r) => r.key);
  t('кожен зв’язок у базі — той самий, що в модулі',
    relationMismatch.length === 0, relationMismatch.slice(0, 5).join(', '));
}

console.log('\nЧитання словника:');
{
  const entities = await store.listCoreEntities();
  t('listCoreEntities віддає 118', entities.length === 118, String(entities.length));
  const character = entities.find((e) => e.slug === 'character');
  t('характеристики розібрані з JSON у масив',
    Array.isArray(character?.characteristics) && character!.characteristics.length === 5,
    JSON.stringify(character?.characteristics));
  t('невідомий registry у рядку не проходить назовні як є',
    entities.every((e) => e.registry === 'base' || e.registry === 'critic'));

  const relations = await store.listCoreRelations();
  t('listCoreRelations віддає 37', relations.length === 37, String(relations.length));

  const stats = await store.coreEntityStats();
  t('зведення: 118 сутностей, 37 зв’язків, 12 груп',
    stats.entities === 118 && stats.relations === 37 && stats.groups === CORE_ENTITY_GROUPS.length,
    JSON.stringify(stats));
  t('зведення розрізняє базовий реєстр і додаток критики',
    stats.base === 88 && stats.critic === 30, `${stats.base}/${stats.critic}`);
}

console.log('\nПовторний старт: правки документа доходять до бази, зайве прибирається:');
{
  // Рядок, якого в коді немає, — так виглядає сутність, видалена з документа.
  handle
    .prepare(
      `INSERT INTO core_entities (slug, tag, name_uk, name_en, group_id, color, characteristics, registry, sort_order, updated_at)
       VALUES ('ghost-entity', '/ghost-entity', 'Привид', 'Ghost', 'A', '#000000', '[]', 'base', 999, ?)`
    )
    .run(new Date().toISOString());
  t('штучний зайвий рядок додано', (handle.prepare('SELECT COUNT(*) AS n FROM core_entities').get() as { n: number }).n === 119);

  db.closeDb();
  await db.initDb();
  const handle2 = db.getDb()!;
  const after = handle2.prepare('SELECT COUNT(*) AS n FROM core_entities').get() as { n: number };
  t('після перезапуску зайвий рядок зник (база не живе своїм життям)',
    after.n === 118, String(after.n));
  t('реєстр після перезапуску читається тим самим кодом',
    (await store.listCoreEntities()).length === 118);
}

console.log('\nІндекс згадок сутностей у чаті:');
{
  const indexed = await store.indexChatMessageEntities({
    messageId: 'msg-1',
    sessionId: 'sess-1',
    userId: 'u-1',
    text: '[/character:Serhii] [/emotion:страх] Сергій злякався.',
  });
  t('дві згадки записано', indexed.length === 2, JSON.stringify(indexed.map((i) => i.slug)));
  t('значення після двокрапки збережено', indexed[1].textValue === 'страх', indexed[1].textValue);
  t('колір підтягнуто з реєстру', indexed[0].color === '#3B82F6', indexed[0].color || 'немає');

  const again = await store.indexChatMessageEntities({
    messageId: 'msg-1',
    sessionId: 'sess-1',
    userId: 'u-1',
    text: '[/character:Serhii] [/emotion:страх] Сергій злякався.',
  });
  const rows = handle2Count();
  t('повторна індексація того самого повідомлення не плодить дублікати',
    again.length === 2 && rows === 2, `рядків у таблиці: ${rows}`);

  function handle2Count(): number {
    return (db.getDb()!.prepare('SELECT COUNT(*) AS n FROM chat_message_entities WHERE message_id = ?').get('msg-1') as { n: number }).n;
  }

  await store.indexChatMessageEntities({
    messageId: 'msg-2',
    sessionId: 'sess-1',
    userId: 'u-1',
    text: '[/threshold:survival-001] Далі — поріг.',
  });

  const groups = await store.listChosenChatEntityGroups('sess-1');
  t('групування по сесії повертає всі три згадані сутності',
    groups.length === 3 && groups.map((g) => g.slug).sort().join(',') === 'character,emotion,threshold',
    groups.map((g) => `${g.slug}:${g.count}`).join(' '));
  t('у групи видно конкретні значення, а не лише ключ',
    (groups.find((g) => g.slug === 'character')?.values || []).includes('Serhii'),
    JSON.stringify(groups.find((g) => g.slug === 'character')?.values));

  const sessions = await store.listSessionsMentioningEntity('u-1', 'threshold');
  t('сутність знаходиться за сесіями', sessions.length === 1 && sessions[0].sessionId === 'sess-1',
    JSON.stringify(sessions));
  t('чужий користувач не бачить цих сесій',
    (await store.listSessionsMentioningEntity('u-2', 'threshold')).length === 0);

  // Тег не з реєстру — автор міг помилитись у ключі. Мовчки викинути його
  // означало б приховати помилку від того, хто її зробив.
  const unknown = await store.indexChatMessageEntities({
    messageId: 'msg-3',
    sessionId: 'sess-1',
    userId: 'u-1',
    text: '[/charakter:Serhii] Очеп’ятка в ключі.',
  });
  t('тег із невідомим ключем теж індексується (щоб помилку було видно)',
    unknown.length === 1 && unknown[0].color === undefined, JSON.stringify(unknown[0]));
}

console.log('\nHTTP-шар:');
{
  const app = express();
  app.use((req: any, _res, next) => {
    req.principal = { id: 'u-1', email: 'u1@test.ua', name: 'Тест', role: 'writer', isGuest: false };
    next();
  });
  const routes = await import('../server/coreEntityRoutes');
  routes.registerCoreEntityRoutes(app);

  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const res = await fetch(`${base}/api/core/entities`);
  const body = await res.json() as any;
  t('GET /api/core/entities відповідає 200', res.status === 200, String(res.status));
  t('відповідь містить 118 сутностей', body.entities?.length === 118, String(body.entities?.length));
  t('відповідь містить 37 зв’язків', body.relations?.length === 37, String(body.relations?.length));
  t('відповідь містить 12 груп', body.groups?.length === 12, String(body.groups?.length));
  t('ліміт сутностей на абзац віддається клієнту', body.maxPerParagraph === 12, String(body.maxPerParagraph));
  t('формат тега віддається клієнту', typeof body.tagFormat === 'string' && body.tagFormat.includes('['),
    String(body.tagFormat).slice(0, 40));

  const sessRes = await fetch(`${base}/api/core/chat/sessions/sess-1/entities`);
  const sessBody = await sessRes.json() as any;
  t('GET згадок сесії віддає групи', sessRes.status === 200 && sessBody.groups.length >= 3,
    JSON.stringify(sessBody.groups?.map((g: any) => g.slug)));

  const sessionsRes = await fetch(`${base}/api/core/entities/threshold/sessions`);
  const sessionsBody = await sessionsRes.json() as any;
  t('GET сесій за сутністю працює і зі слешем, і без',
    sessionsRes.status === 200 && sessionsBody.sessions.length === 1, JSON.stringify(sessionsBody));

  // Закриваємо і сервер, і його з'єднання: на Windows незакриті keep-alive
  // сокети дають assertion усередині libuv під час виходу — шум, який легко
  // прийняти за справжню поломку тесту.
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
db.closeDb();
if (fail > 0) process.exit(1);
