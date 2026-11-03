/**
 * Автоматичні теги рівня типу з нумерацією екземплярів і повне сканування
 * книги моделлю Jev (постановка власника 03.11.2026).
 *
 * ЧОМУ ФАЛЬШИВИЙ АДАПТЕР ВІДПОВІДАЄ ЗА ЗМІСТОМ ПИТАННЯ. Якби він віддавав
 * однакове число на все, тест не відрізнив би «відповіді дійшли до своїх типів»
 * від «відповіді переплутані між типами»: а саме в розкладанні відповідей назад
 * по типах після поділу на пачки по 24 і міг би сидіти збій. Тут адаптер читає
 * з тексту питання тип і дає ймовірність саме цьому типу.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JevError, type JevAdapter, type JevQuestion, type JevRawAnswer } from '../server/ai/adapters/jev/index.ts';
import {
  PARAGRAPH_SLUG,
  STRUCTURAL_SLUGS,
  applyAutoTags,
  instanceCounters,
  listBookParagraphs,
  removeAutoTags,
  scanEntityTypes,
} from '../src/utils/autoTags.ts';
import { buildTagCarrier, splitParagraphs, type CarrierBook } from '../src/utils/tagCarrier.ts';
import {
  CORE_ENTITIES,
  MAX_ENTITIES_PER_PARAGRAPH,
  buildEntityTag,
  entityBySlug,
  entityValueTooltip,
  parseEntityValue,
  stripEntityTags,
} from '../src/utils/coreEntities.ts';
import { entityNameFromTag } from '../server/core/sync.ts';
import { JsonlScanCache, runJevFullScan, type ScanParagraph } from '../server/core/ai/jevFullScan.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const mkBook = (...sections: string[][]): CarrierBook => ({
  id: 'b1',
  title: 'Проба',
  chapters: sections.map((paras, i) => ({
    id: `c${i}`,
    title: `Глава ${i + 1}`,
    sections: [{ id: `s${i}`, title: `Розділ ${i + 1}`, content: paras.join('\n\n') }],
  })),
});
const contents = (b: CarrierBook) => (b.chapters ?? []).flatMap((c) => (c.sections ?? []).map((s) => s.content));

// ── Номер екземпляра в значенні тега ───────────────────────────────────────

console.log('\nНомер екземпляра в значенні:');
{
  const p = (v: string) => parseEntityValue('emotion', v);
  t('«#17» — екземпляр 17, назви немає', p('#17').instance === 17 && p('#17').text === '');
  t('«страх #17» — назва «страх», екземпляр 17', p('страх #17').instance === 17 && p('страх #17').text === 'страх');
  t('«страх @Олена #17» — і чиє, і номер', p('страх @Олена #17').subject === 'Олена' && p('страх @Олена #17').instance === 17 && p('страх @Олена #17').text === 'страх');
  t('значення без номера — як і раніше, без поля instance', p('страх').instance === undefined && !('instance' in p('страх')));
  t('«страх#17» без пропуску — не номер', p('страх#17').instance === undefined && p('страх#17').text === 'страх#17');
  t('«#abc» — не номер', p('#abc').instance === undefined);
  t('«№17» — не номер (це звичайна назва)', p('№17').instance === undefined);
  t('«# 17» з пропуском після решітки — не номер', p('# 17').instance === undefined);
  t('вісім цифр — не номер (межа 7)', p('#12345678').instance === undefined);
  t('семи цифр досить', p('#1234567').instance === 1234567);
  t('номер лише на кінці: «a #1 b» — не номер', p('a #1 b').instance === undefined);
  t('підказка називає екземпляр', entityValueTooltip(entityBySlug('emotion')!, '#17').includes('#17'));
  // Свідома зміна, названа в коді: значення «Будинок #5» тепер — назва «Будинок» й екземпляр 5.
  t('«Будинок #5» читається як назва «Будинок», екземпляр 5 (відома ціна)', p('Будинок #5').text === 'Будинок' && p('Будинок #5').instance === 5);
}

console.log('\nЯдро не створює сутність «#17»:');
{
  const emotion = entityBySlug('emotion')!;
  t('тег рівня типу з номером — ім\'я порожнє, синк його пропустить', entityNameFromTag(emotion, '#17').name === '');
  t('іменований з номером — ім\'я без номера', entityNameFromTag(emotion, 'страх #17').name === 'страх');
  t('те саме для героя з приміткою', entityNameFromTag(entityBySlug('character')!, 'Олена #3').name !== '#3');
}

// ── Типи, які скануються ───────────────────────────────────────────────────

console.log('\nТипи для сканування:');
{
  const types = scanEntityTypes();
  t('усього 118, структурних 8, до сканування 110', CORE_ENTITIES.length === 118 && STRUCTURAL_SLUGS.length === 8 && types.length === 110, String(types.length));
  t('жодного структурного серед скануємих', !types.some((x) => STRUCTURAL_SLUGS.includes(x.slug)));
  t('емоція скануємо, абзац — ні', types.some((x) => x.slug === 'emotion') && !types.some((x) => x.slug === PARAGRAPH_SLUG));
  t('усі структурні типи справді є в реєстрі', STRUCTURAL_SLUGS.every((s) => !!entityBySlug(s)));
}

// ── Абзаци книги ───────────────────────────────────────────────────────────

console.log('\nАбзаци книги:');
{
  const book = mkBook(['Перший абзац.', '***', 'Другий абзац.', '[IMG: img-1 "підпис"]'], ['Третій абзац.']);
  const ps = listBookParagraphs(book);
  t('нумеруються лише текстові: 3 з 5', ps.length === 3, String(ps.length));
  t('номери з 1 по порядку книги', ps.map((p) => p.n).join() === '1,2,3');
  t('розділювач і маркер ілюстрації пропущені', !ps.some((p) => p.text === '***' || p.text.startsWith('[IMG')));
  t('місце абзацу збережене', ps[1].chapterIdx === 0 && ps[1].paraIdx === 2 && ps[2].chapterIdx === 1);
  t('назви глави й розділу', ps[2].chapterTitle === 'Глава 2' && ps[2].sectionTitle === 'Розділ 2');
}

// ── Застосування тегів із нумерацією ───────────────────────────────────────

console.log('\nНумерація тегів:');
{
  const book = mkBook(['Олена злякалась на мосту.', 'Тиха ніч над містом.'], ['Вони говорили про страх.']);
  const picks = [
    { n: 1, slugs: ['emotion', 'location'] },
    { n: 2, slugs: ['location'] },
    { n: 3, slugs: ['emotion'] },
  ];
  const r = applyAutoTags(book, picks);
  const c = contents(r.book);
  t('перший абзац: типи за порядком picks, тег абзацу ОСТАННІЙ',
    c[0].startsWith('[/emotion:#1] [/location:#1] [/paragraph:#1] Олена злякалась'), c[0].slice(0, 70));
  const blocks0 = c[0]!.split('\n\n');
  t('лічильник свій для кожного типу: location #1 у першому абзаці, #2 у другому', blocks0[0].includes('[/location:#1]') && !blocks0[0].includes('[/location:#2]') && blocks0[1].startsWith('[/location:#2]'));
  t('emotion у третьому абзаці — #2, а не #3', c[1].startsWith('[/emotion:#2] [/paragraph:#3] Вони'), c[1].slice(0, 50));
  t('тег абзацу — порядковий номер абзацу в книзі', r.counters[PARAGRAPH_SLUG] === 3 && c[0].includes('[/paragraph:#1]') && c[0].split('\n\n')[1].includes('[/paragraph:#2]'));
  t('поставлено п\'ять змістових тегів', r.tagsPlaced === 4, String(r.tagsPlaced));
  t('за типами', r.byType.emotion === 2 && r.byType.location === 2, JSON.stringify(r.byType));
  t('абзаців із теґами змісту 3, з номером 3', r.paragraphsTagged === 3 && r.paragraphsNumbered === 3);
  t('вхідну книгу не змінено', contents(book)[0] === 'Олена злякалась на мосту.\n\nТиха ніч над містом.');
}

console.log('\nНомер не переномеровується, тільки росте:');
{
  const book = mkBook(['Олена злякалась.', 'Тиха ніч.', 'Світанок.']);
  const first = applyAutoTags(book, [{ n: 1, slugs: ['emotion'] }, { n: 2, slugs: ['emotion'] }, { n: 3, slugs: ['emotion'] }]);
  t('три емоції — #1, #2, #3', JSON.stringify([...contents(first.book)[0].matchAll(/\[\/emotion:#(\d+)\]/g)].map((m) => m[1])) === '["1","2","3"]');

  // Автор видалив другий абзац (емоція #2) і дописав новий наприкінці.
  const edited = structuredClone(first.book);
  const blocks = splitParagraphs(edited.chapters![0].sections![0].content);
  blocks.splice(1, 1);
  blocks.push('Новий абзац наприкінці.');
  edited.chapters![0].sections![0].content = blocks.join('\n\n');
  t('лічильник пам\'ятає найбільший наявний номер', instanceCounters(edited).get('emotion') === 3);

  const ps = listBookParagraphs(edited);
  const second = applyAutoTags(edited, [{ n: ps[ps.length - 1].n, slugs: ['emotion'] }]);
  const last = splitParagraphs(second.book.chapters![0].sections![0].content).pop()!;
  t('новий тег — #4, а не #2, що звільнився', last.startsWith('[/emotion:#4]'), last.slice(0, 40));
  t('старі номери не зачеплено', splitParagraphs(second.book.chapters![0].sections![0].content)[0].includes('[/emotion:#1]'));
  t('новий тег абзацу — #4, а не 3', last.includes('[/paragraph:#4]'), last);
}

console.log('\nПовторний прогін нічого не додає:');
{
  const book = mkBook(['Олена злякалась.', 'Тиха ніч.']);
  const picks = [{ n: 1, slugs: ['emotion'] }, { n: 2, slugs: ['location'] }];
  const once = applyAutoTags(book, picks);
  const twice = applyAutoTags(once.book, picks);
  t('другий прохід: 0 тегів і 0 номерів абзаців', twice.tagsPlaced === 0 && twice.paragraphsNumbered === 0, `${twice.tagsPlaced}/${twice.paragraphsNumbered}`);
  t('текст не змінився', JSON.stringify(contents(twice.book)) === JSON.stringify(contents(once.book)));
}

console.log('\nЛіміт 12 на абзац:');
{
  const slugs = scanEntityTypes().slice(0, 20).map((x) => x.slug);
  const book = mkBook(['Абзац, який Jev вважає схожим на все.']);
  const r = applyAutoTags(book, [{ n: 1, slugs }]);
  const tags = (contents(r.book)[0].match(/\[\/[a-z-]+:#\d+\]/g) || []) as string[];
  t(`разом не більше ${MAX_ENTITIES_PER_PARAGRAPH}`, tags.length === MAX_ENTITIES_PER_PARAGRAPH, String(tags.length));
  t('серед них тег абзацу: місце під нього зарезервоване', tags.some((x) => x.startsWith('[/paragraph:')));
  t('змістових одинадцять', r.tagsPlaced === MAX_ENTITIES_PER_PARAGRAPH - 1, String(r.tagsPlaced));
  t('решта полічена як відкинута лімітом', r.skippedByLimit === 20 - (MAX_ENTITIES_PER_PARAGRAPH - 1), String(r.skippedByLimit));
  t('перші за порядком picks уцілили', tags[0].startsWith(`[/${slugs[0]}:`));

  const noNumber = applyAutoTags(book, [{ n: 1, slugs }], { numberParagraphs: false });
  const tags2 = (contents(noNumber.book)[0].match(/\[\/[a-z-]+:#\d+\]/g) || []) as string[];
  t('без нумерації абзаців — усі дванадцять змістові', tags2.length === MAX_ENTITIES_PER_PARAGRAPH && !tags2.some((x) => x.startsWith('[/paragraph:')));
}

console.log('\nТеги, що вже стоять:');
{
  const book = mkBook(['[/character:Олена] [/emotion:страх] Олена злякалась.']);
  const r = applyAutoTags(book, [{ n: 1, slugs: ['emotion', 'location'] }]);
  const c = contents(r.book)[0];
  t('наявні теги лишаються першими', c.startsWith('[/character:Олена] [/emotion:страх] '), c.slice(0, 60));
  t('тип, що вже є (emotion), не дублюється', (c.match(/\[\/emotion:/g) || []).length === 1);
  t('новий (location) іде після наявних', c.indexOf('[/location:#1]') > c.indexOf('[/emotion:страх]'));
  t('тег абзацу — останній', c.indexOf('[/paragraph:#1]') > c.indexOf('[/location:#1]'));

  const withPara = applyAutoTags(mkBook(['[/paragraph:#7] Абзац.']), [{ n: 1, slugs: ['emotion'] }]);
  t('вже пронумерований абзац другого номера не дістає', (contents(withPara.book)[0].match(/\[\/paragraph:/g) || []).length === 1);
  t('а лічильник продовжується з найбільшого', applyAutoTags(mkBook(['[/paragraph:#7] Перший.', 'Другий.']), []).counters[PARAGRAPH_SLUG] === 8);
  t('picks із типом paragraph ігноруються', !/\[\/paragraph:#\d+\].*\[\/paragraph:#\d+\]/.test(applyAutoTags(mkBook(['Абзац.']), [{ n: 1, slugs: ['paragraph'] }]).book.chapters![0].sections![0].content!));
}

console.log('\nНезачеплені розділи лишаються байт у байт:');
{
  const book = mkBook(['Один.', 'Два.'], ['Три  з   подвійними пропусками.\n\n\n\nЧотири після порожніх рядків.']);
  // Без нумерації абзаців: інакше тег абзацу лягає й на другий розділ, і «без змін» там неправда.
  const r = applyAutoTags(book, [{ n: 1, slugs: ['emotion'] }], { numberParagraphs: false });
  t('другий розділ без тегів не переписано', contents(r.book)[1] === contents(book)[1]);
  t('а перший переписано', contents(r.book)[0] !== contents(book)[0]);
  const numbered = applyAutoTags(book, [{ n: 1, slugs: ['emotion'] }]);
  t('з нумерацією абзаців другий розділ теж дістає теги (так і задумано)', numbered.book.chapters![1].sections![0].content!.includes('[/paragraph:#3]'));
}

console.log('\nСкасування всього прогону:');
{
  const book = mkBook(['Олена злякалась.', 'Тиха ніч.', 'Світанок.']);
  const picks = [{ n: 1, slugs: ['emotion', 'location'] }, { n: 2, slugs: ['emotion'] }];
  const applied = applyAutoTags(book, picks);
  const removed = removeAutoTags(applied.book);
  t('прибрано всі автоматичні теги', removed.removed === applied.tagsPlaced + applied.paragraphsNumbered, String(removed.removed));
  t('книга збігається з початковою байт у байт', JSON.stringify(contents(removed.book)) === JSON.stringify(contents(book)));

  const mixed = mkBook(['[/emotion:страх] [/character:Олена @Марко #3] [/emotion:#9] Абзац.']);
  const r2 = removeAutoTags(mixed);
  t('іменований тег з номером НЕ прибирається', r2.book.chapters![0].sections![0].content!.includes('[/character:Олена @Марко #3]'));
  t('іменований тег без номера не прибирається', r2.book.chapters![0].sections![0].content!.includes('[/emotion:страх]'));
  t('прибирається лише тег рівня типу з номером', r2.removed === 1, String(r2.removed));

  const only = removeAutoTags(applied.book, { slugs: ['emotion'] });
  t('можна прибрати лише один тип', !only.book.chapters![0].sections![0].content!.includes('[/emotion:#') && only.book.chapters![0].sections![0].content!.includes('[/location:#1]'));
}

console.log('\nАвторський текст зберігається дослівно:');
{
  const book = mkBook(['  Абзац з відступом.', '[/character:Олена] Абзац після тегу.', '\tАбзац з табуляцією.']);
  const picks = [1, 2, 3].map((n) => ({ n, slugs: ['emotion'] }));
  const applied = applyAutoTags(book, picks);
  const blocks = splitParagraphs(applied.book.chapters![0].sections![0].content);
  t('початкові пропуски абзацу лишились після тегів', blocks[0].endsWith('  Абзац з відступом.'), JSON.stringify(blocks[0]));
  t('табуляція лишилась', blocks[2].endsWith('\tАбзац з табуляцією.'), JSON.stringify(blocks[2]));
  t('абзац із тегом: рівно один пропуск між тегами й текстом', blocks[1] === '[/character:Олена] [/emotion:#2] [/paragraph:#2] Абзац після тегу.', JSON.stringify(blocks[1]));
  const removed = removeAutoTags(applied.book);
  t('поставити → зняти повертає абзаци байт у байт, включно з пропусками', JSON.stringify(contents(removed.book)) === JSON.stringify(contents(book)));
  // Те, що перевірка на справжній книзі виявила на 54 абзацах: зняти ЛИШЕ початкові теги.
  const bareOf = (b: string) => b.replace(/^(?:\s*\[\/[a-z0-9-]+:#\d+\])+ /, '');
  t('після зняття початкових тегів текст збігається з оригіналом (абзаци без авторських тегів)', bareOf(blocks[0]) === '  Абзац з відступом.' && bareOf(blocks[2]) === '\tАбзац з табуляцією.', JSON.stringify([bareOf(blocks[0]), bareOf(blocks[2])]));
}

console.log('\nТеги не потрапляють в експорт і несуться носієм:');
{
  const applied = applyAutoTags(mkBook(['Олена злякалась на мосту.']), [{ n: 1, slugs: ['emotion', 'location'] }]);
  t('експорт знімає числові теги', stripEntityTags(contents(applied.book)[0]!).trim() === 'Олена злякалась на мосту.', stripEntityTags(contents(applied.book)[0]!));
  const carrier = buildTagCarrier(applied.book);
  const tags = carrier.chapters[0].sections[0].paragraphs[0].tags;
  t('носій несе теги з номерами', tags.map((x) => `${x.slug}:${x.value}`).join() === 'emotion:#1,location:#1,paragraph:#1', tags.map((x) => `${x.slug}:${x.value}`).join());
}

// ── Повне сканування ───────────────────────────────────────────────────────

/** Фальшивий Jev: читає тип із тексту питання й відповідає саме для нього. */
function fakeJev(prob: (slug: string, paragraph: string) => number | null, hooks: { onCall?: (n: number) => void; fail?: (call: number) => Error | null } = {}) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const questionCounts: number[] = [];
  const adapter: JevAdapter = {
    name: 'mock',
    evaluate: async () => {
      throw new Error('не потрібне');
    },
    askState: async (state, questions: JevQuestion[]): Promise<JevRawAnswer> => {
      calls += 1;
      const mine = calls;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      questionCounts.push(questions.length);
      hooks.onCall?.(mine);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      const failure = hooks.fail?.(mine);
      if (failure) throw failure;
      const answers: Record<string, unknown> = {};
      for (const q of questions) {
        const slug = /\(тип «([a-z0-9-]+)»\)/.exec(q.instructions)?.[1];
        if (!slug) continue;
        const p = prob(slug, String(state.paragraph));
        if (p !== null) answers[q.id] = { type: 'noul', noul: p };
      }
      return { answers, model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 0 }, latency_ms: 1 };
    },
  };
  return { adapter, stats: () => ({ calls, maxInFlight, questionCounts }) };
}

