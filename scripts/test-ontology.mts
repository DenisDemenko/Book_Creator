/**
 * Реєстр схем — визначення онтології, імпорт v1.0 і реєстр під час роботи
 * (Т5.1 В1, `PLAN_ONTOLOGY.md`). Запуск: npm run test:ontology
 *
 * Що доводить:
 *   • Fusion Story Ontology 1.0 — це рівно документ власника: 118 типів,
 *     39 зв'язків, 12 груп; перетворення «визначення → реєстр» дає ті самі
 *     записи, що були в коді (критерій ТЗ §39 №1);
 *   • перевірка ловить зламані визначення (ID, групи, кольори, назви EN/UA,
 *     аліаси, кінці зв'язків, переліки, правила) — і не ловить правильне;
 *   • різниця версій бачить додане, вилучене, змінені поля, застаріле;
 *   • застосована версія — це те, що бачать редактор, теги й правила ядра,
 *     без перезапуску; машинні ID не змінюються від правки назв (№30);
 *     застарілий тип лишається дійсним для наявних тегів, але зникає з
 *     панелі й підказок.
 */
import {
  CORE_ENTITIES,
  CORE_ENTITY_GROUPS,
  CORE_ENTITY_RELATIONS,
  FACTORY_ENTITIES,
  FACTORY_ENTITY_GROUPS,
  FACTORY_ENTITY_RELATIONS,
  activeRegistryLabel,
  entitiesInGroup,
  entityBySlug,
  isRegisteredEntityType,
  parseEntityTags,
  registryRevision,
  relationByKey,
  resetRegistry,
  searchEntities,
  stripEntityTags,
  subscribeRegistry,
} from '../src/utils/coreEntities';
import {
  applyOntology,
  canonicalJson,
  diffOntologies,
  factoryOntology,
  machineId,
  registrySnapshot,
  validateOntology,
  type OntologyDefinition,
} from '../src/utils/ontology';
import { checkNewEntity, checkNewRelation, CoreRuleError } from '../server/core/rules';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const codes = (def: OntologyDefinition) => validateOntology(def).errors.map((e) => e.code);

