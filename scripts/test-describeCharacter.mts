/**
 * Тести «Описати ШІ» (задача #220): промпт для моделі й передача тексту в
 * три цілі.
 * Запуск: npm run test:describe-character
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Дві речі, які найдорожче зламати:
 *   1. промпт мусить тримати модель у рамках «описуй те, що бачиш» — щойно
 *      з нього зникне заборона вигадувати, автор почне читати гарну казку
 *      про персонажа, якого на фото немає;
 *   2. передача не має права псувати книгу: розділ мусить лягти в ОСТАННЮ
 *      главу, текст — бути екранованим, а сама книга — лишитися незміненою
 *      (інакше React не побачить нової версії й не перемалює екран).
 *
 * Сервер, React і мережа тут не потрібні — усе чисте, тому й перевіряється
 * швидко й точно.
 */
import {
  buildCharacterFromImagePrompt,
  characterFromImageSystemInstruction,
} from '../server/characterFromImagePrompt.ts';
import { buildTextFromImagePrompt, textFromImageSystemInstruction } from '../server/textFromImagePrompt.ts';
import {
  BUSY_RETRY_DELAYS_MS,
  TextFromImageError,
  busyMessage,
  classifyGenericError,
  generateTextFromImage,
  humanizeEngineMessage,
  isRetryableFailure,
  withBusyRetry,
} from '../server/textFromImage.ts';
import {
  appendDescriptionToInstruction,
  AI_DRAFT_CLOSE,
  AI_DRAFT_OPEN,
  buildDescriptionDraft,
  buildCourseFromDescription,
  descriptionParagraphs,
  descriptionWordCount,
  insertDescriptionIntoBook,
  writerCoreFromBook,
  type DescriptionPayload,
} from '../src/utils/describeCharacterTransfer.ts';
import { calculateWordCount } from '../src/utils/helpers.ts';
import { createEmptyInstruction } from '../src/utils/instructionDraft.ts';
import type { Book } from '../src/types.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nПромпт опису персонажа:');
{
  const prompt = buildCharacterFromImagePrompt({
    photoLabel: 'media.jpg',
    generationPrompt: 'юнак у синій сорочці на тлі стіни',
    characterHint: 'Ігор',
    bookTitle: 'Тіні Нео-Києва',
    genre: 'кіберпанк',
    audience: 'дорослі 25+',
    synopsis: 'Місто після повені, де памʼять можна купити.',
    characters: [
      { name: 'Ігор Вовк', role: 'головний герой, інженер, 34 років' },
      { name: 'Марта', role: 'антагоніст' },
    ],
  });
  t('просить описати саме побачене', prompt.includes('СПРАВДІ бачиш'));
  t('називає промпт генерації НАМІРОМ, а не фактом', prompt.includes('це НАМІР, а не факт'));
  t('несе назву книги', prompt.includes('Тіні Нео-Києва'));
  t('несе жанр', prompt.includes('кіберпанк'));
  t('несе аудиторію', prompt.includes('дорослі 25+'));
  t('несе синопсис', prompt.includes('памʼять можна купити'));
  t('несе склад персонажів', prompt.includes('Ігор Вовк') && prompt.includes('Марта'));
  t('несе підказку про персонажа', prompt.includes('Ігор'));
  t('несе назву файлу', prompt.includes('media.jpg'));
  t('забороняє вигадувати імена й біографії', prompt.includes('Не вигадуй імені'));
  t('вимагає абзацу «чого не видно»', prompt.includes('Чого на зображенні не видно'));
  t('задає мову й обсяг', prompt.includes('українська') && prompt.includes('5–9 речень'));
  t('не радить Markdown і списки', prompt.includes('без Markdown'));
}

console.log('\nПорожні дані не ламають промпт:');
{
  const prompt = buildCharacterFromImagePrompt({});
  t('немає порожнього блоку «що відомо»', !prompt.includes('Що відомо про це зображення'));
  t('немає порожнього блоку «ядро книги»', !prompt.includes('Ядро книги'));
  t('але правила лишаються', prompt.includes('СПРАВДІ бачиш') && prompt.includes('Не вигадуй імені'));
  t('порожній список персонажів — не помилка', !buildCharacterFromImagePrompt({ characters: [] }).includes('персонажі книги'));
}

console.log('\nДовгі поля обрізаються:');
{
  const long = 'я'.repeat(5000);
  const prompt = buildCharacterFromImagePrompt({ synopsis: long, generationPrompt: long });
  t('синопсис обрізано', prompt.length < 4000, String(prompt.length));
  t('обрізання позначено трьома крапками', prompt.includes('…'));
}

