/**
 * Профіль персонажа і Profile Builder — задача Т1.5 (журнал #256).
 *
 * Критерій приймання сторінки 3 (ТЗ-11 §4): після нової глави профіль
 * доповнюється новими підтвердженими фактами без втрати попередніх (тест:
 * дві версії книги, профіль до й після). Плюс критерій ТЗ-H №1: профіль
 * показує джерело кожного твердження. А також: канон автора окремо від ШІ,
 * затверджене ШІ не змінює (повторний прогін не дублює), оцінки confirmed /
 * suggested / contradicted / unknown, арка, події, «стан на главі N» без
 * спойлерів, перейменування (П6) — старе ім'я псевдонімом і заміна окремо в
 * тегах і в тексті, права.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:character-profile
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import {
  AI_PROFILE_JOB_KIND,
  aiProfileJobKind,
  buildCharacterProfile,
  profileTask,
  studioCanon,
  studioFromBook,
} from '../server/core/characterProfile.ts';
import { countNameInBook, findNameRanges, replaceNameInBook } from '../src/utils/heroRename.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import type { CoreRepository } from '../server/core/types.ts';
import type { JobStore } from '../server/core/jobs/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nПерейменування (П6) — заміна в книзі:');
{
  t('ціле слово, не частина іншого', findNameRanges('Олена й Олененко, Олена.', 'Олена').length === 2);
  const book: any = {
    chapters: [{ id: 'c', sections: [
      { id: 's1', content: '[/character:Олена] Олена мовчала.\n\n[/emotion:страх @Олена] Страшно.' },
      { id: 's2', content: 'Тут Олени немає, лише Олененко.' },
    ] }],
  };
  const n = countNameInBook(book, 'Олена');
  t('рахує окремо: у тегах і в тексті', n.tags === 2 && n.text === 1 && n.sections === 1, JSON.stringify(n));
  const tags = replaceNameInBook(book, 'Олена', 'Олеся', 'tags');
  t('заміна в тегах — лише теги (і @суб\'єкт)', tags.replaced === 2 && tags.book.chapters[0].sections[0].content === '[/character:Олеся] Олена мовчала.\n\n[/emotion:страх @Олеся] Страшно.');
  const text = replaceNameInBook(tags.book, 'Олена', 'Олеся', 'text');
  t('заміна в тексті — лише текст', text.replaced === 1 && text.book.chapters[0].sections[0].content.startsWith('[/character:Олеся] Олеся мовчала.') && text.book.chapters[0].sections[1] === tags.book.chapters[0].sections[1]);
  t('нічого замінювати — та сама книга', replaceNameInBook(book, 'Зоя', 'Ія', 'text').book === book);
}

console.log('\nКанон автора:');
{
  const olena = { id: 'c-o', name: 'Олена', role: 'protagonist', age: 30, appearance: { hair: 'руде', eyes: '' }, personality: { fears: ['вода'], motivation: 'знайти брата' }, biography: 'Виросла біля річки.', avatarUrl: '/p.png', relationships: [{ targetCharacterId: 'c-m', type: 'family', description: 'брат' }] };
  const c = studioCanon(olena as any, [olena as any, { id: 'c-m', name: 'Марко' } as any]);
  const get = (k: string) => c.fields.find((f) => f.key === k)?.value;
  t('поля картки — лише заповнені, українською', get('role') === 'головний герой' && get('age') === '30' && get('appearance') === 'волосся: руде' && get('personality.fears') === 'вода' && !c.fields.some((f) => f.value === ''));
  t('стосунки — з іменами героїв, портрет', get('relationships') === 'Марко — family (брат)' && c.portraitUrl === '/p.png');
  const task = profileTask('Олена', c.fields, [{ field: 'fear', statement: 'Боїться води', status: 'confirmed' }]);
  t('завдання Profile Builder: канон для порівняння, відомі факти не повторювати', /Канон автора:\n- Роль: головний герой/.test(task) && /не повторювати/.test(task) && /\[fear\] Боїться води/.test(task) && /contradicted/.test(task));
}

function sectionFactory() {
  const prev: Record<string, { ids: string[]; hashes: string[] }> = {};
  return (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content, prevIds: prev[id]?.ids, prevHashes: prev[id]?.hashes });
    prev[id] = { ids: r.ids, hashes: r.hashes };
    return { id, title: `Сцена ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
}

async function suite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nПрофіль героя (${label}):`);
  const section = sectionFactory();
  const ch1 = ['[/character:Олена] [/emotion:страх] Олена боялася води.', '[/character:Олена] [/event:Втеча] Вона втекла з дому.', 'Олена дивилась на річку.', 'Марко чекав.'];
  const ch2 = ['[/character:Олена] [/emotion:рішучість] Олена вирішила повернутися.', '[/character:Олена] [/decision:Повернення] Вона повернулась до річки.'];
  const studioChars = [{ id: 'c-o', name: 'Олена', role: 'protagonist', appearance: { hair: 'руде' }, biography: 'Виросла біля річки.', personality: {} }, { id: 'c-m', name: 'Марко' }];
  const book = (withCh2: boolean, chars = studioChars) => ({
    id: P,
    title: 'Книга',
    characters: chars,
    chapters: [
      { id: 'ch1', title: 'Вода', order: 0, sections: [section('s1', 0, ch1.join('\n\n'))] },
      ...(withCh2 ? [{ id: 'ch2', title: 'Повернення', order: 1, sections: [section('s2', 0, ch2.join('\n\n'))] }] : []),
    ],
  });
  let current: any = book(false);
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: current });
  const [a1, a2, a3] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const entity = (await repo.getEntity(P, olena))!;
  const studio = () => studioFromBook(current, entity);
  t('картка героя знаходиться за зв\'язком зі Студією', studio().character?.id === 'c-o');

  const p1 = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('до другої глави: появи — абзаци з тегом героя', p1.appearances.total === 2 && p1.appearances.items.map((x) => x.paragraphId).join() === [a1, a2].join());
  t('канон автора — окремо', p1.canon.linked && p1.canon.fields.some((f) => f.key === 'appearance' && f.value === 'волосся: руде') && !p1.canon.hidden);
  t('стан (арка): початковий — страх з гл. 1; поточного ще немає', p1.arc.initial.map((x) => x.name).join() === 'страх' && p1.arc.current.length === 0);
  t('події героя — «Втеча» (тег, суб\'єкт — Олена за правилом П1)', p1.timeline.map((x) => `${x.name}:${x.via}`).join() === 'Втеча:tag');

  // ── Profile Builder (підставний AI-2) ──
  const calls: AiGenerateInput[] = [];
  let answer: (user: string) => object = () => ({ findings: [] });
  const idOf = (user: string, needle: string) => (user.split('\n').find((l) => l.includes(needle))?.match(/^\[([^\]]+)\]/) ?? [])[1];
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    return { text: JSON.stringify(answer(input.user)), modelId: 'fake-ai2', engine: 'fake', inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  };
  let clock = Date.parse('2026-09-25T10:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_PROFILE_JOB_KIND, aiProfileJobKind({ repo: () => repo, generate, resolveModel: async () => 'fake-ai2', loadStudio: async () => studio() }));
  const runBuilder = async () => {
    const { job } = await q.enqueue({ projectId: P, kind: AI_PROFILE_JOB_KIND, payload: { entityId: olena }, createdBy: 'user:u-owner' });
    await q.runOnce();
    clock += 61_000;
    return jobStore.get(P, job.id);
  };
  answer = (user) => ({ findings: [
    { kind: 'profile_fact', field: 'fear', summary: 'Олена боїться води.', paragraph_ids: [idOf(user, 'боялася води')], quote: 'Олена боялася води', confidence: 0.9, assessment: 'supported' },
    { kind: 'profile_fact', field: 'appearance', summary: 'У Олени темне волосся.', paragraph_ids: [idOf(user, 'дивилась на річку')], confidence: 0.4, assessment: 'contradicted' },
    { kind: 'profile_fact', field: 'goal', summary: 'Можливо, шукає брата.', paragraph_ids: [], confidence: 0.2, insufficient_data: true, assessment: 'unknown' },
    { kind: 'mention', summary: 'не факт профілю', paragraph_ids: [idOf(user, 'боялася води')], confidence: 0.5 },
  ] });
  const j1 = await runBuilder();
  const prompt = calls[0];
  t('Profile Builder — AI-2 з каноном і абзацами героя (зокрема без тега, за іменем)',
    prompt.module === 'coreAi2Analysis' && prompt.user.includes('Канон автора') && prompt.user.includes('волосся: руде') && prompt.user.includes(`[${a3}]`) && !prompt.user.includes('Марко чекав'),
    JSON.stringify((j1?.result as any) ?? j1?.error));
  t('збережено 3 факти, не-факт відсіяно', (j1?.result as any)?.facts === 3 && (j1?.result as any)?.rejected === 1, JSON.stringify(j1?.result));
  let p = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('оцінки: пропозиція / суперечить канону / недостатньо даних', p.facts.suggested.length === 1 && p.facts.contradicted.length === 1 && p.facts.unknown.length === 1 && p.facts.confirmed.length === 0);
  const fearFact = p.facts.suggested[0];
  t('КРИТЕРІЙ ТЗ-H №1: у твердження — джерело (абзац, глава, уривок)', fearFact.sources.length === 1 && fearFact.sources[0].paragraphId === a1 && fearFact.sources[0].chapterNumber === 1 && fearFact.sources[0].excerpt === 'Олена боялася води.' && fearFact.quote === 'Олена боялася води');
  await repo.setFindingStatus(P, fearFact.id, 'confirmed', 'user:u-owner');

  // Повторний прогін над тією ж главою — затверджене не змінюється й не дублюється.
  const j2 = await runBuilder();
  p = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('повторний прогін: ті самі факти не дублюються', (j2?.result as any)?.facts === 0 && p.facts.confirmed.length === 1 && p.facts.suggested.length === 0, JSON.stringify(j2?.result));
  t('…а в завданні — «уже відомі факти» із затвердженим', calls[1].user.includes('[fear] Олена боїться води. (confirmed)'));

  // ── КРИТЕРІЙ: нова глава ──
  current = book(true);
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: current });
  const [b1, b2] = (await repo.listParagraphs(P, 's2')).map((x) => x.id);
  answer = (user) => ({ findings: [
    { kind: 'profile_fact', field: 'fear', summary: 'Олена боїться води.', paragraph_ids: [idOf(user, 'боялася води')], confidence: 0.9, assessment: 'supported' },
    { kind: 'profile_fact', field: 'goal', summary: 'Олена вирішила повернутися додому.', paragraph_ids: [idOf(user, 'вирішила повернутися')], quote: 'Олена вирішила повернутися', confidence: 0.8, assessment: 'supported' },
  ] });
  const j3 = await runBuilder();
  t('нова глава йде в прогін першою (ще не покрита фактами)', calls[2].user.indexOf(`[${b1}]`) >= 0 && (j3?.result as any)?.facts === 1, JSON.stringify(j3?.result));
  p = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  const newFact = p.facts.suggested.find((f) => f.statement.includes('повернутися'))!;
  await repo.setFindingStatus(P, newFact.id, 'confirmed', 'user:u-owner');
  const after = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('КРИТЕРІЙ: після нової глави — нові підтверджені факти, попередні на місці',
    after.facts.confirmed.map((f) => f.statement).sort().join('|') === ['Олена боїться води.', 'Олена вирішила повернутися додому.'].sort().join('|') && after.facts.confirmed.find((f) => f.statement === 'Олена боїться води.')!.sources[0].paragraphId === a1);
  t('…і з тегів: появи 2 → 4, арка «страх → рішучість», події «Втеча → Повернення»',
    after.appearances.total === 4 && after.arc.initial.map((x) => x.name).join() === 'страх' && after.arc.current.map((x) => x.name).join() === 'рішучість' && after.timeline.map((x) => x.name).join() === 'Втеча,Повернення', `${after.appearances.total} ${after.timeline.map((x) => x.name)}`);
  t('появи — у порядку книги', after.appearances.items.map((x) => x.paragraphId).join() === [a1, a2, b1, b2].join());

  // ── «Стан на главі 1» ──
  const at1 = (await buildCharacterProfile(repo, P, olena, { upto: 1, studio: studio() }))!;
  t('стан на главі 1: лише появи й події гл. 1', at1.upto === 1 && at1.appearances.total === 2 && at1.timeline.map((x) => x.name).join() === 'Втеча' && at1.arc.current.length === 0);
  t('…факти з гл. 2 приховано, з гл. 1 — є', at1.facts.confirmed.map((f) => f.statement).join() === 'Олена боїться води.');
  t('…канон автора приховано (без прив\'язки до глав — можливі спойлери), лише роль', at1.canon.hidden && at1.canon.fields.every((f) => f.key === 'role'));
  t('…факт «недостатньо даних» без джерел — теж прихований', at1.facts.unknown.length === 0 && after.facts.unknown.length === 1);

  // ── Перейменування (П6) ──
  current = book(true, [{ ...studioChars[0], name: 'Олеся' }, studioChars[1]]);
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: current });
  const renamed = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('перейменування: та сама сутність, нове ім\'я, старе — псевдонім і «колишнє ім\'я»',
    renamed.entity.name === 'Олеся' && renamed.aliases.includes('Олена') && renamed.formerNames.join() === 'Олена' && (await repo.resolveAlias(P, 'character', 'Олена')) === olena);
  t('…старі теги ведуть до героя: появи не загубились', renamed.appearances.total === 4);

  // ── Маршрути ──
  console.log(`\nМаршрути профілю (${label}):`);
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = {
    owner: { id: 'u-owner', role: 'writer', isGuest: false },
    reader: { id: 'u-reader', role: 'reader', isGuest: false },
    stranger: { id: 'u-x', role: 'writer', isGuest: false },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', queue: () => q, studio: async () => studio() });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const g = await call('GET', `/characters/${olena}/profile`, 'owner');
  t('GET профіль: власник може змінювати, канон з картки', g.status === 200 && g.body.canEdit === true && g.body.canon.linked && g.body.facts.confirmed.length === 2);
  const gr = await call('GET', `/characters/${olena}/profile?chapter=1`, 'reader');
  t('читач бачить профіль (без змін); ?chapter=1 — без спойлерів', gr.status === 200 && gr.body.canEdit === false && gr.body.upto === 1 && gr.body.appearances.total === 2);
  t('чужому — 403; невідомий герой — 404', (await call('GET', `/characters/${olena}/profile`, 'stranger')).status === 403 && (await call('GET', '/characters/00000000-0000-4000-8000-000000000000/profile', 'owner')).status === 404);
  const bld = await call('POST', `/characters/${olena}/profile/build`, 'owner');
  t('запустити Profile Builder — 202 з id задачі; читачу — 403', bld.status === 202 && !!bld.body.jobId && (await call('POST', `/characters/${olena}/profile/build`, 'reader')).status === 403);
  const contra = g.body.facts.contradicted[0];
  t('рішення щодо факту: читач — 403', (await call('POST', `/characters/${olena}/facts/${contra.id}/status`, 'reader', { status: 'rejected' })).status === 403);
  const rej = await call('POST', `/characters/${olena}/facts/${contra.id}/status`, 'owner', { status: 'rejected' });
  t('відхилити «суперечить канону» — зникає з профілю', rej.status === 200 && (await call('GET', `/characters/${olena}/profile`, 'owner')).body.facts.contradicted.length === 0);
  t('факт чужого героя чи поганий статус — 404 / 400',
    (await call('POST', `/characters/${await repo.resolveAlias(P, 'character', 'Марко')}/facts/${contra.id}/status`, 'owner', { status: 'confirmed' })).status === 404 &&
    (await call('POST', `/characters/${olena}/facts/${contra.id}/status`, 'owner', { status: 'maybe' })).status === 400);
  server.close();
}

await suite('memory', new MemoryCoreRepository(), new MemoryJobStore(), 'book-m');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    await suite('postgres', new PgCoreRepository(pool), new PgJobStore(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
