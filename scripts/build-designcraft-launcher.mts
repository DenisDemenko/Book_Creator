/**
 * Збірка інсталятора запуску DesignCraft → dist/designcraft-launcher.zip (викликається з `npm run build`).
 * Образ Railway не містить scripts/, тож сервер лише віддає цей готовий файл.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildLauncherZip, LAUNCHER_ZIP_NAME } from '../server/designcraftLauncher';

const zip = await buildLauncherZip();
fs.mkdirSync('dist', { recursive: true });
const out = path.join('dist', LAUNCHER_ZIP_NAME);
fs.writeFileSync(out, zip);
console.log(`designcraft launcher: ${out} (${zip.length} байт)`);
