/**
 * Інсталятор запуску DesignCraft, який віддає сама Студія.
 *
 * ЧОМУ. Кнопка «Відкрити графічний редактор DesignCraft» працює через посилання
 * `designcraft-studio://`, яке має бути зареєстроване на комп'ютері автора. Користувач хмарної Студії
 * не має ні репозиторію, ні папки `scripts`, тож інсталятор мусить завантажуватися зі Студії.
 *
 * ЩО ВІДДАЄМО. Один ZIP зі звичайними текстовими файлами (без base64 і самовиконуваних обгорток —
 * антивіруси таке не люблять, а автор може прочитати кожен файл): `install-designcraft-studio.cmd/.ps1`,
 * `start-designcraft-studio.cmd/.ps1`, `install-designcraft-link.ps1`, `studio-mcp.mjs` (MCP Студії одним
 * файлом для node, без tsx і репозиторію) і `ПРОЧИТАЙ.txt`.
 *
 * ДЕ ЗБИРАЄТЬСЯ. У збірці (`npm run build` → `dist/designcraft-launcher.zip`); в образі Railway немає
 * `scripts/`, тому в рантаймі сервер лише віддає готовий файл. У dev збирається на льоту.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import JSZip from 'jszip';

export const LAUNCHER_ZIP_NAME = 'designcraft-studio-launcher.zip';

/** Файли, що беруться з `scripts/` як є. */
export const LAUNCHER_SCRIPT_FILES = [
  'install-designcraft-studio.cmd',
  'install-designcraft-studio.ps1',
  'start-designcraft-studio.cmd',
  'start-designcraft-studio.ps1',
  'install-designcraft-link.ps1',
] as const;

const README = `﻿Запуск DesignCraft зі Студії — установка (один раз)

1. Розпакуйте цей архів (правою кнопкою → «Видобути все»). Не запускайте файли прямо з архіву.
2. Двічі клацніть install-designcraft-studio.cmd. Якщо Windows питає «Запустити?» — погодьтесь:
   це звичайні текстові скрипти, їх можна відкрити Блокнотом і прочитати.
   Установка копіює файли в %LOCALAPPDATA%\\DesignCraftStudio і реєструє посилання designcraft-studio://
   лише для вашого користувача Windows (права адміністратора не потрібні).
3. Поверніться в Студію («Верстка для публікації») і натисніть «Відкрити графічний редактор DesignCraft».
   Браузер спитає дозвіл відкрити програму — погодьтесь. Код підключення береться там же, у Студії.

Потрібно окремо:
  - DesignCraft (designcraft.exe і designcraft-cli.exe). Папку з ним скрипт спитає один раз.
    Збірки проєкту: https://github.com/storytold/designcraft/releases
  - Claude Code (команда claude) і вхід у ваш акаунт Claude. Node.js — той самий, що потрібен Claude Code.

Прибрати: install-designcraft-studio.cmd -Remove (посилання); папку DesignCraftStudio можна видалити вручну.
Файли верстки й журнал запуску — у «Документи\\DesignCraft-Studio».
`;

/** MCP-сервер Студії одним файлом: у користувача хмарної Студії немає ні репозиторію, ні tsx. */
async function bundleStudioMcp(root: string): Promise<string> {
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [path.join(root, 'scripts', 'studio-mcp.mts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

export async function buildLauncherZip(root = process.cwd()): Promise<Buffer> {
  const zip = new JSZip();
  for (const name of LAUNCHER_SCRIPT_FILES) {
    let body = fs.readFileSync(path.join(root, 'scripts', name));
    // В репозиторії (і на Linux-збірці) рядки LF, а cmd.exe надійно читає лише CRLF.
    if (name.endsWith('.cmd')) body = Buffer.from(body.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
    zip.file(name, body);
  }
  zip.file('studio-mcp.mjs', await bundleStudioMcp(root));
  zip.file('ПРОЧИТАЙ.txt', README);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const BUILT_PATH = () => path.join(process.cwd(), 'dist', LAUNCHER_ZIP_NAME);
let memo: Buffer | null = null;

async function launcherZip(): Promise<Buffer> {
  if (memo) return memo;
  const built = BUILT_PATH();
  memo = fs.existsSync(built) ? fs.readFileSync(built) : await buildLauncherZip();
  return memo;
}

export function registerDesigncraftLauncherRoutes(app: Express): void {
  // Без входу: це лише скрипти запуску, у них немає ні токенів, ні даних. Посилання на сторінці
  // «Верстка для публікації» доступне лише авторам, але автор має змогу скачати файл і до входу.
  app.get('/api/designcraft/launcher.zip', async (_req: Request, res: Response) => {
    try {
      const body = await launcherZip();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${LAUNCHER_ZIP_NAME}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(body);
    } catch (err) {
      console.error('designcraft launcher:', err);
      return res.status(500).json({ error: 'Не вдалося зібрати інсталятор.' });
    }
  });
}
