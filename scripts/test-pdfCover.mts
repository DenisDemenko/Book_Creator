/**
 * Тести арифметики обкладинки (src/utils/pdfCover.ts).
 * Запуск: npm run test:pdf-cover
 *
 * Малювання перевірити тут нічим — воно потребує canvas і воркера pdfjs,
 * тобто справжнього браузера. Але ДВІ речі, заради яких у цьому файлі
 * взагалі є математика, перевіряються без нього:
 *
 *  1. масштаб: сторінка PDF задана в пунктах, і від нього залежить, чи
 *     доїде до вітрини картинка потрібного розміру, чи мильна пляма;
 *  2. розмір base64: саме він відрізняє намальовану обкладинку від
 *     порожнього полотна, яке інакше поїхало б у вітрину як успіх.
 */
import {
  base64Bytes,
  coverScaleFor,
  COVER_TARGET_LONG_SIDE,
  COVER_MIN_BYTES,
} from '../src/utils/pdfCover';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

console.log('Масштаб: довша сторона дотягується до цілі');
{
  // A5 у пунктах — типова сторінка книги Студії (420×595).
  const s = coverScaleFor(420, 595);
  t('портретна сторінка масштабується за висотою',
    Math.abs(595 * s - COVER_TARGET_LONG_SIDE) < 1, `${(595 * s).toFixed(1)}`);
  t('ширина при цьому лишається меншою', 420 * s < COVER_TARGET_LONG_SIDE);

  const land = coverScaleFor(842, 595);
  t('альбомна масштабується за шириною',
    Math.abs(842 * land - COVER_TARGET_LONG_SIDE) < 1, `${(842 * land).toFixed(1)}`);

  t('квадратна сторінка', Math.abs(500 * coverScaleFor(500, 500) - COVER_TARGET_LONG_SIDE) < 1);
}

console.log('\nМасштаб: межі');
{
  // Дрібна сторінка не має роздуватись у гігантський файл: пікселі стануть
  // більшими, а деталей не додасться.
  t('стеля 4× для крихітної сторінки', coverScaleFor(10, 10) === 4, String(coverScaleFor(10, 10)));
  t('велика сторінка зменшується', coverScaleFor(5000, 8000) < 1, String(coverScaleFor(5000, 8000)));
  t('нульовий розмір не дає ділення на нуль', coverScaleFor(0, 0) === 1);
  t('відʼємний розмір не ламає', coverScaleFor(-10, -10) === 1, String(coverScaleFor(-10, -10)));
  t('NaN → 1', coverScaleFor(Number.NaN, Number.NaN) === 1);
  t('масштаб ніколи не нульовий', coverScaleFor(1e9, 1e9) > 0, String(coverScaleFor(1e9, 1e9)));
  t('власна ціль поважається',
    Math.abs(595 * coverScaleFor(420, 595, 800) - 800) < 1);
}

console.log('\nРозмір base64 — межа «полотно лишилось порожнім»');
{
  t('порожній рядок → 0', base64Bytes('') === 0);
  t('чистий base64 без префікса', base64Bytes('QUJD') === 3, String(base64Bytes('QUJD')));
  t('data:-URL: префікс не рахується',
    base64Bytes('data:image/png;base64,QUJD') === 3, String(base64Bytes('data:image/png;base64,QUJD')));
  t('один знак вирівнювання', base64Bytes('QUJDRA==') === 4, String(base64Bytes('QUJDRA==')));
  t('два знаки вирівнювання', base64Bytes('QUJDREU=') === 5, String(base64Bytes('QUJDREU=')));

  // Головне: крихітний PNG (а порожнє полотно стискається саме в такий)
  // не проходить межу, а справжня сторінка — проходить.
  const tiny = 'data:image/png;base64,' + 'A'.repeat(1000);
  const real = 'data:image/png;base64,' + 'A'.repeat(200_000);
  t('крихітний PNG не проходить межу', base64Bytes(tiny) < COVER_MIN_BYTES, String(base64Bytes(tiny)));
  t('справжня сторінка проходить', base64Bytes(real) > COVER_MIN_BYTES, String(base64Bytes(real)));
  t('межа не нульова — інакше перевірка була б декоративною', COVER_MIN_BYTES > 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
