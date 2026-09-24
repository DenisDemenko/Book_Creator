import { useEffect, useMemo, useState } from 'react';
import { Search, X, ArrowRight, Replace, ChevronRight } from 'lucide-react';
import type { Book } from '../types';
import { calculateWordCount } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';
import { entityTagSpans } from '../utils/coreEntities';
import { filterRangesByScope, isInTag, replaceRanges, type SearchScope } from '../utils/searchScope';

interface BookSearchModalProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToMatch: (chapterId: string, sectionId: string, field: 'content' | 'contentEn', start: number, end: number) => void;
  onClose: () => void;
}

interface SearchMatch {
  key: string;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  field: 'content' | 'contentEn';
  start: number;
  end: number;
  before: string;
  match: string;
  after: string;
  /** Збіг усередині тега сутності (Т0.11, журнал #245). */
  inTag: boolean;
}

/** Скільки збігів показувати в списку — далі лише лічильник "ще N". Книга
 *  може мати сотні тисяч символів тексту, тож без стелі рендер списку
 *  результатів (не сам пошук — той рахує ВСІ збіги для лічильника) міг би
 *  стати основним гальмом при частому запиті на кшталт "і" чи "the". */
const MAX_RESULTS = 300;
/** Скільки символів контексту показувати з кожного боку збігу у фрагменті. */
const SNIPPET_CONTEXT = 36;
/** Мінімальна довжина запиту, з якої вже рахуємо збіги — без цього поріг
 *  запит із 1 символу на великій книзі дав би тисячі "збігів" одразу
 *  при кожному натисканні клавіші. */
const MIN_QUERY_LENGTH = 2;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Усі НЕперетинні входження `needle` в `haystack` (від кінця попереднього
 *  збігу — так запит "аа" у тексті "ааа" дає один збіг, а не два), як пари
 *  символьних індексів [start, end). */
export function findRanges(haystack: string, needle: string, matchCase: boolean): Array<[number, number]> {
  if (!needle) return [];
  const hay = matchCase ? haystack : haystack.toLowerCase();
  const ndl = matchCase ? needle : needle.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let idx = 0;
  while (idx <= hay.length) {
    const found = hay.indexOf(ndl, idx);
    if (found === -1) break;
    ranges.push([found, found + ndl.length]);
    idx = found + ndl.length;
  }
  return ranges;
}

/**
 * Пошук і заміна ПО ВСІЙ КНИЗІ — на відміну від штатного пошуку в
 * редакторі браузера (Ctrl+F), який бачить лише поточний відкритий
 * розділ, це проходить `book.chapters[].sections[]` цілком, в обох мовних
 * полях (`content`/`contentEn`).
 *
 * Працює напряму з рядком маркерів (`content`/`contentEn` — див.
 * utils/manuscriptDoc.ts), а не з документом ProseMirror: заміна одного
 * знайденого фрагмента — це проста нарізка рядка за вже відомими
 * символьними індексами; заміна "усіх" — це `String.replace` з
 * регуляркою, зібраною з екранованого запиту. Обидва шляхи йдуть через
 * ЄДИНИЙ `onUpdateBook(...)` виклик (одна нова книга за раз, а не по
 * розділу), як і рекомендовано в коментарі до `diffSectionChange` —
 * заміна одразу в кількох розділах автоматично не намагається пройти
 * дешевим шляхом одно-розділового патча.
 *
 * Свідомо БЕЗ підтримки регулярних виразів у самому пошуковому полі —
 * запит завжди трактується як буквальний підрядок (екранується перед
 * побудовою регулярки для "замінити всі"). Це і безпечніше (не можна
 * випадково зламати документ хитрим патерном), і чесніше щодо формату
 * маркерів: пошук рядка на кшталт `FONT` МОЖЕ знайти збіг усередині
 * `[FONT="…"]` — це свідомий компроміс простоти, а не недогляд.
 */
