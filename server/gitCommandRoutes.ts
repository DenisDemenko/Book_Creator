/**
 * Виконання git-операцій над вибраним комітом — маршрути для адмінки.
 *
 * ДЕ МЕЖА БЕЗПЕКИ. Вона тут, на сервері, а не в тому, які кнопки
 * намалював клієнт. Клієнт може підробити будь-яке тіло запиту, тож
 * правило «команди рівня `manual` не виконуються» перевіряється саме в
 * цьому файлі й ніде більше. Тест на це є окремий.
 *
 * ЧОГО ТУТ НЕМАЄ:
 *  - оболонки: усе через `execFile('git', [...])` зі списком аргументів,
 *    жоден рядок не склеюється в команду;
 *  - мережі: ні `push`, ні `fetch`, ні `pull`. Приватний репозиторій без
 *    логіну повісив би процес до таймауту, а пуш у цьому проєкті робить
 *    власник сам;
 *  - довільних аргументів: id команди шукається в каталозі, хеш
 *    перевіряється самим git (`rev-parse --verify`), ім'я теґа чи гілки —
 *    і власною перевіркою, і `check-ref-format`.
 *
 * ДОСТУП. Лише `requireAdmin` — рішення власника окремим питанням. Роль
 * «менеджер сайту», яку заводимо для чату підтримки, сюди не має доступу
 * взагалі.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { requireAdmin } from './auth';
import {
  GIT_COMMANDS,
  buildArgs,
  commandById,
  isPlausibleHash,
  isSafeRefName,
  renderDisplay,
} from './gitCommands';

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 200_000;

function repoAvailable(): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), '.git'));
  } catch {
    return false;
  }
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: process.cwd(),
        maxBuffer: 24 * 1024 * 1024,
        timeout: TIMEOUT_MS,
        // Навіть попри те, що мережевих команд тут немає: якщо якась
        // колись з'явиться помилково, вона впаде одразу, а не зависне.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || '').slice(0, MAX_OUTPUT),
          stderr: String(stderr || err?.message || '').slice(0, 4000),
        });
      }
    );
  });
}

/** Чи є незакомічені зміни. Порожній вивід `status --porcelain` = чисто. */
async function isTreeDirty(): Promise<boolean> {
  const res = await runGit(['status', '--porcelain']);
  return res.ok && res.stdout.trim().length > 0;
}

/**
 * Чи не застряг репозиторій у півстані від попередньої операції.
 *
 * `git revert` і `git cherry-pick` при конфлікті лишають по собі
 * `.git/sequencer` (або `CHERRY_PICK_HEAD`/`REVERT_HEAD`), і наступна
 * така операція відмовиться працювати з незрозумілою для власника
 * помилкою. Краще сказати це своїми словами й одразу дати команду виходу.
 */
