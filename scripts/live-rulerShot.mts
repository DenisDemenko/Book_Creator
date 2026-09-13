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
      React.createElement(PageRuler, {
        sheetWidthMm: geometry.pageWidthMm,
        textWidthMm: geometry.contentWidthMm,
        insideMm: geometry.margins.insideMm,
        outsideMm: geometry.margins.outsideMm,
        verticalRulerWidthPx: 24,
        onChangeMargins: () => {},
      }),
      React.createElement(
        PageColumn,
        {
          widthMm: geometry.contentWidthMm,
          showVerticalRuler: true,
          pagination: snapshot,
          pageGeometry: geometry,
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
      // Смуга вертикальної лінійки — ПЕРША дитина прокручуваного контейнера
      // (PageColumn.tsx), а не будь-який div із класами лінійки: горизонтальна
      // лінійка теж має `shrink-0 relative select-none` і збиває з пантелику.
      const strip = scroll.firstElementChild as HTMLElement | null;
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
