/**
 * Тести математики лінійки редактора (src/utils/mmUnits.ts).
 * Запуск: npm run test:ruler-layout
 *
 * ЧОМУ ЦЕ ВАРТО ПЕРЕВІРЯТИ. Дві помилки в цьому місці вже були живі:
 *
 *  1. ПОЗНАЧКИ НЕ В ТИХ ОДИНИЦЯХ. Лінійка мала поділку кожні 10 мм, але
 *     ЦИФРУ показувала лише на кожній пʼятій і саме як `cm/10`, тож підписи
 *     виглядали як «0.5, 1, 1.5, 2…» — автор бачив «вигадані одиниці».
 *     `buildRulerMarks` тепер віддає РЕАЛЬНЕ значення в мм, і це зафіксовано.
 *
 *  2. ЛІНІЙКА МІРЯЛА ТЕКСТОВУ КОЛОНКУ, А НЕ АРКУШ. Шкала A4 обривалась на
 *     170 мм замість 210, а «0» стояла на краю тексту. Виправлення тримається
 *     на ОДНІЙ рівності (див. buildRulerSheetLayout): світла зона тексту на
 *     лінійці мусить стояти там, де PageColumn ставить колонку. Порівняти це
 *     оком у браузері майже неможливо (розбіжність у кілька px), а зламати
 *     легко — зміною `transformOrigin` чи забутим множником `scale`. Тому
 *     рівність перевіряється числом, а не поглядом.
 */
import { PX_PER_MM, buildRulerMarks, buildRulerSheetLayout } from '../src/utils/mmUnits.ts';

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

/** Порівняння px: різниця від 0.001 — похибка double, а не помилка. */
const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;

function main() {
  console.log('\nПозначки лінійки — у реальних міліметрах:');
  {
    const a4 = buildRulerMarks(210);
    t('A4 дає поділки 0…210 кроком 5 мм', a4.length === 43 && a4[0].mm === 0 && a4[a4.length - 1].mm === 210, String(a4.length));
    t('крок рівно 5 мм', a4.every((m, i) => m.mm === i * 5));
    t('з цифрою — кожні 10 мм, і саме значення в мм', a4.filter((m) => m.major).every((m) => m.mm % 10 === 0) && a4.find((m) => m.mm === 20)?.major === true);
    t('на 5 мм цифри нема', a4.find((m) => m.mm === 5)?.major === false);
    t('остання цифра — 210, а не 21', a4.filter((m) => m.major).at(-1)?.mm === 210);

    const col170 = buildRulerMarks(170);
    t('стара ширина колонки 170 мм дала б 35 поділок, а не 22', col170.length === 35, String(col170.length));

    const tiny = buildRulerMarks(12.7);
    t('дробова довжина: поділки лише там, де вони вміщаються', tiny.length === 3 && tiny.at(-1)?.mm === 10, tiny.map((m) => m.mm).join(','));

    const zero = buildRulerMarks(0);
    t('нульова довжина — одна поділка «0», без падіння', zero.length === 1 && zero[0].mm === 0);

    const negative = buildRulerMarks(-5);
    t('відʼємна довжина не валить рендер', Array.isArray(negative) && negative.length === 0);
  }

  console.log('\nАркуш навколо текстової колонки (вирівнювання з PageColumn):');
  {
    const cases = [
      { name: 'A4, поля 20/20', sheetWidthMm: 210, insideMm: 20, outsideMm: 20 },
      { name: '6×9" KDP, поля 19/12.7', sheetWidthMm: 152.4, insideMm: 19, outsideMm: 12.7 },
      { name: 'A5 без полів', sheetWidthMm: 148, insideMm: 0, outsideMm: 0 },
      { name: 'широкі поля 60/40', sheetWidthMm: 210, insideMm: 60, outsideMm: 40 },
    ];
    const scales = [1, 0.72, 0.35];

    let aligned = true;
    let alignedWhere = '';
    let sums = true;
    let sumsWhere = '';
    for (const c of cases) {
      const textWidthMm = c.sheetWidthMm - c.insideMm - c.outsideMm;
      for (const scale of scales) {
        const l = buildRulerSheetLayout({ ...c, textWidthMm, scale });

        // Колонка тексту в PageColumn: center − textWidthPx·scale/2.
        const columnLeftFromCentre = (l.textWidthPx * scale) / 2;
        // Світла зона на лінійці: ліва межа аркуша + внутрішнє поле.
        const bandLeftFromCentre = l.sheetLeftScaledPx - l.insidePx * scale;
        if (!eq(bandLeftFromCentre, columnLeftFromCentre)) {
          aligned = false;
          alignedWhere = `${c.name}, scale ${scale}: зона ${bandLeftFromCentre} ≠ колонка ${columnLeftFromCentre}`;
        }

        // Обидва краї аркуша складаються з полів і тексту — інакше ручки
        // стояли б не на межах зони.
        const sum = l.insidePx + l.textWidthPx + l.outsidePx;
        if (!eq(sum, l.sheetWidthPx)) {
          sums = false;
          sumsWhere = `${c.name}: ${sum} ≠ ${l.sheetWidthPx}`;
        }
      }
    }
    t('ліва межа зони тексту = ліва межа колонки PageColumn', aligned, alignedWhere);
    t('поля + текст = ширина аркуша', sums, sumsWhere);

    const a4 = buildRulerSheetLayout({ sheetWidthMm: 210, textWidthMm: 170, insideMm: 20, outsideMm: 20, scale: 1 });
    t('A4 при 100 %: аркуш 210 мм у px', eq(a4.sheetWidthPx, 210 * PX_PER_MM), String(a4.sheetWidthPx));
    t('A4 при 100 %: зсув аркуша = 105 мм у px', eq(a4.sheetLeftScaledPx, 105 * PX_PER_MM), String(a4.sheetLeftScaledPx));
    t('A4: права межа зони збігається з правою межею колонки', eq(a4.sheetLeftScaledPx - (a4.insidePx + a4.textWidthPx) * 1, -(a4.textWidthPx / 2) * 1));
    t('масштаб 0 не дає NaN', eq(buildRulerSheetLayout({ sheetWidthMm: 210, textWidthMm: 170, insideMm: 20, outsideMm: 20, scale: 0 }).sheetLeftScaledPx, 0));
    t('нульові поля: аркуш і колонка збігаються', eq(buildRulerSheetLayout({ sheetWidthMm: 148, textWidthMm: 148, insideMm: 0, outsideMm: 0, scale: 1 }).sheetLeftScaledPx, 74 * PX_PER_MM));
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
