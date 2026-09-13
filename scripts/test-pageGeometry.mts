/**
 * Тести єдиного джерела правди про геометрію аркуша
 * (src/utils/pageGeometry.ts). Запуск: npm run test:page-geometry
 *
 * ЧОМУ ЦЕ ВАРТО ПЕРЕВІРЯТИ. До появи цього модуля ті самі два віднімання
 * (сторінка мінус поля) стояли в трьох місцях із різними запасними
 * розмірами: редактор «Книга і текст» підставляв 152×229, редактор PDF —
 * 148×210, а `useRealBookPages` не підставляв нічого й давав `NaN`. Тобто
 * та сама книга могла ділитись на сторінки по-різному на різних екранах.
 * Тест фіксує саме ці межі: що запасний розмір рівно один, що відсутні
 * поля не перетворюються на `NaN` і що текстова зона ніколи не стає
 * від'ємною (від'ємна ширина ламала б масштабування колонки).
 */
import { resolvePageGeometry, clampMarginMm, MIN_MARGIN_MM, MIN_TEXT_WIDTH_MM, DEFAULT_PAGE_WIDTH_MM, DEFAULT_PAGE_HEIGHT_MM } from '../src/utils/pageGeometry.ts';

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

/** Порівняння дробових мм: різниця від 0.001 мм — похибка double, а не помилка. */
const mm = (a: number, b: number) => Math.abs(a - b) < 0.001;

