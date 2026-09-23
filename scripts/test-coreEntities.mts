/**
 * Тести реєстру сутностей ядра (src/utils/coreEntities.ts).
 *
 * ГОЛОВНЕ, ЩО ТУТ ПЕРЕВІРЯЄТЬСЯ, — ЧИСЛА З ДОКУМЕНТА ВЛАСНИКА, а не
 * «щось схоже на правду». Реєстр переносився в код руками з PDF, і саме на
 * такому перенесенні найлегше втратити рядок або задублювати тег: обидва
 * дефекти не дають жодної помилки компіляції й виявляються аж тоді, коли
 * письменник не знаходить потрібної сутності в панелі.
 *
 * Документ каже: 88 базових типів у 9 групах + 30 типів додатка
 * «Літературна критика» = 118; зв'язків 21 + 16 = 37. Усі п'ять чисел
 * перевіряються окремо, бо кожне з них можна зламати по-своєму.
 */

import {
  CORE_ENTITIES,
  CORE_ENTITY_RELATIONS,
  CORE_ENTITY_GROUPS,
  CORE_ENTITY_COUNT,
  CORE_RELATION_COUNT,
  CORE_ENTITY_BASE_COUNT,
  CORE_ENTITY_CRITIC_COUNT,
  MAX_ENTITIES_PER_PARAGRAPH,
  entityBySlug,
  entitiesInGroup,
  searchEntities,
  searchCharacteristics,
  buildEntityTag,
  parseEntityTags,
  parseLooseEntityTags,
  parseAnyEntityTags,
  wrapPlainEntityTags,
  stripEntityTags,
  paragraphsWithEntities,
  mixWithWhite,
  paragraphBackground,
  duplicateColors,
  registryStats,
} from '../src/utils/coreEntities.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  failures.push(label + (detail ? ` — ${detail}` : ''));
}

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(label, a === b, `очікували ${b}, отримали ${a}`);
}

console.log('\n── Склад реєстру: числа мусять збігтися з документом ──');
{
  const stats = registryStats();
  eq('усього 118 типів сутностей', stats.entities, 118);
  eq('базових 88', stats.base, 88);
  eq('додаток критики 30', stats.critic, 30);
  eq('зв’язків 37', stats.relations, 37);
  eq('груп 12 (9 базових + 3 підгрупи додатка)', stats.groups, 12);
  eq('константи збігаються з фактичним вмістом',
    [CORE_ENTITY_COUNT, CORE_RELATION_COUNT, CORE_ENTITY_BASE_COUNT, CORE_ENTITY_CRITIC_COUNT],
    [118, 37, 88, 30]);

  // Групи документа: 8+15+12+8+6+10+10+12+7 = 88, додаток 10+11+9 = 30.
  const perGroup = Object.fromEntries(
    CORE_ENTITY_GROUPS.map((g) => [g.id, entitiesInGroup(g.id).length])
  );
  eq('наповнення кожної групи — як у документі', perGroup, {
    A: 8, B: 15, C: 12, D: 8, E: 6, F: 10, G: 10, H: 12, I: 7,
    J1: 10, J2: 11, J3: 9,
  });
  ok('кожна сутність належить існуючій групі',
    CORE_ENTITIES.every((e) => CORE_ENTITY_GROUPS.some((g) => g.id === e.groupId)));
  ok('позначка registry узгоджена з групою',
    CORE_ENTITIES.every((e) => e.registry === (e.groupId.startsWith('J') ? 'critic' : 'base')));
}

