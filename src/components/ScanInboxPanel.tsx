import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Smartphone, RefreshCw, KeyRound, Copy, Check, Trash2, ChevronDown, Send, X, Loader2 } from 'lucide-react';
import type { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { insertDescriptionIntoBook } from '../utils/describeCharacterTransfer';
import type { DescribeRevealTarget } from './MediaLibraryView';
import { apiPath } from '../utils/basePath';

/**
 * «Скани з телефону» — Студійна половина зовнішнього API (WriterScan).
 *
 * Застосунок фотографує сторінку, сервер розпізнає текст, автор перевіряє
 * його на телефоні й надсилає — і скан лягає СЮДИ, а не в книгу. Причина —
 * у server/external/externalApiRoutes.ts: книга живе в браузері, серверна
 * копія лише дзеркало, і запис у неї зник би за першим збереженням у
 * Студії. Тому вставляє Студія, тим самим шляхом, що й опис фото (#224):
 * AI-чернетка в кінці вибраної глави з кнопками «прийняти/відхилити».
 *
 * Тут же — підключення застосунку: особисті токени (створити, скопіювати
 * один раз, відкликати).
 */

interface ScanItem {
  scanId: string;
  bookId: string;
  status: string;
  recognizedText: string;
  text: string;
  chapterId: string | null;
  chapterTitle: string | null;
  sectionTitle: string | null;
  imageUrl: string;
  createdAt: string;
}

interface TokenItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface ScanDraft {
  text: string;
  sectionTitle: string;
  chapterId: string;
  withPhoto: boolean;
  confirming: 'insert' | 'dismiss' | null;
  busy: boolean;
}

interface ScanInboxPanelProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onRevealChapterText?: (target: DescribeRevealTarget) => void;
  showToast: (msg: string) => void;
}

const POLL_MS = 30_000;

