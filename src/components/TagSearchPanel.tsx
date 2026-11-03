/**
 * Пошук абзаців за тегами сутностей (постановка власника 03.11.2026, уточнена
 * того ж дня): кілька тегів одразу, пошук за значенням після двокрапки, за
 * НОМЕРОМ екземпляра, видача частинами й перенесення знайденого в чат ШІ.
 *
 * ЧОМУ НОМЕР — ОКРЕМЕ ПОЛЕ. Автоматичні теги рівня типу — це `[/emotion:#17]`:
 * однакових `[/emotion:]` у книзі сотні, і єдине, що їх розрізняє, — номер.
 * Вибрати «емоція» й написати «17» — це й є «швидко знайти сімнадцятий». З
 * типом `paragraph` те саме дає абзац за його номером.
 *
 * ЧОМУ СПИСОК, А НЕ ПОЛЕ ВВОДУ ДЛЯ ТЕГА. Тегів сто вісімнадцять, і майже всі
 * їхні назви автор бачить лише в підказці слеша. Поле, у якому треба згадати
 * точний ключ, давало б «нічого не знайдено» там, де насправді помилка в
 * літері. А от ЗНАЧЕННЯ й НОМЕР — поля: їх автор писав сам і пам'ятає.
 *
 * ЧОМУ «БУДЬ-ЯКИЙ» ТИПОВО. «Знайти абзаци з тегом» читається як «де є цей
 * тег». Режим «усі» — окреме, вужче питання («де страх І Олена разом»), і
 * показувати його, доки тег один, немає сенсу.
 *
 * «У ЧАТ ШІ» БЕРЕ ВСЕ ЗНАЙДЕНЕ, а не лише показане: список іде частинами по 50,
 * а обговорювати треба всі абзаци. Тому кнопка сама проходить усі сторінки й
 * просить повний текст абзаців (не уривки). Чат прикріпить їх карткою й сам не
 * надішле — питання формулює автор.
 *
 * ЧОГО ЦЕЙ ПОШУК НЕ ПОКАЖЕ. Тег із порожнім значенням (`[/emotion:]`) у ядро не
 * потрапляє, але пошук читає й текст абзаців, тож знаходить його теж.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, MessagesSquare, Search, ArrowRight, X } from 'lucide-react';
import { activeEntities } from '../utils/coreEntities';
import type { ChatBatch, ChatBatchItem } from '../utils/chatBatch';

interface TagHitEntity {
  id: string;
  name: string;
  status: string;
  type: string;
  value: string;
  instance?: number;
}

interface TagHit {
  paragraphId: string;
  editorPid: string;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterTitle: string | null;
  excerpt: string;
  text?: string;
  types: string[];
  paragraphNumber?: number;
  entities: TagHitEntity[];
}

interface Props {
  bookId: string;
  /** Відкрити розділ і стати на цей абзац. */
  onOpenParagraph: (chapterId: string | null, sectionId: string, editorPid: string) => void;
  /** Перенести знайдене в чат ШІ; без цього кнопки «У чат ШІ» немає. */
  onSendToChat?: (batch: ChatBatch) => void;
}

const PAGE = 50;
/** Скільки абзаців за раз просимо з повним текстом для чату. */
const CHAT_PAGE = 200;
/** Найбільше абзаців, яке кнопка «У чат ШІ» збере: далі чат усе одно не вмістить. */
const CHAT_MAX = 1000;

/** Читний підпис тега: `emotion #17`, `emotion «страх»`, `character «Олена» #3`. */
export function tagLabel(e: TagHitEntity): string {
  if (e.name) return `${e.type} «${e.name}»${e.instance !== undefined ? ` #${e.instance}` : ''}`;
  if (e.value) return `${e.type} ${e.value}`;
  return e.type;
}