console.log('\nСистемна інструкція — своя, не від «тексту сцени»:');
{
  const mine = characterFromImageSystemInstruction();
  const scene = textFromImageSystemInstruction();
  t('вона не дорівнює інструкції тексту сцени', mine !== scene);
  t('вона вимагає чесності', mine.includes('чесно'));
  t('вона забороняє описувати невидиме', mine.includes('не описуєш те, чого не бачиш'));
  t('текст сцени й далі будується своїм промптом', buildTextFromImagePrompt({ bookTitle: 'Х', genre: 'Y' }).includes('Х'));
}

const emptyBook = {
  id: 'BK-1',
  title: 'Книга',
  genre: 'кіберпанк',
  targetAudience: 'дорослі',
  synopsis: 'Синопсис',
  characters: [{ id: 'c1', bookId: 'BK-1', name: 'Ігор', surname: 'Вовк', role: 'protagonist', profession: 'інженер', age: 34 }],
  chapters: [
    { id: 'ch1', bookId: 'BK-1', title: 'Перша', order: 1, sections: [] },
    { id: 'ch2', bookId: 'BK-1', title: 'Друга', order: 2, sections: [{ id: 's1', chapterId: 'ch2', title: 'Стара', order: 1, content: '<p>текст</p>', wordCount: 1, lastModified: '2026-01-01T00:00:00.000Z' }] },
  ],
} as unknown as Book;

const payload: DescriptionPayload = {
  title: 'Ігор Вовк за фото',
  text: 'Перший абзац опису.\n\nДругий абзац <b>не HTML</b>.',
  photo: { url: '/api/media/file?id=abc&x=1', title: 'media.jpg' },
};

console.log('\nПередача опису в книгу (задача #224) — глава, формат, чернетка:');
{
  const before = JSON.parse(JSON.stringify(emptyBook));
  const now = '2026-09-19T20:00:00.000Z';
  const draft = insertDescriptionIntoBook(emptyBook, payload, { chapterId: 'ch2', now, illustrationId: 'ill-test' });
  t('вставка вдалася', !!draft);
  const chapters = draft!.book.chapters;
  t('кількість глав не змінилась', chapters.length === 2, String(chapters.length));
  t('текст ліг у ВИБРАНУ главу', draft!.chapterId === 'ch2' && draft!.chapterTitle === 'Друга');
  t('назва глави повертається для повідомлення', draft!.chapterTitle === 'Друга');
  t('дописано в КІНЕЦЬ останньої секції глави', chapters[1].sections.length === 1 && chapters[1].sections[0].content.endsWith(AI_DRAFT_CLOSE));
  t('секція — та сама, не нова', draft!.sectionId === chapters[1].sections[0].id);
  t('старий текст секції не затерто', chapters[1].sections[0].content.startsWith('<p>текст</p>'));

  const content = chapters[1].sections[0].content;
  t('текст загорнуто в маркер AI-чернетки', content.includes(AI_DRAFT_OPEN) && content.includes(AI_DRAFT_CLOSE));
  t('маркер відкриття — окремим абзацом', content.includes(`\n\n${AI_DRAFT_OPEN}\n\n`), JSON.stringify(content.slice(0, 60)));
  t('абзаци розділені порожнім рядком, а не тегами', content.includes('Перший абзац опису.\n\nДругий абзац <b>не HTML</b>.'));
  t('жодного HTML-тега від нас', !content.includes('<p>Перший абзац'), content.slice(-120));
  t('HTML у тексті лишається текстом (не екранується в маркерах)', content.includes('<b>не HTML</b>'));

  // Діапазон для підсвічування мусить покривати САМЕ вставлене.
  t('start указує на початок вставки', content.slice(draft!.start, draft!.start + AI_DRAFT_OPEN.length) === AI_DRAFT_OPEN, String(draft!.start));
  t('end — на кінець', content.slice(draft!.end - AI_DRAFT_CLOSE.length, draft!.end) === AI_DRAFT_CLOSE, String(draft!.end));
  t('виділений фрагмент дорівнює вставленому тексту', content.slice(draft!.start, draft!.end) === buildDescriptionDraft(payload.text));

  t('wordCount секції рахується тим самим лічильником, що й решта книги',
    chapters[1].sections[0].wordCount === calculateWordCount(chapters[1].sections[0].content),
    String(chapters[1].sections[0].wordCount));
  // Свідомо НЕ рівність до слів опису: лічильник книги грубий (ділить за
  // пробілами й рахує самі маркери як слова) — так само поводяться й
  // чернетки з правого кліку по фото та чату. Це давня грубість книги, не
  // цієї задачі, і саме тому тут перевіряється лише її послідовність.
  t('опис додав слова, а не забрав', chapters[1].sections[0].wordCount > descriptionWordCount(payload.text), String(chapters[1].sections[0].wordCount));
  t('книга НЕ змінена на місці', JSON.stringify(emptyBook) === JSON.stringify(before));
  t('перша глава недоторкана', chapters[0].sections.length === 0);
}

