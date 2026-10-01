/**
 * Реєстр схем — журнал версій і життєвий цикл (Т5.1 В2, `PLAN_ONTOLOGY.md`;
 * ТЗ Graph Studio §4.5, §39 №1–4). Запуск: npm run test:ontology-lifecycle
 * (з CORE_TEST_DATABASE_URL — ще й на PostgreSQL; схема ядра в цій базі
 * видаляється — лише тестова база!).
 *
 * Сценарій на обох сховищах: імпорт 1.0 → чернетка → правки → перевірка →
 * перегляд → вплив на дані → публікація (руйнівне видалення типу з даними
 * не пускає; застарілий тип — пускає) → реєстр процесу — нова версія →
 * дані, що з'явились між впливом і публікацією, теж блокують → відкат новою
 * версією → архів → журнал аудиту.
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import type { CoreRepository } from '../server/core/types.ts';
import {
  OntologyPublishError,
  archiveVersion,
  bootstrapOntology,
  createDraft,
  definitionHash,
  editDraft,
  impactDraft,
  openDraft,
  previewDraft,
  publishDraft,
  rollbackTo,
  validateDraft,
  type OntologyImpact,
} from '../server/core/ontology/lifecycle.ts';
import { factoryOntology, type OntologyDefinition } from '../src/utils/ontology.ts';
import { activeRegistryLabel, entityBySlug, isRegisteredEntityType, relationByKey, resetRegistry, searchEntities } from '../src/utils/coreEntities.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const ADMIN = 'user:admin-1';
const errOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error & { code?: string; details?: Record<string, unknown> };
  }
};

const PROPHECY = {
  id: 'prophecy',
  name: { en: 'Prophecy', uk: 'Пророцтво' },
  groupId: 'B',
  family: null,
  status: 'active' as const,
  registry: 'custom' as const,
  ui: { color: '#7C3AED', order: 118 },
  ai: { description: 'Передбачення, що збувається чи ні.', hints: [] },
  properties: [{ id: 'zmist', name: { uk: 'Зміст' }, type: 'text' as const }],
  aliases: ['віщування'],
};
const FORESHADOWS = { id: 'foreshadows', name: { en: 'Foreshadows', uk: 'Передвіщає' }, example: '/prophecy → /event', registry: 'custom' as const, status: 'active' as const, from: ['prophecy'], to: null, inverse: null, ui: { order: 39 } };

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<unknown>) {
  console.log(`\n${name} — імпорт 1.0:`);
  resetRegistry();
  const logs: string[] = [];
  const v1 = await bootstrapOntology(repo, (m) => logs.push(m));
  const def1 = v1.definition as unknown as OntologyDefinition;
  t('активна версія 1 «1.0» — імпорт чинного реєстру системою (№1)', v1.version === 1 && v1.status === 'active' && v1.label === '1.0' && v1.createdBy === 'system:ontology-import' && !!v1.publishedAt);
  t('визначення = заводське (118 / 39 / 12), хеш збігається', def1.entityTypes.length === 118 && def1.relationTypes.length === 39 && def1.groups.length === 12 && v1.definitionHash === definitionHash(factoryOntology()));
  t('реєстр процесу — fusion-story@1', activeRegistryLabel() === 'fusion-story@1', activeRegistryLabel());
  const again = await bootstrapOntology(repo);
  t('повторний старт — та сама версія, нової не з\'являється', again.id === v1.id && (await repo.listOntologyVersions('fusion-story')).length === 1);

  // Дані книги: сутність типу mystery з аліасом і згадкою немає — досить сутності й зв'язку.
  await repo.upsertProject({ id: 'onto-p1', ownerId: 'u1', title: 'Маяк' } as any);
  const mystery = await repo.createEntity({ projectId: 'onto-p1', type: 'mystery', name: 'Таємниця маяка', createdBy: 'user:u1' } as any);
  const hero = await repo.createEntity({ projectId: 'onto-p1', type: 'character', name: 'Олена', createdBy: 'user:u1' } as any);
  const rival = await repo.createEntity({ projectId: 'onto-p1', type: 'character', name: 'Марко', createdBy: 'user:u1' } as any);
  await repo.createRelation({ projectId: 'onto-p1', type: 'opposes', fromId: rival.id, toId: hero.id, createdBy: 'user:u1' } as any);
  const usage = await repo.ontologyUsage();
  t('використання типів у книгах рахується (mystery 1, character 2, opposes 1)', usage.entities.mystery === 1 && usage.entities.character === 2 && usage.relations.opposes === 1, JSON.stringify(usage.entities));

  console.log(`\n${name} — чернетка й правки (№2):`);
  const aiErr = await errOf(() => createDraft(repo, { actor: 'ai:AI-1' as any }));
  t('AI схему не змінює', aiErr?.code === 'bad_actor', aiErr?.message);
  const d = await createDraft(repo, { actor: ADMIN, label: '1.1', notes: 'Пророцтво й новий колір героя' });
  t('чернетка: версія 2, статус draft, на основі 1', d.version === 2 && d.status === 'draft' && d.basedOn === v1.id && d.definitionHash === v1.definitionHash);
  t('друга чернетка, поки є відкрита, — конфлікт', (await errOf(() => createDraft(repo, { actor: ADMIN })))?.code === 'conflict');
  t('публікація без перевірки — ні', (await errOf(() => publishDraft(repo, d.id, ADMIN))) instanceof OntologyPublishError);
  const charV1 = def1.entityTypes.find((e) => e.id === 'character')!;
  const e1 = await editDraft(repo, d.id, {
    actor: ADMIN,
    expectedRevision: d.revision,
    ops: [
      { op: 'set_entity_type', value: { ...charV1, name: { en: 'Character', uk: 'Герой твору' }, ui: { ...charV1.ui, color: '#112233' } } },
      { op: 'set_entity_type', value: PROPHECY },
      { op: 'set_relation_type', value: FORESHADOWS },
      { op: 'set_entity_status', id: 'ending', status: 'deprecated' },
      { op: 'remove_entity_type', id: 'mystery' },
      { op: 'remove_relation_type', id: 'unlocks' },
    ],
  });
  t('правки операціями: хеш змінився, ревізія зросла', e1.definitionHash !== d.definitionHash && e1.revision > d.revision);
  t('стара ревізія — конфлікт (чернетку змінено)', (await errOf(() => editDraft(repo, d.id, { actor: ADMIN, expectedRevision: d.revision, ops: [{ op: 'set_name', name: { en: 'X', uk: 'Х' } }] })))?.code === 'conflict');
  t('невідома операція — 422', (await errOf(() => editDraft(repo, d.id, { actor: ADMIN, ops: [{ op: 'drop_table' } as any] })))?.code === 'bad_input');
  t('вилучення того, чого немає, — not_found', (await errOf(() => editDraft(repo, d.id, { actor: ADMIN, ops: [{ op: 'remove_entity_type', id: 'dragon' }] })))?.code === 'not_found');

  console.log(`\n${name} — VALIDATE → PREVIEW → MIGRATION IMPACT (№3):`);
  const bad = await editDraft(repo, d.id, { actor: ADMIN, ops: [{ op: 'set_entity_type', value: { ...PROPHECY, ui: { ...PROPHECY.ui, color: 'violet' } } }] });
  const vbad = await validateDraft(repo, bad.id, ADMIN);
  t('зламаний колір — перевірка не пройдена, статус лишається draft', !vbad.validation.ok && vbad.version.status === 'draft' && vbad.validation.errors.some((e) => e.code === 'bad_color'));
  await editDraft(repo, d.id, { actor: ADMIN, ops: [{ op: 'set_entity_type', value: PROPHECY }] });
  const vok = await validateDraft(repo, d.id, ADMIN);
  t('виправлено — validated', vok.validation.ok && vok.version.status === 'validated');
  const pv = (await previewDraft(repo, d.id)) as any;
  t('перегляд: додано prophecy / foreshadows, вилучено mystery / unlocks, змінено character, застаріло ending',
    pv.diff.entityTypes.added.join() === 'prophecy' && pv.diff.entityTypes.removed.join() === 'mystery' && pv.diff.relationTypes.added.join() === 'foreshadows' && pv.diff.relationTypes.removed.join() === 'unlocks'
      && pv.diff.entityTypes.changed.some((c) => c.id === 'character') && pv.diff.entityTypes.deprecated.join() === 'ending', JSON.stringify(pv.diff.entityTypes));
  t('перегляд UI: character — колір до й після', pv.ui.find((u) => u.id === 'character')?.before?.color === charV1.ui.color && pv.ui.find((u) => u.id === 'character')?.after?.color === '#112233');
  t('публікація без впливу на дані — ні', ((await errOf(() => publishDraft(repo, d.id, ADMIN))) as any)?.details?.step === 'impact');
  const { impact } = await impactDraft(repo, d.id, ADMIN);
  t('вплив: mystery має дані — блокер; unlocks без даних — ні', impact.blockers.map((b) => b.id).join() === 'mystery' && impact.affected.some((a) => a.id === 'unlocks' && !a.blocking), impact.blockers.map((b) => b.message).join(' | '));
  t('вплив: застарілий ending і змінений character — не блокують', impact.affected.some((a) => a.id === 'ending' && a.change === 'deprecated' && !a.blocking) && impact.affected.some((a) => a.id === 'character' && a.change === 'changed'));
  const blocked = await errOf(() => publishDraft(repo, d.id, ADMIN));
  t('руйнівне видалення типу з даними — публікацію не пущено', blocked instanceof OntologyPublishError && /mystery/.test(blocked.message), blocked?.message);
  t('…активна лишилась 1, реєстр — @1', (await repo.getActiveOntologyVersion('fusion-story'))?.version === 1 && activeRegistryLabel() === 'fusion-story@1');

  console.log(`\n${name} — PUBLISH → ACTIVE:`);
  const mysteryV1 = def1.entityTypes.find((e) => e.id === 'mystery')!;
  await editDraft(repo, d.id, { actor: ADMIN, ops: [{ op: 'set_entity_type', value: { ...mysteryV1, status: 'deprecated' } }] });
  t('правка після перевірки скидає validated', (await repo.getOntologyVersion(d.id))?.status === 'draft' && (await repo.getOntologyVersion(d.id))?.validation === null);
  await validateDraft(repo, d.id, ADMIN);
  await impactDraft(repo, d.id, ADMIN);
  const v2 = await publishDraft(repo, d.id, ADMIN);
  t('опубліковано: версія 2 активна, хто й коли', v2.status === 'active' && v2.version === 2 && v2.publishedBy === ADMIN && !!v2.publishedAt);
  t('версія 1 — deprecated, активна одна', (await repo.getOntologyVersion(v1.id))?.status === 'deprecated' && (await repo.listOntologyVersions('fusion-story')).filter((v) => v.status === 'active').length === 1);
  t('реєстр процесу — @2 без перезапуску', activeRegistryLabel() === 'fusion-story@2', activeRegistryLabel());
  t('UI-метадані з реєстру: character «Герой твору», #112233 (№5); ID той самий (№30)', entityBySlug('character')?.nameUk === 'Герой твору' && entityBySlug('character')?.color === '#112233' && entityBySlug('character')?.slug === 'character');
  t('prophecy і foreshadows у реєстрі; unlocks — ні', isRegisteredEntityType('prophecy') && !!relationByKey('foreshadows') && !relationByKey('unlocks'));
  t('mystery застарілий: наявна сутність читається, у підказках його немає', (await repo.getEntity('onto-p1', mystery.id))?.type === 'mystery' && isRegisteredEntityType('mystery') && !searchEntities('myst').some((e) => e.slug === 'mystery'));
  const prophecyEntity = await repo.createEntity({ projectId: 'onto-p1', type: 'prophecy', name: 'Пророцтво Сивіли', createdBy: 'user:u1' } as any);
  t('правила ядра приймають новий тип prophecy', prophecyEntity.type === 'prophecy');
  t('…і не приймають вилучений зв\'язок unlocks', (await errOf(() => repo.createRelation({ projectId: 'onto-p1', type: 'unlocks', fromId: hero.id, toId: rival.id, createdBy: 'user:u1' } as any)))?.code === 'unknown_relation_type');
  t('опубліковане визначення незмінне', (await errOf(() => repo.updateOntologyVersion(v2.id, { definition: { format: 'x' } })))?.code === 'conflict');
  t('правка опублікованої версії як чернетки — конфлікт', (await errOf(() => editDraft(repo, v2.id, { actor: ADMIN, ops: [{ op: 'set_name', name: { en: 'X', uk: 'Х' } }] })))?.code === 'conflict');
  if (raw) {
    const trig = await raw(`UPDATE ${CORE_SCHEMA}.ontology_versions SET definition = '{"x":1}'::jsonb WHERE id = $1`, [v2.id]).then(() => false, () => true);
    t('PostgreSQL: тригер не дає змінити опубліковане визначення навіть SQL-ем', trig);
    const twoActive = await raw(`UPDATE ${CORE_SCHEMA}.ontology_versions SET status = 'active' WHERE id = $1`, [v1.id]).then(() => false, () => true);
    t('PostgreSQL: дві активні версії — індекс не пускає', twoActive);
  }

  console.log(`\n${name} — дані між впливом і публікацією:`);
  const d3 = await createDraft(repo, { actor: ADMIN, label: 'без foreshadows' });
  await editDraft(repo, d3.id, { actor: ADMIN, ops: [{ op: 'remove_relation_type', id: 'foreshadows' }] });
  await validateDraft(repo, d3.id, ADMIN);
  const imp3 = await impactDraft(repo, d3.id, ADMIN);
  t('foreshadows поки без даних — вплив без блокерів', imp3.impact.blockers.length === 0);
  await repo.createRelation({ projectId: 'onto-p1', type: 'foreshadows', fromId: prophecyEntity.id, toId: hero.id, createdBy: 'user:u1' } as any);
  const late = await errOf(() => publishDraft(repo, d3.id, ADMIN));
  t('зв\'язок з\'явився — публікація перераховує вплив і не пускає', late instanceof OntologyPublishError && /foreshadows/.test(late.message), late?.message);
  t('…свіжий вплив збережено з чернеткою', ((await repo.getOntologyVersion(d3.id))?.impact as unknown as OntologyImpact)?.blockers?.[0]?.id === 'foreshadows');
  const discarded = await archiveVersion(repo, d3.id, ADMIN);
  t('чернетку відкинуто — archived, відкритої чернетки немає', discarded.status === 'archived' && !(await openDraft(repo)));

  console.log(`\n${name} — ROLLBACK (№4):`);
  const toV1 = await errOf(() => rollbackTo(repo, v1.id, ADMIN));
  t('відкат до 1 не пускає: prophecy і foreshadows уже мають дані', toV1 instanceof OntologyPublishError && /prophecy/.test(toV1.message) && !!toV1.details?.draftId, toV1?.message);
  await archiveVersion(repo, String(toV1?.details?.draftId), ADMIN);
  const d4 = await createDraft(repo, { actor: ADMIN, label: '1.2' });
  await editDraft(repo, d4.id, { actor: ADMIN, ops: [{ op: 'set_entity_type', value: { ...PROPHECY, ui: { ...PROPHECY.ui, color: '#FF0000' } } }] });
  await validateDraft(repo, d4.id, ADMIN);
  await impactDraft(repo, d4.id, ADMIN);
  const v3 = await publishDraft(repo, d4.id, ADMIN);
  t('опубліковано наступну версію (prophecy червоний)', v3.status === 'active' && entityBySlug('prophecy')?.color === '#FF0000');
  const rb = await rollbackTo(repo, v2.id, ADMIN);
  t('відкат до 2 — НОВА версія з тим самим визначенням', rb.version > v3.version && rb.status === 'active' && rb.definitionHash === v2.definitionHash && rb.basedOn === v2.id, `v${rb.version}`);
  t('після відкату: prophecy знову фіолетовий, реєстр — нова версія', entityBySlug('prophecy')?.color === '#7C3AED' && activeRegistryLabel() === `fusion-story@${rb.version}`);
  t('відкочена версія 3 — deprecated', (await repo.getOntologyVersion(v3.id))?.status === 'deprecated');
  t('відкат до активної — конфлікт', (await errOf(() => rollbackTo(repo, rb.id, ADMIN)))?.code === 'conflict');

  console.log(`\n${name} — архів і журнал аудиту:`);
  t('активну не архівують', (await errOf(() => archiveVersion(repo, rb.id, ADMIN)))?.code === 'conflict');
  const arch = await archiveVersion(repo, v1.id, ADMIN);
  t('застарілу 1 — в архів (визначення й час публікації ті самі)', arch.status === 'archived' && arch.definitionHash === v1.definitionHash && arch.publishedAt === (await repo.getOntologyVersion(v1.id))?.publishedAt);
  const list = await repo.listOntologyVersions('fusion-story');
  t('перелік версій — новіші першими, без визначень', list[0].version === rb.version && list.every((v) => v.definition === null), list.map((v) => `${v.version}:${v.status}`).join(' '));
  const ev = await repo.listOntologyEvents('fusion-story', { limit: 500 });
  const actions = new Set(ev.map((e) => e.action));
  t('журнал аудиту: імпорт, чернетка, правка, перевірка, вплив, публікація, відкат, відкидання, архів',
    ['import', 'create_draft', 'edit', 'validate', 'impact', 'publish', 'rollback', 'discard', 'archive'].every((a) => actions.has(a as any)), [...actions].join(', '));
  t('кожна подія — хто (людина чи система)', ev.every((e) => /^(user|system):/.test(e.actor)));
  t('подія відкату називає, до якої версії', ev.some((e) => e.action === 'rollback' && e.details.to === 2));
  t('журнал події однієї версії', (await repo.listOntologyEvents('fusion-story', { versionId: d.id })).every((e) => e.versionId === d.id));

  resetRegistry();
}

await suite('Пам\'ять', new MemoryCoreRepository());

const pgUrl = process.env.CORE_TEST_DATABASE_URL?.trim();
if (pgUrl) {
  const pool = createCorePool(pgUrl);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — v19 (реєстр схем)', Number(rows[0].v) >= 19, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('реєстр схем на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
