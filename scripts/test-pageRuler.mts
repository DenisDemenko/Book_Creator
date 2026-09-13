/**
 * Лінійка редактора: перевірка НА РЕАЛЬНОМУ КОМПОНЕНТІ, без браузера.
 * Запуск: npm run test:page-ruler
 *
 * ЧОМУ ТАК, А НЕ ЛИШЕ ЧИСЛАМИ. `test:ruler-layout` перевіряє формулу, але
 * формула може бути правильною, а розмітка — зіпсованою: варто змінити
 * `transformOrigin` на `top center`, або повісити зсув на `right` замість
 * `left`, і вся рівність розсиплеться, хоч усі числа з `buildRulerSheetLayout`
 * лишаться вірними. Тут PageRuler рендериться через `renderToStaticMarkup`
 * (ефекти не виконуються, тож `scale` = 1 — саме те, що треба для звірки
 * пікселів) і з готового HTML вичитуються позиції.
 *
 * Що саме фіксується:
 *   • шкала йде по АРКУШУ (A4 → поділки 0…210, а не 0…170 колонки);
 *   • світла зона тексту стоїть там, де PageColumn ставить колонку
 *     (`center − textWidth/2`), а ручки — на межах цієї зони;
 *   • підпис ширини тексту локалізований в обох мовах (і ключі є в обох
 *     словниках — «забув переклад» у цьому репозиторії траплялось).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n/LanguageContext.tsx';
import { dictionaries } from '../src/i18n/dictionaries/index.ts';
import { PageRuler } from '../src/components/manuscriptEditor/PageRuler.tsx';
import { PX_PER_MM } from '../src/utils/mmUnits.ts';

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

const eq = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * LanguageProvider читає мову з localStorage (у Node його немає, тож без
 * заглушки завжди була б українська, і перевірити англійський рендер було б
 * нічим). Заглушка мінімальна і дозволяє перемикати мову між рендерами.
 */
let currentLang: 'uk' | 'en' = 'uk';
(globalThis as any).localStorage = {
  getItem: (key: string) => (key === 'nova_language' ? currentLang : null),
  setItem: () => {},
  removeItem: () => {},
};

/** Рендер реального компонента в HTML-рядок (без DOM: ефекти не виконуються). */
function renderRuler(props: {
  sheetWidthMm: number;
  textWidthMm: number;
  insideMm: number;
  outsideMm: number;
}): string {
  return renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(PageRuler, {
        ...props,
        zoomFactor: 1,
        onChangeMargins: () => {},
        verticalRulerWidthPx: 24,
      })
    )
  );
}

/**
 * Усі значення, які в розмітці стоять як `...left:ЧИСЛОpx...` за заданим
 * зразком. Одиниця необовʼязкова: React не дописує `px` до нуля, тож
 * `left:0` — це той самий нуль, що й `left:0px`.
 */
function nums(html: string, re: RegExp): number[] {
  return [...html.matchAll(re)].map((m) => Number(m[1]));
}

