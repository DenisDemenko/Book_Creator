/**
 * Майстер «Визначення ролі» (Role Onboarding, Т6.3 В3, `PLAN_ROLE_ONBOARDING.md`;
 * ТЗ Role Onboarding v3.1 §5–12, §24–27).
 *
 * Компактний повноекранний майстер: індикатор кроків, тип проєкту, мета
 * входу, ролі (множинний вибір, пошук, «Інша роль», спеціалізація
 * фрілансера), параметри ролі, область і можливості (лише для чужого
 * проєкту), допомога ШІ, підсумок. Кожен крок зберігається на сервері
 * (§25) — «Назад» нічого не губить, закриття — продовжити пізніше.
 * Усе, що показується, — з реєстру ролей; технічних id дозволів людина не
 * бачить (§26). Права перевіряє сервер (§15).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ClipboardList, Loader2, Search, Send, Sparkles, X } from 'lucide-react';
import {
  AI_ASSIST_SETS,
  FIRST_SCREEN_ROLES,
  ONBOARDING_STEPS,
  ROLE_DETAIL_SETS,
  aiGroupsFor,
  detailGroupsFor,
  requestedAccess,
  scopeAvailable,
  suggestedCapabilities,
  validateAnswers,
  type AnswerIssue,
  type OnboardingAnswers,
} from '../../utils/roleOnboarding';
import { onb, OnbError, toRegistry, type ClientRegistry, type OnboardingSession, type RolesResponse } from './onboardingApi';

type Lang = 'uk' | 'en';

export interface WizardResult {
  completed: boolean;
  outcome?: { kind: string; [k: string]: any };
  /** Що зробити після першого входу: створити книгу чи курс. */
  next?: 'create_book' | 'create_course' | null;
}

interface Props {
  lang: Lang;
  source: string;
  projectId?: string | null;
  projectType?: string | null;
  orderId?: string | null;
  projectTitle?: string | null;
  /** Запит доступу до цього проєкту вже чекає рішення — лише повідомити. */
  pending?: boolean;
  onClose: (result: WizardResult) => void;
}

