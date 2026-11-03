/**
 * Тег номера абзацу веде себе сам: у новому непорожньому абзаці з'являється, у
 * порожньому (без тексту й зображень) зникає (постановка власника 03.11.2026).
 *
 * ЧОМУ ТУТ СПРАВЖНІЙ СТАН PROSEMIRROR, А НЕ МАКЕТ. Плагін живе в
 * `appendTransaction`, тож «як він поводиться» видно лише тоді, коли транзакцію
 * справді застосовано до `EditorState` разом з ним: тут він складається з
 * реальних схеми, документа й `state.apply`, без DOM. Позиції вставки тега
 * (після інших тегів, поза форматуванням, з урахуванням розриву рядка) —
 * саме те, де такі плагіни помиляються на байт.
 */

import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Schema, Slice, Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { createParagraphNumberPlugin, paragraphNumberKey, type ParagraphNumberOptions } from '../src/components/manuscriptEditor/ParagraphNumberPlugin.ts';
import { PARAGRAPH_TAG_SLUG, analyzeParagraph, paragraphNumbersIn, plainParagraphFlags } from '../src/utils/paragraphNumbers.ts';
import { listBookParagraphs, applyAutoTags } from '../src/utils/autoTags.ts';
import type { CarrierBook } from '../src/utils/tagCarrier.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } }, toDOM: () => ['h1', 0] },
    blockquote: { group: 'block', content: 'paragraph+', toDOM: () => ['blockquote', 0] },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true, selectable: false, toDOM: () => ['br'] },
    image: { group: 'inline', inline: true, atom: true, attrs: { src: { default: 'x.png' } }, toDOM: () => ['img'] },
  },
  marks: { bold: { toDOM: () => ['strong', 0] } },
});

const P = (...parts: Array<string | PMNode>) =>
  schema.node('paragraph', null, parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? schema.text(x) : x)));
const H = (text: string) => schema.node('heading', { level: 1 }, [schema.text(text)]);
const BR = () => schema.node('hardBreak');
const IMG = () => schema.node('image');
const bold = (text: string) => schema.text(text, [schema.marks.bold.create()]);
const doc = (...blocks: PMNode[]) => schema.node('doc', null, blocks);

const noOthers = () => ({ max: 0, used: new Set<number>() });
const make = (d: PMNode, over: Partial<ParagraphNumberOptions> = {}) =>
  EditorState.create({
    schema,
    doc: d,
    plugins: [createParagraphNumberPlugin({ isEnabled: () => true, getOtherNumbers: noOthers, ...over })],
  });

const texts = (s: EditorState) => {
  const out: string[] = [];
  s.doc.forEach((n) => out.push(n.textContent));
  return out;
};
/** Позиція кінця тексту абзацу з номером `i` (на верхньому рівні). */
const endOf = (s: EditorState, i: number) => {
  let pos = 0;
  let found = 0;
  s.doc.forEach((n, off) => {
    if (found === i) pos = off + 1 + n.content.size;
    found += 1;
  });
  return pos;
};
const startOf = (s: EditorState, i: number) => {
  let pos = 0;
  let found = 0;
  s.doc.forEach((_n, off) => {
    if (found === i) pos = off + 1;
    found += 1;
  });
  return pos;
};

console.log('\nАналіз абзацу:');
{
  const a = analyzeParagraph('[/paragraph:#7] Текст абзацу.');
  t('непорожній, один тег №7', !a.empty && a.tags.length === 1 && a.tags[0].number === 7);
  t('діапазон видалення включає пропуск після тега', a.tags[0].removeEnd === a.tags[0].end + 1);
  t('порожній рядок — порожній абзац', analyzeParagraph('').empty);
  t('самі пропуски — порожній', analyzeParagraph('   ').empty);
  t('лише тег абзацу — порожній', analyzeParagraph('[/paragraph:#7]').empty);
  t('лише теги — порожній (теги в рахунок не йдуть)', analyzeParagraph('[/paragraph:#7] [/emotion:страх]').empty);
  t('текст і теги — непорожній', !analyzeParagraph('[/emotion:страх] Слово').empty);
  t('вставний вміст (зображення) робить абзац непорожнім', !analyzeParagraph('', true).empty);
  t('зображення без тексту, але з тегом — теж непорожній', !analyzeParagraph('[/paragraph:#1]', true).empty);
  t('«наш» тег — без імені: іменований [/paragraph:Вступ] ігнорується', analyzeParagraph('[/paragraph:Вступ] Текст').tags.length === 0);
  t('тег без номера теж «наш»', analyzeParagraph('[/paragraph:] Текст').tags[0]?.number === null);
  t('де закінчується серія тегів на початку', analyzeParagraph('[/emotion:страх] [/paragraph:#2] Слово').leadEnd === '[/emotion:страх] [/paragraph:#2]'.length);
  t('тег усередині тексту не входить у початкову серію', analyzeParagraph('Слово [/paragraph:#2] ще').leadEnd === 0);
  t('номери в тексті розділу', paragraphNumbersIn('[/paragraph:#3] А' + '\n\n' + '[/paragraph:#10] Б' + '\n\n' + '[/paragraph:Вступ] В').join() === '3,10');
}

