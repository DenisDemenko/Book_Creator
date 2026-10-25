/**
 * Інсталятор запуску DesignCraft, який віддає Студія (ZIP зі скриптами).
 * Запуск: npm run test:designcraft-launcher
 *
 * Перевіряється те, що отримає користувач ХМАРНОЇ Студії, у якого немає репозиторію: архів повний і не
 * залежить від проєкту (MCP Студії одним файлом без tsx), маршрут віддає його, скрипт запуску вміє жити
 * поза репозиторієм і сам знаходить/запам'ятовує DesignCraft. PowerShell потрібен для частини перевірок.
 */
import fs from 'node:fs';
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
const names = Object.keys(zip.files);
t('усі скрипти запуску в архіві', LAUNCHER_SCRIPT_FILES.every((n) => names.includes(n)), names.join(', '));
t('є MCP Студії одним файлом і інструкція', names.includes('studio-mcp.mjs') && names.includes('ПРОЧИТАЙ.txt'));
const eol = (b: Buffer) => b.toString('utf8').replace(/\r\n/g, '\n');
t('скрипти ті самі, що в репозиторії (з точністю до кінців рядків)', (await Promise.all(LAUNCHER_SCRIPT_FILES.map(async (n) => eol(await zip.file(n)!.async('nodebuffer')) === eol(fs.readFileSync(path.join('scripts', n)))))).every(Boolean));
t('.cmd в архіві мають CRLF (cmd.exe)', (await Promise.all(LAUNCHER_SCRIPT_FILES.filter((n) => n.endsWith('.cmd')).map(async (n) => { const x = (await zip.file(n)!.async('string')); return x.includes('\r\n') && !/[^\r]\n/.test(x); }))).every(Boolean));
const mcp = await zip.file('studio-mcp.mjs')!.async('string');
t('MCP не посилається на файли репозиторію', !/from ['"]\.\.?\//.test(mcp) && !/require\(['"]\.\.?\//.test(mcp));
t('жодного base64-блоку (антивірус не любить, автор має змогу прочитати)', !/[A-Za-z0-9+\/]{400,}={0,2}/.test(await zip.file('start-designcraft-studio.ps1')!.async('string')));
t('.ps1 мають BOM (Windows PowerShell 5.1 читає кирилицю)', (await Promise.all(['install-designcraft-studio.ps1', 'start-designcraft-studio.ps1', 'install-designcraft-link.ps1'].map(async (n) => (await zip.file(n)!.async('nodebuffer')).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))))).every(Boolean));

console.log('\nMCP Студії з архіву запускається без репозиторію (лише node)');
const unpack = path.join(TMP, 'unpacked');
fs.mkdirSync(unpack, { recursive: true });
for (const n of names) fs.writeFileSync(path.join(unpack, n), await zip.file(n)!.async('nodebuffer'));
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
t('віддає той самий склад', Object.keys(served.files).sort().join() === names.slice().sort().join());
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
foreach ($n in @('Find-DesignCraftIn','Save-DesignCraftDir','Resolve-DesignCraft','Fail')) {
  $fn=$ast.FindAll({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true)[0]
  . ([scriptblock]::Create($fn.Extent.Text))
}
$DesignCraftPath=''; $DesignCraftAppPath=''
$ConfigDir = Join-Path $env:LOCALAPPDATA 'DesignCraftStudio'
$ConfigFile = Join-Path $ConfigDir 'config.json'
$DesignCraftReleases = 'x'
Resolve-DesignCraft
"CLI=" + (Split-Path -Leaf $DesignCraftPath) + " APP=" + (Split-Path -Leaf $DesignCraftAppPath) + " DIR=" + (Split-Path -Parent $DesignCraftPath)
`, 'utf8');
  const found = await runPs(['-File', harness], { LOCALAPPDATA: la2, DESIGNCRAFT_HOME: path.join(TMP, 'dc'), DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('знаходить DesignCraft за DESIGNCRAFT_HOME (у bin\\)', /CLI=designcraft-cli\.exe APP=designcraft\.exe/.test(found), found.trim().split('\n').pop());
  const cfgOut = await runPs(['-File', harness], { LOCALAPPDATA: la2, DESIGNCRAFT_HOME: '', DESIGNCRAFT_NO_AUTODETECT: '1' });
  t('шлях збережено в config.json — наступного разу питати не треба', fs.existsSync(path.join(la2, 'DesignCraftStudio', 'config.json')) && /CLI=designcraft-cli\.exe APP=designcraft\.exe/.test(cfgOut), cfgOut.trim().split('\n').pop());
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало, ${skipped} пропущено.`);
if (fail) process.exit(1);
