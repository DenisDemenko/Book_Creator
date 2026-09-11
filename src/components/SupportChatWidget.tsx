/**
 * Плаваючий віджет чату підтримки сайту — для залогінених користувачів у
 * кабінеті/редакторі книги (App.tsx монтує його ОДИН РАЗ у спільній
 * автентифікованій оболонці, показуючи лише на цих двох вкладках; за
 * зразок НЕ береться CoachModal.tsx — той прив'язаний до редактора й
 * монтується всередині EditorView, а цей віджет — глобальний).
 *
 * Один тред на користувача (server/supportChatRoutes.ts, server/store.ts →
 * support_threads/support_messages): тред створюється лінькво за першим
 * повідомленням, адміністратор відповідає з розділу CRM в адмінці
 * (src/components/AdminCrmView.tsx) — двостороннє листування.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Loader2, Paperclip, Camera } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  MAX_SUPPORT_ATTACHMENTS,
  captureScreenshot,
  checkAttachment,
  fileToDataUrl,
  imagesFromPaste,
  supportAttachmentUrl,
} from '../utils/supportAttachments';

interface SupportMessage {
  id: string;
  threadId: string;
  senderRole: 'user' | 'admin';
  senderId: string;
  content: string;
  attachments?: string[];
  createdAt: string;
}

interface SupportThread {
  id: string;
  userId: string;
  status: 'open' | 'closed';
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
  unreadByAdmin: number;
  unreadByUser: number;
  createdAt: string;
  updatedAt: string;
}

async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Помилка запиту (${res.status})`);
  return data;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Як часто тихо звіряти непрочитане, поки віджет закритий (мс). */
const UNREAD_POLL_MS = 60_000;

