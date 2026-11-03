/**
 * Автоматичні теги за Jev: поріг 95%, ліміт 12 на абзац (постановка власника
 * 03.11.2026).
 *
 * ЧОМУ БЕЗ МЕРЕЖІ. Перевіряється саме ПРАВИЛО, а не провайдер: що відсівається
 * нижче порогу, що зайняті місця рахуються разом із тегами, які вже стоять у
 * абзаці, і що при нестачі місць лишаються найпевніші. Жива відповідь Jev для
 * цього не потрібна й зробила б тест залежним від ключа та від того, що саме
 * модель думає про конкретний абзац. Адаптер тут підставний і віддає рівно ті
 * числа, якими описано випадок.
 */

import {
  JEV_TAG_MAX_THRESHOLD,
  JEV_TAG_MIN_THRESHOLD,
  JEV_TAG_THRESHOLD,
  JevAnswerCache,
  jevAnswerKey,
  parseJevThreshold,
  JEV_MAX_QUESTIONS_PER_PARAGRAPH,
  decideParagraph,
  questionId,
  runJevTagging,
  tagQuestions,
  tagState,
  type JevTagCandidate,
  type JevTagParagraph,
} from '../server/core/ai/jevTags.ts';
import { MAX_ENTITIES_PER_PARAGRAPH } from '../src/utils/coreEntities.ts';
import type { JevAdapter, JevQuestion, JevRawAnswer } from '../server/ai/adapters/jev/index.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const cand = (n: number, slug = `type${n}`): JevTagCandidate => ({
  findingId: `f${n}`,
  paragraphId: 'p1',
  editorPid: 'pid-1',
  entitySlug: slug,
  entityName: `Сутність ${n}`,
  tag: `[/${slug}:]`,
});

const para = (candidates: JevTagCandidate[], text = 'Звичайний абзац без тегів.'): JevTagParagraph => ({
  paragraphId: 'p1',
  editorPid: 'pid-1',
  text,
  candidates,
});

/** Відповіді «за індексом кандидата» у тій формі, яку віддає провайдер. */
const answers = (probs: Array<number | null>): Record<string, unknown> =>
  Object.fromEntries(probs.map((p, i) => [questionId(i), p === null ? undefined : { type: 'noul', noul: p }]));

console.log('\nПоріг 95%:');
{
  const d = decideParagraph(para([cand(1), cand(2), cand(3)]), answers([0.96, 0.95, 0.94]));
  t('0,96 проходить', d.find((x) => x.findingId === 'f1')?.accepted === true);
  t('рівно 0,95 проходить («не менше»)', d.find((x) => x.findingId === 'f2')?.accepted === true);
  t('0,94 не проходить', d.find((x) => x.findingId === 'f3')?.accepted === false);
  t(
    'відмова названа причиною',
    d.find((x) => x.findingId === 'f3')?.reason === 'below_threshold',
    String(d.find((x) => x.findingId === 'f3')?.reason)
  );
  t('поріг саме 0,95', JEV_TAG_THRESHOLD === 0.95, String(JEV_TAG_THRESHOLD));

  /*
   * Межа насправді проходить по 0,9495, а не по 0,95: `noulProbability`
   * округлює відповідь до тисячних (ТЗ-H, адаптер Jev), тож 0,9499 стає
   * 0,950 і поріг долає. Це властивість нормалізації, а не вільність цього
   * модуля, і записано тут, щоб наступний не шукав помилку в порівнянні.
   */
  const edge = decideParagraph(para([cand(4), cand(5)]), answers([0.9499, 0.9494]));
  t('0,9499 округлюється до 0,95 і проходить', edge.find((x) => x.findingId === 'f4')?.accepted === true);
  t('0,9494 округлюється до 0,949 і не проходить', edge.find((x) => x.findingId === 'f5')?.accepted === false);
}

console.log('\nЛіміт на абзац:');
{
  const many = Array.from({ length: 15 }, (_, i) => cand(i + 1));
  const d = decideParagraph(para(many), answers(many.map(() => 0.99)));
  const yes = d.filter((x) => x.accepted);
  t(`прийнято рівно ${MAX_ENTITIES_PER_PARAGRAPH}`, yes.length === MAX_ENTITIES_PER_PARAGRAPH, String(yes.length));
  t('ліміт узято з реєстру, не з власного числа', MAX_ENTITIES_PER_PARAGRAPH === 12);
  t(
    'зайві відхилені як «абзац повний»',
    d.filter((x) => x.reason === 'paragraph_full').length === 3,
    String(d.filter((x) => x.reason === 'paragraph_full').length)
  );
}

