/**
 * ЖИВИЙ ЗАМІР РОЗКЛАДКИ — та сама книжкова сторінка, намальована в трьох
 * контекстах, і порівняння того, як вона ділиться на сторінки.
 * Запуск: npm run live:layout-probe   (потрібен справжній Chrome)
 *
 * НАВІЩО ВІН Є. Пагінація в цьому застосунку рахується двічі: у живому
 * редакторі (`PaginationPlugin` — вимірює DOM ProseMirror) і у «Розвороті
 * книги» (`useRealBookPages` — рендерить той самий текст у прихований
 * контейнер). Поки ці два місця міряють РІЗНІ речі — різну ширину, різний
 * кегль, різні відступи абзаців — автор бачить одну кількість сторінок у
 * канві й іншу в «Розвороті», і жоден юніт-тест цього не побачить, бо
 * йдеться про справжню розкладку.
 *
 * Що саме перевіряється (контекст A проти B):
 *   • межі кожного блока збігаються (та сама ширина, той самий кегль, ті самі
 *     відступи абзаців — усе з resolveParagraphGeometry);
 *   • розбиття на сторінки збігається.
 * Якщо ні — скрипт падає з ненульовим кодом, тобто це регресійний запобіжник,
 * а не просто звіт.
 *
 * Контекст C (друк, рушій Chromium) міряється ПОРУЧ і не порівнюється: у
 * друці інша гарнітура (DejaVu Serif з образу), увімкнені переноси
 * (`hyphens: auto`) і вирівнювання по формату, тож рядки там лягають інакше.
 * Ця різниця друкується числами, щоб її було видно, а не щоб її приховати.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { initialBook } from '../src/data/initialBook.ts';
import { renderSectionBlocksHtml } from '../src/utils/helpers.ts';
import { computeBreaksFromBounds } from '../src/utils/pageBreaker.ts';
import { resolvePageGeometry } from '../src/utils/pageGeometry.ts';
import { PX_PER_MM } from '../src/utils/mmUnits.ts';
import { bodyFontStack, paragraphCssVars, resolveParagraphGeometry } from '../src/utils/typography.ts';

/** Кандидати на бінарник: спершу змінні оточення, потім типові шляхи. */
const CHROME_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter((p): p is string => !!p);

const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium. Задайте CHROMIUM_PATH.');
  process.exit(2);
}

/** Зібраний CSS застосунку — саме той, що бачить автор у браузері. */
const APP_CSS = (() => {
  const dir = path.resolve('dist/assets');
  if (!fs.existsSync(dir)) throw new Error('Немає dist/ — спершу npm run build');
  const file = fs.readdirSync(dir).find((f) => /^index-.*\.css$/.test(f));
  if (!file) throw new Error('Немає dist/assets/index-*.css — спершу npm run build');
  return fs.readFileSync(path.join(dir, file), 'utf8');
})();

const layout = initialBook.layoutConfig;
const geometry = resolvePageGeometry(layout);
const typography = resolveParagraphGeometry(layout);
const budgetPx = geometry.contentHeightMm * PX_PER_MM;
const widthPx = geometry.contentWidthMm * PX_PER_MM;

/**
 * Синтетичний розділ: 40 абзаців різної довжини, повторювано —
 * щоб той самий текст можна було прогнати кілька разів і порівняти числа.
 */
const WORDS = 'слово памʼять місто архів нейрон код тиша голос книга тінь ранок ріка'.split(' ');
function paragraph(chars: number, seed: number): string {
  let out = '';
  let i = seed;
  while (out.length < chars) {
    out += WORDS[i % WORDS.length] + ' ';
    i += 7;
  }
  return out.trim() + '.';
}
const sectionText = Array.from({ length: 40 }, (_, i) => paragraph(200 + ((i * 37) % 400), i)).join('\n\n');
const blocksHtml = renderSectionBlocksHtml(sectionText, initialBook, [], []);

/** CSS-змінні абзацної геометрії — ті самі, що ставить застосунок. */
const cssVars = Object.entries(paragraphCssVars(typography))
  .map(([name, value]) => `${name}:${value}`)
  .join(';');
const fontStack = bodyFontStack(layout.typography.bodyFont);

interface Measured {
  name: string;
  blocks: number;
  totalHeightPx: number;
  totalHeightMm: number;
  breaks: number[];
  bounds: { top: number; bottom: number }[];
}