const types = scanEntityTypes().map((x) => ({ slug: x.slug, nameUk: x.nameUk }));
const para = (id: string, text: string): ScanParagraph => ({ id, text, key: `k-${id}` });

console.log('\nСканування: пачки по 24 і розкладання відповідей по типах:');
{
  const want = new Set(['emotion', 'location', 'goal', 'theme', 'diction', 'pacing']); // розкидані по всіх пачках
  const jev = fakeJev((slug) => (want.has(slug) ? 0.99 : 0.1));
  const r = await runJevFullScan([para('p1', 'Абзац.')], types, jev.adapter, { backoffMs: 0 });
  const s = jev.stats();
  t('110 типів — п\'ять запитів', s.calls === 5, String(s.calls));
  t('пачки 24+24+24+24+14', JSON.stringify(s.questionCounts) === JSON.stringify([24, 24, 24, 24, 14]), JSON.stringify(s.questionCounts));
  t('кожному типу дісталась ЙОГО відповідь, а не сусідня', JSON.stringify([...r.accepted.get('p1')!].sort()) === JSON.stringify([...want].sort()), JSON.stringify(r.accepted.get('p1')));
  t('статистика: запити й токени полічені', r.stats.requests === 5 && r.stats.inputTokens === 500);
  t('жодного збою', r.stats.failed.length === 0);
}

