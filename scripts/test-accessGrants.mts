/**
 * Наданий доступ і фактичні права (Т6.2 В1, `PLAN_ACCESS.md`; ТЗ v3 §49,
 * №36–38, 44; Onboarding №8, 11, 18, 22, 24). Запуск: npm run test:access-grants
 * (з CORE_TEST_DATABASE_URL — ще й на PostgreSQL; схема ядра в цій базі
 * видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import type { AccessGrantRow, CoreRepository } from '../server/core/types.ts';
import { computeEffective, entityLevel, grantAccess, resolveEffectiveAccess, revokeAccess, sceneLevel, type BookIndex } from '../server/core/collaboration/access.ts';
import { mergeRestrictedUpdate, restrictBook } from '../server/core/collaboration/accessView.ts';
import { assignRole } from '../server/core/collaboration/participants.ts';
import { resetActiveRegistry, bootstrapOntology } from '../server/core/ontology/lifecycle.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const errOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error & { code?: string };
  }
};
const OWNER = { userId: 'u-owner', isOwner: true, isAdmin: false };
const P = 'acc-1';
const BOOK = {
  id: P, title: 'Маяк', author: 'Олена', updatedAt: '2026-10-01T10:00:00.000Z', synopsis: 'ТАЄМНИЙ СИНОПСИС', mindBoard: { nodes: [{ id: 'n1', text: 'ТАЄМНА ДОШКА' }] }, visualBible: [{ id: 'vb' }],
  characters: [{ id: 'ch-sofia', name: 'Софія' }, { id: 'ch-mark', name: 'Марк' }, { id: 'ch-villain', name: 'Лиходій' }],
  chapters: [
    { id: 'c1', bookId: P, title: 'Розділ 1', order: 1, description: 'ОПИС 1', sections: [{ id: 's1', chapterId: 'c1', title: 'Початок', order: 1, content: 'ТЕКСТ 1' }, { id: 's2', chapterId: 'c1', title: 'Сварка', order: 2, content: 'ТЕКСТ 2' }] },
    { id: 'c2', bookId: P, title: 'Розділ 2', order: 2, description: 'ОПИС 2', sections: [{ id: 's17', chapterId: 'c2', title: 'Кав\'ярня', order: 1, content: 'СЦЕНА 17' }, { id: 's18', chapterId: 'c2', title: 'Дах', order: 2, content: 'ФІНАЛ — ЛИХОДІЙ ПЕРЕМАГАЄ' }] },
  ],
};
const INDEX: BookIndex = new Map(BOOK.chapters.map((c) => [c.id, c.sections.map((s) => s.id)]));

console.log('Фактичні права з записів (чиста функція):');
{
  const g = (level: string, scopeType: string, scopeRef: string | null, extra: Partial<AccessGrantRow> = {}): AccessGrantRow => ({ id: Math.random().toString(), projectId: P, participantId: 'p', level: level as any, scopeType: scopeType as any, scopeRef, validFrom: '2026-01-01T00:00:00Z', validUntil: null, status: 'active', source: 'manual', sourceRef: null, grantedBy: 'user:x', createdAt: '', revokedAt: null, revokedBy: null, ...extra });
  const maria = computeEffective(P, 'u-maria', [g('view', 'scene', 's17'), g('view', 'character', 'e-sofia'), g('work', 'media_library', null)], { full: false });
  t('ілюстраторка: обмежений доступ — сцена 17, Софія, медіатека (робочий)', maria.restricted && sceneLevel(maria, 'c2', 's17') === 'view' && sceneLevel(maria, 'c2', 's18') === 'none' && sceneLevel(maria, 'c1', 's1') === 'none' && maria.media === 'work');
  t('…героїня — так, інший герой — ні; без права писати', entityLevel(maria, 'character', 'e-sofia') === 'view' && entityLevel(maria, 'character', 'e-villain') === 'none' && !maria.canWriteAny);
  const tr = computeEffective(P, 'u-tr', [g('edit', 'chapter', 'c1')], { full: false });
  t('перекладач з розділом 1: обидві сцени розділу — редагування, розділ 2 — ні', sceneLevel(tr, 'c1', 's1') === 'edit' && sceneLevel(tr, 'c1', 's2') === 'edit' && sceneLevel(tr, 'c2', 's17') === 'none' && tr.canWriteAny && tr.restricted);
  const full = computeEffective(P, 'u-ivan', [g('view', 'book', null)], { full: false });
  t('перегляд книги — не обмежений: усі сцени й сутності для перегляду, медіатека — перегляд', !full.restricted && sceneLevel(full, 'c2', 's18') === 'view' && entityLevel(full, 'location', 'any') === 'view' && full.media === 'view' && !full.canWriteAny);
  const exp = computeEffective(P, 'u-x', [g('edit', 'book', null, { validUntil: '2026-02-01T00:00:00Z' }), g('view', 'scene', 's1', { validFrom: '2099-01-01T00:00:00Z' })], { full: false, now: Date.parse('2026-10-01') });
  t('прострочений і ще не чинний — не діють', exp.restricted && sceneLevel(exp, 'c1', 's1') === 'none' && exp.book === 'none');
  t('власник — усе', computeEffective(P, 'u-owner', [], { full: true }).book === 'manage');
  const mgr = computeEffective(P, 'u-mgr', [g('view', 'media_library', null)], { full: false });
  t('менеджер книги з медіатекою: канону (сцен, героїв) не бачить (v3 №38)', mgr.restricted && sceneLevel(mgr, 'c1', 's1') === 'none' && entityLevel(mgr, 'character', 'e-sofia') === 'none' && mgr.media === 'view');

  console.log('\nКнига очима ілюстраторки:');
  const rb = restrictBook(BOOK, maria, new Set(['ch-sofia']))!;
  const text = JSON.stringify(rb);
  t('лише розділ 2 і лише сцена 17', rb.chapters.length === 1 && rb.chapters[0].sections.map((s: any) => s.id).join() === 's17' && /СЦЕНА 17/.test(text));
  t('немає тексту інших сцен, опису розділу, синопсису, сюжетної дошки, біблії', !/ТЕКСТ 1|ТЕКСТ 2|ФІНАЛ|ОПИС 2|СИНОПСИС|ДОШКА/.test(text) && rb.visualBible === undefined, text.slice(0, 200));
  t('картки героїв — лише Софія; позначка обмеження', rb.characters.map((c: any) => c.id).join() === 'ch-sofia' && rb.accessRestricted === true);
  t('повний доступ — книга без змін', restrictBook(BOOK, full) === BOOK);

  console.log('\nПравка обмеженого редактора:');
  const client = JSON.parse(JSON.stringify(restrictBook(BOOK, tr)));
  client.chapters[0].sections[0].content = 'ПЕРЕКЛАД 1';
  client.chapters[0].sections.push({ id: 's-new', title: 'Нова', content: 'чужа вставка' });
  client.chapters.push({ id: 'c2', sections: [{ id: 's18', content: 'ЗЛАМАНИЙ ФІНАЛ' }] });
  client.updatedAt = '2026-10-01T11:00:00.000Z';
  const m = mergeRestrictedUpdate(BOOK, client, tr);
  t('прийнято лише сцену 1 розділу 1', m.changed.join() === 's1' && m.book.chapters[0].sections[0].content === 'ПЕРЕКЛАД 1');
  t('сцена поза доступом не змінилась; нових сцен не з\'явилось; решта книги — на місці', m.book.chapters[1].sections[1].content === 'ФІНАЛ — ЛИХОДІЙ ПЕРЕМАГАЄ' && m.book.chapters[0].sections.length === 2 && m.book.synopsis === 'ТАЄМНИЙ СИНОПСИС' && m.book.characters.length === 3);
  t('мітка часу — з правки', m.book.updatedAt === '2026-10-01T11:00:00.000Z');
  t('ілюстраторка (лише перегляд) нічого не змінює', mergeRestrictedUpdate(BOOK, { chapters: [{ id: 'c2', sections: [{ id: 's17', content: 'X' }] }] }, maria).changed.length === 0);
}

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<unknown>) {
  resetActiveRegistry();
  await bootstrapOntology(repo);
  console.log(`\n${name} — надання й відкликання:`);
  await repo.upsertProject({ id: P, ownerId: 'u-owner', title: 'Маяк' } as any);
  const sofia = await repo.createEntity({ projectId: P, type: 'character', name: 'Софія', createdBy: 'user:u-owner' } as any);
  const cafe = await repo.createEntity({ projectId: P, type: 'location', name: 'Кав\'ярня', createdBy: 'user:u-owner' } as any);
  await assignRole(repo, { projectId: P, userId: 'u-maria', roleId: 'illustrator', actor: 'user:u-owner', source: 'manual' });
  t('нікому, хто не учасник, — not_found', (await errOf(() => grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-nobody', level: 'view', scopeType: 'book' })))?.code === 'not_found');
  const g1 = await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'scene', scopeRef: 's17', bookIndex: INDEX });
  const g2 = await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'character', scopeRef: sofia.id });
  await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'location', scopeRef: cafe.id });
  await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'work', scopeType: 'media_library' });
  t('власник надав Марії: сцену 17, Софію, кав\'ярню, медіатеку (як у ТЗ §49)', g1.scopeRef === 's17' && g2.scopeRef === sofia.id && (await repo.listAccessGrants({ projectId: P, status: 'active' })).length === 4);
  t('сцени, якої немає в книзі, — not_found', (await errOf(() => grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'scene', scopeRef: 's99', bookIndex: INDEX })))?.code === 'not_found');
  t('персонаж за id локації — not_found', (await errOf(() => grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'character', scopeRef: cafe.id })))?.code === 'not_found');
  t('робочий доступ до розділу — 422', (await errOf(() => grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'work', scopeType: 'chapter', scopeRef: 'c1', bookIndex: INDEX })))?.code === 'bad_input');
  t('строк у минулому — 422', (await errOf(() => grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-maria', level: 'view', scopeType: 'book', validUntil: '2020-01-01T00:00:00Z' })))?.code === 'bad_input');
  const eff = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-maria', isOwner: false, isAdmin: false });
  t('фактичні права Марії — обмежені: сцена 17, Софія, кав\'ярня, медіатека', eff.restricted && sceneLevel(eff, 'c2', 's17') === 'view' && sceneLevel(eff, 'c2', 's18') === 'none' && entityLevel(eff, 'character', sofia.id) === 'view' && entityLevel(eff, 'location', cafe.id) === 'view' && eff.media === 'work');
  t('Марія сама доступу не надає (немає права керування)', (await errOf(() => grantAccess(repo, { projectId: P, granter: { userId: 'u-maria', isOwner: false, isAdmin: false }, userId: 'u-maria', level: 'view', scopeType: 'book' })))?.code === 'bad_actor');

  await assignRole(repo, { projectId: P, userId: 'u-mgr', roleId: 'project_manager', actor: 'user:u-owner', source: 'manual' });
  await grantAccess(repo, { projectId: P, granter: OWNER, userId: 'u-mgr', level: 'manage', scopeType: 'book' });
  const MGR = { userId: 'u-mgr', isOwner: false, isAdmin: false };
  await assignRole(repo, { projectId: P, userId: 'u-tr', roleId: 'translator', actor: 'user:u-owner', source: 'manual' });
  const gt = await grantAccess(repo, { projectId: P, granter: MGR, userId: 'u-tr', level: 'edit', scopeType: 'chapter', scopeRef: 'c1', bookIndex: INDEX });
  t('менеджер із правом керування надає перекладачеві розділ 1', gt.grantedBy === 'user:u-mgr');
  t('…але не право керування', (await errOf(() => grantAccess(repo, { projectId: P, granter: MGR, userId: 'u-tr', level: 'manage', scopeType: 'book' })))?.code === 'bad_actor');
  t('роль не дає прав: учасник без записів — нічого (Onboarding №8, 24)', (await (async () => {
    await assignRole(repo, { projectId: P, userId: 'u-ed', roleId: 'editor', actor: 'user:u-owner', source: 'manual' });
    const e = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-ed', isOwner: false, isAdmin: false });
    return e.restricted && e.book === 'none' && Object.keys(e.scenes).length === 0;
  })()));
  const rv = await revokeAccess(repo, { projectId: P, grantId: g1.id, granter: OWNER });
  const eff2 = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-maria', isOwner: false, isAdmin: false });
  t('відкликано сцену 17 — Марія її більше не бачить', rv.status === 'revoked' && sceneLevel(eff2, 'c2', 's17') === 'none');
  const ev = await repo.listCollabEvents(P, { limit: 200 });
  t('журнал: надано й відкликано — від імені людей', ev.some((e) => e.action === 'access_granted' && e.actor === 'user:u-mgr') && ev.some((e) => e.action === 'access_revoked' && e.actor === 'user:u-owner'));

  console.log(`\n${name} — прийняті запрошення → доступ на книгу (рішення власника §2 п.1):`);
  const des = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-old-designer', isOwner: false, isAdmin: false, acceptedInvite: { id: 'inv-1', role: 'designer' } });
  t('старий дизайнер — редагування всієї книги, учасник із роллю', !des.restricted && des.book === 'edit' && (await repo.getParticipant(P, 'u-old-designer')) !== null);
  const rdr = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-old-reader', isOwner: false, isAdmin: false, acceptedInvite: { id: 'inv-2', role: 'reader' } });
  t('старий бета-читач — перегляд книги', !rdr.restricted && rdr.book === 'view' && !rdr.canWriteAny);
  const again = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-old-designer', isOwner: false, isAdmin: false, acceptedInvite: { id: 'inv-1', role: 'designer' } });
  const pd = (await repo.getParticipant(P, 'u-old-designer'))!;
  t('повторно — без нових записів', again.book === 'edit' && (await repo.listAccessGrants({ participantId: pd.id })).length === 1);
  const g = (await repo.listAccessGrants({ participantId: pd.id }))[0];
  await revokeAccess(repo, { projectId: P, grantId: g.id, granter: OWNER });
  const after = await resolveEffectiveAccess(repo, { projectId: P, userId: 'u-old-designer', isOwner: false, isAdmin: false, acceptedInvite: { id: 'inv-1', role: 'designer' } });
  t('власник відкликав — запрошення доступу не повертає', after.restricted && after.book === 'none' && (await repo.listAccessGrants({ participantId: pd.id })).length === 1);

  if (raw) {
    console.log(`\n${name} — обмеження бази:`);
    const pid = (await repo.getParticipant(P, 'u-maria'))!.id;
    t('робочий доступ до книги SQL-ем — CHECK', await raw(`INSERT INTO ${CORE_SCHEMA}.access_grants (project_id, participant_id, level, scope_type, granted_by) VALUES ($1, $2, 'work', 'book', 'user:x')`, [P, pid]).then(() => false, () => true));
    t('розділ без id — CHECK', await raw(`INSERT INTO ${CORE_SCHEMA}.access_grants (project_id, participant_id, level, scope_type, granted_by) VALUES ($1, $2, 'view', 'chapter', 'user:x')`, [P, pid]).then(() => false, () => true));
    t('доступ від AI — CHECK', await raw(`INSERT INTO ${CORE_SCHEMA}.access_grants (project_id, participant_id, level, scope_type, granted_by) VALUES ($1, $2, 'view', 'book', 'ai:AI-1')`, [P, pid]).then(() => false, () => true));
  }
  resetActiveRegistry();
}

await suite('Пам\'ять', new MemoryCoreRepository());
const pgUrl = process.env.CORE_TEST_DATABASE_URL?.trim();
if (pgUrl) {
  const pool = createCorePool(pgUrl);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — v21 (наданий доступ)', Number(rows[0].v) >= 21, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('доступ на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