export const ScanInboxPanel: React.FC<ScanInboxPanelProps> = ({ book, onUpdateBook, onRevealChapterText, showToast }) => {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ScanDraft>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [connectOpen, setConnectOpen] = useState(false);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const chapters = useMemo(() => [...(book.chapters || [])].sort((a, b) => a.order - b.order), [book.chapters]);
  const lastChapterId = chapters.length ? chapters[chapters.length - 1].id : '';

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/scans/inbox', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: ScanItem[] = Array.isArray(data?.scans) ? data.scans : [];
      setScans(list);
      setDrafts((prev) => {
        const next: Record<string, ScanDraft> = {};
        for (const s of list) {
          next[s.scanId] = prev[s.scanId] || {
            text: s.text || s.recognizedText || '',
            sectionTitle: s.sectionTitle || '',
            // Глава з телефону — якщо вона є в ЦІЙ (браузерній) копії книги; інакше остання.
            chapterId: s.chapterId && (book.chapters || []).some((c) => c.id === s.chapterId) ? s.chapterId : lastChapterId,
            withPhoto: false,
            confirming: null,
            busy: false,
          };
        }
        return next;
      });
    } catch {
      setLoadError(t('scanInbox.loadFailed'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, lastChapterId]);

  useEffect(() => {
    loadInbox();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadInbox();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadInbox]);

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/external-tokens', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setTokens(Array.isArray(data?.tokens) ? data.tokens : []);
    } catch {
      /* тихо — список просто лишиться порожнім */
    }
  }, []);

  useEffect(() => {
    if (connectOpen) loadTokens();
  }, [connectOpen, loadTokens]);

  const bookScans = scans.filter((s) => s.bookId === book.id);
  const otherCount = scans.length - bookScans.length;

  // Щойно зʼявились вхідні для цієї книги — розгортаємо панель сама, один раз:
  // автор відкрив медіатеку саме тому, що надіслав щось із телефону.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpened.current && bookScans.length > 0) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [bookScans.length]);

  const patchDraft = (id: string, patch: Partial<ScanDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const formatDate = (iso: string) => new Date(iso).toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });

  const resolve = async (scanId: string, action: 'inserted' | 'dismissed'): Promise<boolean> => {
    try {
      const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}/resolve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const handleInsert = async (scan: ScanItem) => {
    const draft = drafts[scan.scanId];
    if (!draft) return;
    patchDraft(scan.scanId, { busy: true });
    const title = draft.sectionTitle.trim() || t('scanInbox.defaultSectionTitle');
    const inserted = insertDescriptionIntoBook(
      book,
      {
        title,
        text: draft.text,
        photo: draft.withPhoto ? { url: scan.imageUrl, title } : null,
        chapterId: draft.chapterId,
      },
      { chapterId: draft.chapterId || null, withPhoto: draft.withPhoto, illustrationId: `ill-scan-${Date.now()}` }
    );
    if (!inserted) {
      showToast(t('scanInbox.insertFailed'));
      patchDraft(scan.scanId, { busy: false, confirming: null });
      return;
    }
    onUpdateBook(
      inserted.book,
      'Скан сторінки з телефону передано в книгу',
      `Глава «${inserted.chapterTitle}» → AI-чернетка${draft.withPhoto ? ' разом із фото' : ''}`
    );
    const ok = await resolve(scan.scanId, 'inserted');
    showToast(ok ? t('scanInbox.insertedToast', { title: inserted.chapterTitle }) : t('scanInbox.resolveFailed'));
    setScans((prev) => prev.filter((s) => s.scanId !== scan.scanId));
    onRevealChapterText?.({
      chapterId: inserted.chapterId,
      chapterTitle: inserted.chapterTitle,
      sectionId: inserted.sectionId,
      start: inserted.start,
      end: inserted.end,
      text: draft.text.trim().split(/\n{2,}/)[0]?.trim() || '',
    });
  };

  const handleDismiss = async (scan: ScanItem) => {
    patchDraft(scan.scanId, { busy: true });
    const ok = await resolve(scan.scanId, 'dismissed');
    if (ok) {
      setScans((prev) => prev.filter((s) => s.scanId !== scan.scanId));
      showToast(t('scanInbox.dismissedToast'));
    } else {
      patchDraft(scan.scanId, { busy: false, confirming: null });
      showToast(t('scanInbox.loadFailed'));
    }
  };

  const handleCreateToken = async () => {
    setTokenBusy(true);
    setNewToken(null);
    try {
      const res = await fetch('/api/external-tokens', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        showToast(String(data?.error || t('scanInbox.tokenFailed')));
        return;
      }
      setNewToken(data.token);
      setTokenName('');
      loadTokens();
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokeConfirmId(null);
    await fetch(`/api/external-tokens/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
    loadTokens();
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      /* буфер обміну недоступний — автор скопіює вручну з поля */
    }
  };

  // Під /studio (прод за rewrite маркетплейсу) адреса для застосунку теж із префіксом.
  const apiBase = `${window.location.origin}${apiPath('/api/external/v1')}`;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 mb-5" data-scan-inbox>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Smartphone className="w-4 h-4 text-cyan-300 shrink-0" />
          <span className="text-sm font-bold text-white">{t('scanInbox.title')}</span>
          {bookScans.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-500/40">
              {t('scanInbox.inboxCount', { n: bookScans.length })}
            </span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-slate-400 leading-snug">{t('scanInbox.subtitle')}</p>
            <button
              type="button"
              onClick={loadInbox}
              disabled={loading}
              className="shrink-0 px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-900 text-[11px] text-slate-300 hover:text-white flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t('scanInbox.refresh')}
            </button>
          </div>

          {loadError && <p className="text-[11px] text-rose-400">{loadError}</p>}
          {!loadError && bookScans.length === 0 && <p className="text-[12px] text-slate-500">{t('scanInbox.empty')}</p>}
          {otherCount > 0 && <p className="text-[11px] text-amber-300/80">{t('scanInbox.otherBooks', { n: otherCount })}</p>}

          <div className="space-y-3">
            {bookScans.map((scan) => {
              const d = drafts[scan.scanId];
              if (!d) return null;
              const chapterTitle = chapters.find((c) => c.id === d.chapterId)?.title || chapters[chapters.length - 1]?.title || '';
              return (
                <div key={scan.scanId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex flex-col md:flex-row gap-3" data-scan-item={scan.scanId}>
                  <a href={apiPath(scan.imageUrl)} target="_blank" rel="noreferrer" className="shrink-0 self-start">
                    <img src={scan.imageUrl} alt="" className="w-28 h-36 object-cover rounded-lg border border-slate-800 bg-black" />
                  </a>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                      <span>{formatDate(scan.createdAt)}</span>
                      <span>
                        {scan.chapterTitle
                          ? t('scanInbox.requestedChapter', { title: scan.chapterTitle })
                          : t('scanInbox.requestedNoChapter')}
                      </span>
                    </div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {t('scanInbox.textLabel')}
                      <textarea
                        value={d.text}
                        onChange={(e) => patchDraft(scan.scanId, { text: e.target.value })}
                        rows={6}
                        className="mt-1 w-full p-2 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200 normal-case font-normal tracking-normal leading-relaxed focus:border-cyan-500 outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {t('scanInbox.chapterLabel')}
                        <select
                          value={d.chapterId}
                          onChange={(e) => patchDraft(scan.scanId, { chapterId: e.target.value })}
                          className="mt-1 w-full p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200 normal-case font-normal tracking-normal"
                          data-scan-chapter
                        >
                          {chapters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {t('scanInbox.sectionTitleLabel')}
                        <input
                          value={d.sectionTitle}
                          onChange={(e) => patchDraft(scan.scanId, { sectionTitle: e.target.value })}
                          placeholder={t('scanInbox.defaultSectionTitle')}
                          className="mt-1 w-full p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200 normal-case font-normal tracking-normal"
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-slate-300">
                      <input type="checkbox" checked={d.withPhoto} onChange={(e) => patchDraft(scan.scanId, { withPhoto: e.target.checked })} />
                      {t('scanInbox.withPhoto')}
                    </label>

                    {d.confirming ? (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2" data-scan-confirm>
                        <p className="text-[11px] text-amber-100">
                          {d.confirming === 'insert' ? t('scanInbox.confirmInsert', { title: chapterTitle }) : t('scanInbox.dismissConfirm')}
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={d.busy}
                            onClick={() => (d.confirming === 'insert' ? handleInsert(scan) : handleDismiss(scan))}
                            className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {d.busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            {d.confirming === 'insert' ? t('scanInbox.confirmYes') : t('scanInbox.dismiss')}
                          </button>
                          <button
                            type="button"
                            disabled={d.busy}
                            onClick={() => patchDraft(scan.scanId, { confirming: null })}
                            className="px-3 py-1.5 rounded-lg border border-slate-700 text-[11px] text-slate-300"
                          >
                            {t('scanInbox.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!d.text.trim()}
                          onClick={() => patchDraft(scan.scanId, { confirming: 'insert' })}
                          className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/30 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"
                          data-scan-insert
                        >
                          <Send className="w-3 h-3" /> {t('scanInbox.insert')}
                        </button>
                        <button
                          type="button"
                          onClick={() => patchDraft(scan.scanId, { confirming: 'dismiss' })}
                          className="px-3 py-1.5 rounded-lg border border-slate-700 text-rose-300 hover:bg-rose-500/10 text-[11px] font-bold flex items-center gap-1.5"
                        >
                          <X className="w-3 h-3" /> {t('scanInbox.dismiss')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Підключення застосунку */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40">
            <button
              type="button"
              onClick={() => setConnectOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="flex items-center gap-2 text-[12px] font-bold text-slate-200">
                <KeyRound className="w-3.5 h-3.5 text-amber-300" /> {t('scanInbox.connectTitle')}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${connectOpen ? 'rotate-180' : ''}`} />
            </button>
            {connectOpen && (
              <div className="px-3 pb-3 space-y-3">
                <p className="text-[11px] text-slate-400 leading-snug">{t('scanInbox.connectHint')}</p>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-500 shrink-0">{t('scanInbox.apiBaseLabel')}:</span>
                  <code className="flex-1 min-w-0 truncate px-2 py-1 rounded bg-slate-950 border border-slate-800 text-cyan-200">{apiBase}</code>
                  <button type="button" onClick={() => copy('base', apiBase)} className="p-1.5 rounded border border-slate-800 text-slate-300" title={t('scanInbox.copy')}>
                    {copiedKey === 'base' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>

                {newToken && (
                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 space-y-1.5" data-new-token>
                    <p className="text-[11px] text-emerald-200">{t('scanInbox.newTokenTitle')}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 break-all px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-emerald-100">{newToken}</code>
                      <button type="button" onClick={() => copy('token', newToken)} className="p-1.5 rounded border border-slate-800 text-slate-300" title={t('scanInbox.copy')}>
                        {copiedKey === 'token' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    placeholder={t('scanInbox.tokenNamePlaceholder')}
                    className="flex-1 p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[12px] text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={handleCreateToken}
                    disabled={tokenBusy}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-200 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {tokenBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                    {t('scanInbox.createToken')}
                  </button>
                </div>

                {tokens.length === 0 ? (
                  <p className="text-[11px] text-slate-500">{t('scanInbox.tokensEmpty')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {tokens.map((tk) => (
                      <li key={tk.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] rounded-lg border border-slate-800 px-2.5 py-1.5">
                        <span className={`font-bold ${tk.revokedAt ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{tk.name}</span>
                        <code className="text-slate-500">{tk.prefix}…</code>
                        <span className="text-slate-500">{t('scanInbox.tokenCreatedAt', { date: formatDate(tk.createdAt) })}</span>
                        <span className="text-slate-500">
                          {tk.revokedAt
                            ? t('scanInbox.tokenRevoked')
                            : tk.lastUsedAt
                            ? t('scanInbox.tokenLastUsed', { date: formatDate(tk.lastUsedAt) })
                            : t('scanInbox.tokenNeverUsed')}
                        </span>
                        {!tk.revokedAt &&
                          (revokeConfirmId === tk.id ? (
                            <span className="ml-auto flex items-center gap-1.5">
                              <span className="text-amber-200">{t('scanInbox.revokeConfirm', { name: tk.name })}</span>
                              <button type="button" onClick={() => handleRevoke(tk.id)} className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-200 font-bold">
                                {t('scanInbox.revoke')}
                              </button>
                              <button type="button" onClick={() => setRevokeConfirmId(null)} className="px-2 py-0.5 rounded border border-slate-700 text-slate-300">
                                {t('scanInbox.cancel')}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRevokeConfirmId(tk.id)}
                              className="ml-auto p-1 rounded text-rose-400 hover:bg-rose-500/10"
                              title={t('scanInbox.revoke')}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