function pendingOperation(): string | null {
  const g = path.join(process.cwd(), '.git');
  try {
    if (fs.existsSync(path.join(g, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
    if (fs.existsSync(path.join(g, 'REVERT_HEAD'))) return 'revert';
    if (fs.existsSync(path.join(g, 'MERGE_HEAD'))) return 'merge';
    if (fs.existsSync(path.join(g, 'rebase-merge')) || fs.existsSync(path.join(g, 'rebase-apply'))) {
      return 'rebase або git am';
    }
  } catch {
    /* не змогли подивитись — не причина блокувати */
  }
  return null;
}

export function registerGitCommandRoutes(app: Express): void {
  /** Каталог команд — щоб клієнт не тримав другу копію цих текстів. */
  app.get('/api/admin/git/commands', requireAdmin, (_req, res) => {
    res.json({
      available: repoAvailable(),
      commands: GIT_COMMANDS.map((c) => ({
        id: c.id,
        label: c.label,
        display: c.display,
        tooltip: c.tooltip,
        tier: c.tier,
        needsName: !!c.needsName,
        namePlaceholder: c.namePlaceholder || '',
        needsCleanTree: !!c.needsCleanTree,
        abortHint: c.abortHint || '',
        // Клієнт має знати це явно, а не вгадувати з рівня.
        executable: c.tier !== 'manual',
        danger: !!c.danger,
      })),
    });
  });

  app.post('/api/admin/git/run', requireAdmin, async (req, res) => {
    if (!repoAvailable()) {
      return res.status(400).json({
        error:
          'Історія комітів доступна лише при локальному запуску: у продакшн-образі теки .git немає.',
      });
    }

    const id = String(req.body?.commandId || '');
    const hashRaw = String(req.body?.hash || '').trim();
    const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    const spec = commandById(id);
    if (!spec) return res.status(400).json({ error: 'Невідома команда.' });

    // ГОЛОВНЕ ПРАВИЛО. Перевіряється тут, бо клієнтові вірити не можна:
    // кнопки для цих команд лише копіюють текст, але запит можна надіслати
    // й без кнопок.
    if (spec.tier === 'manual') {
      return res.status(400).json({
        error:
          `Команда «${spec.label}» з панелі не виконується — ні кнопкою, ні запитом. ` +
          'Скопіюй готову команду й запусти в терміналі, де видно конфлікти ' +
          'і можна їх розв\'язати.',
        display: isPlausibleHash(hashRaw) ? renderDisplay(spec, hashRaw, nameRaw) : spec.display,
        tier: spec.tier,
      });
    }

    if (!isPlausibleHash(hashRaw)) {
      return res.status(400).json({ error: 'Хеш коміта має бути 7–40 шістнадцяткових символів.' });
    }

    // Хеш перевіряє сам git: він і скаже, чи це справді коміт цього
    // репозиторію. Власна перевірка вище — лише щоб не передавати git
    // відкровене сміття.
    const verified = await runGit(['rev-parse', '--verify', '--end-of-options', `${hashRaw}^{commit}`]);
    if (!verified.ok) {
      return res.status(400).json({ error: `Коміта ${hashRaw} у цьому репозиторії немає.` });
    }
    const hash = verified.stdout.trim();

    let name = '';
    if (spec.needsName) {
      if (!isSafeRefName(nameRaw)) {
        return res.status(400).json({
          error:
            'Ім’я може містити латинські літери, цифри, точку, підкреслення, дефіс і слеш; ' +
            'не може починатися з дефіса чи слеша й не може містити «..».',
        });
      }
      const fmt = await runGit(['check-ref-format', '--allow-onelevel', nameRaw]);
      if (!fmt.ok) {
        return res.status(400).json({ error: `Git вважає ім’я «${nameRaw}» некоректним.` });
      }
      name = nameRaw;
    }

    // Півстан від попередньої операції — окремо від «брудного дерева»,
    // бо причина інша й вихід інший.
    const pending = pendingOperation();
    if (pending && spec.tier === 'add') {
      return res.status(409).json({
        error:
          `Репозиторій зараз посеред незавершеної операції (${pending}). ` +
          'Спершу заверши або скасуй її — інакше git відмовиться, а стан заплутається.',
        pending,
      });
    }

    if (spec.needsCleanTree && (await isTreeDirty())) {
      return res.status(409).json({
        error:
          `«${spec.label}» вимагає, щоб незакомічених змін не було. Зараз вони є, ` +
          'і при конфлікті вони змішалися б із результатом операції — розплутати це ' +
          'було б важко. Закоміть або відкладіть їх (git stash) і повтори.',
        dirty: true,
      });
    }

    const args = buildArgs(spec, hash, name);
    const result = await runGit(args);

    // Конфлікт — не «помилка сервера», а очікуваний хід подій, який
    // власник має зрозуміти без читання виводу git.
    const conflicted = !result.ok && /conflict|CONFLICT|could not apply/i.test(`${result.stdout}\n${result.stderr}`);

    res.status(result.ok ? 200 : conflicted ? 409 : 400).json({
      ok: result.ok,
      commandId: spec.id,
      tier: spec.tier,
      display: renderDisplay(spec, hash.slice(0, 9), name),
      hash,
      output: result.stdout,
      error: result.ok ? '' : result.stderr,
      conflicted,
      abortHint: conflicted ? spec.abortHint || '' : '',
      note: conflicted
        ? 'Зміни не наклалися автоматично — є конфлікт. Репозиторій зараз у півстані: ' +
          'або розв’яжи конфлікт у терміналі, або скасуй операцію командою нижче.'
        : '',
    });
  });
}