console.log('Fusion Story Ontology 1.0 — імпорт документа власника:');
const v1 = factoryOntology();
{
  t('118 типів сутностей, 39 зв\'язків, 12 доменних груп A–J3', v1.entityTypes.length === 118 && v1.relationTypes.length === 39 && v1.groups.length === 12,
    `${v1.entityTypes.length} / ${v1.relationTypes.length} / ${v1.groups.length}`);
  t('групи — саме документа (A…I, J1…J3), не вигадані', v1.groups.map((g) => g.id).join(',') === 'A,B,C,D,E,F,G,H,I,J1,J2,J3');
  t('88 базових + 30 критичних; зв\'язки 21 + 16 + 2 часові', v1.entityTypes.filter((e) => e.registry === 'base').length === 88 && v1.entityTypes.filter((e) => e.registry === 'critic').length === 30
    && v1.relationTypes.filter((r) => r.registry === 'spec').length === 2);
  t('сімейства — поле є, у v1.0 порожньо (рішення власника §2 п.3)', Array.isArray(v1.families) && v1.families.length === 0 && v1.entityTypes.every((e) => e.family === null));
  const val = validateOntology(v1);
  t('v1.0 проходить перевірку без помилок і попереджень', val.ok && val.warnings.length === 0, JSON.stringify([...val.errors, ...val.warnings].slice(0, 3)));
  t('усі типи активні; кожен має назви EN/UA, колір, порядок, AI-метадані', v1.entityTypes.every((e) => e.status === 'active' && e.name.en && e.name.uk && /^#[0-9A-F]{6}$/i.test(e.ui.color) && Number.isFinite(e.ui.order) && e.ai && Array.isArray(e.ai.hints)));
  t('зв\'язки мають англійську назву з ключа', v1.relationTypes.find((r) => r.id === 'participates_in')?.name.en === 'Participates in');
  t('обернені зв\'язки: follows ↔ precedes', v1.relationTypes.find((r) => r.id === 'follows')?.inverse === 'precedes' && v1.relationTypes.find((r) => r.id === 'precedes')?.inverse === 'follows');
  t('аліаси власника — у типах («герой», «героїня» → character, «емоція» → emotion)',
    canonicalJson(v1.entityTypes.find((e) => e.id === 'character')?.aliases) === '["герой","героїня"]' && canonicalJson(v1.entityTypes.find((e) => e.id === 'emotion')?.aliases) === '["емоція"]');
  const props = v1.entityTypes.flatMap((e) => e.properties);
  t('характеристики стали властивостями з машинними ID a-z0-9_', props.length > 300 && props.every((p) => /^[a-z][a-z0-9_]*$/.test(p.id) && p.type === 'text'), `${props.length} властивостей`);
  t('ID властивостей унікальні в межах типу', v1.entityTypes.every((e) => new Set(e.properties.map((p) => p.id)).size === e.properties.length));
  t('транслітерація КМУ 2010: Ім’я → imia, Тип → typ, Юрій → yurii, Згода → zghoda, Мета героя → meta_heroia',
    machineId('Ім’я') === 'imia' && machineId('Тип') === 'typ' && machineId('Юрій') === 'yurii' && machineId('Згода') === 'zghoda' && machineId('Мета героя') === 'meta_heroia',
    [machineId('Ім’я'), machineId('Тип'), machineId('Юрій'), machineId('Згода'), machineId('Мета героя')].join(' '));
  t('імпорт детермінований — той самий канонічний JSON', canonicalJson(factoryOntology()) === canonicalJson(v1));
}

console.log('\nВизначення → реєстр: ті самі записи, що в коді:');
{
  const snap = registrySnapshot(v1);
  const strip = (e: { tag: string; slug: string; nameUk: string; nameEn: string; groupId: string; color: string; characteristics: string[]; registry: string }) =>
    canonicalJson({ tag: e.tag, slug: e.slug, nameUk: e.nameUk, nameEn: e.nameEn, groupId: e.groupId, color: e.color, characteristics: e.characteristics, registry: e.registry });
  t('118 типів — ті самі поля й порядок', snap.entities.length === 118 && snap.entities.every((e, i) => strip(e) === strip(FACTORY_ENTITIES[i] as any)));
  t('39 зв\'язків — ті самі', canonicalJson(snap.relations) === canonicalJson(FACTORY_ENTITY_RELATIONS));
  t('12 груп — ті самі', canonicalJson(snap.groups) === canonicalJson(FACTORY_ENTITY_GROUPS));
  t('жодного застарілого', snap.entities.every((e) => !e.deprecated) && snap.relations.every((r) => !r.deprecated));
}

console.log('\nПеревірка ловить зламане визначення:');
{
  const bad = (name: string, mutate: (d: OntologyDefinition) => void, code: string) => {
    const d = clone(v1);
    mutate(d);
    const c = codes(d);
    t(name, c.includes(code), c.slice(0, 4).join(', ') || 'помилок немає');
  };
  bad('машинний ID не в форматі (Character)', (d) => (d.entityTypes[0].id = 'Character'), 'bad_id');
  bad('ID повторюється', (d) => (d.entityTypes[1].id = d.entityTypes[0].id), 'duplicate_id');
  bad('група, якої немає', (d) => (d.entityTypes[0].groupId = 'Z'), 'unknown_group');
  bad('колір не HEX', (d) => (d.entityTypes[0].ui.color = 'red'), 'bad_color');
  bad('без англійської назви (ТЗ §0)', (d) => (d.entityTypes[0].name.en = ' '), 'missing_name');
  bad('без української назви', (d) => (d.relationTypes[0].name.uk = ''), 'missing_name');
  bad('аліас уже веде на інший тип', (d) => d.entityTypes.find((e) => e.id === 'emotion')!.aliases.push('герой'), 'alias_conflict');
  bad('аліас збігається з ID іншого типу', (d) => d.entityTypes.find((e) => e.id === 'emotion')!.aliases.push('character'), 'alias_conflict');
  bad('кінець зв\'язку — невідомий тип', (d) => (d.relationTypes[0].from = ['dragon']), 'unknown_entity_type');
  bad('обернений зв\'язок, якого немає', (d) => (d.relationTypes[0].inverse = 'nope'), 'unknown_relation_type');
  bad('властивість-перелік без переліку', (d) => (d.entityTypes[0].properties[0] = { id: 'kind', name: { uk: 'Вид' }, type: 'enum', enumId: 'missing' }), 'unknown_enum');
  bad('невідомий тип властивості', (d) => ((d.entityTypes[0].properties[0] as any).type = 'blob'), 'bad_property_type');
  bad('сімейство, якого немає', (d) => (d.entityTypes[0].family = 'heroes'), 'unknown_family');
  bad('правило на властивість, якої в типу немає', (d) => d.validationRules.push({ id: 'name_required', kind: 'required_property', target: 'entity', appliesTo: ['character'], params: { property: 'nope' }, message: { en: 'x', uk: 'х' } }), 'bad_rule');
  bad('усі типи застарілі', (d) => d.entityTypes.forEach((e) => (e.status = 'deprecated')), 'no_active_types');
  bad('невідомий статус', (d) => ((d.entityTypes[0] as any).status = 'deleted'), 'bad_status');
  bad('чужий формат', (d) => ((d as any).format = 'other/2'), 'bad_format');
  const ok = clone(v1);
  ok.enums.push({ id: 'arc_kind', name: { en: 'Arc kind', uk: 'Вид арки' }, values: [{ id: 'positive', name: { en: 'Positive', uk: 'Позитивна' } }, { id: 'negative', name: { en: 'Negative', uk: 'Негативна' } }] });
  ok.entityTypes.find((e) => e.id === 'character-arc')!.properties.push({ id: 'arc_kind', name: { uk: 'Вид арки', en: 'Arc kind' }, type: 'enum', enumId: 'arc_kind' });
  ok.families.push({ id: 'people', groupId: 'C', name: { en: 'People', uk: 'Люди' } });
  ok.entityTypes.find((e) => e.id === 'character')!.family = 'people';
  ok.validationRules.push({ id: 'arc_kind_required', kind: 'required_property', target: 'entity', appliesTo: ['character-arc'], params: { property: 'arc_kind' }, message: { en: 'Arc kind is required', uk: 'Потрібен вид арки' } });
  const okv = validateOntology(ok);
  t('перелік, сімейство й правило перевірки — правильні проходять', okv.ok, okv.errors.map((e) => e.path).join(', '));
}

console.log('\nРізниця версій (перегляд перед публікацією):');
{
  const v2 = clone(v1);
  v2.entityTypes.find((e) => e.id === 'character')!.name.uk = 'Герой';
  v2.entityTypes.find((e) => e.id === 'character')!.ui.color = '#112233';
  v2.entityTypes.find((e) => e.id === 'ending')!.status = 'deprecated';
  v2.entityTypes.push({ id: 'prophecy', name: { en: 'Prophecy', uk: 'Пророцтво' }, groupId: 'B', family: null, status: 'active', registry: 'custom', ui: { color: '#7C3AED', order: 118 }, ai: { description: 'Передбачення, що має збутися чи ні.', hints: [] }, properties: [{ id: 'zmist', name: { uk: 'Зміст' }, type: 'text' }], aliases: ['пророцтво'] });
  v2.entityTypes = v2.entityTypes.filter((e) => e.id !== 'mystery');
  v2.relationTypes.push({ id: 'foreshadows', name: { en: 'Foreshadows', uk: 'Передвіщає' }, example: '/prophecy → /event', registry: 'custom', status: 'active', from: ['prophecy'], to: null, inverse: null, ui: { order: 39 } });
  const d = diffOntologies(v1, v2);
  t('додано: prophecy і foreshadows', d.entityTypes.added.join() === 'prophecy' && d.relationTypes.added.join() === 'foreshadows');
  t('вилучено: mystery', d.entityTypes.removed.join() === 'mystery');
  t('змінено character: name.uk і ui.color (ID той самий)', canonicalJson(d.entityTypes.changed.find((c) => c.id === 'character')?.fields) === '["name.uk","ui.color"]', JSON.stringify(d.entityTypes.changed.find((c) => c.id === 'character')));
  t('застаріло: ending', d.entityTypes.deprecated.join() === 'ending');
  t('є зміни; без змін — порожньо', d.changed && !diffOntologies(v1, clone(v1)).changed);
}

console.log('\nЗастосована версія — це реєстр редактора, тегів і правил ядра:');
{
  const before = registryRevision();
  let heard = 0;
  const off = subscribeRegistry(() => heard++);
  t('до застосування — заводський реєстр', activeRegistryLabel() === 'factory' && !isRegisteredEntityType('prophecy'));
  let rejected = '';
  try {
    checkNewEntity({ projectId: 'p', type: 'prophecy', name: 'Пророцтво Сивіли', createdBy: 'user:u1' } as any);
  } catch (e) {
    rejected = (e as CoreRuleError).code;
  }
  t('правила ядра: невідомого типу prophecy ще немає', rejected === 'unknown_entity_type', rejected);

  const v2 = clone(v1);
  const ch = v2.entityTypes.find((e) => e.id === 'character')!;
  ch.name.uk = 'Герой твору';
  ch.ui.color = '#112233';
  v2.entityTypes.find((e) => e.id === 'ending')!.status = 'deprecated';
  v2.entityTypes.push({ id: 'prophecy', name: { en: 'Prophecy', uk: 'Пророцтво' }, groupId: 'B', family: null, status: 'active', registry: 'custom', ui: { color: '#7C3AED', order: 118 }, ai: { description: '', hints: [] }, properties: [{ id: 'zmist', name: { uk: 'Зміст' }, type: 'text' }], aliases: ['віщування'] });
  v2.relationTypes.push({ id: 'foreshadows', name: { en: 'Foreshadows', uk: 'Передвіщає' }, example: '/prophecy → /event', registry: 'custom', status: 'active', from: ['prophecy'], to: null, inverse: null, ui: { order: 39 } });
  applyOntology(v2, 'fusion-story@2');
  t('позначка версії й лічильник змін, слухач почув', activeRegistryLabel() === 'fusion-story@2' && registryRevision() === before + 1 && heard === 1);
  t('UI-метадані з версії: назва й колір character (критерій №5)', entityBySlug('character')?.nameUk === 'Герой твору' && entityBySlug('character')?.color === '#112233');
  t('машинний ID не змінився від правки назви (№30)', entityBySlug('character')?.slug === 'character' && entityBySlug('/character')?.tag === '/character');
  t('новий тип: у реєстрі, у групі B, у пошуку, з характеристикою', isRegisteredEntityType('prophecy') && entitiesInGroup('B').some((e) => e.slug === 'prophecy') && searchEntities('proph')[0]?.slug === 'prophecy' && entityBySlug('prophecy')?.characteristics[0] === 'Зміст');
  t('новий аліас: «віщування» → prophecy; українська назва теж ключ', entityBySlug('віщування')?.slug === 'prophecy' && entityBySlug('пророцтво')?.slug === 'prophecy');
  t('тег нового типу розпізнається й знімається на експорті', parseEntityTags('Вона сказала [/prophecy:Сивіла] тихо.').length === 1 && stripEntityTags('Вона сказала [/prophecy:Сивіла] тихо.') === 'Вона сказала тихо.',
    stripEntityTags('Вона сказала [/prophecy:Сивіла] тихо.'));
  t('«сирий» тег без дужок знімається лише тому, що тип є в реєстрі', !stripEntityTags('Знак /prophecy:Сивіла тут.').includes('/prophecy'), stripEntityTags('Знак /prophecy:Сивіла тут.'));
  t('застарілий ending: наявні теги дійсні (реєстр його знає)', isRegisteredEntityType('ending') && parseEntityTags('[/ending:Відкритий]').length === 1);
  t('…але в панелі групи й у підказках його немає', !entitiesInGroup('B').some((e) => e.slug === 'ending') && !searchEntities('ending').some((e) => e.slug === 'ending'));
  t('масиви реєстру — ті самі об\'єкти, оновлені на місці (119 типів, 40 зв\'язків)', CORE_ENTITIES.length === 119 && CORE_ENTITY_RELATIONS.length === 40 && CORE_ENTITY_GROUPS.length === 12);
  let okEntity = '';
  try {
    okEntity = checkNewEntity({ projectId: 'p', type: 'prophecy', name: 'Пророцтво Сивіли', createdBy: 'user:u1' } as any);
  } catch (e) {
    okEntity = (e as Error).message;
  }
  t('правила ядра приймають prophecy без перезапуску', okEntity === 'confirmed', okEntity);
  let okRel = '';
  try {
    okRel = checkNewRelation({ projectId: 'p', type: 'foreshadows', fromId: 'a', toId: 'b', createdBy: 'user:u1' } as any);
  } catch (e) {
    okRel = (e as Error).message;
  }
  t('…і новий зв\'язок foreshadows', okRel === 'confirmed' && relationByKey('foreshadows')?.nameEn === 'Foreshadows', okRel);

  resetRegistry();
  t('відкат до заводського: 118 / 39, prophecy немає, character — «Персонаж»', CORE_ENTITIES.length === 118 && CORE_ENTITY_RELATIONS.length === 39 && !isRegisteredEntityType('prophecy') && entityBySlug('character')?.nameUk === 'Персонаж' && heard === 2);
  t('після відкату аліас «герой» знову веде на character', entityBySlug('герой')?.slug === 'character' && !entityBySlug('віщування'));
  t('після відкату «сирий» /prophecy:… — звичайний текст, не тег', stripEntityTags('Знак /prophecy:Сивіла тут.').includes('/prophecy:Сивіла'));
  off();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
