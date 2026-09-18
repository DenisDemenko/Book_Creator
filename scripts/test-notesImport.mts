/**
 * Тести src/utils/notesImport.ts — розбір ZIP/вільних файлів експорту
 * "Нотатки" (iOS) для плагіна «Імпорт нотаток» (запис #191).
 * Запуск: npm run test:notes-import
 */
import JSZip from 'jszip';
import {
  parseNoteMarkdown,
  mimeTypeForAudioFilename,
  basenameOf,
  parseNotesZip,
  matchLooseNotes,
} from '../src/utils/notesImport.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nparseNoteMarkdown — нотатка з аудіо-вкладенням (реальний приклад від власника):');
{
  const md = '[Новая запись](Attachments/EA73AEB0-4D7A-4E10-8D1D-D71800068F8C.m4a)  \nЦе добавити   \n';
  const result = parseNoteMarkdown(md);
  t('розпізнає шлях до аудіо', result.audioAttachmentPath === 'Attachments/EA73AEB0-4D7A-4E10-8D1D-D71800068F8C.m4a', result.audioAttachmentPath ?? 'null');
  t('прибирає рядок-посилання з тексту, лишає підпис', result.bodyText === 'Це добавити', JSON.stringify(result.bodyText));
}

console.log('\nparseNoteMarkdown — чисто текстова нотатка без аудіо (прогулянка, абзац із голови):');
{
  const md = 'Ідея для розділу 3: показати конфлікт через діалог, а не опис.\n\nДругий абзац думки.';
  const result = parseNoteMarkdown(md);
  t('audioAttachmentPath === null', result.audioAttachmentPath === null);
  t('весь текст лишається як bodyText', result.bodyText === 'Ідея для розділу 3: показати конфлікт через діалог, а не опис.\nДругий абзац думки.', JSON.stringify(result.bodyText));
}

console.log('\nparseNoteMarkdown — порожня нотатка:');
{
  const result = parseNoteMarkdown('');
  t('audioAttachmentPath === null', result.audioAttachmentPath === null);
  t('bodyText === ""', result.bodyText === '');
}

console.log('\nmimeTypeForAudioFilename / basenameOf:');
{
  t('.m4a → audio/m4a (НЕ audio/mp4 — Gemini API його не підтримує)', mimeTypeForAudioFilename('x.m4a') === 'audio/m4a');
  t('.mp3 → audio/mp3', mimeTypeForAudioFilename('x.mp3') === 'audio/mp3');
  t('.MP3 (регістр не має значення) → audio/mp3', mimeTypeForAudioFilename('X.MP3') === 'audio/mp3');
  t('невідоме розширення → null', mimeTypeForAudioFilename('x.caf') === null);
  t('basenameOf прибирає шлях', basenameOf('Attachments/foo.m4a') === 'foo.m4a');
  t('basenameOf без шляху повертає як є', basenameOf('foo.m4a') === 'foo.m4a');
}

console.log('\nmatchLooseNotes — .md і .m4a, вибрані окремими файлами (як у прикладі власника):');
{
  const entries = matchLooseNotes([
    { name: 'note.md', kind: 'md', text: '[Новая запись](Attachments/EA73AEB0.m4a)\nЦе добавити' },
    { name: 'EA73AEB0.m4a', kind: 'audio', base64: 'QUJD', mimeType: 'audio/m4a' },
  ]);
  t('одна нотатка на виході', entries.length === 1, String(entries.length));
  t('аудіо підхоплено за іменем файлу з .md', entries[0]?.audioFileName === 'EA73AEB0.m4a');
  t('base64 аудіо перенесено як є', entries[0]?.audioBase64 === 'QUJD');
  t('audioMissing === false', entries[0]?.audioMissing === false);
  t('bodyText збережено', entries[0]?.bodyText === 'Це добавити');
}

