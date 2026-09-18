/**
 * Тести src/utils/notesImport.ts — розбір ZIP/вільних файлів експорту
 * "Нотатки" (iOS) для плагіна «Імпорт нотаток» (запис #191, розширено
 * запис #192 — чекліст/таблиця/картинки/посилання).
 * Запуск: npm run test:notes-import
 */
import JSZip from 'jszip';
import {
  parseNoteMarkdown,
  mimeTypeForAudioFilename,
  mimeTypeForImageFilename,
  basenameOf,
  imagePlaceholderToken,
  parseNotesZip,
  matchLooseNotes,
} from '../src/utils/notesImport.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nparseNoteMarkdown — нотатка з аудіо-вкладенням (реальний приклад від власника, Проба 1):');
{
  const md = '[Новая запись](Attachments/EA73AEB0-4D7A-4E10-8D1D-D71800068F8C.m4a)  \nЦе добавити   \n';
  const result = parseNoteMarkdown(md);
  t('розпізнає шлях до аудіо', result.audioAttachmentPath === 'Attachments/EA73AEB0-4D7A-4E10-8D1D-D71800068F8C.m4a', result.audioAttachmentPath ?? 'null');
  t('прибирає рядок-посилання з тексту, лишає підпис', result.bodyText === 'Це добавити', JSON.stringify(result.bodyText));
  t('картинок нема', result.images.length === 0);
}

console.log('\nparseNoteMarkdown — чисто текстова нотатка без аудіо, два абзаци (прогулянка, абзац із голови):');
{
  const md = 'Ідея для розділу 3: показати конфлікт через діалог, а не опис.\n\nДругий абзац думки.';
  const result = parseNoteMarkdown(md);
  t('audioAttachmentPath === null', result.audioAttachmentPath === null);
  // Порожній рядок між абзацами — це НАМІРЕНИЙ розрив абзацу (два різні
  // абзаци книги), а не просто зайвий пробіл: на відміну від першої версії
  // парсера, порожні рядки більше НЕ прибираються — інакше картинки/таблиці/
  // чекліст-блоки нижче не змогли б стояти власним абзацом.
  t('два абзаци лишаються розділеними порожнім рядком', result.bodyText === 'Ідея для розділу 3: показати конфлікт через діалог, а не опис.\n\nДругий абзац думки.', JSON.stringify(result.bodyText));
}

console.log('\nparseNoteMarkdown — порожня нотатка:');
{
  const result = parseNoteMarkdown('');
  t('audioAttachmentPath === null', result.audioAttachmentPath === null);
  t('bodyText === ""', result.bodyText === '');
  t('images === []', result.images.length === 0);
}

console.log('\nparseNoteMarkdown — чекліст перетворюється на буліт-рядки зі станом:');
{
  const md = '- [ ] проба\n- [x] зроблено\n- [X] теж зроблено (великий X)';
  const result = parseNoteMarkdown(md);
  t('невідмічений пункт → ☐', result.bodyText.includes('☐ проба'), result.bodyText);
  t('відмічений пункт (x) → ☑', result.bodyText.includes('☑ зроблено'), result.bodyText);
  t('відмічений пункт (X) → ☑', result.bodyText.includes('☑ теж зроблено (великий X)'), result.bodyText);
}

console.log('\nparseNoteMarkdown — markdown-таблиця перетворюється на читабельний текст:');
{
  const md = '| заголовок | заголовок |\n| --------- | --------- |\n| текст     | текст     |';
  const result = parseNoteMarkdown(md);
  t('рядок таблиці → "заголовок: значення; заголовок: значення"', result.bodyText === 'заголовок: текст; заголовок: текст', JSON.stringify(result.bodyText));
}

console.log('\nparseNoteMarkdown — таблиця з кількома рядками даних → кожен рядок окремим текстовим рядком:');
{
  const md = '| Персонаж | Роль |\n|---|---|\n| Оля | Героїня |\n| Дід | Наставник |';
  const result = parseNoteMarkdown(md);
  const lines = result.bodyText.split('\n');
  t('два текстові рядки для двох рядків даних', lines.length === 2, JSON.stringify(lines));
  t('перший рядок', lines[0] === 'Персонаж: Оля; Роль: Героїня', lines[0]);
  t('другий рядок', lines[1] === 'Персонаж: Дід; Роль: Наставник', lines[1]);
}

