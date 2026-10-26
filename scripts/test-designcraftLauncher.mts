/**
 * Інсталятор запуску DesignCraft, який віддає Студія (ZIP зі скриптами).
 * Запуск: npm run test:designcraft-launcher
 *
 * Перевіряється те, що отримає користувач ХМАРНОЇ Студії, у якого немає репозиторію: архів повний і не
 * залежить від проєкту (MCP Студії одним файлом без tsx), маршрут віддає його, скрипт запуску вміє жити
 * поза репозиторієм і сам знаходить/запам'ятовує DesignCraft. PowerShell потрібен для частини перевірок.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import express from 'express';
import JSZip from 'jszip';
import { buildLauncherZip, LAUNCHER_SCRIPT_FILES, registerDesigncraftLauncherRoutes } from '../server/designcraftLauncher';

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-launcher-'));

console.log('\nАрхів');
const zipBuf = await buildLauncherZip();
const zip = await JSZip.loadAsync(zipBuf);
const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
t('усі скрипти запуску в архіві', LAUNCHER_SCRIPT_FILES.every((n) => names.includes(n)), names.join(', '));
t('є MCP Студії одним файлом і інструкція', names.includes('studio-mcp.mjs') && names.includes('ПРОЧИТАЙ.txt'));
t('інструкція згадує режим без Claude Code', /Відкрити лише DesignCraft/.test(await zip.file('ПРОЧИТАЙ.txt')!.async('string')));
const eol = (b: Buffer) => b.toString('utf8').replace(/\r\n/g, '\n');
t('скрипти ті самі, що в репозиторії (з точністю до кінців рядків)', (await Promise.all(LAUNCHER_SCRIPT_FILES.map(async (n) => eol(await zip.file(n)!.async('nodebuffer')) === eol(fs.readFileSync(path.join('scripts', n)))))).every(Boolean));
t('.cmd в архіві мають CRLF (cmd.exe)', (await Promise.all(LAUNCHER_SCRIPT_FILES.filter((n) => n.endsWith('.cmd')).map(async (n) => { const x = (await zip.file(n)!.async('string')); return x.includes('\r\n') && !/[^\r]\n/.test(x); }))).every(Boolean));
const mcp = await zip.file('studio-mcp.mjs')!.async('string');
t('MCP не посилається на файли репозиторію', !/from ['"]\.\.?\//.test(mcp) && !/require\(['"]\.\.?\//.test(mcp));
t('жодного base64-блоку (антивірус не любить, автор має змогу прочитати)', !/[A-Za-z0-9+\/]{400,}={0,2}/.test(await zip.file('start-designcraft-studio.ps1')!.async('string')));
t('.ps1 мають BOM (Windows PowerShell 5.1 читає кирилицю)', (await Promise.all(['install-designcraft-studio.ps1', 'start-designcraft-studio.ps1', 'install-designcraft-link.ps1'].map(async (n) => (await zip.file(n)!.async('nodebuffer')).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))))).every(Boolean));

console.log('\nШрифти шаблонів');
const fontNames = names.filter((n) => /^fonts\/.+\.ttf$/i.test(n));
t('в архіві 12 шрифтів DejaVu й ліцензія', fontNames.length === 12 && names.includes('fonts/LICENSE-DejaVu.txt') && fontNames.every((n) => /DejaVu(Sans|Serif|SansMono)/.test(n)), `${fontNames.length}`);
t('усі шрифти — справжні TrueType (не пошкоджені)', (await Promise.all(fontNames.map(async (n) => { const b = await zip.file(n)!.async('nodebuffer'); return b.length > 50_000 && b.readUInt32BE(0) === 0x00010000; }))).every(Boolean));
t('шрифти в архіві збігаються з репозиторієм', (await Promise.all(fontNames.map(async (n) => (await zip.file(n)!.async('nodebuffer')).equals(fs.readFileSync(path.join('scripts', 'designcraft-fonts', n.slice(6))))))).every(Boolean));
const fontsUsed = fs.readFileSync('server/pdf/designcraft/themes.ts', 'utf8');
t('шаблони Студії використовують лише гарнітури, які ми постачаємо', /DejaVu/.test(fontsUsed) && !/'(Times New Roman|Arial|Calibri|Georgia)'/.test(fontsUsed));

console.log('\nMCP Студії з архіву запускається без репозиторію (лише node)');
const unpack = path.join(TMP, 'unpacked');
fs.mkdirSync(unpack, { recursive: true });
for (const n of names) { fs.mkdirSync(path.dirname(path.join(unpack, n)), { recursive: true }); fs.writeFileSync(path.join(unpack, n), await zip.file(n)!.async('nodebuffer')); }
const noToken = spawnSync(process.execPath, [path.join(unpack, 'studio-mcp.mjs')], { encoding: 'utf8', env: { ...process.env, NOVA_STUDIO_TOKEN: '' }, cwd: TMP });
t('без токена — зрозуміла відмова', noToken.status === 2 && /NOVA_STUDIO_TOKEN/.test(noToken.stderr), `код ${noToken.status}`);
const init = await new Promise<string>((resolve) => {
  const child = spawn(process.execPath, [path.join(unpack, 'studio-mcp.mjs')], { env: { ...process.env, NOVA_STUDIO_TOKEN: 'nst_test', NOVA_STUDIO_URL: 'http://127.0.0.1:1' }, cwd: TMP, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString();
    if (out.includes('\n')) {
      child.kill();
      resolve(out);
    }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
  setTimeout(() => { child.kill(); resolve(out); }, 15000);
});
t('відповідає на initialize', /"id":1/.test(init) && /"result"/.test(init), init.slice(0, 120));

console.log('\nМаршрут Студії');
const app = express();
registerDesigncraftLauncherRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const res = await fetch(`${base}/api/designcraft/launcher.zip`);
const body = Buffer.from(await res.arrayBuffer());
t('200, ZIP, як завантаження', res.status === 200 && res.headers.get('content-type') === 'application/zip' && /attachment; filename="designcraft-studio-launcher\.zip"/.test(res.headers.get('content-disposition') || ''), `${res.status}`);
const served = await JSZip.loadAsync(body);
t('віддає той самий склад', Object.keys(served.files).filter((n) => !served.files[n].dir).sort().join() === names.slice().sort().join());
server.close();

const ps = ['pwsh', '/tmp/pwsh/pwsh', 'powershell.exe'].find((c) => spawnSync(c, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);
if (!ps) {
  skip('перевірки скриптів PowerShell', 'PowerShell не знайдено');
} else {
  const runPs = (args: string[], env: Record<string, string>): Promise<string> =>
    new Promise((resolve) => {
      const child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
        env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString('utf8')));
      child.stderr.on('data', (d) => (out += d.toString('utf8')));
      const timer = setTimeout(() => child.kill(), 90_000);
      child.on('close', () => { clearTimeout(timer); resolve(out); });
    });

  console.log('\nУстановка');
  const lone = path.join(TMP, 'lone');
  fs.mkdirSync(lone);
  fs.copyFileSync(path.join(unpack, 'install-designcraft-studio.ps1'), path.join(lone, 'install-designcraft-studio.ps1'));
  const loneOut = await runPs(['-File', path.join(lone, 'install-designcraft-studio.ps1')], { LOCALAPPDATA: path.join(TMP, 'la1'), DESIGNCRAFT_LINK_DRY_RUN: '1' });
  t('запуск прямо з архіву (без решти файлів) — підказка розпакувати', /розпакуйте архів/i.test(loneOut), loneOut.trim().split('\n').pop());
  const la2 = path.join(TMP, 'la2');
  const inst = await runPs(['-File', path.join(unpack, 'install-designcraft-studio.ps1')], { LOCALAPPDATA: la2, DESIGNCRAFT_LINK_DRY_RUN: '1' });
  const dest = path.join(la2, 'DesignCraftStudio');
  t('посилання зареєстровано б на скрипт у DesignCraftStudio (реєстр не чіпали)', /\[сухий прогін\] Обробник:.*DesignCraftStudio.*start-designcraft-studio\.ps1/.test(inst), inst.split('\n').find((l) => /сухий/.test(l)));
  t('шрифти скопійовано в DesignCraftStudio\\fonts', fs.existsSync(path.join(dest, 'fonts', 'DejaVuSerif.ttf')) && fs.existsSync(path.join(dest, 'fonts', 'LICENSE-DejaVu.txt')));
  t('файли скопійовано в DesignCraftStudio', ['start-designcraft-studio.ps1', 'start-designcraft-studio.cmd', 'install-designcraft-link.ps1', 'studio-mcp.mjs'].every((n) => fs.existsSync(path.join(dest, n))), inst.split('\n')[0]);

  console.log('\nСкрипт запуску поза репозиторієм');
  const home = path.join(TMP, 'home');
  fs.mkdirSync(home);
  const portable = await runPs(['-File', path.join(dest, 'start-designcraft-studio.ps1'), '-Url', 'designcraft-studio://open?book=B1&studio=https%3A%2F%2Fwww.fusionlab.in.ua%2Fstudio'], { LOCALAPPDATA: la2, HOME: home, USERPROFILE: home, DESIGNCRAFT_HOME: '', DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('приймає посилання, не вимагає репозиторій', /Запуск із Студії: https:\/\/www\.fusionlab\.in\.ua\/studio, книга B1/.test(portable) && !/Не знайдено проєкт Студії/.test(portable), portable.split('\n')[0]);
  t('без DesignCraft — зрозуміла відмова з посиланням на збірки', /Не знайдено DesignCraft/.test(portable) && /github\.com\/storytold\/designcraft\/releases/.test(portable), portable.split('\n').find((l) => /Не знайдено DesignCraft/.test(l)) || portable.slice(-200));

  const fakeDc = path.join(TMP, 'dc', 'bin');
  fs.mkdirSync(fakeDc, { recursive: true });
  fs.writeFileSync(path.join(fakeDc, 'designcraft-cli.exe'), '');
  fs.writeFileSync(path.join(fakeDc, 'designcraft.exe'), '');
  const SCRIPT = path.join(dest, 'start-designcraft-studio.ps1');
  const harness = path.join(TMP, 'harness.ps1');
  fs.writeFileSync(harness, `﻿
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
foreach ($n in @('Find-DesignCraftIn','Read-LauncherConfig','Write-LauncherConfig','Save-DesignCraftDir','Resolve-DesignCraft','Fail')) {
  $fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true)[0]
  . ([scriptblock]::Create($fn.Extent.Text))
}
$DesignCraftPath=''; $DesignCraftAppPath=''
$ConfigDir = Join-Path $env:LOCALAPPDATA 'DesignCraftStudio'
$ConfigFile = Join-Path $ConfigDir 'config.json'
$DesignCraftReleases = 'x'
Resolve-DesignCraft
"CLI=" + (Split-Path -Leaf $DesignCraftPath) + " DIR=" + (Split-Path -Parent $DesignCraftPath)
`, 'utf8');
  const found = await runPs(['-File', harness], { LOCALAPPDATA: la2, DESIGNCRAFT_HOME: path.join(TMP, 'dc'), DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('знаходить DesignCraft за DESIGNCRAFT_HOME (у bin\\)', /CLI=designcraft-cli\.exe/.test(found), found.trim().split('\n').pop());
  const cfgOut = await runPs(['-File', harness], { LOCALAPPDATA: la2, DESIGNCRAFT_HOME: '', DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('шлях збережено в config.json — наступного разу питати не треба', fs.existsSync(path.join(la2, 'DesignCraftStudio', 'config.json')) && /CLI=designcraft-cli\.exe/.test(cfgOut), cfgOut.trim().split('\n').pop());

  // designcraft.exe лежить НЕ поряд із designcraft-cli.exe (так буває: `cargo install` кладе в .cargo\bin лише CLI).
  const cliOnly = path.join(TMP, 'cargo-bin');
  const appOnly = path.join(TMP, 'dc-app', 'target', 'release');
  fs.mkdirSync(cliOnly, { recursive: true });
  fs.mkdirSync(appOnly, { recursive: true });
  fs.writeFileSync(path.join(cliOnly, 'designcraft-cli.exe'), '');
  fs.writeFileSync(path.join(appOnly, 'designcraft.exe'), '');
  const appHarness = path.join(TMP, 'harness-app.ps1');
  fs.writeFileSync(appHarness, `\ufeff
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
foreach ($n in @('Find-DesignCraftIn','Find-DesignCraftAppIn','Get-DesignCraftSearchDirs','Read-LauncherConfig','Write-LauncherConfig','Save-DesignCraftDir','Resolve-DesignCraftApp')) {
  $fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true)[0]
  . ([scriptblock]::Create($fn.Extent.Text))
}
$DesignCraftPath='${path.join(cliOnly, 'designcraft-cli.exe').replace(/'/g, "''")}'; $DesignCraftAppPath=''
$ConfigDir = Join-Path $env:LOCALAPPDATA 'DesignCraftStudio'
$ConfigFile = Join-Path $ConfigDir 'config.json'
$DesignCraftReleases = 'x'
$app = Resolve-DesignCraftApp
"APP=" + $(if ($app) { $app.Replace([string][char]92, '/') } else { 'NONE' })
`, 'utf8');
  const la3 = path.join(TMP, 'la3');
  const noApp = await runPs(['-File', appHarness], { LOCALAPPDATA: la3, DESIGNCRAFT_HOME: '', DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('вікна немає ніде — повертає порожньо (скрипт перейде в режим без вікна), а не падає', /APP=NONE/.test(noApp), noApp.trim().split('\n').pop());
  const withApp = await runPs(['-File', appHarness], { LOCALAPPDATA: la3, DESIGNCRAFT_HOME: path.join(TMP, 'dc-app'), DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('знаходить designcraft.exe в іншій папці, ніж designcraft-cli.exe', /APP=.*dc-app\/target\/release\/designcraft\.exe/.test(withApp), withApp.slice(-300));
  const cfgJson = fs.existsSync(path.join(la3, 'DesignCraftStudio', 'config.json')) ? fs.readFileSync(path.join(la3, 'DesignCraftStudio', 'config.json'), 'utf8') : '';
  t('папка вікна запам\'ятана в config.json окремо від CLI', /designcraftAppDir/.test(cfgJson) && /designcraftDir/.test(cfgJson));
  const again = await runPs(['-File', appHarness], { LOCALAPPDATA: la3, DESIGNCRAFT_HOME: '', DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('наступного разу бере збережене, нічого не питаючи', /APP=.*dc-app\/target\/release\/designcraft\.exe/.test(again), again.trim().split('\n').pop());

  // Автозавантаження DesignCraft: чисті функції (мережі в тесті немає, сам виклик GitHub не перевіряється).
  console.log('\nАвтозавантаження DesignCraft (вибір архіву, контрольна сума, розпаковування)');
  const PREFIX = 'https://github.com/storytold/designcraft/releases/download/';
  const releases = [
    { tag_name: 'v0.9.0-rc1', draft: false, prerelease: true, assets: [{ name: 'designcraft-0.9.0-rc1-windows-x64-portable.zip', browser_download_url: `${PREFIX}v0.9.0-rc1/designcraft-0.9.0-rc1-windows-x64-portable.zip`, size: 1 }] },
    { tag_name: 'v0.8.0', draft: true, prerelease: false, assets: [{ name: 'designcraft-0.8.0-windows-x64-portable.zip', browser_download_url: `${PREFIX}v0.8.0/designcraft-0.8.0-windows-x64-portable.zip`, size: 1 }] },
    { tag_name: 'v0.7.1', draft: false, prerelease: false, assets: [
      { name: 'designcraft-0.7.1-linux-x86_64.tar.gz', browser_download_url: `${PREFIX}v0.7.1/designcraft-0.7.1-linux-x86_64.tar.gz`, size: 1 },
      { name: 'designcraft-0.7.1-windows-x64-portable.zip', browser_download_url: `${PREFIX}v0.7.1/designcraft-0.7.1-windows-x64-portable.zip`, size: 38000000, digest: 'sha256:' + 'a'.repeat(64) },
    ] },
    { tag_name: 'v0.6.0', draft: false, prerelease: false, assets: [{ name: 'designcraft-0.6.0-windows-x64-portable.zip', browser_download_url: 'https://evil.example/designcraft-0.6.0-windows-x64-portable.zip', size: 1 }] },
  ];
  const fakeZipSrc = path.join(TMP, 'fake.zip');
  const fz = new JSZip();
  fz.file('designcraft-0.7.1/designcraft-cli.exe', 'cli');
  fz.file('designcraft-0.7.1/designcraft.exe', 'gui');
  fs.writeFileSync(fakeZipSrc, await fz.generateAsync({ type: 'nodebuffer' }));
  const cliOnlyZip = path.join(TMP, 'cli-only.zip');
  const cz = new JSZip();
  cz.file('readme.txt', 'нічого корисного');
  fs.writeFileSync(cliOnlyZip, await cz.generateAsync({ type: 'nodebuffer' }));
  const goodDigest = 'sha256:' + (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(fakeZipSrc)).digest('hex');
  const dlHarness = path.join(TMP, 'harness-dl.ps1');
  const rel = JSON.stringify(releases).replace(/'/g, "''");
  fs.writeFileSync(dlHarness, `\ufeff
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
foreach ($n in @('Select-DesignCraftAsset','Expand-DesignCraftZip')) {
  $fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true)[0]
  . ([scriptblock]::Create($fn.Extent.Text))
}
$DesignCraftPrefix = '${PREFIX}'
$DesignCraftDownloadPrefix = $DesignCraftPrefix
$releases = '${rel}' | ConvertFrom-Json
$a = Select-DesignCraftAsset $releases ''
"LATEST=" + $a.tag
$b = Select-DesignCraftAsset $releases '0.7.1'
"PIN=" + $b.tag + " " + $b.digest.Substring(0,10)
$c = Select-DesignCraftAsset $releases 'v0.6.0'
"FOREIGN=" + $(if ($c) { 'ПРИЙНЯТО' } else { 'відхилено' })
$d = Select-DesignCraftAsset $releases '0.8.0'
"DRAFT=" + $(if ($d) { 'ПРИЙНЯТО' } else { 'відхилено' })
$ok = Expand-DesignCraftZip '${fakeZipSrc.replace(/'/g, "''")}' '${goodDigest}' '${path.join(TMP, 'dl-ok').replace(/'/g, "''")}'
"OK_CLI=" + (Split-Path -Leaf $ok.cli) + " OK_APP=" + (Split-Path -Leaf $ok.app)
try { Expand-DesignCraftZip '${fakeZipSrc.replace(/'/g, "''")}' ('sha256:' + ('0' * 64)) '${path.join(TMP, 'dl-bad').replace(/'/g, "''")}' | Out-Null; "BAD=ПРИЙНЯТО" } catch { "BAD=відхилено: " + $_.Exception.Message.Substring(0, 40) }
$nodig = Expand-DesignCraftZip '${fakeZipSrc.replace(/'/g, "''")}' '' '${path.join(TMP, 'dl-nodig').replace(/'/g, "''")}'
"NODIGEST=" + (Split-Path -Leaf $nodig.cli)
try { Expand-DesignCraftZip '${cliOnlyZip.replace(/'/g, "''")}' '' '${path.join(TMP, 'dl-nocli').replace(/'/g, "''")}' | Out-Null; "NOCLI=ПРИЙНЯТО" } catch { "NOCLI=відхилено" }
`, 'utf8');
  const dl = await runPs(['-File', dlHarness], { LOCALAPPDATA: la3 });
  t('«остання» — перший стабільний реліз (чернетка й pre-release пропущені)', /LATEST=v0\.7\.1/.test(dl), dl.split('\n').find((l) => /LATEST/.test(l)));
  t('конкретна версія -DesignCraftVersion 0.7.1', /PIN=v0\.7\.1 sha256:aaa/.test(dl));
  t('архів із чужої адреси відхиляється', /FOREIGN=відхилено/.test(dl));
  t('чернетка релізу не обирається навіть за версією', /DRAFT=відхилено/.test(dl));
  t('правильна сума — розпаковано, знайдено designcraft-cli.exe і designcraft.exe', /OK_CLI=designcraft-cli\.exe OK_APP=designcraft\.exe/.test(dl), dl.split('\n').find((l) => /OK_CLI/.test(l)));
  t('хибна сума — відмова, нічого не розпаковано', /BAD=відхилено/.test(dl) && !fs.existsSync(path.join(TMP, 'dl-bad', 'designcraft-0.7.1')), dl.split('\n').find((l) => /BAD=/.test(l)));
  t('без суми — розпаковує, але попереджає й показує SHA-256', /NODIGEST=designcraft-cli\.exe/.test(dl) && /SHA-256: [0-9a-f]{64}/.test(dl));
  t('архів без designcraft-cli.exe відхиляється', /NOCLI=відхилено/.test(dl));

  // Перевірка зв'язку з DesignCraft: запит ідіть файлом (без BOM). Підробний «designcraft-cli» відповідає
  // помилкою розбору, як DesignCraft 0.13, якщо перший байт запиту — не «{».
  if (process.platform !== 'win32') {
    console.log('\nПеревірка зв\'язку з DesignCraft (без BOM у запиті)');
    const fake = path.join(TMP, 'fake-designcraft-cli');
    fs.writeFileSync(fake, `#!/bin/bash
IFS= read -r line
first="\${line:0:1}"
if [ "$first" != "{" ]; then
  echo '{"error":{"code":-32700,"message":"parse error: expected value at line 1 column 1"},"id":null,"jsonrpc":"2.0"}'
else
  echo '{"id":1,"jsonrpc":"2.0","result":{"serverInfo":{"name":"designcraft","version":"0.13.0"}}}'
fi
`);
    fs.chmodSync(fake, 0o755);
    const probeHarness = path.join(TMP, 'harness-probe.ps1');
    fs.writeFileSync(probeHarness, `\ufeff
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
$fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Test-DesignCraftServer'},$true)[0]
. ([scriptblock]::Create($fn.Extent.Text))
$DesignCraftPath='${fake.replace(/'/g, "''")}'
$r = Test-DesignCraftServer @('mcp', '--connect', '7979')
"PROBE ok=$($r.ok) name=$($r.name) version=$($r.version) error=$($r.error)"
`, 'utf8');
    const probe = await runPs(['-File', probeHarness], {});
    t('перевірка проходить: перший байт запиту «{», без BOM', /PROBE ok=True name=designcraft version=0\.13\.0/.test(probe), probe.trim().split('\n').pop());
  }

  console.log('\nПідключення за кодом з кнопки Студії');
  {
    const seen: string[] = [];
    const fake = http.createServer((q, r) => {
      let b = '';
      q.on('data', (d) => (b += d));
      q.on('end', () => {
        seen.push(`${q.method} ${q.url}`);
        r.setHeader('content-type', 'application/json');
        if (q.url === '/api/external/v1/pair') {
          const ok = JSON.parse(b || '{}').code === 'ABCD-EFGH';
          r.statusCode = ok ? 201 : 404;
          return r.end(JSON.stringify(ok ? { token: 'nst_fake', user: { name: 'T', email: 't@x' } } : { error: 'x' }));
        }
        if (q.url === '/api/external/v1/me') return r.end(JSON.stringify({ user: { name: 'Test', email: 't@x' } }));
        r.statusCode = 404;
        r.end('{}');
      });
    });
    await new Promise<void>((r) => fake.listen(0, () => r()));
    const port = (fake.address() as any).port;
    const la5 = path.join(TMP, 'la5');
    const bin5 = path.join(TMP, 'bin5');
    fs.mkdirSync(bin5, { recursive: true });
    const fakeCli = path.join(bin5, process.platform === 'win32' ? 'designcraft-cli.exe' : 'designcraft-cli');
    fs.writeFileSync(fakeCli, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeCli, 0o755);
    const withCode = await runPs(['-File', SCRIPT, '-DesignCraftPath', fakeCli, '-NoBrowser', '-Url', `designcraft-studio://open?book=B1&studio=${encodeURIComponent('http://localhost:' + port)}&code=ABCD-EFGH`], { LOCALAPPDATA: la5, HOME: home, USERPROFILE: home, DESIGNCRAFT_NO_AUTODETECT: '1' });
    t('код з посилання обміняно на токен без жодного запитання', /Код прийнято/.test(withCode) && /Ви ввійшли як: Test/.test(withCode) && seen.includes('POST /api/external/v1/pair'), withCode.trim().split('\n').slice(0, 3).join(' | '));
    t('токен збережено автоматично (без «y/N»)', /Збережено для цієї Студії/.test(withCode) && !/Зберегти токен/.test(withCode));
    const cfg5 = path.join(la5, 'DesignCraftStudio', 'config.json');
    t('адресу Студії запам\'ятано для прямого запуску', fs.existsSync(cfg5) && JSON.parse(fs.readFileSync(cfg5, 'utf8')).lastStudio === `http://localhost:${port}`);
    seen.length = 0;
    const again = await runPs(['-File', SCRIPT, '-DesignCraftPath', fakeCli, '-NoBrowser', '-Url', `designcraft-studio://open?book=B1&studio=${encodeURIComponent('http://localhost:' + port)}&code=ZZZZ-ZZZZ`], { LOCALAPPDATA: la5, HOME: home, USERPROFILE: home, DESIGNCRAFT_NO_AUTODETECT: '1' });
    t('є збережений токен — код з посилання не витрачається', /Ви ввійшли як: Test/.test(again) && !seen.includes('POST /api/external/v1/pair'));
    // Адресу «з минулого разу» кладемо в config.json: тест не ходить у справжню хмарну Студію.
    const la6 = path.join(TMP, 'la6');
    fs.mkdirSync(path.join(la6, 'DesignCraftStudio'), { recursive: true });
    fs.writeFileSync(path.join(la6, 'DesignCraftStudio', 'config.json'), JSON.stringify({ lastStudio: `http://localhost:${port}` }));
    const direct = await runPs(['-File', SCRIPT, '-DesignCraftPath', fakeCli, '-NoBrowser'], { LOCALAPPDATA: la6, HOME: home, USERPROFILE: home, DESIGNCRAFT_NO_AUTODETECT: '1' });
    t('прямий запуск без адреси: пояснення, адреса береться з минулого разу, а не «localhost:3000»', /запущено напряму/.test(direct) && !/localhost:3000/.test(direct) && seen.includes('GET /'), direct.trim().split('\n')[0].slice(0, 80));
    // Режим «лише DesignCraft»: вікно відкривається, Студія/токен/Claude Code не потрібні й не чіпаються.
    const appDir = path.join(TMP, 'dc-only');
    fs.mkdirSync(appDir, { recursive: true });
    const marker = path.join(appDir, 'started.txt');
    const cliOnly = path.join(appDir, 'designcraft-cli.exe');
    const appOnly = path.join(appDir, 'designcraft.exe');
    fs.writeFileSync(cliOnly, '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(appOnly, `#!/bin/sh\necho "$@" > "${marker}"\n`);
    fs.chmodSync(cliOnly, 0o755);
    fs.chmodSync(appOnly, 0o755);
    seen.length = 0;
    const la7 = path.join(TMP, 'la7');
    const envOnly = { LOCALAPPDATA: la7, HOME: home, USERPROFILE: home, DESIGNCRAFT_NO_AUTODETECT: '1', PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin' };
    const only = await runPs(['-File', SCRIPT, '-DesignCraftPath', cliOnly, '-DesignCraftAppPath', appOnly, '-SkipFonts', '-DesignCraftOnly'], envOnly);
    await new Promise((r) => setTimeout(r, 800));
    t('«лише DesignCraft»: вікно запущено без аргументів керування', fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === '' && /DesignCraft запущено\. Claude Code не запускався/.test(only), only.trim().split('\n').slice(-2).join(' | '));
    t('«лише DesignCraft»: Студія, токен і Claude Code не потрібні', seen.length === 0 && !/Claude Code:|токен|Студі[яї] недоступна|Не знайдено команду claude/i.test(only.replace(/Claude Code не запускався/, '')), only.trim().split('\n')[0].slice(0, 100));
    fs.rmSync(marker, { force: true });
    const viaLink = await runPs(['-File', SCRIPT, '-DesignCraftPath', cliOnly, '-DesignCraftAppPath', appOnly, '-SkipFonts', '-Url', 'designcraft-studio://open?mode=designcraft'], envOnly);
    await new Promise((r) => setTimeout(r, 800));
    t('посилання mode=designcraft: без адреси Студії, без питань, вікно відкрито', fs.existsSync(marker) && /лише вікно DesignCraft/.test(viaLink) && seen.length === 0 && !/не в списку дозволених/.test(viaLink), viaLink.trim().split('\n')[0]);
    const bad = await runPs(['-File', SCRIPT, '-DesignCraftPath', cliOnly, '-SkipFonts', '-Url', 'designcraft-studio://open?book=B1&studio=https%3A%2F%2Fevil.example'], envOnly);
    t('чужа адреса Студії без mode=designcraft усе ще відхиляється', /не в списку дозволених/.test(bad));
    fake.close();
  }

  console.log('\nВхід у Claude Code через API-ключ');
  {
    const keyHarness = path.join(TMP, 'harness-key.ps1');
    fs.writeFileSync(keyHarness, `﻿
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
$fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq 'Test-ApiKeyShape'},$true)[0]
. ([scriptblock]::Create($fn.Extent.Text))
"GOOD=" + (Test-ApiKeyShape 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789_-AA')
"BAD1=" + (Test-ApiKeyShape 'hello world')
"BAD2=" + (Test-ApiKeyShape 'sk-ant-short')
"BAD3=" + (Test-ApiKeyShape 'nst_abcdefghijklmnopqrstuvwxyz0123456789')
"BAD4=" + (Test-ApiKeyShape '')
`, 'utf8');
    const ko = await runPs(['-File', keyHarness], {});
    t('форма ключа: справжній проходить, сміття й токен Студії (nst_) — ні', /GOOD=True/.test(ko) && /BAD1=False/.test(ko) && /BAD2=False/.test(ko) && /BAD3=False/.test(ko) && /BAD4=False/.test(ko), ko.trim().split('\n').join(' '));
    const sc = fs.readFileSync(SCRIPT, 'utf8');
    t('меню входу: за замовчуванням API-ключ, пункт Console попереджає про копіювання коду', /Номер \(Enter = 3\)/.test(sc) && /треба скопіювати код з браузера/.test(sc));
    t('ключ зберігається лише зашифрованим (DPAPI), ніколи відкритим текстом', /ConvertFrom-SecureString/.test(sc) && !/Set-Content[^\n]*\$plain\b(?!\s*\|)/.test(sc) && /Read-Host 'API-ключ' -AsSecureString/.test(sc));
    t('ключ не виводиться в консоль', !/Write-Host[^\n]*\$plain|Write-Host[^\n]*ANTHROPIC_API_KEY\)/.test(sc));
    t('є -ForgetApiKey', /\[switch\]\$ForgetApiKey/.test(sc));
  }

  {
  console.log('\nУстановка шрифтів DejaVu');
  const fontsSrc = path.join(unpack, 'fonts');
  const sysFonts = path.join(TMP, 'sysfonts');
  const userFonts = path.join(TMP, 'userfonts');
  fs.mkdirSync(sysFonts);
  fs.copyFileSync(path.join(fontsSrc, 'DejaVuSerif.ttf'), path.join(sysFonts, 'DejaVuSerif.ttf'));
  const fontHarness = path.join(TMP, 'harness-fonts.ps1');
  fs.writeFileSync(fontHarness, `\ufeff
$tok=$null;$errs=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$tok,[ref]$errs)
$as=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -eq '$DejaVuFonts'},$true)[0]
. ([scriptblock]::Create($as.Extent.Text))
foreach ($n in @('Get-MissingDejaVuFonts','Install-DejaVuFonts')) {
  $fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true)[0]
  . ([scriptblock]::Create($fn.Extent.Text))
}
$m1 = Get-MissingDejaVuFonts '${fontsSrc.replace(/'/g, "''")}' @('${sysFonts.replace(/'/g, "''")}', '${userFonts.replace(/'/g, "''")}')
"MISSING1=" + $m1.Count
Install-DejaVuFonts '${fontsSrc.replace(/'/g, "''")}' '${userFonts.replace(/'/g, "''")}' $m1 -NoRegister
$m2 = Get-MissingDejaVuFonts '${fontsSrc.replace(/'/g, "''")}' @('${sysFonts.replace(/'/g, "''")}', '${userFonts.replace(/'/g, "''")}')
"MISSING2=" + $m2.Count
`, 'utf8');
  const fo = await runPs(['-File', fontHarness], {});
  t('11 із 12 шрифтів відсутні (один «системний» уже є)', /MISSING1=11\b/.test(fo), fo.trim().split('\n')[0]);
  t('після копіювання відсутніх не залишається', /MISSING2=0\b/.test(fo) && fs.readdirSync(userFonts).length === 11 && !fs.existsSync(path.join(userFonts, 'DejaVuSerif.ttf')), fo.trim().split('\n').pop());
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало, ${skipped} пропущено.`);
if (fail) process.exit(1);
