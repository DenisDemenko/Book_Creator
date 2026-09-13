/**
 * Тести типографіки аркуша (src/utils/typography.ts). Запуск: npm run test:typography
 *
 * ЧОМУ ЦЕ ВАРТО ПЕРЕВІРЯТИ. Ці числа щойно приїхали з чотирьох різних місць,
 * і кожне рахувало їх по-своєму:
 *   • живий редактор — кегль `fontSizePt * 1.3` px;
 *   • вимір «Розвороту книги» — `fontSizePt` pt (тобто × 96/72);
 *   • превʼю «Розвороту» — `fontSizePt * 0.9` px і абзацний відступ ×2;
 *   • друкарські рушії — пункти й міліметри, як у книзі.
 * Різниця між 1.3 і 96/72 здається дрібницею, але це 2.6 % кегля: на 40
 * абзацах вона давала інший перенос рядків, а отже й іншу кількість
 * сторінок у канві проти «Розвороту книги». Тест фіксує, що таке число
 * тепер рівно одне.
 */
import { PT_TO_PX } from '../src/utils/mmUnits.ts';
import {
  bodyFontStack,
  paragraphCssVars,
  resolveParagraphGeometry,
  DEFAULT_FONT_SIZE_PT,
  DEFAULT_FIRST_LINE_INDENT_MM,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_PARAGRAPH_SPACING_MM,
} from '../src/utils/typography.ts';
import { initialBook } from '../src/data/initialBook.ts';

let passed = 0;
let failed = 0;
function t(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;

function main() {
  console.log('\nПункт → піксель:');
  {
    t('1 pt = 96/72 px', eq(PT_TO_PX, 96 / 72), String(PT_TO_PX));
    t('це НЕ 1.3 (саме тут була помилка)', Math.abs(PT_TO_PX - 1.3) > 0.03, String(PT_TO_PX));
    t('10.5 pt = 14 px', eq(10.5 * PT_TO_PX, 14), String(10.5 * PT_TO_PX));
  }

  console.log('\nГеометрія з книги за замовчуванням (initialBook):');
  {
    const g = resolveParagraphGeometry(initialBook.layoutConfig);
    t('кегль 10.5 pt', eq(g.fontSizePt, 10.5), String(g.fontSizePt));
    t('той самий кегль на екрані — 14 px', eq(g.fontSizePx, 14), String(g.fontSizePx));
    t('інтерліньяж 1.6', eq(g.lineHeight, 1.6));
    t('абзацний відступ 6 мм', eq(g.firstLineIndentMm, 6));
    t('відбивка 0 мм', eq(g.paragraphSpacingMm, 0));
    t('вирівнювання — як у книзі (justify)', g.textAlign === 'justify', g.textAlign);
  }

  console.log('\nЗіпсовані дані не ламають верстку:');
  {
    const empty = resolveParagraphGeometry(undefined);
    t('без налаштувань — дефолти', empty.fontSizePt === DEFAULT_FONT_SIZE_PT && empty.lineHeight === DEFAULT_LINE_HEIGHT);
    t('без налаштувань відступ — 6 мм', empty.firstLineIndentMm === DEFAULT_FIRST_LINE_INDENT_MM);
    t('без налаштувань відбивка — 0', empty.paragraphSpacingMm === DEFAULT_PARAGRAPH_SPACING_MM);
    t('без налаштувань вирівнювання — left', empty.textAlign === 'left');

    const bad = resolveParagraphGeometry({
      typography: { fontSizePt: 0, lineHeight: NaN, firstLineIndentMm: -3, paragraphSpacingMm: 99 },
    } as any);
    t('нульовий і NaN кегль → дефолт', bad.fontSizePt === DEFAULT_FONT_SIZE_PT && Number.isFinite(bad.fontSizePx));
    t('NaN інтерліньяж → дефолт', bad.lineHeight === DEFAULT_LINE_HEIGHT);
    t('відʼємний відступ → дефолт', bad.firstLineIndentMm === DEFAULT_FIRST_LINE_INDENT_MM);
    t('абсурдна відбивка → дефолт', bad.paragraphSpacingMm === DEFAULT_PARAGRAPH_SPACING_MM);

    const huge = resolveParagraphGeometry({ typography: { fontSizePt: 200, lineHeight: 9, firstLineIndentMm: 50 } } as any);
    t('абсурдний кегль → дефолт', huge.fontSizePt === DEFAULT_FONT_SIZE_PT);
    t('абсурдний інтерліньяж → дефолт', huge.lineHeight === DEFAULT_LINE_HEIGHT);
    t('абсурдний відступ → дефолт', huge.firstLineIndentMm === DEFAULT_FIRST_LINE_INDENT_MM);

    const odd = resolveParagraphGeometry({ typography: { textAlign: 'center' } } as any);
    t('невідоме вирівнювання → left', odd.textAlign === 'left', odd.textAlign);
    const zeroIndent = resolveParagraphGeometry({ typography: { firstLineIndentMm: 0 } } as any);
    t('нуль — це ДІЙСНИЙ відступ, а не привід для дефолту', zeroIndent.firstLineIndentMm === 0);
  }

  console.log('\nCSS-змінні для .nova-manuscript-blocks:');
  {
    const g = resolveParagraphGeometry(initialBook.layoutConfig);
    const vars = paragraphCssVars(g);
    t('відступ у міліметрах', vars['--para-indent'] === '6mm', vars['--para-indent']);
    t('відбивка в міліметрах', vars['--para-gap'] === '0mm', vars['--para-gap']);
    t('вирівнювання — той самий рядок, що в CSS', vars['--para-align'] === 'justify', vars['--para-align']);
    const spaced = paragraphCssVars(resolveParagraphGeometry({ typography: { paragraphSpacingMm: 4 } } as any));
    t('відбивка передається як є', spaced['--para-gap'] === '4mm', spaced['--para-gap']);
  }

  console.log('\nСтек шрифту:');
  {
    t('Literata — із засічковим фолбеком', bodyFontStack('Literata').startsWith('Literata') && bodyFontStack('Literata').includes('Georgia'));
    t('невідомий шрифт → Literata-стек', bodyFontStack('Якийсь Невідомий').startsWith('Literata'));
    t('підключений автором шрифт — у лапках і з Georgia', bodyFontStack('My Font', true) === '"My Font", Georgia, serif', bodyFontStack('My Font', true));
    t('Outfit — без засічок', bodyFontStack('Outfit').includes('sans-serif'));
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
