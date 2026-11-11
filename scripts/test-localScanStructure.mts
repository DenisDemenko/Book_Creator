/**
 * Тести розкладання розпізнаного тексту на курс, інструкцію й книгу БЕЗ ШІ (журнал #550). Запуск: npm run test:local-scan-structure
 *
 * Дані — типові тексти, які дає OCR: «--» замість тире, перенесення слів між рядками, номери сторінок, шапки на кожній сторінці.
 */
import { normalizePages, structureLocally } from '../shared/localScanStructure';
import { buildPrivateBook, buildPrivateCourse, buildPrivateInstruction } from '../src/utils/localScanBuild';

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const pg = (order: number, text: string) => ({ order, text });

// ---------------------------------------------------------------------------
console.log('\nНормалізація тексту');
const noisy = normalizePages([
  pg(1, 'Школа різьби\nРозділ 1. Матеріали\n\nЛипа добре ріже-\nться і не розколюється.\n\n- 1 -'),
  pg(2, 'Школа різьби\nУвага -- інструмент гострий.\n\n2'),
  pg(3, 'Школа різьби\nДубові заготовки сушать два роки.\n\n3'),
  pg(4, 'Школа різьби\nКінець розділу.\n\n4'),
]);
t('номери сторінок прибрано', !noisy.some((p) => /^\s*-?\s*\d+\s*-?\s*$/m.test(p)));
t('шапка, що повторюється на кожній сторінці, прибрана', noisy.every((p) => !/Школа різьби/.test(p)));
t('перенесення слова склеєно', /ріжеться/.test(noisy[0]));
t('«--» став тире', /Увага — інструмент/.test(noisy[1]));
t('сторінки зберігають порядок навіть якщо надійшли вперемішку', normalizePages([pg(2, 'друга'), pg(1, 'перша')]).join('|') === 'перша|друга');
t('шапка не прибирається на двох сторінках (може бути звичайним словом)', normalizePages([pg(1, 'Вступ\nТекст'), pg(2, 'Вступ\nІнший')]).every((p) => /Вступ/.test(p)));