export function BookSearchModal({ book, onUpdateBook, onNavigateToMatch, onClose }: BookSearchModalProps) {
  const { t } = useLanguage();
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [confirmingReplaceAll, setConfirmingReplaceAll] = useState(false);
  /**
   * Що замінювати (Т0.11, рішення П9): типово — лише текст книги, щоб
   * заміна «Олена» → «Олеся» не переписала `[/character:Олена]` мимохідь.
   * Перейменування героя в тегах — свідомий вибір «лише теги» чи «усе».
   */
  const [scope, setScope] = useState<SearchScope>('text');

  // Дебаунс: рахувати збіги по всій книзі на КОЖНЕ натискання клавіші —
  // марнотратно на великій книзі. 250мс — той самий порядок величини, що
  // й типові дебаунси автозбереження в цьому репозиторії.
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(queryInput.trim()), 250);
    return () => clearTimeout(timeout);
  }, [queryInput]);

  // Підтвердження "замінити всі" стосується КОНКРЕТНОГО запиту й тексту
  // заміни — якщо автор змінив хоч один з них, попереднє підтвердження
  // втрачає сенс і має зникнути, а не залишитись "озброєним".
  useEffect(() => {
    setConfirmingReplaceAll(false);
  }, [query, replacement, matchCase, scope]);

  const { results, truncated, totalCount, tagCount, scopedCount } = useMemo(() => {
    if (query.length < MIN_QUERY_LENGTH) {
      return { results: [] as SearchMatch[], truncated: false, totalCount: 0, tagCount: 0, scopedCount: 0 };
    }
    const out: SearchMatch[] = [];
    let total = 0;
    let inTags = 0;
    let scoped = 0;
    for (const chapter of book.chapters) {
      for (const section of chapter.sections) {
        const fields: Array<['content' | 'contentEn', string]> = [
          ['content', section.content || ''],
          ['contentEn', section.contentEn || ''],
        ];
        for (const [field, text] of fields) {
          if (!text) continue;
          const ranges = findRanges(text, query, matchCase);
          const spans = ranges.length > 0 ? entityTagSpans(text) : [];
          for (const [start, end] of ranges) {
            total += 1;
            const inTag = isInTag(start, end, spans);
            if (inTag) inTags += 1;
            if (scope !== 'all' && (scope === 'tags') !== inTag) continue;
            scoped += 1;
            if (out.length < MAX_RESULTS) {
              const beforeStart = Math.max(0, start - SNIPPET_CONTEXT);
              const afterEnd = Math.min(text.length, end + SNIPPET_CONTEXT);
              out.push({
                key: `${section.id}:${field}:${start}`,
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                sectionId: section.id,
                sectionTitle: section.title,
                field,
                start,
                end,
                before: (beforeStart > 0 ? '…' : '') + text.slice(beforeStart, start),
                match: text.slice(start, end),
                after: text.slice(end, afterEnd) + (afterEnd < text.length ? '…' : ''),
                inTag,
              });
            }
          }
        }
      }
    }
    return { results: out, truncated: scoped > out.length, totalCount: total, tagCount: inTags, scopedCount: scoped };
  }, [book, query, matchCase, scope]);

  /** Замінює РІВНО ОДНЕ конкретне входження (за вже відомими індексами
   *  цього результату) — проста нарізка рядка, без регулярки. */
  const handleReplaceOne = (m: SearchMatch) => {
    const chapter = book.chapters.find((c) => c.id === m.chapterId);
    const section = chapter?.sections.find((s) => s.id === m.sectionId);
    if (!chapter || !section) return;
    const original = m.field === 'content' ? section.content || '' : section.contentEn || '';
    const updated = original.slice(0, m.start) + replacement + original.slice(m.end);
    const updatedChapters = book.chapters.map((c) => {
      if (c.id !== chapter.id) return c;
      return {
        ...c,
        sections: c.sections.map((s) => {
          if (s.id !== section.id) return s;
          if (m.field === 'content') {
            return { ...s, content: updated, wordCount: calculateWordCount(updated), lastModified: new Date().toISOString() };
          }
          return { ...s, contentEn: updated, lastModified: new Date().toISOString() };
        }),
      };
    });
    onUpdateBook(
      { ...book, chapters: updatedChapters, updatedAt: new Date().toISOString() },
      t('editor.searchReplaceOneLog'),
      t('editor.searchReplaceOneLogDetails', { section: section.title })
    );
  };

  /** Замінює УСІ входження запиту по всій книзі за один прохід — одна
   *  нова книга, один виклик `onUpdateBook`, один запис у журналі дій. */
  const handleReplaceAll = () => {
    if (!query || scopedCount === 0) return;
    let touchedSections = 0;
    let totalReplacements = 0;
    // Заміна за вже знайденими діапазонами, відфільтрованими за областю
    // (Т0.11): текст / теги / усе. Та сама логіка пошуку, що й у списку, —
    // тож замінюється рівно те, що автор бачив у лічильнику.
    const replaceField = (text: string): [string, number] => {
      if (!text) return [text, 0];
      const ranges = filterRangesByScope(text, findRanges(text, query, matchCase), scope);
      return ranges.length ? [replaceRanges(text, ranges, replacement), ranges.length] : [text, 0];
    };
    const updatedChapters = book.chapters.map((chap) => ({
      ...chap,
      sections: chap.sections.map((sec) => {
        const [newContent, contentHits] = replaceField(sec.content || '');
        const [newContentEn, enHits] = replaceField(sec.contentEn || '');
        if (!contentHits && !enHits) return sec;
        touchedSections += 1;
        totalReplacements += contentHits + enHits;
        return {
          ...sec,
          content: contentHits ? newContent : sec.content,
          contentEn: enHits ? newContentEn : sec.contentEn,
          wordCount: calculateWordCount((contentHits ? newContent : sec.content) || ''),
          lastModified: new Date().toISOString(),
        };
      }),
    }));
    onUpdateBook(
      { ...book, chapters: updatedChapters, updatedAt: new Date().toISOString() },
      t('editor.searchReplaceAllLog'),
      t('editor.searchReplaceAllLogDetails', {
        query,
        replacement,
        count: String(totalReplacements),
        sections: String(touchedSections),
      })
    );
    setConfirmingReplaceAll(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">{t('editor.searchBookHeading')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('editor.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder={t('editor.searchBookPlaceholder')}
              className="flex-1 p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 focus:border-amber-400 focus:outline-hidden"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 whitespace-nowrap select-none">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
                className="accent-amber-500"
              />
              {t('editor.searchMatchCase')}
            </label>
          </div>

          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={t('editor.searchReplacePlaceholder')}
            className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 focus:border-amber-400 focus:outline-hidden"
          />

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">
              {query.length < MIN_QUERY_LENGTH
                ? t('editor.searchMinLengthHint', { n: MIN_QUERY_LENGTH })
                : `${t('editor.searchMatchesFound', { n: totalCount })}${
                    tagCount > 0 ? ` ${t('editor.searchInTags', { n: tagCount })}` : ''
                  }${truncated ? ` ${t('editor.searchTruncatedHint', { n: MAX_RESULTS })}` : ''}`}
            </span>

            {tagCount > 0 && (
              <div className="flex items-center gap-1 text-[10px]" data-search-scope={scope}>
                <span className="text-slate-500">{t('editor.searchScopeLabel')}</span>
                {(['text', 'tags', 'all'] as SearchScope[]).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setScope(sc)}
                    data-search-scope-option={sc}
                    className={`px-2 py-0.5 rounded-md border ${
                      scope === sc ? 'bg-amber-500 text-slate-950 border-amber-500 font-bold' : 'bg-slate-900 text-slate-300 border-slate-700'
                    }`}
                  >
                    {t(sc === 'text' ? 'editor.searchScopeText' : sc === 'tags' ? 'editor.searchScopeTags' : 'editor.searchScopeAll')}
                  </button>
                ))}
              </div>
            )}

            {scopedCount > 0 &&
              (confirmingReplaceAll ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-amber-300 font-bold">
                    {t('editor.searchReplaceAllConfirm', { n: scopedCount })}
                  </span>
                  <button
                    onClick={handleReplaceAll}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                  >
                    {t('editor.searchReplaceAllConfirmBtn')}
                  </button>
                  <button
                    onClick={() => setConfirmingReplaceAll(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                  >
                    {t('editor.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingReplaceAll(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-xs font-bold"
                >
                  <Replace className="w-3.5 h-3.5" />
                  {t('editor.searchReplaceAllBtn')}
                </button>
              ))}
          </div>
        </div>

        <div className="overflow-y-auto p-2 space-y-1">
          {results.length === 0 && query.length >= MIN_QUERY_LENGTH && (
            <p className="text-xs text-slate-500 text-center py-8">{t('editor.searchNoMatches')}</p>
          )}
          {results.map((m) => (
            <div key={m.key} className="p-2.5 rounded-lg hover:bg-slate-900 group">
              <button
                onClick={() => {
                  onNavigateToMatch(m.chapterId, m.sectionId, m.field, m.start, m.end);
                  onClose();
                }}
                className="w-full text-left"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1">
                  <span className="truncate">{m.chapterTitle}</span>
                  <ChevronRight className="w-3 h-3 shrink-0" />
                  <span className="truncate text-slate-400">{m.sectionTitle}</span>
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      m.field === 'content' ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {m.field === 'content' ? 'UA' : 'EN'}
                  </span>
                  {m.inTag && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/20 text-violet-300" data-search-in-tag>
                      {t('editor.searchTagBadge')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-snug">
                  <span className="text-slate-500">{m.before}</span>
                  <mark className="bg-amber-500/40 text-amber-100 rounded px-0.5">{m.match}</mark>
                  <span className="text-slate-500">{m.after}</span>
                </p>
              </button>
              {replacement && (
                <button
                  onClick={() => handleReplaceOne(m)}
                  className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ArrowRight className="w-3 h-3" />
                  {t('editor.searchReplaceOneBtn')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
