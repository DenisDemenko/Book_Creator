/**
 * ЖИВИЙ ЗНІМОК ЛІНІЙОК — обидві лінійки, намальовані справжнім Chrome із
 * справжнім CSS застосунку. Запуск: npm run live:ruler-shot
 *
 * НАВІЩО. Лінійки — це чиста геометрія плюс CSS, і всі попередні записи
 * (#162–#165) перевіряли їх числами та розміткою, але жодного разу НЕ
 * дивились на них. Тут компоненти рендеряться в HTML (`renderToStaticMarkup`,
 * тож ефектів немає й масштаб дорівнює 1), збираються у сторінку зі зібраним
 * `dist/assets/index-*.css` і фотографуються. Це не замінює перевірку в живому
 * редакторі, але показує, як лінійки виглядають насправді.
 *
 * Смуга вертикальної лінійки у SSR має висоту 0 (вона рахується від висоти
 * вмісту, а вмісту тут немає) — тому перед знімком її висота виставляється
 * вручну, як у справжньому редакторі на довгому розділі.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from '../src/i18n/LanguageContext.tsx';
import { PageColumn } from '../src/components/manuscriptEditor/PageColumn.tsx';
import { PageRuler } from '../src/components/manuscriptEditor/PageRuler.tsx';
import { buildPaginationSnapshot } from '../src/utils/pageBreaker.ts';
import { resolvePageGeometry } from '../src/utils/pageGeometry.ts';
import { resolveParagraphGeometry } from '../src/utils/typography.ts';
import { PX_PER_MM } from '../src/utils/mmUnits.ts';
import { initialBook } from '../src/data/initialBook.ts';

const CHROME = [
  process.env.CHROMIUM_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p): p is string => !!p && fs.existsSync(p));
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium. Задайте CHROMIUM_PATH.');
  process.exit(2);
}

const layout = initialBook.layoutConfig;
const geometry = resolvePageGeometry(layout);
const typography = resolveParagraphGeometry(layout);
const budgetPx = geometry.contentHeightMm * PX_PER_MM;
const typographyVars = {
  fontFamily: "'Literata', 'Cormorant Garamond', Georgia, serif",
  fontSize: `${typography.fontSizePx}px`,
  lineHeight: typography.lineHeight,
  '--para-indent': `${typography.firstLineIndentMm}mm`,
  '--para-gap': `${typography.paragraphSpacingMm}mm`,
  '--para-align': typography.textAlign,
} as React.CSSProperties;

/** Чотири сторінки: три повні й одна переповнена (щоб було видно прапорець). */
const snapshot = buildPaginationSnapshot(
  [
    { top: 46, bottom: 46 + budgetPx },
    { top: 46 + budgetPx + 15, bottom: 46 + 2 * budgetPx + 15 },
    { top: 46 + 2 * (budgetPx + 15), bottom: 46 + 3 * budgetPx + 30 },
    { top: 46 + 3 * (budgetPx + 15), bottom: 46 + 3 * budgetPx + 30 + budgetPx * 2 },
  ],
  [1, 2, 3],
  budgetPx
);

const paragraph = (n: number) =>
  React.createElement(
    'p',
    { key: n },
    `Абзац ${n}. ` + 'Слово памʼять місто архів нейрон код тиша голос книга тінь ранок ріка. '.repeat(2)
  );

const markup = renderToStaticMarkup(
  React.createElement(
    LanguageProvider,
    null,
    React.createElement(
      'div',
      { style: { width: `${geometry.contentWidthMm * PX_PER_MM}px` } as React.CSSProperties },
      React.createElement(
        PageColumn,
        {
          widthMm: geometry.contentWidthMm,
          showVerticalRuler: true,
          pagination: snapshot,
          pageGeometry: geometry,
          // Лінійка тепер ВЛАСТИВІСТЬ колонки, а не сусідній блок: тільки так
          // вони ділять один прокручуваний контейнер і один масштаб.
          ruler: React.createElement(PageRuler, {
            sheetWidthMm: geometry.pageWidthMm,
            textWidthMm: geometry.contentWidthMm,
            insideMm: geometry.margins.insideMm,
            outsideMm: geometry.margins.outsideMm,
            verticalRulerWidthPx: 24,
            onChangeMargins: () => {},
          }),
          children: React.createElement(
            'div',
            { className: 'nova-manuscript-blocks', style: typographyVars },
            Array.from({ length: 13 }, (_, i) => paragraph(i + 1))
          ),
        }
      )
    )
  )
);

