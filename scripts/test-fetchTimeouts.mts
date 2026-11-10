/**
 * Охоронний тест: кожен `fetch(` у коді сервера має власний ліміт часу (журнал #538).
 * Запуск: npm run test:fetch-timeouts
 *
 * Навіщо. Без `signal` запит до завислого провайдера чекає на межу undici — 300 с — і потім падає з
 * «fetch failed»: саме так 09.11.2026 розпізнавання сторінок займало 5–6 хвилин (див. visionFailover.ts).
 * Тест не знає, який ліміт «правильний», — він лише не дає додати новий виклик зовсім без нього.
 *
 * Виняток оформлюється коментарем `// fetch-timeout: none — причина` за кілька рядків ПЕРЕД викликом.
 * Єдиний нині — списання коштів PayPal (обрив після проведеного платежу лишив би гроші списаними).
 *
 * Що НЕ перевіряється: виклики через обгортки (`deps.fetch`, `fetchWithRetry`), SDK провайдерів
 * (Gemini, Anthropic) — у них свої механізми; і саме значення ліміту.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Текст виклику `fetch(...)` до закривної дужки (дужки в рядках урівноважені — для нашого коду цього досить). */
function callText(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(openIdx, i + 1);
  }
  return src.slice(openIdx);
}

interface Finding {
  file: string;
  line: number;
  call: string;
}

function unguardedFetches(src: string, file = 'x.ts'): Finding[] {
  const found: Finding[] = [];
  const re = /(^|[^.\w$])fetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const call = callText(src, open);
    if (/signal|timeout/i.test(call)) continue;
    const line = src.slice(0, open).split('\n').length;
    const before = src.slice(0, open).split('\n').slice(-5, -1).join('\n');
    if (/fetch-timeout:\s*none/.test(before)) continue;
    found.push({ file, line, call: call.split(/\s+/).join(' ').slice(0, 90) });
  }
  return found;
}

console.log('\nРозпізнавання в самому тесті');
t('виклик без ліміту знаходиться', unguardedFetches("const r = await fetch('https://x.test/a');").length === 1);
t('виклик із signal — ні', unguardedFetches('await fetch(u, { signal: AbortSignal.timeout(5_000) });').length === 0);
t('виклик із signal у змінній — ні', unguardedFetches("await fetch(u, { method: 'POST', signal: ctrl.signal });").length === 0);
t('чужий метод `.fetch(` та обгортки не рахуються', unguardedFetches('await deps.fetch(u); await refetch(u); await fetchJson(u);').length === 0);
t('коментар «fetch-timeout: none» дозволяє виняток', unguardedFetches("// fetch-timeout: none — причина\nawait fetch(u, { method: 'POST' });").length === 0);
t('виклик на кількох рядках читається цілком', unguardedFetches("await fetch(u, {\n method: 'POST',\n headers: {},\n signal: AbortSignal.timeout(1000),\n});").length === 0);

console.log('\nКод сервера');
const targets = [path.join(ROOT, 'server.ts'), ...files(path.join(ROOT, 'server'))];
const all: Finding[] = [];
for (const f of targets) {
  if (!fs.existsSync(f)) continue;
  all.push(...unguardedFetches(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f).split(path.sep).join('/')));
}
t(`усі fetch( мають ліміт часу (перевірено файлів: ${targets.length})`, all.length === 0, all.slice(0, 6).map((f) => `${f.file}:${f.line} ${f.call}`).join(' | '));

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);
