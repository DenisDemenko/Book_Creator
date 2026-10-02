/**
 * Панель «Доступ» у «Команді» (Т6.2 В3, `PLAN_ACCESS.md`).
 *
 * Кожен бачить свій доступ до книги. Власник, адміністратор або учасник із
 * правом керування бачить учасників із їхніми наданими доступами, надає
 * доступ (рівень, область, ціль, строк), відкликає його й переглядає журнал.
 * Роль нічого не дозволяє — дозволяє лише наданий доступ; перевіряє все
 * сервер (`/api/core/projects/:id/access`).
 */
import { summarizeAccess, type AccessSummaryInput } from '../utils/accessSummary';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, History, Loader2, ShieldCheck, ShieldPlus } from 'lucide-react';
import { AccessRequestsSection } from './onboarding/AccessRequestsSection';

type Lang = 'uk' | 'en';
type Level = 'view' | 'comment' | 'review' | 'edit' | 'create' | 'approve' | 'manage' | 'work';
type Scope = 'book' | 'chapter' | 'scene' | 'character' | 'location' | 'media_library';

interface Grant {
  id: string;
  level: Level;
  scopeType: Scope | string;
  scopeRef: string | null;
  validUntil: string | null;
  status: 'active' | 'revoked';
  source: 'manual' | 'admin' | 'legacy_invite';
  grantedBy: string;
  createdAt: string;
  revokedAt: string | null;
}
interface ParticipantEntry {
  participant: { id: string; userId: string; status: string };
  roles: Array<{ roleId: string; label: { uk: string; en: string } | null }>;
  user: { name?: string; email?: string } | null;
  grants: Grant[];
}
interface Effective {
  full: boolean;
  restricted: boolean;
  book: Level | 'none';
  chapters: Record<string, Level>;
  scenes: Record<string, Level>;
  characters: Record<string, Level>;
  locations: Record<string, Level>;
  media: 'none' | 'view' | 'work';
  canWriteAny: boolean;
}
interface Targets {
  chapters: Array<{ id: string; title: string; sections: Array<{ id: string; title: string }> }>;
  characters: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
}
interface AccessState {
  canManage: boolean;
  me: { userId: string; isOwner: boolean; role: string; effective: Effective };
  participants: ParticipantEntry[];
  targets: Targets | null;
}
interface AccessEvent {
  id: string;
  action: 'access_granted' | 'access_revoked';
  actor: string;
  createdAt: string;
  details: Record<string, any>;
}

const LEVELS: Record<Level, { uk: string; en: string }> = {
  view: { uk: 'Перегляд', en: 'View' },
  comment: { uk: 'Коментування', en: 'Comment' },
  review: { uk: 'Рецензування', en: 'Review' },
  edit: { uk: 'Редагування', en: 'Edit' },
  create: { uk: 'Створення', en: 'Create' },
  approve: { uk: 'Затвердження', en: 'Approve' },
  manage: { uk: 'Керування', en: 'Manage' },
  work: { uk: 'Робота з файлами', en: 'Work with files' },
};
const SCOPES: Record<Scope, { uk: string; en: string }> = {
  book: { uk: 'Уся книга', en: 'Whole book' },
  chapter: { uk: 'Розділ', en: 'Chapter' },
  scene: { uk: 'Сцена', en: 'Scene' },
  character: { uk: 'Персонаж', en: 'Character' },
  location: { uk: 'Локація', en: 'Location' },
  media_library: { uk: 'Медіатека', en: 'Media library' },
};
const TEXT_LEVELS: Level[] = ['view', 'comment', 'review', 'edit', 'create', 'approve', 'manage'];

const selectCls = 'w-full min-w-0 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-hidden focus:border-amber-400';

