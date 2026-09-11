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
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface SupportMessage {
  id: string;
  threadId: string;
  senderRole: 'user' | 'admin';
  senderId: string;
  content: string;
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
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const data = await request('/api/support/thread/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setMessages((prev) => [...prev, data.message]);
      setThread(data.thread);
      setDraft('');
    } catch (err: any) {
      setError(err?.message || t('supportChat.sendError'));
    } finally {
      setSending(false);
    }
  };

  const unread = thread?.unreadByUser || 0;

  return (
    <>
      {/* Позиція: верх-право, під шапкою — НЕ bottom-right. Той куток
          постійно займає плаваючий віджет сонця (DraggableSun.tsx —
          згорнута пігулка "Сонце (...)" на fixed bottom-4 right-4 z-50,
          а розгорнута панель керування там же росте ще вище й ширше).
          Кнопка підтримки на bottom-6 right-6 z-40 опинялась візуально
          ПІД пігулкою сонця (нижчий z-index, та сама ділянка екрана) —
          клік по видимому куту ловила пігулка сонця, а не ця кнопка. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed top-20 right-6 z-40 w-12 h-12 rounded-full bg-amber-500 text-slate-950 shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
        title={t('supportChat.openButtonTitle')}
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-slate-950">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

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
                  <div>{m.content}</div>
                  <div className="mt-1 text-[10px] text-slate-500">{fmtTime(m.createdAt)}</div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="p-2.5 border-t border-white/[0.06] flex items-end gap-2 shrink-0">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t('supportChat.placeholder')}
              rows={2}
              className="field-glow flex-1 p-2 rounded-xl bg-slate-950/60 border border-white/[0.08] text-slate-100 text-xs resize-none"
            />
            <button
              onClick={send}
              disabled={sending || !draft.trim()}
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