console.log('\nМісця рахуються разом із наявними тегами:');
{
  const text = '[/character:Олена] [/location:Міст] Решта абзацу.';
  const many = Array.from({ length: 15 }, (_, i) => cand(i + 1));
  const d = decideParagraph(para(many, text), answers(many.map(() => 0.99)));
  t('додано лише 10 — два місця вже зайняті', d.filter((x) => x.accepted).length === 10, String(d.filter((x) => x.accepted).length));
}

console.log('\nПовтор тієї самої сутності:');
{
  const text = '[/character:Олена] Решта абзацу.';
  const d = decideParagraph(para([cand(1, 'character'), cand(2)], text), answers([0.99, 0.99]));
  t('тег, який уже стоїть, не дублюється', d.find((x) => x.findingId === 'f1')?.accepted === false);
  t('причина — повтор', d.find((x) => x.findingId === 'f1')?.reason === 'duplicate', String(d.find((x) => x.findingId === 'f1')?.reason));
  t('інша сутність проходить', d.find((x) => x.findingId === 'f2')?.accepted === true);
}

console.log('\nКоли місць менше, ніж кандидатів над порогом:');
{
  const many = Array.from({ length: 14 }, (_, i) => cand(i + 1));
  // Найпевніший — останній у списку: якби відбір ішов за порядком, він би не вліз.
  const probs = many.map((_, i) => (i === 13 ? 0.999 : 0.96));
  const d = decideParagraph(para(many), answers(probs));
  t('найпевніший кандидат прийнятий', d.find((x) => x.findingId === 'f14')?.accepted === true);
  t('прийнято рівно 12', d.filter((x) => x.accepted).length === 12);
}

console.log('\nВідповіді немає:');
{
  const d = decideParagraph(para([cand(1), cand(2)]), answers([null, 0.99]));
  t('без відповіді тег не ставиться', d.find((x) => x.findingId === 'f1')?.accepted === false);
  t('причина — немає відповіді', d.find((x) => x.findingId === 'f1')?.reason === 'no_answer');
  t('ймовірність null, а не 0', d.find((x) => x.findingId === 'f1')?.probability === null);
}

console.log('\nБільше кандидатів, ніж влазить в один запит:');
{
  const many = Array.from({ length: JEV_MAX_QUESTIONS_PER_PARAGRAPH + 3 }, (_, i) => cand(i + 1));
  const qs = tagQuestions(many);
  t(`питань не більше ${JEV_MAX_QUESTIONS_PER_PARAGRAPH}`, qs.length === JEV_MAX_QUESTIONS_PER_PARAGRAPH, String(qs.length));
  t('усі питання — noul', qs.every((q) => q.kind === 'noul'));
  t('питання називає сутність', qs[0].instructions.includes('Сутність 1'));
  t('питання обмежує модель цим абзацом', qs[0].instructions.includes('не про розділ'));
  const d = decideParagraph(para(many), answers(many.map(() => 0.99)));
  const notAsked = d.filter((x) => x.reason === 'not_asked');
  t('неспитані не зникають, а названі', notAsked.length === 3, String(notAsked.length));
  t('рішень рівно стільки, скільки кандидатів', d.length === many.length, String(d.length));
}

console.log('\nСтан для Jev:');
{
  const s = tagState(para([cand(1)], 'Текст абзацу.'));
  t('у стані лише абзац', JSON.stringify(s) === JSON.stringify({ paragraph: 'Текст абзацу.' }), JSON.stringify(s));
}

