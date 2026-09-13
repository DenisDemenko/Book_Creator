/**
 * Тести поділу рукопису на глави (src/utils/manuscriptImport.ts).
 * Запуск: npm run test:manuscript-import
 *
 * ЧОМУ ЦЕ ВАРТО ПЕРЕВІРЯТИ. Тут два виправлені дефекти, які легко повернути
 * назад і які обидва видно лише на справжній книзі:
 *   1. Текст ДО першого заголовка раніше мовчки зникав (на рукописі автора —
 *      понад тисяча слів титулу й анотації). Тепер він стає главою «Вступ».
 *   2. Заголовки, виділені жирним (`**Глава 1. Назва**`), не розпізнавались
 *      зовсім: .docx давав ОДНУ главу на всю книгу.
 */
import { parseManuscriptText } from '../src/utils/manuscriptImport.ts';

let passed = 0;
let failed = 0;
function t(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const chapterWords = (text: string) =>
  parseManuscriptText(text, 'b').chapters.reduce(
    (sum, ch) => sum + ch.sections.reduce((s, sec) => s + sec.wordCount, 0),
    0
  );

function main() {
  console.log('\nЗаголовки, виділені жирним (як у Word):');
  {
    const text = '**Глава 1. Початок**\n\nТіло першої.\n\n**Глава 2. Далі**\n\nТіло другої.';
    const r = parseManuscriptText(text, 'book-1');
    t('заголовки знайдено', r.headingsDetected, String(r.headingsDetected));
    t('глав дві', r.chapters.length === 2, String(r.chapters.length));
    t('зірочки з назви прибрано', r.chapters[0]?.title === 'Глава 1. Початок', r.chapters[0]?.title);
    t('тіло глави на місці', r.chapters[0]?.sections[0]?.content === 'Тіло першої.', r.chapters[0]?.sections[0]?.content);
  }

  console.log('\nТекст до першого заголовка (титул і анотація):');
  {
    const text = 'САМОУЧИТЕЛЬ ДЛЯ АРХАТА\n\nДеменко Денис\n\nАнотація книги.\n\nГлава 1. В одиночестві\n\nТіло глави.';
    const r = parseManuscriptText(text, 'book-1');
    t('глав дві: вступ і глава', r.chapters.length === 2, String(r.chapters.length));
    t('перша глава — «Вступ»', r.chapters[0]?.title === 'Вступ', r.chapters[0]?.title);
    t('титул не загублено', r.chapters[0]?.sections[0]?.content.includes('САМОУЧИТЕЛЬ ДЛЯ АРХАТА'));
    t('анотація не загублена', r.chapters[0]?.sections[0]?.content.includes('Анотація книги.'));
    t('порядок глав збережено', r.chapters[0]?.order === 1 && r.chapters[1]?.order === 2, `${r.chapters[0]?.order}/${r.chapters[1]?.order}`);
  }

  console.log('\nСлова: нічого не втрачено:');
  {
    const text = 'Вступний текст із кількома словами тут.\n\nГлава 1. Назва\n\nТекст глави з іншими словами.';
    const r = parseManuscriptText(text, 'book-1');
    const preambleWords = r.chapters[0]?.sections[0]?.wordCount || 0;
    t('сума слів глав дорівнює загальному лічильнику', r.totalWords === chapterWords(text), `${r.totalWords} проти ${chapterWords(text)}`);
    t('слова вступу враховано', preambleWords > 0, String(preambleWords));
  }

  console.log('\nОдна глава, коли заголовків немає:');
  {
    const text = 'Просто текст без жодного заголовка.\n\nІ другий абзац.';
    const r = parseManuscriptText(text, 'book-1');
    t('headingsDetected = false', r.headingsDetected === false);
    t('одна глава', r.chapters.length === 1, String(r.chapters.length));
    t('увесь текст у ній', r.chapters[0]?.sections[0]?.content === text, r.chapters[0]?.sections[0]?.content);
  }

  console.log('\nІнші форми заголовків:');
  {
    const md = parseManuscriptText('# Розділ перший\n\nТекст.', 'b');
    t('markdown `# …` розпізнано', md.headingsDetected && md.chapters[0]?.title === 'Розділ перший', md.chapters[0]?.title);

    const roman = parseManuscriptText('Розділ IV: Назва\n\nТекст.', 'b');
    t('«Розділ IV: Назва» розпізнано', roman.headingsDetected && roman.chapters[0]?.title === 'Розділ IV: Назва', roman.chapters[0]?.title);

    const part = parseManuscriptText('**Часть I.**\n\nТекст.', 'b');
    t('голий «Часть I.» главою НЕ стає (свідомо)', part.headingsDetected === false, part.chapters[0]?.title);

    const crlf = parseManuscriptText('Вступ.\r\n\r\nГлава 1. Назва\r\n\r\nТіло.', 'b');
    t('CRLF не ламає розбір', crlf.chapters.length === 2, String(crlf.chapters.length));
  }

  console.log('\nПорожній вхід:');
  {
    const empty = parseManuscriptText('', 'b');
    t('порожній текст → жодної глави', empty.chapters.length === 0 && empty.totalWords === 0);
    const spaces = parseManuscriptText('   \n\n  ', 'b');
    t('самий лише пробіл → жодної глави', spaces.chapters.length === 0);
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();
