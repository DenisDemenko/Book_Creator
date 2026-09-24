/**
 * «Сховати сутності» має ховати тег ЦІЛИМ — разом із дужками (задача #236).
 *
 * Вада, яку знайшов власник 24.09.2026: після натискання кнопки в тексті книги
 * лишались квадратні дужки `[` `]`. Причина — форматування: досить пофарбувати
 * чи виділити жирним частину тега, і ProseMirror ділить його на кілька
 * текстових вузлів, а плагін шукав теги в кожному вузлі окремо. Тут
 * перевіряється сама побудова декорацій (`buildDecorations`) на справжньому
 * документі ProseMirror — без браузера: які символи абзацу лишаються видимими.
 *
 * Друга половина — експорт: той самий розрізаний тег у рукописі зберігається
 * з маркерами (`[[COLOR="…"]/character:Олена[/COLOR]]`), і `stripEntityTags`
 * має знімати його так само чисто.
 *
 * Запуск: npm run test:entity-tag-decorations
 */
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { buildDecorations } from '../src/components/manuscriptEditor/EntityTagPlugin.ts';
import { CORE_ENTITIES, removeFormattedEntityTags, stripEntityTags } from '../src/utils/coreEntities.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hardBreak: { inline: true, group: 'inline' },
  },
  marks: {
    bold: {},
    textColor: { attrs: { color: { default: '#ff0000' } } },
  },
});

type Piece = string | { text: string; bold?: boolean; color?: boolean } | 'BR';
const para = (...pieces: Piece[]) =>
  schema.node('paragraph', null, pieces.map((p) => {
    if (p === 'BR') return schema.node('hardBreak');
    if (typeof p === 'string') return schema.text(p);
    const marks = [];
    if (p.bold) marks.push(schema.mark('bold'));
    if (p.color) marks.push(schema.mark('textColor'));
    return schema.text(p.text, marks);
  }));

const HIDDEN = 'nova-entity-tag-hidden';
const CHIP = 'nova-entity-chip';
const opts = (visible: boolean) => ({
  isVisible: () => visible,
  chipClass: CHIP,
  hiddenClass: HIDDEN,
  isEnglishUi: () => false,
});

/** Текст першого абзацу так, як його бачить автор: без прихованих символів; розрив — `⏎`. */
function visibleText(doc: PMNode, visible = false): string {
  const built = buildDecorations(doc, CORE_ENTITIES, opts(visible));
  const hidden = new Set<number>();
  built.set.find().forEach((d: any) => {
    if (String(d.type?.attrs?.class || '').includes(HIDDEN)) {
      for (let p = d.from; p < d.to; p++) hidden.add(p);
    }
  });
  let out = '';
  doc.firstChild!.forEach((child, offset) => {
    const start = 1 + offset;
    if (child.isText) {
      for (let i = 0; i < child.text!.length; i++) if (!hidden.has(start + i)) out += child.text![i];
    } else out += '⏎';
  });
  return out;
}
const docOf = (p: PMNode) => schema.node('doc', null, [p]);

console.log('\nПрихований режим — тег зникає разом із дужками:');
{
  const plain = docOf(para('[/character:Олена] прийшла.'));
  t('цілий тег одним вузлом', visibleText(plain) === ' прийшла.', JSON.stringify(visibleText(plain)));

  const colored = docOf(para('[', { text: '/character:Олена', color: true }, '] кінець.'));
  t('пофарбована середина тега — дужки теж ховаються (вада власника)',
    visibleText(colored) === ' кінець.', JSON.stringify(visibleText(colored)));

  const bold = docOf(para('[/emotion:', { text: 'страх', bold: true }, '] кінець.'));
  t('жирне значення тега — тег ховається цілим', visibleText(bold) === ' кінець.', JSON.stringify(visibleText(bold)));

  const wholeColored = docOf(para({ text: '[/location:Київ]', color: true }, ' кінець.'));
  t('тег повністю в кольорі', visibleText(wholeColored) === ' кінець.', JSON.stringify(visibleText(wholeColored)));

  const ukKey = docOf(para('[/персонаж:Сергій] кінець.'));
  t('український ключ (`/персонаж:`) теж ховається', visibleText(ukKey) === ' кінець.', JSON.stringify(visibleText(ukKey)));

  const two = docOf(para('[', { text: '/character:Олена', color: true }, '] і [/emotion:', { text: 'страх', bold: true }, '].'));
  t('два розрізані теги в одному абзаці', visibleText(two) === ' і .', JSON.stringify(visibleText(two)));

  const across = docOf(para('[/character:Оле', 'BR', 'на] текст'));
  t('розрив рядка не склеює «тег» через себе — нічого не ховається',
    visibleText(across) === '[/character:Оле⏎на] текст', JSON.stringify(visibleText(across)));

  const unknown = docOf(para('[/nosuchkey:x] текст'));
  t('невідомий ключ не ховається (не наш тег)', visibleText(unknown) === '[/nosuchkey:x] текст');

  const loose = docOf(para('Вона /character:Олена прийшла.'));
  t('«сирий» тег без дужок теж ховається', visibleText(loose) === 'Вона  прийшла.', JSON.stringify(visibleText(loose)));
}

