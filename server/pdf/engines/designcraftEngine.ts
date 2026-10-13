/**
 * DesignCraft — headless book compositor for Fusion Lab Studio.
 *
 * The Studio book object remains canonical.  Every render starts from a
 * clean DesignCraft document, imports an RTF manuscript with semantic
 * paragraph styles and lets DesignCraft autoflow it.  Nothing in Studio is
 * coupled to DesignCraft object/story ids.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_LAYOUT_SPEC, PAGE_SIZES, type PdfLayoutSpec } from '../pdfTypes';
import { buildDesigncraftRtf, rtfText } from '../designcraft/rtf';
import { run } from './pandocEngine';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

export const DESIGNCRAFT_PATH = process.env.DESIGNCRAFT_PATH || 'designcraft-cli';
const DESIGNCRAFT_TIMEOUT_MS = Number(process.env.DESIGNCRAFT_TIMEOUT_MS) || 180_000;
const PAGE_NUMBER_MARKER = '\uE000';

interface InspectPage {
  index: number;
  name?: string;
  bounds: [number, number, number, number];
}
interface InspectSpread {
  index: number;
  pages: InspectPage[];
}
interface InspectResult {
  spreads?: InspectSpread[];
}

function mergedSpec(input?: Partial<PdfLayoutSpec>): PdfLayoutSpec {
  return {
    ...DEFAULT_LAYOUT_SPEC,
    ...(input || {}),
    margins: { ...DEFAULT_LAYOUT_SPEC.margins, ...(input?.margins || {}) },
    chapterTitle: { ...DEFAULT_LAYOUT_SPEC.chapterTitle, ...(input?.chapterTitle || {}) },
    sectionTitle: { ...DEFAULT_LAYOUT_SPEC.sectionTitle, ...(input?.sectionTitle || {}) },
    titlePage: { ...DEFAULT_LAYOUT_SPEC.titlePage, ...(input?.titlePage || {}) },
    frontMatter: { ...DEFAULT_LAYOUT_SPEC.frontMatter, ...(input?.frontMatter || {}) },
    pageNumber: { ...DEFAULT_LAYOUT_SPEC.pageNumber, ...(input?.pageNumber || {}) },
    runningHead: { ...DEFAULT_LAYOUT_SPEC.runningHead, ...(input?.runningHead || {}) },
  };
}

function pageSize(spec: PdfLayoutSpec): { width: number; height: number } {
  if (Number(spec.pageWidthPt) > 0 && Number(spec.pageHeightPt) > 0) {
    return { width: Number(spec.pageWidthPt), height: Number(spec.pageHeightPt) };
  }
  return PAGE_SIZES[spec.pageSize] || PAGE_SIZES.A5;
}

function jsonLine(command: string, params: Record<string, unknown> = {}): string {
  return `${command} ${JSON.stringify(params)}`;
}

function reportFrom(stdout: string): any {
  const text = stdout.trim();
  if (!text) throw new Error('DesignCraft не повернув звіт виконання.');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`DesignCraft повернув не JSON: ${text.slice(0, 400)}`, { cause: err as Error });
  }
}

function errorSummary(stdout: string, stderr: string): string {
  const joined = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return joined.slice(-5).join(' · ').slice(0, 1200) || 'DesignCraft завершився помилкою без пояснення.';
}

async function cliWorks(): Promise<boolean> {
  const result = await run(DESIGNCRAFT_PATH, ['--version'], { timeoutMs: 12_000 });
  return result.code === 0;
}

function titleCommands(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  if (!spec.titlePage.show) return [];
  const { width, height } = pageSize(spec);
  const left = spec.margins.left;
  const right = width - spec.margins.right;
  const centerY = height * 0.30;
  const title = String(request.book.title || 'Без назви');
  const subtitle = String(request.book.subtitle || '');
  const author = String(request.book.author || '');
  const text = [title, subtitle, author].filter(Boolean).join('\n\n');
  return [
    jsonLine('frame.create', {
      spread: 0,
      rect: [left, centerY, right, centerY + height * 0.30],
      content: 'text',
      text,
    }),
    jsonLine('text.selectStory', { frame: '$last.id', point: [(left + right) / 2, centerY + 10] }),
    jsonLine('type.para', { attrs: { align: 'center' } }),
    jsonLine('type.char', { attrs: { size: spec.titlePage.titleSize } }),
  ];
}

function initialScript(request: PdfRenderRequest, spec: PdfLayoutSpec, rtfPath: string): string {
  const { width, height } = pageSize(spec);
  const hasTitle = spec.titlePage.show;
  const tocPage = hasTitle ? 2 : 1;
  const bodyPage = tocPage + 1;
  const entries = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
  const commands = [
    jsonLine('file.new', {
      width,
      height,
      pages: bodyPage,
      facingPages: false,
      margins: {
        top: spec.margins.top,
        bottom: spec.margins.bottom,
        inside: spec.margins.left,
        outside: spec.margins.right,
      },
      title: request.book.title || 'Fusion Lab book',
    }),
    ...titleCommands(request, spec),
    jsonLine('file.place', { path: rtfPath, page: bodyPage, autoflow: true }),
    jsonLine('layout.section', {
      page: bodyPage,
      startNumber: Math.max(1, Math.round(spec.pageNumber.startAt || 1)),
      style: 'arabic',
    }),
    jsonLine('toc.generate', {
      styles: entries,
      title: spec.frontMatter.contentsTitle || 'Зміст',
      pageNumbers: true,
      page: tocPage,
    }),
    jsonLine('document.inspect'),
  ];
  return commands.join('\n') + '\n';
}

function bodyStartPhysicalPage(spec: PdfLayoutSpec): number {
  // Physical pages are 1-based here.  With title enabled: title=1, TOC=2,
  // body=3.  Otherwise TOC=1, body=2.
  return spec.titlePage.show ? 3 : 2;
}

function pageFurnitureScript(inspect: InspectResult, spec: PdfLayoutSpec): string {
  const bodyStart = bodyStartPhysicalPage(spec);
  const commands: string[] = [];
  if (spec.runningHead.show && spec.runningHead.content === 'chapter') {
    commands.push(jsonLine('variables.define', {
      name: 'FusionLab Chapter',
      type: 'runningHeader',
      style: 'Heading 1',
      use: 'lastOnPage',
    }));
  }

  for (const spread of inspect.spreads || []) {
    for (const page of spread.pages || []) {
      const physical = Number(page.index) + 1;
      if (physical < bodyStart) continue;
      const [x0, y0, x1, y1] = page.bounds;
      const cx = (x0 + x1) / 2;

      if (spec.runningHead.show) {
        const y = y0 + Math.max(12, spec.margins.top * 0.28);
        let text = '';
        if (spec.runningHead.content === 'title') text = String('');
        if (spec.runningHead.content === 'author') text = String('');
        commands.push(jsonLine('frame.create', {
          spread: spread.index,
          rect: [x0 + spec.margins.left, y, x1 - spec.margins.right, y + 18],
          content: 'text',
          text,
        }));
        if (spec.runningHead.content === 'chapter') {
          commands.push(jsonLine('text.select', { story: '$last.story', anchor: 0, focus: 0 }));
          commands.push(jsonLine('variables.insert', { name: 'FusionLab Chapter' }));
        } else {
          const value = spec.runningHead.content === 'author' ? '' : '';
          if (value) commands.push(jsonLine('text.insert', { text: value }));
        }
        commands.push(jsonLine('type.para', { attrs: { align: 'center' } }));
        commands.push(jsonLine('type.char', { attrs: { size: spec.runningHead.fontSize } }));
      }

      if (spec.pageNumber.show) {
        const footerY = y1 - Math.max(30, spec.margins.bottom * 0.62);
        const footerW = 72;
        commands.push(jsonLine('frame.create', {
          spread: spread.index,
          rect: [cx - footerW / 2, footerY, cx + footerW / 2, footerY + 18],
          content: 'text',
          text: PAGE_NUMBER_MARKER,
        }));
        commands.push(jsonLine('text.selectStory', { frame: '$last.id', point: [cx, footerY + 6] }));
        commands.push(jsonLine('type.para', { attrs: { align: 'center' } }));
        commands.push(jsonLine('type.char', { attrs: { size: spec.pageNumber.fontSize } }));
      }
    }
  }
  commands.push(jsonLine('toc.update'));
  commands.push(jsonLine('document.inspect'));
  return commands.join('\n') + '\n';
}

export const designcraftEngine: PdfEngine = {
  id: 'designcraft',
  label: 'DesignCraft',
  strengthUk:
    'Професійна книжкова верстка з автоматичним перетіканням тексту, стилями, змістом, колонтитулами та нумерацією сторінок.',
  limitUk:
    'Поки що це цифровий PDF-конвеєр; друкований KDP-макет із розрахунком корінця лишається за Nova.',
  supportsPrint: false,

  async available(): Promise<PdfEngineAvailability> {
    if (await cliWorks()) return { ok: true };
    return {
      ok: false,
      reasonUk: `DesignCraft CLI не знайдено (${DESIGNCRAFT_PATH}).`,
      fixUk: 'У production він встановлюється в Docker-образ; локально задайте DESIGNCRAFT_PATH.',
    };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const state = await this.available();
    if (!state.ok) throw new PdfEngineError('designcraft', 'unavailable', state.reasonUk || 'DesignCraft недоступний.');

    const spec = mergedSpec(request.spec);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-designcraft-'));
    const manuscript = path.join(workDir, 'manuscript.rtf');
    const buildScript = path.join(workDir, 'build.dcs');
    const furnitureScript = path.join(workDir, 'furniture.dcs');
    const doc1 = path.join(workDir, 'book-flow.designcraft');
    const doc2 = path.join(workDir, 'book-final.designcraft');
    const pdfPath = path.join(workDir, 'book.pdf');

    try {
      await fs.writeFile(manuscript, buildDesigncraftRtf(request.book, spec), 'utf8');
      await fs.writeFile(buildScript, initialScript(request, spec, manuscript), 'utf8');

      const first = await run(
        DESIGNCRAFT_PATH,
        ['script', buildScript, '--save', doc1],
        { cwd: workDir, timeoutMs: DESIGNCRAFT_TIMEOUT_MS }
      );
      if (first.timedOut) throw new PdfEngineError('designcraft', 'timeout', 'DesignCraft не завершив первинну верстку вчасно.');
      if (first.code !== 0) throw new PdfEngineError('designcraft', 'engine', errorSummary(first.stdout, first.stderr));
      const firstReport = reportFrom(first.stdout);
      if (firstReport.failedIndex !== undefined && firstReport.failedIndex !== null) {
        throw new PdfEngineError('designcraft', 'engine', `Помилка кроку ${firstReport.failedIndex}: ${JSON.stringify(firstReport.failed)}`);
      }
      const results = Array.isArray(firstReport.results) ? firstReport.results : [];
      const inspect = results[results.length - 1] as InspectResult;
      if (!inspect?.spreads?.length) {
        throw new PdfEngineError('designcraft', 'engine', 'Після автоперетікання DesignCraft не повернув структуру сторінок.');
      }

      await fs.writeFile(furnitureScript, pageFurnitureScript(inspect, spec), 'utf8');
      const second = await run(
        DESIGNCRAFT_PATH,
        ['script', furnitureScript, '--in', doc1, '--save', doc2, '--export', pdfPath],
        { cwd: workDir, timeoutMs: DESIGNCRAFT_TIMEOUT_MS }
      );
      if (second.timedOut) throw new PdfEngineError('designcraft', 'timeout', 'DesignCraft не завершив фінальний PDF вчасно.');
      if (second.code !== 0) throw new PdfEngineError('designcraft', 'engine', errorSummary(second.stdout, second.stderr));

      const bytes = new Uint8Array(await fs.readFile(pdfPath));
      if (bytes.byteLength < 1000) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
      const pdf = await PDFDocument.load(bytes);
      const pageCount = pdf.getPageCount();
      if (pageCount < bodyStartPhysicalPage(spec)) {
        throw new PdfEngineError('designcraft', 'engine', `PDF має лише ${pageCount} стор., хоча очікується щонайменше ${bodyStartPhysicalPage(spec)}.`);
      }

      return {
        bytes,
        pageCount,
        engineId: 'designcraft',
        honoredSpec: true,
        notesUk: [
          'DesignCraft: текст пройшов автоматичне перетікання, зміст оновлено після нумерації сторінок.',
        ],
      };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('designcraft', 'engine', `DesignCraft: ${(err as Error).message}`);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
