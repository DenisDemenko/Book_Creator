/**
 * «Мій простір» — стартова сторінка проєкту за роллю (Т6.4 В3,
 * `PLAN_ROLE_STUDIO.md`; ТЗ Role Onboarding §15, §21–23).
 *
 *   • простір ролі: розділи Студії (і те, що з'явиться пізніше — Т7),
 *     перемикач, якщо ролей кілька;
 *   • процес ШІ: який процес налаштує модель, запропоновані дії, фокус Jev;
 *   • мій доступ (Т6.2) — роль доступу не дає;
 *   • «Моя роль у проєкті»: додати / запросити роль, змінити спеціалізацію,
 *     відмовитися, вийти з проєкту; нерозглянуті запити.
 * Інтерфейс — не механізм безпеки: усе перевіряє сервер.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Compass, LayoutGrid, Loader2, LogOut, Plus, Route, ShieldCheck, Sparkles, Target, UserCog, X } from 'lucide-react';
import type { NavigationTab } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { onb } from '../onboarding/onboardingApi';
import { ROLE_WORKSPACES, workspaceById, workspaceTabs } from '../../utils/roleWorkspaces';
import { summarizeAccess, type AccessSummaryInput } from '../../utils/accessSummary';
import { useAiRoute } from './AiWorkflowHint';
import {
  addMyRole,
  announceRoleSpaceChanged,
  cancelRequest,
  changeMySpecialization,
  fetchMyRole,
  leaveMyProject,
  removeMyRole,
  setMyWorkspace,
  type MyRoleView,
  ROLE_SPACE_EVENT,
} from './roleStudioApi';

type Lang = 'uk' | 'en';

interface RegistryRole {
  id: string;
  label: { en: string; uk: string };
  category: string;
  projectTypes: string[];
  workspace: string;
  suggestedCapabilities: string[];
  requiresSpecialization: boolean;
  specializations: string[];
  deprecated: boolean;
}

const card = 'rounded-2xl border border-white/[0.07] bg-slate-950/70 p-4';
const sel = 'min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white';

export const MySpaceView: React.FC<{
  projectId: string;
  bookTitle: string;
  role: string;
  lang: Lang;
  onNavigate: (tab: NavigationTab) => void;
}> = ({ projectId, bookTitle, role, lang, onNavigate }) => {
  const { t } = useLanguage();
  const L = (uk: string, en: string) => (lang === 'en' ? en : uk);
  const [view, setView] = useState<MyRoleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registry, setRegistry] = useState<RegistryRole[]>([]);
  const [access, setAccess] = useState<AccessSummaryInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addId, setAddId] = useState('');
  const [addSpec, setAddSpec] = useState('');
  const [addAccess, setAddAccess] = useState(false);
  const [addMessage, setAddMessage] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [left, setLeft] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await fetchMyRole(projectId);
      setView(v);
      setError(null);
      onb<{ me: { effective: AccessSummaryInput } }>('GET', `/api/core/projects/${encodeURIComponent(projectId)}/access`)
        .then((r) => setAccess(r.me.effective))
        .catch(() => setAccess(null));
    } catch (e) {
      setView(null);
      setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
    onb<{ roles: RegistryRole[] }>('GET', '/api/collaboration/roles')
      .then((r) => setRegistry(r.roles))
      .catch(() => {});
  }, [load]);
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!id || id === projectId) void load();
    };
    window.addEventListener(ROLE_SPACE_EVENT, on);
    return () => window.removeEventListener(ROLE_SPACE_EVENT, on);
  }, [load, projectId]);

  const route = useAiRoute(view ? projectId : null, 'chat');
  const ws = workspaceById(view?.activeWorkspace);
  const tabs = useMemo(() => workspaceTabs(view?.activeWorkspace, role), [view?.activeWorkspace, role]);
  const labelOf = (id: string | null | undefined) => (id ? registry.find((r) => r.id === id)?.label[lang] ?? id : '');
  const mineIds = new Set(view?.roles.map((r) => r.roleId) ?? []);
  const addable = registry.filter((r) => !r.deprecated && r.id !== 'project_owner' && r.projectTypes.includes(view?.projectType ?? 'book') && (r.requiresSpecialization || !mineIds.has(r.id)));
  const addRole = registry.find((r) => r.id === addId);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      announceRoleSpaceChanged(projectId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addRole) return;
    void run(async () => {
      const out = await addMyRole(projectId, {
        roleId: addRole.id,
        specialization: addRole.requiresSpecialization ? addSpec || null : null,
        ...(addAccess && !view?.selfAssign ? { scope: 'whole_project', capabilities: addRole.suggestedCapabilities.filter((c) => c !== 'manage' && c !== 'publish') } : {}),
        message: addMessage,
      });
      setView(out.view);
      setAddId('');
      setAddSpec('');
      setAddMessage('');
      setAddAccess(false);
      return out.kind === 'assigned'
        ? L('Роль додано.', 'Role added.')
        : L('Запит ролі надіслано власнику — роль з’явиться після схвалення. Ваш доступ не змінився.', 'Role request sent to the owner — the role appears once approved. Your access has not changed.');
    });
  };

  if (left) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" data-my-space="left">
        <div className={card}>
          <p className="text-sm text-slate-200">{L('Ви вийшли з проєкту. Ролі й наданий доступ відкликано.', 'You left the project. Your roles and granted access were revoked.')}</p>
        </div>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" data-my-space={error ? 'unavailable' : 'loading'}>
        {!error ? (
          <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className={`${card} space-y-2`}>
            <h1 className="text-lg font-bold text-white">{t('header.nav.my-space')}</h1>
            <p className="text-xs text-slate-400">
              {L('Простір ролі з’являється, коли проєкт є на сервері, а у вас є роль чи доступ у ньому.', 'The role workspace appears once the project is on the server and you have a role or access in it.')} <span className="text-slate-500">({error})</span>
            </p>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nova:role-onboarding', { detail: { projectId } }))} className="text-xs font-bold text-amber-300 hover:underline" data-my-space-onboarding>
              {L('Визначити роль у проєкті…', 'Define my role in the project…')}
            </button>
          </div>
        )}
      </div>
    );
  }

  const pendingRole = view.pending.role;
  const otherWorkspaces = view.isOwner || view.isAdmin ? ROLE_WORKSPACES.map((w) => w.id) : view.workspaces;

  return (
    <div className="flex-1 overflow-y-auto p-3 sm:p-6" data-my-space={view.activeWorkspace ?? 'none'}>
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Заголовок і перемикач простору */}
        <div className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-300">{t('header.nav.my-space')}</p>
              <h1 className="truncate text-xl font-black text-white" data-my-space-title>{ws?.name[lang] ?? L('Простір', 'Workspace')}</h1>
              <p className="mt-0.5 text-xs text-slate-400">{bookTitle} · {ws?.about[lang]}</p>
            </div>
            {otherWorkspaces.length > 1 && (
              <div className="flex flex-wrap gap-1.5" data-my-space-switch>
                {otherWorkspaces.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      setView(await setMyWorkspace(projectId, id));
                      return null;
                    })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${id === view.activeWorkspace ? 'border-violet-400 bg-violet-500/20 text-violet-100' : view.workspaces.includes(id) ? 'border-slate-600 text-slate-300 hover:border-violet-400/60' : 'border-slate-800 text-slate-500 hover:border-slate-600'}`}
                    data-my-space-ws={id}
                  >
                    {workspaceById(id)?.name[lang] ?? id}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500">{L('Простір лише впорядковує розділи — що відкрито, визначає ваш доступ.', 'The workspace only arranges sections — what is open is decided by your access.')}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            {/* Розділи простору */}
            <section className={`${card} space-y-3`} data-my-space-sections>
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><LayoutGrid className="h-4 w-4 text-violet-300" /> {L('Розділи простору', 'Workspace sections')}</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {tabs.map((tab, i) => (
                  <button key={tab} type="button" onClick={() => onNavigate(tab)} className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition hover:border-violet-400/60 ${i === 0 ? 'border-violet-400/50 bg-violet-500/10 text-white' : 'border-slate-800 bg-slate-900/60 text-slate-200'}`} data-my-space-tab={tab}>
                    {t(`header.nav.${tab}`)}
                    {i === 0 && <span className="ml-1.5 text-[10px] font-normal text-violet-300">{L('головне', 'main')}</span>}
                  </button>
                ))}
                {ws?.later.map((x) => (
                  <div key={x.uk} className="rounded-xl border border-dashed border-slate-800 px-3 py-2.5 text-xs text-slate-500" data-my-space-later>
                    {x[lang]} <span className="text-[10px]">· {L('з’явиться пізніше', 'coming later')}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Процес ШІ */}
            <section className={`${card} space-y-2`} data-my-space-ai={route?.workflow ?? 'none'}>
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Route className="h-4 w-4 text-violet-300" /> {L('Процес ШІ', 'AI workflow')}</h2>
              {!route ? (
                <p className="text-xs text-slate-500">{L('Процес ШІ з’явиться разом із роллю в проєкті.', 'The AI workflow appears with a role in the project.')}</p>
              ) : (
                <>
                  <p className="text-xs text-slate-200"><span className="font-bold text-violet-200">{route.workflowName[lang]}</span> — {L('асистент і всі модулі ШІ налаштовані під вашу роль.', 'the assistant and all AI modules are tuned to your role.')}</p>
                  {route.scope === 'partial' && <p className="text-[11px] text-amber-200/80">{L('Ви бачите частину проєкту — ШІ працює лише з нею.', 'You see part of the project — AI works only with that part.')}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {route.suggestions.map((s) => (
                      <button key={s.id} type="button" onClick={() => onNavigate(s.tab as NavigationTab)} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-200 hover:border-violet-400/60" data-my-space-suggestion={s.id}>
                        <Sparkles className="h-3 w-3 text-violet-300" /> {s.label[lang]}
                      </button>
                    ))}
                  </div>
                  {route.focus.length > 0 && (
                    <div className="space-y-1 pt-1" data-my-space-focus>
                      <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Target className="h-3 w-3" /> {L('Фокус простору (підказка Jev)', 'Workspace focus (Jev hint)')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {route.focus.map((f) => (
                          <button key={f.id} type="button" onClick={() => onNavigate(f.tab as NavigationTab)} className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-violet-400/60" data-my-space-focus-item={f.id}>{f.label[lang]}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500">{L('Процес налаштовує модель і ніколи не розширює ваш доступ.', 'The workflow tunes the model and never widens your access.')}</p>
                </>
              )}
            </section>
          </div>

          <div className="space-y-4">
            {/* Мій доступ */}
            <section className={`${card} space-y-1.5`} data-my-space-access>
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck className="h-4 w-4 text-emerald-300" /> {L('Мій доступ', 'My access')}</h2>
              <p className="text-xs text-slate-300">{access ? summarizeAccess(access, lang) : '…'}</p>
              <p className="text-[10px] text-slate-500">{L('Роль сама доступу не дає — його надає власник, адмін чи керівник.', 'A role alone grants no access — the owner, an admin or a manager grants it.')}</p>
            </section>

            {/* Моя роль у проєкті */}
            <section className={`${card} space-y-2.5`} data-my-role>
              <h2 className="flex items-center gap-2 text-sm font-bold text-white"><UserCog className="h-4 w-4 text-amber-300" /> {L('Моя роль у проєкті', 'My role in the project')}</h2>
              <ul className="space-y-1.5">
                {view.roles.map((r) => (
                  <li key={r.assignmentId} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-2.5 py-1.5" data-my-role-item={r.roleId}>
                    <span className="flex-1 text-xs font-semibold text-slate-100">
                      {r.label?.[lang] ?? r.roleId}
                      {r.specialization && <span className="font-normal text-slate-400"> · {labelOf(r.specialization)}</span>}
                    </span>
                    {r.requiresSpecialization && (
                      <select
                        value=""
                        disabled={busy || !!pendingRole}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) return;
                          void run(async () => {
                            const out = await changeMySpecialization(projectId, r.assignmentId, v);
                            setView(out.view);
                            return out.kind === 'assigned' ? L('Спеціалізацію змінено.', 'Specialization changed.') : L('Запит на зміну спеціалізації надіслано власнику.', 'Specialization change request sent to the owner.');
                          });
                        }}
                        className={sel}
                        data-my-role-spec={r.assignmentId}
                      >
                        <option value="">{L('Змінити спеціалізацію…', 'Change specialization…')}</option>
                        {r.specializations.filter((x) => x !== r.specialization).map((x) => <option key={x} value={x}>{labelOf(x)}</option>)}
                      </select>
                    )}
                    {r.roleId !== 'project_owner' && view.roles.length > 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        title={L('Відмовитися від ролі (доступ лишиться)', 'Give up the role (access stays)')}
                        onClick={() => void run(async () => {
                          setView(await removeMyRole(projectId, r.assignmentId));
                          return view.isOwner ? L('Роль знято.', 'Role removed.') : L('Роль знято. Доступ лишився — керівників сповіщено.', 'Role removed. Access stays — managers were notified.');
                        })}
                        className="rounded-lg border border-rose-500/40 p-1 text-rose-300 hover:bg-rose-500/10"
                        data-my-role-remove={r.roleId}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
                {!view.roles.length && <li className="text-xs text-slate-500">{L('Ролі ще немає.', 'No role yet.')}</li>}
              </ul>

              {pendingRole && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-100" data-my-role-pending={pendingRole.id}>
                  <Clock className="h-3.5 w-3.5" />
                  <span className="flex-1">
                    {L('Чекає рішення власника:', 'Awaiting the owner:')} {pendingRole.roles.map((x) => `${labelOf(x.roleId)}${x.specialization ? ` (${labelOf(x.specialization)})` : ''}`).join(', ')}
                  </span>
                  <button type="button" disabled={busy} onClick={() => void run(async () => { await cancelRequest(projectId, pendingRole.id); await load(); return L('Запит відкликано.', 'Request withdrawn.'); })} className="font-bold hover:underline" data-my-role-cancel>
                    {L('Відкликати', 'Withdraw')}
                  </button>
                </div>
              )}

              {!pendingRole && (
                <form onSubmit={submitAdd} className="space-y-1.5 border-t border-slate-800 pt-2" data-my-role-add>
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"><Plus className="h-3 w-3" /> {view.selfAssign ? L('Додати роль', 'Add a role') : L('Запросити нову роль', 'Request a new role')}</p>
                  <select value={addId} onChange={(e) => { setAddId(e.target.value); setAddSpec(''); }} className={`${sel} w-full`} data-my-role-add-role>
                    <option value="">{L('Оберіть роль…', 'Choose a role…')}</option>
                    {addable.map((r) => <option key={r.id} value={r.id}>{r.label[lang]}</option>)}
                  </select>
                  {addRole?.requiresSpecialization && (
                    <select value={addSpec} onChange={(e) => setAddSpec(e.target.value)} className={`${sel} w-full`} data-my-role-add-spec>
                      <option value="">{L('Спеціалізація…', 'Specialization…')}</option>
                      {addRole.specializations.map((x) => <option key={x} value={x}>{labelOf(x)}</option>)}
                    </select>
                  )}
                  {addRole && !view.selfAssign && (
                    <>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                        <input type="checkbox" checked={addAccess} onChange={(e) => setAddAccess(e.target.checked)} data-my-role-add-access /> {L('також попросити доступ на всю книгу за шаблоном ролі', 'also ask for access to the whole book per the role template')}
                      </label>
                      <input value={addMessage} onChange={(e) => setAddMessage(e.target.value)} placeholder={L('Повідомлення власнику (необовʼязково)', 'Message to the owner (optional)')} className={`${sel} w-full`} data-my-role-add-message />
                    </>
                  )}
                  <button type="submit" disabled={busy || !addRole || (addRole.requiresSpecialization && !addSpec)} className="rounded-lg border border-amber-400/60 px-2.5 py-1 text-[11px] font-bold text-amber-200 disabled:opacity-40" data-my-role-add-submit>
                    {view.selfAssign ? L('Додати', 'Add') : L('Надіслати запит', 'Send request')}
                  </button>
                  {!view.selfAssign && <p className="text-[10px] text-slate-500">{L('У чужому проєкті нова роль з’являється після схвалення й не дає нових прав сама.', 'In someone else’s project a new role appears after approval and grants no new rights by itself.')}</p>}
                </form>
              )}

              {notice && <p className="text-[11px] text-emerald-300" data-my-role-notice>{notice}</p>}
              {actionError && <p className="text-[11px] text-rose-300" data-my-role-error>{actionError}</p>}

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-2">
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('nova:role-onboarding', { detail: { projectId } }))} className="flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:underline" data-my-role-wizard>
                  <Compass className="h-3 w-3" /> {L('Пройти «Визначення ролі»', 'Run “Define my role”')}
                </button>
                {!view.isOwner && view.participant?.status === 'active' && (
                  leaving ? (
                    <span className="flex items-center gap-2 text-[11px] text-rose-200">
                      {L('Ролі й доступ буде відкликано.', 'Roles and access will be revoked.')}
                      <button type="button" disabled={busy} onClick={() => void run(async () => { await leaveMyProject(projectId); setLeft(true); return null; })} className="font-bold hover:underline" data-my-role-leave-confirm>{L('Вийти', 'Leave')}</button>
                      <button type="button" onClick={() => setLeaving(false)} className="text-slate-400 hover:underline">{L('Скасувати', 'Cancel')}</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setLeaving(true)} className="flex items-center gap-1 text-[11px] font-semibold text-rose-300 hover:underline" data-my-role-leave>
                      <LogOut className="h-3 w-3" /> {L('Вийти з проєкту', 'Leave the project')}
                    </button>
                  )
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MySpaceView;