console.log('\nДіапазони для курсора — один на тег, від `[` до `]`:');
{
  const colored = docOf(para('[', { text: '/character:Олена', color: true }, '] кінець.'));
  const built = buildDecorations(colored, CORE_ENTITIES, opts(false));
  const len = '[/character:Олена]'.length;
  t('рівно один діапазон', built.hiddenRanges.length === 1, JSON.stringify(built.hiddenRanges));
  t('діапазон покриває весь тег', built.hiddenRanges[0]?.from === 1 && built.hiddenRanges[0]?.to === 1 + len);
  t('сутність зараховано абзацу', built.perParagraph[0]?.slugs[0] === 'character');
}

console.log('\nВидимий режим — чип на кожен шматок, нічого не сховано:');
{
  const colored = docOf(para('[', { text: '/character:Олена', color: true }, '] кінець.'));
  const built = buildDecorations(colored, CORE_ENTITIES, opts(true));
  const chips = built.set.find().filter((d: any) => String(d.type?.attrs?.class || '').includes(CHIP));
  t('три шматки — три чипи', chips.length === 3, String(chips.length));
  t('жодного прихованого діапазону', built.hiddenRanges.length === 0);
  t('текст видно повністю', visibleText(colored, true) === '[/character:Олена] кінець.');
  const uk = docOf(para('[/персонаж:Сергій] кінець.'));
  const ukChips = buildDecorations(uk, CORE_ENTITIES, opts(true)).set.find()
    .filter((d: any) => d.type?.attrs?.['data-entity-slug'] === 'character');
  t('український ключ отримує чип сутності character', ukChips.length === 1);
}

console.log('\nЕкспорт — розрізаний маркерами тег знімається цілим:');
{
  t('колір усередині тега', stripEntityTags('[[COLOR="#ff0000"]/character:Олена[/COLOR]] кінець.') === 'кінець.',
    JSON.stringify(stripEntityTags('[[COLOR="#ff0000"]/character:Олена[/COLOR]] кінець.')));
  t('жирне значення — без зайвих `****`', stripEntityTags('[/emotion:**страх**] кінець.') === 'кінець.',
    JSON.stringify(stripEntityTags('[/emotion:**страх**] кінець.')));
  t('колір навколо цілого тега — порожня пара прибирається',
    stripEntityTags('[COLOR="#ff0000"][/location:Київ][/COLOR] кінець.') === 'кінець.',
    JSON.stringify(stripEntityTags('[COLOR="#ff0000"][/location:Київ][/COLOR] кінець.')));
  t('маркер, що відкрився в тезі й закрився в тексті, лишається',
    removeFormattedEntityTags('[/character:**Олена] каже** далі') === '** каже** далі',
    JSON.stringify(removeFormattedEntityTags('[/character:**Олена] каже** далі')));
  t('форматування звичайного тексту не зачіпається',
    stripEntityTags('Текст **жирний** і [COLOR="#00ff00"]зелений[/COLOR].') === 'Текст **жирний** і [COLOR="#00ff00"]зелений[/COLOR].');
  t('без тегів — рядок той самий', removeFormattedEntityTags('a **b** /2:3') === 'a **b** /2:3');
  t('звичайний тег — як і раніше', stripEntityTags('[/character:Олена] кінець.') === 'кінець.');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