console.log('\nЗвичайні абзаци проти спеціальних блоків:');
{
  const flags = plainParagraphFlags([
    'Звичайний абзац.',
    '# Заголовок',
    '> Цитата',
    '[IMG: img-1 "підпис"]',
    '[DIVIDER]',
    '[TABLE]',
    '[AI-DRAFT]',
    'Абзац усередині чернетки ШІ.',
    '[/AI-DRAFT]',
    'Знову звичайний.',
    '[AI-GENERATED:claude]',
    'Усередині.',
    '[/AI-GENERATED]',
    'І знову звичайний.',
  ]);
  t('звичайний абзац — так', flags[0] && flags[9] && flags[13]);
  t('заголовок, цитата, ілюстрація, розділювач, таблиця — ні', !flags[1] && !flags[2] && !flags[3] && !flags[4] && !flags[5]);
  t('межі чернетки ШІ — ні', !flags[6] && !flags[8] && !flags[10] && !flags[12]);
  t('абзац УСЕРЕДИНІ чернетки ШІ — теж ні', !flags[7] && !flags[11]);
}

console.log('\nПрогін по книзі нумерує лише звичайні абзаци:');
{
  const book: CarrierBook = {
    chapters: [{ title: 'Г', sections: [{ title: 'Р', content: ['# Заголовок розділу', 'Звичайний.', '> Цитата.', '[TABLE]' + String.fromCharCode(10) + '[ROW][CELL]а[/CELL][/ROW]' + String.fromCharCode(10) + '[/TABLE]', 'Другий звичайний.'].join(String.fromCharCode(10, 10)) }] }],
  };
  const list = listBookParagraphs(book);
  t('із п\'яти блоків звичайних два', list.length === 2, String(list.length));
  const r = applyAutoTags(book, []);
  const c = r.book.chapters![0].sections![0].content!;
  t('тег абзацу — лише на двох', (c.match(/\[\/paragraph:#\d+\]/g) || []).length === 2, c);
  t('заголовок, цитата й таблиця — без змін', c.includes('# Заголовок розділу') && c.includes('> Цитата.') && c.includes('[TABLE]' + String.fromCharCode(10) + '[ROW]'));
}

console.log('\nПлагін вимкнено — книга не змінюється:');
{
  let s = make(doc(P('Текст без тега.')), { isEnabled: () => false });
  s = s.apply(s.tr.insertText(' Ще', endOf(s, 0)));
  t('після правки тега немає', texts(s)[0] === 'Текст без тега. Ще', texts(s)[0]);
}

console.log('\nВідкриття розділу нічого не нумерує:');
{
  let s = make(doc(P('Перший.'), P('Другий.')));
  t('початковий стан без транзакцій — без тегів', texts(s).every((x) => !x.includes('[/')));
  const tr = s.tr.replaceWith(0, s.doc.content.size, doc(P('Новий вміст.'), P('Ще абзац.')).content).setMeta('preventUpdate', true);
  s = s.apply(tr);
  t('setContent без події (preventUpdate) — без тегів', texts(s).every((x) => !x.includes('[/')), texts(s).join(' | '));
}

console.log('\nНовий абзац дістає тег, коли в ньому з\'являється текст:');
{
  let s = make(doc(P('[/paragraph:#1] Перший абзац.')));
  s = s.apply(s.tr.split(endOf(s, 0)));
  t('Enter створив порожній абзац — тега ще немає', texts(s).length === 2 && texts(s)[1] === '', JSON.stringify(texts(s)));
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, startOf(s, 1))));
  s = s.apply(s.tr.insertText('Другий', startOf(s, 1)));
  t('після першого набраного тега абзац пронумеровано', texts(s)[1] === '[/paragraph:#2] Другий', JSON.stringify(texts(s)[1]));
  t('перший абзац не змінився', texts(s)[0] === '[/paragraph:#1] Перший абзац.');
}

console.log('\nКурсор лишається після набраного тексту:');
{
  let s = make(doc(P('[/paragraph:#1] А'), P('')));
  const at = startOf(s, 1);
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at)));
  s = s.apply(s.tr.insertText('Б', at));
  const caret = s.selection.from;
  const expected = endOf(s, 1);
  t('курсор — наприкінці абзацу, після «Б», а не перед тегом', caret === expected, `${caret} проти ${expected}`);
  t('текст абзацу', texts(s)[1] === '[/paragraph:#2] Б', JSON.stringify(texts(s)[1]));
}