const T = {
  title: { uk: 'Визначення ролі', en: 'Role onboarding' },
  subtitle: { uk: 'Кілька питань, щоб Студія знала, хто ви в цьому проєкті. Роль не дає доступу сама — доступ дає власник.', en: 'A few questions so the Studio knows who you are in this project. A role grants no access by itself — the owner does.' },
  q1: { uk: 'Над чим ви будете працювати?', en: 'What are you going to work on?' },
  q2: { uk: 'Як ви долучаєтесь до цього проєкту?', en: 'How are you joining this project?' },
  q3: { uk: 'Як ви будете працювати над цим проєктом?', en: 'How will you work on this project?' },
  q4: { uk: 'Що саме ви робитимете?', en: 'What exactly will you do?' },
  q5: { uk: 'Область роботи', en: 'Work scope' },
  q6: { uk: 'Які можливості вам потрібні?', en: 'Which capabilities do you need?' },
  q7: { uk: 'Чим допомагати ШІ? (необовʼязково)', en: 'How should AI help? (optional)' },
  q8: { uk: 'Підсумок', en: 'Summary' },
  next: { uk: 'Продовжити', en: 'Continue' },
  back: { uk: 'Назад', en: 'Back' },
  edit: { uk: 'Змінити', en: 'Edit' },
  later: { uk: 'Пізніше', en: 'Later' },
  skip: { uk: 'Пропустити', en: 'Skip' },
  toStudio: { uk: 'Перейти до Студії', en: 'Continue to Studio' },
  request: { uk: 'Запросити доступ', en: 'Request access' },
  search: { uk: 'Пошук ролі…', en: 'Search for a role…' },
  allRoles: { uk: 'Усі ролі', en: 'All roles' },
  otherRole: { uk: 'Інша роль (опишіть)', en: 'Other role (describe)' },
  specialization: { uk: 'Спеціалізація', en: 'Specialization' },
  chooseSpec: { uk: 'оберіть спеціалізацію…', en: 'choose a specialization…' },
  noDetails: { uk: 'Для обраних ролей додаткових параметрів немає.', en: 'No extra details for the chosen roles.' },
  noAi: { uk: 'Для обраних ролей окремих налаштувань ШІ немає.', en: 'No AI settings for the chosen roles.' },
  ownScope: { uk: 'Це ваш проєкт: ви працюєте з усім проєктом, доступ — повний.', en: 'This is your project: you work with the whole project, with full access.' },
  invitedScope: { uk: 'Доступ визначає запрошення — окремий запит не потрібен.', en: 'Your invitation defines access — no separate request is needed.' },
  laterScope: { uk: 'з’явиться пізніше', en: 'coming later' },
  refsHint: { uk: 'Що саме (розділи, сцени, персонажів) ви назвете в повідомленні — власник обере їх, коли вирішуватиме.', en: 'Name the exact chapters, scenes or characters in your message — the owner will pick them when deciding.' },
  message: { uk: 'Повідомлення власнику (необовʼязково)', en: 'Message to the owner (optional)' },
  capsHint: { uk: 'Запропоновано за вашою роллю. Це запит — вирішує власник.', en: 'Suggested from your role. This is a request — the owner decides.' },
  aiNote: { uk: 'Налаштовує допомогу ШІ й ніколи не розширює ваш доступ.', en: 'Tunes AI assistance and never expands your access.' },
  sumProject: { uk: 'Проєкт', en: 'Project' },
  sumType: { uk: 'Тип проєкту', en: 'Project type' },
  sumRoles: { uk: 'Ваші ролі', en: 'Your roles' },
  sumScope: { uk: 'Область роботи', en: 'Work scope' },
  sumAccess: { uk: 'Доступ', en: 'Access' },
  sumAi: { uk: 'Допомога ШІ', en: 'AI assistance' },
  accOwn: { uk: 'Повний — це ваш проєкт', en: 'Full — this is your project' },
  accNone: { uk: 'Без проєкту — збережемо як ваші налаштування', en: 'No project — saved as your preferences' },
  accInvite: { uk: 'За запрошенням', en: 'By invitation' },
  accRequest: { uk: 'Запит: {level} — вирішує власник', en: 'Request: {level} — the owner decides' },
  none: { uk: '—', en: '—' },
  sentTitle: { uk: 'Запит надіслано', en: 'Request sent' },
  sentText: { uk: 'Власник проєкту отримав ваш запит. Доступ з’явиться, щойно його схвалять; ваші ролі вже записано.', en: 'The project owner has your request. Access appears as soon as it is approved; your roles are already recorded.' },
  pendingTitle: { uk: 'Запит чекає рішення', en: 'Request pending' },
  doneTitle: { uk: 'Готово', en: 'Done' },
  doneText: { uk: 'Ролі збережено.', en: 'Roles saved.' },
  createBook: { uk: 'Створити книгу', en: 'Create a book' },
  createCourse: { uk: 'Створити курс', en: 'Create a course' },
  close: { uk: 'Закрити', en: 'Close' },
  stepOf: { uk: 'Крок {n} з {m}', en: 'Step {n} of {m}' },
  orderCtx: { uk: 'Замовлення', en: 'Order' },
};
const tr = (lang: Lang, k: keyof typeof T, vars?: Record<string, string>) => {
  let s = T[k][lang];
  for (const [a, b] of Object.entries(vars ?? {})) s = s.replace(`{${a}}`, b);
  return s;
};

const LEVEL_NAME: Record<string, { uk: string; en: string }> = {
  view: { uk: 'перегляд', en: 'view' },
  comment: { uk: 'коментування', en: 'comment' },
  review: { uk: 'перевірка', en: 'review' },
  edit: { uk: 'редагування', en: 'edit' },
  create: { uk: 'створення', en: 'create' },
  approve: { uk: 'схвалення', en: 'approve' },
  work: { uk: 'робота з файлами', en: 'work with files' },
};

