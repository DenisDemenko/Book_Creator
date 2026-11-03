/**
 * Пачка абзаців для чату ШІ (постановка власника 03.11.2026): усе, що знайдено
 * за тегом, іде в чат із номером абзацу, місцем у книзі й тегами, щоб
 * обговорювати й правити кожен абзац окремо.
 *
 * ЧОМУ ТУТ ПЕРЕВІРЯЄТЬСЯ САМ ТЕКСТ ПОВІДОМЛЕННЯ. Це єдине, що побачить модель:
 * якщо в ньому немає номера абзацу, відповідь «в абзаці #412 слабка середина»
 * неможливо зіставити з книгою; якщо межу не названо, автор вважатиме, що
 * модель бачила всі сто абзаців, а бачила сорок.
 */

import { CHAT_BATCH_CHAR_LIMIT, batchItemLabel, formatBatchForChat, type ChatBatch, type ChatBatchItem } from '../src/utils/chatBatch.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const item = (n: number, text = `Текст абзацу ${n}.`, over: Partial<ChatBatchItem> = {}): ChatBatchItem => ({
  id: `p${n}`,
  where: 'Глава 3 «Фотограф» · Розділ «Початок»',
  number: n,
  tags: [`emotion #${n}`],
  text,
  ...over,
});
const batch = (items: ChatBatchItem[], title = '/emotion'): ChatBatch => ({ title, items });

console.log('\nПідпис абзацу:');
{
  const l = batchItemLabel(item(412));
  t('номер абзацу', l.includes('абзац #412'), l);
  t('місце в книзі', l.includes('Глава 3 «Фотограф» · Розділ «Початок»'));
  t('теги, за якими знайдено', l.includes('теги: emotion #412'));
  t('у квадратних дужках — щоб модель відрізняла адресу від тексту', l.startsWith('[') && l.endsWith(']'));
  t('абзац без номера — прямо так і сказано', batchItemLabel(item(1, 'x', { number: undefined })).includes('абзац без номера'));
  t('без місця й без тегів підпис не ламається', batchItemLabel({ id: 'a', where: '', tags: [], text: 'x', number: 5 }) === '[абзац #5]');
  t('кілька тегів — через кому', batchItemLabel(item(1, 'x', { tags: ['emotion #1', 'location #4'] })).includes('теги: emotion #1, location #4'));
}

console.log('\nПовідомлення:');
{
  const f = formatBatchForChat(batch([item(1), item(2), item(3)], '/emotion #17'));
  t('заголовок називає, за яким тегом знайдено', f.message.startsWith('Абзаци книги за тегом /emotion #17: передано 3'), f.message.slice(0, 80));
  t('кожен абзац — зі своєю адресою', (f.message.match(/▸ \[абзац #\d+/g) || []).length === 3);
  t('текст у лапках-ялинках', f.message.includes('«Текст абзацу 1.»') && f.message.includes('«Текст абзацу 3.»'));
  t('порядок абзаців збережено', f.message.indexOf('#1 ·') < f.message.indexOf('#2 ·') && f.message.indexOf('#2 ·') < f.message.indexOf('#3 ·'));
  t('сказано, що посилатись треба на номер', f.message.includes('посилайся на цей номер'));
  t('повідомлення НЕ просить переписувати: питання формулює автор', !/перепиши|перепишіть|виправ/i.test(f.message));
  t('включено 3, пропущено 0', f.included === 3 && f.omitted === 0);
  t('коли все вмістилось, про «не вмістилось» не сказано', !f.message.includes('не вмістилась'));
}

console.log('\nМежа за символами:');
{
  const long = (n: number) => item(n, 'я'.repeat(2500));
  const many = Array.from({ length: 30 }, (_, i) => long(i + 1));
  const f = formatBatchForChat(batch(many));
  t('усі 30 не влізли (30 × 2500 > межі)', f.included < 30 && f.omitted === 30 - f.included, `${f.included}/${f.omitted}`);
  t(`загальний розмір не перевищує межі ${CHAT_BATCH_CHAR_LIMIT} (з запасом на заголовок)`, f.message.length <= CHAT_BATCH_CHAR_LIMIT + 600, String(f.message.length));
  t('про те, що не влізло, сказано в самому повідомленні', f.message.includes(`із 30 (решта ${f.omitted} не вмістилась`), f.message.slice(0, 160));
  t('і порадою звузити пошук', f.message.includes('звузьте пошук'));

  const short = Array.from({ length: 30 }, (_, i) => item(i + 1, 'Коротка репліка.'));
  const g = formatBatchForChat(batch(short));
  t('сорок коротких реплік влізають усі — межа за символами, не за кількістю', g.included === 30 && g.omitted === 0);

  const tiny = formatBatchForChat(batch([long(1), long(2)]), { charLimit: 100 });
  t('навіть за дуже малої межі перший абзац беремо: порожня пачка нічого б не обговорювала', tiny.included === 1 && tiny.omitted === 1, `${tiny.included}/${tiny.omitted}`);
}

console.log('\nДовгий абзац:');
{
  const f = formatBatchForChat(batch([item(1, 'слово '.repeat(1000))]));
  t('одним абзацом не більше ліміту фрагмента + службові символи', f.message.length < 3600, String(f.message.length));
  t('обрізання позначено багатокрапкою', f.message.includes('…»'));
  t('обрізається по слову, а не посеред слова', !/слов…»/.test(f.message));
}

console.log('\nПорожнє й службове:');
{
  const f = formatBatchForChat(batch([item(1, '   '), item(2, 'Є текст.'), item(3, '')]));
  t('абзаци без тексту пропускаються', f.included === 1 && !f.message.includes('#1 ·') && f.message.includes('#2 ·'));
  t('і не рахуються як «не вмістилось»', f.omitted === 0 && !f.message.includes('не вмістилась'));
  const empty = formatBatchForChat(batch([]));
  t('порожня пачка не падає', empty.included === 0 && empty.message.includes('передано 0'));
  const rn = formatBatchForChat(batch([item(1, 'Рядок один\r\nРядок два')]));
  t('перенос рядка Windows нормалізовано', !rn.message.includes(String.fromCharCode(13)));
}

console.log('\nОдночасно з фрагментом і питанням:');
{
  const f = formatBatchForChat(batch([item(412, 'Олена злякалась.')], '/emotion #17'));
  t('абзац №412 іде з адресою, за якою відповідь можна зіставити з книгою', f.message.includes('▸ [абзац #412 · Глава 3 «Фотограф» · Розділ «Початок» · теги: emotion #412]'));
  t('між заголовком і абзацом — порожній рядок', f.message.split(String.fromCharCode(10, 10)).length === 2);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
