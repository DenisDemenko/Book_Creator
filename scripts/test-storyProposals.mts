/**
 * Реєстр пропозицій до канону (Т5.3 В1, `PLAN_STORY_CORE.md`; ТЗ Graph
 * Studio §24 стани, §25 походження, §39 №14–16).
 * Запуск: npm run test:story-proposals (з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { bootstrapOntology, createDraft, editDraft, impactDraft, publishDraft, resetActiveRegistry, validateDraft } from '../server/core/ontology/lifecycle.ts';
import * as S from '../server/core/storyCore/proposals.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const errOf = async (f: () => Promise<unknown>): Promise<any> => {
  try { await f(); return null; } catch (e) { return e; }
};
const ADMIN = 'user:u-admin';
const AUTHOR = 'user:u-author';
const AI = 'ai:AI-1';
const P = 'book-proposals';

/** Онтологія v2: тип «пророцтво» з обовʼязковою, переліковою й посилальною властивістю; зв'язок з кінцями; правило; застарілий тип. */
async function publishTestOntology(repo: CoreRepository) {
  const d = await createDraft(repo, { actor: ADMIN, label: 'Т5.3 тест' });
  await editDraft(repo, d.id, {
    actor: ADMIN,
    ops: [
      { op: 'set_enum', value: { id: 'prophecy_kind', name: { en: 'Prophecy kind', uk: 'Вид пророцтва' }, values: [{ id: 'true_one', name: { en: 'True', uk: 'Справжнє' } }, { id: 'false_one', name: { en: 'False', uk: 'Хибне' } }] } },
      {
        op: 'set_entity_type',
        value: {
          id: 'prophecy', name: { en: 'Prophecy', uk: 'Пророцтво' }, groupId: 'B', family: null, status: 'active', registry: 'custom', ui: { color: '#7C3AED', order: 118 },
          ai: { description: 'Передбачення.', hints: [] },
          properties: [
            { id: 'zmist', name: { uk: 'Зміст' }, type: 'text', required: true },
            { id: 'vyd', name: { uk: 'Вид' }, type: 'enum', enumId: 'prophecy_kind' },
            { id: 'avtor', name: { uk: 'Хто виголосив' }, type: 'entity_ref', refTypes: ['character'] },
            { id: 'rik', name: { uk: 'Рік' }, type: 'number' },
          ],
          aliases: [],
        },
      },
      { op: 'set_relation_type', value: { id: 'foreshadows', name: { en: 'Foreshadows', uk: 'Передвіщає' }, example: '/prophecy → /event', registry: 'custom', status: 'active', from: ['prophecy'], to: ['event'], inverse: null, ui: { order: 39 } } },
      { op: 'set_rule', value: { id: 'performer_is_person', kind: 'relation_endpoints', target: 'relation', appliesTo: ['performs'], params: { from: ['character'] }, message: { en: 'Only characters perform', uk: 'Виконує дію лише персонаж' } } },
      { op: 'set_entity_status', id: 'ending', status: 'deprecated' },
    ] as any,
  });
  const v = await validateDraft(repo, d.id, ADMIN);
  if (!v.validation.ok) throw new Error('тестова онтологія невалідна: ' + JSON.stringify(v.validation.errors));
  await impactDraft(repo, d.id, ADMIN);
  return publishDraft(repo, d.id, ADMIN);
}

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<any>) {
  console.log(`\n${name} — створення й походження (§25):`);
  resetActiveRegistry();
  await bootstrapOntology(repo);
  const onto = await publishTestOntology(repo);
  t('тестова онтологія v2 опублікована', onto.version === 2);

  await repo.upsertProject({ id: P, ownerId: 'u-author', title: 'Пропозиції' });
  await repo.upsertDocument({ projectId: P, id: 'ch-1', kind: 'chapter', order: 0, title: 'Глава 1' });
  await repo.upsertDocument({ projectId: P, id: 'sec-1', kind: 'section', parentId: 'ch-1', order: 0, title: 'Сцена' });
  await repo.upsertParagraph({ projectId: P, id: 'p1', documentId: 'sec-1', order: 0, kind: 'paragraph', text: 'Оракул сказав Анні: місто впаде.' }, AUTHOR);
  await repo.upsertParagraph({ projectId: P, id: 'p2', documentId: 'sec-1', order: 1, kind: 'paragraph', text: 'І місто впало в ніч облоги.' }, AUTHOR);
  const anna = await repo.createEntity({ projectId: P, type: 'character', name: 'Анна', createdBy: AUTHOR });
  const oracle = await repo.createEntity({ projectId: P, type: 'character', name: 'Оракул', createdBy: AUTHOR });
  const fall = await repo.createEntity({ projectId: P, type: 'event', name: 'Падіння міста', createdBy: AUTHOR });
  const city = await repo.createEntity({ projectId: P, type: 'location', name: 'Місто', createdBy: AUTHOR });
  const run = await repo.createRun({ projectId: P, role: 'AI-1', module: 'coreMentions', model: 'gemini-2.5-flash', promptVersion: 'ai1-v3', createdBy: 'system:core' });

  // AI → PROPOSAL (№14)
  t('AI без доказу — не пропонує (evidence_required)', (await errOf(() => S.createProposal(repo, { projectId: P, kind: 'entity', payload: { type: 'prophecy', name: 'Падіння міста' }, actor: AI })))?.code === 'evidence_required');
  t('AI не створює одразу «перевіреної» пропозиції', (await errOf(() => repo.addStoryProposal({ projectId: P, kind: 'entity', payload: { type: 'prophecy', name: 'X', canonical: {} }, dedupeKey: 'entity:prophecy:x', state: 'validated' as any, evidence: ['p1'], createdBy: AI })))?.code === 'ai_suggests_only');
  const ai1 = await S.createProposal(repo, {
    projectId: P, kind: 'entity', actor: AI, evidence: ['p1'], confidence: 0.82,
    payload: { type: 'prophecy', name: 'Пророцтво про падіння', canonical: { zmist: 'Місто впаде', vyd: 'true_one', avtor: oracle.id } },
    provenance: { runId: run.id, workflowId: 'canon_pipeline', workflowVersion: 3, nodeId: 'extract', jevDecisions: [{ node: 'decide', choice: 'propose', score: 0.82 }] },
  });
  t('AI створює пропозицію: стан proposed, автор ai:AI-1', ai1.state === 'proposed' && ai1.createdBy === AI && ai1.kind === 'entity');
  t('походження: процес, вузол, версія онтології, модель і промпт з прогону, рішення Jev (§25)',
    ai1.provenance.source === 'workflow' && ai1.provenance.workflowVersion === 3 && ai1.provenance.nodeId === 'extract' && ai1.provenance.ontologyVersion === 2
      && ai1.provenance.model === 'gemini-2.5-flash' && ai1.provenance.promptVersion === 'ai1-v3' && (ai1.provenance.jevDecisions as any)?.[0]?.choice === 'propose',
    JSON.stringify(ai1.provenance));
  t('впевненість і докази збережено', ai1.confidence === 0.82 && ai1.evidence.join() === 'p1');
  t('ключ дубля — тип + нормалізована назва', ai1.dedupeKey === 'entity:prophecy:пророцтво про падіння');
  t('та сама пропозиція вдруге — 409 (одна відкрита на ключ)', (await errOf(() => S.createProposal(repo, { projectId: P, kind: 'entity', actor: AI, evidence: ['p2'], payload: { type: 'prophecy', name: '  ПРОРОЦТВО  про падіння ' } })))?.code === 'conflict');
  t('AI не змінює стану пропозиції', (await errOf(() => S.validateProposal(repo, P, ai1.id, AI)))?.code === 'ai_suggests_only');
  t('AI не схвалює', (await errOf(() => S.approveProposal(repo, P, ai1.id, { actor: AI })))?.code === 'ai_suggests_only');
  const det = await S.createProposal(repo, { projectId: P, kind: 'relation', actor: AI, evidence: ['p2'], state: 'detected', confidence: 0.3, payload: { type: 'leads_to', fromId: anna.id, toId: fall.id } });
  t('AI може лишити пропозицію «виявленою» (нижче порогу)', det.state === 'detected' && det.provenance.source === 'ai');
  t('виявлене не схвалюється напряму', (await errOf(() => repo.updateStoryProposal(P, det.id, { state: 'approved' }, AUTHOR)))?.code === 'conflict');
  const promoted = await S.promoteProposal(repo, P, det.id, AUTHOR);
  t('detected → proposed (людина висуває)', promoted.state === 'proposed');

  console.log(`\n${name} — перевірка щодо активної онтології:`);
  const v1 = await S.validateProposal(repo, P, ai1.id, AUTHOR);
  t('валідна пропозиція → validated, з версією онтології', v1.state === 'validated' && v1.validation?.ok === true && v1.validation.ontologyVersion === 2, JSON.stringify(v1.validation?.errors));
  const codes = async (kind: 'entity' | 'relation', payload: any, evidence: string[] = []) =>
    (await S.validatePayload(repo, { projectId: P, kind, payload: S.normalizePayload(kind, payload), evidence })).errors.map((e) => e.code);
  t('невідомий тип сутності', (await codes('entity', { type: 'dragon_type', name: 'X' })).includes('unknown_entity_type'));
  t('застарілий тип — нових не створюють', (await codes('entity', { type: 'ending', name: 'Фінал' })).includes('deprecated_entity_type'));
  t('обовʼязкова властивість не заповнена', (await codes('entity', { type: 'prophecy', name: 'Без змісту' })).includes('required_property'));
  t('значення поза переліком', (await codes('entity', { type: 'prophecy', name: 'П2', canonical: { zmist: 'х', vyd: 'maybe' } })).includes('bad_enum_value'));
  t('посилання на сутність не того типу', (await codes('entity', { type: 'prophecy', name: 'П3', canonical: { zmist: 'х', avtor: city.id } })).includes('bad_entity_ref'));
  t('число — лише число', (await codes('entity', { type: 'prophecy', name: 'П4', canonical: { zmist: 'х', rik: 'давно' } })).includes('bad_property'));
  t('доказ — лише живий абзац цієї книги', (await codes('entity', { type: 'prophecy', name: 'П5', canonical: { zmist: 'х' } }, ['p404'])).includes('missing_evidence'));
  t('дубль у каноні', (await codes('entity', { type: 'character', name: ' анна ' })).includes('duplicate_entity'));
  const unk = await S.validatePayload(repo, { projectId: P, kind: 'entity', payload: S.normalizePayload('entity', { type: 'prophecy', name: 'П6', canonical: { zmist: 'х', kolir: 'синій' } }), evidence: [] });
  t('невідома властивість — лише попередження', unk.ok && unk.warnings.some((w) => w.code === 'unknown_property'));
  t('кінці зв\'язку з онтології (from/to)', (await codes('relation', { type: 'foreshadows', fromId: anna.id, toId: fall.id })).includes('bad_endpoint'));
  t('правило relation_endpoints з онтології', (await codes('relation', { type: 'performs', fromId: city.id, toId: fall.id })).includes('rule_relation_endpoints'));
  t('невідомий тип зв\'язку', (await codes('relation', { type: 'loves_secretly', fromId: anna.id, toId: oracle.id })).includes('unknown_relation_type'));
  t('зв\'язок сам із собою', (await codes('relation', { type: 'opposes', fromId: anna.id, toId: anna.id })).includes('self_relation'));
  t('неіснуюча сутність на кінці', (await codes('relation', { type: 'opposes', fromId: anna.id, toId: '00000000-0000-0000-0000-000000000000' })).includes('unknown_to'));
  await repo.createRelation({ projectId: P, type: 'opposes', fromId: anna.id, toId: oracle.id, createdBy: AUTHOR });
  t('дубль зв\'язку в каноні', (await codes('relation', { type: 'opposes', fromId: anna.id, toId: oracle.id })).includes('duplicate_relation'));
  t('валідний зв\'язок — без помилок', (await codes('relation', { type: 'participates_in', fromId: anna.id, toId: fall.id })).length === 0);
  const bad = await S.createProposal(repo, { projectId: P, kind: 'entity', actor: AUTHOR, payload: { type: 'prophecy', name: 'Неповне пророцтво' }, validate: true });
  t('невдала перевірка — лишається proposed, помилки збережено', bad.state === 'proposed' && bad.validation?.ok === false && bad.validation.errors.some((e) => e.code === 'required_property'));
  t('неперевірене не схвалюється', (await errOf(() => S.approveProposal(repo, P, bad.id, { actor: AUTHOR })))?.code === 'bad_input');

  console.log(`\n${name} — Human Review: Accept / Edit / Reject (№15) і запис у канон (№16):`);
  // Edit: автор виправляє зміст при схваленні.
  const appr = await S.approveProposal(repo, P, ai1.id, { actor: AUTHOR, edits: { payload: { name: 'Пророцтво Оракула', canonical: { zmist: 'Місто впаде в ніч облоги', vyd: 'true_one', avtor: oracle.id } } }, reason: 'уточнив назву' });
  const ap = appr.proposal;
  t('схвалення з правкою автора: approved, хто вирішив', ap.state === 'approved' && ap.decidedBy === AUTHOR && !!ap.decidedAt && ap.reason === 'уточнив назву');
  t('правка автора: що було → що стало, поля', ap.authorEdit?.fields.includes('name') && ap.authorEdit.fields.includes('canonical.zmist') && (ap.authorEdit.before as any).name === 'Пророцтво про падіння' && (ap.authorEdit.after as any).name === 'Пророцтво Оракула', JSON.stringify(ap.authorEdit));
  t('ключ дубля оновлено за новою назвою', ap.dedupeKey === 'entity:prophecy:пророцтво оракула');
  const w = await S.writeCanon(repo, P, ai1.id, { actor: AUTHOR });
  const ent = await repo.getEntity(P, w.recordId);
  t('write_canon: нова підтверджена сутність від імені людини', w.created && ent?.status === 'confirmed' && ent.createdBy === AUTHOR && ent.name === 'Пророцтво Оракула' && (ent.canonical as any).zmist === 'Місто впаде в ніч облоги');
  t('пропозиція — canon з посиланням на запис', w.proposal.state === 'canon' && w.proposal.canonRef === w.recordId);
  t('канон незмінний: повторний запис — 409', (await errOf(() => S.writeCanon(repo, P, ai1.id, { actor: AUTHOR })))?.code === 'conflict');
  t('кінцевий стан незмінний (і правка, і відхилення)', (await errOf(() => S.rejectProposal(repo, P, ai1.id, { actor: AUTHOR })))?.code === 'conflict' && (await errOf(() => S.editProposal(repo, P, ai1.id, { actor: AUTHOR, payload: { name: 'Інше' } })))?.code === 'conflict');
  const ev = await repo.listStoryProposalEvents(P, { proposalId: ai1.id });
  t('журнал: create → validate → edit → validate → approve → write_canon', ev.map((e) => e.action).join() === 'create,validate,edit,validate,approve,write_canon', ev.map((e) => e.action).join());
  const wc = ev.at(-1)!;
  t('аудит запису в канон: хто, запис, походження, правка автора (№16)', wc.actor === AUTHOR && wc.details.recordId === w.recordId && (wc.details.provenance as any)?.runId === run.id && (wc.details.authorEdit as string[]).includes('name') && wc.fromState === 'approved' && wc.toState === 'canon');

  // Зв'язок до нової сутності — одразу схвалити й записати в канон.
  const rel = await S.createProposal(repo, { projectId: P, kind: 'relation', actor: AI, evidence: ['p1', 'p2'], payload: { type: 'foreshadows', fromId: w.recordId, toId: fall.id, note: 'збувається' }, validate: true });
  t('AI-пропозиція з перевіркою: перевіряє система, стан validated', rel.state === 'validated', JSON.stringify(rel.validation?.errors));
  const vev = (await repo.listStoryProposalEvents(P, { proposalId: rel.id })).find((e) => e.action === 'validate');
  t('…і в журналі перевірку записала система, не AI', vev?.actor === 'system:story-core');
  const both = await S.approveProposal(repo, P, rel.id, { actor: ADMIN, writeCanon: true });
  const relRow = (await repo.listRelations(P, w.recordId)).find((r) => r.id === both.canon?.recordId);
  t('approve + write_canon одним кроком: підтверджений зв\'язок із доказами пропозиції', both.proposal.state === 'canon' && relRow?.status === 'confirmed' && relRow.evidence.join() === 'p1,p2' && relRow.note === 'збувається' && relRow.createdBy === ADMIN);

  // Пропозиція AI-1 у старому реєстрі (suggested-зв'язок) — запис у канон підтверджує її, не дублює.
  const old = await repo.createRelation({ projectId: P, type: 'participates_in', fromId: anna.id, toId: fall.id, evidence: ['p2'], createdBy: AI });
  const viaNew = await S.createProposal(repo, { projectId: P, kind: 'relation', actor: AUTHOR, payload: { type: 'participates_in', fromId: anna.id, toId: fall.id }, validate: true });
  t('наявна пропозиція AI-1 — лише попередження', viaNew.state === 'validated' && viaNew.validation!.warnings.some((x) => x.code === 'suggested_relation_exists'));
  const conf = await S.approveProposal(repo, P, viaNew.id, { actor: AUTHOR, writeCanon: true });
  t('…запис у канон підтверджує той самий запис AI-1 (без дубля)', conf.canon?.recordId === old.id && conf.canon.created === false && (await repo.listRelations(P, anna.id)).filter((r) => r.type === 'participates_in').length === 1 && (await repo.listRelations(P, anna.id)).find((r) => r.id === old.id)?.status === 'confirmed');

  // Уточнення наявної сутності — нова ревізія ядра.
  const edit = await S.createProposal(repo, { projectId: P, kind: 'entity', actor: AI, evidence: ['p1'], payload: { type: 'character', name: 'Анна', canonical: { rol: 'слухачка пророцтва' }, targetId: anna.id }, validate: true });
  t('уточнення сутності: ключ — entity-edit:<id>, не дубль', edit.dedupeKey === `entity-edit:${anna.id}` && edit.state === 'validated', JSON.stringify(edit.validation?.errors));
  const ew = await S.approveProposal(repo, P, edit.id, { actor: AUTHOR, writeCanon: true });
  const annaNow = (await repo.getEntity(P, anna.id))!;
  const versions = await repo.listEntityVersions(P, anna.id);
  t('write_canon уточнення: та сама сутність, нова ревізія з причиною-пропозицією', ew.canon?.recordId === anna.id && !ew.canon.created && annaNow.version === anna.version + 1 && (annaNow.canonical as any).rol === 'слухачка пророцтва' && versions.some((v) => v.reason.includes(edit.id)));

  // Reject
  const rj = await S.rejectProposal(repo, P, bad.id, { actor: AUTHOR, reason: 'не пророцтво' });
  t('відхилення: rejected, причина, хто', rj.state === 'rejected' && rj.reason === 'не пророцтво' && rj.decidedBy === AUTHOR);
  t('після відхилення той самий ключ знову відкритий для нової пропозиції', (await S.createProposal(repo, { projectId: P, kind: 'entity', actor: AUTHOR, payload: { type: 'prophecy', name: 'Неповне пророцтво', canonical: { zmist: 'тепер повне' } } })).state === 'proposed');

  console.log(`\n${name} — заміна (SUPERSEDED) і канон, що змінився:`);
  const s1 = await S.createProposal(repo, { projectId: P, kind: 'relation', actor: AI, evidence: ['p1'], confidence: 0.4, payload: { type: 'opposes', fromId: oracle.id, toId: anna.id } });
  const sup = await S.supersedeProposal(repo, P, s1.id, { actor: AI, by: 'system:workflow-run', evidence: ['p1', 'p2'], confidence: 0.9, provenance: { runId: run.id } });
  t('стара → superseded з посиланням на нову, нова — з тим самим ключем', sup.old.state === 'superseded' && sup.old.supersededBy === sup.created.id && sup.created.dedupeKey === s1.dedupeKey && sup.created.state === 'proposed');
  t('нова пам\'ятає, кого замінила; впевненість і докази — новіші', sup.created.provenance.supersedes === s1.id && sup.created.confidence === 0.9 && sup.created.evidence.length === 2);
  t('AI не замінює пропозицій сам', (await errOf(() => S.supersedeProposal(repo, P, sup.created.id, { actor: AI, by: AI })))?.code === 'ai_suggests_only');
  t('замінена — кінцева', (await errOf(() => S.validateProposal(repo, P, s1.id, AUTHOR)))?.code === 'conflict');
  // Схвалено, але поки чекало — канон змінився (хтось записав такий самий зв'язок).
  const a2 = await S.approveProposal(repo, P, sup.created.id, { actor: AUTHOR });
  await repo.createRelation({ projectId: P, type: 'opposes', fromId: oracle.id, toId: anna.id, createdBy: ADMIN });
  const stale = await errOf(() => S.writeCanon(repo, P, a2.proposal.id, { actor: AUTHOR }));
  const back = (await repo.getStoryProposal(P, a2.proposal.id))!;
  t('канон змінився — запис зупинено (409), пропозиція повертається на розгляд', stale?.code === 'conflict' && back.state === 'proposed' && back.validation?.errors.some((e) => e.code === 'duplicate_relation'));
  t('стара ревізія при рішенні — 409', (await errOf(() => S.rejectProposal(repo, P, back.id, { actor: AUTHOR, expectedRevision: back.revision - 1 })))?.code === 'conflict');

  await repo.upsertProject({ id: 'book-other', ownerId: 'u-other', title: 'Інша' });
  await repo.upsertParticipant({ projectId: 'book-other', userId: 'u-author', source: 'manual', createdBy: 'user:u-other' });
  t('книги ядра: усі / власні / де учасник', (await repo.listProjects()).length === 2 && (await repo.listProjects({ ownerId: 'u-author' })).map((x) => x.id).join() === P
    && (await repo.listProjects({ ownerId: 'u-author', participantUserId: 'u-author' })).length === 2 && (await repo.listProjects({ ownerId: 'nobody', participantUserId: 'nobody' })).length === 0);

  const details = await S.proposalDetails(repo, P, rel.id);
  t('картка пропозиції: журнал і докази з уривками', details.events.length >= 3 && details.evidence.length === 2 && details.evidence[0].excerpt.includes('Оракул'));
  const open = await repo.listStoryProposals(P, { states: ['detected', 'proposed', 'validated', 'approved'] });
  t('перелік відкритих — без кінцевих', open.length > 0 && open.every((p) => ['detected', 'proposed', 'validated', 'approved'].includes(p.state)));
  t('фільтр за видом', (await repo.listStoryProposals(P, { kind: 'relation' })).every((p) => p.kind === 'relation'));

  if (raw) {
    console.log(`\n${name} — обмеження бази (останній рубіж):`);
    const q = `INSERT INTO ${CORE_SCHEMA}.story_proposals (project_id, kind, state, payload, dedupe_key, evidence, created_by)`;
    t('AI без доказу — CHECK', await raw(`${q} VALUES ($1, 'entity', 'proposed', '{}', 'entity:x:y', '{}', 'ai:AI-1')`, [P]).then(() => false, () => true));
    t('canon без посилання — CHECK', await raw(`${q} VALUES ($1, 'entity', 'canon', '{}', 'entity:x:z', '{}', 'user:u')`, [P]).then(() => false, () => true));
    t('кінцевий стан незмінний — тригер', await raw(`UPDATE ${CORE_SCHEMA}.story_proposals SET reason = 'x' WHERE id = $1`, [ai1.id]).then(() => false, () => true));
    t('у канон в обхід схвалення — тригер', await raw(`UPDATE ${CORE_SCHEMA}.story_proposals SET state = 'canon', canon_ref = gen_random_uuid(), decided_by = 'user:u', decided_at = now() WHERE id = $1`, [open.find((p) => p.state !== 'approved')!.id]).then(() => false, () => true));
    t('рішення від AI — CHECK', await raw(`UPDATE ${CORE_SCHEMA}.story_proposals SET state = 'rejected', decided_by = 'ai:AI-1', decided_at = now() WHERE id = $1`, [open[0].id]).then(() => false, () => true));
  }
}

await suite('Пам\'ять', new MemoryCoreRepository());
const pgUrl = process.env.CORE_TEST_DATABASE_URL?.trim();
if (pgUrl) {
  const pool = createCorePool(pgUrl);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — v23 (пропозиції до канону)', Number(rows[0].v) >= 23, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('пропозиції на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}
resetActiveRegistry();

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
