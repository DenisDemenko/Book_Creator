import React, { useMemo, useState } from 'react';
import { BookOpen, Check, Loader2, Send, X } from 'lucide-react';
import type { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { apiPath } from '../utils/basePath';
import { insertBatchIntoBook, joinManuscriptPages, scanPageText, type BatchScanLike, type ScanBatch } from '../utils/manuscriptBatch';
import type { DescribeRevealTarget } from './MediaLibraryView';

/**
 * Пакет сторінок рукопису з GrabFusion («Набір книги», A5): одна картка на всю
 * главу замість десятка окремих сканів. Автор бачить сторінки за порядком, правитиме
 * склеєний текст і вставляє главу одним рухом — у нову главу в кінці книги або в кінець
 * наявної. Усі скани пакета після цього позначаються вставленими.
 */

export type BatchPage = BatchScanLike & { imageUrl: string };

const NEW_CHAPTER = '';

interface Props {
  batch: ScanBatch<BatchPage>;
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onRevealChapterText?: (target: DescribeRevealTarget) => void;
  showToast: (msg: string) => void;
  /** Позначити скан вирішеним на сервері. */
  resolve: (scanId: string, action: 'inserted' | 'dismissed') => Promise<boolean>;
  /** Скани пакета вирішено — прибрати їх зі списку. */
  onResolved: (scanIds: string[]) => void;
}

export const ScanBatchCard: React.FC<Props> = ({ batch, book, onUpdateBook, onRevealChapterText, showToast, resolve, onResolved }) => {
  const { t } = useLanguage();
  const chapters = useMemo(() => [...(book.chapters || [])].sort((a, b) => a.order - b.order), [book.chapters]);
  const joined = useMemo(() => joinManuscriptPages(batch.pages.map(scanPageText)), [batch.pages]);
  const [text, setText] = useState(joined);
  const [title, setTitle] = useState(batch.chapterTitle);
  const [target, setTarget] = useState<string>(NEW_CHAPTER);
  const [confirming, setConfirming] = useState<'insert' | 'dismiss' | null>(null);
  const [busy, setBusy] = useState(false);

  const ids = batch.pages.map((p) => p.scanId);
  const targetChapter = chapters.find((c) => c.id === target);
  const heading = batch.chapterTitle ? t('scanInbox.batchTitle', { title: batch.chapterTitle }) : t('scanInbox.batchUntitled');

  const resolveAll = async (action: 'inserted' | 'dismissed'): Promise<number> => {
    let failed = 0;
    for (const id of ids) if (!(await resolve(id, action))) failed += 1;
    return failed;
  };

  const handleInsert = async () => {
    setBusy(true);
    const chapterTitle = title.trim() || t('scanInbox.batchUntitled');
    const inserted = insertBatchIntoBook(book, text, { chapterId: target || null, title: chapterTitle });
    if (!inserted) {
      showToast(t('scanInbox.insertFailed'));
      setBusy(false);
      setConfirming(null);
      return;
    }
    onUpdateBook(inserted.book, 'Рукопис із телефона передано в книгу', `Глава «${inserted.chapterTitle}» ← ${ids.length} стор. (AI-чернетка)`);
    const failed = await resolveAll('inserted');
    showToast(failed ? t('scanInbox.batchPartial', { n: failed }) : t('scanInbox.batchInsertedToast', { title: inserted.chapterTitle, n: ids.length }));
    onResolved(ids);
    onRevealChapterText?.({
      chapterId: inserted.chapterId,
      chapterTitle: inserted.chapterTitle,
      sectionId: inserted.sectionId,
      start: inserted.start,
      end: inserted.end,
      text: text.trim().split(/\n{2,}/)[0]?.trim() || '',
    });
  };

  const handleDismiss = async () => {
    setBusy(true);
    const failed = await resolveAll('dismissed');
    if (failed) showToast(t('scanInbox.loadFailed'));
    else showToast(t('scanInbox.batchDismissedToast'));
    onResolved(ids);
  };

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-slate-900/60 p-3 space-y-3" data-scan-batch={batch.batchId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BookOpen className="w-4 h-4 text-cyan-300 shrink-0" />
        <span className="text-[13px] font-bold text-white">{heading}</span>
        <span className="text-[10px] text-slate-400">{t('scanInbox.batchPages', { n: batch.pages.length })}</span>
        {batch.forNewBook && (
          <span className="text-[10px] text-amber-300/90">
            {batch.bookTitle ? t('scanInbox.batchNewBook', { title: batch.bookTitle }) : t('scanInbox.batchNewBookNoTitle')}
          </span>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" data-batch-pages>
        {batch.pages.map((p, i) => (
          <a key={p.scanId} href={apiPath(p.imageUrl)} target="_blank" rel="noreferrer" className="shrink-0 text-center" title={t('scanInbox.batchPageLabel', { n: i + 1 })}>
            <img src={p.imageUrl} alt="" className="w-16 h-20 object-cover rounded-md border border-slate-800 bg-black" />
            <span className="text-[9px] text-slate-500">{i + 1}</span>
          </a>
        ))}
      </div>

      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {t('scanInbox.batchTextLabel')}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="mt-1 w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200 normal-case font-normal tracking-normal leading-relaxed focus:border-cyan-500 outline-none"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {t('scanInbox.batchTarget')}
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 w-full p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200 normal-case font-normal tracking-normal"
            data-batch-target
          >
            <option value={NEW_CHAPTER}>{t('scanInbox.batchNewChapter')}</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {t('scanInbox.batchChapterTitle')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200 normal-case font-normal tracking-normal"
          />
        </label>
      </div>

      {confirming ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2" data-batch-confirm>
          <p className="text-[11px] text-amber-100">
            {confirming === 'insert'
              ? target
                ? t('scanInbox.batchConfirmExisting', { title: targetChapter?.title || '', n: batch.pages.length })
                : t('scanInbox.batchConfirmNew', { title: title.trim() || t('scanInbox.batchUntitled'), n: batch.pages.length })
              : t('scanInbox.batchDismissConfirm')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => (confirming === 'insert' ? handleInsert() : handleDismiss())}
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {confirming === 'insert' ? t('scanInbox.confirmYes') : t('scanInbox.batchDismiss')}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-lg border border-slate-700 text-[11px] text-slate-300">
              {t('scanInbox.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => setConfirming('insert')}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/30 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"
            data-batch-insert
          >
            <Send className="w-3 h-3" /> {t('scanInbox.batchInsert')}
          </button>
          <button
            type="button"
            onClick={() => setConfirming('dismiss')}
            className="px-3 py-1.5 rounded-lg border border-slate-700 text-rose-300 hover:bg-rose-500/10 text-[11px] font-bold flex items-center gap-1.5"
          >
            <X className="w-3 h-3" /> {t('scanInbox.batchDismiss')}
          </button>
        </div>
      )}
    </div>
  );
};
