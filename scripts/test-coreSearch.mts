/**
 * Гібридний пошук — задача Т1.2 (журнал #253).
 *
 * Критерій готовності: запит «персонаж + емоція» («Олена страх») повертає
 * абзаци з точними `paragraph_id`, і першим — той, де страх саме Олени.
 * Плюс: пошук за словами з відмінками, за змістом (підставний ембедер —
 * «поняття» замість справжньої моделі), граф сутностей і зв'язків, злиття з
 * поясненням джерела, жорсткий фільтр сутностей, видалений текст не
 * шукається, ембединги лише змінених абзаців (тег не коштує виклику), зміна
 * моделі, відсутній ключ, права маршруту.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:core-search
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import { syncBookToCore, coreSyncJobKind, CORE_SYNC_KIND } from '../server/core/sync.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { CoreRuleError } from '../server/core/rules.ts';
import { CORE_EMBED_KIND, coreEmbedJobKind, planEmbeddings } from '../server/core/search/embedJob.ts';
import { EmbeddingUnavailableError, normalizeVector, type Embedder } from '../server/core/search/embedder.ts';
import { hybridSearch, nameInQuery } from '../server/core/search/service.ts';
import {
  EMBEDDING_DIMENSIONS,
  embeddingText,
  ftsPlainText,
  searchStems,
  searchTokens,
  tsQueryFromStems,
  wordStem,
} from '../server/core/search/text.ts';
import type { CoreRepository } from '../server/core/types.ts';
import type { JobStore } from '../server/core/jobs/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// ── Текстові правила ────────────────────────────────────────────────────────
console.log('\nТекст для пошуку:');
{
  t('основа слова відкидає закінчення', wordStem('страху') === 'страх' && wordStem('Андрієм') === 'андрі' && wordStem('ліс') === 'ліс');
  const stems = searchStems('Олена і страх, 1941 рік — страху!');
  t('основи запиту: без коротких слів і повторів, числа лишаються', stems.join() === ['олен', 'стра', '1941', 'рік'].join(), stems.join());
  t('запит tsquery — префікси через «або»', tsQueryFromStems(['олен', 'стра']) === 'олен:* | стра:*');
  t('текст для слів: зі службової частини тега лишається значення',
    ftsPlainText('[/emotion:страх] [COLOR="#e11d48"]Олена[/COLOR]').includes('страх') && !/emotion|COLOR|e11d48/.test(ftsPlainText('[/emotion:страх] [COLOR="#e11d48"]Олена[/COLOR]')));
  t('текст для ембединга — без тегів і маркерів', embeddingText('[/character:Олена] [/emotion:страх] **Її** охопив страх.') === 'Її охопив страх.', embeddingText('[/character:Олена] [/emotion:страх] **Її** охопив страх.'));
  t('апостроф ділить слово, як у PostgreSQL', searchTokens("м'який").join() === 'м,який');
  t('ім\'я в запиті з відмінком', nameInQuery('Олена', searchTokens('Олени страх')) && nameInQuery('Олена Коваль', searchTokens('Коваль Олена')) && !nameInQuery('Марко', searchTokens('Олена страх')));
}

// ── Підставний ембедер: «поняття» замість моделі ────────────────────────────
const CONCEPTS: [number, RegExp][] = [
  [0, /страх|жах|боя|тремт|паніка|перелякан/],
  [1, /радіс|смія|весел/],
  [2, /міст|мосту|річк/],
  [3, /вечір|ніч|тих/],
];
function fakeVector(text: string): number[] {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = searchTokens(text);
  for (const tok of tokens) {
    let hit = false;
    for (const [dim, re] of CONCEPTS) if (re.test(tok)) { v[dim] += 1; hit = true; }
    if (!hit) v[10 + (tok.length * 31 + tok.charCodeAt(0)) % 700] += 0.15;
  }
  v[767] = 0.05;
  return normalizeVector(v);
}
function fakeEmbedder(log: { model: string; texts: string[]; kind: string }[]): Embedder {
  return async (model, texts, kind) => {
    log.push({ model, texts, kind });
    return { vectors: texts.map(fakeVector), tokens: texts.reduce((n, x) => n + x.length, 0), estimated: true };
  };
}


async function suite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nПошук (${label}):`);
  const s1 = [
    '[/character:Олена] стояла на мосту над річкою.',
    '[/character:Олена] [/emotion:страх] Її охопив страх, руки тремтіли.',
    '[/character:Марко] [/emotion:страх] Марко теж відчув страх.',
    'Вечір був тихий, і ніхто не боявся.',
    '[/character:Олена] [/emotion:радість] Олена сміялася.',
  ];
  // Номери абзаців зберігаються між збереженнями, як у редакторі.
  const prev: Record<string, { ids: string[]; hashes: string[] }> = {};
  const section = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content, prevIds: prev[id]?.ids, prevHashes: prev[id]?.hashes });
    prev[id] = { ids: r.ids, hashes: r.hashes };
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book = (withS3: boolean, s1Text = s1, s2Text = 'Жах накрив усіх.', extra: string | null = null) => ({
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-olena', name: 'Олена' }, { id: 'c-marko', name: 'Марко' }],
    chapters: [{ id: 'ch1', title: 'Глава перша', order: 0, sections: [
      section('s1', 0, s1Text.join('\n\n')),
      section('s2', 1, s2Text),
      ...(withS3 ? [section('s3', 2, 'Страх, який потім видалили з книги.')] : []),
      ...(extra ? [section('s4', 3, extra)] : []),
    ] }],
  });
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(true) });
  const paras = await repo.listParagraphs(P, 's1');
  const [p1, p2, p3, p4, p5] = paras.map((p) => p.id);
  const p6 = (await repo.listParagraphs(P, 's2'))[0].id;
  const p7 = (await repo.listParagraphs(P, 's3'))[0].id;
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const fear = (await repo.resolveAlias(P, 'emotion', 'страх'))!;

  // ── Сховище: слова ──
  const byText = await repo.searchParagraphsByText(P, searchStems('страху'), 50);
  const textIds = byText.map((h) => h.paragraphId);
  t('слова: «страху» знаходить «страх» (відмінок) у трьох абзацах', [p2, p3, p7].every((id) => textIds.includes(id)) && textIds.length === 3, textIds.join());
  t('слова: абзаци з двома збігами (текст і тег) вище за абзац з одним', textIds[2] === p7, textIds.join());
  t('слова: службове слово тега не шукається', (await repo.searchParagraphsByText(P, ['emotion'], 10)).length === 0);

  // Розділ s3 зник із книги.
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(false) });
  t('видалений розділ не шукається', !(await repo.searchParagraphsByText(P, searchStems('страх'), 50)).some((h) => h.paragraphId === p7));

  // ── Сховище: вектори ──
  let rejected = false;
  try { await repo.upsertParagraphEmbeddings(P, 'm', [{ paragraphId: p1, contentHash: 'x', vector: [1, 2, 3] }]); } catch (e) { rejected = e instanceof CoreRuleError && e.code === 'bad_input'; }
  t('вектор не тієї довжини — bad_input', rejected);
  rejected = false;
  try { await repo.upsertParagraphEmbeddings(P, 'm', [{ paragraphId: 'нема', contentHash: 'x', vector: fakeVector('x') }]); } catch (e) { rejected = e instanceof CoreRuleError && e.code === 'not_found'; }
  t('вектор для чужого абзацу — not_found', rejected);

  // ── Задача ембедингів ──
  const log: { model: string; texts: string[]; kind: string }[] = [];
  let model = 'gemini-embedding-001';
  const costs: number[] = [];
  let clock = Date.parse('2026-09-25T10:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  let embedder: Embedder = fakeEmbedder(log);
  q.register(CORE_EMBED_KIND, coreEmbedJobKind({
    repo: () => repo,
    embedder: (...a) => embedder(...a),
    model: async () => model,
    recordCost: async (u) => { costs.push(u.tokens); },
  }));
  const runEmbed = async () => {
    const { job } = await q.enqueue({ projectId: P, kind: CORE_EMBED_KIND, createdBy: 'system:test' });
    await q.runOnce();
    clock += 61_000;
    return jobStore.get(P, job.id);
  };
  const j1 = await runEmbed();
  const r1 = j1?.result as any;
  t('ембединги: усі живі абзаці з текстом, типом «документ»', j1?.status === 'succeeded' && r1.embedded === 6 && r1.total === 6 && log[0].kind === 'document', JSON.stringify(r1 ?? j1?.error));
  t('у модель іде текст без тегів', log[0].texts.includes('Її охопив страх, руки тремтіли.'));
  t('витрата — у бюджет задачі й журнал', r1.tokens > 0 && costs.length === 1 && (await jobStore.get(P, j1!.id))!.usedTokens === r1.tokens, `${j1?.usedTokens}`);
  const j2 = await runEmbed();
  t('повторно над незміненою книгою — жодного виклику', (j2?.result as any).embedded === 0 && log.length === 1, JSON.stringify(j2?.result));

  // Тег поставлено (рукопис змінився), зміст — ні; і змінено текст одного абзацу.
  const s1b = [...s1];
  s1b[3] = 'Вечір був тихий, і ніхто не боявся мосту.';
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(false, s1b, '[/location:Площа] Жах накрив усіх.') });
  const j3 = await runEmbed();
  t('після правки — вектор лише зміненого абзацу (тег не рахується)', (j3?.result as any).embedded === 1 && log[1].texts.join() === 'Вечір був тихий, і ніхто не боявся мосту.', JSON.stringify(log[1]?.texts));

  // ── Гібридний пошук ──
  const staleCalls: string[] = [];
  const deps = {
    repo,
    embedder: (...a: Parameters<Embedder>) => embedder(...a),
    model: async () => model,
    onEmbeddingsStale: (pid: string) => { staleCalls.push(pid); },
  };
  const res = await hybridSearch(deps, P, { query: 'Олена страх' });
  const top = res.results[0];
  t('КРИТЕРІЙ: «Олена страх» — першим абзац, де страх саме Олени (точний paragraph_id)', top?.paragraphId === p2, res.results.map((r) => r.paragraphId).join());
  t('результат — з номером у редакторі, розділом, главою й уривком',
    top?.editorPid === p2 && top.sectionId === 's1' && top.sectionTitle === 'Розділ s1' && top.chapterId === 'ch1' && top.chapterTitle === 'Глава перша' && top.excerpt === 'Її охопив страх, руки тремтіли.');
  t('пояснення джерел: сутності (страх через Олену), слова, зміст',
    !!top?.sources.graph && !!top.sources.text && !!top.sources.vector &&
    top.sources.graph.entities.some((e) => e.id === olena && e.subjectOf === 'страх') && /сутності/.test(top.why) && /слова/.test(top.why) && /за змістом/.test(top.why), top?.why);
  t('впізнано сутності запиту', res.entities.map((e) => e.id).sort().join() === [olena, fear].sort().join() && res.entities.every((e) => e.via === 'query'));
  const rank = (id: string) => res.results.findIndex((r) => r.paragraphId === id);
  t('страх Марка і радість Олени — нижче', rank(p3) > 0 && rank(p5) > 0 && rank(p2) < rank(p3) && rank(p2) < rank(p5), `p3=${rank(p3)} p5=${rank(p5)}`);
  t('усі три джерела задіяні', res.sources.text.used && res.sources.vector.used && res.sources.graph.used && res.sources.vector.embedded === 6 && res.sources.vector.total === 6);
  t('видалений текст не у видачі', rank(p7) === -1);

  const sem = await hybridSearch(deps, P, { query: 'паніка' });
  const semIds = sem.results.map((r) => r.paragraphId);
  t('за змістом: «паніка» (такого слова в книзі немає) знаходить страх', sem.sources.text.hits === 0 && semIds.includes(p2) && semIds.includes(p6) && sem.results.every((r) => r.sources.vector && !r.sources.text), semIds.join());
  t('за змістом: далекі абзаци відсічено', !semIds.includes(p5) && !semIds.includes(p1), semIds.join());
  t('запит рахується типом «запит»', log[log.length - 1].kind === 'query' && log[log.length - 1].texts.join() === 'паніка');

  const filtered = await hybridSearch(deps, P, { query: 'страх', entityIds: [marko] });
  t('жорсткий фільтр сутності: лише абзаци Марка', filtered.results.length === 1 && filtered.results[0].paragraphId === p3 && filtered.entities.some((e) => e.id === marko && e.via === 'filter'));
  const onlyFilter = await hybridSearch(deps, P, { entityIds: [olena, fear] });
  t('лише фільтр (без слів): абзаци, де є обидві сутності', onlyFilter.results.map((r) => r.paragraphId).join() === p2 && !onlyFilter.sources.vector.used);

  const rel = await repo.createRelation({ projectId: P, type: 'follows', fromId: marko, toId: olena, evidence: [p1], status: 'confirmed', createdBy: 'user:u-owner' });
  const withRel = await hybridSearch(deps, P, { query: 'Марко Олена' });
  const relHit = withRel.results.find((r) => r.paragraphId === p1);
  t('зв\'язок між сутностями запиту приводить абзац-доказ', !!relHit?.sources.graph?.relations.some((r) => r.id === rel.id) && /зв'язок: Марко —follows→ Олена/.test(relHit.why), relHit?.why);

  t('stale-сигнал не шлеться, коли вектори актуальні', staleCalls.length === 0);

  // Повний збіг названого вищий за сильний збіг словами: абзац, де тривога
  // саме Олени, але слів запиту в тексті немає, — над абзацом, де слово
  // «тривога» тричі, а тегів немає.
  await repo.addAlias(P, olena, 'Лена', 'alias');
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book(false, s1b, '[/location:Площа] Жах накрив усіх.',
    ['[/character:Олена] [/emotion:тривога] Серце калатало.', 'Олена думала про тривогу, тривогу і тривогу.'].join('\n\n')) });
  const [p8, p9] = (await repo.listParagraphs(P, 's4')).map((p) => p.id);
  const anx = await hybridSearch({ repo }, P, { query: 'Лена тривога' });
  t('псевдонім «Лена» — та сама героїня', anx.entities.some((e) => e.id === olena));
  t('повний збіг «персонаж + емоція» — вище за збіг словами', anx.results[0]?.paragraphId === p8 && anx.results[0].sources.graph?.groupsCovered === 2 && anx.results.findIndex((r) => r.paragraphId === p9) > 0,
    anx.results.map((r) => `${r.paragraphId === p8 ? 'p8' : r.paragraphId === p9 ? 'p9' : r.paragraphId.slice(0, 4)}`).join());
  const dupe = await repo.createEntity({ projectId: P, type: 'character', name: 'Олена', createdBy: 'user:u-owner' }).catch(() => null);
  const dupeRes = await hybridSearch({ repo }, P, { query: 'Олена тривога' });
  t('дві сутності з тим самим іменем — одна група («Олена» — будь-яка з них)',
    !dupe || (dupeRes.entities.length === 3 && dupeRes.results[0]?.paragraphId === p8 && dupeRes.results[0].sources.graph?.groupsTotal === 2), `${dupeRes.entities.length} ${dupeRes.results[0]?.sources.graph?.groupsTotal}`);
  if (dupe) await repo.setEntityStatus(P, dupe.id, 'rejected', 'user:u-owner');

  const limited = await hybridSearch(deps, P, { query: 'Олена', limit: 2 });
  t('ліміт видачі', limited.results.length === 2);

  // Без ембедера — лише слова й граф.
  const noVec = await hybridSearch({ repo }, P, { query: 'Олена страх' });
  t('без моделі ембедингів: пошук за словами й графом, з поясненням', noVec.results[0]?.paragraphId === p2 && !noVec.sources.vector.used && !!noVec.sources.vector.reason);
  embedder = async () => { throw new EmbeddingUnavailableError('Немає ключа Gemini'); };
  const noKey = await hybridSearch(deps, P, { query: 'Олена страх' });
  const staleBefore = staleCalls.length;
  const noKeyAvail = await hybridSearch({ ...deps, available: async () => false }, P, { query: 'Олена страх' });
  t('ключа немає (перевірка наперед): без виклику моделі й без задачі', !noKeyAvail.sources.vector.used && /Немає ключа/.test(noKeyAvail.sources.vector.reason ?? '') && staleCalls.length === staleBefore);
  t('немає ключа: пошук працює, причина у відповіді', noKey.results[0]?.paragraphId === p2 && !noKey.sources.vector.used && /ключа/.test(noKey.sources.vector.reason ?? ''));
  const jNoKey = await runEmbed();
  model = 'text-embedding-3-small';
  const jNoKey2 = await runEmbed();
  t('задача без ключа — не збій, а «пропущено»', jNoKey2?.status === 'succeeded' && (jNoKey2?.result as any).skipped === 'unavailable', JSON.stringify(jNoKey2?.result ?? jNoKey?.error));

  // Зміна моделі: старі вектори не порівнюються з новими.
  embedder = fakeEmbedder(log);
  const changed = await hybridSearch(deps, P, { query: 'паніка' });
  t('нова модель: вектори ще не пораховані — пошук без змісту й сигнал дорахувати',
    !changed.sources.vector.used && changed.sources.vector.embedded === 0 && staleCalls.includes(P) && /рахуються/.test(changed.sources.vector.reason ?? ''), JSON.stringify(changed.sources.vector));
  const j4 = await runEmbed();
  t('перерахунок новою моделлю й прибирання старої', (j4?.result as any).embedded === 8 && (j4?.result as any).pruned === 6 && (await repo.listEmbeddingHashes(P, 'gemini-embedding-001')).length === 0, JSON.stringify(j4?.result));
  t('план після перерахунку порожній', (await planEmbeddings(repo, P, model)).todo.length === 0);

  // ── Маршрут ──
  console.log(`\nМаршрут пошуку (${label}):`);
  const access = {
    async getBookOwnerId(id: string) { return id === P || id === `${P}-new` ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = {
    owner: { id: 'u-owner', role: 'writer', isGuest: false },
    reader: { id: 'u-reader', role: 'reader', isGuest: false },
    stranger: { id: 'u-x', role: 'writer', isGuest: false },
    guest: { id: null, role: 'guest', isGuest: true },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, {
    access,
    repo: () => repo,
    coreState: () => 'ready',
    queue: () => q,
    search: { embedder: (...a) => embedder(...a), model: async () => model },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const g = await call('GET', `/${P}/search?q=${encodeURIComponent('Олена страх')}`, 'owner');
  t('GET: 200, першим — абзац страху Олени', g.status === 200 && g.body.synced === true && g.body.results[0].paragraphId === p2 && typeof g.body.results[0].why === 'string');
  t('читач теж шукає', (await call('GET', `/${P}/search?q=страх`, 'reader')).status === 200);
  t('чужий — 403, гість — 401', (await call('GET', `/${P}/search?q=страх`, 'stranger')).status === 403 && (await call('GET', `/${P}/search?q=страх`, 'guest')).status === 401);
  t('порожній запит — 400', (await call('GET', `/${P}/search?q=%20`, 'owner')).status === 400);
  const post = await call('POST', `/${P}/search`, 'owner', { q: 'страх', entityIds: [marko], limit: 5 });
  t('POST з фільтром сутності', post.status === 200 && post.body.results.length === 1 && post.body.results[0].paragraphId === p3);
  const gIds = await call('GET', `/${P}/search?q=страх&entityIds=${marko},${olena}`, 'owner');
  t('GET: entityIds через кому — лише абзац, де обоє (доказ зв\'язку)', gIds.status === 200 && gIds.body.results.map((r: any) => r.paragraphId).join() === p1, JSON.stringify(gIds.body.results?.map((r: any) => r.paragraphId)));
  const notSynced = await call('GET', `/${P}-new/search?q=страх`, 'owner');
  t('несинхронізована книга — synced:false, порожньо', notSynced.status === 200 && notSynced.body.synced === false && notSynced.body.results.length === 0);
  server.close();
}

await suite('memory', new MemoryCoreRepository(), new MemoryJobStore(), 'book-m');

console.log('\nСинхронізація ставить ембединги:');
{
  const repo = new MemoryCoreRepository();
  const store = new MemoryJobStore();
  const q = new JobQueue(store, { workerId: 'w', log: () => {} });
  const calls: [string, number][] = [];
  let content = 'Перший абзац.\n\nДругий абзац.';
  const loadBook = async (id: string) => {
    const r = reconcileParagraphIds({ sectionId: 's', content });
    return { id, ownerId: 'u', title: 'К', book: { id, title: 'К', chapters: [{ id: 'c', title: 'Г', order: 0, sections: [{ id: 's', title: 'Р', order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes }] }] } };
  };
  q.register(CORE_SYNC_KIND, coreSyncJobKind({ repo: () => repo, loadBook, afterTextChanged: (pid, n) => { calls.push([pid, n]); } }));
  await repo.upsertProject({ id: 'b', ownerId: 'u' });
  await q.enqueue({ projectId: 'b', kind: CORE_SYNC_KIND, createdBy: 'system:test' });
  await q.runOnce();
  t('нові абзаци → сигнал для core_embed', calls.length === 1 && calls[0][0] === 'b' && calls[0][1] === 2, JSON.stringify(calls));
  await q.enqueue({ projectId: 'b', kind: CORE_SYNC_KIND, createdBy: 'system:test' });
  await q.runOnce();
  t('без змін тексту — сигналу немає', calls.length === 1);
  content = 'Перший абзац.\n\nДругий абзац змінено.';
  await q.enqueue({ projectId: 'b', kind: CORE_SYNC_KIND, createdBy: 'system:test' });
  await q.runOnce();
  t('змінений абзац → сигнал', calls.length === 2);
}

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
