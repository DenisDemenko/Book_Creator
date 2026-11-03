/**
 * Живий прогін автоматичних тегів Jev по книзі (постановка власника
 * 03.11.2026): «візьми в панелі адмінки код Jev і зроби прогонку присвоєння
 * тегів для книги про Архата».
 *
 * ЯК ЦЕЙ СКРИПТ ДІСТАЄ КЛЮЧ. Тим самим ланцюжком, що й Студія
 * (`typesafeJev` у `server.ts`): спершу ключ, який адміністратор ввів у «Ключах
 * API» (зашифрований у базі, розшифровується `USER_API_KEY_SECRET`), потім
 * змінна `JEV_API_KEY`/`TYPESAFE_API_KEY`. Панель ключа НЕ показує — вона лише
 * зберігає його, — тож «взяти з панелі» означає скористатися тим самим кодом,
 * а не прочитати рядок. Ключ живе лише в пам'яті цього процесу: ніде не
 * друкується (ні цілком, ні частинами, ні довжиною), не пишеться у файли й не
 * потрапляє в журнал.
 *
 * ЧОМУ З КОПІЄЮ БАЗИ. `initDb()` на живій базі міг би провести міграції за
 * схемою цієї гілки, а у вашому головному чекауті може бути інша. Копія
 * (`.db`, `-wal`, `-shm`) лягає в тимчасову теку; робочі дані не чіпаються.
 *
 * З `.env` читаються лише чотири імена змінних (див. `ENV_NAMES`): решта —
 * Firebase, пошта тощо — сюди не потрапляє.
 *
 * ПІЛОТ СПЕРШУ. `--pilot N` скануватиме N абзаців, розкиданих по всій книзі, і
 * покаже, скільки це коштує, скільки триває й чи дає Jev ≥95% хоч на чомусь:
 * до цього прогону жодної відповіді справжньої моделі на справжньому тексті не
 * було, і поріг міг виявитись недосяжним. Без `--pilot` скануються всі абзаци.
 *
 * Запуск (з теки репозиторію):
 *   npx tsx scripts/live-jevTagArhat.mts --book <book.json> --out <тека> --pilot 12
 *   npx tsx scripts/live-jevTagArhat.mts --book <book.json> --out <тека>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV_NAMES = ['USER_API_KEY_SECRET', 'JEV_API_KEY', 'TYPESAFE_API_KEY', 'TYPESAFE_JEV_MODEL'] as const;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const bookPath = arg('book');
const outDir = arg('out');
if (!bookPath || !outDir) throw new Error('Треба: --book <book.json> --out <тека> [--pilot N] [--concurrency 4] [--max-cost 2]');
const envFile = arg('env', 'D:/Rama/Book_Creality/.env')!;
const dataSrc = arg('data', 'D:/Rama/Book_Creality/data')!;
const pilot = Number(arg('pilot', '0')) || 0;
const concurrency = Number(arg('concurrency', '4')) || 4;
const maxCost = Number(arg('max-cost', '2')) || 2;
const numberParagraphs = !flag('no-number-paragraphs');
// Поріг рішення. Відповіді моделі в кеші не залежать від нього, тож інший поріг — безкоштовний.
const threshold = Number(arg('threshold', '0.95')) || 0.95;
const suffix = threshold === 0.95 ? '' : `-${Math.round(threshold * 100)}`;

fs.mkdirSync(outDir, { recursive: true });

// ── 1. Оточення: лише потрібні імена, значення ніде не показуються ─────────
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !(ENV_NAMES as readonly string[]).includes(m[1]) || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// ── 2. Копія бази: робочу не чіпаємо ───────────────────────────────────────
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-run-data-'));
let dbCopied = false;
for (const suffix of ['', '-wal', '-shm']) {
  const from = path.join(dataSrc, `nova-studio.db${suffix}`);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(tmpData, `nova-studio.db${suffix}`));
    dbCopied = true;
  }
}
process.env.DATA_DIR = tmpData;

// Динамічні імпорти — ПІСЛЯ виставлення оточення: db.ts читає DATA_DIR на рівні модуля.
const { initDb, closeDb } = await import('../server/db');
const { platformKeyFor } = await import('../server/platformKeys');
const { HttpJevAdapter, jevKeyFromEnv, jevModelFromEnv, jevCostUsd, JEV_MODEL } = await import('../server/ai/adapters/jev');
const { applyAutoTags, listBookParagraphs, scanEntityTypes } = await import('../src/utils/autoTags');
const { JsonlScanCache, runJevFullScan } = await import('../server/core/ai/jevFullScan');

let source = 'немає';
let key: string | undefined;
if (dbCopied) {
  await initDb();
  key = await platformKeyFor('typesafe');
  if (key) source = 'панель адмінки («Ключі API»)';
}
if (!key) {
  key = jevKeyFromEnv();
  if (key) source = 'змінна оточення JEV_API_KEY/TYPESAFE_API_KEY';
}
/*
 * База вже не потрібна: ключ у пам'яті. Закриваємо й видаляємо копію ОДРАЗУ, а
 * не наприкінці: на Windows відкритий файл не видалити, а копія містить
 * користувачів і зашифровані ключі — їй не місце в тимчасовій теці довше, ніж
 * треба.
 */