console.log('\nmatchLooseNotes — .md посилається на аудіо, якого серед файлів нема:');
{
  const entries = matchLooseNotes([
    { name: 'note.md', kind: 'md', text: '[Recording](Attachments/missing.m4a)\nТекст нотатки' },
  ]);
  t('audioMissing === true', entries[0]?.audioMissing === true);
  t('audioBase64 === null', entries[0]?.audioBase64 === null);
}

console.log('\nmatchLooseNotes — аудіофайл без супровідного .md (скинули лише голосовий запис):');
{
  const entries = matchLooseNotes([{ name: 'orphan.m4a', kind: 'audio', base64: 'WFla', mimeType: 'audio/m4a' }]);
  t('одна нотатка з порожнім текстом', entries.length === 1 && entries[0]?.bodyText === '');
  t('аудіо прикріплено', entries[0]?.audioFileName === 'orphan.m4a');
}

console.log('\nmatchLooseNotes — кілька .md, один спільний пул аудіо, кожен файл використовується один раз:');
{
  const entries = matchLooseNotes([
    { name: 'a.md', kind: 'md', text: '[R](Attachments/x.m4a)\nA' },
    { name: 'b.md', kind: 'md', text: '[R](Attachments/x.m4a)\nB' },
    { name: 'x.m4a', kind: 'audio', base64: 'AAA=', mimeType: 'audio/m4a' },
  ]);
  t('перша нотатка отримує аудіо', entries.find((e) => e.fileName === 'a.md')?.audioFileName === 'x.m4a');
  t('друга нотатка — той самий файл уже використано → audioMissing', entries.find((e) => e.fileName === 'b.md')?.audioMissing === true);
}

console.log('\nparseNotesZip — ZIP із двома нотатками, аудіо поруч із нотаткою (типовий формат експортера):');
{
  const zip = new JSZip();
  zip.file('Note1/note.md', '[Новая запись](Attachments/rec1.m4a)\nПерша нотатка');
  zip.file('Note1/Attachments/rec1.m4a', Buffer.from('fake-audio-bytes-1'));
  zip.file('Note2/note.md', 'Просто текст без аудіо, друга нотатка.');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const entries = await parseNotesZip(buf);
  t('знайдено 2 нотатки', entries.length === 2, String(entries.length));

  const note1 = entries.find((e) => e.id === 'Note1/note.md');
  t('перша нотатка: аудіо знайдено й прочитано base64', !!note1?.audioBase64, JSON.stringify(note1));
  t('перша нотатка: mimeType audio/m4a', note1?.audioMimeType === 'audio/m4a');
  t('перша нотатка: bodyText без рядка-посилання', note1?.bodyText === 'Перша нотатка');

  const note2 = entries.find((e) => e.id === 'Note2/note.md');
  t('друга нотатка: без аудіо', note2?.audioFileName === null && note2?.audioMissing === false);
  t('друга нотатка: увесь текст на місці', note2?.bodyText === 'Просто текст без аудіо, друга нотатка.');
}

console.log('\nparseNotesZip — спільна Attachments/ у корені архіву (не поруч із кожною нотаткою):');
{
  const zip = new JSZip();
  zip.file('notes/one.md', '[Recording](Attachments/shared.m4a)\nОдна нотатка');
  zip.file('Attachments/shared.m4a', Buffer.from('shared-audio'));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const entries = await parseNotesZip(buf);
  t('аудіо знайдено навіть у спільній кореневій теці', !!entries[0]?.audioBase64, JSON.stringify(entries[0]));
}

console.log('\nparseNotesZip — .md посилається на аудіо, якого в архіві взагалі нема:');
{
  const zip = new JSZip();
  zip.file('one.md', '[Recording](Attachments/ghost.m4a)\nТекст');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const entries = await parseNotesZip(buf);
  t('audioMissing === true', entries[0]?.audioMissing === true);
  t('audioBase64 === null', entries[0]?.audioBase64 === null);
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail > 0 ? 1 : 0);