function main() {
  console.log('\nA4 з полями:');
  {
    const g = resolvePageGeometry({
      formatPreset: 'A4',
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: { topMm: 20, bottomMm: 20, insideMm: 20, outsideMm: 20, bleedMm: 0, mirrored: true },
    } as any);
    t('сторінка 210×297', mm(g.pageWidthMm, 210) && mm(g.pageHeightMm, 297), `${g.pageWidthMm}×${g.pageHeightMm}`);
    t('текстова зона 170×257', mm(g.contentWidthMm, 170) && mm(g.contentHeightMm, 257), `${g.contentWidthMm}×${g.contentHeightMm}`);
    t('поля передані як є', g.margins.topMm === 20 && g.margins.insideMm === 20 && g.margins.outsideMm === 20);
  }

  console.log('\n6"×9" з полями KDP (дробові мм):');
  {
    const g = resolvePageGeometry({
      formatPreset: '6x9',
      pageWidthMm: 152.4,
      pageHeightMm: 228.6,
      margins: { topMm: 20, bottomMm: 20, insideMm: 19, outsideMm: 12.7, bleedMm: 0, mirrored: true },
    } as any);
    t('ширина зони 120.7 мм', mm(g.contentWidthMm, 120.7), String(g.contentWidthMm));
    t('висота зони 188.6 мм', mm(g.contentHeightMm, 188.6), String(g.contentHeightMm));
  }

  console.log('\nКнига без налаштувань верстки:');
  {
    const g = resolvePageGeometry(undefined);
    t('запасний розмір — A5 148×210', mm(g.pageWidthMm, DEFAULT_PAGE_WIDTH_MM) && mm(g.pageHeightMm, DEFAULT_PAGE_HEIGHT_MM), `${g.pageWidthMm}×${g.pageHeightMm}`);
    t('запасний розмір — рівно той, що в initialBook', DEFAULT_PAGE_WIDTH_MM === 148 && DEFAULT_PAGE_HEIGHT_MM === 210);
    t('поля нульові, а не NaN', g.margins.topMm === 0 && g.margins.bottomMm === 0 && g.margins.insideMm === 0 && g.margins.outsideMm === 0);
    t('зона дорівнює сторінці', mm(g.contentWidthMm, 148) && mm(g.contentHeightMm, 210), `${g.contentWidthMm}×${g.contentHeightMm}`);

    const empty = resolvePageGeometry({} as any);
    t('порожній обʼєкт дає ті самі числа', mm(empty.contentWidthMm, g.contentWidthMm) && mm(empty.contentHeightMm, g.contentHeightMm));

    const noMargins = resolvePageGeometry({ pageWidthMm: 210, pageHeightMm: 297 } as any);
    t('відсутній блок margins не ламає розрахунок', mm(noMargins.contentWidthMm, 210) && mm(noMargins.contentHeightMm, 297), `${noMargins.contentWidthMm}×${noMargins.contentHeightMm}`);
    t('жодного NaN у результаті', [noMargins.contentWidthMm, noMargins.contentHeightMm, noMargins.margins.topMm].every(Number.isFinite));
  }

  console.log('\nЧасткові й зіпсовані дані:');
  {
    const partial = resolvePageGeometry({ pageWidthMm: 210 } as any);
    t('задана ширина лишається, висота — запасна', mm(partial.pageWidthMm, 210) && mm(partial.pageHeightMm, 210), `${partial.pageWidthMm}×${partial.pageHeightMm}`);

    const zero = resolvePageGeometry({ pageWidthMm: 0, pageHeightMm: -5 } as any);
    t('нуль і мінус у розмірі → запасний формат', mm(zero.pageWidthMm, 148) && mm(zero.pageHeightMm, 210), `${zero.pageWidthMm}×${zero.pageHeightMm}`);

    const nan = resolvePageGeometry({ pageWidthMm: NaN, pageHeightMm: 'abc' } as any);
    t('NaN і не-число → запасний формат', mm(nan.pageWidthMm, 148) && mm(nan.pageHeightMm, 210), `${nan.pageWidthMm}×${nan.pageHeightMm}`);

    const badMargins = resolvePageGeometry({
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: { topMm: NaN, bottomMm: undefined, insideMm: 20, outsideMm: null },
    } as any);
    t('NaN/undefined/null у полях → 0', badMargins.margins.topMm === 0 && badMargins.margins.bottomMm === 0 && badMargins.margins.outsideMm === 0);
    t('дійсне поле лишається', badMargins.margins.insideMm === 20, String(badMargins.margins.insideMm));
  }

  console.log('\nТекстова зона ніколи не відʼємна:');
  {
    const g = resolvePageGeometry({
      pageWidthMm: 210,
      pageHeightMm: 297,
      margins: { topMm: 200, bottomMm: 200, insideMm: 150, outsideMm: 150 },
    } as any);
    t('ширина зони 0, а не −90', g.contentWidthMm === 0, String(g.contentWidthMm));
    t('висота зони 0, а не −103', g.contentHeightMm === 0, String(g.contentHeightMm));
  }

  console.log('\nЗайві поля верстки не впливають:');
  {
    const base = {
      pageWidthMm: 152.4,
      pageHeightMm: 228.6,
      margins: { topMm: 20, bottomMm: 22, insideMm: 24, outsideMm: 18 },
    };
    const withExtras = resolvePageGeometry({ ...base, formatPreset: '6x9', margins: { ...base.margins, bleedMm: 3.2, mirrored: true } } as any);
    const before = JSON.stringify(base);
    const withoutExtras = resolvePageGeometry(base as any);
    t('bleed і mirrored не змінюють зону', mm(withExtras.contentWidthMm, withoutExtras.contentWidthMm) && mm(withExtras.contentHeightMm, withoutExtras.contentHeightMm));
    t('вхідний обʼєкт не змінено', JSON.stringify(base) === before, JSON.stringify(base));
  }

  console.log('\nМежі перетягування полів (ручки лінійки):');
  {
    const a4 = { pageWidthMm: 210, insideMm: 20, outsideMm: 20 };
    t('звичайне значення проходить як є', mm(clampMarginMm('insideMm', 25, a4), 25));
    t('менше за мінімум → мінімум', clampMarginMm('insideMm', 1.5, a4) === MIN_MARGIN_MM, String(clampMarginMm('insideMm', 1.5, a4)));
    t('від\u02bcємне → мінімум', clampMarginMm('outsideMm', -40, a4) === MIN_MARGIN_MM);
    t('завелике — обрізає по текстова зона 20 мм', mm(clampMarginMm('insideMm', 500, a4), 170), String(clampMarginMm('insideMm', 500, a4)));
    t('межа враховує ПРОТИЛЕЖНЕ поле', mm(clampMarginMm('insideMm', 500, { pageWidthMm: 210, insideMm: 20, outsideMm: 60 }), 130));
    t('обидві сторони мають ту саму межу', mm(clampMarginMm('insideMm', 500, a4), clampMarginMm('outsideMm', 500, a4)));
    t('NaN → мінімум, а не NaN у книзі', clampMarginMm('insideMm', NaN, a4) === MIN_MARGIN_MM);
    t('мінімум — ті самі 5 мм, що в PdfEditorView', MIN_MARGIN_MM === 5);
  }

  console.log('\nКламп ніколи не дає неверстабельної зони:');
  {
    const pages = [210, 148, 30];
    const others = [0, 5, 20, 60, 200];
    let ok = true;
    let where = '';
    for (const pageWidthMm of pages) {
      for (const otherMm of others) {
        for (const request of [-100, 0, 4.9, 5, 20, 25.4, 1000, NaN]) {
          const got = clampMarginMm('insideMm', request, { pageWidthMm, insideMm: request, outsideMm: otherMm });
          const maxMm = Math.max(MIN_MARGIN_MM, pageWidthMm - otherMm - MIN_TEXT_WIDTH_MM);
          if (!(Number.isFinite(got) && got >= MIN_MARGIN_MM && got <= maxMm)) {
            ok = false;
            where = `аркуш ${pageWidthMm}, протилежне ${otherMm}, просили ${request} → ${got}`;
          }
        }
      }
    }
    t('результат завжди в [5, максимум]', ok, where);

    // Здоровий аркуш: після клампу текстовій зоні лишається щонайменше 20 мм.
    const clamped = clampMarginMm('insideMm', 500, { pageWidthMm: 210, insideMm: 20, outsideMm: 20 });
    t('після клампу зона ≥ 20 мм', 210 - clamped - 20 >= MIN_TEXT_WIDTH_MM, String(210 - clamped - 20));
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