console.log('\nФото разом із текстом — ілюстрацією книги, а не тегом у тексті:');
{
  const draft = insertDescriptionIntoBook(emptyBook, payload, { chapterId: 'ch2', withPhoto: true, illustrationId: 'ill-test', now: '2026-09-19T20:00:00.000Z' })!;
  const ill = draft.book.illustrations.find((i) => i.id === 'ill-test');
  t('фото стало ілюстрацією книги', !!ill, JSON.stringify(draft.book.illustrations));
  t('ілюстрація прив’язана до вибраної глави', ill?.chapterId === 'ch2');
  t('підпис — назва фото', ill?.caption === 'media.jpg');
  t('у тексті стоїть маркер [IMG: id]', draft.book.chapters[1].sections[0].content.includes('[IMG: ill-test "media.jpg"'));
  t('маркер фото — ПЕРЕД чернеткою', draft.book.chapters[1].sections[0].content.indexOf('[IMG:') < draft.book.chapters[1].sections[0].content.indexOf(AI_DRAFT_OPEN));
  t('виділення починається з фото', draft.book.chapters[1].sections[0].content.slice(draft.start, draft.start + 4) === '[IMG');

  // Повторна передача того самого фото не має плодити ілюстрації-двійники.
  const again = insertDescriptionIntoBook(draft.book, { ...payload, text: 'Ще опис' }, { chapterId: 'ch2', withPhoto: true, illustrationId: 'ill-second' })!;
  t('те саме фото не дублюється', again.book.illustrations.length === draft.book.illustrations.length, String(again.book.illustrations.length));
  t('другий раз використано наявний id', again.book.chapters[1].sections[0].content.includes('[IMG: ill-test'));
}

console.log('\nВибір глави:');
{
  const first = insertDescriptionIntoBook(emptyBook, payload, { chapterId: 'ch1' })!;
  t('обрана ПОРОЖНЯ глава отримує власну секцію', first.chapterId === 'ch1' && first.book.chapters[0].sections.length === 1);
  t('заголовок секції — із payload', first.book.chapters[0].sections[0].title === payload.title);
  t('у порожній главі виділено весь вміст', first.start === 0 && first.end === first.book.chapters[0].sections[0].content.length);
  t('другу главу не зачеплено', first.book.chapters[1].sections.length === 1);

  const last = insertDescriptionIntoBook(emptyBook, payload, { chapterId: '' })!;
  t('порожній id — остання глава (як було до #224)', last.chapterId === 'ch2');

  const unknown = insertDescriptionIntoBook(emptyBook, payload, { chapterId: 'no-such-chapter' })!;
  t('невідомий id — теж остання глава, а не відмова', unknown.chapterId === 'ch2');
}

console.log('\nКнига без глав:');
{
  const bare = { ...emptyBook, chapters: [] } as unknown as Book;
  const draft = insertDescriptionIntoBook(bare, { title: '', text: 'Опис', photo: null })!;
  t('створено главу, щоб тексту було куди лягти', draft.book.chapters.length === 1);
  t('назва глави людська', draft.book.chapters[0].title === 'Опис персонажів');
  t('порожній заголовок замінено службовим', draft.book.chapters[0].sections[0].title === 'Опис персонажа (ШІ)');
  t('текст усередині маркерів', draft.book.chapters[0].sections[0].content === buildDescriptionDraft('Опис'));
}