try {
  closeDb();
} catch {
  /* база могла не відкриватись */
}
try {
  fs.rmSync(tmpData, { recursive: true, force: true });
} catch (err) {
  console.warn(`[jev] УВАГА: не вдалось видалити тимчасову копію бази ${tmpData}: ${(err as Error).message}. Видаліть її вручну.`);
}
console.log(`[jev] ключ: ${source}; модель: ${jevModelFromEnv()}${jevModelFromEnv() === JEV_MODEL ? ' (закріплена)' : ''}`);
if (!key) {
  console.error('[jev] ключа немає ні в панелі, ні в оточенні — прогін неможливий.');
  process.exit(2);
}
const adapter = new HttpJevAdapter(key, { model: jevModelFromEnv(), timeoutMs: 60_000 });
key = undefined; // далі ключ живе лише всередині адаптера

// ── 3. Книга й абзаци ──────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
const book = raw.book || raw;
const all = listBookParagraphs(book);
const types = scanEntityTypes().map((t) => ({ slug: t.slug, nameUk: t.nameUk }));
console.log(`[jev] книга «${book.title}»: ${all.length} текстових абзаців, ${types.length} типів сутностей`);

let sample = all;
if (pilot > 0) {
  // Розкид по всій книзі, а не перші N: початок книги не показовий для решти.
  const step = Math.max(1, Math.floor(all.length / pilot));
  sample = Array.from({ length: pilot }, (_, i) => all[Math.min(all.length - 1, i * step + Math.floor(step / 2))]);
  const lens = sample.map((p) => p.text.length);
  console.log(`[jev] ПІЛОТ: ${sample.length} абзаців, довжина ${Math.min(...lens)}–${Math.max(...lens)} знаків, у середньому ${Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)}`);
}

const cache = new JsonlScanCache(path.join(outDir, 'scan-cache.jsonl'));
console.log(`[jev] у кеші вже ${cache.size} абзаців (їх повторно не оплачуємо)`);

// ── 4. Сканування ──────────────────────────────────────────────────────────
const ac = new AbortController();
const started = Date.now();
let lastLog = 0;
const result = await runJevFullScan(
  sample.map((p) => ({ id: String(p.n), text: p.text, key: p.key })),
  types,
  adapter,
  {
    concurrency,
    threshold,
    cache,
    signal: ac.signal,
    onProgress: (done, total, s) => {
      const cost = jevCostUsd(s.inputTokens);
      if (cost > maxCost && !ac.signal.aborted) {
        console.error(`[jev] ЗУПИНКА: витрати $${cost.toFixed(2)} перевищили запобіжник $${maxCost}. Кеш збережено, можна продовжити.`);
        ac.abort();
      }
      const now = Date.now();
      if (now - lastLog < 15_000 && done < total) return;
      lastLog = now;
      const elapsed = (now - started) / 1000;
      const left = done ? Math.round((elapsed / done) * (total - done)) : 0;
      console.log(`[jev] ${done}/${total} абзаців, запитів ${s.requests}, повторів ${s.retries}, збоїв ${s.failed.length}, $${cost.toFixed(3)}, ${Math.round(elapsed)}с, лишилось ≈${left}с`);
    },
  }
);

