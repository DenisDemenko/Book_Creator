import assert from 'node:assert/strict';
import {
  DEFAULT_SKEW_MS, diffChapters, hashValue, planBookSync, stableStringify, summarizeBook,
  type BookSyncSummary,
} from '../server/bookSyncPlan';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log('✓ ' + name); };

const T0 = Date.parse('2026-10-24T10:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const mk = (chapters: Array<[string, string, string]>, minutes: number, extra: Record<string, unknown> = {}) =>
  summarizeBook({
    id: 'BK-1', title: 'Тест', revision: 1, updatedAt: at(minutes),
    book: { id: 'BK-1', title: 'Тест', ...extra, chapters: chapters.map(([id, title, text]) => ({ id, title, text })) },
  });

check('хеш не залежить від порядку полів', () => {
  assert.equal(hashValue({ a: 1, b: { c: 2, d: 3 } }), hashValue({ b: { d: 3, c: 2 }, a: 1 }));
  assert.equal(stableStringify({ x: undefined, y: 1 }), '{"y":1}');
});

check('інший текст дає інший хеш, той самий — той самий', () => {
  assert.equal(mk([['c1', 'Глава 1', 'a']], 0).hash, mk([['c1', 'Глава 1', 'a']], 50).hash);
  assert.notEqual(mk([['c1', 'Глава 1', 'a']], 0).hash, mk([['c1', 'Глава 1', 'b']], 0).hash);
});

check('однаковий вміст — дії немає, навіть якщо час різний', () => {
  const plan = planBookSync(mk([['c1', 'Г1', 'a']], 0), mk([['c1', 'Г1', 'a']], 30));
  assert.equal(plan.action, 'none');
  assert.equal(plan.newer, 'same');
  assert.equal(plan.blocked, false);
});

check('віддалена новіша — pull; локальна новіша — push', () => {
  const older = mk([['c1', 'Г1', 'a']], 0);
  const newer = mk([['c1', 'Г1', 'b']], 30);
  const pull = planBookSync(older, newer, { baseHash: older.hash });
  assert.equal(pull.action, 'pull');
  assert.equal(pull.newer, 'remote');
  assert.equal(pull.diverged, false);
  assert.equal(pull.overwritesLoserEdits, false);
  const push = planBookSync(newer, older, { baseHash: older.hash });
  assert.equal(push.action, 'push');
  assert.equal(push.newer, 'local');
});

check('змінили обидві сторони → diverged і попередження про затирання', () => {
  const base = mk([['c1', 'Г1', 'a']], 0);
  const local = mk([['c1', 'Г1', 'локальна правка']], 10);
  const remote = mk([['c1', 'Г1', 'правка на проді']], 60);
  const plan = planBookSync(local, remote, { baseHash: base.hash });
  assert.equal(plan.action, 'pull');
  assert.equal(plan.diverged, true);
  assert.equal(plan.overwritesLoserEdits, true);
});

check('ніколи не синхронізували (немає бази) і версії різні → diverged', () => {
  const plan = planBookSync(mk([['c1', 'Г1', 'a']], 0), mk([['c1', 'Г1', 'b']], 30), { baseHash: null });
  assert.equal(plan.diverged, true);
  assert.equal(plan.action, 'pull');
});

check('час відрізняється менше за допуск → blocked, дії немає', () => {
  const half = (DEFAULT_SKEW_MS / 60_000) / 2;
  const plan = planBookSync(mk([['c1', 'Г1', 'a']], 0), mk([['c1', 'Г1', 'b']], half));
  assert.equal(plan.blocked, true);
  assert.equal(plan.action, 'none');
});

check('рівно на межі допуску вже обирається новіша', () => {
  const plan = planBookSync(mk([['c1', 'Г1', 'a']], 0), mk([['c1', 'Г1', 'b']], DEFAULT_SKEW_MS / 60_000));
  assert.equal(plan.blocked, false);
  assert.equal(plan.action, 'pull');
});

check('книга лише з одного боку → створити на іншому', () => {
  const book = mk([['c1', 'Г1', 'a']], 0);
  assert.equal(planBookSync(null, book).action, 'pull');
  assert.equal(planBookSync(book, null).action, 'push');
  assert.equal(planBookSync(null, null).action, 'none');
});

check('різниця за главами: тільки тут / тільки там / змінена / однакова', () => {
  const local = mk([['c1', 'Однакова', 'x'], ['c2', 'Змінена', 'a'], ['c3', 'Лише тут', 'z']], 0);
  const remote = mk([['c1', 'Однакова', 'x'], ['c2', 'Змінена', 'b'], ['c4', 'Лише там', 'q']], 0);
  const diff = diffChapters(local.chapters, remote.chapters);
  const by = Object.fromEntries(diff.map((d) => [d.id, d.state]));
  assert.deepEqual(by, { c1: 'same', c2: 'changed', c3: 'only-local', c4: 'only-remote' });
});

check('некоректна дата не ламає план', () => {
  const a = { ...mk([['c1', 'Г1', 'a']], 0), updatedAt: 'не дата' } as BookSyncSummary;
  const plan = planBookSync(a, mk([['c1', 'Г1', 'b']], 30));
  assert.ok(['pull', 'none'].includes(plan.action));
});

console.log('Підсумок: ' + count + ' пройшло.');
