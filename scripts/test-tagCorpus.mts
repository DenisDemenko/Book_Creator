/**
 * Корпус тегів — регресія всієї системи тегів одним прогоном (задача Т0.10,
 * журнал #244; рішення власника П1, П2 у `TAGS_ANALYSIS.md` §7).
 *
 * НАВІЩО. Тег читають п'ять різних місць: розбір (`parseAnyEntityTags`),
 * нормалізація сирого запису (`wrapPlainEntityTags`), показ і приховування в
 * канві (`EntityTagPlugin.buildDecorations`), зняття на експорті
 * (`stripEntityTags`, `removeFormattedEntityTags`) і тепер — розбір значення
 * (`parseEntityValue`: чиє і поля). Будь-яке розширення синтаксису мусить
 * пройти через усі п'ять однаково, інакше тег, видимий у канві, лишиться в
 * надрукованій книзі чи навпаки. Тут кожен рядок корпусу проганяється через
 * усі місця разом.
 *
 * Запуск: npm run test:tag-corpus
 */
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import {
  CORE_ENTITIES,
  parseAnyEntityTags,
  parseEntityValue,
  stripEntityTags,
  wrapPlainEntityTags,
  removeFormattedEntityTags,
} from '../src/utils/coreEntities.ts';
import { buildDecorations } from '../src/components/manuscriptEditor/EntityTagPlugin.ts';
import { entityTagSpans } from '../src/utils/coreEntities.ts';
import { filterRangesByScope, replaceRanges } from '../src/utils/searchScope.ts';
import { findRanges } from '../src/components/BookSearchModal.tsx';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const j = (v: unknown) => JSON.stringify(v);

interface Case {
  name: string;
  text: string;
  tags: [string, string][];
  printed: string;
  wrapped?: string;
  subject?: (string | undefined)[];
  fields?: Record<string, string>[];
}

const CORPUS: Case[] = [
  { name: 'канонічний', text: '[/character:Сергій] Сергій мовчав.', tags: [['character', 'Сергій']], printed: 'Сергій мовчав.' },
  { name: 'український ключ', text: '[/персонаж:Олена] Вона прийшла.', tags: [['character', 'Олена']], printed: 'Вона прийшла.' },
  {
    name: 'поля й @Ім\'я (П1, П2)',
    text: '[/emotion:страх — 7 — хвилина — лист від брата @Анна] Руки тремтіли.',
    tags: [['emotion', 'страх — 7 — хвилина — лист від брата @Анна']],
    printed: 'Руки тремтіли.',
    subject: ['Анна'],
    fields: [{ Тип: 'страх', інтенсивність: '7', тривалість: 'хвилина', причина: 'лист від брата' }],
  },
  { name: '@ з ім\'ям і прізвищем', text: '[/decision:піти @Сергій Коваль] Він вийшов.', tags: [['decision', 'піти @Сергій Коваль']], printed: 'Він вийшов.', subject: ['Сергій Коваль'] },
  { name: 'пошта — не приписка', text: '[/source:пошта a@b.ua] Джерело.', tags: [['source', 'пошта a@b.ua']], printed: 'Джерело.', subject: [undefined] },
  { name: '«@ 10:00» — не приписка', text: '[/event:зустріч @ 10:00] Подія.', tags: [['event', 'зустріч @ 10:00']], printed: 'Подія.', subject: [undefined] },
  { name: 'вільний текст — одне поле', text: '[/emotion:страх] Тиша.', tags: [['emotion', 'страх']], printed: 'Тиша.', subject: [undefined], fields: [{ Тип: 'страх' }] },
  { name: 'сирий запис', text: 'Вона /character:Олена прийшла.', tags: [['character', 'Олена']], printed: 'Вона прийшла.', wrapped: 'Вона [/character:Олена] прийшла.' },
  {
    name: 'діалог героя',
    text: '[/character:Сергій Коваль] [/dialogue:Ти й досі] — Ти й досі не віриш мені?',
    tags: [['character', 'Сергій Коваль'], ['dialogue', 'Ти й досі']],
    printed: '— Ти й досі не віриш мені?',
  },
  { name: 'невідомий ключ у дужках знімається', text: '[/nosuchkey:x] текст', tags: [['nosuchkey', 'x']], printed: 'текст' },
  { name: '«стор. /2:3» — не тег', text: 'стор. /2:3 книги', tags: [], printed: 'стор. /2:3 книги' },
];