// ── 5. Звіт ────────────────────────────────────────────────────────────────
const s = result.stats;
const seconds = (Date.now() - started) / 1000;
const cost = jevCostUsd(s.inputTokens);
const counts = [...result.accepted.values()].map((a) => a.length);
const histogram = Array.from({ length: 10 }, () => 0);
let answers = 0;
let nulls = 0;
for (const probs of result.probabilities.values()) {
  for (const v of Object.values(probs)) {
    if (v == null) nulls += 1;
    else {
      answers += 1;
      histogram[Math.min(9, Math.floor(v * 10))] += 1;
    }
  }
}
const typeHits = new Map<string, number>();
for (const slugs of result.accepted.values()) for (const slug of slugs) typeHits.set(slug, (typeHits.get(slug) ?? 0) + 1);
const topTypes = [...typeHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
const scanned = sample.length - s.failed.length;

const report = {
  mode: pilot ? `pilot:${pilot}` : 'full',
  keySource: source,
  paragraphs: { total: all.length, scanned: sample.length, failed: s.failed.length, fromCache: s.fromCache },
  requests: s.requests,
  retries: s.retries,
  inputTokens: s.inputTokens,
  costUsd: cost,
  seconds: Math.round(seconds),
  tagsPerParagraph: counts.length
    ? { min: Math.min(...counts), max: Math.max(...counts), avg: Number((counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2)), withoutAny: counts.filter((c) => c === 0).length }
    : null,
  probabilityHistogram: histogram,
  answered: answers,
  unanswered: nulls,
  topTypes,
  extrapolationForWholeBook:
    pilot && scanned
      ? {
          paragraphs: all.length,
          costUsd: Number(((cost / Math.max(1, s.fromCache ? scanned - s.fromCache : scanned)) * all.length).toFixed(2)),
          minutes: Math.round(((seconds / Math.max(1, scanned)) * all.length) / 60),
        }
      : null,
  failed: s.failed.slice(0, 20),
};
fs.writeFileSync(path.join(outDir, pilot ? 'pilot-report.json' : `report${suffix}.json`), JSON.stringify(report, null, 2));
console.log('\n[jev] ЗВІТ');
console.log(JSON.stringify(report, null, 2));

if (pilot) {
  console.log('\n[jev] що Jev сказав по кожному абзацу пілоту (типи ≥95%):');
  for (const p of sample) {
    const d = result.decisions.get(String(p.n)) ?? [];
    const top = d
      .filter((x) => x.probability !== null)
      .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
      .slice(0, 6)
      .map((x) => `${x.entitySlug}=${(x.probability! * 100).toFixed(1)}%${x.accepted ? '✓' : ''}`);
    console.log(`  №${p.n} (${p.text.length} зн.) «${p.text.replace(/\s+/g, ' ').slice(0, 70)}…»\n      ${top.join('  ')}`);
  }
  console.log('\n[jev] пілот завершено, книга не змінювалась.');
} else {
  // Типи з рішень → теги в книзі з нумерацією.
  const picks = sample.map((p) => ({ n: p.n, slugs: result.accepted.get(String(p.n)) ?? [] }));
  const applied = applyAutoTags(book, picks, { numberParagraphs });
  // Книга з номерами абзаців — це книга, де редактор мусить їх вести далі.
  if (numberParagraphs) applied.book.layoutConfig = { ...(applied.book.layoutConfig ?? {}), autoParagraphNumbers: true };
  fs.writeFileSync(path.join(outDir, `tagged-book${suffix}.json`), JSON.stringify(applied.book));
  const summary = {
    tagsPlaced: applied.tagsPlaced,
    paragraphsTagged: applied.paragraphsTagged,
    paragraphsNumbered: applied.paragraphsNumbered,
    skippedByLimit: applied.skippedByLimit,
    byType: applied.byType,
    counters: applied.counters,
  };
  fs.writeFileSync(path.join(outDir, `apply-summary${suffix}.json`), JSON.stringify({ threshold, ...summary }, null, 2));
  console.log('\n[jev] ТЕГИ В КНИЗІ');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n[jev] книгу з тегами записано: ${path.join(outDir, `tagged-book${suffix}.json`)}`);
}

process.exit(s.failed.length && !pilot ? 1 : 0);
