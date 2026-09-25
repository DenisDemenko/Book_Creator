/**
 * Прототип FLC етапу 0 — задача Т1.6 (журнал #257).
 *
 * Перевіряє адаптери й один повний цикл retrieval → профіль → Jev Choice/Score
 * → LLM → чернетка на тестовій книзі: форма запиту до Jev (звірена з
 * документацією TypeSafe 25.09.2026), нормалізація відповіді, валідатор
 * дозволених дій, запасний шлях на LLM (ТЗ-H №9), підставний Jev, рантайм
 * агентів (лише свої tools, ліміти, таймаут, журнал), межа знань героя
 * (ТЗ-H №5), цикл не змінює канон (ТЗ-H №3), маршрут лише для адміна.
 * Мережі немає: Jev і LLM — підставні.
 *
 * Запуск: npm run test:flc-prototype
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { snapshotHash, validateDecision, validateSnapshot, type CharacterSnapshot } from '../server/core/flc/contracts.ts';
import {
  enforceAllowed,
  evaluateWithFallback,
  HttpJevAdapter,
  interrogationQuestions,
  JEV_ENDPOINT,
  JevError,
  LlmFallbackJevAdapter,
  MockJevAdapter,
  toTen,
} from '../server/core/flc/jev.ts';
import { InProcessAgentRuntime, ToolDeniedError } from '../server/core/flc/runtime.ts';
import { runFlcCycle } from '../server/core/flc/cycle.ts';
import { PROFILE_FACT } from '../server/core/characterProfile.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const rejects = async (p: Promise<unknown>, cls?: any) => {
  try {
    await p;
    return false;
  } catch (e) {
    return !cls || e instanceof cls;
  }
};

const snap: CharacterSnapshot = {
  character_id: 'c1',
  name: 'Олена',
  as_of_chapter: 1,
  canon: [{ label: 'Роль', value: 'головний герой' }],
  confirmed_facts: [{ statement: 'Боїться води.', evidence: [{ paragraph_id: 'p1', chapter: 1, excerpt: 'Олена боялася води.' }] }],
  current_states: [{ type: 'emotion', name: 'страх', chapter: 1 }],
  relations: [{ label: 'Протидіє', other: 'Марко', direction: 'in' }],
  recent_appearances: [{ paragraph_id: 'p1', chapter: 1, excerpt: 'Олена боялася води.' }],
  situation: 'Де ти була тієї ночі?',
  allowed_actions: ['answer', 'lie', 'silence', 'deflect'],
};

console.log('\nКонтракти:');
{
  t('знімок героя — за схемою', validateSnapshot(snap).ok, validateSnapshot(snap).errors.join());
  t('факт без доказу — не за схемою', !validateSnapshot({ ...snap, confirmed_facts: [{ statement: 'x', evidence: [] }] }).ok);
  t('дія з пробілами — не за схемою', !validateSnapshot({ ...snap, allowed_actions: ['answer', 'say something'] }).ok);
  const shuffled = JSON.parse(JSON.stringify({ situation: snap.situation, ...snap }));
  t('відбиток знімка стабільний (порядок ключів не важить) і міняється зі станом', snapshotHash(shuffled) === snapshotHash(snap) && snapshotHash({ ...snap, situation: 'інше' }) !== snapshotHash(snap));
}

console.log('\nАдаптер Jev (REST TypeSafe):');
{
  const qs = interrogationQuestions(snap.allowed_actions);
  t('питання: Choice «наступна дія» і Score «страх» (5 рівнів)', qs[0].kind === 'choice' && qs[1].kind === 'score' && (qs[1] as any).levels.length === 5);
  let sent: any = null;
  const fakeFetch = (status: number, body: unknown) => (async (url: string, init: any) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  const okBody = {
    model: 'jev-1.13.0',
    answers: {
      next_action: { type: 'choice', choice: 'deflect', probabilities: { answer: 0.1, lie: 0.2, silence: 0.2, deflect: 0.5 }, confidence: 0.62 },
      fear_intensity: { type: 'score', score: 2.8, confidence: 0.4, legend: {}, probabilities: { '2': 0.2, '3': 0.8 } },
    },
    usage: { input_tokens: 1234, output_tokens: 0 },
  };
  const jev = new HttpJevAdapter('key-123', { fetchImpl: fakeFetch(200, okBody) });
  const d = await jev.evaluate(snap, qs);
  t('запит: POST /v1/systemone, Bearer, модель закріплена jev-1.13.0',
    sent.url === JEV_ENDPOINT && sent.headers.Authorization === 'Bearer key-123' && sent.body.model === 'jev-1.13.0');
  t('запит: choice — мапа варіантів, score — масив рівнів, стан — компактний знімок',
    sent.body.questions.next_action.type === 'choice' && typeof sent.body.questions.next_action.criteria === 'object' && !Array.isArray(sent.body.questions.next_action.criteria) &&
    Array.isArray(sent.body.questions.fear_intensity.criteria) && sent.body.state.character === 'Олена' && sent.body.state.situation === snap.situation);
  t('відповідь нормалізовано: дія, страх 0–10, розподіли, confidence, версія, hash, trace',
    d.selected_action === 'deflect' && d.scores.fear_intensity === 7 && d.raw_distributions.next_action.deflect === 0.5 && d.confidence === 0.62 &&
    d.model_version === 'jev-1.13.0' && d.snapshot_hash === snapshotHash(snap) && !!d.decision_trace_id && d.usage.input_tokens === 1234 && d.source === 'jev' && !d.corrected);
  t('результат — за контрактом decision-result', validateDecision(d).ok, validateDecision(d).errors.join());
  const bad = new HttpJevAdapter('k', { fetchImpl: fakeFetch(200, { ...okBody, answers: { ...okBody.answers, next_action: { ...okBody.answers.next_action, choice: 'kill' } } }) });
  const dBad = await bad.evaluate(snap, qs);
  t('недозволена дія — валідатор бере найімовірнішу дозволену й позначає', dBad.selected_action === 'deflect' && dBad.corrected);
  t('валідатор без розподілу — перша дозволена', enforceAllowed('x', undefined, ['answer', 'lie']).action === 'answer');
  t('шкала: позиція 1.43 з 3 рівнів → 7.2 з 10', toTen(1.43, 3) === 7.2);
  let e429: any = null;
  try { await new HttpJevAdapter('k', { fetchImpl: fakeFetch(429, { detail: 'slow down' }) }).evaluate(snap, qs); } catch (e) { e429 = e; }
  let e401: any = null;
  try { await new HttpJevAdapter('k', { fetchImpl: fakeFetch(401, {}) }).evaluate(snap, qs); } catch (e) { e401 = e; }
  t('429 — повторювана помилка, 401 — ні', e429 instanceof JevError && e429.retryable && e429.status === 429 && e401 instanceof JevError && !e401.retryable);
  const netDown = new HttpJevAdapter('k', { fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as any });
  t('мережа впала — JevError', await rejects(netDown.evaluate(snap, qs), JevError));
}

console.log('\nПідставний Jev і запасний шлях:');
{
  const qs = interrogationQuestions(snap.allowed_actions);
  const m = new MockJevAdapter();
  const a = await m.evaluate(snap, qs);
  const b = await m.evaluate(snap, qs);
  t('підставний Jev — детермінований, у формі справжнього', a.selected_action === b.selected_action && a.scores.fear_intensity === b.scores.fear_intensity && validateDecision(a).ok && a.source === 'mock' && snap.allowed_actions.includes(a.selected_action));
  const llm = async () => ({ text: '```json\n{"answers":{"next_action":{"choice":"silence"},"fear_intensity":{"score":4}}}\n```', modelId: 'fake-llm', inputTokens: 300, outputTokens: 20 });
  const fb = new LlmFallbackJevAdapter(llm);
  const f = await fb.evaluate(snap, qs);
  t('запасний LLM: та сама форма, без confidence, позначено', f.selected_action === 'silence' && f.scores.fear_intensity === 10 && f.confidence === null && f.source === 'llm_fallback' && f.model_version === 'llm:fake-llm' && validateDecision(f).ok);
  const failing = new HttpJevAdapter('k', { fetchImpl: (async () => new Response('{}', { status: 529 })) as any });
  const r1 = await evaluateWithFallback(failing, fb, snap, qs);
  t('Jev перевантажений (529) — рішення з запасного шляху з причиною', r1.decision.source === 'llm_fallback' && /529/.test(r1.fallbackReason ?? ''));
  const r2 = await evaluateWithFallback(null, fb, snap, qs);
  t('ключа немає — одразу запасний шлях, причина названа', r2.decision.source === 'llm_fallback' && /ключа/.test(r2.fallbackReason ?? ''));
}

console.log('\nРантайм агентів:');
{
  const scope = { projectId: 'p', actorId: 'user:u', characterId: 'c', simulationId: 's' };
  const seen: any[] = [];
  const rt = new InProcessAgentRuntime(scope, [
    { name: 'read', description: '', run: async (args, sc) => { seen.push({ args, sc }); return 42; } },
    { name: 'slow', description: '', run: (_a, _s, signal) => new Promise((res, rej) => { const tm = setTimeout(() => res(1), 2000); signal.addEventListener('abort', () => { clearTimeout(tm); rej(signal.reason); }); }) },
  ]);
  const v = await rt.step('agent-a', ['read'], (ctx) => ctx.tool('read', { q: 1 }));
  t('агент викликає свій tool; scope — сесії, не агента', v === 42 && seen[0].sc.projectId === 'p' && seen[0].sc.characterId === 'c');
  t('чужий tool — відмова й запис у журнал', await rejects(rt.step('agent-a', ['read'], (ctx) => ctx.tool('slow')), ToolDeniedError) && rt.trace.some((e) => e.kind === 'tool_denied' && e.tool === 'slow'));
  t('неіснуючий tool (напр. shell) — відмова', await rejects(rt.step('agent-a', ['shell'], (ctx) => ctx.tool('shell', { cmd: 'rm -rf /' })), ToolDeniedError));
  t('ліміт викликів tools', await rejects(rt.step('agent-a', ['read'], async (ctx) => { for (let i = 0; i < 5; i++) await ctx.tool('read'); }, { maxToolCalls: 3 }), ToolDeniedError));
  t('таймаут кроку', await rejects(rt.step('agent-b', ['slow'], (ctx) => ctx.tool('slow'), { timeoutMs: 100 })) && rt.trace.some((e) => e.kind === 'step_error' && /100 мс/.test(e.detail ?? '')));
  t('scope не змінити зсередини', await rejects(rt.step('agent-a', [], async (ctx) => { (ctx.scope as any).projectId = 'інший'; })));
  const tr = rt.trace;
  t('журнал — лише дописується, з номерами й часом', tr.length > 5 && tr.every((e, i) => e.seq === i + 1 && !!e.at) && tr.some((e) => e.kind === 'tool_result' && typeof e.ms === 'number'));
}

console.log('\nПовний цикл на тестовій книзі:');
const repo = new MemoryCoreRepository();
const P = 'flc-book';
{
  const sec = (id: string, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book = {
    id: P,
    title: 'Тестова книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Ніч', order: 0, sections: [sec('s1', ['[/character:Олена] [/emotion:страх] Олена боялася води і тієї ночі не спала.', '[/character:Марко] Марко питав, де вона була.'].join('\n\n'))] },
      { id: 'ch2', title: 'Ранок', order: 1, sections: [sec('s2', '[/character:Олена] [/emotion:спокій] Уранці Олена зізналась, що була біля річки.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Тестова книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const [p1] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const [q1] = (await repo.listParagraphs(P, 's2')).map((p) => p.id);
  const fact = await repo.addFinding({ projectId: P, entityId: olena, kind: PROFILE_FACT, payload: { field: 'fear', statement: 'Олена боїться води.', assessment: 'supported' }, sourceParagraphIds: [p1], createdBy: 'ai:AI-2' });
  await repo.setFindingStatus(P, fact.id, 'confirmed', 'user:u-owner');
  const late = await repo.addFinding({ projectId: P, entityId: olena, kind: PROFILE_FACT, payload: { field: 'other', statement: 'Олена була біля річки.', assessment: 'supported' }, sourceParagraphIds: [q1], createdBy: 'ai:AI-2' });
  await repo.setFindingStatus(P, late.id, 'confirmed', 'user:u-owner');

  const before = JSON.stringify({ f: await repo.listFindings(P), p: await repo.listAllParagraphs(P), e: await repo.listEntities(P), r: await repo.listRelations(P) });
  const llmCalls: { system: string; user: string }[] = [];
  const llm = async (system: string, user: string) => {
    llmCalls.push({ system, user });
    return { text: JSON.stringify({ reply: 'Я… не пам\'ятаю. Спала, мабуть.', intent: 'приховати, де була' }), modelId: 'fake-llm', inputTokens: 800, outputTokens: 40 };
  };
  const res = await runFlcCycle(
    { repo, jev: new MockJevAdapter(), fallback: new LlmFallbackJevAdapter(llm), llm },
    { projectId: P, entityId: olena, question: 'Олено, де ти була тієї ночі?', asOfChapter: 1, actorId: 'user:u-admin' },
  );
  t('цикл пройшов: знімок → рішення Jev → чернетка репліки', !!res.draft.reply && res.decision.source === 'mock' && res.snapshot.allowed_actions.includes(res.draft.action), res.draft.reply);
  t('знімок: канон/факти з доказами, стани, поява, ситуація', res.snapshot.confirmed_facts[0]?.statement === 'Олена боїться води.' && res.snapshot.confirmed_facts[0].evidence[0].paragraph_id === p1 && res.snapshot.current_states.some((s) => s.name === 'страх') && res.snapshot.situation.includes('тієї ночі'));
  t('ТЗ-H №5: межа знань — глава 1 (факт і текст з гл. 2 не потрапили)', res.snapshot.as_of_chapter === 1 && !res.snapshot.confirmed_facts.some((f) => /річки/.test(f.statement)) && !res.snapshot.recent_appearances.some((a) => a.paragraph_id === q1) && !llmCalls[0].user.includes('біля річки'));
  t('LLM отримала рішення і знімок, просили JSON-чернетку', llmCalls[0].system.includes(`«${res.decision.selected_action}»`) && llmCalls[0].system.includes('не канон') && llmCalls[0].user.includes('Знімок героя'));
  t('час кожного кроку й загальний', ['retrieval', 'profile', 'decision', 'llm', 'total'].every((k) => typeof (res.timings as any)[k] === 'number') && res.timings.total >= res.timings.llm);
  t('вартість: підставний Jev — 0 $, токени LLM пораховано', res.cost.jevUsd === 0 && res.cost.llmInputTokens === 800 && res.cost.llmOutputTokens === 40);
  t('журнал агентів: профіль-агент і агент героя, лише свої tools', res.trace.filter((e) => e.kind === 'tool_call').map((e) => `${e.agent}:${e.tool}`).join() === 'character-profile-agent:search-character-mentions,character-profile-agent:get-character-snapshot,character-agent:evaluate-character-options,character-agent:draft-reply');
  const after = JSON.stringify({ f: await repo.listFindings(P), p: await repo.listAllParagraphs(P), e: await repo.listEntities(P), r: await repo.listRelations(P) });
  t('ТЗ-H №3: канон, рукопис і висновки не змінено', before === after && res.canonChanged === false);

  const whole = await runFlcCycle(
    { repo, jev: new MockJevAdapter(), fallback: new LlmFallbackJevAdapter(llm), llm },
    { projectId: P, entityId: olena, question: 'Що ти відчуваєш зараз?', actorId: 'user:u-admin' },
  );
  t('без межі — уся книга (стан «спокій» з гл. 2 — поточний)', whole.snapshot.as_of_chapter === null && whole.snapshot.current_states.some((s) => s.name === 'спокій') && whole.snapshot.confirmed_facts.length === 2);

  const failingJev = new HttpJevAdapter('k', { fetchImpl: (async () => new Response('{}', { status: 529 })) as any });
  const fbLlm = async (system: string, user: string) =>
    user.includes('"answers"') || system.includes('оцінюєш стан')
      ? { text: '{"answers":{"next_action":{"choice":"lie"},"fear_intensity":{"score":3}}}', modelId: 'fake-llm', inputTokens: 200, outputTokens: 10 }
      : llm(system, user);
  const fb = await runFlcCycle(
    { repo, jev: failingJev, fallback: new LlmFallbackJevAdapter(fbLlm), llm: fbLlm },
    { projectId: P, entityId: olena, question: 'Де ти була?', asOfChapter: 1, actorId: 'user:u-admin' },
  );
  t('ТЗ-H №9: збій Jev — запасний шлях, цикл завершено, стан не втрачено', fb.decision.source === 'llm_fallback' && fb.draft.action === 'lie' && /529/.test(fb.fallbackReason ?? '') && fb.cost.llmInputTokens === 1000);

  const okJev = new HttpJevAdapter('k', {
    fetchImpl: (async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { next_action: { choice: 'answer', probabilities: { answer: 1 }, confidence: 0.9 }, fear_intensity: { score: 1, probabilities: {} } }, usage: { input_tokens: 2000 } }), { status: 200 })) as any,
  });
  const real = await runFlcCycle({ repo, jev: okJev, fallback: new LlmFallbackJevAdapter(llm), llm }, { projectId: P, entityId: olena, question: 'Де ти була?', asOfChapter: 1, actorId: 'user:u-admin' });
  t('вартість Jev: 2000 вхідних токенів × $0.042/1М = $0.000084', real.cost.jevInputTokens === 2000 && real.cost.jevUsd === 0.000084 && real.decision.model_version === 'jev-1.13.0');
}

console.log('\nМаршрут прототипу:');
{
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return []; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, admin: { id: 'u-admin', role: 'admin', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  const llm = async () => ({ text: '{"reply":"Не скажу.","intent":"мовчати"}', modelId: 'fake-llm', inputTokens: 10, outputTokens: 5 });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', flc: { jev: async () => new MockJevAdapter(), llm: () => llm } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (user: string, body: unknown) => {
    const r = await fetch(`${base}/flc/prototype`, { method: 'POST', headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const ok = await call('admin', { entityId: olena, question: 'Де ти була?', asOfChapter: 1 });
  t('адмін — 200: чернетка, рішення, час, журнал', ok.status === 200 && ok.body.draft.reply === 'Не скажу.' && !!ok.body.decision.decision_trace_id && ok.body.trace.length > 0);
  t('власник книги (не адмін) — 403: прототип лише для звіту', (await call('owner', { entityId: olena, question: 'x' })).status === 403);
  t('без героя чи запитання — 400', (await call('admin', { entityId: olena, question: ' ' })).status === 400);
  server.close();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