console.log('\nПорожній текст і межі формату:');
{
  t('порожній текст — відмова, а не порожній блок', insertDescriptionIntoBook(emptyBook, { title: 'Х', text: '   ', photo: null }, { chapterId: 'ch2' }) === null);
  t('без фото — жодного [IMG]', !insertDescriptionIntoBook(emptyBook, { ...payload, photo: null }, { chapterId: 'ch2' })!.book.chapters[1].sections[0].content.includes('[IMG'));
  t('одинарний перенос лишається всередині абзацу', descriptionParagraphs('а\nб') === 'а\nб', descriptionParagraphs('а\nб'));
  t('порожні абзаци не плодять пустих блоків', descriptionParagraphs('а\n\n\n\nб') === 'а\n\nб');
  t('дві порожні лінії — межа абзацу', descriptionParagraphs('а\n\nб') === 'а\n\nб');
  t('чернетка складається з трьох частин', buildDescriptionDraft('а\n\nб').split('\n\n').filter(Boolean).length === 4, JSON.stringify(buildDescriptionDraft('а\n\nб')));
}

console.log('\nЧернетка інструкції:');
{
  const doc = createEmptyInstruction('assembly');
  const updated = appendDescriptionToInstruction(doc, payload, '2026-09-19T20:00:00.000Z');
  t('додано один запис у «Базу знань»', updated.knowledgeBase.length === doc.knowledgeBase.length + 1);
  t('назва — із заголовка', updated.knowledgeBase[updated.knowledgeBase.length - 1].title === payload.title);
  t('посилання — на фото', updated.knowledgeBase[updated.knowledgeBase.length - 1].link === payload.photo?.url);
  t('текст — у excerpt', updated.knowledgeBase[updated.knowledgeBase.length - 1].excerpt === payload.text);
  t('updatedAt оновлено', updated.updatedAt === '2026-09-19T20:00:00.000Z');
  t('початковий документ не змінено', doc.knowledgeBase.length === 0);
  const textOnly = appendDescriptionToInstruction(createEmptyInstruction('assembly'), { title: 'Х', text: 'Y', photo: null });
  t('без фото link порожній, а не «undefined»', textOnly.knowledgeBase[0].link === '');
}

console.log('\nКурс:');
{
  const body = buildCourseFromDescription(payload);
  t('назва курсу — заголовок опису', body.title === payload.title);
  t('один модуль, один урок', body.modules.length === 1 && body.modules[0].lessons.length === 1);
  t('опис уроку — весь текст', body.modules[0].lessons[0].description === payload.text);
  t('фото у photoUrls уроку', body.modules[0].lessons[0].photoUrls[0] === payload.photo?.url);
  t('summary обрізано до 400 символів', buildCourseFromDescription({ title: 'Х', text: 'я'.repeat(900), photo: null }).summary.length === 400);
  const noPhoto = buildCourseFromDescription({ title: 'Х', text: 'Y', photo: null });
  t('без фото lesson.photoUrls порожній', noPhoto.modules[0].lessons[0].photoUrls.length === 0);
}

console.log('\nЯдро письменника з книги:');
{
  const core = writerCoreFromBook(emptyBook);
  t('назва книги', core.bookTitle === 'Книга');
  t('жанр', core.genre === 'кіберпанк');
  t('аудиторія з targetAudience', core.audience === 'дорослі');
  t('синопсис', core.synopsis === 'Синопсис');
  t('імʼя та прізвище разом', core.characters[0].name === 'Ігор Вовк');
  t('роль — українською, а не «protagonist»', core.characters[0].role?.includes('головний герой') === true, core.characters[0].role);
  t('професія й вік теж у рядку', core.characters[0].role?.includes('інженер') === true && core.characters[0].role?.includes('34 років') === true);
  const bare = writerCoreFromBook({ ...emptyBook, characters: [], targetAudience: undefined } as unknown as Book);
  t('без персонажів список порожній, а не з null', bare.characters.length === 0);
  t('без аудиторії — порожній рядок', bare.audience === '');
}

console.log('\nЛічба слів:');
{
  t('порожній текст — 0', descriptionWordCount('   ') === 0);
  t('рахує слова, а не символи', descriptionWordCount('раз два три') === 3);
  t('кілька пробілів і переносів не додають слів', descriptionWordCount(' раз\n\n  два ') === 2);
}