console.log('\nПрогін по абзацах:');
{
  const asked: Array<{ state: Record<string, unknown>; questions: JevQuestion[] }> = [];
  const adapter: JevAdapter = {
    name: 'mock',
    evaluate: async () => {
      throw new Error('не потрібне');
    },
    askState: async (state, questions): Promise<JevRawAnswer> => {
      asked.push({ state, questions });
      if (String(state.paragraph).includes('падає')) throw new Error('429 Too Many Requests');
      return {
        answers: Object.fromEntries(questions.map((q, i) => [q.id, { type: 'noul', noul: i === 0 ? 0.97 : 0.5 }])),
        model: 'jev-1.13.0',
        usage: { input_tokens: 100, output_tokens: 0 },
        latency_ms: 1,
      };
    },
  };
  const ps: JevTagParagraph[] = [
    { paragraphId: 'a', editorPid: 'pa', text: 'Перший абзац.', candidates: [{ ...cand(1), paragraphId: 'a' }, { ...cand(2), paragraphId: 'a' }] },
    { paragraphId: 'b', editorPid: 'pb', text: 'Абзац, на якому падає.', candidates: [{ ...cand(3), paragraphId: 'b' }] },
    { paragraphId: 'c', editorPid: 'pc', text: 'Третій абзац.', candidates: [] },
  ];
  const r = await runJevTagging(ps, adapter);
  t('запит на кожен абзац із кандидатами', asked.length === 2, String(asked.length));
  t('абзац без кандидатів не питається', !asked.some((a) => String(a.state.paragraph).includes('Третій')));
  t('прийнято один тег', r.decisions.filter((x) => x.accepted).length === 1, String(r.decisions.filter((x) => x.accepted).length));
  t('збій одного абзаца не валить прогін', r.failures.length === 1 && r.failures[0].paragraphId === 'b');
  t('збій названий, а не прихований', r.failures[0].error.includes('429'));
  // Абзац, на якому Jev упав, у лічильники не потрапляє: платимо за запити,
  // що відбулися, а не за ті, які мали відбутися.
  t('полічено лише питання, на які відповіли', r.asked === 2, String(r.asked));
  t('токени — лише за успішний запит', r.inputTokens === 100, String(r.inputTokens));
}

console.log('\nТолерантність 70–100% (постановка власника 03.11.2026):');
{
  t('межі: 0,70 і 1,00', JEV_TAG_MIN_THRESHOLD === 0.7 && JEV_TAG_MAX_THRESHOLD === 1);
  const ok = (v: unknown) => { const r = parseJevThreshold(v); return 'value' in r ? r.value : null; };
  t('без значення — типові 95%', ok(undefined) === 0.95 && ok(null) === 0.95);
  t('0,70 і 1,00 приймаються', ok(0.7) === 0.7 && ok(1) === 1);
  t('0,90 приймається як є', ok(0.9) === 0.9);
  t('0,69 відхиляється, а не підтискається до 0,70', ok(0.69) === null);
  t('1,01 відхиляється', ok(1.01) === null);
  t('рядок і NaN відхиляються', ok('0.9') === null && ok(Number.NaN) === null);
  const bad = parseJevThreshold(0.4);
  t('відмова називає межі', 'error' in bad && bad.error.includes('70%') && bad.error.includes('100%'));

  const probs = [0.99, 0.9, 0.82, 0.71, 0.69];
  const cs = probs.map((_, i) => cand(i + 1, `tp${i + 1}`));
  const at = (th: number) => decideParagraph(para(cs), answers(probs), { threshold: th }).filter((x) => x.accepted).length;
  t('за 95% — один тег', at(0.95) === 1);
  t('за 90% — два (0,90 «не менше»)', at(0.9) === 2);
  t('за 80% — три', at(0.8) === 3);
  t('за 70% — чотири; 0,69 лишається за порогом', at(0.7) === 4);
  const d70 = decideParagraph(para(cs), answers(probs), { threshold: 0.7 });
  t('0,69 при 70% — below_threshold', d70.find((x) => x.findingId === 'f5')?.reason === 'below_threshold');

  // Ліміт 12 діє на будь-якому порозі: нижчий поріг не відкриває тринадцятий тег.
  const many = Array.from({ length: 15 }, (_, i) => cand(i + 1, `lim${i + 1}`));
  const low = decideParagraph(para(many), answers(many.map((_, i) => 0.99 - i * 0.01)), { threshold: 0.7 });
  t('за 70% усе одно не більше 12 тегів на абзац', low.filter((x) => x.accepted).length === MAX_ENTITIES_PER_PARAGRAPH);
  t('вище за межу — paragraph_full', low.filter((x) => x.reason === 'paragraph_full').length === 3);
}