const appCss = (() => {
  const dir = path.resolve('dist/assets');
  const file = fs.readdirSync(dir).find((f) => /^index-.*\.css$/.test(f));
  if (!file) throw new Error('Немає dist/assets/index-*.css — спершу npm run build');
  return fs.readFileSync(path.join(dir, file), 'utf8');
})();

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME as string,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 2 });
    await page.setContent(
      `<html lang="uk"><head><style>${appCss}</style>
       <style>
         body { margin: 0; background: #eef2f7; }
         .shot { padding: 12px; }
       </style></head>
       <body><div class="shot" id="shot">${markup}</div></body></html>`,
      { waitUntil: 'load' }
    );
    // Смуга вертикальної лінійки у SSR має висоту 0 — виставляємо як у редакторі.
    const info = await page.evaluate(() => {
      const scroll = document.querySelector('div.overflow-y-auto') as HTMLElement | null;
      if (!scroll) return { zones: [] as { top: string; height: string; background: string }[], ticks: 0 };
      scroll.style.height = '920px';
      // Структура PageColumn — ДВА ряди: [лінійка][рядок зі смугою й текстом].
      // Смуга вертикальної лінійки — це `sticky left-0` у другому ряді
      // (перший ряд — сама горизонтальна лінійка, теж `shrink-0 select-none`,
      // тож селектор по класах лінійки брав би не те).
      const strip = scroll.querySelector('div.sticky.left-0') as HTMLElement | null;
      if (strip) strip.style.height = '920px';
      const zones = strip
        ? Array.from(strip.children).map((el) => {
            const s = (el as HTMLElement).style;
            return { top: s.top, height: s.height, background: s.backgroundColor };
          })
        : [];
      return { zones, ticks: strip ? strip.querySelectorAll('span').length : 0 };
    });
    console.log('Зони вертикальної лінійки (живий DOM):');
    for (const z of info.zones) console.log(`  top ${z.top}, висота ${z.height}, тло ${z.background}`);
    console.log(`  цифр у зонах: ${info.ticks}`);

    // ГОЛОВНА ПЕРЕВІРКА ФАЗИ 1: світла зона тексту на лінійці має стояти РІВНО
    // над колонкою тексту. Раніше це було неможливо перевірити (лінійка й
    // колонка міряли різні контейнери) — тепер вони в одному, і це видно
    // числами просто у браузері.
    const align = await page.evaluate(() => {
      // Шукаємо за ВЛАСТИВІСТЮ `transformOrigin`, а не атрибутним селектором
      // `[style*="transform-origin: top left"]`: серіалізація інлайн-стилю
      // різна залежно від того, хто її писав (SSR React ставить
      // `transform-origin:top left` без пробілу, CSSOM — `: `). Селектор з
      // пробілом тихо не знаходив нічого, і звірка падала замість того, щоб
      // міряти.
      // CSSOM віддає нормалізований порядок (`left top`, `center top`), а не
      // той, що писали в коді (`top left`) — тому ключ зрівнюємо через
      // сортування слів. Навмисно БЕЗ окремої функції-помічника: esbuild для
      // іменованих функцій у `page.evaluate` дописує хелпер `__name`, якого
      // в пісочниці браузера немає («__name is not defined»).
      const entries = Array.from(document.querySelectorAll('div')).map((el) => ({
        el: el as HTMLElement,
        key: (el as HTMLElement).style.transformOrigin.split(' ').sort().join(' '),
      }));
      const sheet = entries.find((e) => e.key === 'left top')?.el ?? null;
      const column = entries.find((e) => e.key === 'center top')?.el ?? null;
      // Діагностика: якщо звірка не склалась, треба бачити, що саме не
      // знайшлось, а не лише «не вдалося».
      const diag = {
        divs: entries.length,
        origins: entries.map((e) => e.key).filter(Boolean),
        sheets: entries.filter((e) => e.key === 'left top').length,
        columns: entries.filter((e) => e.key === 'center top').length,
        backgrounds: sheet ? Array.from(sheet.children).map((el) => (el as HTMLElement).style.background) : [],
      };
      if (!sheet || !column) return { fail: 'немає аркуша або колонки', diag };
      const band = Array.from(sheet.children).find(
        (el) => (el as HTMLElement).style.background.includes('255, 254, 252')
      ) as HTMLElement | undefined;
      if (!band) return { fail: 'в аркуші немає текстової смуги', diag };
      const b = band.getBoundingClientRect();
      const c = column.getBoundingClientRect();
      return { bandLeft: b.left, bandRight: b.right, colLeft: c.left, colRight: c.right, diag };
    });
    if (align && 'fail' in align) {
      console.log(`Не вдалося знайти смугу/колонку для звірки: ${align.fail}`);
      console.log(`  ${JSON.stringify(align.diag)}`);
      process.exitCode = 1;
    } else if (align) {
      const dLeft = Math.abs(align.bandLeft - align.colLeft);
      const dRight = Math.abs(align.bandRight - align.colRight);
      console.log(`Зона тексту на лінійці проти колонки: ліва межа ±${dLeft.toFixed(2)} px, права ±${dRight.toFixed(2)} px`);
      console.log(dLeft < 1 && dRight < 1 ? '  ЗБІГАЄТЬСЯ' : '  РОЗІЙШЛАСЬ — це помилка');
      if (dLeft >= 1 || dRight >= 1) process.exitCode = 1;
    } else {
      console.log('Не вдалося знайти смугу/колонку для звірки');
      process.exitCode = 1;
    }

    const out = path.resolve('tmp/ruler-shot.png');
    const columnEl = await page.$('div.overflow-y-auto');
    await (columnEl ?? page).screenshot({ path: out });
    console.log(`Знімок лінійки й колонки: ${out}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
