import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Copy, Download, ExternalLink, KeyRound, Loader2, MonitorUp, TerminalSquare } from 'lucide-react';
import type { Book } from '../../types';
import { API_BASE, apiPath } from '../../utils/basePath';
import { syncBookToServerNow } from '../../utils/storage';

interface Props {
  book: Book;
}

interface ArtifactInfo {
  kind: string;
  filename: string;
  sizeBytes: number;
  pageCount: number | null;
  bookRevision: number;
  builtAt: string;
  variant: string | null;
  stale: boolean;
}

interface EngineInfo {
  id: string;
  label: string;
  available: boolean;
  supportsPrint?: boolean;
  supportsCompanions?: boolean;
  reasonUk?: string;
  fixUk?: string;
}

/** Корінь Студії, з якою працює скрипт: локальна (`http://localhost:3000`) або хмарна (`…/studio`). */
export function studioRootUrl(loc: { origin: string } = window.location, base = API_BASE): string {
  return `${loc.origin}${base}`;
}

export function isLocalStudio(root: string): boolean {
  try {
    const host = new URL(root).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Посилання, яке реєструє `scripts/install-designcraft-link.ps1`; скрипт сам перевіряє адресу Студії. */
export function designcraftLaunchUrl(bookId: string, root: string): string {
  return `designcraft-studio://open?book=${encodeURIComponent(bookId)}&studio=${encodeURIComponent(root)}`;
}

/** Та сама дія командою — запасний шлях, якщо посилання ще не встановлене. */
export function designcraftLaunchCommand(bookId: string, root: string): string {
  const local = isLocalStudio(root);
  // Локальна Студія — скрипти з репозиторію; хмарна — те, що поклав інсталятор, завантажений зі Студії.
  const script = local ? '.\\scripts\\start-designcraft-studio.cmd' : '& "$env:LOCALAPPDATA\\DesignCraftStudio\\start-designcraft-studio.cmd"';
  return `${script} -BookId ${bookId} -StudioUrl ${root}${local ? ' -KeepRunning' : ''}`;
}

/** Інсталятор запуску, який віддає сама Студія (ZIP зі скриптами). */
export const LAUNCHER_DOWNLOAD_PATH = '/api/designcraft/launcher.zip';

/**
 * Блок локального графічного редактора DesignCraft на сторінці «Верстка для публікації».
 *
 * Браузер не може сам запустити програму на комп'ютері автора. Тому кнопка відкриває
 * посилання `designcraft-studio://…`, яке один раз реєструє скрипт-інсталятор; далі все
 * робить `scripts/start-designcraft-studio.ps1`: локальний сервер Студії (лише якщо Студія
 * локальна), вхід за кодом підключення, вікно DesignCraft з каналом керування і агент
 * Claude Code з цією книгою. Тут же — функції DesignCraft, які Студія має через API.
 */
export const DesignCraftEditorPanel: React.FC<Props> = ({ book }) => {
  const root = useMemo(() => studioRootUrl(), []);
  const local = isLocalStudio(root);
  const launchUrl = designcraftLaunchUrl(book.id, root);
  const command = designcraftLaunchCommand(book.id, root);

  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 'idle' | 'sent' (браузер щось зробив: вікно втратило фокус) | 'silent' (за 3 с нічого не сталося)
  const [launch, setLaunch] = useState<'idle' | 'sent' | 'silent'>('idle');
  const launchTimer = useRef<number | null>(null);
  const [artifacts, setArtifacts] = useState<{ revision: number; items: ArtifactInfo[] } | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);

  const loadArtifacts = async () => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(book.id)}/designcraft-status`, { credentials: 'same-origin' });
      if (res.status === 404) {
        setArtifacts(null);
        setArtifactsError('Книги ще немає на сервері — натисніть «Зберегти» в Студії, щоб чернетку можна було підготувати.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setArtifactsError(null);
      setArtifacts({
        revision: Number(data.revision),
        items: (Array.isArray(data.artifacts) ? data.artifacts : []).filter((a: ArtifactInfo) => a.kind === 'designcraft' || a.kind === 'designcraft-pdf'),
      });
    } catch (err) {
      setArtifactsError((err as Error).message);
    }
  };
  useEffect(() => {
    void loadArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  /**
   * Браузер не повідомляє, чи є обробник посилання designcraft-studio://. Якщо він є, сторінка зазвичай
   * втрачає фокус (запит дозволу чи нове вікно); якщо ні — не відбувається нічого. Тому по натисканню
   * чекаємо 3 с: без втрати фокусу показуємо підказку «посилання не встановлене» з завантаженням інсталятора.
   */
  const onLaunchClick = () => {
    setLaunch('idle');
    if (launchTimer.current) window.clearTimeout(launchTimer.current);
    let reacted = false;
    const react = () => {
      reacted = true;
    };
    window.addEventListener('blur', react, { once: true });
    document.addEventListener('visibilitychange', react, { once: true });
    launchTimer.current = window.setTimeout(() => {
      window.removeEventListener('blur', react);
      document.removeEventListener('visibilitychange', react);
      setLaunch(reacted ? 'sent' : 'silent');
    }, 3000);
  };
  useEffect(() => () => {
    if (launchTimer.current) window.clearTimeout(launchTimer.current);
  }, []);

  const prepareDraft = async () => {
    setBusy('draft');
    setError(null);
    try {
      // Сервер верстає СВОЮ копію книги — спершу доносимо до нього поточний стан (шаблон, формат).
      await syncBookToServerNow(book);
      const res = await fetch(`/api/books/${encodeURIComponent(book.id)}/designcraft-draft`, { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Не вдалося підготувати чернетку (HTTP ${res.status}).`);
      }
      await res.arrayBuffer();
      await loadArtifacts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/pdf/engines', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list: EngineInfo[] = Array.isArray(data?.engines) ? data.engines : [];
        setEngine(list.find((e) => e.id === 'designcraft') || null);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setEngineLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!code) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [code]);

  const secondsLeft = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      /* буфер обміну недоступний — текст видно на екрані */
    }
  };

  const getCode = async () => {
    setCodeBusy(true);
    setCodeError(null);
    try {
      const res = await fetch('/api/external-tokens/pairing-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'DesignCraft (локально)' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Не вдалося отримати код (HTTP ${res.status}).`);
      setCode({ code: data.code, expiresAt: data.expiresAt });
    } catch (err) {
      setCodeError((err as Error).message);
    } finally {
      setCodeBusy(false);
    }
  };

  const downloadCompanion = async (kind: 'epub' | 'html') => {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch('/api/pdf/companion', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book, engineId: 'designcraft', kind }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Не вдалося зібрати ${kind.toUpperCase()} (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(book.title || 'book').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'book'}.${kind}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const companionsReady = Boolean(engine?.available && engine?.supportsCompanions);

  return (
    <section className="mx-4 mt-4 lg:mx-6 rounded-2xl border border-cyan-900/60 bg-slate-950/70 p-5 space-y-5" data-designcraft-editor>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <MonitorUp className="w-4 h-4 text-cyan-300" /> Графічний редактор DesignCraft
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">
            Книга відкривається у вікні DesignCraft на вашому комп'ютері, а агент Claude Code верстає її в цьому ж вікні —
            ви бачите кожну зміну наживо.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <a
            href={launchUrl}
            onClick={onLaunchClick}
            data-open-designcraft
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-md"
          >
            <ExternalLink className="w-4 h-4" /> Відкрити графічний редактор DesignCraft
          </a>
          {launch === 'sent' && (
            <span className="text-[10px] text-slate-400 max-w-xs text-right" data-launch-sent>
              Запит надіслано. Якщо браузер питає дозвіл відкрити програму — погодьтесь; далі працює вікно скрипта на вашому комп'ютері.
            </span>
          )}
          {launch === 'silent' && (
            <span className="text-[10px] text-amber-300 max-w-xs text-right" data-launch-silent>
              Нічого не відбулося — найімовірніше, посилання ще не встановлене на цьому комп'ютері.
              Виконайте крок 1 нижче (завантажити й запустити інсталятор), потім натисніть кнопку ще раз.
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-[11px] text-slate-300 space-y-2">
        <p>
          <b className="text-white">Як це працює.</b> Кнопка відкриває посилання <code className="text-cyan-200">designcraft-studio://</code>,
          яке на вашому комп'ютері запускає скрипт <code className="text-cyan-200">{local ? 'scripts\\start-designcraft-studio.ps1' : '%LOCALAPPDATA%\\DesignCraftStudio\\start-designcraft-studio.ps1'}</code>. Скрипт
          {local ? (
            <> працює з вашим <b>локальним сервером Студії</b> (він уже запущений — скрипт його не перезапускає),</>
          ) : (
            <> працює з <b>хмарною Студією</b> — локальний сервер Студії <b>не запускається</b>,</>
          )}{' '}
          підключається до вашого акаунта за кодом, відкриває вікно DesignCraft із каналом керування й запускає агента
          Claude Code, якому одразу передано цю книгу.
        </p>
        <p className="text-slate-400">
          Потрібно: Windows; DesignCraft (<code>designcraft.exe</code> і <code>designcraft-cli.exe</code>) —{' '}
          <a href="https://github.com/storytold/designcraft/releases" target="_blank" rel="noreferrer" className="text-cyan-300 underline">збірки проєкту</a>;
          скрипт один раз спитає папку, де він лежить; встановлений Claude Code з входом в акаунт Claude. Браузер перед
          запуском спитає дозвіл відкрити програму — це нормально.
        </p>
      </div>

      <ol className="space-y-3 text-[11px] text-slate-300">
        <li className="flex gap-3">
          <span className="shrink-0 w-5 h-5 rounded-full bg-slate-800 text-[10px] font-bold flex items-center justify-center">1</span>
          <div className="flex-1 min-w-0">
            <b className="text-white">Один раз: встановити посилання на цьому комп'ютері.</b> Без цього кнопка вгорі нічого не робить.
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <a
                href={apiPath(LAUNCHER_DOWNLOAD_PATH)}
                download
                data-download-launcher
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-100 font-bold"
              >
                <Download className="w-3 h-3" /> Завантажити інсталятор (designcraft-studio-launcher.zip)
              </a>
            </div>
            <ol className="mt-1.5 list-decimal pl-4 space-y-0.5 text-slate-400">
              <li>Розпакуйте архів (правою кнопкою → «Видобути все») — не запускайте файли прямо з архіву.</li>
              <li>Двічі клацніть <code>install-designcraft-studio.cmd</code>. Якщо Windows питає «Запустити?» — це звичайні текстові скрипти, їх можна відкрити Блокнотом.</li>
              <li>Має з'явитися «Посилання designcraft-studio:// встановлено». Вікно можна закрити, архів — видалити.</li>
            </ol>
            <span className="text-slate-500">Без прав адміністратора, лише для вашого користувача Windows; нічого не завантажує з інтернету. Прибрати: <code>install-designcraft-studio.cmd -Remove</code>.</span>
            {local && (
              <div className="mt-1.5 text-slate-500">
                Розробник Студії (є папка проєкту) може замість цього виконати{' '}
                <code className="text-cyan-200">.\scripts\install-designcraft-link.cmd</code>{' '}
                <button type="button" onClick={() => copy('install', '.\\scripts\\install-designcraft-link.cmd')} className="align-middle p-1 rounded border border-slate-800 text-slate-300" title="Скопіювати">
                  {copied === 'install' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 w-5 h-5 rounded-full bg-slate-800 text-[10px] font-bold flex items-center justify-center">2</span>
          <div className="flex-1 min-w-0">
            <b className="text-white">Код підключення до акаунта.</b> Скрипт попросить його лише першого разу (далі пам'ятає токен,
            зашифрований для вашого облікового запису Windows). Код живе 5 хвилин і працює один раз; сам токен ніде не
            показується. Відкликати підключення: Медіатека → Скани з телефону → Підключення застосунку.
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={getCode}
                disabled={codeBusy}
                data-pairing-code-btn
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-200 font-bold disabled:opacity-50"
              >
                {codeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />} Отримати код підключення
              </button>
              {code && secondsLeft > 0 && (
                <>
                  <code className="px-3 py-1 rounded bg-slate-950 border border-amber-500/40 text-amber-100 text-sm tracking-[0.2em]" data-pairing-code>
                    {code.code}
                  </code>
                  <span className="text-slate-500">ще {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span>
                </>
              )}
              {code && secondsLeft === 0 && <span className="text-rose-300">Код прострочений — отримайте новий.</span>}
            </div>
            {codeError && <p className="mt-1 text-rose-300">{codeError}</p>}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 w-5 h-5 rounded-full bg-slate-800 text-[10px] font-bold flex items-center justify-center">3</span>
          <div className="flex-1 min-w-0">
            <b className="text-white">Натисніть «Відкрити графічний редактор DesignCraft».</b> Або запустіть ту саму дію командою:
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate px-2 py-1 rounded bg-slate-950 border border-slate-800 text-cyan-200" data-launch-command>
                {command}
              </code>
              <button type="button" onClick={() => copy('cmd', command)} className="p-1.5 rounded border border-slate-800 text-slate-300" title="Скопіювати">
                {copied === 'cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <TerminalSquare className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </li>
      </ol>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] text-slate-300">
        <div className="mb-2 font-bold text-white flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-violet-300" /> Робота з агентом Claude Code
        </div>
        <ul className="list-disc pl-4 space-y-1 text-slate-400">
          <li>Агент читає книгу зі Студії <b className="text-slate-200">лише для читання</b>: текст у Студію він не пише. Виправлення тексту робіть тут, у Студії, і збережіть — агент переналиє його у верстку.</li>
          <li>Агент працює лише у вкладці цієї книги; інші документи у вікні DesignCraft не чіпає. Файли верстки (.designcraft, PDF) лягають у папку <code>{local ? 'designcraft-work' : 'Документи\\DesignCraft-Studio'}</code>.</li>
          <li>Скрипт питає акаунт і модель Claude Code: для книг зазвичай достатньо Sonnet; Opus помітно дорожчий. Оплата — за вашим акаунтом Claude, не Студії.</li>
          <li>Підтвердження агент питає лише для дій, що руйнують наявну верстку (перебудова з нуля, видалення сторінок).</li>
        </ul>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] text-slate-300 space-y-2" data-designcraft-artifacts>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-white">Чернетка й результат DesignCraft</div>
          <button
            type="button"
            onClick={prepareDraft}
            disabled={!!busy || !engine?.available}
            data-prepare-draft
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-700 bg-slate-950 text-cyan-200 font-bold disabled:opacity-50"
            title={engine?.available ? '' : 'Рушій DesignCraft на сервері недоступний'}
          >
            {busy === 'draft' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Підготувати чернетку зараз
          </button>
        </div>
        <p className="text-slate-500">
          Чернетку верстає сервер тим самим конвеєром, що й точний PDF (макет і шаблон книги); скрипт кладе її у вікно DesignCraft. Після роботи скрипт
          повертає сюди змінений документ і PDF. Текст із DesignCraft у Студію не повертається — джерело тексту лише Студія.
        </p>
        {artifactsError && <p className="text-amber-300">{artifactsError}</p>}
        {artifacts && artifacts.items.length === 0 && <p className="text-slate-500">Ще немає ні чернетки, ні результату.</p>}
        {artifacts && artifacts.items.length > 0 && (
          <ul className="space-y-1.5">
            {artifacts.items.map((a) => (
              <li key={a.kind} className="flex flex-wrap items-center gap-2" data-artifact={a.kind}>
                <span className="font-bold text-slate-200">{a.kind === 'designcraft' ? (a.variant === 'designcraft-gui' ? 'Документ із вікна DesignCraft' : 'Чернетка зі Студії') : 'PDF із вікна DesignCraft'}</span>
                <span className="text-slate-500">
                  ревізія {a.bookRevision} · {new Date(a.builtAt).toLocaleString('uk-UA')}{a.pageCount ? ` · ${a.pageCount} стор.` : ''}
                </span>
                {a.stale ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-200 font-bold">застаріло: текст або макет змінено після нього</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 font-bold">актуально</span>
                )}
                <a href={apiPath(`/api/books/${encodeURIComponent(book.id)}/artifact/${a.kind}`)} className="text-cyan-300 underline" download>
                  завантажити
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] text-slate-300 space-y-2">
        <div className="font-bold text-white">DesignCraft у Студії (працює без локального редактора)</div>
        {engineLoading ? (
          <p className="text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Перевіряю рушій DesignCraft на сервері…</p>
        ) : !engine ? (
          <p className="text-slate-500">Рушій DesignCraft на цьому сервері не зареєстрований.</p>
        ) : !engine.available ? (
          <p className="text-amber-300">Рушій DesignCraft зараз недоступний: {engine.reasonUk || 'причина невідома'} {engine.fixUk || ''}</p>
        ) : (
          <>
            <p className="text-slate-400">
              Точний PDF (Digital{engine.supportsPrint ? ' і Print / KDP' : ''}) — у блоці «Точний PDF» вище: оберіть рушій DesignCraft. Шаблон
              береться з книги.
            </p>
            {companionsReady && (
              <div className="flex flex-wrap gap-2">
                {(['epub', 'html'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => downloadCompanion(kind)}
                    disabled={!!busy}
                    data-companion={kind}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-200 font-bold disabled:opacity-50"
                  >
                    {busy === kind ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    {kind.toUpperCase()} з того самого макета
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {error && <p className="text-rose-300">{error}</p>}
      </div>
    </section>
  );
};
