/**
 * Учасники проєкту, ролі з реєстру й реєстр ролей як версія (Т6.1 В2,
 * `PLAN_COLLABORATION.md`; ТЗ v3 §59 №31–34, 48, 49; Onboarding №5–7, 22,
 * 27, 29). Запуск: npm run test:collab-participants (з CORE_TEST_DATABASE_URL —
 * ще й на PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import type { CoreRepository } from '../server/core/types.ts';
import { OntologyPublishError, activeCollabRegistryVersion, bootstrapOntology, createDraft, editDraft, impactDraft, publishDraft, resetActiveRegistry, validateDraft } from '../server/core/ontology/lifecycle.ts';
import { assignRole, importLegacyMembers, participantsOf, revokeRole, rolesOf } from '../server/core/collaboration/participants.ts';
import { activeCollabLabel, invitableRoles, roleById } from '../src/utils/collabOntology.ts';

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
    return e as Error & { code?: string };
  }
};
const publish = async (repo: CoreRepository, id: string) => {
  const v = await validateDraft(repo, id, ADMIN);
  if (!v.validation.ok) throw new Error(JSON.stringify(v.validation.errors.slice(0, 2)));
  await impactDraft(repo, id, ADMIN);
  return publishDraft(repo, id, ADMIN);
};

async function suite(name: string, repo: CoreRepository, raw?: (sql: string, params?: unknown[]) => Promise<unknown>) {
  resetActiveRegistry();
  console.log(`\n${name} — дві онтології в одному реєстрі схем:`);
  const story1 = await bootstrapOntology(repo);
  const collab1 = await repo.getActiveOntologyVersion('fusion-collab');
  t('імпортовано обидві: fusion-story 1 і fusion-collab 1 (окремі домени, №31)', story1.version === 1 && collab1?.version === 1 && collab1?.status === 'active' && collab1.createdBy === 'system:ontology-import');
  t('реєстр ролей процесу — fusion-collab@1, версія 1', activeCollabLabel() === 'fusion-collab@1' && activeCollabRegistryVersion() === 1);
  t('повторний старт — нових версій немає', (await bootstrapOntology(repo)).id === story1.id && (await repo.listOntologyVersions('fusion-collab')).length === 1);

  await repo.upsertProject({ id: 'cp-1', ownerId: 'u-owner', title: 'Маяк' } as any);
  await repo.upsertProject({ id: 'cp-2', ownerId: 'u-other', title: 'Сад' } as any);

  console.log(`\n${name} — ролі учасника за реєстром:`);
  const own = await assignRole(repo, { projectId: 'cp-1', userId: 'u-owner', roleId: 'project_owner', actor: 'system:collab-sync', source: 'owner' });
  t('власник проєкту — учасник з роллю project_owner (версія реєстру 1)', own.created && own.role.roleId === 'project_owner' && own.role.registryVersion === 1 && own.participant.source === 'owner');
  t('другий власник — конфлікт (одна на проєкт)', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-x', roleId: 'project_owner', actor: ADMIN, source: 'admin' })))?.code === 'conflict');
  const ill = await assignRole(repo, { projectId: 'cp-1', userId: 'u-maria', roleId: 'illustrator', actor: ADMIN, source: 'invitation', sourceRef: 'invite-1' });
  const cov = await assignRole(repo, { projectId: 'cp-1', userId: 'u-maria', roleId: 'cover_designer', actor: ADMIN, source: 'invitation' });
  t('кілька ролей одного учасника в одному проєкті (№34, Onboarding №7)', ill.participant.id === cov.participant.id && (await rolesOf(repo, 'cp-1', 'u-maria')).join() === 'illustrator,cover_designer');
  t('те саме призначення вдруге — наявне, без дубля', !(await assignRole(repo, { projectId: 'cp-1', userId: 'u-maria', roleId: 'illustrator', actor: ADMIN, source: 'invitation' })).created);
  const other = await assignRole(repo, { projectId: 'cp-2', userId: 'u-maria', roleId: 'author', actor: ADMIN, source: 'admin' });
  t('роль — у межах проєкту: у cp-2 Марія — автор, у cp-1 — ілюстраторка (№33, Onboarding №6)', other.role.roleId === 'author' && (await rolesOf(repo, 'cp-2', 'u-maria')).join() === 'author' && !(await rolesOf(repo, 'cp-1', 'u-maria')).includes('author'));
  t('фрілансер без спеціалізації — відмова (Onboarding №5)', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-free', roleId: 'freelancer', actor: ADMIN, source: 'freelance_order' })))?.code === 'bad_input');
  t('фрілансер зі спеціалізацією «власник проєкту» — відмова', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-free', roleId: 'freelancer', specialization: 'project_owner', actor: ADMIN, source: 'freelance_order' })))?.code === 'bad_input');
  const fr = await assignRole(repo, { projectId: 'cp-1', userId: 'u-free', roleId: 'freelancer', specialization: 'illustrator', actor: ADMIN, source: 'freelance_order', sourceRef: 'order-77' });
  t('фрілансер + ілюстратор — так, джерело — замовлення', fr.role.specialization === 'illustrator' && fr.participant.sourceRef === 'order-77');
  t('спеціалізація в ролі без спеціалізацій — відмова', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-z', roleId: 'editor', specialization: 'illustrator', actor: ADMIN, source: 'admin' })))?.code === 'bad_input');
  t('автор курсу в книзі — відмова; у курсі — так', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-c', roleId: 'course_author', actor: ADMIN, source: 'admin' })))?.code === 'bad_input'
    && (await assignRole(repo, { projectId: 'cp-2', userId: 'u-c', roleId: 'course_author', projectType: 'course', actor: ADMIN, source: 'admin' })).created);
  t('невідома роль — відмова', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-z', roleId: 'pirate', actor: ADMIN, source: 'admin' })))?.code === 'bad_input');
  t('AI не призначає ролей (Onboarding №22)', (await errOf(() => assignRole(repo, { projectId: 'cp-1', userId: 'u-z', roleId: 'editor', actor: 'ai:AI-2' as any, source: 'admin' })))?.code === 'bad_actor');
  const rd = await assignRole(repo, { projectId: 'cp-1', userId: 'u-reader', roleId: 'reader', actor: ADMIN, source: 'invitation' });
  t('старе значення reader → beta_reader', rd.role.roleId === 'beta_reader');
  t('останнього власника не відкликати', (await errOf(() => revokeRole(repo, { projectId: 'cp-1', assignmentId: own.role.id, actor: ADMIN })))?.code === 'conflict');
  const rv = await revokeRole(repo, { projectId: 'cp-1', assignmentId: cov.role.id, actor: ADMIN });
  t('відкликано cover_designer: Марія лишилась ілюстраторкою', rv.status === 'revoked' && rv.revokedBy === ADMIN && (await rolesOf(repo, 'cp-1', 'u-maria')).join() === 'illustrator');
  t('чужий проєкт у відкликанні — не знайдено', (await errOf(() => revokeRole(repo, { projectId: 'cp-2', assignmentId: ill.role.id, actor: ADMIN })))?.code === 'not_found');
  const view = await participantsOf(repo, 'cp-1');
  t('учасники проєкту з мітками ролей з реєстру; невдалі призначення не лишили порожніх учасників', view.length === 4 && view.every((v) => v.roles.length > 0) && view.find((v) => v.participant.userId === 'u-maria')?.roles[0]?.label?.uk === 'Ілюстратор');
  const ev = await repo.listCollabEvents('cp-1', { limit: 100 });
  t('журнал участі: додано учасника, призначено, відкликано — з автором (Onboarding №27)', ['participant_added', 'role_assigned', 'role_revoked'].every((a) => ev.some((e) => e.action === a)) && ev.every((e) => /^(user|system):/.test(e.actor)));

  console.log(`\n${name} — людина не персонаж (№32):`);
  t('у таблиці сутностей твору учасників немає', (await repo.listEntities('cp-1')).length === 0);
  t('сутність твору типу PERSON ядро не приймає', (await errOf(() => repo.createEntity({ projectId: 'cp-1', type: 'PERSON', name: 'Марія', createdBy: 'user:u-owner' } as any)))?.code === 'unknown_entity_type');
  await repo.createEntity({ projectId: 'cp-1', type: 'character', name: 'Марія', createdBy: 'user:u-owner' } as any);
  t('персонаж «Марія» і учасниця «Марія» — різні записи різних доменів', (await repo.listEntities('cp-1')).length === 1 && (await participantsOf(repo, 'cp-1')).some((v) => v.participant.userId === 'u-maria'));

  console.log(`\n${name} — перенесення project_members:`);
  await repo.setMember('cp-1', 'u-co', 'coauthor');
  await repo.setMember('cp-1', 'u-old-reader', 'reader');
  await repo.setMember('cp-1', 'u-owner', 'owner');
  const imp = await importLegacyMembers(repo, 'cp-1');
  t('coauthor → co_author, reader → beta_reader; власник уже був', imp.imported === 2 && (await rolesOf(repo, 'cp-1', 'u-co')).join() === 'co_author' && (await rolesOf(repo, 'cp-1', 'u-old-reader')).join() === 'beta_reader', JSON.stringify(imp));
  t('повторне перенесення нічого не додає', (await importLegacyMembers(repo, 'cp-1')).imported === 0);

  console.log(`\n${name} — нова роль версією реєстру, без зміни онтології твору (№48):`);
  const d2 = await createDraft(repo, { actor: ADMIN, ontologyId: 'fusion-collab', label: '1.1' });
  t('чернетка реєстру ролей — версія 2 fusion-collab', d2.ontologyId === 'fusion-collab' && d2.version === 2);
  const NARRATOR = { id: 'audiobook_narrator', label: { en: 'Audiobook Narrator', uk: 'Диктор аудіокниги' }, category: 'language', projectTypes: ['book'], defaultWorkspace: 'translator', suggestedCapabilities: ['view', 'comment', 'upload'], aiProfile: 'translator_default', status: 'active', requiresSpecialization: false, specializations: [], singleHolder: false, combinable: true, invitable: true, legacyIds: [], order: 35 };
  await editDraft(repo, d2.id, { actor: ADMIN, ops: [{ op: 'set_role', value: NARRATOR } as any] });
  const c2 = await publish(repo, d2.id);
  t('опубліковано fusion-collab 2; онтологія твору — та сама версія 1', c2.version === 2 && (await repo.getActiveOntologyVersion('fusion-story'))?.version === 1);
  t('нова роль — у реєстрі процесу й серед запрошуваних', !!roleById('audiobook_narrator') && invitableRoles().some((r) => r.id === 'audiobook_narrator') && activeCollabRegistryVersion() === 2);
  const nar = await assignRole(repo, { projectId: 'cp-1', userId: 'u-voice', roleId: 'audiobook_narrator', actor: ADMIN, source: 'invitation' });
  t('призначення нової ролі — з версією реєстру 2', nar.role.registryVersion === 2);

  console.log(`\n${name} — вплив зміни реєстру ролей:`);
  const d3 = await createDraft(repo, { actor: ADMIN, ontologyId: 'fusion-collab' });
  await editDraft(repo, d3.id, { actor: ADMIN, ops: [{ op: 'remove_role', id: 'illustrator' } as any, { op: 'remove_role', id: 'ghostwriter' } as any] });
  const v3 = await validateDraft(repo, d3.id, ADMIN);
  t('без illustrator перевірка падає: фрілансер посилається на неї спеціалізацією', !v3.validation.ok && v3.validation.errors.some((e) => e.code === 'unknown_role'));
  const illDef = roleById('illustrator')!;
  await editDraft(repo, d3.id, { actor: ADMIN, ops: [{ op: 'set_role', value: { ...illDef } } as any] });
  const freeDef = roleById('freelancer')!;
  await editDraft(repo, d3.id, { actor: ADMIN, ops: [{ op: 'remove_role', id: 'illustrator' } as any, { op: 'set_role', value: { ...freeDef, specializations: freeDef.specializations.filter((s) => s !== 'illustrator') } } as any] });
  await validateDraft(repo, d3.id, ADMIN);
  const im3 = await impactDraft(repo, d3.id, ADMIN);
  t('вилучення ролі з призначеннями — блокер; ghostwriter без призначень — ні', im3.impact.blockers.map((b) => b.id).join() === 'illustrator' && im3.impact.affected.some((a) => a.id === 'ghostwriter' && !a.blocking), im3.impact.blockers.map((b) => b.message).join(' | '));
  t('публікація — не пускає', (await errOf(() => publishDraft(repo, d3.id, ADMIN))) instanceof OntologyPublishError);
  await editDraft(repo, d3.id, { actor: ADMIN, ops: [{ op: 'set_role', value: { ...illDef, status: 'deprecated' } } as any, { op: 'set_role', value: { ...freeDef, specializations: freeDef.specializations.filter((s) => s !== 'ghostwriter') } } as any] });
  const c3 = await publish(repo, d3.id);
  t('застаріла замість вилучення — опубліковано fusion-collab 3', c3.version === 3);
  t('нове призначення застарілої ролі — відмова; наявне лишилось', (await errOf(() => assignRole(repo, { projectId: 'cp-2', userId: 'u-new', roleId: 'illustrator', actor: ADMIN, source: 'admin' })))?.code === 'conflict' && (await rolesOf(repo, 'cp-1', 'u-maria')).join() === 'illustrator');
  t('учасник бачить свою роль позначеною як застарілу', (await participantsOf(repo, 'cp-1')).find((v) => v.participant.userId === 'u-maria')?.roles[0]?.deprecated === true);

  console.log(`\n${name} — міждоменні зв'язки захищають онтологію твору (№49):`);
  const sd = await createDraft(repo, { actor: ADMIN, ontologyId: 'fusion-story' });
  await editDraft(repo, sd.id, { actor: ADMIN, ops: [{ op: 'remove_entity_type', id: 'scene' }, { op: 'remove_entity_type', id: 'outline' }] });
  await validateDraft(repo, sd.id, ADMIN);
  const si = await impactDraft(repo, sd.id, ADMIN);
  t('вилучення scene з твору — блокер: на неї посилаються ILLUSTRATED, EDITED…; outline — ні', si.impact.blockers.some((b) => b.id === 'scene' && b.kind === 'cross_domain_ref') && !si.impact.blockers.some((b) => b.id === 'outline'), si.impact.blockers.map((b) => b.message).join(' | '));
  await (await import('../server/core/ontology/lifecycle.ts')).archiveVersion(repo, sd.id, ADMIN);
  const cd = await createDraft(repo, { actor: ADMIN, ontologyId: 'fusion-collab' });
  const rel = (await repo.getOntologyVersion(cd.id))!.definition as any;
  const ill2 = rel.crossDomainRelations.find((r: any) => r.id === 'ILLUSTRATED');
  await editDraft(repo, cd.id, { actor: ADMIN, ops: [{ op: 'set_cross_domain_relation', value: { ...ill2, to: ['story:dragon'] } } as any] });
  const vcd = await validateDraft(repo, cd.id, ADMIN);
  t('міждоменний зв\'язок на тип твору, якого немає, — перевірка не пройдена', !vcd.validation.ok && vcd.validation.errors.some((e) => e.code === 'unknown_story_type'));
  await (await import('../server/core/ontology/lifecycle.ts')).archiveVersion(repo, cd.id, ADMIN);

  if (raw) {
    console.log(`\n${name} — обмеження бази:`);
    const p = (await repo.getParticipant('cp-1', 'u-maria'))!;
    t('дубль активної ролі SQL-ем — індекс не пускає', await raw(`INSERT INTO ${CORE_SCHEMA}.participant_roles (participant_id, project_id, role_id, assigned_by) VALUES ($1, 'cp-1', 'illustrator', 'user:x')`, [p.id]).then(() => false, () => true));
    t('assigned_by від AI — CHECK не пускає', await raw(`INSERT INTO ${CORE_SCHEMA}.participant_roles (participant_id, project_id, role_id, assigned_by) VALUES ($1, 'cp-1', 'editor', 'ai:AI-1')`, [p.id]).then(() => false, () => true));
    t('відкликана роль без часу — CHECK не пускає', await raw(`INSERT INTO ${CORE_SCHEMA}.participant_roles (participant_id, project_id, role_id, assigned_by, status) VALUES ($1, 'cp-1', 'editor', 'user:x', 'revoked')`, [p.id]).then(() => false, () => true));
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
    t('схема ядра — v20 (учасники проєкту)', Number(rows[0].v) >= 20, `v${rows[0].v}`);
    await suite('PostgreSQL', new PgCoreRepository(pool), (sql, params) => pool.query(sql, params as any[]));
  } catch (err) {
    t('учасники на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано)');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
