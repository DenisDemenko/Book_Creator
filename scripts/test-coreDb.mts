/**
 * Семантичне ядро в PostgreSQL — задачі Т0.3 і Т0.4 (журнал #247).
 *
 * Один договір `CoreRepository`, дві реалізації — і один набір перевірок для
 * обох. Без бази тест проганяє запускач міграцій (розбір файлів, порядок,
 * контрольні суми) і договір на сховищі в пам'яті. Якщо задано
 * `CORE_TEST_DATABASE_URL` — ще й на справжньому PostgreSQL: міграції на
 * порожню базу, повторний прогін без змін, відмова на зміненій міграції,
 * той самий договір і CHECK-обмеження бази в обхід коду.
 *
 * УВАГА: тест видаляє схему `fusion_core` у базі з CORE_TEST_DATABASE_URL.
 * Вказуйте лише окрему тестову базу.
 *
 * Запуск: npm run test:core-db
 *         CORE_TEST_DATABASE_URL=postgres://… npm run test:core-db
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadMigrations,
  migrationChecksum,
  parseMigrationFileName,
  resolveMigrationsDir,
  runMigrations,
  MigrationError,
  CORE_SCHEMA,
  describePgError,
} from '../server/core/migrate.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { CoreRuleError, normalizeAlias, paragraphTextHash } from '../server/core/rules.ts';
import { createCorePool } from '../server/core/index.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

/** Очікуємо відмову з певним кодом правила. */
async function rejects(name: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    t(name, false, 'запис пройшов, а мав бути відхилений');
  } catch (err) {
    const got = err instanceof CoreRuleError ? err.code : `${(err as Error).name}: ${(err as Error).message}`;
    t(name, got === code, got === code ? '' : `очікували ${code}, отримали ${got}`);
  }
}

// ── 1. Запускач міграцій без бази ─────────────────────────────────────────