console.log('\nСканування: поріг і порядок за певністю:');
{
  const probs: Record<string, number> = { emotion: 0.96, location: 0.95, goal: 0.949, theme: 0.99 };
  const jev = fakeJev((slug) => probs[slug] ?? 0.2);
  const r = await runJevFullScan([para('p1', 'Абзац.')], types, jev.adapter, { backoffMs: 0 });
  t('0,95 проходить, 0,949 ні', JSON.stringify(r.accepted.get('p1')) === JSON.stringify(['theme', 'emotion', 'location']), JSON.stringify(r.accepted.get('p1')));
  t('порядок — за спаданням певності', r.accepted.get('p1')![0] === 'theme');
  const d = r.decisions.get('p1')!.find((x) => x.entitySlug === 'goal')!;
  t('відмову названо', d.accepted === false && d.reason === 'below_threshold');
}

console.log('\nСканування: ліміт 12 лишає найпевніші:');
{
  const slugs = types.slice(0, 20).map((x) => x.slug);
  const jev = fakeJev((slug) => (slugs.includes(slug) ? 0.96 + slugs.indexOf(slug) * 0.001 : 0));
  const r = await runJevFullScan([para('p1', 'Абзац.')], types, jev.adapter, { backoffMs: 0 });
  const acc = r.accepted.get('p1')!;
  t(`прийнято рівно ${MAX_ENTITIES_PER_PARAGRAPH}`, acc.length === MAX_ENTITIES_PER_PARAGRAPH, String(acc.length));
  t('це двадцята.. дев\'ята за певністю (найвищі)', acc[0] === slugs[19] && acc[11] === slugs[8], `${acc[0]} … ${acc[11]}`);
}

