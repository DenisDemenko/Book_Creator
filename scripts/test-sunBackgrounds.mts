/**
 * Тести фото-фону студії (StudioBackdrop + BlocksOpacityContext).
 * Запуск: npm run test:sun-backgrounds
 *
 * Що тут стережеться — не зовнішній вигляд фону (його видно тільки очима),
 * а чотири тихі способи зламати вимогу власника, жоден з яких не дасть
 * помилки в консолі:
 *   1) колір сонечка без своєї фотографії — тоді фон підмінявся б типовим
 *      і «фон за назвою кольору» переставав бути правдою (саме цього не
 *      ловить жоден тип: SUN_BACKGROUNDS — це Record<string, string>);
 *   2) файл є, але порожній/битий (обірване перекодування) — браузер
 *      покаже порожній кадр замість фото;
 *   3) тривалість переходу з'їхала з 7 секунд;
 *   4) типові 75% і діапазон повзунка 0–100% змінилися.
 *
 * Сам компонент фону тест НЕ імпортує: він тягне .webp-асети, а tsx (Node)
 * їх не вміє — тому перевірки по ньому йдуть читанням джерельних текстів
 * (той самий прийом, що в test-expressTracks.mts і test-journal.mts).
 */
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SUN_12_COLORS } from '../src/context/SunLightingContext.tsx';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const assetPath = (id: string) => new URL(`../src/assets/backgrounds/${id}.webp`, import.meta.url);

const ids = SUN_12_COLORS.map((c) => c.id);

console.log('\nКольори сонечка мають свою фотографію:');
{
  t('кольорів рівно 12', ids.length === 12, `їх ${ids.length}`);
  t('усі id унікальні', new Set(ids).size === 12);

  for (const id of ids) {
    const url = assetPath(id);
    if (!existsSync(url)) {
      t(`${id}: файл src/assets/backgrounds/${id}.webp`, false, 'немає файлу');
      continue;
    }
    const st = statSync(url);
    const buf = readFileSync(url);
    const isWebp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    // 20 КБ — з великим запасом: найменша з фотографій власника важить 109 КБ.
    const ok = isWebp && st.size > 20 * 1024;
    t(
      `${id}: справжній WebP, не порожній (${Math.round(st.size / 1024)} КБ)`,
      ok,
      isWebp ? 'файл замалий — перекодування обірвалось' : 'не RIFF/WEBP'
    );
  }
}

console.log('\nТека фонів без сторонніх файлів:');
{
  const dir = fileURLToPath(new URL('../src/assets/backgrounds/', import.meta.url));
  const files = readdirSync(dir).sort();
  const expected = ids.map((id) => `${id}.webp`).sort();
  t('у теці рівно 12 файлів — по одному на колір',
    files.length === expected.length, `їх ${files.length}: ${files.join(', ')}`);
  t('зайвих файлів немає (бекапи з «~», дублі, чужі формати)',
    files.every((f) => expected.includes(f)),
    files.filter((f) => !expected.includes(f)).join(', '));

  // Межа розміру — не смак, а захист від реального випадку 01.10.2026:
  // сторонній процес (не скрипт репозиторію) перезаписав частину файлів
  // LOSSLESS-кодеком, лишивши поруч копію з «~», і кожен такий файл
  // виріс у 5–6 разів (200 КБ → 1.4 МБ, 379 КБ → 1.9 МБ). Оригінали
  // власника у WebP 0.82 важать 109–379 КБ, тож 600 КБ лишає запас
  // на майбутні знімки й ловить саме це.
  const tooBig = files
    .map((f) => ({ f, kb: Math.round(statSync(path.join(dir, f)).size / 1024) }))
    .filter((x) => x.kb > 600);
  t('жоден фон не «роздувся» (менше 600 КБ)', tooBig.length === 0,
    tooBig.map((x) => `${x.f} ${x.kb} КБ`).join(', '));
}

console.log('\nРеєстр фонів (src/data/sunBackgrounds.ts):');
{
  const src = read('src/data/sunBackgrounds.ts');
  const imports = [...src.matchAll(/import\s+(\w+)\s+from\s+'\.\.\/assets\/backgrounds\/(\w+)\.webp'/g)];
  const importedNames = imports.map((m) => m[1]);
  const importedFiles = imports.map((m) => m[2]);

  t('кожен колір має імпорт фото', ids.every((id) => importedFiles.includes(id)),
    `імпортів ${imports.length}`);
  t('зайвих імпортів немає', importedFiles.every((f) => ids.includes(f)),
    importedFiles.filter((f) => !ids.includes(f)).join(', '));
  t('змінна імпорту названа так само, як файл',
    imports.every((m) => m[1] === m[2]));

  const mapBody = src.match(/SUN_BACKGROUNDS:[^=]*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  t('усі імпортовані фони перелічені в SUN_BACKGROUNDS',
    importedNames.every((name) => new RegExp(`\\b${name}\\b`).test(mapBody)),
    importedNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(mapBody)).join(', '));
  t('є типовий фон для невідомого id',
    /DEFAULT_SUN_BACKGROUND\s*=\s*\w+/.test(src) && /function sunBackgroundFor/.test(src));
}