console.log('\nПеревантаження моделі (задача #221):');
{
  const overload = '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';
  t('503 із тіла відповіді — це «перевантажено», а не «невідомо»', classifyGenericError('gemini', overload) === 'busy');
  t('слово UNAVAILABLE теж', classifyGenericError('gemini', 'UNAVAILABLE: model overloaded') === 'busy');
  t('«high demand» теж', classifyGenericError('gpt', 'We are experiencing high demand') === 'busy');
  t('429 і далі — це ліміт, не перевантаження', classifyGenericError('gemini', '429 resource_exhausted') === 'quota');
  t('401 — це ключ', classifyGenericError('gemini', 'API key not valid (401)') === 'no_key');
  t('фільтри безпеки лишаються безпекою', classifyGenericError('gemini', 'blocked by safety filters') === 'safety');
  t('сирий JSON більше не показують авторові', !humanizeEngineMessage(overload, 'gemini').includes('{'));
  t('замість JSON — людське пояснення', humanizeEngineMessage(overload, 'gemini').includes('тимчасова помилка сервісу'));
  t('порожнє повідомлення теж не лякає', humanizeEngineMessage('', 'gemini').startsWith('Модель Gemini'));
  t('нормальне повідомлення не переписується', humanizeEngineMessage('Модель відмовилась', 'gemini') === 'Модель відмовилась');
  t('підказка про перевантаження радить перемкнути рушій', busyMessage('gemini').includes('GPT') && busyMessage('gpt').includes('Gemini'));
  t('перевантаження позначене як те, що можна повторити', isRetryableFailure(new TextFromImageError('busy', 'x', 'gemini')));
  t('а «немає ключа» — ні', !isRetryableFailure(new TextFromImageError('no_key', 'x', 'gemini')));
  t('і звичайна помилка — ні', !isRetryableFailure(new Error('щось')));
}

console.log('\nПовтор при перевантаженні:');
{
  let calls = 0;
  const result = await withBusyRetry(async () => {
    calls += 1;
    if (calls < 3) throw new TextFromImageError('busy', 'перевантажено', 'gemini');
    return 'готово';
  });
  t('третя спроба проходить', result === 'готово' && calls === 3, String(calls));

  let hardCalls = 0;
  let thrown = '';
  try {
    await withBusyRetry(async () => {
      hardCalls += 1;
      throw new TextFromImageError('busy', 'перевантажено назовсім', 'gemini');
    });
  } catch (err) {
    thrown = (err as Error).message;
  }
  t('після вичерпання спроб помилка виходить нагору', thrown === 'перевантажено назовсім', thrown);
  t('і спроб рівно три, а не більше', hardCalls === 1 + BUSY_RETRY_DELAYS_MS.length, String(hardCalls));

  let keyCalls = 0;
  try {
    await withBusyRetry(async () => {
      keyCalls += 1;
      throw new TextFromImageError('no_key', 'немає ключа', 'gemini');
    });
  } catch { /* очікувано */ }
  t('невідворотну відмову не повторюємо жодного разу', keyCalls === 1, String(keyCalls));
}

console.log('\nСправжній шлях «зображення → текст» із підставним рушієм:');
{
  // 8 байтів підпису PNG — більшого не треба: `resolveImageBytes` читає
  // `data:`-URL локально, мережі тут немає.
  const dataUrl =
    'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const overload =
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';

  const stub = (failTimes: number) => {
    let calls = 0;
    const ai = {
      models: {
        generateContent: async () => {
          calls += 1;
          if (calls <= failTimes) throw new Error(overload);
          return { text: 'Опис персонажа.', usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 } };
        },
      },
    };
    return { ai, calls: () => calls };
  };

  const ok = stub(2);
  const result = await generateTextFromImage(ok.ai as never, 'gemini-2.5-flash', {
    engine: 'gemini',
    imageUrl: dataUrl,
  });
  t('перевантажений Gemini повторюється й таки віддає текст', result.text === 'Опис персонажа.', result.text);
  t('і це рівно три запити', ok.calls() === 3, String(ok.calls()));
  t(
    'токени беруться зі спроби, яка пройшла',
    result.usage.inputTokens === 12 && result.usage.outputTokens === 7,
    JSON.stringify(result.usage)
  );

  const broken = stub(99);
  let kind = '';
  let message = '';
  try {
    await generateTextFromImage(broken.ai as never, 'gemini-2.5-flash', { engine: 'gemini', imageUrl: dataUrl });
  } catch (err) {
    kind = err instanceof TextFromImageError ? err.kind : 'not-TextFromImageError';
    message = (err as Error).message;
  }
  t('постійне перевантаження виходить нагору як `busy`', kind === 'busy', kind);
  t('повідомлення — українською й без JSON', message.includes('перевантажений') && !message.includes('{'), message);
  t('і після трьох спроб воно зупиняється', broken.calls() === 3, String(broken.calls()));
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
