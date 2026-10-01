/**
 * Т2.8 — перевірка якості «живих персонажів» (FLC етап 2, `PLAN_QUALITY.md`).
 *
 * Контрольний набір (`server/core/quality/controlSet.ts`) проходить справжнім
 * ходом допиту в двох режимах — з Jev і без Jev — на **підставних** моделях:
 * голос героя відповідає з того, що реально прийшло в його запиті (спогад,
 * чиє слово збігається з питанням), Jev обирає дію за змістом питання. Тож
 * виміри рахуються по-справжньому, а ворота ловлять регресію в знімку,
 * ізоляції чи пам'яті — до того, як її побачить автор.
 *
 * Перевіряються й самі ворота: голос, що «пробалакується» чужою таємницею,
 * однакові відповіді, майбутнє в запиті — мусять їх валити.
 *
 * Запуск: npm run test:living-characters [-- --report <файл.md>]
 * (входить у `npm test` — перевірка перед кожною зміною агентів).
 */
import fs from 'node:fs';
import { LIVING_CHARACTERS_SET, forbiddenFor } from '../server/core/quality/controlSet.ts';
import { runLivingCharacters, runMode, type QualityTurn } from '../server/core/quality/livingCharacters.ts';
import { computeMetrics, evaluateGates } from '../server/core/quality/qualityMetrics.ts';
import { renderQualityReport } from '../server/core/quality/qualityReport.ts';
import type { JevAdapter } from '../server/ai/adapters/jev/index.ts';
import { executeQualityRun, failInterruptedRuns, reportForStorage, startQualityRun, withBudget } from '../server/core/quality/qualityRuns.ts';
import { registerQualityRoutes } from '../server/core/quality/qualityRoutes.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import type { CoreRepository } from '../server/core/types.ts';
import express from 'express';
import type { AddressInfo } from 'node:net';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// ── Підставні моделі ─────────────────────────────────────────────────────────
const stems = (s: string) => (s.toLowerCase().match(/[\p{L}']+/gu) ?? []).filter((w) => w.length >= 4).map((w) => w.slice(0, 4));
const STOP = new Set(['тобі', 'твоє', 'твій', 'чому', 'якщо', 'зараз', 'насп']);

/** Голос героя: відповідає тим спогадом / переконанням із СВОГО запиту, що має спільне слово з питанням. */
const honestVoice = (mutate?: (reply: string, user: string) => string) => async (_system: string, user: string) => {
  const q = (/Питання автора: (.*)$/m.exec(user) ?? [])[1] ?? '';
  const snap = (/Знімок героя станом на цю сцену:\n([\s\S]*?)\n\nРішення на цей хід/.exec(user) ?? [])[1] ?? '{}';
  let lines: string[] = [];
  try {
    const j = JSON.parse(snap);
    lines = [...(j.memories ?? []), ...(j.beliefs ?? []), ...(j.confirmed_facts ?? []), ...(j.recent_text ?? [])].map(String);
  } catch {
    lines = [];
  }
  const qs = stems(q).filter((s) => !STOP.has(s));
  // До двох рядків свого знімка, що мають спільне слово з питанням.
  const found = lines.filter((l) => stems(l).some((s) => qs.includes(s))).slice(0, 2);
  let reply = found.length ? `— ${found.map((f) => f.replace(/^[a-z_]+: /, '')).join(' ')} — Більше не скажу.` : `— Не знаю. ${q.length > 20 ? 'Спитайте інакше.' : 'Облиште.'}`;
  reply = `${reply} (${q.slice(0, 30)})`;
  if (mutate) reply = mutate(reply, user);
  return { text: JSON.stringify({ reply, intent: 'ухилитися' }), modelId: 'fake-voice', inputTokens: Math.ceil(user.length / 4), outputTokens: Math.ceil(reply.length / 4), costUsd: 0.0001 };
};

/** Jev: дія за змістом питання (перефразування одного змісту — одна дія). */
const CLASS: [RegExp, string][] = [
  [/довір|поклас/i, 'deflect'],
  [/брат|тарас/i, 'answer'],
  [/вкрав|архів|сейф/i, 'lie'],
  [/втом|додому/i, 'silence'],
];
const fakeJev: JevAdapter = {
  name: 'jev',
  evaluate: async (snapshot, questions) => {
    const situation = snapshot.situation ?? '';
    // Суддя (В2): характер — відповідь спирається на пам'ять / переконання героя; стиль — діалогове тире, як у книзі.
    if (questions.some((q) => q.id === 'character_fit')) {
      const reply = (/Відповідь героя: «([\s\S]*)»$/.exec(situation) ?? [])[1] ?? '';
      const own = [...(snapshot.memories ?? []).map((m) => m.content), ...(snapshot.beliefs ?? []).map((b) => b.statement)];
      const grounded = own.some((l) => stems(l).some((x) => stems(reply).includes(x) && !STOP.has(x)));
      return {
        selected_action: '', raw_distributions: {}, confidence: 0.8, model_version: 'jev-fake', snapshot_hash: 'e'.repeat(32), decision_trace_id: 'judge', source: 'jev', corrected: false,
        usage: { input_tokens: 500, output_tokens: 0 }, latency_ms: 2,
        scores: { character_fit: grounded ? 8 : 4, style_fit: /^\s*—/.test(reply) ? 7 : 3 },
        checks: { contradicts_state: 0.1 },
      } as any;
    }
    const cls = CLASS.find(([re]) => re.test(situation))?.[1];
    const answers: Record<string, any> = {};
    let selected = '';
    const scores: Record<string, number> = {};
    for (const q of questions) {
      if (q.kind === 'choice') {
        const keys = Object.keys(q.options);
        const pick = cls && keys.includes(cls) ? cls : keys[situation.length % keys.length];
        answers[q.id] = pick;
        if (!selected || q.id === 'next_action') selected = pick;
      } else if (q.kind === 'score') scores[q.id] = 5;
    }
    return {
      selected_action: selected,
      scores,
      raw_distributions: {},
      confidence: 0.9,
      model_version: 'jev-fake',
      snapshot_hash: 'f'.repeat(32),
      decision_trace_id: `fake-${Math.random().toString(36).slice(2)}`,
      source: 'jev',
      corrected: false,
      usage: { input_tokens: 400, output_tokens: 0 },
      latency_ms: 3,
      choices: Object.fromEntries(Object.entries(answers).filter(([id]) => id !== 'next_action')),
    } as any;
  },
};

/** Запасний LLM: дія за довжиною ситуації — без розуміння змісту (тому сталість нижча, і це видно у звіті). */
const fakeLlm = async (_s: string, user: string) => {
  const sit = (/"situation": "([^"]*)"/.exec(user) ?? [])[1] ?? user;
  const answers: Record<string, unknown> = {};
  for (const m of user.matchAll(/Питання "([a-z_0-9]+)" \(вибір\)[^\n]*\nВаріанти: ([^\n]+)/g)) {
    const opts = m[2].split(',').map((x) => x.trim());
    answers[m[1]] = { choice: opts[sit.length % opts.length] };
  }
  for (const m of user.matchAll(/Питання "([a-z_0-9]+)" \(оцінка\)/g)) answers[m[1]] = { score: 2 };
  return { text: JSON.stringify({ answers }), modelId: 'fake-llm', inputTokens: 300, outputTokens: 40 };
};

const deps = { voice: honestVoice(), jev: fakeJev, fallbackLlm: fakeLlm, priceLlm: () => 0.00005, label: 'підставні моделі (test:living-characters)' };

console.log('\nКонтрольний набір:');
{
  const set = LIVING_CHARACTERS_SET;
  const dims = new Set(set.cases.map((c) => c.dimension));
  t('усі виміри мають кейси: пам\'ять, ізоляція, спойлери, сталість, різноманітність, стиль', ['memory', 'isolation', 'spoiler', 'consistency', 'diversity', 'style'].every((d) => dims.has(d as any)));
  t('пари перефразувань — щонайменше по два кейси', [...new Set(set.cases.filter((c) => c.pair).map((c) => c.pair))].every((p) => set.cases.filter((c) => c.pair === p).length >= 2));
  const chapterOf = (id: string) => (id === 'qa-s3' ? 2 : 1);
  const olena = forbiddenFor(set, set.cases.find((c) => c.id === 'iso-who')!, chapterOf);
  const marko = forbiddenFor(set, set.cases.find((c) => c.id === 'mem-own-secret')!, chapterOf);
  t('заборони: Олені — таємниця Марка й майбутнє; Маркові — код Олени, але не власна таємниця', olena.secret.includes('котельн') && !olena.secret.includes('4417') && olena.future.includes('креслення') && marko.secret.includes('4417') && !marko.secret.includes('котельн'));
}

console.log('\nПрогін на підставних моделях — два режими:');
const report = await runLivingCharacters(LIVING_CHARACTERS_SET, deps);
const withJev = report.modes.find((m) => m.mode === 'with_jev')!;
const noJev = report.modes.find((m) => m.mode === 'without_jev')!;
const n = LIVING_CHARACTERS_SET.cases.length;
t(`обидва режими: ${n} кейсів, усі з відповіддю`, report.modes.length === 2 && report.modes.every((m) => m.metrics.turns === n && m.metrics.answered === n), report.modes.map((m) => `${m.mode}:${m.metrics.answered}`).join(', '));
t('з Jev — джерело рішень jev; без Jev — запасний LLM', withJev.turns.every((x) => x.source === 'jev') && noJev.turns.every((x) => x.source === 'llm_fallback') && noJev.metrics.performance.fallbackShare === 1 && withJev.metrics.performance.fallbackShare === 0);
t('ізоляція: перевірено кожен хід, витоків 0 (в обох режимах)', report.modes.every((m) => m.metrics.isolation.checked === n && m.metrics.isolation.leaks === 0), JSON.stringify(report.modes.map((m) => m.metrics.isolation.examples)));
t('спойлери: перевірено ходи з межею до гл. 2, витоків 0', report.modes.every((m) => m.metrics.spoilers.checked === n && m.metrics.spoilers.leaks === 0), JSON.stringify(withJev.metrics.spoilers));
const own = withJev.turns.find((x) => x.caseId === 'mem-own-secret')!;
t('позитивний контроль: власна таємниця Марка — у ЙОГО запиті й відповіді (детектор витоків не порожній)', own.seen.prompts.some((p) => /котельн/.test(p)) && /архів/.test(own.reply), own.reply);
t('у кожного ходу перехоплено запит голосу й стан для Jev', withJev.turns.every((x) => x.seen.prompts.length === 1 && x.seen.jevStates.length >= 1));
t('точність пам\'яті з Jev — 100% (компас, сварка, заздрість, власний архів Марка)', withJev.metrics.memory.accuracy === 1, `${withJev.metrics.memory.hits}/${withJev.metrics.memory.cases}, промахи: ${withJev.metrics.memory.misses.join(',')}`);
t('різноманітність: щонайменше 3 різні дії, повторів відповіді немає', withJev.metrics.diversity.distinctActions >= 3 && withJev.metrics.diversity.repetitionRate === 0, JSON.stringify(withJev.metrics.diversity));
t('сталість на перефразуваннях з Jev — 100% (2 пари)', withJev.metrics.consistency.rate === 1 && withJev.metrics.consistency.pairs === 2, JSON.stringify(withJev.metrics.consistency.details));
t('без Jev сталість нижча — порівняння показує різницю', (noJev.metrics.consistency.rate ?? 1) < 1, JSON.stringify(noJev.metrics.consistency.details));
t('час і вартість: голос ($0.0001 × ходи) + рішення (Jev за токенами, LLM за ціною)', withJev.metrics.performance.voiceCostUsd === Math.round(0.0001 * n * 1e6) / 1e6 && withJev.metrics.performance.decisionCostUsd > 0 && noJev.metrics.performance.decisionCostUsd > 0 && withJev.metrics.performance.decisionCalls > n, JSON.stringify(withJev.metrics.performance));
t('ворота: з Jev — усі пройдено; без Jev — жорсткі пройдено', withJev.passed && noJev.gates.filter((g) => g.kind === 'hard').every((g) => g.passed) && noJev.gates.every((g) => g.kind === 'hard'), JSON.stringify(withJev.gates.filter((g) => !g.passed)));
t('підсумок прогону — пройдено', report.passed);

console.log('\nJev-суддя і стилометрія (В2):');
{
  t('кожна відповідь оцінена суддею в обох режимах (один суддя — чесне порівняння)', report.modes.every((m) => m.metrics.judge.judged === n && m.metrics.judge.errors === 0), report.modes.map((m) => m.metrics.judge.judged).join('/'));
  t('«у характері героя» вище там, де відповідь спирається на пам\'ять героя', withJev.turns.find((x) => x.caseId === 'mem-compass')!.judge!.characterFit === 8 && withJev.turns.find((x) => x.caseId === 'div-tired')!.judge!.characterFit === 4);
  t('середні оцінки й частка суперечностей — у звіті; ворота судді пройдено', withJev.metrics.judge.characterFitAvg! >= 6 && withJev.metrics.judge.styleFitAvg === 7 && withJev.metrics.judge.contradictionRate === 0 && ['character_fit', 'style_fit', 'contradiction'].every((id) => withJev.gates.find((g) => g.id === id)?.passed && !withJev.gates.find((g) => g.id === id)?.skipped), JSON.stringify(withJev.metrics.judge));
  t('стан для судді теж перевірено на витоки (по два стани Jev на хід: рішення + суддя)', withJev.turns.every((x) => x.seen.jevStates.length >= 2) && withJev.metrics.isolation.leaks === 0);
  t('вартість судді — окремо і в разом', withJev.metrics.judge.costUsd > 0 && withJev.metrics.performance.totalCostUsd > withJev.metrics.performance.voiceCostUsd + withJev.metrics.performance.decisionCostUsd);
  t('стилометрія: слова в реченні й діалогове тире — відповіді проти тексту автора', withJev.metrics.style.authorSentenceWords! > 0 && withJev.metrics.style.replySentenceWords! > 0 && withJev.metrics.style.replyDashShare === 1 && withJev.metrics.style.authorDashShare! > 0, JSON.stringify(withJev.metrics.style));
  const noJudge = await runMode(LIVING_CHARACTERS_SET, 'with_jev', { ...deps, judge: null });
  t('без судді — ворота характеру й стилю пропущено (і так і показано), не пройдено мовчки', noJudge.metrics.judge.judged === 0 && ['character_fit', 'style_fit', 'contradiction'].every((id) => noJudge.gates.find((g) => g.id === id)?.skipped) && /пропущено/.test(renderQualityReport({ ...report, modes: [noJudge] })));
}

console.log('\nВорота самі ловлять поломки:');
{
  const leaky = await runMode(LIVING_CHARACTERS_SET, 'with_jev', { ...deps, voice: honestVoice((r) => `${r} Архів у котельні.`) });
  t('голос «пробалакується» чужою таємницею — витоки є, ворота «ізоляція» не пройдено', leaky.metrics.isolation.leaks > 0 && !leaky.gates.find((g) => g.id === 'isolation')!.passed && !leaky.passed, leaky.metrics.isolation.examples[0]);
  t('…витік у відповіді названо (де саме)', leaky.metrics.isolation.examples.some((e) => /котельн.*відповідь/.test(e)));
  const parrot = await runMode(LIVING_CHARACTERS_SET, 'with_jev', { ...deps, voice: async () => ({ text: JSON.stringify({ reply: 'Не знаю.' }), modelId: 'parrot', inputTokens: 1, outputTokens: 1 }) });
  t('однакова відповідь на все — повтори 100%, пам\'ять 0%, ворота не пройдено', parrot.metrics.diversity.repetitionRate === 1 && parrot.metrics.memory.accuracy === 0 && !parrot.passed);
  t('…і суддя бачить: не в характері (4/10) і не в стилі автора (3/10) — ворота судді не пройдено', parrot.metrics.judge.characterFitAvg === 4 && parrot.metrics.judge.styleFitAvg === 3 && !parrot.gates.find((g) => g.id === 'character_fit')!.passed && !parrot.gates.find((g) => g.id === 'style_fit')!.passed);
  const sameAction: JevAdapter = { name: 'jev', evaluate: async (s, q) => ({ ...(await fakeJev.evaluate({ ...s, situation: 'x' }, q)) }) };
  const flat = await runMode(LIVING_CHARACTERS_SET, 'with_jev', { ...deps, jev: sameAction });
  t('Jev завжди обирає одне — різних дій 1, ворота «різноманітність» не пройдено', flat.metrics.diversity.distinctActions === 1 && !flat.gates.find((g) => g.id === 'diversity')!.passed);
  const turn = (over: Partial<QualityTurn>): QualityTurn => ({
    caseId: 'x', hero: 'Олена', dimension: 'spoiler', pair: null, expect: [], question: 'q', status: 'answered', reply: 'ні', action: 'answer', source: 'jev', fallbackReason: null, error: null, latencyMs: 10,
    voice: { inputTokens: 1, outputTokens: 1, costUsd: 0, model: 'm' }, seen: { prompts: ['…креслення…'], jevStates: ['{}'] }, forbidden: { secret: [], future: ['креслення'] }, judge: null, ...over,
  });
  const m = computeMetrics([turn({}), turn({ caseId: 'y', seen: { prompts: [''], jevStates: ['{"memories":["Конкурент"]}'] }, forbidden: { secret: [], future: ['конкурент'] } })], { calls: 0, bySource: {}, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 });
  t('майбутнє в запиті голосу чи в стані Jev — спойлер, із місцем', m.spoilers.leaks === 2 && m.spoilers.examples.some((e) => /запит голосу/.test(e)) && m.spoilers.examples.some((e) => /стан Jev/.test(e)) && !evaluateGates(LIVING_CHARACTERS_SET.gates, m, 'without_jev').find((g) => g.id === 'spoilers')!.passed);
  const failed = computeMetrics([turn({ status: 'failed', reply: '', forbidden: { secret: [], future: [] } })], { calls: 0, bySource: {}, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 });
  t('хід без відповіді — ворота «усі кейси з відповіддю» не пройдено', !evaluateGates(LIVING_CHARACTERS_SET.gates, failed, 'without_jev').find((g) => g.id === 'answered')!.passed);
}

console.log('\nЛіміт витрат і журнал прогонів (В3):');
{
  const tight = withBudget(deps, 0.0005);
  const r = await runMode(LIVING_CHARACTERS_SET, 'with_jev', tight.deps);
  t('бюджет $0.0005: голос по $0.0001 — після вичерпання платних викликів немає, ходи — збій, ворота не пройдено', tight.meter.exceeded() && tight.meter.spent() < 0.0012 && r.metrics.failed > 0 && !r.passed, `витрачено ${tight.meter.spent().toFixed(6)}, збоїв ${r.metrics.failed}`);
  const stored = reportForStorage(report) as any;
  t('звіт для бази — без промптів і станів Jev (лише кількість)', stored.modes.every((m: any) => m.turns.every((x: any) => typeof x.seen.prompts === 'number' && typeof x.seen.jevStates === 'number')) && !JSON.stringify(stored).includes('Знімок героя станом'));
}

async function runsSuite(label: string, repo: CoreRepository) {
  console.log(`\nЖурнал прогонів — ${label}:`);
  const { run, done } = await startQualityRun(repo, { set: LIVING_CHARACTERS_SET, deps, actor: 'user:admin', budgetUsd: 1, models: { voice: 'fake-voice' }, label: 'тест' });
  t('запуск — запис одразу (у черзі), набір і версія, бюджет, моделі', run.status === 'queued' && run.setId === 'living-characters' && run.setVersion === LIVING_CHARACTERS_SET.version && run.budgetUsd === 1 && (run.models as any).voice === 'fake-voice');
  const fin = await done;
  t('завершено: succeeded, ворота пройдено, підсумок двох режимів, вартість, час старту й кінця', fin.status === 'succeeded' && fin.passed === true && (fin.summary as any).modes.length === 2 && fin.costUsd > 0 && !!fin.startedAt && !!fin.finishedAt && fin.error === null, JSON.stringify({ s: fin.status, c: fin.costUsd, e: fin.error }));
  const got = (await repo.getQualityRun(run.id))!;
  t('повний звіт — у getQualityRun; у переліку — без звіту (легкий)', (got.report as any)?.modes?.[0]?.turns?.length === LIVING_CHARACTERS_SET.cases.length && (await repo.listQualityRuns({ setId: 'living-characters' }))[0].report === null);
  const over = await repo.addQualityRun({ setId: 'living-characters', setVersion: 2, createdBy: 'user:admin', budgetUsd: 0.0003 });
  const overFin = await executeQualityRun(repo, over.id, { set: LIVING_CHARACTERS_SET, deps, actor: 'user:admin', budgetUsd: 0.0003, modes: ['with_jev'] });
  t('бюджет вичерпано — failed, частковий звіт, причина з сумою', overFin.status === 'failed' && overFin.passed === false && !!overFin.report && /Бюджет прогону вичерпано/.test(overFin.error ?? ''), overFin.error ?? '');
  const hang = await repo.addQualityRun({ setId: 'living-characters', setVersion: 2, createdBy: 'user:admin' });
  await repo.updateQualityRun(hang.id, { status: 'running' });
  let conflict = '';
  try {
    await startQualityRun(repo, { set: LIVING_CHARACTERS_SET, deps, actor: 'user:admin', budgetUsd: 1 });
  } catch (err) {
    conflict = (err as any).code;
  }
  t('поки прогін іде — другий не запускається (conflict)', conflict === 'conflict');
  t('після перезапуску — «йде» стає «перервано»', (await failInterruptedRuns(repo)) === 1 && (await repo.getQualityRun(hang.id))!.status === 'failed' && /перезапуском/.test((await repo.getQualityRun(hang.id))!.error ?? ''));
  t('правила: статус і бюджет у межах', (await repo.addQualityRun({ setId: 'x', setVersion: 1, createdBy: 'user:a', budgetUsd: -1 }).then(() => 'ok', (e) => e.code)) === 'bad_input' &&
    (await repo.updateQualityRun(run.id, { status: 'done' as any }).then(() => 'ok', (e) => e.code)) === 'bad_input' && (await repo.addQualityRun({ setId: 'x', setVersion: 1, createdBy: 'ai:x' as any }).then(() => 'ok', (e) => e.code)) !== 'ok');
}

await runsSuite('пам\'ять', new MemoryCoreRepository());

console.log('\nМаршрути адмінки (В3):');
{
  const repo = new MemoryCoreRepository();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = req.headers['x-user'] ? { id: String(req.headers['x-user']), role: req.headers['x-admin'] ? 'admin' : 'writer' } : undefined; next(); });
  const requireAdmin = (req: any, res: any, next: any) => (req.principal?.role === 'admin' ? next() : res.status(403).json({ error: 'лише адміністратор' }));
  registerQualityRoutes(app, { repo: () => repo, requireAdmin, makeDeps: async () => ({ deps, models: { voice: 'fake-voice' } }) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/quality`;
  const call = async (method: string, p: string, body?: unknown, admin = true) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-user': 'u1', ...(admin ? { 'x-admin': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, text: await r.clone().text(), body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    t('не адміністратор — 403', (await call('GET', '/living-characters', undefined, false)).status === 403 && (await call('POST', '/runs', {}, false)).status === 403);
    const g = await call('GET', '/living-characters');
    t('GET набору: кейси, герої, ворота, бюджет, прогонів ще немає', g.status === 200 && g.body.set.cases.length === LIVING_CHARACTERS_SET.cases.length && g.body.set.heroes.join() === 'Олена,Марко' && g.body.budget.maxUsd === 20 && g.body.runs.length === 0 && g.body.running === false);
    t('POST з бюджетом поза межами чи без режимів — 400', (await call('POST', '/runs', { budgetUsd: 100 })).status === 400 && (await call('POST', '/runs', { modes: ['x'] })).status === 400);
    const st = await call('POST', '/runs', { budgetUsd: 0.5, modes: ['with_jev'] });
    t('POST — 202, прогін у черзі, хто запустив', st.status === 202 && st.body.run.status === 'queued' && st.body.run.createdBy === 'user:u1' && st.body.run.budgetUsd === 0.5);
    let run: any = null;
    for (let i = 0; i < 50 && run?.status !== 'succeeded' && run?.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      run = (await call('GET', `/runs/${st.body.run.id}`)).body.run;
    }
    t('GET прогону — завершено, звіт одного режиму', run?.status === 'succeeded' && run.report.modes.length === 1 && run.report.modes[0].mode === 'with_jev', run?.status);
    const md = await call('GET', `/runs/${st.body.run.id}/report.md`);
    t('звіт Markdown — для завантаження', md.status === 200 && /# Якість живих персонажів/.test(md.text));
    t('невідомий прогін — 404', (await call('GET', '/runs/00000000-0000-4000-8000-000000000000')).status === 404);
    t('перелік — з прогоном і без звіту', (await call('GET', '/living-characters')).body.runs.length === 1);
  } finally {
    server.close();
  }
}

const pgUrl = process.env.CORE_TEST_DATABASE_URL?.trim();
if (pgUrl) {
  const pool = createCorePool(pgUrl);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v18 (прогони якості)', Number(rows[0].v) >= 18, `v${rows[0].v}`);
    await runsSuite('PostgreSQL', new PgCoreRepository(pool));
    const refused = await pool.query(`INSERT INTO ${CORE_SCHEMA}.quality_runs (set_id, set_version, status, created_by) VALUES ('x', 1, 'succeeded', 'user:a')`).then(() => false, () => true);
    t('CHECK у базі: завершений прогін без часу завершення — ні', refused);
  } catch (err) {
    t('прогони якості на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
} else {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — журнал прогонів перевірено на сховищі в пам\'яті');
}

console.log('\nЗвіт:');
const md = renderQualityReport(report);
t('Markdown: кожен вимір — рядком з числами для обох режимів', ['ізоляція знань', 'спойлери', 'точність пам\'яті', 'різних дій Jev', 'повторів відповіді', 'сталість на перефразуваннях', 'у характері героя', 'у стилі автора', 'слів у реченні', 'затримка ходу', 'вартість на хід'].every((s) => md.includes(s)) && md.includes('з Jev') && md.includes('без Jev'));
t('JSON-звіт серіалізується (для збереження прогонів, В3)', JSON.parse(JSON.stringify(report)).modes.length === 2);
const at = process.argv.indexOf('--report');
if (at > 0 && process.argv[at + 1]) {
  fs.writeFileSync(process.argv[at + 1], md);
  fs.writeFileSync(process.argv[at + 1].replace(/\.md$/, '') + '.json', JSON.stringify(report, null, 1));
  console.log(`  (звіт: ${process.argv[at + 1]})`);
}
console.log('\n' + md.split('\n## Ворота')[0]);

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
