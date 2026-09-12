/**
 * Розбір журналу `log.md` — один парсер для всіх, хто його читає.
 *
 * Навіщо окремий модуль. Журнал читають три різні речі: маршрут схеми
 * комітів в адмінці, скрипт `journal:new` (щоб знати наступний номер) і
 * хук `pre-push` (щоб не пустити коміт із посиланням на запис, якого не
 * знайти). Поки парсер жив усередині маршруту, він був один, але
 * доступний одному — і саме тому помилку нижче ніхто не ловив.
 *
 * ТРИ ФОРМИ ЗАГОЛОВКІВ. Конвенція мінялась двічі за час роботи, і у файлі
 * лежать усі три покоління одночасно:
 *
 *   A. `## 150. Назва → ✅ Статус`            — записи 48–151
 *   B. `## #12 — Назва → ✅ Виконано`          — записи 1–47
 *   C. `## Сесія 05.09.2026 #06 — запис #118`  — записи 114–118
 *
 * Перша версія цього парсера знала лише форму A. Наслідок: зі 151 запису
 * знаходилось 99, а 52 коміти показували бейдж «log.md #N», який вів у
 * порожнечу — при тому, що записи були на місці. Помилка виглядала як
 * дірки в журналі, і я спершу так і доповів власнику. Дірок немає.
 *
 * Форма C потребує осторожності з двох причин:
 *  - у тому ж рядку є ДРУГЕ число — номер сесії (`#06`), і воно стоїть
 *    РАНІШЕ за номер запису, тож «перше число в рядку» дало б сесію;
 *  - є діапазонний різновид (`— записи #48–#124`), і це НЕ запис, а
 *    зведення за сесію. Якби такий заголовок вважався записом, він
 *    затер би 77 справжніх записів одним.
 * Тому форма C застосовується лише в однині й лише тоді, коли запису з
 * таким номером не дала жодна з форм A/B.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Текст журналу цілком — з `log.md` і, якщо вона є, з теки `log/`.
 *
 * Журнал розділено на частини (індекс + `log/NNN-NNN.md`), бо одним
 * файлом він доріс до 840 КБ, а кожна нова сесія читає його, щоб
 * відновити контекст. Читач мусить розуміти ОБИДВА розклади: до
 * розділення (один файл) і після (індекс плюс частини). Інакше будь-який
 * старий чекаут або розділ в адмінці зламався б на різниці розкладу.
 */
export function readJournalSource(cwd = process.cwd()): string | null {
  const parts: string[] = [];
  try {
    const index = path.join(cwd, 'log.md');
    if (fs.existsSync(index)) parts.push(fs.readFileSync(index, 'utf8'));
  } catch {
    /* немає чи не читається — нижче вирішимо, чи є взагалі що віддати */
  }
  try {
    const dir = path.join(cwd, 'log');
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        // Імена частин починаються з номерів, тож звичайне сортування
        // дає їх у порядку зростання записів.
        .sort();
      for (const f of files) parts.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  } catch {
    /* частини недоступні — віддамо хоч індекс */
  }
  return parts.length ? parts.join('\n\n') : null;
}

/** Один запис журналу — те, ЧОМУ коміт існує. */
export interface JournalEntry {
  n: number;
  title: string;
  /** «✅ Зроблено», «⚠️ Частково» тощо — те, що в заголовку після «→». */
  status: string;
  /** Постановка задачі, якщо її видно, інакше перший змістовний абзац. */
  excerpt: string;
  /** Якою формою заголовка знайдено — A, B чи C. Для діагностики. */
  form: 'A' | 'B' | 'C';
}

