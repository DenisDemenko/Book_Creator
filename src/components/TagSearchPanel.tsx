/**
 * Пошук абзаців за тегами сутностей (постановка власника 03.11.2026, уточнена
 * того ж дня): кілька тегів одразу, пошук за значенням після двокрапки й
 * видача частинами.
 *
 * ЧОМУ СПИСОК, А НЕ ПОЛЕ ВВОДУ ДЛЯ ТЕГА. Тегів сто вісімнадцять, і майже всі
 * їхні назви автор бачить лише в підказці слеша. Поле, у якому треба згадати
 * точний ключ, давало б «нічого не знайдено» там, де насправді помилка в
 * літері. А от ЗНАЧЕННЯ — поле: його автор писав сам і пам'ятає.
 *
 * ЧОМУ «БУДЬ-ЯКИЙ» ТИПОВО. «Знайти абзаци з тегом» читається як «де є цей
 * тег». Режим «усі» — окреме, вужче питання («де страх І Олена разом»), і
 * показувати його, доки тег один, немає сенсу.
 *
 * ЧОГО ЦЕЙ ПОШУК НЕ ПОКАЖЕ. Тег із порожнім значенням (`[/emotion:]`) у ядро
 * не потрапляє: сутність там визначається іменем зі значення, і такий тег ні
 * на кого не вказує. Теги від AI-1 і від кнопки Jev значення несуть; ручний
 * із підказки слеша вставляється порожнім, і доки автор не допише значення,
 * у видачі його не буде. Панель каже про це прямо, а не мовчить.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, Search, ArrowRight, X } from 'lucide-react';
import { activeEntities } from '../utils/coreEntities';

interface TagHit {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterTitle: string | null;
  excerpt: string;
  types: string[];
  entities: Array<{ id: string; name: string; status: string; type: string; value: string }>;
}

interface Props {
  bookId: string;
  /** Відкрити розділ і стати на цей абзац. */
  onOpenParagraph: (chapterId: string | null, sectionId: string, editorPid: string) => void;
}

const PAGE = 50;

export const TagSearchPanel: React.FC<Props> = ({ bookId, onOpenParagraph }) => {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [picker, setPicker] = useState('');
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<'any' | 'all'>('any');
  const [hits, setHits] = useState<TagHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [entitiesFound, setEntitiesFound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Застарілі типи реєстру схем у списку не показуються — їх і AI не пропонує.
  const options = useMemo(() => activeEntities().slice().sort((a, b) => a.nameUk.localeCompare(b.nameUk, 'uk')), []);
  const nameOf = (slug: string) => options.find((o) => o.slug === slug)?.nameUk ?? slug;

  const search = async (offset: number) => {
    if (!slugs.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const [first, ...rest] = slugs;
      const query = new URLSearchParams();
      if (rest.length) query.set('tags', rest.join(','));
      if (value.trim()) query.set('value', value.trim());
      if (slugs.length > 1) query.set('mode', mode);
      query.set('limit', String(PAGE));
      query.set('offset', String(offset));
      const res = await fetch(
        `/api/projects/${encodeURIComponent(bookId)}/tags/${encodeURIComponent(first)}/paragraphs?${query}`,
        { credentials: 'same-origin' }
      ).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        setMessage(body.error || 'Пошук не вдався.');
        return;
      }
      const page: TagHit[] = body.hits || [];
      setHits(offset ? [...(hits || []), ...page] : page);
      setTotal(body.total || 0);
      setEntitiesFound(body.entitiesFound || 0);
      if (!body.total) {
        setMessage(
          'Абзаців із цим тегом у книзі немає. Якщо ви ставили тег уручну — перевірте, чи дописане значення після двокрапки: порожній тег у пошук не потрапляє.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setHits(null);
    setMessage(null);
  };

  const shown = hits?.length ?? 0;

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/50 p-3" data-tag-search>
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-sky-300" />
        <span className="flex-1 text-[11px] font-bold text-slate-200">Пошук за тегом</span>
      </div>

      {slugs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {slugs.map((slug) => (
            <span
              key={slug}
              data-tag-search-chip={slug}
              className="flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-200"
            >
              /{slug}
              <button
                type="button"
                onClick={() => {
                  setSlugs((prev) => prev.filter((s) => s !== slug));
                  reset();
                }}
                title={`Прибрати ${nameOf(slug)}`}
                className="text-sky-300/70 hover:text-sky-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <select
        value={picker}
        onChange={(e) => {
          const slug = e.target.value;
          setPicker('');
          if (!slug || slugs.includes(slug)) return;
          setSlugs((prev) => [...prev, slug]);
          reset();
        }}
        data-tag-search-select
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200"
      >
        <option value="">{slugs.length ? 'Додати ще тег…' : 'Оберіть тег…'}</option>
        {options
          .filter((e) => !slugs.includes(e.slug))
          .map((e) => (
            <option key={e.slug} value={e.slug}>
              /{e.slug} — {e.nameUk}
            </option>
          ))}
      </select>

      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          reset();
        }}
        placeholder="Значення після двокрапки — необов'язково"
        data-tag-search-value
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
      />

      <div className="flex items-center gap-1.5">
        {slugs.length > 1 && (
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as 'any' | 'all');
              reset();
            }}
            data-tag-search-mode
            className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200"
          >
            <option value="any">будь-який із тегів</option>
            <option value="all">усі теги разом</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => void search(0)}
          disabled={!slugs.length || busy}
          data-tag-search-run
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
          title="Знайти всі абзаци книги з цими тегами"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Знайти
        </button>
      </div>

      {message && <p className="text-[11px] text-slate-400" data-tag-search-message>{message}</p>}

      {hits && hits.length > 0 && (
        <>
          <p className="text-[10px] text-slate-500">
            абзаців: {total}
            {shown < total ? ` (показано ${shown})` : ''}; різних сутностей: {entitiesFound}
          </p>
          <ul className="space-y-1.5">
            {hits.map((h) => (
              <li key={h.paragraphId}>
                <button
                  type="button"
                  onClick={() => onOpenParagraph(h.chapterId, h.sectionId, h.editorPid)}
                  data-tag-search-hit={h.paragraphId}
                  className="group w-full rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-left hover:border-sky-500/40"
                >
                  <div className="flex items-center gap-1 text-[10px] font-bold text-sky-200">
                    {h.chapterTitle ? <span>{h.chapterTitle}</span> : null}
                    {h.chapterTitle ? <span className="text-slate-600">·</span> : null}
                    <span className="text-slate-400">{h.sectionTitle}</span>
                    <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-slate-600 group-hover:text-sky-300" />
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] text-slate-300">{h.excerpt}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {h.entities.map((e) => (e.name ? (e.value ? `${e.name}: ${e.value}` : e.name) : e.value || `/${e.type} (без значення)`)).join(', ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {shown < total && (
            <button
              type="button"
              onClick={() => void search(shown)}
              disabled={busy}
              data-tag-search-more
              className="w-full rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-bold text-slate-300 hover:border-sky-500/40 disabled:opacity-50"
            >
              {busy ? 'Завантаження…' : `Показати ще (лишилось ${total - shown})`}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default TagSearchPanel;
