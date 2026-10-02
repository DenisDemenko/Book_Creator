/**
 * «Запити доступу» в панелі «Доступ» у «Команді» (Т6.3 В3; ТЗ Role
 * Onboarding §20: Approve / Modify / Reject).
 *
 * Бачить і вирішує власник книги, адміністратор або учасник із правом
 * керування (сервер перевіряє кожне рішення). «Схвалити» — доступ як
 * запитано; «Змінити» — інший рівень, область чи цілі (саме тут власник
 * обирає розділи, сцени чи героїв, яких людина ще не бачила); «Відхилити» —
 * з причиною. Схвалення = наданий доступ Т6.2.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Inbox, Loader2, PencilLine, X } from 'lucide-react';
import { onb } from './onboardingApi';

type Lang = 'uk' | 'en';
type Scope = 'book' | 'chapter' | 'scene' | 'character' | 'media_library';

interface RequestRow {
  id: string;
  userId: string;
  roles: { roleId: string; specialization: string | null }[];
  scope: string;
  scopeRefs: string[];
  capabilities: string[];
  level: string;
  message: string;
  orderId: string | null;
  status: string;
  reason: string;
  decidedBy: string | null;
  decision: Record<string, any> | null;
  createdAt: string;
}
interface Outline { chapters: Array<{ id: string; title: string; sections: Array<{ id: string; title: string }> }> }

const LV: Record<string, { uk: string; en: string }> = {
  view: { uk: 'Перегляд', en: 'View' },
  comment: { uk: 'Коментування', en: 'Comment' },
  review: { uk: 'Рецензування', en: 'Review' },
  edit: { uk: 'Редагування', en: 'Edit' },
  create: { uk: 'Створення', en: 'Create' },
  approve: { uk: 'Затвердження', en: 'Approve' },
  work: { uk: 'Робота з файлами', en: 'Work with files' },
};
const SC: Record<Scope, { uk: string; en: string }> = {
  book: { uk: 'Уся книга / курс', en: 'Whole book / course' },
  chapter: { uk: 'Розділи', en: 'Chapters' },
  scene: { uk: 'Сцени', en: 'Scenes' },
  character: { uk: 'Персонажі', en: 'Characters' },
  media_library: { uk: 'Медіатека', en: 'Media library' },
};
const FROM_SCOPE: Record<string, Scope> = { whole_project: 'book', selected_book: 'book', selected_course: 'book', selected_chapters: 'chapter', selected_scenes: 'scene', selected_characters: 'character', media_library: 'media_library' };
const sel = 'w-full min-w-0 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white';

export const AccessRequestsSection: React.FC<{ bookId: string; lang: Lang; characters?: Array<{ id: string; name: string }>; roleLabel?: (id: string) => string; onChanged?: () => void }> = ({ bookId, lang, characters = [], roleLabel, onChanged }) => {
  const L = (uk: string, en: string) => (lang === 'en' ? en : uk);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [users, setUsers] = useState<Record<string, { name?: string; email?: string } | null>>({});
  const [outline, setOutline] = useState<Outline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { level: string; scope: Scope; refs: string[]; media: boolean; reason: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, { uk: string; en: string }>>({});
  useEffect(() => {
    onb<{ roles: Array<{ id: string; label: { uk: string; en: string } }> }>('GET', '/api/collaboration/roles')
      .then((r) => setLabels(Object.fromEntries(r.roles.map((x) => [x.id, x.label]))))
      .catch(() => {});
  }, []);
  const roleName = (id: string) => roleLabel?.(id) ?? labels[id]?.[lang] ?? id;
  const base = `/api/core/projects/${encodeURIComponent(bookId)}/access-requests`;

  const load = useCallback(async () => {
    try {
      const r = await onb<{ requests: RequestRow[]; users: typeof users; outline: Outline | null }>('GET', base);
      setRows(r.requests);
      setUsers(r.users);
      setOutline(r.outline);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return null; // не керівник або ядро недоступне — секції немає
  if (!rows) return <div className="py-3 flex justify-center text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  const pending = rows.filter((r) => r.status === 'pending');
  const decided = rows.filter((r) => r.status !== 'pending').slice(0, 8);

  const draft = (r: RequestRow) => edit[r.id] ?? { level: r.level, scope: FROM_SCOPE[r.scope] ?? 'book', refs: r.scopeRefs, media: r.capabilities.includes('upload'), reason: '' };
  const patch = (r: RequestRow, p: Partial<ReturnType<typeof draft>>) => setEdit((e) => ({ ...e, [r.id]: { ...draft(r), ...p } }));
  const decide = async (r: RequestRow, action: 'approve' | 'modify' | 'reject') => {
    const d = draft(r);
    setBusy(r.id);
    setErrors((m) => ({ ...m, [r.id]: '' }));
    try {
      await onb('POST', `${base}/${r.id}/decide`, action === 'modify' ? { action, level: d.level, scopeType: d.scope, scopeRefs: d.refs, mediaWork: d.media, reason: d.reason } : { action, reason: d.reason });
      await load();
      onChanged?.();
    } catch (e) {
      setErrors((m) => ({ ...m, [r.id]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const who = (uid: string) => users[uid]?.name || users[uid]?.email || uid;
  const refOptions = (scope: Scope): Array<{ id: string; name: string }> =>
    scope === 'chapter' ? (outline?.chapters ?? []).map((c) => ({ id: c.id, name: c.title || c.id }))
      : scope === 'scene' ? (outline?.chapters ?? []).flatMap((c) => c.sections.map((s) => ({ id: s.id, name: `${c.title} → ${s.title || s.id}` })))
      : scope === 'character' ? characters
      : [];

  return (
    <div className="p-3 rounded-2xl bg-slate-950/70 border border-amber-500/30 space-y-2" data-access-requests>
      <div className="flex items-center gap-2 text-xs font-bold text-white">
        <Inbox className="w-3.5 h-3.5 text-amber-400" /> {L('Запити доступу', 'Access requests')} {pending.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-slate-950" data-access-requests-count>{pending.length}</span>}
      </div>
      {!pending.length && <p className="text-[11px] text-slate-500">{L('Нових запитів немає.', 'No new requests.')}</p>}
      {pending.map((r) => {
        const d = draft(r);
        const opts = refOptions(d.scope);
        return (
          <div key={r.id} className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5" data-access-request={r.id}>
            <p className="text-xs font-bold text-slate-100">{who(r.userId)}</p>
            <p className="text-[11px] text-slate-300">
              {r.roles.map((x) => [roleName(x.roleId), x.specialization ? `(${roleName(x.specialization)})` : ''].join(' ').trim()).join(', ')} · {LV[r.level]?.[lang] ?? r.level} · {SC[FROM_SCOPE[r.scope] ?? 'book'][lang]}
              {r.orderId ? ` · ${L('замовлення', 'order')} ${r.orderId}` : ''}
            </p>
            {r.message && <p className="text-[11px] italic text-slate-400">«{r.message}»</p>}
            <div className="grid grid-cols-2 gap-1.5">
              <select value={d.level} onChange={(e) => patch(r, { level: e.target.value })} className={sel} data-access-request-level>
                {(d.scope === 'media_library' ? ['view', 'work'] : ['view', 'comment', 'review', 'edit', 'create', 'approve']).map((l) => <option key={l} value={l}>{LV[l][lang]}</option>)}
              </select>
              <select value={d.scope} onChange={(e) => patch(r, { scope: e.target.value as Scope, refs: [], level: e.target.value === 'media_library' ? 'view' : d.level === 'work' ? 'view' : d.level })} className={sel} data-access-request-scope>
                {(Object.keys(SC) as Scope[]).map((s) => <option key={s} value={s}>{SC[s][lang]}</option>)}
              </select>
            </div>
            {opts.length > 0 && (
              <select multiple value={d.refs} onChange={(e) => patch(r, { refs: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${sel} h-24`} data-access-request-refs>
                {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            {d.scope !== 'media_library' && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <input type="checkbox" checked={d.media} onChange={(e) => patch(r, { media: e.target.checked })} data-access-request-media /> {L('ще й робота з файлами в медіатеці', 'plus work with files in the media library')}
              </label>
            )}
            <input value={d.reason} onChange={(e) => patch(r, { reason: e.target.value })} placeholder={L('Коментар / причина (необовʼязково)', 'Comment / reason (optional)')} className={sel} data-access-request-reason />
            {errors[r.id] && <p className="text-[11px] text-rose-300" data-access-request-error>{errors[r.id]}</p>}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={busy === r.id} onClick={() => void decide(r, 'approve')} className="flex items-center gap-1 rounded-lg border border-emerald-500/50 px-2 py-1 text-[11px] font-bold text-emerald-200" data-access-request-approve><Check className="w-3 h-3" /> {L('Схвалити', 'Approve')}</button>
              <button type="button" disabled={busy === r.id} onClick={() => void decide(r, 'modify')} className="flex items-center gap-1 rounded-lg border border-sky-500/50 px-2 py-1 text-[11px] text-sky-200" data-access-request-modify><PencilLine className="w-3 h-3" /> {L('Змінити й надати', 'Modify & grant')}</button>
              <button type="button" disabled={busy === r.id} onClick={() => void decide(r, 'reject')} className="flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] text-rose-300" data-access-request-reject><X className="w-3 h-3" /> {L('Відхилити', 'Reject')}</button>
            </div>
          </div>
        );
      })}
      {decided.length > 0 && (
        <ul className="space-y-0.5 border-t border-slate-800 pt-1.5 text-[10px] text-slate-500" data-access-requests-history>
          {decided.map((r) => (
            <li key={r.id} data-access-request-done={r.status}>{who(r.userId)} · {{ approved: L('схвалено', 'approved'), modified: L('змінено й надано', 'modified'), rejected: L('відхилено', 'rejected'), cancelled: L('відкликано', 'cancelled') }[r.status] ?? r.status}{r.reason ? ` · ${r.reason}` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AccessRequestsSection;