/** Підписи поділок — усі числа, які лінійка надрукувала цифрами. */
function labels(html: string): number[] {
  return nums(html, /font-mono">(\d+)<\/span>/g);
}

function main() {
  const a4 = { sheetWidthMm: 210, textWidthMm: 170, insideMm: 20, outsideMm: 20 };
  const html = renderRuler(a4);

  console.log('\nШкала — по аркушу, а не по колонці тексту:');
  {
    const markLeft = nums(html, /class="absolute top-0 bottom-0" style="left:([\d.]+)(?:px)?"/g);
    t('поділок 43 (кожні 5 мм від 0 до 210)', markLeft.length === 43, String(markLeft.length));
    t('перша поділка — 0 мм', eq(markLeft[0], 0), String(markLeft[0]));
    t('остання поділка — 210 мм, а не 170', eq(markLeft.at(-1) ?? -1, 210 * PX_PER_MM), String(markLeft.at(-1)));
    t('усі поділки в межах аркуша', markLeft.every((p) => p >= 0 && p <= 210 * PX_PER_MM + 0.01));
    const marks = labels(html);
    t('цифрами підписані кожні 10 мм — 22 числа', marks.length === 22, marks.join(','));
    t('перше число — 0, останнє — 210, усі кратні 10', marks[0] === 0 && marks.at(-1) === 210 && marks.every((n) => n % 10 === 0));
    t('числа у РЕАЛЬНИХ мм, а не в сантиметрах', marks[1] === 10 && marks[2] === 20, `друге й третє: ${marks[1]}, ${marks[2]}`);
  }

  console.log('\nАркуш і зона тексту на своїх місцях:');
  {
    const sheet = html.match(/style="width:([\d.]+)px;height:100%;transform:scale\(1\);transform-origin:top left/);
    t('аркуш має ширину 210 мм у px', !!sheet && eq(Number(sheet![1]), 210 * PX_PER_MM), sheet?.[1]);

    const band = html.match(/left:([\d.]+)px;width:([\d.]+)px;background:#fffefc/);
    t('зона тексту має ширину 170 мм у px', !!band && eq(Number(band![2]), 170 * PX_PER_MM), band?.[2]);
    t('зона тексту починається на 20 мм від краю аркуша', !!band && eq(Number(band![1]), 20 * PX_PER_MM), band?.[1]);

    const shift = html.match(/left:calc\(50% - ([\d.]+)px\)/);
    t('зсув аркуша — 105 мм у px (колонка 170/2 + поле 20)', !!shift && eq(Number(shift![1]), 105 * PX_PER_MM), shift?.[1]);
    t('зсув аркуша дорівнює рівно половині масштабованої колонки + поле', !!shift && eq(Number(shift![1]), (170 / 2 + 20) * PX_PER_MM));

    // Колонка тексту в PageColumn: center − textWidth·scale/2. Перевіряємо,
    // що ЛІВА межа зони на лінійці стоїть там само.
    const bandLeftFromCentre = Number(shift![1]) - Number(band![1]);
    t('ліва межа зони = ліва межа колонки PageColumn', eq(bandLeftFromCentre, (170 * PX_PER_MM) / 2), String(bandLeftFromCentre));
  }

  console.log('\nРучки полів — на межах текстової зони:');
  {
    const handles = nums(html, /cursor-ew-resize[^>]*style="left:([\d.]+)(?:px)?;transform:translateX\(-50%\)"/g);
    t('ручок дві', handles.length === 2, String(handles.length));
    t('внутрішня — на 20 мм від краю аркуша', eq(handles[0], 20 * PX_PER_MM), String(handles[0]));
    t('зовнішня — на 190 мм (210 − 20)', eq(handles[1], 190 * PX_PER_MM), String(handles[1]));
    t('ручки стоять по краях світлої зони', eq(handles[0], Number(html.match(/left:([\d.]+)px;width:[\d.]+px;background:#fffefc/)![1])) && eq(handles[1], 190 * PX_PER_MM));
  }

  console.log('\nПідпис і переклад:');
  {
    t('українською — «Текст: 170 мм»', html.includes('Текст: 170 мм'), html.match(/Текст[^<]*/)?.[0]);
    t('дробові мм показуються одним знаком', renderRuler({ sheetWidthMm: 152.4, textWidthMm: 120.7, insideMm: 19, outsideMm: 12.7 }).includes('Текст: 120.7 мм'));

    const keys = ['rulerTextWidth', 'rulerInsideHandleTip', 'rulerOutsideHandleTip', 'rulerSheetTip'] as const;
    const missing = keys.filter((k) => {
      const uk = (dictionaries.uk as any).editor?.[k];
      const en = (dictionaries.en as any).editor?.[k];
      return typeof uk !== 'string' || typeof en !== 'string';
    });
    t('усі 4 ключі лінійки є в обох словниках', missing.length === 0, missing.join(', '));

    currentLang = 'en';
    const enHtml = renderRuler(a4);
    currentLang = 'uk';
    t('англійською — «Text: 170 mm»', enHtml.includes('Text: 170 mm'), enHtml.match(/Text[^<]*/)?.[0]);
    t('підказка ручки теж перекладена', enHtml.includes('Inside margin — drag to change'));
    t('жодного сирого ключа ні в одній мові', !html.includes('editor.ruler') && !enHtml.includes('editor.ruler'));
  }

  console.log('\nA5 без полів — аркуш і колонка збігаються:');
  {
    const a5 = renderRuler({ sheetWidthMm: 148, textWidthMm: 148, insideMm: 0, outsideMm: 0 });
    const shift = a5.match(/left:calc\(50% - ([\d.]+)px\)/);
    t('зсув = рівно пів аркуша', !!shift && eq(Number(shift![1]), (148 / 2) * PX_PER_MM), shift?.[1]);
    const handles = nums(a5, /cursor-ew-resize[^>]*style="left:([\d.]+)(?:px)?;transform:translateX\(-50%\)"/g);
    t('ручки на краях аркуша', eq(handles[0], 0) && eq(handles[1], 148 * PX_PER_MM));
  }

  console.log('\nКнига зі зіпсованим форматом не валить рендер:');
  {
    const weird = renderRuler({ sheetWidthMm: 148, textWidthMm: 0, insideMm: 200, outsideMm: 200 });
    t('рендер не порожній', weird.length > 0);
    t('жодного NaN у розмітці', !weird.includes('NaN'));
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
