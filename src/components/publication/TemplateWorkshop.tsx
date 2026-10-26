import React, { useRef, useState } from 'react';
import { Check, Download, Loader2, Palette, RotateCcw, Upload } from 'lucide-react';
import type { Book } from '../../types';
import {
  BLOCK_BACKGROUND_PALETTE,
  BLOCK_BACKGROUND_TARGETS,
  type BlockBackgroundStyleId,
  type BlockBackgrounds,
  type CustomBookDesignTheme,
} from '../../data/customBookDesignTheme';
import { getBookDesignThemeCard, type BookDesignThemeId } from '../../data/bookDesignThemeCatalog';
import { saveCustomTheme } from '../../utils/customThemeStore';
import { OpenDesignCraftOnlyButton } from './OpenDesignCraftOnlyButton';

interface Props {
  book: Book;
  activeThemeId: BookDesignThemeId;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
}

interface ImportResult {
  theme: CustomBookDesignTheme;
  importedStyles: string[];
  missingStyles: string[];
  notesUk: string[];
}

const OPACITIES = [1, 0.8, 0.6, 0.4] as const;

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return data?.error || `${fallback} (HTTP ${res.status}).`;
}

/**
 * Власний шаблон через DesignCraft і фони блоків — у розділі «Шаблон верстки».
 *
 *   1. «Завантажити копію» — `.designcraft` з усіма стилями поточного шаблону й зразками тексту;
 *   2. автор відкриває його в DesignCraft, правит стилі абзаців і зберігає файл на диск;
 *   3. «Завантажити користувацький шаблон» — Студія читає стилі з файла й застосовує їх до книги.
 * Фон блоків (цитата, лист, чат…) задається опціями й діє поверх будь-якого шаблону.
 */