console.log('\nEnter посередині: друга половина дістає свій номер:');
{
  let s = make(doc(P('[/paragraph:#1] Привіт світ')));
  const mid = startOf(s, 0) + '[/paragraph:#1] Привіт'.length;
  s = s.apply(s.tr.split(mid));
  t('перша половина зберегла тег', texts(s)[0] === '[/paragraph:#1] Привіт', JSON.stringify(texts(s)[0]));
  t('друга одразу дістала новий номер', texts(s)[1] === '[/paragraph:#2] світ', JSON.stringify(texts(s)[1]));
}

console.log('\nEnter на самому початку: номер лишається за текстом:');
{
  let s = make(doc(P('[/paragraph:#5] Текст')));
  s = s.apply(s.tr.split(startOf(s, 0)));
  t('перший абзац порожній і без тега', texts(s)[0] === '', JSON.stringify(texts(s)));
  t('текст не втратив свій №5', texts(s)[1] === '[/paragraph:#5] Текст', JSON.stringify(texts(s)[1]));
}

console.log('\nПорожній абзац втрачає тег:');
{
  let s = make(doc(P('[/paragraph:#5] Текст')));
  const from = startOf(s, 0) + '[/paragraph:#5] '.length;
  s = s.apply(s.tr.delete(from, endOf(s, 0)));
  t('видалили весь текст — тега немає', texts(s)[0] === '', JSON.stringify(texts(s)[0]));

  let s2 = make(doc(P('[/paragraph:#5]   ')));
  s2 = s2.apply(s2.tr.insertText(' ', endOf(s2, 0)));
  t('лише пропуски й тег — порожній, тег знято', texts(s2)[0].trim() === '', JSON.stringify(texts(s2)[0]));

  let s3 = make(doc(P('[/paragraph:#5] [/emotion:страх] Текст')));
  s3 = s3.apply(s3.tr.delete(startOf(s3, 0) + '[/paragraph:#5] [/emotion:страх] '.length, endOf(s3, 0)));
  t('інші теги лишаються, тег номера — ні', texts(s3)[0] === '[/emotion:страх] ', JSON.stringify(texts(s3)[0]));
}

console.log('\nАбзац із самими іншими тегами не нумерується:');
{
  let s = make(doc(P('')));
  s = s.apply(s.tr.insertText('[/emotion:страх]', startOf(s, 0)));
  t('лише [/emotion:…] без слів — номера нема', texts(s)[0] === '[/emotion:страх]', JSON.stringify(texts(s)[0]));
  s = s.apply(s.tr.insertText(' слово', endOf(s, 0)));
  t('щойно з\'явилось слово — номер є, після наявного тега', texts(s)[0] === '[/emotion:страх] [/paragraph:#1] слово', JSON.stringify(texts(s)[0]));
}

console.log('\nЗображення без тексту — не порожній абзац:');
{
  let s = make(doc(P('[/paragraph:#3] x', IMG())));
  s = s.apply(s.tr.delete(startOf(s, 0) + '[/paragraph:#3] '.length, startOf(s, 0) + '[/paragraph:#3] x'.length));
  t('текст видалено, зображення лишилось — тег №3 стоїть', texts(s)[0] === '[/paragraph:#3] ', JSON.stringify(texts(s)[0]));
  let s2 = make(doc(P(IMG())));
  s2 = s2.apply(s2.tr.insertText('а', startOf(s2, 0)));
  s2 = s2.apply(s2.tr.delete(startOf(s2, 0) + s2.doc.firstChild!.textContent.indexOf('а'), startOf(s2, 0) + s2.doc.firstChild!.textContent.indexOf('а') + 1));
  t('абзац лише із зображенням має номер', s2.doc.firstChild!.textContent.includes('[/paragraph:#1]'), JSON.stringify(s2.doc.firstChild!.textContent));
  t('і зображення на місці', s2.doc.firstChild!.content.lastChild!.type.name === 'image');
}

console.log('\nЗлиття двох абзаців: лишається перший тег:');
{
  let s = make(doc(P('[/paragraph:#1] Один'), P('[/paragraph:#2] Два')));
  s = s.apply(s.tr.join(endOf(s, 0) + 1));
  t('один абзац', s.doc.childCount === 1);
  t('другий тег прибрано', texts(s)[0] === '[/paragraph:#1] ОдинДва', JSON.stringify(texts(s)[0]));
}