console.log('\nСканування: повтори при 429 і відмова при 401:');
{
  let failed = 0;
  const retrying = fakeJev(() => 0.99, {
    fail: (call) => (call <= 2 ? (failed++, new JevError('Jev 429: забагато', 429, true)) : null),
  });
  const r = await runJevFullScan([para('p1', 'Абзац.')], types.slice(0, 24), retrying.adapter, { backoffMs: 0 });
  t('після двох 429 відповідь отримано', r.accepted.get('p1')!.length === Math.min(12, 24) && r.stats.failed.length === 0);
  t('повторів два', r.stats.retries === 2 && failed === 2, String(r.stats.retries));
  t('запитів три', r.stats.requests === 3, String(r.stats.requests));

  const hard = fakeJev(() => 0.99, { fail: () => new JevError('Jev 401: ключ недійсний', 401, false) });
  const cache = new JsonlScanCache();
  const r2 = await runJevFullScan([para('p1', 'Абзац.')], types.slice(0, 24), hard.adapter, { backoffMs: 0, cache });
  t('401 не повторюється', hard.stats().calls === 1, String(hard.stats().calls));
  t('абзац названо серед невдалих', r2.stats.failed.length === 1 && r2.stats.failed[0].id === 'p1' && r2.stats.failed[0].error.includes('401'));
  t('тегів з нього нема', r2.accepted.get('p1')!.length === 0);
  t('невдалий абзац у кеш НЕ потрапив', cache.size === 0);

  const exhausted = fakeJev(() => 0.99, { fail: () => new JevError('Jev 529: перевантажено', 529, true) });
  const r3 = await runJevFullScan([para('p1', 'Абзац.')], types.slice(0, 24), exhausted.adapter, { backoffMs: 0, attempts: 3 });
  t('спроби вичерпано — рівно задана кількість', exhausted.stats().calls === 3 && r3.stats.failed.length === 1, String(exhausted.stats().calls));
}

