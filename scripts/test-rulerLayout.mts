/**
 * Тести математики лінійок редактора — усього, що стоїть між «мм у книзі» і
 * «px на екрані»: `src/utils/mmUnits.ts` (аркуш і позначки) і знімок
 * пагінації з `src/utils/pageBreaker.ts` (де починається й закінчується
 * кожна сторінка). Запуск: npm run test:ruler-layout
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
import { PX_PER_MM, buildRulerMarks, buildRulerSheetLayout, formatMm } from '../src/utils/mmUnits.ts';
import { buildPaginationSnapshot, paginationSnapshotsEqual } from '../src/utils/pageBreaker.ts';
import { resolveSheetScale } from '../src/components/manuscriptEditor/usePageScale.ts';

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

  console.log('\nЗнімок пагінації — межі сторінок для вертикальної лінійки:');
  {
    const budget = 971.34; // 257 мм (A4 з полями 20+20) у px
    const one = buildPaginationSnapshot([{ top: 46, bottom: 46 + budget }], [], budget);
    t('одна сторінка — одна зона', one.pageTopsPx.length === 1 && one.pageBottomsPx.length === 1);
    t('верх узято з блоку, а не з нуля', eq(one.pageTopsPx[0], 46), String(one.pageTopsPx[0]));
    t('бюджет перенесено як є', eq(one.contentHeightPx, budget));

    // Друга сторінка стоїть нижче на висоту смуги розриву — саме тому
    // лінійка бере ВІДРЕНДЕРНІ межі, а не «чисті». Тут смуга 15 px.
    const two = buildPaginationSnapshot(
      [
        { top: 46, bottom: 46 + budget },
        { top: 46 + budget + 15, bottom: 46 + 2 * budget + 15 },
      ],
      [1],
      budget
    );
    t('розрив ділить на дві сторінки', two.pageTopsPx.length === 2, JSON.stringify(two.pageTopsPx));
    t('друга сторінка — на 15 px нижче чистої межі', eq(two.pageTopsPx[1], 46 + budget + 15), String(two.pageTopsPx[1]));
    t('зони сусідніх сторінок не перекриваються', two.pageBottomsPx[0] <= two.pageTopsPx[1]);

    // Сторінка, що закінчилась раніше бюджету (розрив перенесено через
    // обтічне фото) — саме це лінійка й мусить показати авторові.
    const early = buildPaginationSnapshot([{ top: 100, bottom: 600 }, { top: 615, bottom: 1200 }], [1], budget);
    t('недозаповнена сторінка має коротшу зону', eq(early.pageBottomsPx[0] - early.pageTopsPx[0], 500), String(early.pageBottomsPx[0] - early.pageTopsPx[0]));
    t('але бюджет лишається тим самим — шкала не бреше', eq(early.contentHeightPx, budget));

    t('порожній документ — жодної зони', buildPaginationSnapshot([], [], budget).pageTopsPx.length === 0);
    t('розрив на початку ігнорується', buildPaginationSnapshot([{ top: 10, bottom: 20 }], [0], budget).pageTopsPx.length === 1);
    t('розрив поза межами ігнорується', buildPaginationSnapshot([{ top: 10, bottom: 20 }], [5], budget).pageTopsPx.length === 1);
    t('нульова висота блоку не дає від’ємної зони', buildPaginationSnapshot([{ top: 10, bottom: 10 }], [], budget).pageBottomsPx[0] === 10);
    t('знімок не залежить від бюджету 0 — але й не вигадує зон', buildPaginationSnapshot([{ top: 10, bottom: 10 }], [], 0).pageTopsPx.length === 1);
  }

  console.log('\nПорівняння знімків (щоб не перерендерювати редактор дарма):');
  {
    const a = buildPaginationSnapshot([{ top: 46, bottom: 1017 }], [], 971);
    const b = buildPaginationSnapshot([{ top: 46, bottom: 1017 }], [], 971);
    const c = buildPaginationSnapshot([{ top: 46, bottom: 1017 }], [], 900);
    const d = buildPaginationSnapshot([{ top: 46, bottom: 1017 }, { top: 1032, bottom: 2000 }], [1], 971);
    t('однакові виміри — той самий знімок', paginationSnapshotsEqual(a, b));
    t('інший бюджет — різні', !paginationSnapshotsEqual(a, c));
    t('інша кількість сторінок — різні', !paginationSnapshotsEqual(a, d));
    t('null і знімок — різні', !paginationSnapshotsEqual(null, a) && !paginationSnapshotsEqual(a, null));
    t('два null — однакові', paginationSnapshotsEqual(null, null));
  }

  console.log('\nПереповнена сторінка (блок, вищий за аркуш):');
  {
    const budget = 971;
    const fits = buildPaginationSnapshot([{ top: 46, bottom: 46 + budget }], [], budget);
    t('сторінка рівно в бюджет — не переповнена', fits.pageOverflows[0] === false);

    const over = buildPaginationSnapshot([{ top: 46, bottom: 46 + budget * 2 }], [], budget);
    t('блок, удвічі вищий за бюджет → переповнена', over.pageOverflows[0] === true);
    t('прапорець є на КОЖНУ сторінку', over.pageOverflows.length === over.pageTopsPx.length);

    // Допуск на субпіксельне округлення: сторінка, що влізла рівно, не має
    // світитись попередженням через 0.4 px.
    const tiny = buildPaginationSnapshot([{ top: 0, bottom: budget + 0.4 }], [], budget);
    t('+0.4 px — ще не переповнення', tiny.pageOverflows[0] === false);
    const real = buildPaginationSnapshot([{ top: 0, bottom: budget + 1 }], [], budget);
    t('+1 px — уже переповнення', real.pageOverflows[0] === true);
    t('без бюджету нічого не позначається переповненим',
      buildPaginationSnapshot([{ top: 0, bottom: 9999 }], [], 0).pageOverflows[0] === false);
    t('знімки з різними прапорцями — різні', !paginationSnapshotsEqual(over, fits));
  }

  console.log('\nЧесний зум проти «вмістити» (фаза 4):');
  {
    const widthPx = 642; // A4-колонка, 170 мм
    const availablePx = 500; // панель вужча за аркуш
    t('чесний зум 100 % = рівно 1, контейнер не враховується',
      resolveSheetScale('zoom', 1, widthPx, availablePx) === 1);
    t('чесний зум 150 % = рівно 1.5, навіть коли не влазить',
      resolveSheetScale('zoom', 1.5, widthPx, availablePx) === 1.5, String(resolveSheetScale('zoom', 1.5, widthPx, availablePx)));
    t('чесний зум 20 % = рівно 0.2', resolveSheetScale('zoom', 0.2, widthPx, availablePx) === 0.2);
    t('«вмістити» при вузькій панелі стискає аркуш',
      Math.abs(resolveSheetScale('fit', 1, widthPx, availablePx) - 500 / 642) < 0.0001,
      String(resolveSheetScale('fit', 1, widthPx, availablePx)));
    t('«вмістити» не збільшує понад заданий відсоток',
      resolveSheetScale('fit', 0.5, widthPx, 5000) === 0.5);
    t('«вмістити» на широкій панелі = заданий відсоток',
      resolveSheetScale('fit', 1.2, widthPx, 5000) === 1.2);
    t('нульова ширина аркуша не дає ділення на нуль',
      resolveSheetScale('fit', 1, 0, 500) === 1);
    t('невідомий (NaN) масштаб → 1, а не NaN у transform',
      resolveSheetScale('zoom', NaN, widthPx, availablePx) === 1 &&
        Number.isFinite(resolveSheetScale('fit', NaN, widthPx, availablePx)));
    t('у «вмістити» NaN-відсоток не ламає стискання',
      Math.abs(resolveSheetScale('fit', NaN, widthPx, availablePx) - 500 / 642) < 0.0001,
      String(resolveSheetScale('fit', NaN, widthPx, availablePx)));
    t('від\u02bcємний масштаб → 1 (аркуш не вивертається)',
      resolveSheetScale('zoom', -2, widthPx, availablePx) === 1);
  }

  console.log('\nПідпис міліметрів:');
  {
    t('ціле — без дробу', formatMm(170) === '170', formatMm(170));
    t('дробове KDP — з одним знаком', formatMm(12.7) === '12.7', formatMm(12.7));
    t('близьке до цілого округлюється', formatMm(119.98) === '120', formatMm(119.98));
    t('NaN не потрапляє в підпис', formatMm(NaN) === '0', formatMm(NaN));
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