// ---------------------------------------------------------------------------
console.log('\nКурс із розділами, анотацією, цілями й аудиторією');
const COURSE = `Курс «Основи різьблення по дереву»

Анотація
Практичний курс для початківців: від вибору заготовки до фінішного покриття.

Для кого
- початківці без досвіду
- майстри, які хочуть систематизувати знання

Результати навчання
- вибирати породу дерева під задум
- заточувати й тримати різці
- виконувати базові контурні різьблення

Модуль 1. Матеріали й інструмент

Урок 1. Породи дерева
Липа і вільха найкраще підходять для початку,
бо м'яко ріжуться. Дуб і горіх потребують досвіду.

Урок 2. Набір різців
Для старту вистачить п'яти різців.
- косяк для контуру
- жолобок для фону

Модуль 2. Перші роботи

Урок 3. Контурне різьблення
Починайте з простих орнаментів на липовій дошці.`;
const c = structureLocally({ kind: 'course', pages: [pg(1, COURSE.slice(0, 700)), pg(2, COURSE.slice(700))] });
const course = c.course!;
t('назва курсу — без слова «Курс» і лапок', course.title === 'Основи різьблення по дереву', course.title);
t('анотація, аудиторія й результати витягнуто з іменованих розділів, а не стали модулями', course.summary.startsWith('Практичний курс') && course.audience.length === 2 && course.outcomes.length === 3 && course.outcomes[1] === 'заточувати й тримати різці');
t('два модулі за заголовками «Модуль N»', course.modules.length === 2 && course.modules[0].title === 'Модуль 1. Матеріали й інструмент', course.modules.map((m) => m.title).join(' | '));
t('уроки лягли у свої модулі за заголовками «Урок N»', course.modules[0].lessons.map((l) => l.title).join('|') === 'Урок 1. Породи дерева|Урок 2. Набір різців' && course.modules[1].lessons.length === 1);
t('текст уроку зібрано в абзаци без розривів рядків', /Липа і вільха найкраще підходять для початку, бо м'яко ріжуться/.test(course.modules[0].lessons[0].body));
t('маркери уроку стали темами, а текст лишився цілим', course.modules[0].lessons[1].topics.join('|') === 'косяк для контуру|жолобок для фону' && /косяк для контуру/.test(course.modules[0].lessons[1].body));
t('структуру знайдено; статистика заповнена', c.structured && c.stats.headings >= 5 && c.stats.characters > 300);

const TIGHT = 'Курс «Основи різьблення по дереву»\n\nАнотація\n\nПрактичний курс для початківців.\nРезультати навчання\n\n- вибирати породу дерева\n\n- заточувати різці\n\nМодуль 1. Матеріали й інструмент\nУрок 1. Породи дерева\n\nЛипа і вільха добре підходять для початку.\nУрок 2. Набір різців\nДля старту вистачить п\'яти різців.';
const tight = structureLocally({ kind: 'course', pages: [pg(1, TIGHT)] }).course!;
t('OCR без порожніх рядків навколо «Результати навчання»: розділ усе одно впізнано, а анотація не з\'їла цілі', tight.outcomes.length === 2 && tight.summary === 'Практичний курс для початківців.' && tight.modules.length === 1 && tight.modules[0].lessons.length === 2, JSON.stringify({ o: tight.outcomes, s: tight.summary, m: tight.modules.length }));

console.log('\nКурс без заголовків і з нумерованими розділами');
const flat = structureLocally({ kind: 'course', title: 'Мій курс', pages: [pg(1, 'Перша сторінка тексту про матеріали.'), pg(2, 'Друга сторінка про інструмент.'), pg(3, 'Третя про фініш.'), pg(4, 'Четверта.'), pg(5, 'П\'ята.'), pg(6, 'Шоста.')] });
t('без заголовків уроки розкладено за сторінками, по п\'ять у модулі, і про це сказано', !flat.structured && flat.course!.modules.length === 2 && flat.course!.modules[0].lessons.length === 5 && flat.notes.some((n) => /Заголовків у тексті не знайдено/.test(n)));
t('задана назва має перевагу', flat.course!.title === 'Мій курс');
const numbered = structureLocally({ kind: 'course', pages: [pg(1, 'ОСНОВИ ЕЛЕКТРОБЕЗПЕКИ\n\nВступ\n\nЦей курс про безпеку.\n\n1. Загальні вимоги\n\nПрацюйте лише із заземленим обладнанням.\n\n1.1 Захисні засоби\n\nВикористовуйте діелектричні рукавички.\n\n2. Перша допомога\n\nВимкніть живлення перед допомогою.')] });
const nm = numbered.course!.modules;
t('нумеровані заголовки «1.», «1.1»: розділ стає модулем, підрозділ — уроком', nm.length >= 2 && nm.some((m) => /Загальні вимоги/.test(m.title) && m.lessons.some((l) => /Захисні засоби/.test(l.title))), nm.map((m) => m.title + ':' + m.lessons.map((l) => l.title).join('/')).join(' | '));
t('заголовок ВЕЛИКИМИ стає назвою, а не модулем', numbered.course!.title === 'Основи електробезпеки', numbered.course!.title);

// ---------------------------------------------------------------------------
console.log('\nІнструкція: комплектація, інструменти, кроки, застереження');
const INSTR = `Інструкція зі складання полиці «Нордик»

Комплектація:
A. Стійка бічна — 2 шт.
B. Полиця — 4 шт.
Кріплення М6 — 16 шт.

Інструменти: шестигранний ключ, викрутка

Увага! Складайте виріб удвох на рівній поверхні.

1. Покладіть бічну стійку на підлогу лицьовою стороною донизу.
2. Вставте кріплення М6 у отвори, позначені літерою А. Не затягуйте до кінця.
Увага: не перетягуйте гвинти.
3. Приєднайте нижню полицю та затягніть гвинти шестигранним ключем.
4. Повторіть кроки 1–3 для другої стійки.

Перевірка: виріб не хитається, зазори між полицями однакові.`;
const ir = structureLocally({ kind: 'instruction', modelCode: 'NRD-4', pages: [pg(1, INSTR)] });
const ins = ir.instruction!;
t('назва з першого рядка; код виробу береться з форми', ins.title === 'Інструкція зі складання полиці «Нордик»' && ins.modelCode === 'NRD-4');
t('комплектація: рядки розпізнано як деталі з кодом і кількістю', ins.materials.length === 3 && ins.materials[0].name === 'Стійка бічна' && ins.materials[0].qty === '2 шт' && ins.materials[0].code === 'A' && ins.materials[2].qty === '16 шт', JSON.stringify(ins.materials));
t('інструменти — окремі пункти', ins.tools.join('|') === 'шестигранний ключ|викрутка', ins.tools.join('|'));
t('чотири нумеровані кроки, у кожному назва й опис', ins.steps.length === 4 && ins.steps[0].title.startsWith('Покладіть бічну стійку') && ins.steps[2].title.startsWith('Приєднайте'), ins.steps.map((s) => s.title).join(' | '));
t('застереження всередині кроку не стало окремим кроком, а лягло в його поле', ins.steps[1].warning.startsWith('Увага') && /не перетягуйте/.test(ins.steps[1].warning) && !/Увага/.test(ins.steps[1].description) && ins.steps.length === 4);
t('загальне застереження винесено в «Безпеку»', ins.warnings.length >= 1 && /Складайте виріб удвох/.test(ins.warnings[0]));
t('фінальна перевірка виділена', ins.finalChecks.length >= 1 && /не хитається/.test(ins.finalChecks.join(' ')));
t('структуру знайдено, кроки пораховано', ir.structured && ir.stats.steps === 4);

const bare = structureLocally({ kind: 'instruction', pages: [pg(1, 'Як налаштувати лампу\n\nУвімкніть лампу в розетку. Дочекайтесь миготіння.\n\nНатисніть кнопку двічі.\n\nПеревірте яскравість.')] });
t('без нумерації кожен абзац — крок, і автору про це сказано', !bare.structured && bare.instruction!.steps.length >= 2 && bare.notes.some((n) => /Нумерованих кроків/.test(n)));
t('якщо комплектації й інструментів немає — підказка заповнити вручну', bare.notes.some((n) => /Комплектація/.test(n)));
const stepWord = structureLocally({ kind: 'instruction', pages: [pg(1, 'Складання столу\n\nКрок 1. Покладіть стільницю лицем вниз.\nКрок 2: Прикрутіть ніжки.\nКрок 3 — Переверніть стіл.')] });
t('«Крок N» теж розпізнається', stepWord.instruction!.steps.length === 3 && stepWord.instruction!.steps[1].title === 'Прикрутіть ніжки', stepWord.instruction!.steps.map((s) => s.title).join('|'));

// ---------------------------------------------------------------------------
console.log('\nКнига з рукопису');
const BOOK = `Долина тиші

Розділ 1. Млин

Старий млин стояв на краю села.
Вода давно перестала обертати колесо.

Вечір

Марко прийшов сюди востаннє.

Розділ 2. Дорога

Наступного ранку він вирушив на північ.`;
const bk = structureLocally({ kind: 'manuscript', pages: [pg(1, BOOK)] });
t('назва книги з першого рядка; два розділи за заголовками', bk.book!.title === 'Долина тиші' && bk.book!.chapters.length === 2 && bk.book!.chapters[0].title === 'Розділ 1. Млин', JSON.stringify(bk.book!.chapters.map((x) => x.title)));
t('абзаци розділу збережено; короткий рядок між абзацами не нашаткував текст', /Старий млин стояв на краю села\. Вода давно/.test(bk.book!.chapters[0].sections[0].content) && /Вечір/.test(bk.book!.chapters[0].sections[0].content));
t('кожен розділ має секцію з текстом', bk.book!.chapters.every((x) => x.sections.length >= 1 && x.sections[0].content.length > 10));
const plain = structureLocally({ kind: 'manuscript', title: 'Без розділів', pages: [pg(1, 'Просто суцільний текст без заголовків. Ще речення.'), pg(2, 'Продовження на другій сторінці.')] });
t('суцільний текст лягає в один розділ, і про це сказано', !plain.structured && plain.book!.chapters.length === 1 && plain.notes.some((n) => /в одному розділі/.test(n)) && /Продовження на другій/.test(plain.book!.chapters[0].sections[0].content));

console.log('\nПриватні матеріали зі структури');
const NOW = new Date('2026-11-11T12:00:00.000Z');
const pc = buildPrivateCourse(course, { storeId: 'pstore_test', id: 'crs_abc12345', now: NOW });
t('приватний курс: чернетка, власник «local», позначка сервера, модулі й уроки з id', pc.status === 'draft' && pc.privateStore?.storeId === 'pstore_test' && pc.modules.length === 2 && pc.modules[0].lessons.length === 2 && new Set(pc.modules.flatMap((m) => [m.id, ...m.lessons.map((l) => l.id)])).size === 5);
t('приватний курс: назва, анотація, аудиторія, результати й текст уроків перенесено', pc.title === 'Основи різьблення по дереву' && pc.audience.length === 2 && pc.outcomes.length === 3 && /Липа і вільха/.test(pc.modules[0].lessons[0].description ?? '') && pc.modules[0].lessons[1].topics.length === 2);
t('приватний курс без ціни й без ознак публікації', pc.priceMinor === undefined && pc.status !== 'published' && !('origin' in pc));
const pi = buildPrivateInstruction(ins, { storeId: 'pstore_test', docId: 'ins_abc12345', now: NOW, mode: 'assembly' });
t('приватна інструкція: тип «складання», позначка сервера, кроки й комплектація перенесено', pi.docType === 'assembly' && pi.privateStore?.docId === 'ins_abc12345' && pi.steps.length === 4 && pi.materials.length === 3 && pi.tools.length === 2 && pi.modelCode === 'NRD-4');
t('приватна інструкція: застереження кроку й фінальна перевірка на місці', pi.steps[1].warning.startsWith('Увага') && pi.finalChecks.length >= 1 && pi.steps.every((st) => !!st.id));
const emptyIns = buildPrivateInstruction({ ...ins, materials: [], tools: [], warnings: [], finalChecks: [], steps: [] }, { storeId: 'pstore_test', docId: 'ins_empty001', now: NOW, mode: 'operation' });
t('порожні розділи лишаються з одним порожнім рядком, як у конструкторі (редактор не ламається)', emptyIns.docType === 'usage' && emptyIns.steps.length === 1 && emptyIns.materials.length === 1 && emptyIns.tools.length === 1);
const pb = buildPrivateBook(bk.book!, { storeId: 'pstore_test', author: 'Авторка', now: NOW });
t('приватна книга: назва, два розділи з секціями й id, позначка сервера', pb.title === 'Долина тиші' && pb.chapters.length === 2 && pb.privateStore?.storeId === 'pstore_test' && pb.chapters[1].sections.length >= 1 && new Set(pb.chapters.flatMap((c) => [c.id, ...c.sections.map((x) => x.id)])).size === pb.chapters.length + pb.chapters.reduce((n, c) => n + c.sections.length, 0));
t('приватна книга: слова пораховано, секції належать своїм розділам', pb.chapters.every((c) => c.sections.every((x) => x.chapterId === c.id && x.wordCount > 0)) && /Розділ 1/.test(pb.chapters[0].title) && pb.versionHistory[0].tags.includes('Локально'));

console.log('\nМежі');
t('порожній текст — зрозуміле повідомлення, а не помилка', structureLocally({ kind: 'course', pages: [pg(1, '  \n ')] }).notes[0] === 'Розпізнаного тексту немає: спершу розпізнайте сторінки.');
t('сторінок немає — те саме', structureLocally({ kind: 'instruction', pages: [] }).notes.length === 1);
t('дуже довгий рядок без пробілів не вішає розбір', (() => {
  const started = Date.now();
  structureLocally({ kind: 'course', pages: [pg(1, 'a'.repeat(200000) + '\n\n' + 'Модуль 1\n' + 'б'.repeat(50000))] });
  return Date.now() - started < 2000;
})());
t('результат не містить нічого, чого не було в тексті: усі заголовки курсу є в джерелі', course.modules.every((m) => COURSE.includes(m.title.replace(/\.$/, ''))) && course.modules.every((m) => m.lessons.every((l) => COURSE.includes(l.title))));

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