/** Заголовок форми A: `## 150. Назва → статус`. */
const HEAD_A = /^##\s+(\d{1,3})\.\s+(.+)$/;
/** Заголовок форми B: `## #12 — Назва → статус` (тире будь-яке). */
const HEAD_B = /^##\s+#(\d{1,3})\s*[—–-]\s+(.+)$/;
/**
 * Заголовок форми C в ОДНИНІ: `## Сесія 05.09.2026 #06 — запис #118`.
 * Число беремо саме після слова «запис», а не перше в рядку — перше тут
 * номер сесії. `(?!и)` відсікає «записи» (діапазон), бо це зведення.
 */
const HEAD_C = /^##\s+.*?—\s*запис(?!и)\s+#(\d{1,3})\s*$/;
/** Діапазонне зведення за сесію: `— записи #48–#124`. Записом НЕ є. */
const HEAD_C_RANGE = /^##\s+.*?—\s*записи\s+#\d{1,3}\s*[–—-]\s*#?\d{1,3}\s*$/;

/**
 * Позначка статусу завжди починається з емодзі. Саме її й вимагаємо, бо
 * стрілка трапляється і В САМІЙ назві: запис #78 «Конвеєр публікації
 * замкнено: макет → PDF → лістинг → файл» статусу не має, і розбір «усе
 * після останньої стрілки» відкушував від назви слово «файл». Ще в
 * половині записів статусу немає зовсім — це нормально.
 */
const STATUS_START =
  /^[✀-➿⬀-⯿☀-⛿️\u{1f300}-\u{1faff}]/u;

/** Розділяє «Назва → ✅ Статус» на назву й статус. */
export function splitTitleStatus(rest: string): { title: string; status: string } {
  const arrow = rest.lastIndexOf('→');
  const tail = arrow === -1 ? '' : rest.slice(arrow + 1).trim();
  const isStatus = STATUS_START.test(tail);
  return {
    title: (isStatus ? rest.slice(0, arrow) : rest).trim(),
    status: isStatus ? tail : '',
  };
}

interface Heading {
  n: number;
  title: string;
  status: string;
  form: 'A' | 'B' | 'C';
}

/**
 * Розбирає рядок як заголовок запису, або віддає null.
 *
 * Експортовано, бо тим самим розбором користуються і тест, і хук: якщо
 * форма заголовка колись зміниться вчетверте, місце для правки одне.
 */