console.log('\nЗлиття з порожнім абзацем: номер тексту переживає:');
{
  let s = make(doc(P(''), P('[/paragraph:#8] Текст')));
  s = s.apply(s.tr.join(endOf(s, 0) + 1));
  t('номер №8 лишився', texts(s)[0] === '[/paragraph:#8] Текст', JSON.stringify(texts(s)[0]));
}

console.log('\nСкопійований абзац дістає новий номер, оригінал — ні:');
{
  let s = make(doc(P('[/paragraph:#1] А'), P('[/paragraph:#2] Б')));
  const copy = P('[/paragraph:#1] А');
  s = s.apply(s.tr.insert(s.doc.content.size, copy));
  t('копія внизу: оригінал №1 лишився', texts(s)[0] === '[/paragraph:#1] А', JSON.stringify(texts(s)));
  t('копія дістала №3', texts(s)[2] === '[/paragraph:#3] А', JSON.stringify(texts(s)[2]));

  let s2 = make(doc(P('[/paragraph:#1] А'), P('[/paragraph:#2] Б')));
  s2 = s2.apply(s2.tr.insert(0, P('[/paragraph:#1] А')));
  t('вставили копію ВИЩЕ оригіналу: оригінал (тепер другий) №1 не втратив', texts(s2)[1] === '[/paragraph:#1] А', JSON.stringify(texts(s2)));
  t('а вставлена нагорі дістала №3', texts(s2)[0] === '[/paragraph:#3] А', JSON.stringify(texts(s2)[0]));
  t('незачеплений №2 не чіпається', texts(s2)[2] === '[/paragraph:#2] Б');
}

console.log('\nВставка кількох абзаців: номери за порядком:');
{
  let s = make(doc(P('[/paragraph:#1] Перший')));
  const slice = new Slice(Fragment.from([P('Другий'), P('Третій'), P('Четвертий')]), 0, 0);
  s = s.apply(s.tr.replace(s.doc.content.size, s.doc.content.size, slice));
  const out = texts(s);
  t('чотири абзаци', out.length === 4, String(out.length));
  t('№2, №3, №4 за порядком', out[1] === '[/paragraph:#2] Другий' && out[2] === '[/paragraph:#3] Третій' && out[3] === '[/paragraph:#4] Четвертий', JSON.stringify(out));
}

console.log('\nНомери в інших розділах книги:');
{
  const others = () => ({ max: 100, used: new Set([1, 2, 3, 100]) });
  let s = make(doc(P('')), { getOtherNumbers: others });
  s = s.apply(s.tr.insertText('Новий', startOf(s, 0)));
  t('новий номер — max книги + 1, а не 1', texts(s)[0] === '[/paragraph:#101] Новий', JSON.stringify(texts(s)[0]));

  let s2 = make(doc(P('Початок')), { getOtherNumbers: others });
  s2 = s2.apply(s2.tr.insertText('[/paragraph:#3] ', startOf(s2, 0)));
  t('вставлений номер, що вже є в іншому розділі, замінюється', texts(s2)[0] === '[/paragraph:#101] Початок', JSON.stringify(texts(s2)[0]));
}

console.log('\nТег без номера й іменований тег:');
{
  let s = make(doc(P('Текст')));
  s = s.apply(s.tr.insertText('[/paragraph:] ', startOf(s, 0)));
  t('[/paragraph:] без номера дістає номер', texts(s)[0] === '[/paragraph:#1] Текст', JSON.stringify(texts(s)[0]));

  let s2 = make(doc(P('[/paragraph:Вступ] ')));
  s2 = s2.apply(s2.tr.insertText('Привіт', endOf(s2, 0)));
  t('іменований тег лишається, номерний додається після нього', texts(s2)[0] === '[/paragraph:Вступ] [/paragraph:#1] Привіт', JSON.stringify(texts(s2)[0]));

  let s3 = make(doc(P('[/paragraph:Вступ] Текст')));
  s3 = s3.apply(s3.tr.delete(startOf(s3, 0) + '[/paragraph:Вступ] '.length, endOf(s3, 0)));
  t('іменований тег порожнього абзацу автоматика не видаляє', texts(s3)[0] === '[/paragraph:Вступ] ', JSON.stringify(texts(s3)[0]));
}

