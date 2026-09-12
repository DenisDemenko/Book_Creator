/**
 * Історія комітів для адмінки — «схема всіх комітів від самого першого»
 * (прохання власника, запис #150).
 *
 * Джерело даних — живий `git log` у теці, з якої запущений сервер. Тому
 * розділ працює ЛИШЕ при локальному запуску: у проді застосунок їде
 * Docker-образом, куди тека `.git` не копіюється зовсім (та й не повинна —
 * це кілька десятків мегабайт історії в кожному образі). Це не обмеження,
 * яке колись «доробимо»: власник саме так і поставив задачу — «поки що
 * локально». Замість порожнього екрана на проді маршрут чесно повертає
 * `available: false` і причину, а вкладка показує пояснення.
 *
 * Безпека. `git` викликається через `execFile` зі списком аргументів, а не
 * через оболонку: жоден рядок звідси не склеюється в команду. Єдине, що
 * приходить з запиту — числовий `limit`, і він проходить через
 * `Number.isFinite` та затиск у межі. Маршрут під `requireAdmin`.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { requireAdmin } from './auth';

/**
 * Розділювачі у виводі `git log`: 0x1e між комітами, 0x1f між полями.
 *
 * Спершу тут стояв NUL (0x00) — здавалося б, найнадійніший розділювач.
 * Але Node.js ВІДМОВЛЯЄТЬСЯ запускати процес, якщо хоч один аргумент
 * містить NUL-байт («must be a string without null bytes»), тож маршрут
 * упав би на першому ж виклику. Зловив це тест на справжній історії до
 * того, як щось потрапило в інтерфейс.
 *
 * Тому в самому аргументі `--format` жодних керуючих символів немає —
 * стоять `%x1e`/`%x1f`, які підставляє байтами вже git. Аргумент
 * лишається чистим ASCII, а вивід має потрібні розділювачі.
 */
const REC = '\u001e';
const FLD = '\u001f';

const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 1000;

export interface GitCommit {
  hash: string;
  shortHash: string;
  /**
   * Дата АВТОРСТВА (ISO-8601 із зоною) — коли зміну зробили. Форматує вже
   * клієнт, у часовому поясі глядача.
   */
  date: string;
  /**
   * Дата ПОПАДАННЯ в цю історію. У комітів, застосованих патчем
   * (`git am` — саме так робота з хмарної сесії потрапляє в репозиторій
   * власника), вона пізніша за дату авторства, інколи на дні. Обидві
   * потрібні: без першої не видно, коли працювали, без другої —
   * незрозуміло, чому порядок у `git log` не збігається з календарем.
   */
  commitDate: string;
  author: string;
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  /**
   * Номер запису журналу (`log.md`), якщо коміт на нього посилається.
   * Саме цей зв'язок робить схему кориснішою за `git log`: 67 із 209
   * комітів називають запис, і з нього видно, ЧОМУ коміт існує.
   */
  journalEntry: number | null;
  isMerge: boolean;
}

function gitDir(): string | null {
  const candidate = path.join(process.cwd(), '.git');
  try {
    // `.git` буває й файлом — так виглядає worktree чи підмодуль.
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: process.cwd(), maxBuffer: 24 * 1024 * 1024, timeout: 20_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

/**
 * Витягує номер запису журналу з теми коміта.
 *
 * Обережно з `#`: у темах трапляються й посилання іншого роду («rev #1»),
 * тож беремо лише число з 1-3 цифр і відкидаємо явно не-журнальні
 * випадки. Помилитись тут не страшно — це підказка, а не дані.
 */
export function parseJournalEntry(subject: string): number | null {
  const match = subject.match(/#(\d{1,3})\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 999 ? n : null;
}

/** Розбір виводу `git log --numstat` у масив комітів. */
export function parseGitLog(raw: string): GitCommit[] {
  const out: GitCommit[] = [];
  for (const chunk of raw.split(REC)) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const head = lines.shift() || '';
    const [hash, date, commitDate, author, parents, ...subjectParts] = head.split(FLD);
    if (!hash || !date) continue;
    // Тема може містити 0x1f лише в патологічному випадку — склеюємо назад,
    // щоб не втратити хвіст замість того, щоб тихо його обрізати.
    const subject = subjectParts.join(FLD);

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      // numstat: «<додано>\t<вилучено>\t<шлях>»; «-» замість числа означає
      // двійковий файл — він змінився, але рядків у ньому не рахують.
      const cols = t.split('\t');
      if (cols.length < 3) continue;
      filesChanged += 1;
      const add = Number(cols[0]);
      const del = Number(cols[1]);
      if (Number.isFinite(add)) insertions += add;
      if (Number.isFinite(del)) deletions += del;
    }

    out.push({
      hash,
      shortHash: hash.slice(0, 7),
      date,
      commitDate: commitDate || date,
      author: author || '—',
      subject,
      filesChanged,
      insertions,
      deletions,
      journalEntry: parseJournalEntry(subject),
      // Мердж має більше одного батька — у нього немає власного numstat,
      // і без цієї позначки він виглядав би як коміт, що нічого не змінив.
      isMerge: (parents || '').trim().split(/\s+/).filter(Boolean).length > 1,
    });
  }
  return out;
}

export function registerGitHistoryRoutes(app: Express): void {
  app.get('/api/admin/git/commits', requireAdmin, async (req, res) => {
    if (!gitDir()) {
      return res.json({
        available: false,
        reason:
          'Історія комітів доступна лише при локальному запуску: у продакшн-образі теки .git немає — вона не копіюється в Docker навмисно.',
        commits: [],
      });
    }

    const askedRaw = Number(req.query.limit);
    const limit = Number.isFinite(askedRaw)
      ? Math.min(Math.max(Math.trunc(askedRaw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    try {
      const raw = await runGit([
        'log',
        `--max-count=${limit}`,
        '--date=iso-strict',
        '--numstat',
        '--format=%x1e%H%x1f%aI%x1f%cI%x1f%an%x1f%P%x1f%s',
      ]);
      // `git log` віддає коміти в топологічному порядку, а не за
      // календарем: застосовані патчем зберігають СВОЮ дату авторства,
      // тож у стрічці часу вони інакше стрибали б туди-сюди. Сортуємо
      // явно — стрічка має бути стрічкою.
      const commits = parseGitLog(raw).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      const total = Number((await runGit(['rev-list', '--count', 'HEAD'])).trim());

      res.json({
        available: true,
        commits,
        // `total` окремо від довжини списку: якщо історія довша за межу,
        // клієнт має сказати про це прямо, а не вдавати, що показав усе.
        total: Number.isFinite(total) ? total : commits.length,
        branch: (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).trim(),
      });
    } catch (err: any) {
      console.error('[git-history]', err?.message || err);
      res.status(500).json({
        available: false,
        reason: `Не вдалося прочитати історію: ${String(err?.message || err).slice(0, 300)}`,
        commits: [],
      });
    }
  });
}
