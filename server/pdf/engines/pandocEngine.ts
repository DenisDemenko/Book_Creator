/**
 * Рушій «pandoc + Eisvogel» — справжня книжкова типографіка через XeLaTeX.
 *
 * ЩО ВІН ДАЄ, ЧОГО НЕ ДАЮТЬ ІНШІ. TeX робить те, чого не вміє ні `pdf-lib`,
 * ні браузер: переноси за словниками мови, лігатури, мікротипографіку
 * (`microtype` підганяє міжлітерні відстані, щоб праве поле було рівним),
 * пристойні вдови й сироти. Це різниця не «трохи гарніше», а «схоже на
 * книжку з друкарні» проти «схоже на роздрук».
 *
 * ЧОГО ВІН КОШТУЄ. pandoc + TeX Live — це кілька гігабайтів у образі, і
 * власник свідомо на це пішов (log.md #101). Тому `available()` тут — не
 * формальність: якщо образ зібрано без TeX, автор має дізнатись про це до
 * натискання «Опублікувати», а не після трихвилинного чекання.
 *
 * БЕЗПЕКА, І ЦЕ НЕ ТЕОРІЯ. Текст книги пише автор, а LaTeX — мова
 * програмування: `\input{/etc/passwd}` у рукописі прочитав би чужий файл і
 * надрукував його в книзі. Тому вхід подається як `markdown-raw_tex`:
 * pandoc екранує все, що схоже на команду TeX, замість пропускати її далі.
 * Плюс `--sandbox` там, де він не заважає, і жодного `-shell-escape`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { bookToMarkdown } from '../bookToMarkdown';
import { extensionForMime, loadImageBytes } from '../../media/imageBytes';
import { PAGE_SIZES } from '../pdfTypes';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

/**
 * Де лежить шаблон.
 *
 * Двічі, бо розкладка різна. У вихідному коді цей файл — у
 * `server/pdf/engines/`, і шаблон поруч, на рівень вище. У зібраному
 * застосунку весь сервер — один `dist/server.mjs`, і `..` веде вже за межі
 * `dist`. Жорсткий шлях працював би рівно в одному з двох випадків, причому
 * зламався б у тому, який на продакшені.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function firstExistingDir(candidates: string[]): string {
  for (const dir of candidates) {
    try {
      if (fsSync.existsSync(dir)) return dir;
    } catch {
      // Недоступна тека — просто не наш випадок.
    }
  }
  return candidates[0];
}

export const LATEX_DIR =
  process.env.LATEX_TEMPLATE_DIR ||
  firstExistingDir([
    path.join(MODULE_DIR, '..', 'latex'), // вихідний код: server/pdf/latex
    path.join(MODULE_DIR, 'latex'), // збірка: dist/latex
  ]);
export const EISVOGEL_TEMPLATE = path.join(LATEX_DIR, 'eisvogel.latex');

export const PANDOC_PATH = process.env.PANDOC_PATH || 'pandoc';
export const XELATEX_PATH = process.env.XELATEX_PATH || 'xelatex';

/** LaTeX на книзі в 300 сторінок іде хвилини, а не секунди. */
const PANDOC_TIMEOUT_MS = Number(process.env.PANDOC_TIMEOUT_MS) || 300_000;

/** Шрифт із кирилицею, який ставиться в образ разом із TeX. */
const MAIN_FONT = process.env.PANDOC_MAIN_FONT || 'DejaVu Serif';
const SANS_FONT = process.env.PANDOC_SANS_FONT || 'DejaVu Sans';
const MONO_FONT = process.env.PANDOC_MONO_FONT || 'DejaVu Sans Mono';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Запуск зовнішньої програми з таймаутом.
 *
 * Таймаут добиває процес, а не просто перестає його чекати: зависла збірка
 * LaTeX інакше лишалась би в памʼяті контейнера до перезапуску, і десяток
 * таких зависань зʼїв би сервер тихо, без жодного повідомлення.
 */
