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

import os from 'node:os';
import path from 'node:path';
import { CHAT_BATCH_CHAR_LIMIT, batchItemLabel, composeChatSend, formatBatchForChat, type ChatBatch, type ChatBatchItem } from '../src/utils/chatBatch.ts';

// Сервер зареєстрованого автора — тим самим кодом, що й у продукті; база йде в тимчасову теку.
process.env.DATA_DIR = path.join(os.tmpdir(), 'nova-chat-batch-test');
process.env.DATABASE_PATH = path.join(process.env.DATA_DIR, 'nova-studio.db');
const chatRoutes = await import('../server/chatRoutes.ts');

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

console.log('\nСкладання повідомлення для сервера (регресія 03.11.2026):');
{
  const long = (n: number) => item(n, 'я'.repeat(2500));
  const big = formatBatchForChat(batch(Array.from({ length: 30 }, (_, i) => long(i + 1)))).message;
  const closing = 'Огляньте ці абзаци по одному.';
  const note = 'Абзаци — у доданому файлі.';
  const sent = composeChatSend({ batch: big, fragment: null, closing, plain: 'x', note });
  t('пачка понад 8000 символів — тому й потрібне вкладення', big.length > chatRoutes.MAX_MESSAGE_CHARS, String(big.length));
  t('СТАРА композиція (усе в content) відхиляється сервером', chatRoutes.validateMessage(sent.display) !== null);
  t('НОВА: content проходить validateMessage сервера', chatRoutes.validateMessage(sent.serverContent) === null, String(sent.serverContent.length));
  t('пачка їде вкладенням цілою', sent.batchFile === big);
  t('вкладення не перевищує ліміту сервера для файлу', sent.batchFile!.length <= chatRoutes.MAX_TEXT_ATTACHMENT_CHARS, String(sent.batchFile!.length));
  t('у content є питання і вказівка на файл', sent.serverContent.includes(closing) && sent.serverContent.endsWith(note));
  t('історія розмови бачить повний текст: абзаци, потім питання', sent.display.startsWith(big) && sent.display.endsWith(closing));
  t('у content немає тексту абзаців', !sent.serverContent.includes('я'.repeat(50)));

  const withFragment = composeChatSend({ batch: big, fragment: 'Фрагмент «Тест».', closing, plain: 'x', note });
  t('фрагмент разом із пачкою лишається в content перед питанням', withFragment.serverContent.startsWith('Фрагмент «Тест».') && withFragment.serverContent.includes(closing));

  const only = composeChatSend({ batch: null, fragment: 'Фрагмент «Тест».', closing, plain: 'x', note });
  t('без пачки нічого не змінилось: content = те, що бачить автор', only.serverContent === only.display && only.batchFile === null && only.display === 'Фрагмент «Тест».' + String.fromCharCode(10, 10) + closing);
  const plain = composeChatSend({ batch: null, fragment: null, closing, plain: 'Просте питання', note });
  t('без карток іде лише питання автора', plain.display === 'Просте питання' && plain.serverContent === 'Просте питання' && plain.batchFile === null);
  t('вкладень сервер приймає на одне більше, ніж скріпка дозволяє автору', chatRoutes.MAX_ATTACHED_TEXT_FILES >= 4 + 1);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