console.log('\nСканування: збій однієї пачки з п\'яти:');
{
  const jev = fakeJev(() => 0.99, { fail: (call) => (call === 3 ? new JevError('Jev 422: некоректне питання', 422, false) : null) });
  const cache = new JsonlScanCache();
  const r = await runJevFullScan([para('p1', 'Абзац.')], types, jev.adapter, { backoffMs: 0, cache });
  t('абзац позначено як невдалий', r.stats.failed.length === 1);
  t('у кеш не потрапив: інакше «не відповіли» осіло б як «ні»', cache.size === 0);
  t('типи з пачок, що вдались, усе ж отримали рішення', r.decisions.get('p1')!.some((x) => x.probability !== null));
  t('а типи невдалої пачки — без імовірності, не нуль', r.decisions.get('p1')!.filter((x) => x.probability === null).length === 24);
}

console.log('\nСканування: кеш:');
{
  const jev = fakeJev((slug) => (slug === 'emotion' ? 0.99 : 0));
  const cache = new JsonlScanCache();
  const first = await runJevFullScan([para('a', 'Один.'), para('b', 'Два.')], types, jev.adapter, { backoffMs: 0, cache });
  const callsAfterFirst = jev.stats().calls;
  t('перший прогін: 2 абзаци × 5 запитів', callsAfterFirst === 10, String(callsAfterFirst));
  const second = await runJevFullScan([para('a', 'Один.'), para('b', 'Два.')], types, jev.adapter, { backoffMs: 0, cache });
  t('другий прогін не робить жодного запиту', jev.stats().calls === callsAfterFirst);
  t('обидва з кешу', second.stats.fromCache === 2);
  t('результат той самий', JSON.stringify([...second.accepted]) === JSON.stringify([...first.accepted]));

  const same = new JsonlScanCache();
  const twins = fakeJev(() => 0.5);
  const rt = await runJevFullScan([{ id: 'x1', text: 'Так.', key: 'same' }, { id: 'x2', text: 'Так.', key: 'same' }], types, twins.adapter, { backoffMs: 0, cache: same, concurrency: 1 });
  t('однакові абзаци (однаковий ключ) оплачуються один раз', twins.stats().calls === 5 && rt.stats.fromCache === 1, `${twins.stats().calls}/${rt.stats.fromCache}`);
}