export const SupportChatWidget: React.FC = () => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** Картинки, вже підготовлені до надсилання (data:URL). */
  const [drafts, setDrafts] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/api/support/thread');
      setThread(data.thread);
      setMessages(data.messages || []);
    } catch (err: any) {
      setError(err?.message || t('supportChat.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Тиха перевірка непрочитаного для бейджа на кнопці, поки панель закрита —
  // без повного відкриття не позначаємо unreadByUser прочитаним (це робить
  // лише GET на бекенді, а він викликається тут теж, тому лічильник
  // оновлюється зазвичай уже при першому відкритті).
  useEffect(() => {
    if (open) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await request('/api/support/thread');
        if (!cancelled) setThread(data.thread ?? null);
      } catch {
        /* тихо ігноруємо — це фонова перевірка бейджа, не критична дія */
      }
    };
    poll();
    const timer = setInterval(poll, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages.length]);

  /** Спільний шлях для всіх трьох джерел картинки: файл, буфер, знімок екрана. */
  const addImage = async (file: File | Blob) => {
    const problem = checkAttachment(file);
    if (problem) return setError(problem);
    if (drafts.length >= MAX_SUPPORT_ATTACHMENTS) {
      return setError(t('supportChat.tooManyAttachments', { n: MAX_SUPPORT_ATTACHMENTS }));
    }
    setError(null);
    const dataUrl = await fileToDataUrl(file);
    setDrafts((prev) => [...prev, dataUrl]);
  };

  const takeScreenshot = async () => {
    try {
      const shot = await captureScreenshot();
      if (shot) await addImage(shot);
    } catch (err: any) {
      setError(err?.message || t('supportChat.screenshotError'));
    }
  };

  const send = async () => {
    const content = draft.trim();
    // Репліка з самим лише знімком екрана — цілком осмислена.
    if ((!content && drafts.length === 0) || sending) return;
    setSending(true);
    setError(null);
    try {
      const data = await request('/api/support/thread/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, attachments: drafts }),
      });
      setMessages((prev) => [...prev, data.message]);
      setThread(data.thread);
      setDraft('');
      setDrafts([]);
    } catch (err: any) {
      setError(err?.message || t('supportChat.sendError'));
    } finally {
      setSending(false);
    }
  };

  const unread = thread?.unreadByUser || 0;

  return (
    <>
      {/* Позиція: верх-право — НЕ bottom-right. Той куток постійно займає
          плаваючий віджет сонця (DraggableSun.tsx — згорнута пігулка
          "Сонце (...)" на fixed bottom-4 right-4 z-50, а розгорнута панель
          керування там же росте ще вище й ширше). Кнопка підтримки на
          bottom-6 right-6 z-40 опинялась візуально ПІД пігулкою сонця
          (нижчий z-index, та сама ділянка екрана) — клік по видимому куту
          ловила пігулка сонця, а не ця кнопка.

          Піднято з top-20 у самий верхній куток за проханням власника:
          на top-20 кнопка накривала вкладки правої панелі («Робота з
          AI»). Праворуч від інформаційних чипів шапки («Формат: A4 …»)
          рівно стільки вільного місця, скільки треба кнопці. Підпис під
          нею ховається на вузьких вікнах (xl:block) — там це місце вже
          зайняте чипами. */}
      <div className="fixed top-1.5 right-4 z-40 flex flex-col items-center gap-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative w-12 h-12 rounded-full bg-amber-500 text-slate-950 shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
          title={t('supportChat.openButtonTitle')}
        >
          {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
          {!open && unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-slate-950">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
        <span className="hidden xl:block max-w-[92px] text-center text-[9px] leading-tight font-semibold text-amber-300/90 select-none pointer-events-none">
          {t('supportChat.buttonCaption')}
        </span>
      </div>

      {open && (
        <div className="fixed top-36 right-6 z-40 w-[340px] max-w-[calc(100vw-2rem)] h-[440px] max-h-[70vh] bg-slate-950 border border-white/[0.1] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-slate-100 font-bold text-xs">
              <MessageCircle className="w-4 h-4 text-amber-400" />
              {t('supportChat.title')}
            </div>
            <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-white/10 text-slate-400 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {loading && (
              <div className="flex items-center justify-center py-8 text-slate-500 text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('supportChat.loading')}
              </div>
            )}
            {error && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px]">{error}</div>
            )}
            {!loading && messages.length === 0 && !error && (
              <p className="text-[11px] text-slate-500 leading-relaxed">{t('supportChat.emptyHint')}</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.senderRole === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap break-words ${
                    m.senderRole === 'user'
                      ? 'bg-amber-500/15 border border-amber-500/30 text-amber-100'
                      : 'bg-slate-900/80 border border-white/[0.08] text-slate-200'
                  }`}
                >
                  {m.content && <div>{m.content}</div>}
                  {/* Картинки адміністратора приходять сюди тим самим
                      маршрутом, що й власні — /api/support/attachment/:id
                      віддає файл обом сторонам розмови. */}
                  {(m.attachments || []).length > 0 && (
                    <div className={`grid gap-1.5 ${(m.attachments || []).length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${m.content ? 'mt-1.5' : ''}`}>
                      {(m.attachments || []).map((id) => (
                        <a key={id} href={supportAttachmentUrl(id)} target="_blank" rel="noreferrer">
                          <img
                            src={supportAttachmentUrl(id)}
                            alt={t('supportChat.attachmentAlt')}
                            loading="lazy"
                            className="w-full rounded-lg border border-white/[0.12] object-cover max-h-40"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-slate-500">{fmtTime(m.createdAt)}</div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Прикріплені, але ще не надіслані картинки */}
          {drafts.length > 0 && (
            <div className="px-2.5 pt-2 flex gap-1.5 flex-wrap shrink-0">
              {drafts.map((d, i) => (
                <div key={i} className="relative">
                  <img src={d} alt="" className="w-12 h-12 rounded-lg object-cover border border-white/[0.12]" />
                  <button
                    onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center"
                    title={t('supportChat.removeAttachment')}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="p-2.5 border-t border-white/[0.06] flex items-end gap-1.5 shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addImage(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="p-2 rounded-xl bg-slate-900 border border-white/[0.08] text-slate-300 hover:text-white shrink-0"
              title={t('supportChat.attachPhoto')}
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={takeScreenshot}
              className="p-2 rounded-xl bg-slate-900 border border-white/[0.08] text-slate-300 hover:text-white shrink-0"
              title={t('supportChat.screenshot')}
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // Знімок, зроблений системними засобами (Win+Shift+S), лежить
              // у буфері як зображення — так він і потрапляє в чат.
              onPaste={(e) => {
                const imgs = imagesFromPaste(e.nativeEvent as ClipboardEvent);
                if (imgs.length) {
                  e.preventDefault();
                  imgs.forEach((f) => addImage(f));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t('supportChat.placeholder')}
              rows={2}
              className="field-glow flex-1 min-w-0 p-2 rounded-xl bg-slate-950/60 border border-white/[0.08] text-slate-100 text-xs resize-none"
            />
            <button
              onClick={send}
              disabled={sending || (!draft.trim() && drafts.length === 0)}
              className="p-2.5 rounded-xl bg-amber-500 text-slate-950 disabled:opacity-40 transition-all shrink-0"
              title={t('supportChat.send')}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