export const TemplateWorkshop: React.FC<Props> = ({ book, activeThemeId, onUpdateBook }) => {
  const layout = book.layoutConfig;
  const custom = layout.customDesignTheme || null;
  const backgrounds: BlockBackgrounds = layout.blockBackgrounds || {};
  const baseId: BookDesignThemeId = custom?.basedOn || activeThemeId;
  const baseLabel = getBookDesignThemeCard(baseId).label;

  const [busy, setBusy] = useState<'copy' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const downloadCopy = async () => {
    setBusy('copy');
    setError(null);
    try {
      const res = await fetch('/api/pdf/designcraft/template-copy', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: baseId, customTheme: custom || undefined, blockBackgrounds: backgrounds }),
      });
      if (!res.ok) throw new Error(await errorText(res, 'Не вдалося підготувати копію шаблону'));
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `shablon-${baseId}.designcraft`;
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

  const importFile = async (file: File) => {
    setBusy('import');
    setError(null);
    setResult(null);
    try {
      const query = new URLSearchParams({ basedOn: baseId });
      if (name.trim()) query.set('name', name.trim());
      const res = await fetch(`/api/pdf/designcraft/template-import?${query.toString()}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (!res.ok) throw new Error(await errorText(res, 'Не вдалося прочитати файл шаблону'));
      setResult((await res.json()) as ImportResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyImported = () => {
    if (!result) return;
    saveCustomTheme(book.id, result.theme);
    onUpdateBook(
      { ...book, layoutConfig: { ...layout, customDesignTheme: result.theme } },
      'Власний шаблон верстки',
      `Застосовано власний шаблон «${result.theme.name}» (на основі «${baseLabel}»): стилі абзаців імпортовано з DesignCraft.`
    );
    setResult(null);
  };

  const removeCustom = () => {
    const { customDesignTheme: _drop, ...rest } = layout;
    onUpdateBook({ ...book, layoutConfig: rest as Book['layoutConfig'] }, 'Власний шаблон верстки', `Власний шаблон прибрано: діє «${baseLabel}».`);
  };

  const setBackground = (id: BlockBackgroundStyleId, value: { color: string | null; opacity?: number } | undefined) => {
    const next: BlockBackgrounds = { ...backgrounds };
    if (value) next[id] = value;
    else delete next[id];
    const hasAny = Object.keys(next).length > 0;
    const { blockBackgrounds: _old, ...rest } = layout;
    onUpdateBook(
      { ...book, layoutConfig: (hasAny ? { ...rest, blockBackgrounds: next } : rest) as Book['layoutConfig'] },
      'Фон блоків верстки',
      `Фон блоку «${BLOCK_BACKGROUND_TARGETS.find((b) => b.id === id)?.labelUk}»: ${value ? (value.color ? value.color : 'без фону') : 'за шаблоном'}.`
    );
  };

  const resetBackgrounds = () => {
    const { blockBackgrounds: _old, ...rest } = layout;
    onUpdateBook({ ...book, layoutConfig: rest as Book['layoutConfig'] }, 'Фон блоків верстки', 'Фони блоків скинуто: діє те, що дає шаблон.');
  };

  const row = (id: BlockBackgroundStyleId, labelUk: string) => {
    const current = backgrounds[id];
    const color = current?.color ?? undefined;
    const opacity = current?.opacity ?? 1;
    const none = current?.color === null;
    return (
      <div key={id} data-block-bg-row={id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <span className="w-44 shrink-0 text-[11px] font-bold text-slate-200">{labelUk}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            title="За шаблоном"
            data-block-bg-default
            onClick={() => setBackground(id, undefined)}
            className={`h-6 rounded-md border px-2 text-[10px] font-bold ${!current ? 'border-amber-500/70 text-amber-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
          >
            за шаблоном
          </button>
          <button
            type="button"
            title="Без фону"
            data-block-bg-none
            onClick={() => setBackground(id, { color: null })}
            className={`h-6 rounded-md border px-2 text-[10px] font-bold ${none ? 'border-amber-500/70 text-amber-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
          >
            без фону
          </button>
          {BLOCK_BACKGROUND_PALETTE.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.labelUk}
              data-block-bg-color={p.color}
              onClick={() => setBackground(id, { color: p.color, opacity })}
              style={{ backgroundColor: p.color }}
              className={`h-6 w-6 rounded-md border ${color === p.color ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-slate-600'}`}
            >
              {color === p.color && <Check className="mx-auto h-3 w-3 text-slate-800" />}
            </button>
          ))}
          <label title="Свій колір" className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-slate-700 px-1.5 text-[10px] text-slate-400 hover:border-slate-500">
            <Palette className="h-3 w-3" /> свій
            <input
              type="color"
              data-block-bg-custom
              value={color || '#F5EFE0'}
              onChange={(e) => setBackground(id, { color: e.target.value.toUpperCase(), opacity })}
              className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          {color && (
            <select
              aria-label="Насиченість"
              data-block-bg-opacity
              value={opacity}
              onChange={(e) => setBackground(id, { color, opacity: Number(e.target.value) })}
              className="h-6 rounded-md border border-slate-700 bg-slate-950 px-1 text-[10px] text-slate-300"
            >
              {OPACITIES.map((o) => (
                <option key={o} value={o}>{Math.round(o * 100)}%</option>
              ))}
            </select>
          )}
        </div>
        <span
          className="ml-auto max-w-[11rem] truncate rounded px-2 py-0.5 text-[10px] italic text-slate-800"
          style={{ backgroundColor: color ? `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}` : 'transparent', color: color ? '#1f2937' : '#64748b' }}
        >
          Зразок тексту блоку
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-5 border-t border-slate-800 pt-5" data-template-workshop>
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Власний шаблон через DesignCraft</div>
        <p className="text-[11px] text-slate-400 max-w-3xl">
          Візьміть копію поточного шаблону, правте його стилі в DesignCraft і завантажте назад — книга верстатиметься вашими стилями.
          Правте <b className="text-slate-200">стилі абзаців</b> (шрифт, розмір, відступи, колір тексту, фон і рамку). Не перейменовуйте й не видаляйте стилі: Студія читає їх за назвами.
        </p>
        {custom && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100" data-custom-template-active>
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>Застосовано власний шаблон <b>«{custom.name}»</b> на основі «{getBookDesignThemeCard(custom.basedOn!).label}».</span>
            <button type="button" onClick={removeCustom} data-custom-template-remove className="ml-auto inline-flex items-center gap-1 rounded-md border border-emerald-500/50 px-2 py-1 text-[10px] font-bold hover:bg-emerald-500/10">
              <RotateCcw className="h-3 w-3" /> Повернути «{getBookDesignThemeCard(custom.basedOn!).label}»
            </button>
          </div>
        )}
      </div>

      <ol className="space-y-3 text-[11px] text-slate-300">
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold">1</span>
          <div className="min-w-0 flex-1">
            <b className="text-white">Завантажте копію шаблону «{baseLabel}».</b> Це файл .designcraft з усіма стилями шаблону та зразком тексту до кожного.
            <div className="mt-1.5">
              <button
                type="button"
                onClick={downloadCopy}
                disabled={busy !== null}
                data-template-copy-btn
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-3 py-1.5 font-bold text-cyan-100 disabled:opacity-50"
              >
                {busy === 'copy' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Завантажити копію для DesignCraft
              </button>
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold">2</span>
          <div className="min-w-0 flex-1">
            <b className="text-white">Відкрийте файл у DesignCraft і правте стилі.</b> Потім збережіть його на диск (Файл → Зберегти як…). Текст у файлі — лише зразок, у книгу він не потрапляє.
            <div className="mt-1.5">
              <OpenDesignCraftOnlyButton compact />
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold">3</span>
          <div className="min-w-0 flex-1">
            <b className="text-white">Завантажте збережений файл як користувацький шаблон.</b>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Назва шаблону (необов'язково)"
                maxLength={80}
                className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200"
              />
              <input
                ref={fileRef}
                type="file"
                accept=".designcraft,application/vnd.designcraft"
                data-template-file
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
                data-template-import-btn
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 font-bold text-amber-100 disabled:opacity-50"
              >
                {busy === 'import' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Завантажити користувацький шаблон
              </button>
            </div>
            {error && <p className="mt-1.5 text-rose-300" data-template-error>{error}</p>}
            {result && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3" data-template-result>
                <p className="text-amber-100">
                  Прочитано стилів: <b>{result.importedStyles.length}</b> ({result.importedStyles.join(', ')}).
                </p>
                {result.notesUk.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">
                    {result.notesUk.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                )}
                <button type="button" onClick={applyImported} data-template-apply className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 font-bold text-slate-950 hover:bg-amber-300">
                  <Check className="h-3 w-3" /> Застосувати «{result.theme.name}» до книги
                </button>
              </div>
            )}
          </div>
        </li>
      </ol>

      <div data-block-backgrounds>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Фон блоків · усі шаблони</div>
          {Object.keys(backgrounds).length > 0 && (
            <button type="button" onClick={resetBackgrounds} data-block-bg-reset className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:border-slate-500">
              <RotateCcw className="h-3 w-3" /> Скинути всі
            </button>
          )}
        </div>
        <p className="mb-2 text-[11px] text-slate-400 max-w-3xl">
          Оберіть фон для кожного блоку тексту: колір із палітри, свій колір або «без фону». Налаштування діє поверх будь-якого шаблону (вбудованого чи власного) і зберігається в книзі.
          Видно в DesignCraft у блоках, які є в тексті книги; браузерний експорт Студії фону блоків не малює.
        </p>
        <div className="grid grid-cols-1 gap-2">{BLOCK_BACKGROUND_TARGETS.map((b) => row(b.id, b.labelUk))}</div>
      </div>
    </div>
  );
};