console.log('\nПлавна зміна за 7 секунд (StudioBackdrop.tsx):');
{
  const src = read('src/components/StudioBackdrop.tsx');
  t('тривалість переходу — рівно 7000 мс',
    /BACKGROUND_FADE_MS\s*=\s*7000\b/.test(src));
  t('два шари (гасіння й загорання, без блимання)',
    /type Slots = \[string, string\]/.test(src));
  t('перехід опитує систему про «зменшити рух»',
    /prefers-reduced-motion/.test(src));
  // Доти тут стояло `img.onload = swap`. Тепер завантаження ще й перевіряють
  // на `naturalWidth` (200-HTML замість картинки теж викликає onload-подібну
  // «успішну» відповідь), тож умова сильніша: перемикання — тільки всередині
  // onload і тільки для справжнього зображення.
  t('новий фон загорається лише після завантаження',
    /img\.onload\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,160}?return swap\(\)/.test(src));
  t('фон не перехоплює кліки (pointer-events: none у CSS)',
    /\.studio-backdrop\s*\{[^}]*pointer-events:\s*none/.test(read('src/index.css')));
}

console.log('\nПрозорість блоків (BlocksOpacityContext + повзунок):');
{
  const ctx = read('src/context/BlocksOpacityContext.tsx');
  const glow = read('src/components/GlowIntensityControl.tsx');
  const css = read('src/index.css');

  t('типові 75%', /BLOCKS_OPACITY_DEFAULT\s*=\s*0\.75\b/.test(ctx));
  t('значення їде в CSS-змінну --ui-blocks-opacity',
    /--ui-blocks-opacity/.test(ctx) && /--ui-blocks-opacity/.test(css));
  t('правило діє на блоки, але не на фон і не на рятівну пігулку',
    /\.app-shell-root\s*>\s*:not\(\.studio-backdrop\):not\(\.ui-opacity-exempt\)/.test(css));
  t('є фолбек 0.75 у самому CSS-правилі (до першого рендера)',
    /var\(--ui-blocks-opacity,\s*0\.75\)/.test(css));
  t('рятівна пігулка нижче порога (щоб повзунок на мінімумі не замикав UI)',
    /BLOCKS_OPACITY_RESCUE_BELOW\s*=\s*0\.2\b/.test(ctx) && /ui-opacity-exempt/.test(ctx));
  t('мінімум повзунка — 5%, а не 0%',
    /BLOCKS_OPACITY_MIN\s*=\s*0\.05\b/.test(ctx) &&
    /clampBlocks/.test(ctx) &&
    /Math\.max\(BLOCKS_OPACITY_MIN/.test(ctx));
  t('повзунок у блоці «Сяйво та аура», діапазон від 5 до 100',
    /id="blocks-opacity-slider"/.test(glow) &&
    /min=\{Math\.round\(BLOCKS_OPACITY_MIN \* 100\)\}[\s\S]{0,80}max=\{100\}/.test(glow));
  t('збережене значення теж затискається до межі (а не скидається)',
    /n >= 0 && n <= 1\) return clampBlocks\(n\)/.test(ctx));

  // Накладання фону — окремий баг власника (05.10.2026): з `z-index: 0`
  // фото (позиційоване) малювалося ПІСЛЯ звичайних блоків у потоці й
  // закривало всю центральну частину студії, а видно лишались тільки
  // позиційовані блоки (сайдбар, шапка). На 100% «Блоки» це виглядало як
  // «блоки зникли» — тому тут стежимо, щоб фон лежав ПІД блоками.
  t('фото-фон лежить ПІД блоками (z-index: -1)',
    /\.studio-backdrop\s*\{[^}]*z-index:\s*-1/.test(css));
  t('шкаралупа — контекст накладання (інакше -1 просідає під її тло)',
    /\.app-shell-root\s*\{[^}]*isolation:\s*isolate/.test(css));
}

console.log('\nФон підключено до студії (App.tsx):');
{
  const app = read('src/App.tsx');
  t('StudioBackdrop стоїть першим у шкаралупі',
    /app-shell-root[^>]*>\s*\{?[\s\S]{0,400}?<StudioBackdrop\s*\/>/.test(app));
  t('блоки студії обгорнуто в BlocksOpacityProvider',
    /<BlocksOpacityProvider>/.test(app) && /<\/BlocksOpacityProvider>/.test(app));
  t('модалки лишились ПОЗА прозорістю (закриття після робочої області)',
    app.indexOf('</BlocksOpacityProvider>') < app.indexOf('<VersionSnapshotModal'));
}

// Ассет, якого немає, і SPA-фолбек — окрема історія (05.10.2026). Сервер
// віддавав index.html із кодом 200 на будь-який неіснуючий шлях, тож
// `/assets/фото.webp`, якого немає, приходив як «успішна» HTML-відповідь:
// у мережі — 200, у консолі — тиша, <img> не декодується — і фон студії
// тихо перестає мінятися. Тепер файли отримують справжній 404, а сам фон
// перевіряє, що прийшло зображення, і раз обходить кеш.
console.log('\nАссет, якого немає, отримує 404, а фон це помічає:');
{
  const server = read('server.ts');
  const backdrop = read('src/components/StudioBackdrop.tsx');

  t('сервер відрізняє файл від сторінки',
    /looksLikeFile/.test(server) && /startsWith\('\/assets\/'\)/.test(server));
  t('і віддає саме 404, а не index.html із кодом 200',
    /res\.status\(404\)\.type\('text\/plain'\)/.test(server));
  t('фолбек на index.html лишився лише для сторінок',
    /sendFile\(path\.join\(distPath, 'index\.html'\)\)/.test(server));
  t('фон перевіряє, що прийшло зображення (naturalWidth)',
    /naturalWidth\s*>\s*0/.test(backdrop));
  t('і один раз повторює з обходом кеша',
    /backdrop-retry/.test(backdrop) && /let retried = false/.test(backdrop));
  t('після невдалого повтору лишає попередній фон, а не чистий екран',
    /фон не завантажився/.test(backdrop));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} Разом: ${pass} успішних, ${fail} невдалих\n`);
process.exit(fail === 0 ? 0 : 1);
