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
  /**
   * На яких remote цей коміт уже є. Визначається за локальними
   * remote-tracking ref — тобто без мережі й без ризику, що git почне
   * питати пароль посеред запиту. Ці ref оновлюються при push і fetch, а
   * оскільки власник пушить саме з цієї машини, для відповіді «що
   * запушено» їх достатньо.
   */
  pushedTo: string[];
}

/** Запис журналу log.md — те, ЧОМУ коміт існує. */
export interface JournalEntry {
  n: number;
  title: string;
  /** «✅ Зроблено», «⚠️ Частково» тощо — те, що в заголовку після «→». */
  status: string;
  /** Короткий уривок: постановка задачі, якщо її видно, інакше перший абзац. */
  excerpt: string;
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

function runGit(args: string[], extraEnv?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: process.cwd(),
        maxBuffer: 24 * 1024 * 1024,
        timeout: 20_000,
        env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
      },
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
      pushedTo: [],
      // Мердж має більше одного батька — у нього немає власного numstat,
      // і без цієї позначки він виглядав би як коміт, що нічого не змінив.
      isMerge: (parents || '').trim().split(/\s+/).filter(Boolean).length > 1,
    });
  }
  return out;
}


/** Текст `log.md` із теки запуску, або null, якщо файлу немає. */
function readJournal(): string | null {
  try {
    const file = path.join(process.cwd(), 'log.md');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Записи журналу `log.md` — заголовок, статус і короткий уривок.
 *
 * Навіщо в схемі комітів: тема коміта каже, ЩО змінилось, а запис
 * журналу — ЧОМУ це робилось і чим перевірено. На записи посилаються
 * дві третини комітів, тож без цього зв'язку схема лишалась би
 * причесаним `git log`.
 *
 * Повний текст запису тут НЕ віддається: `log.md` уже понад дев'ять тисяч
 * рядків, і слати його цілком на кожне відкриття вкладки — марно
 * витрачений трафік. Уривок для списку, повний текст — окремим запитом
 * за номером, коли власник розкриє коміт.
 */
export function parseJournal(md: string): Map<number, JournalEntry> {
  const entries = new Map<number, JournalEntry>();
  const lines = md.split('\n');
  let current: { n: number; title: string; status: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    entries.set(current.n, {
      n: current.n,
      title: current.title,
      status: current.status,
      excerpt: extractExcerpt(current.body),
    });
    current = null;
  };

  for (const line of lines) {
    // Заголовок запису: «## 150. Назва → ✅ Статус». Номер обов'язковий —
    // у файлі є й інші «##»-заголовки (стан гілок, вітрина, журнал сесій),
    // і вони записами не є.
    const head = line.match(/^##\s+(\d{1,3})\.\s+(.+)$/);
    if (head) {
      flush();
      const rest = head[2];
      // Статус у цьому журналі завжди починається з емодзі-позначки
      // («→ ✅ Зроблено», «→ 📋 Черга», «→ 🔧 Ядро зроблено»). Саме її й
      // вимагаємо, бо стрілка трапляється і В САМІЙ назві: запис
      // «Конвеєр публікації замкнено: макет → PDF → лістинг → файл»
      // статусу не має, і розбір «усе після останньої стрілки» відкусив
      // би від назви слово «файл». Ще у 42 із 98 записів статусу немає
      // зовсім — це старіші записи, і це нормально.
      const arrow = rest.lastIndexOf('→');
      const tail = arrow === -1 ? '' : rest.slice(arrow + 1).trim();
      const looksLikeStatus = /^[\u2700-\u27bf\u2b00-\u2bff\u2600-\u26ff\ufe0f\u{1f300}-\u{1faff}]/u.test(tail);
      current = {
        n: Number(head[1]),
        title: (looksLikeStatus ? rest.slice(0, arrow) : rest).trim(),
        status: looksLikeStatus ? tail : '',
        body: [],
      };
      continue;
    }
    // Будь-який інший заголовок рівня ## закриває поточний запис.
    if (line.startsWith('## ') || line.startsWith('# ')) {
      flush();
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();
  return entries;
}

/** Постановка задачі, якщо вона є в записі; інакше перший змістовний абзац. */
function extractExcerpt(body: string[]): string {
  const text = body.join('\n');
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^\*\*Сесія Claude/.test(p));

  const stated = paragraphs.find((p) => /^\*\*Постановка/.test(p));
  const chosen = stated || paragraphs[0] || '';
  // Розмітку прибираємо: у картці коміта вона тільки шумить.
  const plain = chosen.replace(/\*\*/g, '').replace(/`/g, '').trim();
  return plain.length > 400 ? `${plain.slice(0, 399)}…` : plain;
}

/** Повний текст одного запису — для розкритої картки коміта. */
export function extractEntryText(md: string, n: number): string | null {
  const lines = md.split('\n');
  const startPattern = new RegExp(`^##\\s+${n}\\.\\s`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ') || lines[i].startsWith('# ')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

/**
 * Які коміти вже є на кожному remote — за локальними remote-tracking ref.
 *
 * Свідомо БЕЗ мережі: `git ls-remote` для приватного репозиторію просить
 * логін, і в серверному процесі це означало б запит, що висить, поки не
 * впаде таймаут. Локальні ref дають ту саму відповідь для пушів, зроблених
 * із цієї машини, і дають її мгновенно. Звірка з GitHub — окремим
 * маршрутом на явну дію, там і таймаут, і GIT_TERMINAL_PROMPT=0.
 */
async function pushedSets(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  let refs = '';
  try {
    refs = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/']);
  } catch {
    return out;
  }
  for (const ref of refs.split('\n').map((r) => r.trim()).filter(Boolean)) {
    if (ref.endsWith('/HEAD')) continue;
    const remote = ref.split('/')[0];
    try {
      const list = await runGit(['rev-list', ref]);
      const hashes = new Set(list.split('\n').map((h) => h.trim()).filter(Boolean));
      const existing = out.get(remote);
      if (existing) for (const h of hashes) existing.add(h);
      else out.set(remote, hashes);
    } catch {
      /* ref без об'єктів — просто пропускаємо, це не причина валити запит */
    }
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

      // Де вже є кожен коміт
      const sets = await pushedSets();
      for (const c of commits) {
        for (const [remote, hashes] of sets) {
          if (hashes.has(c.hash)) c.pushedTo.push(remote);
        }
      }

      // Записи журналу — лише ті, на які справді хтось посилається.
      const journal: Record<number, JournalEntry> = {};
      const md = readJournal();
      if (md) {
        const parsed = parseJournal(md);
        const needed = new Set(commits.map((c) => c.journalEntry).filter((n): n is number => n !== null));
        for (const n of needed) {
          const entry = parsed.get(n);
          if (entry) journal[n] = entry;
        }
      }

      res.json({
        available: true,
        commits,
        journal,
        journalAvailable: !!md,
        remotes: [...sets.keys()].sort(),
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

  /** Повний текст одного запису журналу — коли власник розкриває коміт. */
  app.get('/api/admin/git/journal/:n', requireAdmin, async (req, res) => {
    const n = Number(req.params.n);
    if (!Number.isFinite(n) || n < 1 || n > 999) {
      return res.status(400).json({ error: 'Некоректний номер запису.' });
    }
    const md = readJournal();
    if (!md) return res.status(404).json({ error: 'Файл log.md недоступний у цьому запуску.' });
    const text = extractEntryText(md, Math.trunc(n));
    if (!text) return res.status(404).json({ error: `Запису #${Math.trunc(n)} у log.md немає.` });
    res.json({ n: Math.trunc(n), text });
  });

  /**
   * Звірка з GitHub — на явну дію, а не при кожному відкритті вкладки.
   *
   * `GIT_TERMINAL_PROMPT=0` тут обов'язковий: приватний репозиторій без
   * збережених облікових даних інакше змусив би git чекати введення
   * логіна, і запит висів би до таймауту. З ним git одразу віддає
   * помилку, і ми показуємо її як є — для `origin` (приватного) це
   * очікувано, для `production` (публічного) звірка проходить.
   */
  app.post('/api/admin/git/verify-remotes', requireAdmin, async (_req, res) => {
    if (!gitDir()) return res.status(400).json({ error: 'Немає теки .git — звіряти нічого.' });
    try {
      const names = (await runGit(['remote']))
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
      const head = (await runGit(['rev-parse', 'HEAD'])).trim();

      const results = await Promise.all(
        names.map(async (remote) => {
          try {
            const out = await runGit(['ls-remote', remote, 'master'], { GIT_TERMINAL_PROMPT: '0' });
            const hash = out.split(/\s+/)[0] || '';
            return {
              remote,
              ok: true,
              hash,
              shortHash: hash.slice(0, 7),
              upToDate: hash === head,
            };
          } catch (err: any) {
            return {
              remote,
              ok: false,
              error: String(err?.message || err).split('\n')[0].slice(0, 200),
            };
          }
        })
      );
      res.json({ head, shortHead: head.slice(0, 7), results });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message || err).slice(0, 300) });
    }
  });
}