export const TagSearchPanel: React.FC<Props> = ({ bookId, onOpenParagraph, onSendToChat }) => {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [picker, setPicker] = useState('');
  const [value, setValue] = useState('');
  const [instance, setInstance] = useState('');
  const [mode, setMode] = useState<'any' | 'all'>('any');
  const [hits, setHits] = useState<TagHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [entitiesFound, setEntitiesFound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Застарілі типи реєстру схем у списку не показуються — їх і AI не пропонує.
  const options = useMemo(() => activeEntities().slice().sort((a, b) => a.nameUk.localeCompare(b.nameUk, 'uk')), []);
  const nameOf = (slug: string) => options.find((o) => o.slug === slug)?.nameUk ?? slug;

  const instanceNumber = /^\d+$/.test(instance.trim()) ? Number(instance.trim()) : undefined;

  const buildUrl = (offset: number, limit: number, full: boolean) => {
    const [first, ...rest] = slugs;
    const query = new URLSearchParams();
    if (rest.length) query.set('tags', rest.join(','));
    if (value.trim()) query.set('value', value.trim());
    if (instanceNumber !== undefined) query.set('n', String(instanceNumber));
    if (slugs.length > 1) query.set('mode', mode);
    if (full) query.set('full', '1');
    query.set('limit', String(limit));
    query.set('offset', String(offset));
    return `/api/projects/${encodeURIComponent(bookId)}/tags/${encodeURIComponent(first)}/paragraphs?${query}`;
  };

  const search = async (offset: number) => {
    if (!slugs.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(buildUrl(offset, PAGE, false), { credentials: 'same-origin' }).catch(() => null);
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
          instanceNumber !== undefined
            ? `Тегу №${instanceNumber} серед цих типів у книзі немає.`
            : 'Абзаців із цим тегом у книзі немає. Якщо ви ставили тег уручну — перевірте, чи дописане значення після двокрапки: порожній тег у ядро не потрапляє, але цей пошук його бачить.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /** Заголовок пачки: чим саме знайдено — `/emotion #17`, `/emotion + /character`. */
  const batchTitle = () => {
    const tags = slugs.map((s) => `/${s}`).join(slugs.length > 1 ? (mode === 'all' ? ' + ' : ' | ') : '');
    const extra = [instanceNumber !== undefined ? `#${instanceNumber}` : '', value.trim() ? `«${value.trim()}»` : ''].filter(Boolean);
    return [tags, ...extra].join(' ');
  };

  const sendToChat = async () => {
    if (!onSendToChat || !slugs.length) return;
    setSending(true);
    setMessage(null);
    try {
      const items: ChatBatchItem[] = [];
      let offset = 0;
      let all = Infinity;
      while (offset < all && items.length < CHAT_MAX) {
        const res = await fetch(buildUrl(offset, CHAT_PAGE, true), { credentials: 'same-origin' }).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : {};
        if (!res || !res.ok) {
          setMessage(body.error || 'Не вдалося зібрати абзаци для чату.');
          return;
        }
        all = body.total || 0;
        const page: TagHit[] = body.hits || [];
        if (!page.length) break;
        for (const h of page) {
          items.push({
            id: h.paragraphId,
            where: [h.chapterTitle, h.sectionTitle].filter(Boolean).join(' · '),
            number: h.paragraphNumber,
            tags: h.entities.map(tagLabel),
            text: h.text ?? h.excerpt,
          });
        }
        offset += page.length;
      }
      if (!items.length) {
        setMessage('Немає чого передавати в чат.');
        return;
      }
      onSendToChat({ title: batchTitle(), items });
      setMessage(
        all > items.length
          ? `У чат передано ${items.length} із ${all} абзаців — решту не зібрано (межа ${CHAT_MAX}).`
          : `У чат передано абзаців: ${items.length}. Сформулюйте питання в чаті.`
      );
    } finally {
      setSending(false);
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

      <div className="flex gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          value={instance}
          onChange={(e) => {
            setInstance(e.target.value.replace(/[^0-9]/g, ''));
            reset();
          }}
          placeholder="№"
          title="Номер екземпляра: #17 у [/emotion:#17]. Разом із типом знаходить саме цей тег; з типом paragraph — абзац за номером."
          data-tag-search-instance
          className="w-16 shrink-0 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            reset();
          }}
          placeholder="Значення після двокрапки — необов'язково"
          data-tag-search-value
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
        />
      </div>

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
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[10px] text-slate-500">
              абзаців: {total}
              {shown < total ? ` (показано ${shown})` : ''}; різних сутностей: {entitiesFound}
            </p>
            {onSendToChat && (
              <button
                type="button"
                onClick={() => void sendToChat()}
                disabled={sending}
                data-tag-search-to-chat
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                title="Перенести ВСІ знайдені абзаци (не лише показані) з номерами, місцем у книзі й тегами в чат ШІ — для правки й обговорення по одному."
              >
                {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessagesSquare className="h-3 w-3" />}У чат ШІ ({total})
              </button>
            )}
          </div>
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
                    {h.paragraphNumber !== undefined ? <span data-tag-search-number>¶{h.paragraphNumber}</span> : null}
                    {h.paragraphNumber !== undefined ? <span className="text-slate-600">·</span> : null}
                    {h.chapterTitle ? <span>{h.chapterTitle}</span> : null}
                    {h.chapterTitle ? <span className="text-slate-600">·</span> : null}
                    <span className="text-slate-400">{h.sectionTitle}</span>
                    <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-slate-600 group-hover:text-sky-300" />
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] text-slate-300">{h.excerpt}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{h.entities.map(tagLabel).join(', ')}</p>
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