console.log('\nparseNoteMarkdown — markdown-посилання й голі URL → клікабельний [LINK=...] маркер:');
{
  const md = 'Дивись [опис на сайті](https://example.com/page) і ще https://www.facebook.com/share/p/cnEM2vK5Higspb6n/.';
  const result = parseNoteMarkdown(md);
  t('markdown-посилання обгорнуто', result.bodyText.includes('[LINK="https://example.com/page"]опис на сайті[/LINK]'), result.bodyText);
  t('гола URL обгорнута, крапка в кінці речення НЕ ввійшла в URL', result.bodyText.includes('[LINK="https://www.facebook.com/share/p/cnEM2vK5Higspb6n/"]https://www.facebook.com/share/p/cnEM2vK5Higspb6n/[/LINK].'), result.bodyText);
  t('без подвійного обгортання (одне [LINK на кожне посилання)', (result.bodyText.match(/\[LINK=/g) || []).length === 2, result.bodyText);
}

console.log('\nparseNoteMarkdown — картинка стає токеном-заглушкою власним абзацом, шлях і підпис розпізнано:');
{
  const md = 'Текст перед.\n![PARACORD](Attachments/D02BCAAB-1B70-435C-BDED-0241241119AE.png)\nТекст після.';
  const result = parseNoteMarkdown(md);
  t('одна картинка розпізнана', result.images.length === 1, JSON.stringify(result.images));
  t('шлях до картинки', result.images[0]?.path === 'Attachments/D02BCAAB-1B70-435C-BDED-0241241119AE.png');
  t('підпис — alt-текст', result.images[0]?.caption === 'PARACORD');
  const token = imagePlaceholderToken(0, 'PARACORD');
  t('токен-заглушка стоїть у тексті власним абзацом', result.bodyText === `Текст перед.\n\n${token}\n\nТекст після.`, JSON.stringify(result.bodyText));
}

console.log('\nparseNoteMarkdown — картинка без alt-тексту бере підпис з імені файлу:');
{
  const md = '![](Attachments/photo.jpg)';
  const result = parseNoteMarkdown(md);
  t('підпис = ім\'я файлу', result.images[0]?.caption === 'photo.jpg', result.images[0]?.caption);
}

console.log('\nparseNoteMarkdown — «Проба 2»: аудіо + текст + чекліст + таблиця + 2 картинки + посилання, разом, у реальному порядку власника:');
{
  const md = [
    '[Новая запись](Attachments/EA73AEB0-4D7A-4E10-8D1D-D71800068F8C.m4a)  ',
    'Це добавити   ',
    '- [ ] проба  ',
    '- [ ] тут главноє  ',
    '',
    '| заголовок | заголовок |',
    '| --------- | --------- |',
    '| текст     | текст     |',
    '  ',
    '![PARACORD](Attachments/D02BCAAB-1B70-435C-BDED-0241241119AE.png)  ',
    '  ',
    'https://www.facebook.com/share/p/cnEM2vK5Higspb6n/  ',
    '![Зарисовка](Attachments/C520E021-8E38-43CD-BF60-964AD13A3DF3.png)  ',
  ].join('\n');
  const result = parseNoteMarkdown(md);
  t('аудіо розпізнано', result.audioAttachmentPath === 'Attachments/EA73AEB0-4D7A-4E10-8D1D-D71800068F8C.m4a');
  t('обидві картинки розпізнані, у правильному порядку', result.images.length === 2 && result.images[0].caption === 'PARACORD' && result.images[1].caption === 'Зарисовка', JSON.stringify(result.images));
  t('чекліст перетворено', result.bodyText.includes('☐ проба') && result.bodyText.includes('☐ тут главноє'));
  t('таблиця перетворена', result.bodyText.includes('заголовок: текст; заголовок: текст'));
  t('посилання клікабельне', result.bodyText.includes('[LINK="https://www.facebook.com/share/p/cnEM2vK5Higspb6n/"]'));
  t('обидва токени-картинки присутні', result.bodyText.includes(imagePlaceholderToken(0, 'PARACORD')) && result.bodyText.includes(imagePlaceholderToken(1, 'Зарисовка')));
  t('аудіо-рядок повністю прибрано з тексту', !result.bodyText.includes('Новая запись') && !result.bodyText.includes('.m4a'));
}

console.log('\nmimeTypeForAudioFilename / mimeTypeForImageFilename / basenameOf:');
{
  t('.m4a → audio/m4a (НЕ audio/mp4 — Gemini API його не підтримує)', mimeTypeForAudioFilename('x.m4a') === 'audio/m4a');
  t('.mp3 → audio/mp3', mimeTypeForAudioFilename('x.mp3') === 'audio/mp3');
  t('.MP3 (регістр не має значення) → audio/mp3', mimeTypeForAudioFilename('X.MP3') === 'audio/mp3');
  t('невідоме розширення → null', mimeTypeForAudioFilename('x.caf') === null);
  t('.png → image/png', mimeTypeForImageFilename('x.png') === 'image/png');
  t('.jpg / .jpeg → image/jpeg', mimeTypeForImageFilename('x.jpg') === 'image/jpeg' && mimeTypeForImageFilename('x.jpeg') === 'image/jpeg');
  t('.HEIC (регістр) → null — сервер медіатеки такого не приймає', mimeTypeForImageFilename('x.HEIC') === null);
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
  t('images === []', entries[0]?.images.length === 0);
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

console.log('\nmatchLooseNotes — картинки: знайдена, відсутня, непідтримуваний формат, і повторне використання неможливе:');
{
  const entries = matchLooseNotes([
    {
      name: 'note.md',
      kind: 'md',
      text: '![Фото1](Attachments/found.png)\n![Фото2](Attachments/absent.png)\n![Фото3](Attachments/pic.heic)',
    },
    { name: 'found.png', kind: 'image', base64: 'Zm91bmQ=', mimeType: 'image/png' },
    { name: 'pic.heic', kind: 'image', base64: 'aGVpYw==', mimeType: null },
  ]);
  const images = entries[0]?.images || [];
  t('3 картинки розпізнано', images.length === 3, String(images.length));
  const found = images.find((i) => i.caption === 'Фото1');
  t('перша знайдена й придатна', found?.missing === false && found?.unsupported === false && found?.mimeType === 'image/png', JSON.stringify(found));
  const absent = images.find((i) => i.caption === 'Фото2');
  t('друга відсутня серед файлів → missing', absent?.missing === true, JSON.stringify(absent));
  const heic = images.find((i) => i.caption === 'Фото3');
  t('третя знайдена, але .heic не підтримується → unsupported', heic?.missing === false && heic?.unsupported === true, JSON.stringify(heic));
}

console.log('\nmatchLooseNotes — той самий картинковий файл не використовується двома нотатками одночасно:');
{
  const entries = matchLooseNotes([
    { name: 'a.md', kind: 'md', text: '![A](Attachments/shared.png)' },
    { name: 'b.md', kind: 'md', text: '![B](Attachments/shared.png)' },
    { name: 'shared.png', kind: 'image', base64: 'QUJD', mimeType: 'image/png' },
  ]);
  const a = entries.find((e) => e.fileName === 'a.md')?.images[0];
  const b = entries.find((e) => e.fileName === 'b.md')?.images[0];
  t('перша нотатка отримує файл', a?.missing === false, JSON.stringify(a));
  t('друга нотатка — файл уже використано → missing', b?.missing === true, JSON.stringify(b));
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

console.log('\nparseNotesZip — картинка в теці Attachments/ поруч із нотаткою, прочитана як base64:');
{
  const zip = new JSZip();
  zip.file('Note1/note.md', 'Текст із фото.\n![Фото](Attachments/photo.png)');
  zip.file('Note1/Attachments/photo.png', Buffer.from('fake-png-bytes'));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });

  const entries = await parseNotesZip(buf);
  const img = entries[0]?.images[0];
  t('картинка знайдена й прочитана', img?.missing === false && !!img?.base64, JSON.stringify(img));
  t('mimeType image/png', img?.mimeType === 'image/png');
  t('ім\'я файлу розпізнано', img?.fileName === 'photo.png');
}

console.log(`\nРезультат: ${pass} пройдено, ${fail} провалено`);
process.exit(fail > 0 ? 1 : 0);