console.log('\nПам’ять відповідей: повтор із нижчим порогом без нових звернень:');
{
  const calls: Array<{ ids: string[] }> = [];
  const probsByEntity: Record<string, number> = { 'Сутність 1': 0.97, 'Сутність 2': 0.88, 'Сутність 3': 0.74 };
  const adapter: JevAdapter = {
    name: 'mock',
    evaluate: async () => { throw new Error('не потрібне'); },
    askState: async (state, questions): Promise<JevRawAnswer> => {
      calls.push({ ids: questions.map((q) => q.id) });
      return {
        answers: Object.fromEntries(questions.map((q) => {
          const name = String(q.instructions).match(/«([^»]+)»/)?.[1] ?? '';
          return [q.id, { type: 'noul', noul: probsByEntity[name] ?? 0.1 }];
        })),
        model: 'jev-1.13.0',
        usage: { input_tokens: 500, output_tokens: 0 },
        latency_ms: 1,
      };
    },
  };
  const ps = [para([cand(1), cand(2), cand(3)])];
  const cache = new JevAnswerCache();
  const first = await runJevTagging(ps, adapter, { threshold: 0.95, cache, scope: 'B1' });
  t('перший прогін: 3 питання до Jev, 1 тег', first.asked === 3 && first.fromCache === 0 && first.decisions.filter((x) => x.accepted).length === 1, `${first.asked}/${first.fromCache}`);
  const callsAfterFirst = calls.length;
  const second = await runJevTagging(ps, adapter, { threshold: 0.8, cache, scope: 'B1' });
  t('повтор за 80%: жодного нового звернення до Jev', calls.length === callsAfterFirst && second.asked === 0 && second.inputTokens === 0, String(calls.length));
  t('усі 3 відповіді з пам’яті', second.fromCache === 3);
  t('за нижчого порогу тегів стало більше (2)', second.decisions.filter((x) => x.accepted).length === 2);
  const third = await runJevTagging(ps, adapter, { threshold: 0.7, cache, scope: 'B1' });
  t('повтор за 70%: три теги, знову без звернень', third.decisions.filter((x) => x.accepted).length === 3 && calls.length === callsAfterFirst);

  // Новий кандидат у тому ж абзаці — питається лише він, а позиційні id лишаються.
  const withNew = [para([cand(1), cand(2), cand(3), cand(4)])];
  const fourth = await runJevTagging(withNew, adapter, { threshold: 0.7, cache, scope: 'B1' });
  const last = calls[calls.length - 1];
  t('новий кандидат: до Jev іде одне питання', fourth.asked === 1 && last.ids.length === 1 && last.ids[0] === questionId(3), JSON.stringify(last.ids));
  t('решта три — з пам’яті', fourth.fromCache === 3);

  // Правка тексту абзацу обнуляє пам’ять: стара відповідь не лягає на новий текст.
  const edited = [para([cand(1), cand(2), cand(3)], 'Абзац переписано.')];
  const afterEdit = await runJevTagging(edited, adapter, { threshold: 0.7, cache, scope: 'B1' });
  t('змінений текст — знову питаємо Jev', afterEdit.asked === 3 && afterEdit.fromCache === 0);
  t('інший проєкт — інша пам’ять', (await runJevTagging(ps, adapter, { threshold: 0.7, cache, scope: 'B2' })).asked === 3);
  t('ключ залежить від тексту', jevAnswerKey('B1', ps[0], cand(1)) !== jevAnswerKey('B1', edited[0], cand(1)));

  // Збій не кладе нічого в пам’ять.
  const failing: JevAdapter = { name: 'mock', evaluate: async () => ({}) as never, askState: async () => { throw new Error('429'); } };
  const c2 = new JevAnswerCache();
  const failed = await runJevTagging(ps, failing, { cache: c2, scope: 'B1' });
  t('збій: у пам’ять нічого не потрапило', failed.failures.length === 1 && c2.size === 0);
  const small = new JevAnswerCache(2);
  small.set('a', 0.9); small.set('b', 0.9); small.set('c', 0.9);
  t('пам’ять обмежена: найстаріше витісняється', small.size === 2 && small.get('a') === undefined && small.get('c') === 0.9);
}

console.log('\nАдаптер без askState:');
{
  const adapter = { name: 'mock', evaluate: async () => ({}) } as unknown as JevAdapter;
  let msg = '';
  await runJevTagging([para([cand(1)])], adapter).catch((e) => {
    msg = (e as Error).message;
  });
  t('відмова зрозуміла, а не TypeError', msg.includes('askState'), msg);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