export function parseHeading(line: string): Heading | null {
  const a = line.match(HEAD_A);
  if (a) return { n: Number(a[1]), ...splitTitleStatus(a[2]), form: 'A' };

  const b = line.match(HEAD_B);
  if (b) return { n: Number(b[1]), ...splitTitleStatus(b[2]), form: 'B' };

  // Діапазон перевіряємо ПЕРЕД одниною: зведення записом не є.
  if (HEAD_C_RANGE.test(line)) return null;
  const c = line.match(HEAD_C);
  if (c) {
    // У формі C назви в заголовку немає — там лише мітка сесії. Назву
    // беремо з першого жирного рядка тіла (це майже завжди суть запису:
    // «РІШЕННЯ ВЛАСНИКА: від Gamma відмовляємось…»), а якщо його немає —
    // лишаємо мітку сесії. Вигадувати назву з нічого не станемо.
    return { n: Number(c[1]), title: line.replace(/^##\s+/, '').trim(), status: '', form: 'C' };
  }
  return null;
}

/** Чи закриває цей рядок поточний запис (будь-який інший заголовок). */
function isSectionBreak(line: string): boolean {
  return line.startsWith('## ') || line.startsWith('# ');
}

/**
 * Усі записи журналу — заголовок, статус і короткий уривок.
 *
 * Повний текст тут НЕ віддається: журнал уже під дев'ять тисяч рядків, і
 * слати його цілком на кожне відкриття вкладки — марний трафік. Уривок
 * для списку, повний текст — окремим запитом, коли картку розкрили.
 */
export function parseJournal(md: string): Map<number, JournalEntry> {
  const primary = new Map<number, JournalEntry>();
  // Форма C складається окремо й доливається в кінці — лише туди, де
  // справжнього заголовка (A/B) не знайшлося. Інакше сесійна мітка
  // затирала б запис із назвою.
  const fallback = new Map<number, JournalEntry>();

  const lines = md.split('\n');
  let head: Heading | null = null;
  let body: string[] = [];

  const flush = () => {
    if (!head) return;
    const title = head.form === 'C' ? boldLead(body) || head.title : head.title;
    const entry: JournalEntry = {
      n: head.n,
      title,
      status: head.status,
      excerpt: extractExcerpt(body),
      form: head.form,
    };
    // Перший заголовок на номер виграє: журнал у зворотному порядку, але
    // дублів A/B на один номер у ньому немає — перевірено тестом.
    const target = head.form === 'C' ? fallback : primary;
    if (!target.has(head.n)) target.set(head.n, entry);
    head = null;
    body = [];
  };

  for (const line of lines) {
    const parsed = parseHeading(line);
    if (parsed) {
      flush();
      head = parsed;
      continue;
    }
    if (isSectionBreak(line)) {
      flush();
      continue;
    }
    if (head) body.push(line);
  }
  flush();

  for (const [n, entry] of fallback) if (!primary.has(n)) primary.set(n, entry);
  return primary;
}

/**
 * Назва для форми C, де в заголовку її немає — з першого рядка тіла.
 *
 * Тонкість, через яку перша версія дала запису #114 назву «Тема»: у
 * частині записів жирним виділена не суть, а ЯРЛИК («**Тема:** пуш
 * накопиченого…», «**Постановка.** …»). Тому короткий ярлик із двокрапкою
 * відкидається, і назва береться з тексту ПІСЛЯ нього.
 */
function boldLead(body: string[]): string {
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    let text = line.replace(/\*\*/g, '').replace(/`/g, '').trim();
    // «Тема:», «Постановка.», «Запит.» — це ярлик, а не назва.
    text = text.replace(/^[А-ЯЇІЄҐA-Z][а-яїієґa-z]{2,14}\s*[:.]\s*/u, '').trim();
    if (!text) continue;
    // Перше речення: далі вже подробиці, а в заголовок картки вони не влізуть.
    const sentence = text.split(/(?<=[.!?])\s/)[0].trim().replace(/[.:]$/, '');
    const chosen = sentence.length >= 12 ? sentence : text;
    return chosen.length <= 150 ? chosen : `${chosen.slice(0, 149)}…`;
  }
  return '';
}

/** Постановка задачі, якщо вона є в записі; інакше перший змістовний абзац. */
export function extractExcerpt(body: string[]): string {
  const paragraphs = body
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    // Позначка сесії — службовий рядок, не зміст запису.
    .filter((p) => p && !/^\*\*Сесія Claude/.test(p));

  const stated = paragraphs.find((p) => /^\*\*Постановка/.test(p));
  const chosen = stated || paragraphs[0] || '';
  const plain = chosen.replace(/\*\*/g, '').replace(/`/g, '').trim();
  return plain.length > 400 ? `${plain.slice(0, 399)}…` : plain;
}

/** Повний текст одного запису — для розкритої картки коміта. */
export function extractEntryText(md: string, n: number): string | null {
  const lines = md.split('\n');
  let start = -1;
  let fallbackStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const head = parseHeading(lines[i]);
    if (!head || head.n !== n) continue;
    if (head.form === 'C') {
      // Як і в parseJournal: сесійна мітка — лише підпора.
      if (fallbackStart === -1) fallbackStart = i;
      continue;
    }
    start = i;
    break;
  }
  if (start === -1) start = fallbackStart;
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isSectionBreak(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

/**
 * Витягує номер запису журналу з теми коміта.
 *
 * Обережно з `#`: у темах трапляються й посилання іншого роду, тож беремо
 * лише число з 1-3 цифр. Помилитись тут не страшно — це підказка.
 */
export function parseJournalEntry(subject: string): number | null {
  const match = subject.match(/#(\d{1,3})\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 999 ? n : null;
}
