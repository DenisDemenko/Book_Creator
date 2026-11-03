/**
 * Пошук абзаців за тегом сутності (постановка власника 03.11.2026): обрати
 * тег із реєстру 118 — отримати ВСІ абзаци книги з ним, з главою, розділом і
 * переходом до самого абзаца.
 *
 * ЧОМУ СПИСОК, А НЕ ПОЛЕ ВВОДУ. Тегів сто вісімнадцять, і майже всі їхні
 * назви автор бачить лише в підказці слеша. Поле, у якому треба згадати
 * точний ключ, давало б «нічого не знайдено» там, де насправді помилка в
 * літері; а відрізнити «немає такого тегу» від «немає такого в книзі» —
 * половина користі пошуку (сервер ці дві відповіді теж розрізняє: 404 проти
 * порожнього списку).
 *
 * ЧОМУ ТУТ НЕМАЄ Jev. Теги вже проставлені — модель вирішувала це тоді, коли
 * їх ставили. Пошук читає вирішене, не платить за запит і дає той самий
 * список двічі поспіль.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, Search, ArrowRight } from 'lucide-react';
import { activeEntities } from '../utils/coreEntities';

interface TagHit {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterTitle: string | null;
  excerpt: string;
  entities: Array<{ id: string; name: string; status: string }>;
}

interface Props {
  bookId: string;
  /** Відкрити розділ і стати на цей абзац. */
  onOpenParagraph: (chapterId: string | null, sectionId: string, editorPid: string) => void;
}

export const TagSearchPanel: React.FC<Props> = ({ bookId, onOpenParagraph }) => {
  const [slug, setSlug] = useState('');
  const [hits, setHits] = useState<TagHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [entitiesFound, setEntitiesFound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Застарілі типи реєстру схем у списку не показуються — їх і AI не пропонує.
  const options = useMemo(() => activeEntities().slice().sort((a, b) => a.nameUk.localeCompare(b.nameUk, 'uk')), []);

  const run = async () => {
    if (!slug) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(bookId)}/tags/${encodeURIComponent(slug)}/paragraphs`,
        { credentials: 'same-origin' }
      ).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        setHits(null);
        setMessage(body.error || 'Пошук не вдався.');
        return;
      }
      setHits(body.hits || []);
      setTotal(body.total || 0);
      setEntitiesFound(body.entitiesFound || 0);
      if (!body.total) setMessage('Абзаців із цим тегом у книзі немає.');
      else if ((body.hits || []).length < body.total) {
        setMessage(`Знайдено ${body.total}, показано перші ${body.hits.length}.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/50 p-3" data-tag-search>
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-sky-300" />
        <span className="flex-1 text-[11px] font-bold text-slate-200">Пошук за тегом</span>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setHits(null);
            setMessage(null);
          }}
          data-tag-search-select
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200"
        >
          <option value="">Оберіть тег…</option>
          {options.map((e) => (
            <option key={e.slug} value={e.slug}>
              /{e.slug} — {e.nameUk}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={!slug || busy}
          data-tag-search-run
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
          title="Знайти всі абзаци книги з цим тегом"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Знайти
        </button>
      </div>

      {message && <p className="text-[11px] text-slate-400" data-tag-search-message>{message}</p>}

      {hits && hits.length > 0 && (
        <>
          <p className="text-[10px] text-slate-500">
            абзаців: {total}; різних сутностей цього типу: {entitiesFound}
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
                  <p className="mt-1 text-[10px] text-slate-500">{h.entities.map((e) => e.name).join(', ')}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default TagSearchPanel;
