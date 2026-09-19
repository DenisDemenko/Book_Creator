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
  appendDescriptionToBook,
  appendDescriptionToInstruction,
  buildCourseFromDescription,
  descriptionSectionContent,
  descriptionWordCount,
  writerCoreFromBook,
  type DescriptionPayload,
} from '../src/utils/describeCharacterTransfer.ts';
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

console.log('\nРозділ у книзі:');
{
  const before = JSON.parse(JSON.stringify(emptyBook));
  const now = '2026-09-19T20:00:00.000Z';
  const updated = appendDescriptionToBook(emptyBook, payload, now);
  const chapters = updated.chapters;
  t('глав стало стільки ж', chapters.length === 2, String(chapters.length));
  t('розділ ліг в ОСТАННЮ главу', chapters[1].sections.length === 2);
  t('title узято з payload', chapters[1].sections[1].title === payload.title);
  t('order продовжує нумерацію глави', chapters[1].sections[1].order === 2, String(chapters[1].sections[1].order));
  t('chapterId вказує на свою главу', chapters[1].sections[1].chapterId === 'ch2');
  t('wordCount пораховано', chapters[1].sections[1].wordCount === descriptionWordCount(payload.text), String(chapters[1].sections[1].wordCount));
  t('lastModified — переданий час', chapters[1].sections[1].lastModified === now);
  t('абзаци стали <p>', chapters[1].sections[1].content.includes('<p>Перший абзац опису.</p>'));
  t('HTML у тексті екрановано', chapters[1].sections[1].content.includes('&lt;b&gt;не HTML&lt;/b&gt;'));
  t('фото вставлено тегом img', chapters[1].sections[1].content.startsWith('<img src="/api/media/file?id=abc&amp;x=1"'));
  t('книга НЕ змінена на місці', JSON.stringify(emptyBook) === JSON.stringify(before));
  t('перша глава недоторкана', chapters[0].sections.length === 0);
}

console.log('\nКнига без глав:');
{
  const bare = { ...emptyBook, chapters: [] } as unknown as Book;
  const updated = appendDescriptionToBook(bare, { title: '', text: 'Опис', photo: null });
  t('створено главу, щоб розділу було куди лягти', updated.chapters.length === 1);
  t('назва глави людська', updated.chapters[0].title === 'Опис персонажів');
  t('порожній заголовок замінено службовим', updated.chapters[0].sections[0].title === 'Опис персонажа (ШІ)');
}

console.log('\nБез фото — без img:');
{
  const content = descriptionSectionContent({ title: 'Х', text: 'Опис', photo: null });
  t('жодного тега img', !content.includes('<img'));
  t('текст на місці', content.includes('<p>Опис</p>'));
  t('одинарний перенос стає <br />', descriptionSectionContent({ title: 'Х', text: 'а\nб', photo: null }).includes('а<br />б'));
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

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);