console.log('\nСканування: файл кешу переживає збій:');
{
  const file = path.join(os.tmpdir(), `jev-scan-cache-${process.pid}.jsonl`);
  fs.rmSync(file, { force: true });
  const a = new JsonlScanCache(file);
  a.set('k1', { emotion: 0.99, location: 0.1 });
  a.set('k2', { emotion: 0.2, location: 0.97 });
  fs.appendFileSync(file, '{"k":"k3","p":{"emot'); // обірваний останній рядок після збою
  const b = new JsonlScanCache(file);
  t('записане читається в новому екземплярі', b.get('k1')?.emotion === 0.99 && b.get('k2')?.location === 0.97);
  t('обірваний останній рядок пропущено', b.get('k3') === undefined && b.size === 2, String(b.size));
  fs.rmSync(file, { force: true });
}

console.log('\nСканування: одночасність:');
{
  const jev = fakeJev(() => 0);
  const many = Array.from({ length: 12 }, (_, i) => para(`p${i}`, `Абзац ${i}.`));
  const r = await runJevFullScan(many, types.slice(0, 24), jev.adapter, { backoffMs: 0, concurrency: 3 });
  t('одночасно не більше трьох', jev.stats().maxInFlight <= 3, String(jev.stats().maxInFlight));
  t('але паралельність справді була', jev.stats().maxInFlight >= 2, String(jev.stats().maxInFlight));
  t('усі дванадцять оброблено', r.accepted.size === 12);

  let progress = 0;
  await runJevFullScan(many.slice(0, 4), types.slice(0, 24), fakeJev(() => 0).adapter, { backoffMs: 0, onProgress: () => (progress += 1) });
  t('прогрес звітує про кожен абзац', progress === 4, String(progress));
}

console.log('\nСканування: рішення бачить теги, що вже стоять в абзаці:');
{
  const jev = fakeJev(() => 0.99);
  const withTag = para('p1', '[/emotion:страх] Абзац.');
  const r = await runJevFullScan([withTag], types.slice(0, 24), jev.adapter, { backoffMs: 0 });
  t('тип, що вже є, не прийнято вдруге', !r.accepted.get('p1')!.includes('emotion'));
  t('причина — дублікат', r.decisions.get('p1')!.find((x) => x.entitySlug === 'emotion')?.reason === 'duplicate');
}

console.log('\nАдаптер без askState:');
{
  let msg = '';
  await runJevFullScan([para('p1', 'А.')], types, { name: 'mock', evaluate: async () => ({}) } as unknown as JevAdapter).catch((e) => (msg = (e as Error).message));
  t('відмова зрозуміла', msg.includes('askState'), msg);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