console.log('\n── Цілісність записів ──');
{
  const slugs = CORE_ENTITIES.map((e) => e.slug);
  eq('ключі унікальні', new Set(slugs).size, slugs.length);
  ok('усі ключі у форматі документа (a-z, 0-9, дефіс)',
    slugs.every((s) => /^[a-z0-9-]+$/.test(s)),
    slugs.find((s) => !/^[a-z0-9-]+$/.test(s)) || '');
  ok('тег — це слеш плюс ключ',
    CORE_ENTITIES.every((e) => e.tag === `/${e.slug}`));
  ok('у кожної сутності є українська й англійська назва',
    CORE_ENTITIES.every((e) => e.nameUk.trim().length > 0 && e.nameEn.trim().length > 0));
  ok('колір — валідний #RRGGBB',
    CORE_ENTITIES.every((e) => /^#[0-9A-Fa-f]{6}$/.test(e.color)),
    CORE_ENTITIES.find((e) => !/^#[0-9A-Fa-f]{6}$/.test(e.color))?.slug || '');
  ok('у кожної сутності є хоч одна характеристика',
    CORE_ENTITIES.every((e) => e.characteristics.length > 0),
    CORE_ENTITIES.find((e) => e.characteristics.length === 0)?.slug || '');

  const relationKeys = CORE_ENTITY_RELATIONS.map((r) => r.key);
  eq('ключі зв’язків унікальні', new Set(relationKeys).size, relationKeys.length);
  eq('базових зв’язків 21',
    CORE_ENTITY_RELATIONS.filter((r) => r.registry === 'base').length, 21);
  eq('критичних зв’язків 16',
    CORE_ENTITY_RELATIONS.filter((r) => r.registry === 'critic').length, 16);

  // Повтори кольорів документ сам дозволяє — перевіряємо лише, що їх
  // рахуємо й показуємо, а не мовчки «виправляємо».
  const dups = duplicateColors();
  console.log(`  (довідка: кольорів, що повторюються — ${dups.length}, як і попереджає документ)`);
  ok('перелік повторів кольорів не порожній (документ про них попереджає)', dups.length > 0);
}

console.log('\n── Адресація записів ──');
{
  eq('entityBySlug знаходить за ключем', entityBySlug('character')?.nameUk, 'Персонаж');
  eq('entityBySlug приймає і тег зі слешем', entityBySlug('/character')?.slug, 'character');
  eq('entityBySlug приймає верхній регістр', entityBySlug('/THRESHOLD')?.slug, 'threshold');
  eq('невідомий ключ → undefined', entityBySlug('не-сутність'), undefined);
  eq('пошук за першою літерою дає лише збіги за початком ключа, у порядку документа',
    searchEntities('c').slice(0, 4).map((e) => e.slug),
    ['chapter', 'content-block', 'conflict', 'consequence']);
  ok('жоден результат не пройшов пошук «десь усередині»',
    searchEntities('c').every((e) => e.slug.startsWith('c') || e.nameEn.toLowerCase().startsWith('c') || e.nameUk.toLowerCase().startsWith('c')));
  eq('«char» дає чотири сутності Character*',
    searchEntities('char').map((e) => e.slug),
    ['character', 'character-arc', 'character-state', 'character-voice']);
  eq('точний збіг ключа — перший',
    searchEntities('scene')[0].slug, 'scene');
  eq('порожній запит віддає початок реєстру (для відкриття списку)',
    searchEntities('', 3).map((e) => e.slug), ['project', 'document', 'chapter']);
  eq('невідомий префікс → порожньо', searchEntities('zzz').length, 0);
  eq('пошук характеристики всередині сутності',
    searchCharacteristics(entityBySlug('character')!, 'р'), ['роль']);
}

console.log('\n── Тег у тексті: побудова, розбір, зняття ──');
{
  eq('тег будується у форматі документа', buildEntityTag('character', 'Serhii'), '[/character:Serhii]');
  eq('тег без значення теж валідний', buildEntityTag('/scene'), '[/scene:]');
  eq('дужки у значенні не ламають тег', buildEntityTag('character', 'Се[р]гій'), '[/character:Се р гій]');

  const text = '[/character:Serhii] [/emotion:страх] Сергій вийшов із будинку.';
  const parsed = parseEntityTags(text);
  eq('розібрано два теги', parsed.length, 2);
  eq('ключ першого', parsed[0].slug, 'character');
  eq('значення другого', parsed[1].value, 'страх');
  ok('сутність підтягнута з реєстру', parsed[1].entity?.nameUk === 'Емоційний стан');
  ok('позиції вказують на справжній текст',
    text.slice(parsed[0].start, parsed[0].end) === '[/character:Serhii]');

  eq('зняття тегів прибирає маркери й зайві пропуски',
    stripEntityTags(text), 'Сергій вийшов із будинку.');
  eq('текст без тегів не змінюється',
    stripEntityTags('Просто текст.'), 'Просто текст.');
  eq('звичайний текст із слешем і двокрапкою тегом не вважається',
    stripEntityTags('Див. стор. /2:3 у примітці.'), 'Див. стор. /2:3 у примітці.');
  eq('невідомий реєстру тег усе одно знімається (це все ще маркер)',
    stripEntityTags('[/unknown-x:щось] Текст.'), 'Текст.');
  eq('«сирий» тег знімається теж (страховка на випадок ненормалізованого тексту)',
    stripEntityTags('Він увійшов. /character:Serhii злякався.'), 'Він увійшов. злякався.');
  eq('«сирий» тег із невідомим ключем у тексті НЕ знімається',
    stripEntityTags('Див. стор. /2:3.'), 'Див. стор. /2:3.');
  eq('URL із схожим шляхом не ріжеться',
    stripEntityTags('Джерело: https://x.ua/a:1 — далі.'), 'Джерело: https://x.ua/a:1 — далі.');
  eq('порожній рядок від тегів не зʼїдає межу абзацу',
    stripEntityTags('[/character:Serhii]\n\nНаступний абзац.'), '\n\nНаступний абзац.');
  eq('рядок лише з тегів усередині абзацу не лишає подвійних пропусків',
    stripEntityTags('Текст. [/character:Serhii] Ще текст.'), 'Текст. Ще текст.');
}

console.log('\n── «Сирий» тег: те, що автор набирає в канві ──');
{
  const typed = '[/character:Serhii] пропущено. /character:Serhii увійшов до кімнати, і /emotion:страх стиснув груди.';
  const loose = parseLooseEntityTags(typed);
  eq('розібрано два набрані руками теги', loose.length, 2, );
  eq('перший — персонаж', loose[0].slug, 'character');
  eq('значення другого — без крапки в кінці', loose[1].value, 'страх');

  // ГОЛОВНЕ: без перевірки по реєстру звичайний текст ставав би тегами.
  eq('слеш із двокрапкою в звичайному тексті тегом НЕ стає',
    parseLooseEntityTags('Див. стор. /2:3 у примітці.').length, 0);
  eq('невідомий ключ не стає тегом',
    parseLooseEntityTags('/charakter:Serhii').length, 0);
  eq('URL не стає тегом',
    parseLooseEntityTags('https://example.com/a:1 та https://x.ua/scene:2').length, 0);

  eq('нормалізація загортає набраний тег у дужки',
    wrapPlainEntityTags('Він увійшов. /character:Serhii злякався.'),
    'Він увійшов. [/character:Serhii] злякався.');
  eq('нормалізація не чіпає вже канонічний тег (ідемпотентність)',
    wrapPlainEntityTags('[/character:Serhii] Текст.'), '[/character:Serhii] Текст.');
  eq('нормалізація не чіпає текст без тегів',
    wrapPlainEntityTags('Див. стор. /2:3.'), 'Див. стор. /2:3.');
  eq('нормалізація двічі дає те саме',
    wrapPlainEntityTags(wrapPlainEntityTags('/scene:12 Початок.')),
    wrapPlainEntityTags('/scene:12 Початок.'));

  const any = parseAnyEntityTags('[/scene:12] Далі /character:Serhii увійшов.');
  eq('розпізнаються обидві форми разом', any.map((t) => t.slug), ['scene', 'character']);
  ok('порядок — за позицією в тексті', any[0].start < any[1].start);
}

console.log('\n── Абзаци й кольори ──');
{
  const content = [
    '[/character:Serhii] [/scene:12]',
    'Сергій вийшов із будинку.',
    '',
    'Другий абзац без сутностей.',
  ].join('\n');
  const paragraphs = paragraphsWithEntities(content);
  eq('абзаців два', paragraphs.length, 2);
  eq('перший абзац має два теги', paragraphs[0].entities.length, 2);
  eq('текст першого абзацу — без тегів', paragraphs[0].text, 'Сергій вийшов із будинку.');
  eq('колір першого абзацу — колір ПЕРШОЇ заявленої сутності',
    paragraphs[0].color, '#3B82F6');
  eq('у другого абзацу сутностей немає', paragraphs[1].entities.length, 0);
  eq('у другого абзацу немає кольору', paragraphs[1].color, undefined);

  eq('змішування з білим на 0 дає той самий колір', mixWithWhite('#3B82F6', 0), '#3b82f6');
  eq('змішування на 1 дає білий', mixWithWhite('#3B82F6', 1), '#ffffff');
  ok('тло абзацу світліше за колір сутності',
    paragraphBackground('#3B82F6') !== '#3B82F6' && paragraphBackground('#3B82F6') !== undefined);
  eq('без кольору тла немає', paragraphBackground(undefined), undefined);
  eq('сміттєвий колір повертається як є, а не ламає виклик',
    mixWithWhite('не-колір', 0.5), 'не-колір');

  eq('максимум сутностей на абзац — 12 (як у постановці)', MAX_ENTITIES_PER_PARAGRAPH, 12);
}

console.log('\n── Кирилиця: той самий ключ, набраний українською ──');
{
  /*
   * Постановка власника (23.09.2026, п. 3): «всі 118 тегів мають вводитись і
   * англійською, і українською». Перевіряємо три різні речі, бо саме вони
   * ламаються окремо: пошук у панелі/меню, розвʼязання ключа й канонізацію
   * того, що лягає в книгу.
   */
  ok('пошук «персонаж» знаходить character',
    searchEntities('персонаж', 3).some((e) => e.slug === 'character'));
  ok('пошук «емоц» знаходить emotion',
    searchEntities('емоц', 3).some((e) => e.slug === 'emotion'));
  ok('пошук «діалог» знаходить dialogue',
    searchEntities('діалог', 3).some((e) => e.slug === 'dialogue'));

  eq('ключ «персонаж» — це character', entityBySlug('персонаж')?.slug, 'character');
  eq('ключ «герой» — це character (слово власника з постановки)', entityBySlug('герой')?.slug, 'character');
  eq('ключ «емоція» — це emotion (назва-фраза в документі — «Емоційний стан»)',
    entityBySlug('емоція')?.slug, 'emotion');

  eq('у книгу завжди лягає англійський слаг', buildEntityTag('персонаж', 'Сергій'), '[/character:Сергій]');
  const ukTag = parseEntityTags('[/персонаж:Сергій]');
  eq('український тег у тексті розпізнається', ukTag.length, 1);
  eq('і резолвиться в сутність реєстру', ukTag[0]?.entity?.slug, 'character');
}

console.log(`\nПідсумок: ${passed} пройшло, ${failed} впало`);
if (failed > 0) {
  console.log('\nВідмови:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
