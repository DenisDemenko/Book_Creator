/**
 * Вкладка адмінки «CRM»: єдина таблиця користувачів із сегментами-фільтрами
 * (створив книгу/курс, почав і не опублікував, опублікував, лише
 * зареєструвався, писав у чат підтримки) і контактами — плюс переписка з
 * чатом підтримки сайту прямо звідси (server/adminRoutes.ts → GET
 * /api/admin/crm/users, server/supportChatRoutes.ts → /api/admin/support/*).
 *
 * Сегменти рахує сервер (одне джерело правди — щоб таблиця й будь-яка інша
 * аналітика не розійшлися у визначенні «хто вже пробує»). Тут — лише показ
 * і фільтрація вже готових прапорців.
 *
 * Важливо: сегмент «опубліковано» враховує ЛИШЕ курси — у книг немає
 * локального поля статусу (публікація йде напряму через адмінський міст до
 * вітрини, минаючи чергу модерації). Це свідоме обмеження v1, не помилка;
 * див. коментар до GET /api/admin/crm/users у server/adminRoutes.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_SUPPORT_ATTACHMENTS,
  captureScreenshot,
  checkAttachment,
  fileToDataUrl,
  imagesFromPaste,
  supportAttachmentUrl,
} from '../utils/supportAttachments';
import {
  Users,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  GraduationCap,
  Clock,
  CheckCircle2,
  UserPlus,
  MessageCircle,
  Search,
  X,
  Send,
  Loader2,
  Crown,
  Paperclip,
  Camera,
} from 'lucide-react';
import { getRoleInfo } from '../utils/rbac';
import type { UserRole } from '../types';

type SegmentKey =
  | 'createdBook'
  | 'createdCourse'
  | 'inProgressNotPublished'
  | 'published'
  | 'registeredOnly'
  | 'usedSupportChat';

interface CrmSegments {
  createdBook: boolean;
  createdCourse: boolean;
  inProgressNotPublished: boolean;
  published: boolean;
  registeredOnly: boolean;
  usedSupportChat: boolean;
}

interface CrmSupport {
  threadId: string;
  status: 'open' | 'closed';
  messageCount: number;
  unreadByAdmin: number;
  lastMessageAt: string;
  lastMessagePreview: string;
}

interface CrmUserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  disabled?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  isProtectedAdmin: boolean;
  segments: CrmSegments;
  stats: { booksCount: number; coursesCount: number; coursesPublished: number };
  support: CrmSupport | null;
}

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

const SEGMENT_CHIPS: { key: SegmentKey; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'createdBook', label: 'Створив книгу', icon: BookOpen, color: 'text-cyan-300' },
  { key: 'createdCourse', label: 'Створив курс', icon: GraduationCap, color: 'text-violet-300' },
  { key: 'inProgressNotPublished', label: 'Почав, не опублікував', icon: Clock, color: 'text-amber-300' },
  { key: 'published', label: 'Опублікував курс', icon: CheckCircle2, color: 'text-emerald-300' },
  { key: 'registeredOnly', label: 'Лише зареєструвався', icon: UserPlus, color: 'text-slate-400' },
  { key: 'usedSupportChat', label: 'Писав у підтримку', icon: MessageCircle, color: 'text-rose-300' },
];

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Помилка запиту (${res.status})`);
  return data;
}

/** Слайд-панель перепискИ з одним користувачем — відкривається з рядка таблиці. */
const SupportThreadPanel: React.FC<{
  userRow: CrmUserRow;
  onClose: () => void;
  onThreadUpdated: (userId: string, thread: SupportThread) => void;
}> = ({ userRow, onClose, onThreadUpdated }) => {
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Картинки, вже підготовлені до надсилання (data:URL). */
  const [drafts, setDrafts] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);

  const threadId = userRow.support?.threadId;

  const load = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await request(`/api/admin/support/threads/${threadId}`);
      setThread(data.thread);
      setMessages(data.messages || []);
      onThreadUpdated(userRow.id, data.thread);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося завантажити переписку.');
    } finally {
      setLoading(false);
    }
    // onThreadUpdated навмисно поза залежностями — стабільний виклик один
    // раз на відкриття панелі, а не на кожен ререндер батька.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, userRow.id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Спільний шлях для всіх трьох джерел картинки: файл, буфер, знімок екрана. */
  const addImage = async (file: File | Blob) => {
    const problem = checkAttachment(file);
    if (problem) return setError(problem);
    if (drafts.length >= MAX_SUPPORT_ATTACHMENTS) {
      return setError(`Максимум ${MAX_SUPPORT_ATTACHMENTS} зображення за одну репліку.`);
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
      setError(err?.message || 'Не вдалося зробити знімок екрана.');
    }
  };

  const send = async () => {
    const content = draft.trim();
    // Відповідь із самим лише знімком екрана — цілком осмислена.
    if ((!content && drafts.length === 0) || !threadId || sending) return;
    setSending(true);
    setError(null);
    try {
      const data = await request(`/api/admin/support/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, attachments: drafts }),
      });
      setMessages((prev) => [...prev, data.message]);
      setThread(data.thread);
      onThreadUpdated(userRow.id, data.thread);
      setDraft('');
      setDrafts([]);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося надіслати відповідь.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-slate-950 border-l border-white/[0.08] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-bold text-sm text-slate-100 truncate">{userRow.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{userRow.email}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg badge-glass hover:border-slate-400/40 text-slate-300 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Завантаження…
            </div>
          )}
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs">{error}</div>
          )}
          {!loading && !threadId && (
            <p className="text-xs text-slate-500">Користувач ще не писав у підтримку.</p>
          )}
          {!loading && messages.length === 0 && threadId && (
            <p className="text-xs text-slate-500">Повідомлень поки немає.</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.senderRole === 'admin' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap break-words ${
                  m.senderRole === 'admin'
                    ? 'bg-amber-500/15 border border-amber-500/30 text-amber-100'
                    : 'bg-slate-900/80 border border-white/[0.08] text-slate-200'
                }`}
              >
                {m.content && <div>{m.content}</div>}
                {(m.attachments || []).length > 0 && (
                  <div className={`grid gap-1.5 ${(m.attachments || []).length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${m.content ? 'mt-1.5' : ''}`}>
                    {(m.attachments || []).map((id) => (
                      <a key={id} href={supportAttachmentUrl(id)} target="_blank" rel="noreferrer">
                        <img
                          src={supportAttachmentUrl(id)}
                          alt="Зображення у повідомленні"
                          loading="lazy"
                          className="w-full rounded-lg border border-white/[0.12] object-cover max-h-52"
                        />
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-slate-500">{fmtDate(m.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>

        {threadId && drafts.length > 0 && (
          <div className="px-3 pt-2 flex gap-1.5 flex-wrap">
            {drafts.map((d, i) => (
              <div key={i} className="relative">
                <img src={d} alt="" className="w-14 h-14 rounded-lg object-cover border border-white/[0.12]" />
                <button
                  onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center"
                  title="Прибрати"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {threadId && (
          <div className="p-3 border-t border-white/[0.06] flex items-end gap-1.5">
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
              className="p-2.5 rounded-xl bg-slate-900 border border-white/[0.08] text-slate-300 hover:text-white shrink-0"
              title="Прикріпити фото до чату"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              onClick={takeScreenshot}
              className="p-2.5 rounded-xl bg-slate-900 border border-white/[0.08] text-slate-300 hover:text-white shrink-0"
              title="Зробити знімок екрана і додати до чату"
            >
              <Camera className="w-4 h-4" />
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
              placeholder="Відповідь користувачу…"
              rows={2}
              className="field-glow flex-1 min-w-0 p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.08] text-slate-100 text-xs resize-none"
            />
            <button
              onClick={send}
              disabled={sending || (!draft.trim() && drafts.length === 0)}
              className="p-2.5 rounded-xl bg-amber-500 text-slate-950 disabled:opacity-40 transition-all shrink-0"
              title="Надіслати"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const AdminCrmView: React.FC = () => {
  const [rows, setRows] = useState<CrmUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<SegmentKey>>(new Set());
  const [search, setSearch] = useState('');
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/api/admin/crm/users');
      setRows(data.users || []);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося завантажити CRM.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFilter = (key: SegmentKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeFilters.size > 0 && ![...activeFilters].some((k) => r.segments[k])) return false;
      if (needle && !r.name.toLowerCase().includes(needle) && !r.email.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, activeFilters, search]);

  const openUserRow = rows.find((r) => r.id === openUserId) || null;

  const handleThreadUpdated = (userId: string, thread: SupportThread) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === userId
          ? {
              ...r,
              support: {
                threadId: thread.id,
                status: thread.status,
                messageCount: thread.messageCount,
                unreadByAdmin: thread.unreadByAdmin,
                lastMessageAt: thread.lastMessageAt,
                lastMessagePreview: thread.lastMessagePreview,
              },
            }
          : r
      )
    );
  };

  const unreadTotal = rows.reduce((sum, r) => sum + (r.support?.unreadByAdmin || 0), 0);

  return (
    <div className="space-y-4">
      <div className="p-6 rounded-2xl glass-panel space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            CRM — облік користувачів ({rows.length})
            {unreadTotal > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-bold">
                {unreadTotal} нових у підтримці
              </span>
            )}
          </h2>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 text-xs font-bold flex items-center gap-2 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Оновити
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук за іменем або поштою…"
              className="field-glow pl-8 pr-3 py-1.5 rounded-xl bg-slate-950/60 border border-white/[0.08] text-slate-100 text-xs w-56"
            />
          </div>
          {SEGMENT_CHIPS.map(({ key, label, icon: Icon, color }) => {
            const active = activeFilters.has(key);
            return (
              <button
                key={key}
                onClick={() => toggleFilter(key)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all border ${
                  active
                    ? 'bg-amber-500 text-slate-950 border-amber-500'
                    : 'badge-glass text-slate-300 hover:border-slate-400/40 border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? '' : color}`} />
                {label}
              </button>
            );
          })}
          {activeFilters.size > 0 && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="px-2.5 py-1.5 rounded-xl text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-all"
            >
              <X className="w-3 h-3" /> Скинути фільтри
            </button>
          )}
        </div>

        {filteredRows.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            {rows.length === 0 ? 'Поки що немає користувачів.' : 'Під фільтр не потрапив жоден користувач.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-white/[0.06]">
                  <th className="pb-2 pr-3 font-medium">Користувач</th>
                  <th className="pb-2 pr-3 font-medium">Роль</th>
                  <th className="pb-2 pr-3 font-medium">Сегменти</th>
                  <th className="pb-2 pr-3 font-medium">Підтримка</th>
                  <th className="pb-2 pr-3 font-medium">Реєстрація</th>
                  <th className="pb-2 text-right font-medium">Дії</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const roleInfo = getRoleInfo(r.role);
                  return (
                    <tr key={r.id} className={`border-b border-white/[0.04] ${r.disabled ? 'opacity-50' : ''}`}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          {r.isProtectedAdmin && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-100 truncate">{r.name}</div>
                            <div className="text-[11px] text-slate-500 truncate">{r.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {roleInfo.badgeEmoji} {roleInfo.nameUk}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {SEGMENT_CHIPS.filter(({ key }) => r.segments[key]).map(({ key, label, icon: Icon, color }) => (
                            <span
                              key={key}
                              className={`px-1.5 py-0.5 rounded-md bg-slate-900/70 border border-white/[0.06] text-[10px] flex items-center gap-1 ${color}`}
                              title={label}
                            >
                              <Icon className="w-3 h-3" />
                              {label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 max-w-[220px]">
                        {r.support ? (
                          <div className="min-w-0">
                            <div className="text-slate-300 truncate flex items-center gap-1.5">
                              {r.support.unreadByAdmin > 0 && (
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                              )}
                              {r.support.lastMessagePreview || '(без тексту)'}
                            </div>
                            <div className="text-[10px] text-slate-500">{fmtDate(r.support.lastMessageAt)}</div>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleDateString('uk-UA')}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setOpenUserId(r.id)}
                          disabled={!r.support}
                          title={r.support ? 'Відкрити переписку' : 'Користувач ще не писав у підтримку'}
                          className="px-2.5 py-1.5 rounded-lg badge-glass hover:border-amber-400/40 text-slate-300 text-[11px] font-bold flex items-center gap-1.5 transition-all disabled:opacity-30 ml-auto"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Чат
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed">
          Сегмент «Опублікував курс» враховує лише курси — публікація книг іде напряму через адмінський міст до
          вітрини і не має локального статусу. Книга без опублікованого курсу потрапляє в «Почав, не опублікував».
        </p>
      </div>

      {openUserRow && (
        <SupportThreadPanel userRow={openUserRow} onClose={() => setOpenUserId(null)} onThreadUpdated={handleThreadUpdated} />
      )}
    </div>
  );
};