console.log('\nМіграції — файли й порядок:');
{
  t('ім\'я файлу розбирається', JSON.stringify(parseMigrationFileName('0002_core_schema.sql')) === '{"version":2,"name":"core_schema"}');
  t('чужі імена відкидаються', parseMigrationFileName('2_core.sql') === null && parseMigrationFileName('0002-core.sql') === null);
  t('CRLF не змінює контрольну суму', migrationChecksum('a;\r\nb;') === migrationChecksum('a;\nb;'));

  const real = loadMigrations(resolveMigrationsDir());
  t('міграції ядра читаються по порядку з 0001', real.map((m) => m.version).join() === real.map((_, i) => i + 1).join() && real.length >= 2,
    real.map((m) => `${m.version}_${m.name}`).join(', '));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-mig-'));
  fs.writeFileSync(path.join(tmp, '0001_a.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(tmp, '0003_c.sql'), 'SELECT 3;');
  let gapError = '';
  try { loadMigrations(tmp); } catch (e) { gapError = e instanceof MigrationError ? e.message : String(e); }
  t('пропуск у номерах зупиняє запуск', /без пропусків/.test(gapError), gapError);
  fs.writeFileSync(path.join(tmp, 'README.sql'), '');
  let nameError = '';
  try { loadMigrations(tmp); } catch (e) { nameError = String((e as Error).message); }
  t('файл не за шаблоном зупиняє запуск', /не відповідає шаблону/.test(nameError), nameError);
  fs.rmSync(tmp, { recursive: true, force: true });
  const noVector = describePgError({ code: '58P01', message: 'could not open extension control file "/usr/share/postgresql/16/extension/vector.control"' });
  t('база без pgvector — зрозуміла підказка', /pgvector/.test(noVector) && /Railway/.test(noVector));
}

// ── 2. Договір сховища — однаковий для пам'яті й PostgreSQL ────────────────

const USER = 'user:author-1';
const AI = 'ai:AI-1';

async function contract(repo: CoreRepository, label: string) {
  console.log(`\nДоговір сховища (${label}):`);
  const P = `book-${label}`;
  const OTHER = `other-${label}`;

  const proj = await repo.upsertProject({ id: P, ownerId: 'author-1', title: 'Книга' });
  t('проєкт = книга: створено з ревізією 0', proj.id === P && proj.revision === 0 && proj.languages.join() === 'uk');
  await repo.upsertProject({ id: OTHER, ownerId: 'author-2', title: 'Чужа книга' });
  t('ревізія книги зростає', (await repo.bumpProjectRevision(P)) === 1 && (await repo.getProject(P))?.revision === 1);
  const again = await repo.upsertProject({ id: P, ownerId: 'author-1' });
  t('повторний upsert не скидає назву й ревізію', again.title === 'Книга' && again.revision === 1);

  await repo.setMember(P, 'u-2', 'editor');
  t('учасник має роль', (await repo.getMemberRole(P, 'u-2')) === 'editor' && (await repo.getMemberRole(OTHER, 'u-2')) === null);
  await repo.setMember(P, 'u-2', 'reader');
  t('роль учасника змінюється', (await repo.getMemberRole(P, 'u-2')) === 'reader');
  await repo.removeMember(P, 'u-2');
  t('учасника прибрано', (await repo.getMemberRole(P, 'u-2')) === null);
  await rejects('невідома роль відхиляється', () => repo.setMember(P, 'u-3', 'boss' as any), 'bad_input');

  // Документи й абзаци
  await repo.upsertDocument({ projectId: P, id: 'ch-1', kind: 'chapter', order: 0, title: 'Глава 1' });
  const sec = await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 0, title: 'Сцена' });
  t('документ створено з версією 1', sec.version === 1 && sec.parentId === 'ch-1');
  const sec2 = await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 3, title: 'Сцена' });
  t('зміна лише порядку документа не додає версії', sec2.version === 1 && sec2.order === 3);
  const sec3 = await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 3, title: 'Сцена біля ріки' });
  t('зміна назви документа — версія 2', sec3.version === 2);

  const p1 = await repo.upsertParagraph({ projectId: P, id: 'p-1', documentId: 'sec-1', order: 0, kind: 'paragraph', text: 'Олена мовчала.' }, USER);
  t('новий абзац — версія 1, changed', p1.changed && p1.row.version === 1 && p1.row.textHash === paragraphTextHash('Олена мовчала.'));
  const same = await repo.upsertParagraph({ projectId: P, id: 'p-1', documentId: 'sec-1', order: 0, kind: 'paragraph', text: 'Олена мовчала.' }, USER);
  t('той самий текст — без нової версії', !same.changed && same.row.version === 1);
  const moved = await repo.upsertParagraph({ projectId: P, id: 'p-1', documentId: 'sec-1', order: 5, kind: 'paragraph', text: 'Олена мовчала.' }, USER);
  t('переміщення абзацу — без нової версії', !moved.changed && moved.row.version === 1 && moved.row.order === 5);
  const edited = await repo.upsertParagraph({ projectId: P, id: 'p-1', documentId: 'sec-1', order: 5, kind: 'paragraph', text: 'Олена довго мовчала.' }, 'system:core_sync');
  t('правка тексту — версія 2', edited.changed && edited.row.version === 2);
  const pv = await repo.listParagraphVersions(P, 'p-1');
  t('історія абзацу: обидві версії з автором', pv.length === 2 && pv[0].text === 'Олена мовчала.' && pv[1].changedBy === 'system:core_sync',
    pv.map((v) => `${v.version}:${v.text}`).join(' | '));
  await repo.upsertParagraph({ projectId: P, id: 'p-2', documentId: 'sec-1', order: 6, kind: 'heading', text: '## Ранок' }, USER);
  await repo.upsertParagraph({ projectId: P, id: 'p-3', documentId: 'sec-1', order: 7, kind: 'paragraph', text: 'Анна пішла.' }, USER);
  t('абзаци документа — у порядку', (await repo.listParagraphs(P, 'sec-1')).map((p) => p.id).join() === 'p-1,p-2,p-3');
  t('видалений абзац зникає з тексту, але лишається в базі',
    (await repo.markParagraphDeleted(P, 'p-2')) && (await repo.listParagraphs(P, 'sec-1')).map((p) => p.id).join() === 'p-1,p-3' && !!(await repo.getParagraph(P, 'p-2'))?.deletedAt);
  const back = await repo.upsertParagraph({ projectId: P, id: 'p-2', documentId: 'sec-1', order: 6, kind: 'heading', text: '## Ранок' }, USER);
  t('абзац, що повернувся в текст, — живий і без нової версії', !back.changed && back.row.deletedAt === null && back.row.version === 1);
  await rejects('абзац у неіснуючому документі відхиляється',
    () => repo.upsertParagraph({ projectId: P, id: 'p-x', documentId: 'nope', order: 0, kind: 'paragraph', text: 'x' }, USER), 'not_found');
  await rejects('невідомий вид блоку відхиляється',
    () => repo.upsertParagraph({ projectId: P, id: 'p-x', documentId: 'sec-1', order: 0, kind: 'poem' as any, text: 'x' }, USER), 'bad_input');
  t('абзац іншої книги не видно', (await repo.getParagraph(OTHER, 'p-1')) === null);

  // Сутності
  const olena = await repo.createEntity({ projectId: P, type: 'character', name: 'Олена', createdBy: USER });
  t('сутність від автора — confirmed, версія 1', olena.status === 'confirmed' && olena.version === 1);
  await rejects('невідомий тип сутності відхиляється', () => repo.createEntity({ projectId: P, type: 'dragon', name: 'X', createdBy: USER }), 'unknown_entity_type');
  await rejects('AI не створює затверджену сутність',
    () => repo.createEntity({ projectId: P, type: 'character', name: 'Марко', status: 'confirmed', createdBy: AI }), 'ai_suggests_only');
  const marko = await repo.createEntity({ projectId: P, type: 'character', name: 'Марко', createdBy: AI });
  t('сутність від AI — suggested', marko.status === 'suggested');
  const markoOk = await repo.setEntityStatus(P, marko.id, 'confirmed', USER, 'автор погодився');
  t('зміна статусу — нова версія', markoOk.status === 'confirmed' && markoOk.version === 2);
  const mv = await repo.listEntityVersions(P, marko.id);
  t('історія сутності: створення й затвердження', mv.length === 2 && mv[0].snapshot.status === 'suggested' && mv[1].snapshot.status === 'confirmed' && mv[1].reason === 'автор погодився' && mv[1].changedBy === USER,
    mv.map((v) => `${v.version}:${v.snapshot.status}`).join(' | '));
  await rejects('AI не змінює статус', () => repo.setEntityStatus(P, olena.id, 'rejected', AI), 'ai_suggests_only');
  await rejects('AI не переписує затверджену сутність',
    () => repo.updateEntity(P, olena.id, { canonical: { age: 40 } }, AI), 'confirmed_is_author_only');
  const olena2 = await repo.updateEntity(P, olena.id, { canonical: { age: 34 } }, USER, 'вік');
  t('автор змінює затверджене — нова версія', olena2.version === 2 && (olena2.canonical as any).age === 34);
  t('сутність іншої книги «не існує»', (await repo.getEntity(OTHER, olena.id)) === null);
  await rejects('статус сутності в чужому проєкті не змінити', () => repo.setEntityStatus(OTHER, olena.id, 'rejected', USER), 'not_found');
  t('неправильний id — просто «не знайдено»', (await repo.getEntity(P, 'not-a-uuid')) === null);
  t('сутності за типом', (await repo.listEntities(P, 'character')).length === 2 && (await repo.listEntities(OTHER)).length === 0);

  // Псевдоніми
  await repo.addAlias(P, olena.id, '/character:Olena', 'tag');
  await repo.addAlias(P, olena.id, 'Олена', 'name');
  await repo.addAlias(P, olena.id, '  олена  ', 'name');
  t('псевдоніми ведуть до одного id (регістр і пробіли не важать)',
    (await repo.resolveAlias(P, 'character', 'ОЛЕНА')) === olena.id && (await repo.resolveAlias(P, 'character', '/character:olena')) === olena.id);
  t('псевдонім не працює в іншій книзі й іншому типі',
    (await repo.resolveAlias(OTHER, 'character', 'Олена')) === null && (await repo.resolveAlias(P, 'location', 'Олена')) === null);
  await rejects('той самий псевдонім для іншої сутності відхиляється', () => repo.addAlias(P, marko.id, 'Олена'), 'duplicate_alias');
  t('нормалізація псевдоніма', normalizeAlias('  Сергій   Петрович ') === 'сергій петрович');

  // Згадки
  const ms = await repo.replaceParagraphMentions(P, 'p-1', [
    { entityId: olena.id, spanStart: 0, spanEnd: 5, source: 'tag', subjectEntityId: olena.id, fields: { value: 'мовчання' } },
    { entityId: marko.id, spanStart: 10, spanEnd: 15, source: 'ai' },
  ]);
  t('згадки абзацу записано; AI-згадка — suggested', ms.length === 2 && ms[1].status === 'suggested' && ms[0].status === 'confirmed');
  await repo.replaceParagraphMentions(P, 'p-1', [{ entityId: olena.id, spanStart: 0, spanEnd: 5, source: 'tag' }]);
  t('повторний розбір абзацу замінює згадки, а не дописує',
    (await repo.listMentionsByEntity(P, olena.id)).length === 1 && (await repo.listMentionsByEntity(P, marko.id)).length === 0);
  await rejects('згадка в неіснуючому абзаці відхиляється',
    () => repo.replaceParagraphMentions(P, 'nope', [{ entityId: olena.id, spanStart: 0, spanEnd: 1, source: 'tag' }]), 'not_found');
  const foreign = await repo.createEntity({ projectId: OTHER, type: 'character', name: 'Чужий', createdBy: 'user:author-2' });
  await rejects('згадка не може вести на сутність іншої книги',
    () => repo.replaceParagraphMentions(P, 'p-1', [{ entityId: foreign.id, spanStart: 0, spanEnd: 1, source: 'tag' }]), 'not_found');
  await rejects('суб\'єкт згадки з іншої книги відхиляється',
    () => repo.replaceParagraphMentions(P, 'p-1', [{ entityId: olena.id, spanStart: 0, spanEnd: 1, source: 'tag', subjectEntityId: foreign.id }]), 'not_found');
  await rejects('неправильний діапазон згадки відхиляється',
    () => repo.replaceParagraphMentions(P, 'p-1', [{ entityId: olena.id, spanStart: 5, spanEnd: 2, source: 'tag' }]), 'bad_input');

  // Зв'язки
  await rejects('невідомий тип зв\'язку відхиляється',
    () => repo.createRelation({ projectId: P, type: 'hates_forever', fromId: olena.id, toId: marko.id, createdBy: USER }), 'unknown_relation_type');
  await rejects('зв\'язок від AI без доказу відхиляється',
    () => repo.createRelation({ projectId: P, type: 'follows', fromId: olena.id, toId: marko.id, createdBy: AI }), 'evidence_required');
  const rel = await repo.createRelation({ projectId: P, type: 'follows', fromId: olena.id, toId: marko.id, evidence: ['p-1'], createdBy: AI });
  t('зв\'язок від AI з доказом — suggested', rel.status === 'suggested' && rel.evidence.join() === 'p-1');
  const relOk = await repo.setRelationStatus(P, rel.id, 'confirmed', USER);
  t('зміна статусу зв\'язку — нова версія', relOk.version === 2 && (await repo.listRelationVersions(P, rel.id)).length === 2);
  await rejects('зв\'язок на сутність іншої книги відхиляється',
    () => repo.createRelation({ projectId: P, type: 'follows', fromId: olena.id, toId: foreign.id, createdBy: USER }), 'not_found');
  t('зв\'язки сутності', (await repo.listRelations(P, marko.id)).length === 1 && (await repo.listRelations(OTHER)).length === 0);

  // Прогони й висновки
  const run = await repo.createRun({ projectId: P, role: 'AI-2', module: 'continuity', model: 'test-model', inputs: [{ paragraphId: 'p-1', hash: edited.row.textHash }], createdBy: USER });
  t('прогін AI записано з вхідними абзацами', run.status === 'running' && run.inputs[0].paragraphId === 'p-1');
  const done = await repo.finishRun(P, run.id, { status: 'done', cost: { inputTokens: 120, outputTokens: 40 } });
  t('прогін завершено з витратою', done.status === 'done' && (done.cost as any).inputTokens === 120 && !!done.finishedAt);
  await rejects('невідома роль AI відхиляється', () => repo.createRun({ projectId: P, role: 'AI-9' as any, module: 'x', createdBy: USER }), 'bad_input');

  await rejects('висновок AI без доказу відхиляється (Т0.4)',
    () => repo.addFinding({ projectId: P, runId: run.id, entityId: olena.id, kind: 'trait', payload: { trait: 'мовчазна' }, createdBy: AI }), 'evidence_required');
  await rejects('AI не може одразу затвердити висновок',
    () => repo.addFinding({ projectId: P, kind: 'trait', sourceParagraphIds: ['p-1'], status: 'confirmed', createdBy: AI }), 'ai_suggests_only');
  const vague = await repo.addFinding({ projectId: P, kind: 'trait', insufficientData: true, createdBy: AI });
  t('висновок без доказу — лише з позначкою «недостатньо даних»', vague.insufficientData && vague.status === 'suggested');
  const f = await repo.addFinding({
    projectId: P, runId: run.id, entityId: olena.id, kind: 'trait', payload: { trait: 'мовчазна' },
    sourceParagraphIds: ['p-1'], sourceRevision: 1, validStoryTime: { from: 'глава 1' }, visibility: 'author', createdBy: AI,
  });
  t('висновок AI з доказом — suggested, з ревізією й часом історії',
    f.status === 'suggested' && f.sourceRevision === 1 && f.validStoryTime?.from === 'глава 1' && f.visibility === 'author' && f.version === 1);
  t('висновок від автора без доказу дозволено', (await repo.addFinding({ projectId: P, kind: 'note', createdBy: USER })).status === 'confirmed');
  await rejects('висновок про сутність іншої книги відхиляється',
    () => repo.addFinding({ projectId: P, entityId: foreign.id, kind: 'trait', sourceParagraphIds: ['p-1'], createdBy: AI }), 'not_found');

  t('правка абзацу позначає залежні висновки «на перегляд»', (await repo.markFindingsNeedReview(P, ['p-1', 'p-9'])) === 1 && (await repo.getFinding(P, f.id))?.needsReview === true);
  t('повторна позначка нічого не рахує двічі', (await repo.markFindingsNeedReview(P, ['p-1'])) === 0);
  t('чужа книга не зачіпається', (await repo.markFindingsNeedReview(OTHER, ['p-1'])) === 0);
  const fOk = await repo.setFindingStatus(P, f.id, 'confirmed', USER, 'перевірено');
  t('затвердження висновку — версія 2 і знята позначка', fOk.status === 'confirmed' && fOk.version === 2 && !fOk.needsReview);
  const fv = await repo.listFindingVersions(P, f.id);
  t('історія висновку', fv.length === 2 && fv[0].snapshot.status === 'suggested' && fv[1].snapshot.status === 'confirmed', fv.map((v) => v.snapshot.status).join());
  await rejects('AI не затверджує висновок', () => repo.setFindingStatus(P, vague.id, 'confirmed', AI), 'ai_suggests_only');
  t('висновки за сутністю й статусом',
    (await repo.listFindings(P, { entityId: olena.id })).length === 1 && (await repo.listFindings(P, { status: 'suggested' })).length === 1);
  t('висновок іншої книги не видно', (await repo.getFinding(OTHER, f.id)) === null);
}