const ROLE_ICON: Record<string, string> = { author: '✍', co_author: '👥', designer: '🎨', illustrator: '🖼', editor: '✎', translator: '🌐', sales_manager: '📈', developer: '💻', freelancer: '🧰' };

export const RoleOnboardingWizard: React.FC<Props> = ({ lang, source, projectId = null, projectType = null, orderId = null, projectTitle = null, pending = false, onClose }) => {
  const [reg, setReg] = useState<ClientRegistry | null>(null);
  const [session, setSession] = useState<OnboardingSession | null>(null);
  const [joining, setJoining] = useState(false);
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [step, setStep] = useState(1);
  const [issues, setIssues] = useState<AnswerIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WizardResult['outcome'] | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (pending) return;
    let alive = true;
    (async () => {
      try {
        const [roles, started] = await Promise.all([
          onb<RolesResponse>('GET', '/api/collaboration/roles'),
          onb<{ session: OnboardingSession; joining: boolean }>('POST', '/api/core/onboarding/sessions', { source, projectId, projectType, orderId }),
        ]);
        if (!alive) return;
        setReg(toRegistry(roles));
        setSession(started.session);
        setJoining(started.joining);
        setAnswers(started.session.answers as OnboardingAnswers);
        setStep(Math.max(1, Math.min(8, started.session.currentStep)));
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, projectId, projectType, orderId, pending]);

  const pt = answers.projectType ?? session?.projectType ?? undefined;
  const fixedType = !!session?.projectType && !!session.projectId;
  const invited = session?.source === 'invitation';
  const visible = useMemo<number[]>(() => ONBOARDING_STEPS.map((s) => s.id as number).filter((id) => joining || (id !== 5 && id !== 6)), [joining]);
  const roles = answers.roles ?? [];
  const label = (n: { uk: string; en: string } | null | undefined) => (n ? n[lang] || n.uk : '');
  const roleById = (id: string) => reg?.raw.roles.find((r) => r.id === id);

  const set = (patch: Partial<OnboardingAnswers>) => setAnswers((a) => ({ ...a, ...patch }));

  /** Перед кроком 6 — шаблон можливостей за ролями (§19), якщо людина ще нічого не обрала. */
  const prepare = (target: number) => {
    if (!reg) return;
    if (target === 6 && !(answers.capabilities ?? []).length) set({ capabilities: suggestedCapabilities(reg.def, roles) });
  };

  const save = useCallback(async (fromStep: number): Promise<boolean> => {
    if (!session) return false;
    setBusy(true);
    setError(null);
    try {
      const r = await onb<{ session: OnboardingSession; issues: AnswerIssue[] }>('PUT', `/api/core/onboarding/sessions/${session.id}/steps/${fromStep}`, { answers, expectedRevision: session.revision });
      setSession(r.session);
      setIssues(r.issues);
      return r.issues.length === 0;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [session, answers]);

  const goNext = async () => {
    // Спершу — та сама перевірка, що й на сервері, без зайвого запиту.
    if (reg) {
      const local = validateAnswers(reg.def, answers, { upTo: step, joining, projectType: pt }).filter((i) => i.step === step);
      if (local.length) {
        setIssues(local);
        return;
      }
    }
    if (!(await save(step))) return;
    const i = visible.indexOf(step);
    const target = visible[Math.min(visible.length - 1, i + 1)];
    prepare(target);
    setStep(target);
  };
  const goBack = () => {
    const i = visible.indexOf(step);
    if (i > 0) setStep(visible[i - 1]);
  };

  const complete = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await save(8))) return;
      const r = await onb<{ outcome: WizardResult['outcome'] }>('POST', `/api/core/onboarding/sessions/${session.id}/complete`, {});
      setOutcome(r.outcome);
      if (r.outcome?.kind === 'own' || r.outcome?.kind === 'invitation' || r.outcome?.kind === 'has_access') onClose({ completed: true, outcome: r.outcome });
    } catch (e) {
      if (e instanceof OnbError && e.issues?.length) {
        setIssues(e.issues);
        const first = Math.min(...e.issues.map((x: AnswerIssue) => x.step));
        if (visible.includes(first)) setStep(first);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const later = async () => {
    // Чернетка лишається — продовжити можна пізніше (§25). Перший вхід — «пропустити» = скасувати.
    if (session && source === 'first_login' && step === 1 && !Object.keys(answers).length) {
      await onb('POST', `/api/core/onboarding/sessions/${session.id}/cancel`).catch(() => {});
    }
    onClose({ completed: false });
  };

  const issueFor = (field: string) => issues.filter((i) => i.field === field);
  const IssueList = ({ field }: { field: string }) => (
    <>
      {issueFor(field).map((i, k) => (
        <p key={k} className="text-xs text-rose-300" data-onb-issue={i.code}>{i.message[lang]}</p>
      ))}
    </>
  );

  const Option = ({ id, name, on, onClick, attr, disabled, hint }: { id: string; name: string; on: boolean; onClick: () => void; attr: string; disabled?: boolean; hint?: string }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${on ? 'border-amber-400 bg-amber-500/15 font-bold text-amber-50' : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-500'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      {...{ [attr]: id }}
      data-on={on ? '1' : '0'}
    >
      <span>{name}</span>
      {hint ? <span className="text-[10px] font-normal text-slate-400">{hint}</span> : on ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );

  const toggle = (list: string[] | undefined, id: string) => ((list ?? []).includes(id) ? (list ?? []).filter((x) => x !== id) : [...(list ?? []), id]);
  const toggleRole = (id: string) => {
    const has = roles.some((r) => r.roleId === id);
    set({ roles: has ? roles.filter((r) => r.roleId !== id) : [...roles, { roleId: id, specialization: null }] });
  };

  const rolesForType = (reg?.raw.roles ?? []).filter((r) => !r.deprecated && (!pt || r.projectTypes.includes(pt)) && r.id !== 'project_owner');
  const searched = query.trim() ? rolesForType.filter((r) => `${r.label.uk} ${r.label.en} ${r.id}`.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const firstScreen = FIRST_SCREEN_ROLES.map((id) => rolesForType.find((r) => r.id === id)).filter(Boolean) as RolesResponse['roles'];
  const detailGroups = reg ? detailGroupsFor(reg.def, roles) : [];
  const aiGroups = reg ? aiGroupsFor(reg.def, roles) : [];
  const want = answers.scope ? requestedAccess(answers.scope, answers.scopeRefs ?? [], answers.capabilities ?? []) : null;

  const body = () => {
    if (!reg || !session) return <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    switch (step) {
      case 1:
        return (
          <div className="space-y-2" data-onb-step="1">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q1')}</h2>
            {reg.raw.projectTypes.map((p) => (
              <Option key={p.id} id={p.id} name={label(p.name)} on={pt === p.id} attr="data-onb-type" disabled={fixedType && p.id !== session.projectType} onClick={() => set({ projectType: p.id })} />
            ))}
            <IssueList field="projectType" />
          </div>
        );
      case 2:
        return (
          <div className="space-y-2" data-onb-step="2">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q2')}</h2>
            {reg.raw.entryIntents.map((p) => (
              <Option key={p.id} id={p.id} name={label(p.name)} on={answers.entryIntent === p.id} attr="data-onb-intent" onClick={() => set({ entryIntent: p.id })} />
            ))}
            <IssueList field="entryIntent" />
          </div>
        );
      case 3:
        return (
          <div className="space-y-3" data-onb-step="3">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q3')}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {firstScreen.map((r) => (
                <Option key={r.id} id={r.id} name={`${ROLE_ICON[r.id] ?? '•'}  ${label(r.label)}`} on={roles.some((x) => x.roleId === r.id)} attr="data-onb-role" onClick={() => toggleRole(r.id)} />
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr(lang, 'search')} className="w-full rounded-xl border border-slate-700 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-amber-400" data-onb-search />
            </div>
            {(query.trim() ? searched : showAll ? rolesForType : []).length > 0 && (
              <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2" data-onb-role-list>
                {(query.trim() ? searched : rolesForType).map((r) => (
                  <Option key={r.id} id={r.id} name={label(r.label)} on={roles.some((x) => x.roleId === r.id)} attr="data-onb-role" onClick={() => toggleRole(r.id)} />
                ))}
              </div>
            )}
            {!query.trim() && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-amber-300 underline-offset-2 hover:underline" data-onb-all-roles>{tr(lang, 'allRoles')} ({rolesForType.length})</button>
            )}
            {roles.filter((x) => roleById(x.roleId)?.requiresSpecialization).map((x) => {
              const def = roleById(x.roleId)!;
              return (
                <label key={x.roleId} className="block text-xs text-slate-300">
                  {label(def.label)} — {tr(lang, 'specialization')}
                  <select value={x.specialization ?? ''} onChange={(e) => set({ roles: roles.map((r) => (r.roleId === x.roleId ? { ...r, specialization: e.target.value || null } : r)) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-100" data-onb-spec={x.roleId}>
                    <option value="">{tr(lang, 'chooseSpec')}</option>
                    {def.specializations.map((s) => <option key={s} value={s}>{label(roleById(s)?.label) || s}</option>)}
                  </select>
                </label>
              );
            })}
            <input value={answers.otherRole ?? ''} onChange={(e) => set({ otherRole: e.target.value })} placeholder={tr(lang, 'otherRole')} className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200" data-onb-other />
            <IssueList field="roles" />
          </div>
        );
      case 4:
        return (
          <div className="space-y-3" data-onb-step="4">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q4')}</h2>
            {!detailGroups.length && <p className="text-sm text-slate-400">{tr(lang, 'noDetails')}</p>}
            {detailGroups.map((g) => (
              <div key={g} className="space-y-1.5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label(ROLE_DETAIL_SETS[g].name)}</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {ROLE_DETAIL_SETS[g].options.map((o) => (
                    <Option key={o.id} id={`${g}:${o.id}`} name={label(o.name)} on={(answers.roleDetails?.[g] ?? []).includes(o.id)} attr="data-onb-detail" onClick={() => set({ roleDetails: { ...(answers.roleDetails ?? {}), [g]: toggle(answers.roleDetails?.[g], o.id) } })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      case 5:
        return (
          <div className="space-y-2" data-onb-step="5">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q5')}</h2>
            {reg.raw.scopeTypes.map((s) => {
              const ok = scopeAvailable(s.id, pt);
              return <Option key={s.id} id={s.id} name={label(s.name)} on={answers.scope === s.id} attr="data-onb-scope" disabled={!ok} hint={ok ? undefined : tr(lang, 'laterScope')} onClick={() => set({ scope: s.id })} />;
            })}
            {answers.scope && ['selected_chapters', 'selected_scenes', 'selected_characters'].includes(answers.scope) && <p className="text-xs text-slate-400">{tr(lang, 'refsHint')}</p>}
            <IssueList field="scope" />
          </div>
        );
      case 6:
        return (
          <div className="space-y-2" data-onb-step="6">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q6')}</h2>
            <p className="text-xs text-slate-400">{tr(lang, 'capsHint')}</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {reg.raw.capabilities.map((c) => (
                <Option key={c.id} id={c.id} name={label(c.name)} on={(answers.capabilities ?? []).includes(c.id)} attr="data-onb-cap" onClick={() => set({ capabilities: toggle(answers.capabilities, c.id) })} />
              ))}
            </div>
            <textarea value={answers.message ?? ''} onChange={(e) => set({ message: e.target.value })} rows={3} placeholder={tr(lang, 'message')} className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100" data-onb-message />
            <IssueList field="capabilities" />
          </div>
        );
      case 7:
        return (
          <div className="space-y-3" data-onb-step="7">
            <h2 className="text-lg font-bold text-white">{tr(lang, 'q7')}</h2>
            <p className="flex items-center gap-1.5 text-xs text-slate-400"><Sparkles className="h-3.5 w-3.5" /> {tr(lang, 'aiNote')}</p>
            {!aiGroups.length && <p className="text-sm text-slate-400">{tr(lang, 'noAi')}</p>}
            {aiGroups.map((g) => (
              <div key={g} className="grid gap-1.5 sm:grid-cols-2">
                {AI_ASSIST_SETS[g].options.map((o) => (
                  <Option key={o.id} id={o.id} name={label(o.name)} on={(answers.aiAssistance ?? []).includes(o.id)} attr="data-onb-ai" onClick={() => set({ aiAssistance: toggle(answers.aiAssistance, o.id) })} />
                ))}
              </div>
            ))}
          </div>
        );
      default: {
        const typeName = label(reg.raw.projectTypes.find((p) => p.id === pt)?.name) || tr(lang, 'none');
        const access = !session.projectId ? tr(lang, 'accNone') : invited ? tr(lang, 'accInvite') : joining ? tr(lang, 'accRequest', { level: want ? LEVEL_NAME[want.level]?.[lang] ?? want.level : '…' }) : tr(lang, 'accOwn');
        const scopeName = !session.projectId ? tr(lang, 'none') : joining ? label(reg.raw.scopeTypes.find((s) => s.id === answers.scope)?.name) || tr(lang, 'none') : invited ? tr(lang, 'invitedScope') : tr(lang, 'ownScope');
        const aiNames = (answers.aiAssistance ?? []).map((id) => label(Object.values(AI_ASSIST_SETS).flatMap((s) => s.options).find((o) => o.id === id)?.name)).filter(Boolean);
        const rows: [string, string, string][] = [
          ['project', tr(lang, 'sumProject'), projectTitle || session.projectId || tr(lang, 'none')],
          ['type', tr(lang, 'sumType'), typeName],
          ['roles', tr(lang, 'sumRoles'), roles.map((r) => [label(roleById(r.roleId)?.label), r.specialization ? `(${label(roleById(r.specialization)?.label)})` : ''].join(' ').trim()).join(', ') + (answers.otherRole ? ` · ${answers.otherRole}` : '')],
          ['scope', tr(lang, 'sumScope'), scopeName],
          ['access', tr(lang, 'sumAccess'), access],
          ['ai', tr(lang, 'sumAi'), aiNames.join(', ') || tr(lang, 'none')],
        ];
        return (
          <div className="space-y-3" data-onb-step="8">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white"><ClipboardList className="h-5 w-5" /> {tr(lang, 'q8')}</h2>
            <dl className="divide-y divide-slate-800 rounded-xl border border-slate-800">
              {rows.map(([k, a, b]) => (
                <div key={k} className="grid grid-cols-[minmax(0,9rem),1fr] gap-2 px-3 py-2 text-sm" data-onb-summary={k}>
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{a}</dt>
                  <dd className="min-w-0 break-words text-slate-100">{b}</dd>
                </div>
              ))}
              {session.sourceOrderId && (
                <div className="grid grid-cols-[minmax(0,9rem),1fr] gap-2 px-3 py-2 text-sm"><dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{tr(lang, 'orderCtx')}</dt><dd className="text-slate-100">{session.sourceOrderId}</dd></div>
              )}
            </dl>
            {issues.length > 0 && issues.map((i, k) => <p key={k} className="text-xs text-rose-300" data-onb-issue={i.code}>{i.message[lang]}</p>)}
          </div>
        );
      }
    }
  };

  if (pending) {
    return (
      <div className="ui-opacity-exempt fixed inset-0 z-[300] overflow-y-auto bg-slate-950/95 p-4" data-onb-wizard data-onb-outcome="pending">
        <div className="mx-auto mt-10 max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
          <Send className="mx-auto h-8 w-8 text-amber-300" />
          <h2 className="text-lg font-bold text-white">{tr(lang, 'pendingTitle')}</h2>
          <p className="text-sm text-slate-300">{tr(lang, 'sentText')}</p>
          <button type="button" onClick={() => onClose({ completed: false })} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950" data-onb-close>{tr(lang, 'close')}</button>
        </div>
      </div>
    );
  }

  if (outcome) {
    const pending = outcome.kind === 'access_request';
    return (
      <div className="ui-opacity-exempt fixed inset-0 z-[300] overflow-y-auto bg-slate-950/95 p-4" data-onb-wizard data-onb-outcome={outcome.kind}>
        <div className="mx-auto mt-10 max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
          {pending ? <Send className="mx-auto h-8 w-8 text-amber-300" /> : <Check className="mx-auto h-8 w-8 text-emerald-300" />}
          <h2 className="text-lg font-bold text-white">{pending ? tr(lang, 'sentTitle') : tr(lang, 'doneTitle')}</h2>
          <p className="text-sm text-slate-300">{pending ? tr(lang, 'sentText') : tr(lang, 'doneText')}</p>
          {outcome.kind === 'preferences' && outcome.next === 'create_own_project' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" onClick={() => onClose({ completed: true, outcome, next: 'create_book' })} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950" data-onb-next-action="create_book">{tr(lang, 'createBook')}</button>
              {(answers.projectType === 'course' || answers.projectType === 'educational_program') && (
                <button type="button" onClick={() => onClose({ completed: true, outcome, next: 'create_course' })} className="rounded-xl border border-amber-400 px-4 py-2 text-sm font-bold text-amber-200" data-onb-next-action="create_course">{tr(lang, 'createCourse')}</button>
              )}
              <button type="button" onClick={() => onClose({ completed: true, outcome })} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300" data-onb-close>{tr(lang, 'toStudio')}</button>
            </div>
          ) : (
            <button type="button" onClick={() => onClose({ completed: true, outcome })} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950" data-onb-close>{pending ? tr(lang, 'close') : tr(lang, 'toStudio')}</button>
          )}
        </div>
      </div>
    );
  }

  const pos = visible.indexOf(step);
  return (
    <div className="ui-opacity-exempt fixed inset-0 z-[300] overflow-y-auto bg-slate-950/95 p-3 sm:p-6" data-onb-wizard data-onb-current={step}>
      <div className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-300">Fusion Lab Studio · {tr(lang, 'title')}</p>
            <p className="mt-1 text-xs text-slate-400">{tr(lang, 'subtitle')}</p>
          </div>
          <button type="button" onClick={() => void later()} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" title={tr(lang, 'later')} data-onb-later><X className="h-4 w-4" /></button>
        </header>
        <nav className="flex items-center gap-1" aria-label="progress" data-onb-progress>
          {visible.map((id, i) => (
            <span key={id} title={label(ONBOARDING_STEPS[id - 1].name)} className={`h-1.5 flex-1 rounded-full ${i < pos ? 'bg-amber-500' : i === pos ? 'bg-amber-300' : 'bg-slate-700'}`} />
          ))}
        </nav>
        <p className="text-[11px] text-slate-500">{tr(lang, 'stepOf', { n: String(pos + 1), m: String(visible.length) })} · {label(ONBOARDING_STEPS[step - 1].name)}</p>
        {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" data-onb-error>{error}</p>}
        {body()}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <div className="flex gap-2">
            {pos > 0 && <button type="button" disabled={busy} onClick={goBack} className="flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200" data-onb-back><ArrowLeft className="h-4 w-4" /> {tr(lang, 'back')}</button>}
            {step === 8 && <button type="button" disabled={busy} onClick={() => setStep(3)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200" data-onb-edit>{tr(lang, 'edit')}</button>}
          </div>
          <div className="flex gap-2">
            {source === 'first_login' && step === 1 && <button type="button" disabled={busy} onClick={() => void later()} className="rounded-xl px-3 py-2 text-sm text-slate-400 hover:text-slate-200" data-onb-skip>{tr(lang, 'skip')}</button>}
            {step < 8 ? (
              <button type="button" disabled={busy || !reg} onClick={() => void goNext()} className="flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50" data-onb-next>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{tr(lang, 'next')} <ArrowRight className="h-4 w-4" /></button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void complete()} className="flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50" data-onb-complete>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : joining ? <Send className="h-4 w-4" /> : <Check className="h-4 w-4" />}{joining ? tr(lang, 'request') : tr(lang, 'toStudio')}</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default RoleOnboardingWizard;
