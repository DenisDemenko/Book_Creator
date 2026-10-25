/**
 * Скрипт запуску DesignCraft проти справжніх маршрутів Студії.
 * Запуск: npm run test:start-script-conveyor
 *
 * Береться САМ `scripts/start-designcraft-studio.ps1`: його функції (обмін коду підключення,
 * отримання чернетки, повернення результату) витягуються з AST PowerShell і виконуються проти
 * піднятого тут Express. Так перевіряється не копія логіки, а саме те, що запускає кнопка.
 * Також перевіряється розбір посилання designcraft-studio:// і список дозволених Студій.
 *
 * Потрібні PowerShell (`pwsh` або `powershell.exe`) і бінарник DesignCraft; без них — пропуск.
 */
const DIR = '/tmp/nova-start-script-conveyor';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
let skipped = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const skip = (n: string, why: string) => {
  skipped++;
  console.log(`  — ${n} — пропущено: ${why}`);
};

function findPowerShell(): string | null {
  for (const candidate of [process.env.PWSH_PATH, 'pwsh', 'powershell.exe', '/tmp/pwsh/pwsh']) {
    if (!candidate) continue;
    const r = spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });
    if (r.status === 0) return candidate;
  }
  return null;
}
const ps = findPowerShell();
const SCRIPT = path.resolve('scripts/start-designcraft-studio.ps1');

/**
 * Асинхронно: Express живе в цьому ж процесі, і синхронний spawn заблокував би його —
 * скрипт бачив би «Студія недоступна».
 */
