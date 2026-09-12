/**
 * Панель git-операцій над вибраним комітом.
 *
 * Постановка власника: «десять найуживаніших функцій кнопочками, з
 * вибором номера коміта або введенням вручну, і до кожної кнопочки
 * пояснення — що саме робить команда — при піднесенні мишкою».
 *
 * ЧОМУ ПІДКАЗКА СВОЯ, А НЕ `title`. Штатний `title` браузера з'являється
 * за секунду-дві, обрізається і не переносить рядки — а тут пояснення на
 * два-три рядки, і власник просив саме ЧИТАТИ його. Тому підказка
 * намальована сама: з'являється відразу, повним текстом, із переносами.
 *
 * ЧОМУ КАТАЛОГ ПРИХОДИТЬ ІЗ СЕРВЕРА. Підписи, пояснення й рівень
 * небезпеки описані один раз у `server/gitCommands.ts`. Якби клієнт
 * тримав другу копію цих текстів, вони б розійшлися — а розійшовшись,
 * підказка почала б брехати про те, що команда робить. Це найгірший
 * можливий баг у такій панелі.
 *
 * ЩО ТУТ НЕ Є ЗАХИСТОМ. Те, що небезпечні кнопки намальовані окремо і
 * нічого не надсилають, — зручність, а не безпека: захист живе на
 * сервері, який відмовляє таким командам незалежно від того, що
 * надіслав клієнт.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Copy, Loader2, Play, Terminal } from 'lucide-react';

export interface GitCommandInfo {
  id: string;
  label: string;
  display: string;
  tooltip: string;
  tier: 'read' | 'add' | 'manual';
  needsName: boolean;
  namePlaceholder: string;
  needsCleanTree: boolean;
  abortHint: string;
  executable: boolean;
  danger: boolean;
}

interface RunResult {
  ok: boolean;
  commandId?: string;
  display?: string;
  output?: string;
  error?: string;
  conflicted?: boolean;
  abortHint?: string;
  note?: string;
  pending?: string;
  dirty?: boolean;
}

interface Props {
  /** Коміти зі схеми — для вибору зі списку. */
  commits: { hash: string; shortHash: string; subject: string; author: string; date: string }[];
  /** Коміт, вибраний кліком у схемі; панель підхоплює його. */
  presetHash?: string | null;
  /**
   * Зростає з кожним кліком по хешу у схемі. Без нього повторний клік по
   * ТОМУ САМОМУ коміту нічого не робив: `useEffect` реагує на зміну
   * значення, а значення те саме — тож якщо власник стер поле руками й
   * клікнув той самий хеш, поле лишалось порожнім.
   */
  presetNonce?: number;
  /** Щоб схема перезавантажилась після revert / tag / branch. */
  onChanged?: () => void;
}

const TIER_TITLE: Record<GitCommandInfo['tier'], string> = {
  read: 'Перегляд — нічого не змінює',
  add: 'Додає новий об’єкт — історію не переписує',
  manual: 'Панель не виконує — готує команду для термінала',
};

const TIER_NOTE: Record<GitCommandInfo['tier'], string> = {
  read: 'Ці команди лише читають історію. Натискати можна без побоювань.',
  add: 'Створюють новий коміт, теґ або гілку. Нічого не зникає, будь-що можна відкотити.',
  manual:
    'Ці команди панель не виконує принципово: конфлікти з веб-панелі не розв’язати, ' +
    'а помилковий клік по «скинути» знищив би роботу назавжди. Кнопка готує точну ' +
    'команду з підставленим хешем — запускай у терміналі.',
};