async function measure(name: string, bodyHtml: string): Promise<Measured> {
  const browser = await puppeteer.launch({
    executablePath: CHROME as string,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 2400 });
    await page.setContent(
      `<html lang="uk"><head><style>${APP_CSS}</style>
       <script>window.__breaks = ${computeBreaksFromBounds.toString()};</script>
       </head><body style="margin:0;background:#fff">${bodyHtml}</body></html>`,
      { waitUntil: 'load' }
    );
    return await page.evaluate(
      (name, budgetPx, widthMm) => {
        const box = document.getElementById('probe') as HTMLElement;
        box.style.width = `${widthMm}mm`;
        const children = Array.from(box.children) as HTMLElement[];
        const origin = box.getBoundingClientRect().top;
        const bounds = children.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top - origin, bottom: r.bottom - origin };
        });
        const keepWithNext = children.map((el) => getComputedStyle(el).float !== 'none');
        const breaks = (window as any).__breaks(bounds, budgetPx, keepWithNext) as number[];
        return {
          name,
          blocks: children.length,
          totalHeightPx: bounds.at(-1)?.bottom ?? 0,
          totalHeightMm: (bounds.at(-1)?.bottom ?? 0) / (96 / 25.4),
          breaks,
          bounds,
        };
      },
      name,
      budgetPx,
      geometry.contentWidthMm
    );
  } finally {
    await browser.close();
  }
}

function sameNumbers(a: number[], b: number[], eps = 0.02): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
}

async function main() {
  console.log(`Chrome: ${CHROME}`);
  console.log(`Формат: ${geometry.pageWidthMm}×${geometry.pageHeightMm} мм; поля ${geometry.margins.topMm}/${geometry.margins.bottomMm} (верх/низ), ${geometry.margins.insideMm}/${geometry.margins.outsideMm} (корінець/зовні)`);
  console.log(`Текстова зона: ${geometry.contentWidthMm.toFixed(1)}×${geometry.contentHeightMm.toFixed(1)} мм (${widthPx.toFixed(1)}×${budgetPx.toFixed(1)} px)`);
  console.log(`Кегль ${typography.fontSizePt} pt = ${typography.fontSizePx.toFixed(2)} px; інтерліньяж ${typography.lineHeight}; відступ ${typography.firstLineIndentMm} мм; відбивка ${typography.paragraphSpacingMm} мм; ${typography.textAlign}`);
  console.log(`Абзаців у тексті: 40\n`);

  // A. живий редактор: та сама ширина, той самий кегль, той самий клас, що в EditorView.tsx
  const A = await measure(
    'A · живий редактор',
    `<div style="width:${widthPx}px;margin:0;padding:16px 0;box-sizing:border-box">
       <div id="probe" class="ProseMirror nova-manuscript-editor nova-manuscript-blocks"
            style="font-family:${fontStack};font-size:${typography.fontSizePx}px;line-height:${typography.lineHeight};${cssVars}">
         ${blocksHtml}
       </div>
     </div>`
  );

  // B. вимір «Розвороту книги»: рівно те, що ставить useRealBookPages.ts
  const B = await measure(
    'B · вимір «Розвороту книги»',
    `<div id="probe" class="nova-manuscript-blocks"
          style="font-family:${fontStack};font-size:${typography.fontSizePx}px;line-height:${typography.lineHeight};${cssVars}">
       ${blocksHtml}
     </div>`
  );

  // C. друк (рушій Chromium): інша гарнітура, переноси, вирівнювання — для довідки
  const C = await measure(
    'C · друк, рушій Chromium (довідка)',
    `<style>#probe p{margin:0;text-indent:${typography.firstLineIndentMm}mm} #probe h1,#probe h2,#probe h3{margin:1.1em 0 0.5em;line-height:1.25}</style>
     <div id="probe" style="font-family:'DejaVu Serif', Georgia, serif;font-size:${typography.fontSizePt}pt;
          line-height:${typography.lineHeight};hyphens:auto;-webkit-hyphens:auto;text-align:justify">
       ${blocksHtml}
     </div>`
  );

  for (const r of [A, B, C]) {
    console.log(`${r.name}`);
    console.log(`  блоків ${r.blocks}; висота ${r.totalHeightPx.toFixed(1)} px = ${r.totalHeightMm.toFixed(1)} мм`);
    console.log(`  сторінок ${r.breaks.length + 1}; розриви перед блоками: ${JSON.stringify(r.breaks)}`);
  }

  const boundsMatch = sameNumbers(
    A.bounds.map((b) => b.bottom),
    B.bounds.map((b) => b.bottom)
  ) && A.blocks === B.blocks;
  const breaksMatch = sameNumbers(A.breaks, B.breaks);
  const printDiffers = !sameNumbers(A.breaks, C.breaks);
  console.log('\nПорівняння:');
  console.log(`  межі блоків A = B: ${boundsMatch ? 'ТАК' : 'НІ'}`);
  console.log(`  розбиття на сторінки A = B: ${breaksMatch ? 'ТАК' : 'НІ'}`);
  console.log(
    printDiffers
      ? `  друк (C) дає ${C.breaks.length + 1} сторінок проти ${A.breaks.length + 1} на екрані — різниця через гарнітуру, переноси й вирівнювання`
      : `  друк (C) дає ті самі ${C.breaks.length + 1} сторінок, що й екран — ЛОКАЛЬНО гарнітура впала на той самий фолбек (DejaVu Serif не встановлено). У продакшні шрифт інший, тож там числа можуть розійтись`
  );

  if (!boundsMatch || !breaksMatch) {
    console.error('\nРозкладка на екрані й у вимірі розійшлась — це та сама розбіжність, від якої починалась фаза 3.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
