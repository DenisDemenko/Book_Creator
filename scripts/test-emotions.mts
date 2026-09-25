/**
 * Емоційний монітор — задача Т2.2 (журнал #259).
 *
 * Критерій сторінки 4 (ТЗ-11): будь-яку оцінку можна відкрити й перевірити за
 * її вихідними абзацами — середнє кривої, «до / після» події, настрій сцени
 * несуть свої точки, кожна точка — абзац. Плюс: родини, шар (основна /
 * другорядна / прихована) і сила з тега; три показники (сила, майстерність
 * передачі, вплив на сюжет); шкали глав, сцен і часу світу (Т2.1); один чи
 * кілька героїв; мітки подій; ручне коригування точки з тега без зміни
 * тексту; «недостатньо даних»; пропозиції AI-2 з підтвердженням; права.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:emotions
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
import { AI_EMOTIONS_JOB_KIND, EMOTION_POINT, aiEmotionsJobKind, buildEmotionMonitor, createEmotionPreparer } from '../server/core/emotions.ts';
import { emotionFamily, parseIntensity, parseLayer } from '../src/utils/emotionScale.ts';
import { normalizeStoryTime } from '../src/utils/storyTime.ts';
import { CoreRuleError } from '../server/core/rules.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import type { CoreRepository } from '../server/core/types.ts';
import type { JobStore } from '../server/core/jobs/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nШкала емоцій:');
{
  t('родини: тривога і жах — страх; сором — провина; смуток — сум', emotionFamily('тривога') === 'fear' && emotionFamily('Жах') === 'fear' && emotionFamily('сором') === 'guilt' && emotionFamily('смуток') === 'sadness');
  t('«сумнів» — не «сум»; незнайоме — «інше»', emotionFamily('сумнів') === 'other' && emotionFamily('ностальгія') === 'other' && emotionFamily('сум') === 'sadness');
  t('рішучість, полегшення, надія, ніжність', emotionFamily('рішучість') === 'resolve' && emotionFamily('полегшення') === 'joy' && emotionFamily('надія') === 'hope' && emotionFamily('ніжність') === 'love');
  t('сила: число, дріб, відсотки', parseIntensity(['страх', '7']) === 7 && parseIntensity(['страх', '7/10']) === 7 && parseIntensity(['страх', '3/5']) === 6 && parseIntensity(['страх', '70%']) === 7);
  t('сила словом: слабка 3, сильна 8, дуже сильна 10', parseIntensity(['страх', 'слабка']) === 3 && parseIntensity(['страх', 'сильна']) === 8 && parseIntensity(['страх', 'дуже сильна']) === 10);
  t('без сили — null; понад 10 — 10', parseIntensity(['страх']) === null && parseIntensity(['страх', '15']) === 10);
  t('сила — у будь-якому пізнішому полі, якщо друге — слово-опис', parseIntensity(['страх', 'довго', '6']) === 6);
  t('шар: «прихована» / «підтекст», «другорядна» / «фонова»; інакше основна', parseLayer(['сором', '4', 'прихована']) === 'hidden' && parseLayer(['сором', 'підтекст']) === 'hidden' && parseLayer(['страх', 'фонова']) === 'secondary' && parseLayer(['страх', '7']) === 'primary' && parseLayer(['прихована']) === 'primary');
}

async function suite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nЕмоційний монітор (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Сцена ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }, { id: 'c-i', name: 'Ірина' }],
    chapters: [
      { id: 'ch1', title: 'Перша', order: 0, sections: [sec('s1', 0, [
        '[/character:Олена] [/emotion:страх — 3 @Олена] Олена почула кроки.',
        '[/character:Марко] [/emotion:радість — 6 @Марко] Марко сміявся.',
        '[/character:Ірина] [/emotion:сором — 4 — прихована @Ірина] Ірина відвела очі.',
      ].join('\n\n'))] },
      { id: 'ch2', title: 'Друга', order: 1, sections: [sec('s2', 0, [
        '[/event:Пожежа] [/emotion:жах — 9 @Олена] Будинок горів.',
        '[/character:Марко] [/emotion:радість — 6 @Марко] Марко радів, що всі живі.',
      ].join('\n\n'))] },
      { id: 'ch3', title: 'Третя', order: 2, sections: [sec('s3', 0, [
        '[/emotion:тривога @Олена] Олена не спала.',
        '[/emotion:провина — сильна @Олена] Олена думала про брата.',
        '[/emotion:радість — 6 @Марко] Марко приніс чай.',
      ].join('\n\n'))] },
      { id: 'ch4', title: 'Четверта', order: 3, sections: [sec('s4', 0, [
        '[/emotion:страх — 0 @Олена] Олена спокійно пройшла повз двері.',
        '[/emotion:смуток] Дощ ішов цілий день.',
        '[/emotion:радість — 6 @Марко] Марко співав.',
        'Олена відчинила вікно і вперше усміхнулась.',
      ].join('\n\n'))] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const olena = await id('character', 'Олена');
  const marko = await id('character', 'Марко');
  const fire = await id('event', 'Пожежа');
  const [q1] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const [, , , q4] = (await repo.listParagraphs(P, 's4')).map((p) => p.id);
  const [r1] = (await repo.listParagraphs(P, 's3')).map((p) => p.id);

  const irina = await id('character', 'Ірина');
  const m = await buildEmotionMonitor(repo, P);
  t('точки з тегів: 11, одна без героя, дві без сили', m.totals.tag === 11 && m.totals.withoutSubject === 1 && m.totals.estimated === 2, JSON.stringify(m.totals));
  t('герої — за кількістю точок', m.characters.map((c) => `${c.name}:${c.points}`).join() === 'Олена:5,Марко:4,Ірина:1');
  const fear = m.series.find((s) => s.characterId === olena && s.family === 'fear')!;
  t('крива страху Олени по главах — 3, 9, 5 (тривога без сили), 0', fear.values.join() === '3,9,5,0', fear.values.join());
  const byId = new Map(m.points.map((p) => [p.id, p]));
  t('КРИТЕРІЙ: кожне значення кривої відкривається до своїх абзаців (гл. 2 — «Будинок горів»)',
    m.series.every((s) => s.values.every((v, i) => (v == null) === (s.pointIds[i].length === 0))) &&
    fear.pointIds[1].length === 1 && /Будинок горів/.test(byId.get(fear.pointIds[1][0])!.place.excerpt) &&
    m.points.every((p) => p.place.paragraphId && p.place.sectionId && p.place.editorPid));
  t('провина — окрема крива, «сильна» = 8, лише в гл. 3', m.series.find((s) => s.characterId === olena && s.family === 'guilt')!.values.join() === ',,8,');
  const est = m.points.find((p) => p.emotion === 'тривога')!;
  t('точка без сили — позначена як оцінена; назва автора збережена', est.estimated && est.intensity === 5 && est.family === 'fear');
  const shame = m.points.find((p) => p.characterId === irina)!;
  t('шар з тега: сором Ірини — прихований; слово шару не йде в примітку', shame.layer === 'hidden' && shame.note === '' && m.points.filter((p) => p.layer === 'primary').length === 10);
  t('точки на осі глав 0…4', m.axis === 'chapter' && m.buckets.length === 4 && m.points.every((p) => p.place.x != null && p.place.x >= 0 && p.place.x < 4));
  t('настрій сцен: 4 сцени з доказами; у гл. 2 переважає страх; гл. 4 — важча', m.scenes.length === 4 && m.scenes[1].dominant === 'fear' && m.scenes[3].valence < 1 && m.scenes.every((s) => s.editorPid && s.pointIds.length === s.points));
  const kinds = m.warnings.map((w) => w.kind).sort().join();
  t('попередження: стрибок без події, пласка крива Марка, емоція без героя, мало даних в Ірини', kinds === 'flat,insufficient,jump,no_subject', kinds);
  const jump = m.warnings.find((w) => w.kind === 'jump')!;
  t('стрибок 5 → 0 у гл. 4 — з переходом і обома точками; 3 → 9 із «Пожежею» — не стрибок', /5 → 0/.test(jump.message) && jump.sectionId === 's4' && !!jump.editorPid && jump.pointIds.length === 2 && m.warnings.filter((w) => w.kind === 'jump').length === 1, jump.message);
  t('пласка крива — про Марка; «недостатньо даних» — про Ірину', m.warnings.find((w) => w.kind === 'flat')!.characterId === marko && m.warnings.find((w) => w.kind === 'insufficient')!.characterId === irina && /недостатньо даних/.test(m.warnings.find((w) => w.kind === 'insufficient')!.message));
  t('мітки подій на шкалі — «Пожежа» в гл. 2', m.events.map((e) => e.name).join() === 'Пожежа' && m.events[0].chapterNumber === 2 && m.events[0].x! > 1 && m.events[0].x! < 2);

  const imp = (await buildEmotionMonitor(repo, P, { event: fire, window: 1 })).impact!;
  const fearRow = imp.rows.find((r) => r.characterId === olena && r.family === 'fear')!;
  t('«до / після» Пожежі (±1 глава): страх Олени 3 → 5, абзац події — межа; рядок відкривається до абзаців', fearRow.before?.avg === 3 && fearRow.after?.avg === 5 && fearRow.delta === 2 && fearRow.pointIds.length === 2, JSON.stringify(fearRow));
  const joyRow = imp.rows.find((r) => r.characterId === marko)!;
  t('у Марка без змін (Δ 0); провина Олени — лише «після» (недостатньо даних для Δ)', joyRow.delta === 0 && imp.rows.find((r) => r.family === 'guilt' && r.characterId === olena)!.before === null && imp.rows.find((r) => r.family === 'guilt' && r.characterId === olena)!.delta === null && imp.window === 1);

  const onlyO = await buildEmotionMonitor(repo, P, { characters: [olena] });
  t('один герой: лише його точки, без «емоції без героя»; є абзаци для ручної точки', onlyO.points.every((p) => p.characterId === olena) && !onlyO.warnings.some((w) => w.kind === 'no_subject') && onlyO.anchors.length === 5 && onlyO.selected.join() === olena);
  const two = await buildEmotionMonitor(repo, P, { characters: [olena, irina, 'нема'] });
  t('кілька героїв: Олена й Ірина, невідомий — пропущено', two.selected.length === 2 && new Set(two.series.map((s) => s.characterId)).size === 2 && two.points.every((p) => p.characterId === olena || p.characterId === irina));
  t('фільтри родини й шару', (await buildEmotionMonitor(repo, P, { family: 'guilt' })).points.length === 2 && (await buildEmotionMonitor(repo, P, { layer: 'hidden' })).points.length === 1);

  // ── Шкали сцен і часу світу ──
  const bySc = await buildEmotionMonitor(repo, P, { characters: [olena], axis: 'scene' });
  t('шкала сцен: 4 сцени, страх 3, 9, 5, 0', bySc.axis === 'scene' && bySc.buckets.length === 4 && bySc.buckets[0].title === 'Сцена s1' && bySc.series.find((s) => s.family === 'fear')!.values.join() === '3,9,5,0');
  const put = (sid: string, start: string) => {
    const v = normalizeStoryTime({ kind: 'exact', start }) as any;
    return repo.upsertTimePoint({ projectId: P, subjectKind: 'scene', subjectId: sid, kind: 'exact', start: v.start, end: null, sortKey: v.key, endKey: null, label: '', createdBy: 'user:u-owner' });
  };
  await put('s1', '2024');
  await put('s2', '1998');
  await put('s3', '2025');
  const world = await buildEmotionMonitor(repo, P, { characters: [olena], axis: 'world' });
  t('шкала часу світу (Т2.1): 1998 (пожежа — флешбек), 2024, 2025; страх 9, 3, 5; сцена без часу — поза шкалою', world.buckets.map((b) => b.label).join() === '1998,2024,2025' && world.series.find((s) => s.family === 'fear')!.values.join() === '9,3,5' && world.untimed === 1, `${world.buckets.map((b) => b.label).join()} ${world.series.find((s) => s.family === 'fear')?.values.join()} ${world.untimed}`);
  const studio = await buildEmotionMonitor(repo, P, { characters: [olena], axis: 'world', studioOrder: new Map([['s4', 3000]]) });
  t('час світу без точки — порядок зі Студії', studio.untimed === 0 && studio.buckets.length === 4);
  await repo.deleteTimePoint(P, 'scene', 's1');
  await repo.deleteTimePoint(P, 'scene', 's2');
  await repo.deleteTimePoint(P, 'scene', 's3');

  // ── Точки автора й ручне коригування ──
  const pt = await repo.upsertEmotionPoint({ projectId: P, characterId: olena, paragraphId: q4, emotion: 'полегшення', family: 'joy', intensity: 7, createdBy: 'user:u-owner' });
  const pt2 = await repo.upsertEmotionPoint({ projectId: P, characterId: olena, paragraphId: q4, emotion: 'полегшення', family: 'joy', intensity: 8, craft: 9, impact: 6, layer: 'secondary', note: 'усмішка', createdBy: 'user:u-owner' });
  t('точка автора: та сама емоція в тому ж абзаці — заміна; шар і показники збережено', pt.id === pt2.id && (await repo.listEmotionPoints(P)).length === 1 && pt2.intensity === 8 && pt2.craft === 9 && pt2.impact === 6 && pt2.layer === 'secondary' && pt2.status === 'confirmed' && pt2.source === 'author');
  const m2 = await buildEmotionMonitor(repo, P, { characters: [olena] });
  t('точка автора — на кривій радості Олени, гл. 4', m2.series.find((s) => s.family === 'joy')!.values[3] === 8 && m2.totals.author === 1);
  const craft = await buildEmotionMonitor(repo, P, { characters: [olena], metric: 'craft' });
  t('показник «майстерність передачі»: лише оцінені точки; решта — «недостатньо даних» (unscored)', craft.metric === 'craft' && craft.series.length === 1 && craft.series[0].values.join() === ',,,9' && craft.unscored === 5, `${craft.series.map((s) => s.values.join()).join('|')} ${craft.unscored}`);
  t('показник «вплив на сюжет» — окремо', (await buildEmotionMonitor(repo, P, { characters: [olena], metric: 'impact' })).series[0].values[3] === 6);

  const corr = await repo.upsertEmotionPoint({ projectId: P, characterId: olena, paragraphId: q1, emotion: 'страх', family: 'fear', intensity: 6, createdBy: 'user:u-owner' });
  const mc = await buildEmotionMonitor(repo, P, { characters: [olena] });
  const cp = mc.points.find((p) => p.place.paragraphId === q1)!;
  t('ручне коригування тега: у тезі 3, автор — 6; текст не змінено, точка одна, позначена', cp.corrected && cp.tagIntensity === 3 && cp.intensity === 6 && cp.source === 'author' && mc.points.filter((p) => p.place.paragraphId === q1).length === 1 && mc.totals.corrected === 1 && mc.series.find((s) => s.family === 'fear')!.values[0] === 6);
  await repo.upsertEmotionPoint({ projectId: P, characterId: olena, paragraphId: q1, emotion: 'страх', family: 'fear', intensity: 6, status: 'rejected', createdBy: 'user:u-owner' });
  t('відхилене автором — ховає й тег (на кривій страху гл. 1 порожньо)', (await buildEmotionMonitor(repo, P, { characters: [olena] })).series.find((s) => s.family === 'fear')!.values[0] === null);
  await repo.deleteEmotionPoint(P, corr.id);
  t('скасувати коригування — знову як у тезі (3)', (await buildEmotionMonitor(repo, P, { characters: [olena] })).series.find((s) => s.family === 'fear')!.values[0] === 3);

  const bad = async (patch: object) => { try { await repo.upsertEmotionPoint({ projectId: P, characterId: olena, paragraphId: q4, emotion: 'x', family: 'joy', intensity: 5, createdBy: 'user:u', ...patch } as any); return 'ok'; } catch (e) { return e instanceof CoreRuleError ? e.code : String(e); } };
  t('сховище: сила 11, дробова, майстерність 12, шар «x» — bad_input; чужий абзац чи герой — not_found',
    (await bad({ intensity: 11 })) === 'bad_input' && (await bad({ intensity: 2.5 })) === 'bad_input' && (await bad({ craft: 12 })) === 'bad_input' && (await bad({ layer: 'x' })) === 'bad_input' &&
    (await bad({ paragraphId: 'нема' })) === 'not_found' && (await bad({ characterId: '00000000-0000-4000-8000-000000000000' })) === 'not_found');
  t('видалити точку; повторно — false', (await repo.deleteEmotionPoint(P, pt.id)) && !(await repo.deleteEmotionPoint(P, pt.id)) && !(await repo.deleteEmotionPoint(P, 'не-uuid')));

  // ── AI-2: пропозиції ──
  const prep = createEmotionPreparer(olena, [{ paragraphId: q1, family: 'fear' }]);
  const dup = await prep({ kind: 'emotion_point', emotion: 'Тривога', intensity: 4, summary: 's', confidence: 0.8 }, { paragraphIds: [q1] });
  const fresh = await prep({ kind: 'emotion_point', emotion: 'Сором', intensity: 14, summary: 's', confidence: 0.8 }, { paragraphIds: [q1, r1] });
  t('підготовка: страх у вже позначеному абзаці — не пропонується; нове — по одному абзацу, сила ≤ 10', dup.length === 0 && fresh.length === 1 && fresh[0].paragraphIds.length === 1 && (fresh[0].payload as any).intensity === 10 && (fresh[0].payload as any).family === 'guilt');

  const calls: AiGenerateInput[] = [];
  const idOf = (user: string, needle: string) => (user.split('\n').find((l) => l.includes(needle))?.match(/^\[([^\]]+)\]/) ?? [])[1];
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    const u = input.user;
    const findings = [
      { kind: 'emotion_point', emotion: 'полегшення', intensity: 7, craft: 8, impact: 3, layer: 'secondary', summary: 'Вперше усміхнулась.', paragraph_ids: [idOf(u, 'вперше усміхнулась')], quote: 'вперше усміхнулась', confidence: 0.9 },
      { kind: 'emotion_point', emotion: 'надія', summary: 'Натяк, але доказу замало.', insufficient_data: true, confidence: 0.3 },
      { kind: 'emotion_point', emotion: 'страх', intensity: 4, summary: 'Кроки лякають.', paragraph_ids: [idOf(u, 'почула кроки')], quote: 'почула кроки', confidence: 0.7 },
      { kind: 'emotion_point', emotion: 'гнів', intensity: 6, summary: 'Без доказу.', paragraph_ids: [], confidence: 0.4 },
    ];
    return { text: JSON.stringify({ findings }), modelId: 'fake-ai2', engine: 'fake', inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  };
  let clock = Date.parse('2026-09-25T10:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_EMOTIONS_JOB_KIND, aiEmotionsJobKind({ repo: () => repo, generate, resolveModel: async () => 'fake-ai2' }));
  const { job } = await q.enqueue({ projectId: P, kind: AI_EMOTIONS_JOB_KIND, payload: { characterId: olena }, createdBy: 'user:u-owner' });
  await q.runOnce();
  clock += 61_000;
  const done = await jobStore.get(P, job.id);
  t('задача AI-2: нова пропозиція + «недостатньо даних»; повтор тега і «без доказу» — відсіяно', done?.status === 'succeeded' && (done.result as any)?.points === 2 && (done.result as any)?.rejected === 2, JSON.stringify(done?.result));
  t('у завданні AI-2 — шар, майстерність, вплив і «недостатньо даних»', /"layer"/.test(calls[0].user) && /"craft"/.test(calls[0].user) && /"impact"/.test(calls[0].user) && /insufficient_data/.test(calls[0].user));
  t('у запиті — лише абзаци Олени (без чужого «Марко співав»)', calls.length === 1 && calls[0].user.includes('вперше усміхнулась') && !calls[0].user.includes('Марко співав') && calls[0].module === 'coreAi2Analysis');
  const m3 = await buildEmotionMonitor(repo, P);
  const s0 = m3.suggestions[0];
  t('пропозиція — «на розгляд» з шаром і показниками, на криву ще не потрапляє', m3.suggestions.length === 2 && s0.family === 'joy' && s0.layer === 'secondary' && s0.craft === 8 && s0.impact === 3 && s0.place?.paragraphId === q4 && m3.totals.ai === 0);
  t('«недостатньо даних» від AI — окремо, без абзацу', m3.suggestions[1].insufficient && m3.suggestions[1].emotion === 'надія' && m3.suggestions[1].place === null);

  // ── Маршрути ──
  console.log(`\nМаршрути емоційного монітора (${label}):`);
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  let withQueue = true;
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', queue: () => (withQueue ? q : null) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const g = await call('GET', '/emotions', 'reader');
  t('GET: читач бачить монітор без змін; криві й пропозиції', g.status === 200 && g.body.canEdit === false && g.body.series.length >= 3 && g.body.suggestions.length === 2);
  t('чужому — 403', (await call('GET', '/emotions', 'stranger')).status === 403);
  const gi = await call('GET', `/emotions?event=${fire}&window=1&characters=${olena}`, 'owner');
  const gw = await call('GET', `/emotions?characters=${olena},${marko}&axis=scene&metric=craft&layer=primary`, 'owner');
  t('GET: кілька героїв, шкала сцен, показник, шар', gw.body.selected.length === 2 && gw.body.axis === 'scene' && gw.body.metric === 'craft' && gw.body.points.every((p: any) => p.layer === 'primary'));
  t('GET з подією й героєм — «до / після» лише для нього', gi.body.impact?.event.name === 'Пожежа' && gi.body.impact.rows.every((r: any) => r.characterId === olena) && gi.body.canEdit === true);
  const add = await call('POST', '/emotions/points', 'owner', { characterId: marko, paragraphId: q4, emotion: 'Рішучість', intensity: 9, craft: 7, impact: '', layer: 'hidden' });
  t('POST точки: 201, назва малими, родина з назви, шар і показники (порожнє — не оцінено)', add.status === 201 && add.body.point.emotion === 'рішучість' && add.body.point.family === 'resolve' && add.body.point.craft === 7 && add.body.point.impact === null && add.body.point.layer === 'hidden' && add.body.point.createdBy === 'user:u-owner');
  const fix = await call('POST', '/emotions/points', 'owner', { characterId: olena, paragraphId: q1, emotion: 'страх', intensity: 1 });
  t('POST коригування тега: крива з новою силою, текст той самий', fix.status === 201 && (await call('GET', `/emotions?characters=${olena}`, 'owner')).body.points.find((p: any) => p.place.paragraphId === q1).corrected === true);
  await call('DELETE', `/emotions/points/${fix.body.point.id}`, 'owner');
  t('POST: читачу — 403; сила 12 — 400; невідомий герой чи абзац — 404',
    (await call('POST', '/emotions/points', 'reader', { characterId: marko, paragraphId: q4, emotion: 'x', intensity: 1 })).status === 403 &&
    (await call('POST', '/emotions/points', 'owner', { characterId: marko, paragraphId: q4, emotion: 'x', intensity: 12 })).status === 400 &&
    (await call('POST', '/emotions/points', 'owner', { characterId: marko, paragraphId: q4, emotion: 'x', intensity: 1, craft: 11 })).status === 400 &&
    (await call('POST', '/emotions/points', 'owner', { characterId: marko, paragraphId: q4, emotion: 'x', intensity: 1, layer: 'x' })).status === 400 &&
    (await call('POST', '/emotions/points', 'owner', { characterId: fire, paragraphId: q4, emotion: 'x', intensity: 1 })).status === 404 &&
    (await call('POST', '/emotions/points', 'owner', { characterId: marko, paragraphId: 'нема', emotion: 'x', intensity: 1 })).status === 404);
  t('DELETE точки; повторно — 404', (await call('DELETE', `/emotions/points/${add.body.point.id}`, 'owner')).body.ok === true && (await call('DELETE', `/emotions/points/${add.body.point.id}`, 'owner')).status === 404);
  const sug = g.body.suggestions[0];
  t('рішення щодо пропозиції: читачу — 403, поганий статус — 400',
    (await call('POST', `/emotions/suggestions/${sug.id}/status`, 'reader', { status: 'confirmed' })).status === 403 &&
    (await call('POST', `/emotions/suggestions/${sug.id}/status`, 'owner', { status: 'maybe' })).status === 400);
  const ins = g.body.suggestions[1];
  t('«недостатньо даних» підтвердити не можна (422), відхилити — можна', (await call('POST', `/emotions/suggestions/${ins.id}/status`, 'owner', { status: 'confirmed' })).status === 422 && (await call('POST', `/emotions/suggestions/${ins.id}/status`, 'owner', { status: 'rejected' })).status === 200);
  const ok = await call('POST', `/emotions/suggestions/${sug.id}/status`, 'owner', { status: 'confirmed', intensity: 5, impact: 9 });
  t('ГОТОВО: підтвердити з уточненою силою й впливом — точка AI на кривій (майстерність і шар — від AI)', ok.status === 200 && ok.body.point.source === 'ai' && ok.body.point.intensity === 5 && ok.body.point.impact === 9 && ok.body.point.craft === 8 && ok.body.point.layer === 'secondary' && ok.body.point.findingId === sug.id && ok.body.finding.status === 'confirmed');
  const after = await call('GET', `/emotions?characters=${olena}`, 'owner');
  t('після підтвердження: пропозицій немає, точка ai у гл. 4', after.body.suggestions.length === 0 && after.body.totals.ai === 1 && after.body.series.find((s: any) => s.family === 'joy').values[3] === 5);
  t('повторне рішення — 409; чужий висновок — 404',
    (await call('POST', `/emotions/suggestions/${sug.id}/status`, 'owner', { status: 'rejected' })).status === 409 &&
    (await call('POST', `/emotions/suggestions/00000000-0000-4000-8000-000000000000/status`, 'owner', { status: 'rejected' })).status === 404);
  const an = await call('POST', '/emotions/analyze', 'owner', { characterId: olena });
  t('POST analyze: задача в черзі (202); не герой — 404; читачу — 403',
    an.status === 202 && !!an.body.jobId &&
    (await call('POST', '/emotions/analyze', 'owner', { characterId: fire })).status === 404 &&
    (await call('POST', '/emotions/analyze', 'reader', { characterId: olena })).status === 403);
  withQueue = false;
  t('без черги — 503', (await call('POST', '/emotions/analyze', 'owner', { characterId: olena })).status === 503);
  t('рядок висновку — вид emotion_point, прив\'язаний до героя', (await repo.getFinding(P, sug.id))?.kind === EMOTION_POINT && (await repo.getFinding(P, sug.id))?.entityId === olena);
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
