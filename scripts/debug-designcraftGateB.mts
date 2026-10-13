import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DEFAULT_LAYOUT_SPEC } from '../server/pdf/pdfTypes';
import { buildDesigncraftRtf } from '../server/pdf/designcraft/rtf';

const cli = process.env.DESIGNCRAFT_PATH || 'designcraft-cli';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-gateb-debug-'));
const rtf = path.join(dir, 'book.rtf');
const dcs = path.join(dir, 'build.dcs');
const out = path.join(dir, 'book.designcraft');
const book: any = {
  id: 'debug', title: 'Українська тестова книга', author: 'Fusion Lab',
  chapters: [
    { id: 'c1', order: 1, title: 'Вступ', sections: [{ id: 's1', order: 1, title: 'Початок', content: '<p>Привіт, світе. Це перевірка української кирилиці.</p>' }] },
    { id: 'c2', order: 2, title: 'Практика', sections: [{ id: 's2', order: 1, content: '<p>Другий розділ.</p>' }] },
  ], illustrations: [],
};
const manuscript = buildDesigncraftRtf(book, DEFAULT_LAYOUT_SPEC);
await fs.writeFile(rtf, manuscript.rtf, 'utf8');
const q = (cmd: string, p: any = {}) => `${cmd} ${JSON.stringify(p)}`;
const script = [
  q('file.new', { width: 419.53, height: 595.28, pages: 3, facingPages: false, margins: { top: 56, bottom: 56, inside: 48, outside: 48 }, title: book.title }),
  q('file.place', { path: rtf, page: 3, autoflow: true, styleConflicts: 'useExisting' }),
  q('layout.section', { page: 3, startNumber: 1, style: 'arabic' }),
  q('toc.generate', { styles: ['Heading 1', 'Heading 2'], title: 'Зміст', pageNumbers: true, page: 2 }),
  q('document.inspect'),
].join('\n') + '\n';
await fs.writeFile(dcs, script, 'utf8');
console.log('--- DCS ---\n' + script);
console.log('--- RTF HEAD ---\n' + manuscript.rtf.slice(0, 1600));
const result = await new Promise<{code: number|null; stdout: string; stderr: string}>((resolve) => {
  const child = spawn(cli, ['script', dcs, '--save', out], { cwd: dir });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += String(d));
  child.stderr.on('data', d => stderr += String(d));
  child.on('close', code => resolve({ code, stdout, stderr }));
});
console.log('--- EXIT ---', result.code);
console.log('--- STDOUT ---\n' + result.stdout);
console.log('--- STDERR ---\n' + result.stderr);
process.exit(result.code || 0);