export const GitCommandPanel: React.FC<Props> = ({ commits, presetHash, presetNonce, onChanged }) => {
  const [catalog, setCatalog] = useState<GitCommandInfo[]>([]);
  const [available, setAvailable] = useState(true);
  const [hash, setHash] = useState('');
  const [name, setName] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [prepared, setPrepared] = useState<{ cmd: string; label: string; danger: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState<{ id: string; top: number; left: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/git/commands', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        setAvailable(!!data.available);
        setCatalog(Array.isArray(data.commands) ? data.commands : []);
      } catch {
        setAvailable(false);
      }
    })();
  }, []);

  // Клік по коміту у схемі підставляє його хеш — щоб не переписувати руками.
  useEffect(() => {
    if (presetHash) setHash(presetHash);
  }, [presetHash, presetNonce]);

  const groups = useMemo(
    () => ({
      read: catalog.filter((c) => c.tier === 'read'),
      add: catalog.filter((c) => c.tier === 'add'),
      manual: catalog.filter((c) => c.tier === 'manual'),
    }),
    [catalog]
  );

  const hashValid = /^[0-9a-fA-F]{7,40}$/.test(hash.trim());
  const active = activeId ? catalog.find((c) => c.id === activeId) : null;

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* буфер може бути недоступний — текст усе одно видно й можна виділити */
    }
  }, []);

  const prepare = useCallback(
    (cmd: GitCommandInfo) => {
      const h = hash.trim() || '<хеш>';
      const text = cmd.display
        .replace('<хеш>', h)
        .replace('<ім’я>', name.trim() || '<ім’я>');
      setResult(null);
      setActiveId(cmd.id);
      setPrepared({ cmd: text, label: cmd.label, danger: cmd.danger });
      void copy(text);
    },
    [hash, name, copy]
  );

  const run = useCallback(
    async (cmd: GitCommandInfo) => {
      if (!hashValid) return;
      if (cmd.needsName && !name.trim()) {
        setActiveId(cmd.id);
        setResult({ ok: false, error: `Для «${cmd.label}» потрібне ім’я — введи його в полі нижче.` });
        return;
      }
      setActiveId(cmd.id);
      setPrepared(null);
      setBusyId(cmd.id);
      setResult(null);
      try {
        const res = await fetch('/api/admin/git/run', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commandId: cmd.id, hash: hash.trim(), name: name.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        setResult({ ...data, ok: res.ok && !!data.ok });
        // Після revert / tag / branch історія змінилась — схему треба
        // перечитати, інакше власник дивиться на застарілий список.
        if (res.ok && data.ok && cmd.tier === 'add') onChanged?.();
      } catch (err: any) {
        setResult({ ok: false, error: err?.message || 'Запит не вдався.' });
      } finally {
        setBusyId(null);
      }
    },
    [hash, hashValid, name, onChanged]
  );

  /**
   * Позиція підказки — у КООРДИНАТАХ ВІКНА; сама вона `fixed` і рендериться
   * ПОРТАЛОМ у `document.body`, а не всередині панелі.
   *
   * Це не педантизм — так полагоджено справжній баг, який власник зустрів
   * би відразу: наведи мишку на команду (щоб прочитати пояснення — саме
   * те, про що він і просив), потім клікни по хешу в стрічці — і клік не
   * працює.
   *
   * Причину знайшло трасування подій: `mousedown` приходив на кнопку хеша,
   * а `mouseup` — уже на інший елемент, тож браузер видавав `click`
   * спільному батькові, і обробник кнопки не викликався ніколи.
   *
   * А зсув був такий. Групи кнопок мали `mb-2.5 last:mb-0`. Коли підказка
   * вставлялась як ОСТАННЯ дитина панелі, остання група переставала бути
   * `:last-child`, `last:mb-0` вимикався, і повертався відступ `mb-2.5` —
   * рівно **10px**. Панель ставала на 10px вища, усе нижче з'їжджало, і
   * з'їжджало саме між натисканням і відпусканням кнопки.
   *
   * Тобто винен був не `absolute` (моя перша гіпотеза, і вона не
   * підтвердилась — переведення на `fixed` нічого не змінило), а ПОРЯДОК
   * дітей у поєднанні з `last:`-варіантом. Портал прибирає причину
   * повністю: підказка більше не дитина панелі, тож не може впливати ні на
   * `:last-child`, ні на висоту. Проміжки між групами задані контейнером
   * (`space-y`), щоб порядок дітей узагалі нічого не вирішував.
   */
  const showTip = useCallback((id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const W = 300;
    const H = 170;
    // Не даємо вилізти за край вікна: інакше пояснення, яке власник
    // просив ЧИТАТИ, обрізалося б по правому краю або знизу.
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8));
    const below = r.bottom + 6;
    const top = below + H > window.innerHeight - 8 ? Math.max(8, r.top - H - 6) : below;
    setHover({ id, top, left });
  }, []);

  if (!available) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-[12px] text-amber-200/90">
        Команди над комітами доступні лише при локальному запуску — у продакшн-образі теки
        <code className="mx-1">.git</code> немає.
      </div>
    );
  }

  const btnBase =
    'relative text-left rounded-lg border px-2.5 py-2 text-[11.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  const renderButton = (cmd: GitCommandInfo) => {
    const isBusy = busyId === cmd.id;
    const isActive = activeId === cmd.id;
    const tone = cmd.danger
      ? 'border-rose-500/35 bg-rose-500/[0.07] text-rose-200 hover:bg-rose-500/[0.14]'
      : cmd.tier === 'manual'
        ? 'border-slate-500/30 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
        : cmd.tier === 'add'
          ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200 hover:bg-emerald-500/[0.12]'
          : 'border-cyan-500/25 bg-cyan-500/[0.05] text-cyan-100 hover:bg-cyan-500/[0.11]';
    return (
      <button
        key={cmd.id}
        type="button"
        data-cmd={cmd.id}
        data-tier={cmd.tier}
        disabled={cmd.executable && !hashValid}
        onClick={() => (cmd.executable ? run(cmd) : prepare(cmd))}
        onMouseEnter={(e) => showTip(cmd.id, e.currentTarget)}
        onMouseLeave={() => setHover((h) => (h?.id === cmd.id ? null : h))}
        onFocus={(e) => showTip(cmd.id, e.currentTarget)}
        onBlur={() => setHover((h) => (h?.id === cmd.id ? null : h))}
        className={`${btnBase} ${tone} ${isActive ? 'ring-1 ring-white/25' : ''}`}
      >
        <span className="flex items-center gap-1.5">
          {isBusy ? (
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          ) : cmd.executable ? (
            <Play className="w-3 h-3 shrink-0 opacity-70" />
          ) : cmd.danger ? (
            <AlertTriangle className="w-3 h-3 shrink-0" />
          ) : (
            <Terminal className="w-3 h-3 shrink-0 opacity-70" />
          )}
          <span className="min-w-0">{cmd.label}</span>
        </span>
        <span className="mt-0.5 block font-mono text-[9.5px] opacity-55 truncate">{cmd.display}</span>
      </button>
    );
  };

  const hovered = hover ? catalog.find((c) => c.id === hover.id) : null;

  return (
    <div className="relative rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h3 className="text-[12px] font-semibold text-slate-200">Команди над комітом</h3>
        <span className="text-[10px] text-slate-500">
          наведи мишкою на кнопку — з’явиться пояснення
        </span>
      </div>

      {/* ── Вибір коміта: зі списку або вручну ── */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] mb-2">
        <select
          aria-label="Вибрати коміт зі списку"
          value={commits.some((c) => c.hash === hash) ? hash : ''}
          onChange={(e) => setHash(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/25 px-2 py-1.5 text-[11.5px] text-slate-200"
        >
          <option value="">— вибери коміт зі списку —</option>
          {commits.slice(0, 400).map((c) => (
            <option key={c.hash} value={c.hash}>
              {c.shortHash} · {c.subject.slice(0, 70)}
            </option>
          ))}
        </select>
        <input
          aria-label="Хеш коміта вручну"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="або хеш вручну: a63caff"
          spellCheck={false}
          className={`w-full sm:w-[210px] rounded-lg border bg-black/25 px-2 py-1.5 font-mono text-[11.5px] text-slate-200 ${
            hash && !hashValid ? 'border-rose-500/50' : 'border-[var(--border-subtle)]'
          }`}
        />
      </div>
      {hash && !hashValid && (
        <p className="mb-2 text-[10.5px] text-rose-300/90">
          Хеш — від 7 до 40 шістнадцяткових символів (0–9, a–f).
        </p>
      )}

      {active?.needsName && (
        <div className="mb-2">
          <input
            aria-label={`Ім’я для ${active.label}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={active.namePlaceholder}
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-black/25 px-2 py-1.5 text-[11.5px] text-slate-200"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Латиниця, цифри, точка, дефіс, підкреслення і слеш. Після введення натисни кнопку ще раз.
          </p>
        </div>
      )}

      {/* ── Кнопки за трьома групами ── */}
      <div className="space-y-2.5">
      {(['read', 'add', 'manual'] as const).map((tier) => (
        groups[tier].length > 0 && (
          <div key={tier}>
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  tier === 'manual' ? 'text-rose-300/80' : tier === 'add' ? 'text-emerald-300/80' : 'text-cyan-300/80'
                }`}
              >
                {TIER_TITLE[tier]}
              </span>
              <span className="h-px flex-1 bg-white/[0.06]" />
            </div>
            <p className="mb-1.5 text-[10px] leading-snug text-slate-500">{TIER_NOTE[tier]}</p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {groups[tier].map(renderButton)}
            </div>
          </div>
        )
      ))}
      </div>

      {/* ── Підказка при наведенні ── */}
      {hovered && hover && createPortal(
        <div
          role="tooltip"
          data-tooltip-for={hovered.id}
          style={{ top: hover.top, left: hover.left }}
          className="pointer-events-none fixed z-50 w-[300px] rounded-lg border border-white/15 bg-[#0b1220] p-2.5 shadow-xl"
        >
          <p className="mb-1 font-mono text-[10px] text-slate-400">{hovered.display}</p>
          <p className={`text-[11px] leading-relaxed ${hovered.danger ? 'text-rose-200' : 'text-slate-200'}`}>
            {hovered.tooltip}
          </p>
          {!hovered.executable && (
            <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[10px] text-slate-400">
              Кнопка не виконує команду — копіює її в буфер, щоб запустити в терміналі.
            </p>
          )}
        </div>,
        document.body
      )}

      {/* ── Готова команда для термінала ── */}
      {prepared && (
        <div
          className={`mt-2.5 rounded-lg border p-2.5 ${
            prepared.danger ? 'border-rose-500/40 bg-rose-500/[0.07]' : 'border-slate-500/30 bg-white/[0.03]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className={`text-[11px] font-semibold ${prepared.danger ? 'text-rose-200' : 'text-slate-200'}`}>
              {prepared.danger ? '⚠️ Запускати свідомо: ' : 'Готова команда: '}
              {prepared.label}
            </span>
            <button
              type="button"
              onClick={() => copy(prepared.cmd)}
              className="flex items-center gap-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'скопійовано' : 'копіювати'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-slate-100">
            {prepared.cmd}
          </pre>
          {prepared.danger && (
            <p className="mt-1.5 text-[10.5px] leading-snug text-rose-200/90">
              Панель цю команду не виконує й не виконає: сервер відмовляє їй незалежно від кнопок.
            </p>
          )}
        </div>
      )}

      {/* ── Результат виконання ── */}
      {result && (
        <div
          data-result={result.ok ? 'ok' : result.conflicted ? 'conflict' : 'error'}
          className={`mt-2.5 rounded-lg border p-2.5 ${
            result.ok
              ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
              : result.conflicted
                ? 'border-amber-500/35 bg-amber-500/[0.06]'
                : 'border-rose-500/35 bg-rose-500/[0.06]'
          }`}
        >
          {result.display && (
            <p className="mb-1.5 font-mono text-[10.5px] text-slate-400">{result.display}</p>
          )}
          {result.note && <p className="mb-1.5 text-[11px] text-amber-200">{result.note}</p>}
          {result.error && <p className="mb-1.5 text-[11px] leading-relaxed text-rose-200">{result.error}</p>}
          {result.abortHint && (
            <div className="mb-1.5 flex items-center gap-2">
              <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-100">
                {result.abortHint}
              </code>
              <button
                type="button"
                onClick={() => copy(result.abortHint!)}
                className="text-[10px] text-slate-400 underline hover:text-slate-200"
              >
                копіювати команду скасування
              </button>
            </div>
          )}
          {result.output && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/35 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-slate-200">
              {result.output}
            </pre>
          )}
          {result.ok && !result.output && (
            <p className="text-[11px] text-emerald-200">Виконано. Git нічого не вивів — так і має бути.</p>
          )}
        </div>
      )}
    </div>
  );
};