export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? PANDOC_TIMEOUT_MS);

    child.stdout?.on('data', (d) => {
      // Обрізаємо: помилка LaTeX буває на мегабайт, і в лог їй не місце.
      if (stdout.length < 20_000) stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      if (stderr.length < 20_000) stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function binaryWorks(command: string): Promise<boolean> {
  const result = await run(command, ['--version'], { timeoutMs: 15_000 });
  return result.code === 0;
}

/**
 * Останній рядок помилки LaTeX, придатний для показу.
 *
 * Повний вивід — це сотні рядків службового шуму, у якому справжня причина
 * («Undefined control sequence») губиться. Показати авторові все — те саме,
 * що не показати нічого.
 */
export function latexErrorSummary(stderr: string, stdout: string): string {
  const text = `${stdout}\n${stderr}`;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const meaningful = lines.filter(
    (l) => l.startsWith('!') || /^Error|error:|LaTeX Error|Undefined control sequence/i.test(l)
  );
  if (meaningful.length > 0) return meaningful.slice(0, 3).join(' · ');

  return lines.slice(-3).join(' · ') || 'LaTeX завершився помилкою без пояснення.';
}

/** Формат сторінки в мові LaTeX. Eisvogel приймає `papersize`. */
function paperFor(sizeName: string | undefined): string {
  switch (sizeName) {
    case 'A4':
      return 'a4';
    case 'B5':
      return 'b5';
    case 'Letter':
      return 'letter';
    default:
      return 'a5';
  }
}

export const pandocEngine: PdfEngine = {
  id: 'pandoc',
  label: 'pandoc + Eisvogel (LaTeX)',
  strengthUk:
    'Книжкова типографіка: переноси за словником мови, лігатури, ' +
    'мікротипографіка, змістовний зміст. Найближче до друкарського вигляду.',
  limitUk:
    'Найповільніший і найважчий; помилку в розмітці показує мовою LaTeX, ' +
    'а не мовою книги. Полів під KDP не гарантує.',
  supportsPrint: false,

  async available(): Promise<PdfEngineAvailability> {
    try {
      await fs.access(EISVOGEL_TEMPLATE);
    } catch {
      return {
        ok: false,
        reasonUk: 'Шаблон Eisvogel не знайдено в образі.',
        fixUk: `Очікується файл ${EISVOGEL_TEMPLATE}.`,
      };
    }

    if (!(await binaryWorks(PANDOC_PATH))) {
      return {
        ok: false,
        reasonUk: `pandoc не знайдено (${PANDOC_PATH}).`,
        fixUk: 'pandoc ставиться в образ; локально задайте PANDOC_PATH.',
      };
    }
    if (!(await binaryWorks(XELATEX_PATH))) {
      return {
        ok: false,
        reasonUk: `XeLaTeX не знайдено (${XELATEX_PATH}).`,
        fixUk: 'Потрібен TeX Live з xetex; локально задайте XELATEX_PATH.',
      };
    }
    return { ok: true };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const state = await this.available();
    if (!state.ok) {
      throw new PdfEngineError('pandoc', 'unavailable', state.reasonUk || 'pandoc недоступний.');
    }

    const notesUk: string[] = [];
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-pandoc-'));

    try {
      const doc = bookToMarkdown(request.book as never, { frontmatter: true });

      // Ілюстрації — файлами поруч із рукописом: pandoc читає їх з диска,
      // а `data:`-URL у Markdown він не розуміє взагалі.
      let markdown = doc.markdown;
      for (const image of doc.images) {
        try {
          const { mimeType, bytes } = await loadImageBytes(image.url, request.ownerId);
          const name = `${image.placeholder}.${extensionForMime(mimeType)}`;
          await fs.writeFile(path.join(workDir, name), bytes);
          markdown = markdown.split(`(${image.placeholder})`).join(`(${name})`);
        } catch (err) {
          notesUk.push(
            `Ілюстрація «${image.captionUk || image.url}» не вставлена: ${(err as Error).message}`
          );
          markdown = markdown
            .split(`![${image.captionUk}](${image.placeholder})`)
            .join(`*Ілюстрація: ${image.captionUk}*`);
        }
      }

      const inputPath = path.join(workDir, 'book.md');
      const outputPath = path.join(workDir, 'book.pdf');
      await fs.writeFile(inputPath, markdown, 'utf8');

      const spec = (request.spec || {}) as { pageSize?: string; fontSizePt?: number };
      const args = [
        'book.md',
        '-o',
        'book.pdf',
        '--template',
        EISVOGEL_TEMPLATE,
        '--pdf-engine',
        XELATEX_PATH,
        // Ось той самий запобіжник, про який ідеться в шапці файлу: текст
        // автора не може стати командою TeX.
        '--from',
        'markdown-raw_tex',
        '--resource-path',
        workDir,
        '--toc',
        '--toc-depth=2',
        '-V',
        `papersize=${paperFor(spec.pageSize)}`,
        '-V',
        `fontsize=${Number(spec.fontSizePt) > 0 ? Number(spec.fontSizePt) : 11}pt`,
        '-V',
        `mainfont=${MAIN_FONT}`,
        '-V',
        `sansfont=${SANS_FONT}`,
        '-V',
        `monofont=${MONO_FONT}`,
        '-V',
        'book=true',
        '-V',
        'titlepage=true',
        '-V',
        'toc-own-page=true',
      ];

      const result = await run(PANDOC_PATH, args, { cwd: workDir, timeoutMs: PANDOC_TIMEOUT_MS });

      if (result.timedOut) {
        throw new PdfEngineError(
          'pandoc',
          'timeout',
          `LaTeX не встиг зібрати книгу за ${Math.round(PANDOC_TIMEOUT_MS / 1000)} с. ` +
            'Зазвичай це дуже велика книга або дуже багато ілюстрацій.'
        );
      }
      if (result.code !== 0) {
        throw new PdfEngineError(
          'pandoc',
          'engine',
          `LaTeX не зібрав книгу: ${latexErrorSummary(result.stderr, result.stdout)}`
        );
      }

      const bytes = new Uint8Array(await fs.readFile(outputPath));
      const pageCount = (await PDFDocument.load(bytes)).getPageCount();

      notesUk.push(
        'Верстку виконано LaTeX за шаблоном Eisvogel: формат сторінки й кегль ' +
          'узято з налаштувань книги, решта типографіки — від шаблону.'
      );

      return { bytes, pageCount, engineId: 'pandoc', honoredSpec: false, notesUk };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('pandoc', 'engine', (err as Error).message);
    } finally {
      // Тимчасова тека прибирається завжди: у ній лежать ілюстрації автора,
      // і лишати їх у /tmp контейнера — це і місце, і чужі файли поруч.
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
