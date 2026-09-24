/**
 * Постійні номери абзаців — задача Т0.5 (журнал #246): звірка номерів після
 * правок поза редактором (`utils/paragraphIds.ts`) і поведінка номера в самому
 * редакторі (`ParagraphIdExtension.ts`) при розбитті, злитті й переміщенні.
 *
 * Запуск: npm run test:paragraph-ids
 */
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import {
  reconcileParagraphIds,
  sectionBlocks,
  markerStringToTiptapDocWithIds,
  paragraphStateFromDoc,
  deterministicParagraphId,
} from '../src/utils/paragraphIds.ts';
import { markerStringToTiptapDoc, tiptapDocToMarkerString } from '../src/utils/manuscriptDoc.ts';
import { createParagraphIdPlugin } from '../src/components/manuscriptEditor/ParagraphIdExtension.ts';
import { diffSectionChange } from '../src/utils/bookDiff.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const para = (...xs: string[]) => xs.join('\n\n');
const SEC = 'sec-1';

console.log('\nЗвірка номерів після правок поза редактором:');
{
  const text = para('Перший абзац.', '## Заголовок', 'Другий абзац.', '***', 'Третій абзац.');
  t('блоки — як у редакторі (абзаци, заголовок, розділювач)', sectionBlocks(text).length === 5);

  const first = reconcileParagraphIds({ sectionId: SEC, content: text });
  const again = reconcileParagraphIds({ sectionId: SEC, content: text });
  t('старий розділ без номерів — номери обчислено, унікальні', first.ids.length === 5 && new Set(first.ids).size === 5);
  t('обчислення детерміноване: той самий текст — ті самі номери', first.ids.join() === again.ids.join());
  t('номер має вигляд UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(first.ids[0]), first.ids[0]);

  const same = reconcileParagraphIds({ sectionId: SEC, content: text, prevIds: first.ids, prevHashes: first.hashes });
  t('текст без змін — номери ті самі, змін немає', same.ids.join() === first.ids.join() && same.changed === false);

  const edited = para('Перший абзац.', '## Заголовок', 'Другий абзац, ПЕРЕПИСАНИЙ ШІ.', '***', 'Третій абзац.');
  const r1 = reconcileParagraphIds({ sectionId: SEC, content: edited, prevIds: first.ids, prevHashes: first.hashes });
  t('абзац відредаговано на місці — номери всіх збережено', r1.ids.join() === first.ids.join());

  const inserted = para('Перший абзац.', 'Новий абзац.', '## Заголовок', 'Другий абзац.', '***', 'Третій абзац.');
  const r2 = reconcileParagraphIds({ sectionId: SEC, content: inserted, prevIds: first.ids, prevHashes: first.hashes });
  t('вставка посередині — сусіди зберегли номери, новий — новий',
    r2.ids[0] === first.ids[0] && r2.ids[2] === first.ids[1] && r2.ids[5] === first.ids[4] && !first.ids.includes(r2.ids[1]));

  const deleted = para('Перший абзац.', '## Заголовок', '***', 'Третій абзац.');
  const r3 = reconcileParagraphIds({ sectionId: SEC, content: deleted, prevIds: first.ids, prevHashes: first.hashes });
  t('видалення — решта зберегли номери', r3.ids.join() === [first.ids[0], first.ids[1], first.ids[3], first.ids[4]].join());

  const moved = para('Третій абзац.', 'Перший абзац.', '## Заголовок', 'Другий абзац.', '***');
  const r4 = reconcileParagraphIds({ sectionId: SEC, content: moved, prevIds: first.ids, prevHashes: first.hashes });
  t('переміщений абзац зберіг номер (за текстом)', r4.ids[1] === first.ids[0] && new Set(r4.ids).size === 5);

  const twins = para('Так.', 'Так.', 'Так.');
  const r5 = reconcileParagraphIds({ sectionId: SEC, content: twins });
  t('однакові абзаци — різні номери', new Set(r5.ids).size === 3);

  const external = para('Перший абзац.', '## Заголовок', 'Другий абзац.', '***', 'Третій абзац — правка.', 'Додано ШІ 1.', 'Додано ШІ 2.');
  const client = reconcileParagraphIds({ sectionId: SEC, content: external, prevIds: first.ids, prevHashes: first.hashes });
  const server = reconcileParagraphIds({ sectionId: SEC, content: external, prevIds: [...first.ids], prevHashes: [...first.hashes] });
  t('браузер і сервер незалежно отримують ті самі номери', client.ids.join() === server.ids.join());

  const dupIn = reconcileParagraphIds({ sectionId: SEC, content: text, prevIds: [first.ids[0], first.ids[0], ...first.ids.slice(2)], prevHashes: first.hashes });
  t('повтор у збережених номерах лагодиться', new Set(dupIn.ids).size === 5);

  t('інший розділ — інші номери для того самого тексту',
    reconcileParagraphIds({ sectionId: 'sec-2', content: text }).ids[0] !== first.ids[0]);
  t('номер залежить від розділу, тексту й повтору', deterministicParagraphId('a', 'h', 0) !== deterministicParagraphId('a', 'h', 1));
}

console.log('\nДокумент редактора ↔ текст розділу:');
{
  const text = para('Перший **жирний** абзац.', '> Цитата', '[TABLE]\n| a | b |\n[/TABLE]', 'Останній.');
  const { ids } = reconcileParagraphIds({ sectionId: SEC, content: text });
  const doc = markerStringToTiptapDocWithIds(text, ids);
  const state = paragraphStateFromDoc(doc);
  t('номери дійшли до вузлів і назад', state.ids.join() === ids.join());
  t('текст розділу той самий, що й без номерів (у рукопис номери не пишуться)',
    state.content === tiptapDocToMarkerString(markerStringToTiptapDoc(text)) && !state.content.includes(ids[0]));
}

console.log('\nНомер у самому редакторі (ProseMirror):');
{
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'text*', attrs: { pid: { default: null } } },
      text: {},
    },
  });
  let counter = 0;
  const gen = () => `new-${++counter}`;
  const mk = (...ps: [string, string | null][]) =>
    EditorState.create({
      schema,
      doc: schema.node('doc', null, ps.map(([txt, pid]) => schema.node('paragraph', { pid }, txt ? [schema.text(txt)] : []))),
      plugins: [createParagraphIdPlugin(gen)],
    });
  const pids = (st: EditorState) => { const out: (string | null)[] = []; st.doc.forEach((n) => out.push(n.attrs.pid)); return out; };

  let st = mk(['Перша половина друга половина', 'A'], ['Далі', 'B']);
  st = st.apply(st.tr.split(1 + 'Перша половина'.length, 1));
  t('Enter посередині: перша половина лишає номер, друга — новий', pids(st).join() === 'A,new-1,B', pids(st).join());

  st = mk(['Текст абзацу', 'A']);
  st = st.apply(st.tr.split(1, 1));
  t('Enter на початку: номер лишається абзацу з текстом', pids(st).join() === 'new-2,A', pids(st).join());

  st = mk(['Раз', 'A'], ['Два', 'B']);
  st = st.apply(st.tr.join(1 + 'Раз'.length + 1));
  t('злиття абзаців: лишається номер першого', pids(st).join() === 'A' && st.doc.textContent === 'РазДва', pids(st).join());

  st = mk(['Раз', 'A'], ['Два', 'B'], ['Три', 'C']);
  const node = st.doc.child(0);
  let tr = st.tr.delete(0, node.nodeSize);
  tr = tr.insert(tr.doc.content.size, node);
  st = st.apply(tr);
  t('переміщення абзацу: номер їде з ним', pids(st).join() === 'B,C,A', pids(st).join());

  st = mk(['Без номера', null], ['Є', 'B']);
  st = st.apply(st.tr.insertText('!', 2));
  t('абзац без номера отримує його при першій правці', pids(st)[0] !== null && pids(st)[1] === 'B', pids(st).join());
}

console.log('\nПатч співавторам:');
{
  const section = { id: 's', chapterId: 'c', title: 'x', order: 0, content: 'a', wordCount: 1, lastModified: '', paragraphIds: ['1'], paragraphHashes: ['h'] };
  const prev: any = { id: 'b', chapters: [{ id: 'c', sections: [section] }] };
  const next: any = { ...prev, chapters: [{ ...prev.chapters[0], sections: [{ ...section, content: 'a\n\nb', paragraphIds: ['1', '2'], paragraphHashes: ['h', 'g'] }] }] };
  const patch = diffSectionChange(prev, next);
  t('номери абзаців їдуть у патчі разом із текстом', patch?.paragraphIds?.join() === '1,2' && patch?.content === 'a\n\nb', JSON.stringify(patch));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