export const AccessPanel: React.FC<{ bookId: string; lang: Lang }> = ({ bookId, lang }) => {
  const L = useCallback((uk: string, en: string) => (lang === 'en' ? en : uk), [lang]);
  const [state, setState] = useState<AccessState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<AccessEvent[] | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const [userId, setUserId] = useState('');
  const [scope, setScope] = useState<Scope>('scene');
  const [level, setLevel] = useState<Level>('view');
  const [target, setTarget] = useState('');
  const [until, setUntil] = useState('');

  const base = `/api/core/projects/${encodeURIComponent(bookId)}/access`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(base, { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 503
            ? L('Семантичне ядро зараз недоступне — доступ живе в ньому.', 'The semantic core is unavailable — access lives there.')
            : res.status === 401
            ? L('Увійдіть, щоб побачити доступ.', 'Sign in to see access.')
            : body?.error || L('Немає доступу до цієї книги.', 'No access to this book.'),
        );
        setState(null);
        return;
      }
      setState(body as AccessState);
    } catch {
      setError(L('Не вдалося завантажити доступ.', 'Could not load access.'));
    } finally {
      setLoading(false);
    }
  }, [base, L]);

  useEffect(() => {
    void load();
  }, [load]);

  const targets = state?.targets ?? null;
  const people = useMemo(
    () => (state?.participants ?? []).filter((p) => p.participant.userId !== state?.me.userId && p.participant.status === 'active' && !p.roles.some((r) => r.roleId === 'project_owner')),
    [state],
  );
  const privileged = !!state && (state.me.isOwner || state.me.role === 'admin');
  const levelOptions: Level[] = scope === 'media_library' ? ['view', 'work'] : TEXT_LEVELS.filter((l) => l !== 'manage' || (privileged && scope === 'book'));

  useEffect(() => {
    if (!levelOptions.includes(level)) setLevel(levelOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, privileged]);
  useEffect(() => {
    setTarget('');
  }, [scope]);
  useEffect(() => {
    if (!userId && people[0]) setUserId(people[0].participant.userId);
  }, [people, userId]);

  const targetName = useCallback(
    (scopeType: string, ref: string | null): string => {
      if (!ref) return '';
      if (scopeType === 'chapter') return targets?.chapters.find((c) => c.id === ref)?.title || ref;
      if (scopeType === 'scene') {
        for (const c of targets?.chapters ?? []) {
          const s = c.sections.find((x) => x.id === ref);
          if (s) return `${c.title} → ${s.title || s.id}`;
        }
        return ref;
      }
      if (scopeType === 'character') return targets?.characters.find((e) => e.id === ref)?.name || ref;
      if (scopeType === 'location') return targets?.locations.find((e) => e.id === ref)?.name || ref;
      return ref;
    },
    [targets],
  );
  const describeGrant = (g: { level: string; scopeType: string; scopeRef: string | null }) => {
    const lv = LEVELS[g.level as Level]?.[lang] ?? g.level;
    const sc = SCOPES[g.scopeType as Scope]?.[lang] ?? g.scopeType;
    const name = targetName(g.scopeType, g.scopeRef);
    return `${lv} · ${sc}${name ? ` «${name}»` : ''}`;
  };
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'uk-UA') : '');
  const personName = (uid: string) => {
    const p = state?.participants.find((x) => x.participant.userId === uid);
    return p?.user?.name || p?.user?.email || uid;
  };

  const needsTarget = scope === 'chapter' || scope === 'scene' || scope === 'character' || scope === 'location';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || (needsTarget && !target)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          level,
          scopeType: scope,
          scopeRef: needsTarget ? target : undefined,
          validUntil: until ? new Date(`${until}T23:59:59`).toISOString() : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: 'error', text: body?.error || L('Не вдалося надати доступ.', 'Could not grant access.') });
        return;
      }
      setNotice({ kind: 'success', text: L(`Надано: ${describeGrant(body.grant)} — ${personName(userId)}.`, `Granted: ${describeGrant(body.grant)} — ${personName(userId)}.`) });
      setTarget('');
      setUntil('');
      await load();
      if (events) void loadEvents();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (g: Grant) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(g.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: 'error', text: body?.error || L('Не вдалося відкликати.', 'Could not revoke.') });
        return;
      }
      setNotice({ kind: 'success', text: L(`Відкликано: ${describeGrant(g)}.`, `Revoked: ${describeGrant(g)}.`) });
      await load();
      if (events) void loadEvents();
    } finally {
      setBusy(false);
    }
  };

  const loadEvents = async () => {
    const res = await fetch(`${base}/events`, { credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    setEvents(res.ok ? body.events ?? [] : []);
  };

  // Т6.4: той самий текст, що й у «Моєму просторі».
  const mySummary = (eff: Effective): string => summarizeAccess(eff as unknown as AccessSummaryInput, lang);

  if (loading && !state) {
    return (
      <div className="py-10 flex justify-center text-slate-400" data-access-panel="loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300" data-access-panel="error">
        {error}
      </div>
    );
  }
  if (!state) return null;

  return (
    <div className="space-y-3" data-access-panel="ready">
      <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800" data-access-me>
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300 mb-1">
          <ShieldCheck className="w-3.5 h-3.5" /> {L('Мій доступ', 'My access')}
        </div>
        <p className="text-[11px] text-slate-300 leading-relaxed">{mySummary(state.me.effective)}</p>
        {!state.me.isOwner && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('nova:role-onboarding', { detail: { projectId: bookId } }))}
            className="mt-2 text-[11px] font-bold text-amber-300 hover:underline"
            data-access-onboarding
          >
            {L('Моя роль / запросити доступ…', 'My role / request access…')}
          </button>
        )}
        {!state.me.isOwner && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('nova:open-tab', { detail: { tab: 'my-space' } }))}
            className="mt-2 ml-3 text-[11px] font-bold text-violet-300 hover:underline"
            data-access-my-space
          >
            {L('Мій простір →', 'My space →')}
          </button>
        )}
      </div>

      {!state.canManage ? (
        <p className="text-[11px] text-slate-500">
          {L('Доступ надає власник книги, адміністратор або учасник із правом керування. Роль у проєкті сама нічого не відкриває.', 'Access is granted by the book owner, an administrator or a participant with the manage right. A project role alone opens nothing.')}
        </p>
      ) : (
        <>
          {/* Т6.3: запити доступу з опитувальника ролі — схвалити / змінити / відхилити. */}
          <AccessRequestsSection bookId={bookId} lang={lang} characters={targets?.characters ?? []} onChanged={() => void load()} />
          <form onSubmit={submit} className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2" data-access-form>
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <ShieldPlus className="w-3.5 h-3.5 text-amber-400" /> {L('Надати доступ', 'Grant access')}
            </div>
            {people.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                {L('Учасників ще немає: запросіть людину на вкладці «Cowork» — після прийняття вона з’явиться тут.', 'No participants yet: invite someone on the “Cowork” tab — once they accept, they appear here.')}
              </p>
            ) : (
              <>
                <label className="block text-[10px] text-slate-400">
                  {L('Кому', 'To whom')}
                  <select className={selectCls} value={userId} onChange={(e) => setUserId(e.target.value)} data-access-user>
                    {people.map((p) => (
                      <option key={p.participant.id} value={p.participant.userId}>
                        {(p.user?.name || p.user?.email || p.participant.userId) + (p.roles.length ? ` — ${p.roles.map((r) => r.label?.[lang] ?? r.roleId).join(', ')}` : '')}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[10px] text-slate-400 min-w-0">
                    {L('Область', 'Scope')}
                    <select className={selectCls} value={scope} onChange={(e) => setScope(e.target.value as Scope)} data-access-scope>
                      {(Object.keys(SCOPES) as Scope[]).map((s) => (
                        <option key={s} value={s}>{SCOPES[s][lang]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[10px] text-slate-400 min-w-0">
                    {L('Рівень', 'Level')}
                    <select className={selectCls} value={level} onChange={(e) => setLevel(e.target.value as Level)} data-access-level>
                      {levelOptions.map((l) => (
                        <option key={l} value={l}>{LEVELS[l][lang]}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {needsTarget && (
                  <label className="block text-[10px] text-slate-400">
                    {SCOPES[scope][lang]}
                    <select className={selectCls} value={target} onChange={(e) => setTarget(e.target.value)} data-access-target>
                      <option value="">{L('— оберіть —', '— choose —')}</option>
                      {scope === 'chapter' && targets?.chapters.map((c) => <option key={c.id} value={c.id}>{c.title || c.id}</option>)}
                      {scope === 'scene' && targets?.chapters.map((c) => (
                        <optgroup key={c.id} label={c.title || c.id}>
                          {c.sections.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
                        </optgroup>
                      ))}
                      {scope === 'character' && targets?.characters.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      {scope === 'location' && targets?.locations.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    {(scope === 'chapter' || scope === 'scene') && !targets?.chapters.length && (
                      <span className="block mt-1 text-amber-400">{L('Серверної копії книги ще немає — збережіть книгу на сервері.', 'No server copy of the book yet — save the book to the server.')}</span>
                    )}
                    {(scope === 'character' || scope === 'location') && !(scope === 'character' ? targets?.characters : targets?.locations)?.length && (
                      <span className="block mt-1 text-amber-400">{L('У ядрі ще немає таких сутностей — збережіть книгу, щоб вона синхронізувалась.', 'No such entities in the core yet — save the book so it syncs.')}</span>
                    )}
                  </label>
                )}
                <label className="block text-[10px] text-slate-400">
                  {L('Діє до (необов’язково)', 'Valid until (optional)')}
                  <input type="date" className={selectCls} value={until} onChange={(e) => setUntil(e.target.value)} data-access-until />
                </label>
                <button
                  type="submit"
                  disabled={busy || !userId || (needsTarget && !target)}
                  className="w-full py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 disabled:opacity-40 flex items-center justify-center gap-2"
                  data-access-grant
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldPlus className="w-3.5 h-3.5" />}
                  {L('Надати', 'Grant')}
                </button>
              </>
            )}
            {notice && (
              <p className={`text-[11px] ${notice.kind === 'success' ? 'text-emerald-300' : 'text-rose-300'}`} data-access-notice={notice.kind}>
                {notice.text}
              </p>
            )}
          </form>

          <div className="space-y-2" data-access-participants>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">{L('Учасники й доступ', 'Participants and access')}</span>
              <label className="flex items-center gap-1 text-[10px] text-slate-500">
                <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />
                {L('відкликані', 'revoked')}
              </label>
            </div>
            {people.map((p) => {
              const shown = p.grants.filter((g) => showRevoked || g.status === 'active');
              return (
                <div key={p.participant.id} className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800" data-access-person={p.participant.userId}>
                  <div className="text-xs font-bold text-white truncate">{p.user?.name || p.user?.email || p.participant.userId}</div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {p.roles.map((r) => r.label?.[lang] ?? r.roleId).join(', ') || L('без ролі', 'no role')}
                    {p.user?.email && p.user?.name ? ` · ${p.user.email}` : ''}
                  </div>
                  {shown.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-slate-500">{L('Доступу не надано — книги не бачить.', 'No access granted — cannot see the book.')}</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {shown.map((g) => (
                        <li key={g.id} className="flex items-start justify-between gap-2" data-access-grant-row={g.id} data-access-grant-status={g.status}>
                          <div className={`min-w-0 text-[11px] ${g.status === 'active' ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
                            <span className="break-words">{describeGrant(g)}</span>
                            <span className="block text-[10px] text-slate-500">
                              {g.source === 'legacy_invite' ? L('з прийнятого запрошення', 'from an accepted invitation') : g.source === 'admin' ? L('надав адміністратор', 'granted by an administrator') : L('надано вручну', 'granted manually')}
                              {g.validUntil ? L(` · до ${fmtDate(g.validUntil)}`, ` · until ${fmtDate(g.validUntil)}`) : ''}
                              {g.status === 'revoked' && g.revokedAt ? L(` · відкликано ${fmtDate(g.revokedAt)}`, ` · revoked ${fmtDate(g.revokedAt)}`) : ''}
                            </span>
                          </div>
                          {g.status === 'active' && (g.level !== 'manage' || privileged) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void revoke(g)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 shrink-0"
                              title={L('Відкликати', 'Revoke')}
                              data-access-revoke={g.id}
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => (events ? setEvents(null) : void loadEvents())}
              className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center justify-center gap-2"
              data-access-events-btn
            >
              <History className="w-3.5 h-3.5" /> {events ? L('Сховати журнал', 'Hide log') : L('Журнал доступу', 'Access log')}
            </button>
            {events && (
              <ul className="space-y-1" data-access-events>
                {events.length === 0 && <li className="text-[11px] text-slate-500">{L('Записів ще немає.', 'No entries yet.')}</li>}
                {events.map((ev) => {
                  const who = ev.actor.startsWith('user:') ? personName(ev.actor.slice(5)) : ev.actor === 'system:access-migration' ? L('система (перенесене запрошення)', 'system (migrated invitation)') : ev.actor;
                  return (
                    <li key={ev.id} className="text-[11px] text-slate-300 p-2 rounded-xl bg-slate-950/70 border border-slate-800" data-access-event={ev.action}>
                      <span className={ev.action === 'access_granted' ? 'text-emerald-300' : 'text-rose-300'}>
                        {ev.action === 'access_granted' ? L('Надано', 'Granted') : L('Відкликано', 'Revoked')}
                      </span>{' '}
                      {describeGrant({ level: ev.details?.level, scopeType: ev.details?.scopeType, scopeRef: ev.details?.scopeRef ?? null })}
                      {ev.details?.userId ? ` → ${personName(ev.details.userId)}` : ''}
                      <span className="block text-[10px] text-slate-500">{who} · {new Date(ev.createdAt).toLocaleString(lang === 'en' ? 'en-US' : 'uk-UA')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};