function runPs(body: string, env: Record<string, string> = {}): Promise<string> {
  const harness = path.join(DIR, `harness-${Math.random().toString(36).slice(2)}.ps1`);
  // BOM — щоб Windows PowerShell 5.1 прочитав кирилицю.
  fs.writeFileSync(harness, '\ufeff' + body, 'utf8');
  return new Promise((resolve) => {
    const child = spawn(ps!, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness], {
      env: { ...process.env, LOCALAPPDATA: process.env.LOCALAPPDATA || DIR, POWERSHELL_TELEMETRY_OPTOUT: '1', ...env },
      // stdin закритий: інакше Read-Host у скрипті («Натисніть Enter») чекав би вічно.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outText = '';
    child.stdout.on('data', (d) => (outText += d.toString('utf8')));
    child.stderr.on('data', (d) => (outText += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(outText);
    });
  });
}

const extract = (names: string[]) => `
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
foreach ($n in @(${names.map((n) => `'${n}'`).join(',')})) {
  $fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true)[0]
  if (-not $fn) { throw "немає функції $n" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
`;

if (!ps) {
  skip('увесь тест', 'PowerShell не знайдено');
} else {
  // ── Посилання designcraft-studio:// ────────────────────────────────────
  console.log('\nПосилання з кнопки Студії');
  const run = async (url: string) => runPs(`& '${SCRIPT.replace(/'/g, "''")}' -Url '${url}' -DesignCraftPath '/nonexistent/designcraft-cli'`);
  const evil = await run('designcraft-studio://open?book=BK-1&studio=https%3A%2F%2Fevil.example%2Fstudio');
  t('чужа адреса Студії відхиляється (токен туди не піде)', /не в списку дозволених/.test(evil), evil.split('\n')[0]);
  const look = await run('designcraft-studio://open?book=B&studio=https%3A%2F%2Fwww.fusionlab.in.ua.evil.com%2Fstudio');
  t('схожа на справжню адреса — теж відхиляється', /не в списку дозволених/.test(look));
  const lh = await run('designcraft-studio://open?book=B&studio=http%3A%2F%2Flocalhost%3A3000.evil.com');
  t('localhost з чужим доменом — відхиляється', /не в списку дозволених/.test(lh));
  const prod = await run('designcraft-studio://open?book=BK-2084-CYBER&studio=https%3A%2F%2Fwww.fusionlab.in.ua%2Fstudio');
  t('хмарна Студія приймається, книга з посилання', /Запуск із Студії: https:\/\/www\.fusionlab\.in\.ua\/studio, книга BK-2084-CYBER/.test(prod), prod.split('\n')[0]);
  const local = await run('designcraft-studio://open?book=BK-1&studio=http%3A%2F%2Flocalhost%3A3000');
  t('локальна Студія приймається', /Запуск із Студії: http:\/\/localhost:3000, книга BK-1/.test(local));
  const badBook = await run('designcraft-studio://open?book=..%2F..%2Fx%20y&studio=http%3A%2F%2Flocalhost%3A3000');
  t('шлях замість id книги — відхиляється', /недопустимий ідентифікатор книги/.test(badBook));
  const notLink = await run('https://example.com/?book=x');
  t('не наше посилання — відхиляється', /це не посилання DesignCraft-Studio/.test(notLink));

  // ── Код → чернетка → повернення ────────────────────────────────────────
  console.log('\nКод підключення → чернетка → повернення результату (функції самого скрипта)');
  const LOCAL_CLI = 'D:/Rama/designcraft/target/release/designcraft-cli.exe';
  const envCli = process.env.DESIGNCRAFT_PATH;
  const cli = envCli && fs.existsSync(envCli) ? envCli : fs.existsSync(LOCAL_CLI) ? LOCAL_CLI : undefined;
  if (cli) process.env.DESIGNCRAFT_PATH = cli;

  const db = await import('../server/db');
  await db.initDb();
  const storeMod = await import('../server/store');
  const bookStore = await import('../server/bookStore');
  const { registerPdfRoutes } = await import('../server/pdfRoutes');
  const external = await import('../server/external/externalApiRoutes');
  const { initialBook } = await import('../src/data/initialBook');
  await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: new Date().toISOString() } as any);
  const book: any = JSON.parse(JSON.stringify(initialBook));
  book.id = 'TEST-SCRIPT-1';
  book.layoutConfig.bookDesignThemeId = 'studio-classic';
  const stored = await bookStore.saveBook({ ownerId: 'u-a', book });

  const app = express();
  app.use(express.json({ limit: '40mb' }));
  app.use((req: any, _r, next) => {
    req.principal = req.headers['x-test-session'] === 'u-a' ? { id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
    next();
  });
  external.registerExternalApiRoutes(app, { recognize: async () => ({ text: '', modelId: 'x' }) });
  registerPdfRoutes(app, { resolveEngine: () => 'claude', loadAdminLayer: async () => ({}) as never, generateText: async () => ({ text: '{}' }) } as any);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const codeRes = await fetch(`${base}/api/external-tokens/pairing-code`, { method: 'POST', headers: { 'x-test-session': 'u-a', 'content-type': 'application/json' }, body: '{}' });
  const { code } = (await codeRes.json()) as any;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dcwork-'));
  const out = await runPs(
    `${extract(['Invoke-PairCode', 'Get-StudioDraft', 'Send-StudioResult'])}
$StudioUrl='${base}'
$chosen=[pscustomobject]@{ id='${stored.id}'; title='x' }
$draftPath='${path.join(work, `${stored.id}.designcraft`)}'
$revisionPath='${path.join(work, `${stored.id}.revision`)}'
$token = Invoke-PairCode '${code}'
"TOKEN_OK=" + ($token -like 'nst_*')
$again = Invoke-PairCode '${code}'
"REUSE_EMPTY=" + (-not $again)
${cli ? `$ok = Get-StudioDraft
"DRAFT_OK=$ok"
"DRAFT_BYTES=" + (Get-Item $draftPath).Length
"REVISION=" + (Get-Content $revisionPath -Raw).Trim()` : '"DRAFT_SKIPPED=1"'}
$pdf = '${path.join(work, 'r.pdf')}'
[System.IO.File]::WriteAllBytes($pdf, [byte[]](@(37,80,68,70,45,49,46,55,10) + @(32) * 2000))
$info = Send-StudioResult $pdf 'designcraft-pdf' '${stored.revision}'
"UPLOAD_STALE=" + $info.stale
`
  );
  t('скрипт обміняв код на токен', /TOKEN_OK=True/.test(out), out.split('\n').find((l) => /TOKEN_OK|Код/.test(l)) || out.slice(0, 200));
  t('повторно той самий код не працює', /REUSE_EMPTY=True/.test(out));
  if (cli) {
    t('скрипт отримав чернетку зі Студії', /DRAFT_OK=True/.test(out) && Number(/DRAFT_BYTES=(\d+)/.exec(out)?.[1]) > 1000, out.match(/DRAFT_[A-Z]+=\S+/g)?.join(' '));
    t('записав ревізію, з якої почалася верстка', new RegExp(`REVISION=${stored.revision}\\b`).test(out));
  } else {
    skip('чернетка зі Студії', 'бінарника DesignCraft немає');
  }
  t('повернув PDF у Студію (не застарілий)', /UPLOAD_STALE=False/.test(out), out.match(/UPLOAD_STALE=\S+/)?.[0] || out.slice(-300));
  const arts = await bookStore.listArtifacts(stored.id);
  t('у книзі з’явився результат DesignCraft', arts.some((a) => a.kind === 'designcraft-pdf' && a.bookRevision === stored.revision));
  server.close();
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало, ${skipped} пропущено.`);
if (fail) process.exit(1);
