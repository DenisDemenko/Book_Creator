/**
 * Тести обкладинки: thumbnail із PDF + фізична розгортка Studio.
 * Запуск: npm run test:pdf-cover
 */
import {
  base64Bytes,
  coverScaleFor,
  COVER_TARGET_LONG_SIDE,
  COVER_MIN_BYTES,
} from '../src/utils/pdfCover';
import {
  calculateCoverGeometry,
  coverSurfaceBackground,
  coverSurfaceTextColor,
} from '../src/utils/coverProduction';
import { readFile } from 'node:fs/promises';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

console.log('Масштаб: довша сторона дотягується до цілі');
{
  const s = coverScaleFor(420, 595);
  t('портретна сторінка масштабується за висотою', Math.abs(595 * s - COVER_TARGET_LONG_SIDE) < 1, `${(595 * s).toFixed(1)}`);
  t('ширина при цьому лишається меншою', 420 * s < COVER_TARGET_LONG_SIDE);
  const land = coverScaleFor(842, 595);
  t('альбомна масштабується за шириною', Math.abs(842 * land - COVER_TARGET_LONG_SIDE) < 1, `${(842 * land).toFixed(1)}`);
  t('квадратна сторінка', Math.abs(500 * coverScaleFor(500, 500) - COVER_TARGET_LONG_SIDE) < 1);
}

console.log('\nМасштаб: межі');
{
  t('стеля 4× для крихітної сторінки', coverScaleFor(10, 10) === 4, String(coverScaleFor(10, 10)));
  t('велика сторінка зменшується', coverScaleFor(5000, 8000) < 1, String(coverScaleFor(5000, 8000)));
  t('нульовий розмір не дає ділення на нуль', coverScaleFor(0, 0) === 1);
  t('відʼємний розмір не ламає', coverScaleFor(-10, -10) === 1, String(coverScaleFor(-10, -10)));
  t('NaN → 1', coverScaleFor(Number.NaN, Number.NaN) === 1);
  t('масштаб ніколи не нульовий', coverScaleFor(1e9, 1e9) > 0, String(coverScaleFor(1e9, 1e9)));
  t('власна ціль поважається', Math.abs(595 * coverScaleFor(420, 595, 800) - 800) < 1);
}

console.log('\nРозмір base64 — межа «полотно лишилось порожнім»');
{
  t('порожній рядок → 0', base64Bytes('') === 0);
  t('чистий base64 без префікса', base64Bytes('QUJD') === 3, String(base64Bytes('QUJD')));
  t('data:-URL: префікс не рахується', base64Bytes('data:image/png;base64,QUJD') === 3, String(base64Bytes('data:image/png;base64,QUJD')));
  t('один знак вирівнювання', base64Bytes('QUJDRA==') === 4, String(base64Bytes('QUJDRA==')));
  t('два знаки вирівнювання', base64Bytes('QUJDREU=') === 5, String(base64Bytes('QUJDREU=')));
  const tiny = 'data:image/png;base64,' + 'A'.repeat(1000);
  const real = 'data:image/png;base64,' + 'A'.repeat(200_000);
  t('крихітний PNG не проходить межу', base64Bytes(tiny) < COVER_MIN_BYTES, String(base64Bytes(tiny)));
  t('справжня сторінка проходить', base64Bytes(real) > COVER_MIN_BYTES, String(base64Bytes(real)));
  t('межа не нульова', COVER_MIN_BYTES > 0);
}

console.log('\nStudio: фізична геометрія обкладинки');
{
  const g = calculateCoverGeometry({
    pageWidthMm: 152.4,
    pageHeightMm: 228.6,
    bleedMm: 3,
    pageCount: 300,
    coverType: 'paperback',
    paperStock: 'white',
  });
  t('розмір сторінки зберігається', g.pageWidthMm === 152.4 && g.pageHeightMm === 228.6);
  t('корінець залежить від сторінок/паперу', g.spineWidthMm === 15.6, String(g.spineWidthMm));
  t('повна ширина = back + spine + front + bleed', g.fullWrapWidthMm === 326.4, String(g.fullWrapWidthMm));
  t('повна висота включає bleed', g.fullWrapHeightMm === 234.6, String(g.fullWrapHeightMm));

  const hard = calculateCoverGeometry({ pageWidthMm: 148, pageHeightMm: 210, bleedMm: 3, pageCount: 200, coverType: 'hardcover', paperStock: 'cream' });
  t('hardcover додає технологічний припуск корінця', hard.spineWidthMm === 13, String(hard.spineWidthMm));
  const ebook = calculateCoverGeometry({ pageWidthMm: 148, pageHeightMm: 210, pageCount: 200, coverType: 'ebook' });
  t('ebook не має фізичного корінця', ebook.spineWidthMm === 0);
}

console.log('\nStudio: непрозорий fallback і задня обкладинка');
{
  t('без art поверхня біла', coverSurfaceBackground(undefined) === '#ffffff');
  t('без art текст темний', coverSurfaceTextColor(undefined) === '#0f172a');
  t('з art поверхня має дизайнерський базовий фон', coverSurfaceBackground('/generated/front.png') === '#0f172a');

  const source = await readFile(new URL('../src/components/CoverDesignerView.tsx', import.meta.url), 'utf8');
  t('є окреме поле backArtUrl', source.includes('backArtUrl'));
  t('є вибір паперу', source.includes('paperStock'));
  t('є вибір матеріалу', source.includes('coverMaterial'));
  t('є вибір фінішу', source.includes('finish'));
  t('UI показує повну розгортку', source.includes('fullWrapWidthMm') && source.includes('fullWrapHeightMm'));
  t('fallback не використовує прозорий фон', source.includes('coverSurfaceBackground'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);