console.log('\nРозбір, експорт, нормалізація, значення — кожен рядок корпусу:');
for (const c of CORPUS) {
  const parsed = parseAnyEntityTags(c.text);
  const tags = parsed.map((p) => [p.entity?.slug ?? p.slug.replace(/^\//, ''), p.value]);
  t(`${c.name}: розбір`, j(tags) === j(c.tags), j(tags));
  t(`${c.name}: експорт`, stripEntityTags(c.text) === c.printed, j(stripEntityTags(c.text)));
  t(`${c.name}: нормалізація`, wrapPlainEntityTags(c.text) === (c.wrapped ?? c.text), j(wrapPlainEntityTags(c.text)));
  t(`${c.name}: у надрукованому немає службових знаків`, !/\[\/|@[А-ЯІЇЄҐA-Z]/.test(stripEntityTags(c.text)));
  if (c.subject) {
    const subj = parsed.map((p) => parseEntityValue(p.entity?.slug ?? p.slug, p.value).subject);
    t(`${c.name}: чиє`, j(subj) === j(c.subject), j(subj));
  }
  if (c.fields) {
    const f = parsed.map((p) => Object.fromEntries(parseEntityValue(p.entity?.slug ?? p.slug, p.value).fields.map((x) => [x.name, x.value])));
    t(`${c.name}: поля`, j(f) === j(c.fields), j(f));
  }
}

console.log('\nРозрізаний форматуванням тег із @ і полями:');
{
  const colored = '[[COLOR="#ff0000"]/emotion:страх — 7 @Анна[/COLOR]] далі';
  t('експорт знімає цілим', stripEntityTags(colored) === 'далі', j(stripEntityTags(colored)));
  t('removeFormattedEntityTags не лишає «@»', !removeFormattedEntityTags(colored).includes('@'), j(removeFormattedEntityTags(colored)));
}

console.log('\nКанва: приховування й підказка чипа:');
{
  const schema = new Schema({
    nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*' }, text: { group: 'inline' } },
    marks: { textColor: { attrs: { color: { default: '#f00' } } } },
  });
  const docOf = (...pieces: (string | { text: string; color: true })[]) =>
    schema.node('doc', null, [schema.node('paragraph', null, pieces.map((p) =>
      typeof p === 'string' ? schema.text(p) : schema.text(p.text, [schema.mark('textColor')])))]);
  const visibleAfterHide = (doc: PMNode) => {
    const built = buildDecorations(doc, CORE_ENTITIES, { isVisible: () => false, chipClass: 'chip', hiddenClass: 'hid', isEnglishUi: () => false });
    const hidden = new Set<number>();
    built.set.find().forEach((d: any) => { if (String(d.type?.attrs?.class || '').includes('hid')) for (let p = d.from; p < d.to; p++) hidden.add(p); });
    let out = '';
    doc.firstChild!.forEach((child, offset) => { for (let i = 0; i < (child.text || '').length; i++) if (!hidden.has(1 + offset + i)) out += child.text![i]; });
    return out;
  };
  for (const c of CORPUS.filter((x) => x.tags.length > 0 && !x.tags.some(([s]) => s === 'nosuchkey'))) {
    const shown = visibleAfterHide(docOf(c.text)).replace(/\s+/g, ' ').trim();
    t(`${c.name}: «Сховати сутності» дає той самий текст, що й друк`, shown === c.printed, j(shown));
  }
  const split = docOf('[', { text: '/emotion:страх — 7 @Анна', color: true }, '] далі');
  t('розрізаний тег із @ ховається цілим', visibleAfterHide(split).trim() === 'далі', j(visibleAfterHide(split)));

  const withSubject = docOf('[/emotion:страх — 7 @Анна] Тиша.');
  const built = buildDecorations(withSubject, CORE_ENTITIES, { isVisible: () => true, chipClass: 'chip', hiddenClass: 'hid', isEnglishUi: () => false });
  const title = String((built.set.find()[0] as any)?.type?.attrs?.title || '');
  t('підказка чипа показує «Чиє: Анна»', title.includes('Чиє: Анна'), j(title.split('\n').slice(-2)));
  t('підказка чипа показує поля', title.includes('Тип: страх · інтенсивність: 7'));
  t('сам тег у документі не змінено', withSubject.textContent === '[/emotion:страх — 7 @Анна] Тиша.');
}

console.log('\nПошук і заміна з урахуванням тегів (Т0.11):');
{
  const text = '[/character:Олена] Олена мовчала. [[COLOR="#f00"]/character:Олена[/COLOR]] Вона /character:Олена пішла, а Олена лишилась.';
  const all = findRanges(text, 'Олена', false);
  const spans = entityTagSpans(text);
  t('теги знайдено всі три (канонічний, розрізаний кольором, сирий)', spans.length === 3, j(spans.map(([a, b]) => text.slice(a, b))));
  const inText = filterRangesByScope(text, all, 'text');
  const inTags = filterRangesByScope(text, all, 'tags');
  t('збіги розділено: 2 у тексті, 3 у тегах', inText.length === 2 && inTags.length === 3, `${inText.length}/${inTags.length}`);
  const onlyText = replaceRanges(text, inText, 'Олеся');
  t('«лише текст» не чіпає тегів', (onlyText.match(/\/character:Олена/g) || []).length === 3 && (onlyText.match(/Олеся/g) || []).length === 2);
  const onlyTags = replaceRanges(text, inTags, 'Олеся');
  t('«лише теги» перейменовує лише теги, і вони лишаються тегами',
    parseAnyEntityTags(onlyTags).filter((p) => p.value === 'Олеся').length === 2 && (onlyTags.match(/Олена/g) || []).length === 2,
    j(parseAnyEntityTags(onlyTags).map((p) => p.value)));
  t('«усе» — як раніше', replaceRanges(text, filterRangesByScope(text, all, 'all'), 'Олеся') === text.split('Олена').join('Олеся'));
  t('без тегів — жодного збігу «в тегах»', filterRangesByScope('Олена й Олена', findRanges('Олена й Олена', 'Олена', false), 'tags').length === 0);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