await contract(new MemoryCoreRepository(), 'memory');

// ── 3. Справжній PostgreSQL ────────────────────────────────────────────────

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — договір перевірено на сховищі в пам\'яті');
} else {
  console.log('\nPostgreSQL — міграції на порожню базу:');
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    const migrations = loadMigrations(resolveMigrationsDir());
    const first = await runMigrations(pool, migrations);
    t('усі міграції накотились на порожню базу', first.applied.join() === migrations.map((m) => m.version).join(), first.applied.join());
    const second = await runMigrations(pool, migrations);
    t('повторний прогін нічого не робить', second.applied.length === 0 && second.alreadyApplied.length === migrations.length);
    const both = await Promise.all([runMigrations(pool, migrations), runMigrations(pool, migrations)]);
    t('два одночасні прогони не заважають один одному', both.every((r) => r.applied.length === 0));

    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1`, [CORE_SCHEMA]);
    const names = tables.rows.map((r: any) => r.table_name);
    const expected = ['projects', 'project_members', 'documents', 'paragraphs', 'paragraph_versions', 'entities', 'entity_versions',
      'entity_aliases', 'entity_mentions', 'entity_relations', 'entity_relation_versions', 'analysis_runs', 'analysis_findings',
      'analysis_finding_versions', 'core_schema_migrations'];
    t('усі таблиці схеми на місці', expected.every((n) => names.includes(n)), `${names.length} таблиць`);
    const vec = await pool.query(`SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector AS d`);
    t('pgvector працює через шлях пошуку', Number(vec.rows[0].d) === 1);
    const pub = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects'`);
    t('у public таблиць ядра немає (схема окрема)', pub.rows[0].n === 0);

    const tampered = migrations.map((m) => (m.version === 1 ? { ...m, sql: m.sql + '\n-- змінено', checksum: migrationChecksum(m.sql + '\n-- змінено') } : m));
    let tamperError = '';
    try { await runMigrations(pool, tampered); } catch (e) { tamperError = (e as Error).message; }
    t('змінену накочену міграцію не приймає', /змінено після того/.test(tamperError), tamperError);
    let olderError = '';
    try { await runMigrations(pool, migrations.slice(0, 1)); } catch (e) { olderError = (e as Error).message; }
    t('код, старіший за базу, зупиняється', /код старіший за базу/.test(olderError), olderError);

    const repo = new PgCoreRepository(pool);
    await contract(repo, 'postgres');

    console.log('\nPostgreSQL — обмеження самої бази (в обхід коду):');
    await pool.query(`INSERT INTO projects (id, owner_id) VALUES ('raw', 'x')`);
    let rawErr = '';
    try {
      await pool.query(`INSERT INTO analysis_findings (project_id, kind, created_by) VALUES ('raw', 'trait', 'ai:AI-2')`);
    } catch (e: any) { rawErr = e.constraint ?? e.message; }
    t('база не приймає AI-висновок без доказу навіть напряму', rawErr === 'analysis_findings_ai_evidence', rawErr);
    let actorErr = '';
    try {
      await pool.query(`INSERT INTO analysis_findings (project_id, kind, created_by) VALUES ('raw', 'trait', 'robot')`);
    } catch (e: any) { actorErr = e.code; }
    t('база не приймає автора без префікса', actorErr === '23514', actorErr);
    const e1 = await pool.query(`INSERT INTO entities (project_id, type, name, created_by) VALUES ('raw', 'character', 'A', 'user:x') RETURNING id`);
    let crossErr = '';
    try {
      await pool.query(`INSERT INTO entity_relations (project_id, type, from_id, to_id, created_by) VALUES ($1, 'follows', $2, $2, 'user:x')`,
        ['book-postgres', e1.rows[0].id]);
    } catch (e: any) { crossErr = e.code; }
    t('база не дає зв\'язати сутність чужої книги (складений ключ)', crossErr === '23503', crossErr);
    await pool.query(`DELETE FROM projects WHERE id = 'raw'`);
    const left = await pool.query(`SELECT count(*)::int AS n FROM entities WHERE project_id = 'raw'`);
    t('видалення проєкту прибирає його записи', left.rows[0].n === 0);
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