console.log('\nЧіпає лише абзаци верхнього рівня:');
{
  const quote = schema.node('blockquote', null, [P('Цитата')]);
  let s = make(doc(quote, H('Заголовок'), P('Абзац')));
  let pos = 0;
  s.doc.forEach((n, off) => {
    if (n.type.name === 'blockquote') pos = off + 2 + n.firstChild!.content.size;
  });
  s = s.apply(s.tr.insertText(' ще', pos));
  t('цитата без тега', !texts(s)[0].includes('[/paragraph'), JSON.stringify(texts(s)[0]));
  let s2 = make(doc(quote, H('Заголовок'), P('Абзац')));
  const hPos = 2 + quote.nodeSize - 2 + 1 + 'Заголовок'.length;
  s2 = s2.apply(s2.tr.insertText('!', hPos));
  t('заголовок без тега', !texts(s2)[1].includes('[/paragraph') && texts(s2)[1].startsWith('Заголовок'), JSON.stringify(texts(s2)[1]));
}

console.log('\nНезачеплені абзаци не змінюються (нумерація поступова):');
{
  let s = make(doc(P('Один'), P('Два'), P('Три')));
  s = s.apply(s.tr.insertText('!', endOf(s, 1)));
  t('пронумеровано лише той, де набирали', texts(s)[0] === 'Один' && texts(s)[1] === '[/paragraph:#1] Два!' && texts(s)[2] === 'Три', JSON.stringify(texts(s)));
}

console.log('\nМісце вставки: без форматування й з розривом рядка:');
{
  let s = make(doc(P(bold('Жирний'), ' звичайний')));
  s = s.apply(s.tr.insertText('!', endOf(s, 0)));
  const first = s.doc.firstChild!.firstChild!;
  t('тег вставлено ПЕРЕД текстом', s.doc.firstChild!.textContent.startsWith('[/paragraph:#1] Жирний'), JSON.stringify(s.doc.firstChild!.textContent));
  t('тег без форматування (не потрапив у жирний)', !first.marks.some((m) => m.type.name === 'bold') && first.text!.startsWith('[/paragraph:#1]'));

  let s2 = make(doc(P('[/paragraph:#1] А', BR(), '[/paragraph:#2] Б')));
  s2 = s2.apply(s2.tr.insertText('!', endOf(s2, 0)));
  const kids: string[] = [];
  s2.doc.firstChild!.forEach((c) => kids.push(c.isText ? c.text! : c.type.name));
  t('другий тег після розриву рядка видалено точно', kids.join('|') === '[/paragraph:#1] А|hardBreak|Б!', kids.join('|'));
}

console.log('\nІсторія скасування й повторна обробка:');
{
  let s = make(doc(P('Текст')));
  const tr = s.tr.insertText('!', endOf(s, 0));
  const applied = s.applyTransaction(tr);
  const appended = applied.transactions[1] as Transaction | undefined;
  t('плагін додав транзакцію', !!appended);
  t('вона не потрапляє в «Скасувати»', appended?.getMeta('addToHistory') === false);
  t('вона позначена як власна', appended?.getMeta(paragraphNumberKey) === true);
  t('транзакцій рівно дві — без зациклення', applied.transactions.length === 2, String(applied.transactions.length));
  const again = applied.state.apply(applied.state.tr.insertText('?', endOf(applied.state, 0)));
  t('наступна правка не додає другого тега', (texts(again)[0].match(/\[\/paragraph:/g) || []).length === 1, JSON.stringify(texts(again)[0]));
}

console.log('\nКомпозиція (IME) не переривається:');
{
  let s = make(doc(P('Текст')));
  s = s.apply(s.tr.insertText('х', endOf(s, 0)).setMeta('composition', 'c1'));
  t('під час композиції тега немає', texts(s)[0] === 'Текстх', JSON.stringify(texts(s)[0]));
  s = s.apply(s.tr.insertText('!', endOf(s, 0)));
  t('після композиції — є', texts(s)[0].startsWith('[/paragraph:#1]'), JSON.stringify(texts(s)[0]));
}

console.log('\nНомери не повторюються під час набору:');
{
  let s = make(doc(P('')));
  const seen = new Set<number>();
  for (let i = 0; i < 6; i++) {
    s = s.apply(s.tr.insertText(`Абзац ${i}`, startOf(s, s.doc.childCount - 1)));
    s = s.apply(s.tr.split(endOf(s, s.doc.childCount - 1)));
  }
  s.doc.forEach((n) => {
    const m = /\[\/paragraph:#(\d+)\]/.exec(n.textContent);
    if (m) seen.add(Number(m[1]));
  });
  t('шість абзаців — шість різних номерів 1..6', seen.size === 6 && [...seen].sort().join() === '1,2,3,4,5,6', [...seen].join());
  t('останній абзац порожній і без тега', texts(s)[6] === '', JSON.stringify(texts(s)));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
