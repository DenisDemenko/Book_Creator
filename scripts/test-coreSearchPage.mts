/**
 * Сторінка 1 «Розумний пошук» — задача Т1.3 (журнал #254).
 *
 * Критерій приймання сторінки 1 (ТЗ-11 §2, PLAN_ENTITY_FEATURES §6.1): запит
 * «герой + емоція» → абзаци з точним `paragraph_id` і переходом у редактор —
 * на тестовій книзі з розміченими й нерозміченими сценами. Плюс: тлумачення
 * запиту ШІ (`searchInterpret`) лише розкладає запит на фільтри, фільтри ТЗ
 * (сутності, глава, період, статус), контекст, збережені запити, права,
 * ліміт тлумачень, модуль «Ядра AI». Модель — підставна.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:core-search-page
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes, INTERPRET_PER_MINUTE, MAX_SAVED_SEARCHES } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { hybridSearch } from '../server/core/search/service.ts';
import { interpretSearchQuery, matchEntities } from '../server/core/search/interpret.ts';
import { factorySearchInterpretTemplate, renderSearchInterpretTemplate } from '../server/core/search/interpretPrompt.ts';
import { CORE_MODULE_KEYS, CORE_MODULE_HAS_JSON_SCHEMA, factoryCoreTemplate, resolveCoreTemplate } from '../server/coreAiRegistry.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nМодуль «Ядра AI» coreSearchInterpret:');
{
  t('у переліку модулів, зі схемою відповіді', (CORE_MODULE_KEYS as readonly string[]).includes('coreSearchInterpret') && CORE_MODULE_HAS_JSON_SCHEMA.coreSearchInterpret === true);
  const f = factoryCoreTemplate('coreSearchInterpret');
  t('заводський шаблон: лише розкладає, не відповідає; жорсткий контракт', /ЛИШЕ розкласти запит/.test(f.system) && /Не відповідай на запит/.test(f.system) && /ЖОРСТКИЙ КОНТРАКТ/.test(f.system));
  const r = renderSearchInterpretTemplate(factorySearchInterpretTemplate(), { query: 'Де Сергій?', entities: 'character: Сергій', chapters: '1. Початок' });
  t('підстановки: запит, сутності, глави, мова', r.user.includes('Де Сергій?') && r.user.includes('character: Сергій') && r.user.includes('1. Початок') && r.system.includes('українська'));
  const admin = resolveCoreTemplate('coreSearchInterpret', { coreSearchInterpret: { system: 'Мій текст', user: '{ЗАПИТ}' } });
  t('адмінський текст — зі схемою, яку не стерти', admin.system.startsWith('Мій текст') && /ЖОРСТКИЙ КОНТРАКТ/.test(admin.system));
}

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПошук сторінки 1 (${label}):`);
  const section = (id: string, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Сцена ${id}`, order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book = {
    id: P,
    title: 'Тестова книга',
    characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-m', name: 'Марія', alias: 'Маша' }],
    chapters: [
      { id: 'ch1', title: 'Вечеря', order: 0, sections: [section('s1', [
        '[/character:Сергій] [/emotion:страх] Він усміхнувся дружині, хоча всередині все стискалося.',
        'Сергій приховував від дружини, що боїться повертатися додому.',
        '[/character:Марія] Марія готувала вечерю.',
      ].join('\n\n'))] },
      { id: 'ch2', title: 'Ранок', order: 1, sections: [section('s2', [
        '[/character:Сергій] [/emotion:радість] Сергій сміявся з сином.',
        '[/character:Сергій] [/emotion:страх] Сергій прокинувся від страху.',
      ].join('\n\n'))] },
      { id: 'ch3', title: 'Тиша', order: 2, sections: [section('s3', 'Дружина мовчала.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Тестова книга', book });
  const [a1, a2, a3] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const [b1, b2] = (await repo.listParagraphs(P, 's2')).map((p) => p.id);
  const [c1] = (await repo.listParagraphs(P, 's3')).map((p) => p.id);
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const maria = (await repo.resolveAlias(P, 'character', 'Марія'))!;
  const fear = (await repo.resolveAlias(P, 'emotion', 'страх'))!;
  const ids = (res: { results: { paragraphId: string }[] }) => res.results.map((r) => r.paragraphId);
  const nm = (id: string) => ({ [a1]: 'a1', [a2]: 'a2', [a3]: 'a3', [b1]: 'b1', [b2]: 'b2', [c1]: 'c1' } as Record<string, string>)[id] ?? id.slice(0, 4);

  // ── Тлумачення запиту ──
  let reply = '';
  const calls: AiGenerateInput[] = [];
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    return { text: reply, modelId: 'fake-ai2', engine: 'fake', inputTokens: 50, outputTokens: 20, costUsd: 0.0001 };
  };
  const interpretDeps = { repo, generate, resolveModel: async () => 'fake-ai2' };
  reply = JSON.stringify({ text: 'приховує від дружини', entities: [{ type: 'character', name: 'Сергія' }, { type: 'emotion', name: 'страх' }, { type: 'character', name: 'Теща' }], chapters: [], status: 'any' });
  const it = await interpretSearchQuery(interpretDeps, P, 'Де Сергій приховує страх від дружини?', 'user:u-owner');
  t('модуль — coreSearchInterpret, у підказці — сутності й глави книги',
    calls[0].module === 'coreSearchInterpret' && calls[0].user.includes('character: Сергій') && calls[0].user.includes('emotion: страх') && calls[0].user.includes('2. Ранок') && calls[0].user.includes('(також: Маша)'));
  t('назви від моделі зіставлено з сутностями (з відмінком)', it.entities.map((e) => e.id).sort().join() === [serhii, fear].sort().join() && it.groups.length === 2);
  t('чого немає в книзі — не фільтр, а «не знайдено»', it.unmatched.length === 1 && it.unmatched[0].name === 'Теща');
  t('слова для пошуку — від моделі', it.text === 'приховує від дружини');
  t('псевдонім теж зіставляється', matchEntities('Маша', 'character', await repo.listEntities(P), new Map([[maria, ['Маша']]])).map((e) => e.id).join() === maria);

  // ── КРИТЕРІЙ ── запит «герой + емоція» на книзі з розміченими й нерозміченими сценами.
  const res = await hybridSearch({ repo }, P, { query: 'Де Сергій приховує страх від дружини?', text: it.text, hintEntityIds: it.groups });
  const order = ids(res).map(nm);
  t('КРИТЕРІЙ: першим — розмічений абзац «страх Сергія» (точний paragraph_id)', ids(res)[0] === a1, order.join());
  t('страх Сергія в іншій главі — теж серед повних збігів', order.indexOf('b2') > 0 && order.indexOf('b2') < order.indexOf('a2'), order.join());
  t('нерозмічена сцена («приховував від дружини») — знайдена словами', order.includes('a2') && !!res.results.find((r) => r.paragraphId === a2)?.sources.text, order.join());
  const hitA2 = res.results.find((r) => r.paragraphId === a2)!;
  t('результат — з контекстом: сусідні абзаци без тегів',
    hitA2.context.before === 'Він усміхнувся дружині, хоча всередині все стискалося.' && hitA2.context.after === 'Марія готувала вечерю.', JSON.stringify(hitA2.context));
  t('для переходу в редактор — глава, її номер, розділ і номер абзацу', res.results[0].chapterId === 'ch1' && res.results[0].chapterNumber === 1 && res.results[0].sectionId === 's1' && res.results[0].editorPid === a1);
  t('впізнане в самому запиті не дублюється підказкою ШІ', res.entities.filter((e) => e.id === serhii).length === 1 && res.entities.every((e) => e.via === 'query'));
  const hinted = await hybridSearch({ repo }, P, { query: 'приховує все', hintEntityIds: [[fear]] });
  t('сутність лише від ШІ — позначена «ai» і підсилює свої абзаци', hinted.entities.some((e) => e.id === fear && e.via === 'ai') && [a1, b2].includes(ids(hinted)[0]), ids(hinted).map(nm).join());

  // ── Фільтри ТЗ ──
  const ch2 = await hybridSearch({ repo }, P, { query: 'Сергій страх', chapterIds: ['ch2'] });
  t('глава: лише абзаци глави 2', ids(ch2).length > 0 && ids(ch2).every((id) => id === b1 || id === b2) && ids(ch2)[0] === b2, ids(ch2).map(nm).join());
  const period = await hybridSearch({ repo }, P, { query: 'дружина', chapterRange: { from: 2, to: 3 } });
  t('період: глави 2–3 (з главами 1 не перетинається)', ids(period).join() === c1 && period.filters.chapterIds.sort().join() === 'ch2,ch3', ids(period).map(nm).join());
  const onlyFrom = await hybridSearch({ repo }, P, { query: 'дружина', chapterRange: { from: 1, to: 1 } });
  t('період «від 1 до 1» — лише глава 1', ids(onlyFrom).every((id) => [a1, a2, a3].includes(id)) && ids(onlyFrom).length === 2, ids(onlyFrom).map(nm).join());

  await repo.replaceParagraphMentions(P, c1, [{ entityId: maria, spanStart: 0, spanEnd: 7, source: 'ai', status: 'suggested' }]);
  const sug = await hybridSearch({ repo }, P, { entityIds: [maria], mentionStatus: 'suggested' });
  const conf = await hybridSearch({ repo }, P, { entityIds: [maria], mentionStatus: 'confirmed' });
  const any = await hybridSearch({ repo }, P, { entityIds: [maria] });
  t('статус «запропоновано ШІ» — лише запропонована згадка', ids(sug).join() === c1, ids(sug).map(nm).join());
  t('статус «підтверджено автором» — лише тег автора', ids(conf).join() === a3, ids(conf).map(nm).join());
  t('без статусу — обидва', ids(any).sort().join() === [a3, c1].sort().join());
  const multi = await hybridSearch({ repo }, P, { entityIds: [serhii, fear], chapterIds: ['ch1'] });
  t('персонаж + емоція + глава — рівно один абзац', ids(multi).join() === a1);

  // ── Маршрути ──
  console.log(`\nМаршрути сторінки 1 (${label}):`);
  const access = {
    async getBookOwnerId(id: string) { return id === P ? 'u-owner' : null; },
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
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', interpret: { generate, resolveModel: async () => 'fake-ai2' } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  reply = JSON.stringify({ text: 'приховує від дружини', entities: [{ type: 'character', name: 'Сергій' }, { type: 'emotion', name: 'страх' }], chapters: [], status: 'any' });
  const s1 = await call('POST', '/search', 'owner', { q: 'Де Сергій приховує страх від дружини?', interpret: true });
  t('POST з тлумаченням: ШІ розклав запит, першим — a1', s1.status === 200 && s1.body.interpretation?.ok === true && s1.body.interpretation.entities.length === 2 && s1.body.results[0].paragraphId === a1,
    `${s1.status} ${JSON.stringify(s1.body.interpretation)?.slice(0, 120)}`);
  reply = JSON.stringify({ text: '', entities: [{ type: 'emotion', name: 'страх' }], chapters: [2], status: 'any' });
  const s2 = await call('POST', '/search', 'owner', { q: 'страх у другій главі', interpret: true });
  t('глава з тлумачення стає фільтром', s2.body.interpretation?.chapterNumbers?.join() === '2' && s2.body.results.length > 0 && s2.body.results.every((r: any) => r.chapterId === 'ch2'), JSON.stringify(s2.body.results?.map((r: any) => r.chapterId)));
  const s2b = await call('POST', '/search', 'owner', { q: 'страх у другій главі', interpret: true, chapterIds: ['ch1'] });
  t('явний вибір глави автором важливіший за тлумачення', s2b.body.results.every((r: any) => r.chapterId === 'ch1'));
  reply = 'не JSON взагалі';
  const s3 = await call('POST', '/search', 'owner', { q: 'Сергій страх', interpret: true });
  t('зіпсована відповідь ШІ — пошук без тлумачення, з поясненням', s3.status === 200 && s3.body.interpretation?.ok === false && /без тлумачення/.test(s3.body.interpretation.error) && [a1, b2].includes(s3.body.results[0]?.paragraphId),
    JSON.stringify(s3.body.interpretation));
  const before = calls.length;
  const s4 = await call('POST', '/search', 'owner', { q: 'Сергій страх' });
  t('без прапорця — ШІ не викликається', s4.status === 200 && s4.body.interpretation === null && calls.length === before);
  const g = await call('GET', `/search?q=${encodeURIComponent('Сергій страх')}&chapterFrom=2&status=confirmed`, 'owner');
  t('GET: період і статус з рядка запиту', g.status === 200 && g.body.results.every((r: any) => r.chapterNumber >= 2) && g.body.filters.mentionStatus === 'confirmed');
  reply = JSON.stringify({ text: 'x', entities: [], chapters: [], status: 'any' });
  let limited = null as any;
  for (let i = 0; i < INTERPRET_PER_MINUTE + 1; i++) limited = await call('POST', '/search', 'reader', { q: 'Сергій', interpret: true });
  t(`не більше ${INTERPRET_PER_MINUTE} тлумачень за хвилину — далі пошук без ШІ`, limited.status === 200 && limited.body.interpretation?.ok === false && /Забагато/.test(limited.body.interpretation.error));

  // Збережені запити.
  const params = { q: 'Сергій страх', entityIds: [serhii], chapterIds: ['ch1'], status: 'confirmed', interpret: true };
  const saved = await call('POST', '/saved-searches', 'owner', { name: 'Страх Сергія', params });
  t('зберегти запит — 201, з параметрами', saved.status === 201 && saved.body.item.name === 'Страх Сергія' && saved.body.item.params.q === 'Сергій страх' && saved.body.item.params.entityIds[0] === serhii && saved.body.item.params.interpret === true);
  t('список — лише свої', (await call('GET', '/saved-searches', 'owner')).body.items.length === 1 && (await call('GET', '/saved-searches', 'reader')).body.items.length === 0);
  t('читач може зберегти свій запит', (await call('POST', '/saved-searches', 'reader', { name: 'Мій', params: { q: 'дружина' } })).status === 201);
  t('чужий запит не видалити — 404', (await call('DELETE', `/saved-searches/${saved.body.item.id}`, 'reader')).status === 404);
  t('порожній запит чи назва — 400', (await call('POST', '/saved-searches', 'owner', { name: 'x', params: { q: ' ' } })).status === 400 && (await call('POST', '/saved-searches', 'owner', { name: '', params })).status === 400);
  t('чужому — 403', (await call('GET', '/saved-searches', 'stranger')).status === 403);
  for (let i = 1; i < MAX_SAVED_SEARCHES; i++) await call('POST', '/saved-searches', 'owner', { name: `q${i}`, params: { q: `слово ${i}` } });
  t(`не більше ${MAX_SAVED_SEARCHES} збережених — 409`, (await call('POST', '/saved-searches', 'owner', { name: 'зайвий', params })).status === 409);
  t('видалити свій — ok', (await call('DELETE', `/saved-searches/${saved.body.item.id}`, 'owner')).body.ok === true && (await call('GET', '/saved-searches', 'owner')).body.items.length === MAX_SAVED_SEARCHES - 1);
  server.close();
}

await suite('memory', new MemoryCoreRepository(), 'book-m');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
