import { WorldFields } from './WorldFields';
import { WorldPhotoAnalysis } from './WorldPhotoAnalysis';
import { acceptAiOrigin } from '../../shared/aiTextOrigin';
import { WIZARD_STEPS, wizardStepKey, type StoryWorld, type WizardStepKey } from '../../shared/storyWorld';
import React, { useEffect, useRef, useState } from 'react';
import {
  Wand2,
  Dices,
  Loader2,
  Check,
  RefreshCw,
  Trash2,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  BookOpen,
  UserPlus,
} from 'lucide-react';
import { POLTI_PATTERNS } from '../data/poltiPatterns';
import { HeroArcPanel } from './HeroArcPanel';
import { defaultHeroArcState } from '../data/heroArc';
import type { Book, HeroArcState } from '../types';
import { WizardDraftSession, WizardApiError, wizardApi as api, type WizardDraft } from '../utils/expressDraftSession';
import { registerNavigationGuard } from '../utils/navigationGuard';
import { STORY_MODELS, bookScenario, storyModel, scenarioErrors, type WizardScenarioState } from '../../shared/wizardScenarios';
import { WizardScenarioFields } from './WizardScenarioFields';
import { WizardSourcesPanel } from './WizardSourcesPanel';

/**
 * Експрес-майстер «Книга за 5 хвилин» (Wisart Book Crealiry.md §3.4).
 *
 * Головна ідея, від якої тут усе походить: користувач не заповнює порожні
 * поля, а **приймає або міняє** те, що вже запропоновано. Тому кожен крок,
 * починаючи з другого, відкривається запитом до моделі, а не порожнім
 * бланком — і жодна кнопка «Далі» не веде на чистий аркуш.
 *
 * Чернетка живе на сервері (express_drafts), а її id — у localStorage:
 * майстер проходять анонімно, до реєстрації, і перезавантаження сторінки
 * посеред п'яти хвилин роботи не має її знищувати.
 */

const DRAFT_KEY = 'nova_express_draft_id';
const TOTAL_PARTS = 3;

interface CastMember {
  id: string;
  firstName: string;
  lastName: string;
  psychotype?: string;
  vedicRole?: string;
  poltiPatternId?: number;
  poltiRoleName?: string;
  hook?: string;
  appearance?: string;
  goal?: string;
  flaw?: string;
  approved?: boolean;
}

export interface ExpressWizardPayload extends WizardScenarioState {
  storyWorld?: StoryWorld;
  navigationVersion?: 2;
  stepKey?: WizardStepKey;
  useAi?: boolean;
  reviewConfirmed?: boolean;
  structureConfirmed?: boolean;
  seed?: string;
  genre?: string;
  framework?: string;
  frameworkRationale?: string;
  natureConnection?: boolean;
  archetypes36?: boolean;
  cast?: CastMember[];
  heroArc?: HeroArcState;
  synopsis?: string;
  parts?: Part[];
}

interface Chapter {
  chapterNumber?: number;
  chapterTitle?: string;
  involvedCharacters?: string[];
  involvedCharacterIds?: string[];
  environmentalContext?: string | null;
  summary?: string;
  turningPoint?: string;
  source?: 'ai' | 'author';
  sourceIds?: string[];
  choices?: { label: string; destination: string; consequence: string }[];
}

interface Part {
  partNumber?: number;
  partTitle?: string;
  frameworkStage?: string;
  chapters?: Chapter[];
}

type Draft = WizardDraft<ExpressWizardPayload>;

interface EngineInfo {
  engine: string;
  modelId: string;
  source: 'platform' | 'server';
}

const FRAMEWORKS = STORY_MODELS.map(m => ({ id: m.id, name: m.title, blurb: m.description }));

const STEPS = WIZARD_STEPS;

export const ExpressWizardView: React.FC<{
  onFinish?: (payload: ExpressWizardPayload) => void;
  /** Напрям, обраний на розвилці (Завдання 4). Іде в чернетку на сервер. */
  track?: string;
  /** Назва напряму для шапки — щоб було видно, у якій гілці ти зараз. */
  trackTitle?: string;
  /** Повернутись до вибору напряму. Без цього гілка — пастка в один бік. */
  onChangeTrack?: () => void;
  /**
   * Задум, з яким людина прийшла з маркетплейсу (`?idea=…` на вході в
   * Студію). Стає початковим «Зерном» — і, на відміну від чернетки, не
   * перезаписується нею: це найсвіжіше, що людина сказала про свою книгу.
   */
  initialSeed?: string;
  currentBook?: Book;
}> = ({ onFinish, track, trackTitle, onChangeTrack, initialSeed, currentBook }) => {
  const [session] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* server save remains available */ }
    return new WizardDraftSession<ExpressWizardPayload>({
      seed: (initialSeed ?? '').trim(), heroArc: defaultHeroArcState(),
      navigationVersion: 2, stepKey: 'seed', entryMode: 'idea', targetCastSize: 2, natureConnection: false, archetypes36: false, useAi: true,
    }, api, storage);
  });
  const [view, setView] = useState(session.view);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const initialization = useRef<Promise<Draft> | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const workingRef = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engine, setEngine] = useState('');
  const [proposal, setProposal] = useState<{ cast: CastMember[]; revision: number } | null>(null);
  const { draft, step } = view;
  const busy = loadingDraft ? 'draft' : sourceBusy ? 'sources' : working;
  const error = localError || view.error;
  const { seed = '', genre = '', framework = '', frameworkRationale: rationale = '',
    natureConnection: nature = false, archetypes36: archetypes = false,
    cast = [], heroArc = defaultHeroArcState(), synopsis = '', parts = [] } = view.payload;

  const useAi = view.payload.useAi !== false;
  const selectedScenario = bookScenario(view.payload.entryMode);
  function editInputs(patch: Partial<ExpressWizardPayload>) {
    session.edit({ ...patch, ...(patch.storyWorld && session.view.payload.entryMode==='world'?{scenarioInputs:{...session.view.payload.scenarioInputs,worldRules:[patch.storyWorld.name,patch.storyWorld.description,patch.storyWorld.rules].filter(Boolean).join('\n')}}:{}), reviewConfirmed: false, structureConfirmed: false });
  }
  function setField<K extends keyof ExpressWizardPayload>(key: K, value: ExpressWizardPayload[K]) {
    editInputs({ [key]: value });
  }
  const setSeed = (v: string) => setField('seed', v);
  const setGenre = (v: string) => setField('genre', v);
  const setFramework = (v: string) => setField('framework', v);
  const setNature = (v: boolean) => setField('natureConnection', v);
  const setArchetypes = (v: boolean) => setField('archetypes36', v);
  const setCast = (v: React.SetStateAction<CastMember[]>) =>
    editInputs({ cast: typeof v === 'function' ? v(session.view.payload.cast ?? []) : v });
  const setHeroArc = (v: HeroArcState) => setField('heroArc', v);
  const setSynopsis = (v: string) => setField('synopsis', v);

  useEffect(() => session.subscribe(() => setView(session.view)), [session]);
  useEffect(() => {
    void api<{ engines: EngineInfo[] }>('/api/express/engines')
      .then((r) => { setEngines(r.engines); if (r.engines[0]) setEngine(r.engines[0].engine); })
      .catch(() => setEngines([]));
  }, []);
  useEffect(() => {
    let active = true;
    if (!initialization.current) initialization.current = (async () => {
      let id: string | null = null;
      try { if (!(initialSeed ?? '').trim()) id = localStorage.getItem(DRAFT_KEY); } catch { /* optional storage */ }
      if (id) {
        session.recover(id); setView(session.view);
        try { return await api<Draft>('/api/express/draft/' + id); }
        catch (error) { if (!(error instanceof WizardApiError) || error.status !== 404) throw error; }
      }
      const created = await api<Draft>('/api/express/draft', {
        method: 'POST', body: JSON.stringify({ payload: session.view.payload, track: track || 'book' }),
      });
      try { localStorage.setItem(DRAFT_KEY, created.id); } catch { /* server draft exists */ }
      return created;
    })();
    void initialization.current.then(d => {
      if (active) { session.open(d); setView(session.view); }
    }).catch(error => { if (active) setLocalError((error as Error).message); })
      .finally(() => { if (active) setLoadingDraft(false); });
    return () => { active = false; };
  }, [initialSeed, session, track]);
  useEffect(() => {
    if (!view.draft || !view.dirty || view.conflict || working) return;
    const timer = setTimeout(() => { void session.flush().catch(() => undefined); }, 600);
    return () => clearTimeout(timer);
  }, [view.payload, view.dirty, view.conflict, view.draft?.id, working, session]);
  useEffect(() => {
    const unregister = registerNavigationGuard(() => session.flush());
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.view.dirty || session.view.pending || workingRef.current) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    const saveHidden = () => {
      if (document.visibilityState === 'hidden' && session.view.dirty && !workingRef.current) {
        void session.flush().catch(() => undefined);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', saveHidden);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', saveHidden);
      void session.flush().catch(() => undefined);
    };
  }, [session]);
  async function perform(label: string, action: () => Promise<unknown>) {
    if (workingRef.current) return;
    workingRef.current = true; setWorking(label); setLocalError(null);
    try { await action(); }
    catch (err) { setLocalError((err as Error).message); }
    finally { workingRef.current = false; setWorking(null); }
  }
  async function suggest(stage: 'framework' | 'cast' | 'synopsis' | 'plan') {
    const r = await session.generate<{
      payload: ExpressWizardPayload; draft: Draft; needsConfirmation?: boolean;
    }>('/api/express/suggest', { stage, engine });
    if (stage === 'cast' && r.needsConfirmation) {
      setProposal({ cast: r.payload.cast ?? [], revision: r.draft.revision });
    }
  }
  const requestSuggestion = (stage: 'framework' | 'cast' | 'synopsis' | 'plan') =>
    perform(stage, () => suggest(stage));
  async function startWizard(allowAi = true) {
    if (!seed.trim()) return;
    await perform('draft', async () => {
      const errors = scenarioErrors(session.view.payload);
      if (errors.length) throw new Error(errors.join(' '));
      session.edit({ useAi: allowAi });
      if (!session.view.draft) {
        const d = await api<Draft>('/api/express/draft', {
          method: 'POST', body: JSON.stringify({ payload: session.view.payload, track: track || 'book' }),
        });
        session.open(d);
        try { localStorage.setItem(DRAFT_KEY, d.id); } catch { /* saved on server */ }
      }
      session.edit({navigationVersion:2,stepKey:'world',...(!session.view.payload.storyWorld && session.view.payload.entryMode==='world'?{storyWorld:{id:crypto.randomUUID(),name:'Світ книги',description:'',rules:session.view.payload.scenarioInputs?.worldRules||'',approved:false}}:{})});
      await session.flush(6);
    });
  }
  async function rollDice() {
    await perform('seed', async () => {
      const r = await api<{ seed: string; genre: string }>('/api/express/seed', {
        method: 'POST', body: JSON.stringify({ engine }),
      });
      session.edit({ seed: r.seed, ...(r.genre ? { genre: r.genre } : {}) });
    });
  }
  async function goTo(next: number) {
    await perform('save', async () => {
      session.edit({navigationVersion:2,stepKey:wizardStepKey(next)});
      await session.flush(next);
      if (next === 2 && !session.view.payload.framework) {
        if (session.view.payload.useAi !== false) await suggest('framework');
        if (!session.view.payload.framework) { session.edit({framework:selectedScenario.documentary?'documentary':'hero_journey'}); await session.flush(); }
      }
      if (next === 3 && session.view.payload.entryMode !== 'characters_photos' && session.view.payload.useAi !== false && (session.view.payload.targetCastSize ?? 2) > 0 && !session.view.payload.cast?.length) await suggest('cast');
      // Step 4 shows the source before the author explicitly starts generation.
      if (next === 5 && session.view.payload.useAi !== false && !session.view.payload.parts?.length) await generateParts();
    });
  }
  async function generateParts() {
    for (let n = 1; n <= TOTAL_PARTS; n++) {
      if (session.view.payload.parts?.[n - 1]) continue;
      setWorking('part-' + n);
      await session.generate<{ part: Part; draft: Draft }>('/api/express/generate', { partNumber: n, engine });
    }
  }
  async function acceptCast(mode: 'add' | 'replace') {
    if (!proposal) return;
    await perform('save', async () => {
      if (session.view.draft?.revision !== proposal.revision) {
        throw new Error('Склад героїв змінився після цієї пропозиції. Запитайте нову пропозицію.');
      }
      editInputs({ cast: mode === 'add' ? [...(session.view.payload.cast ?? []), ...proposal.cast] : proposal.cast });
      await session.flush(); setProposal(null);
    });
  }
  function updateCastMember(index: number, patch: Partial<CastMember>) {
    setCast((prev) => prev.map((c, i) => i === index ? { ...c, approved: false, ...patch } : c));
  }
  function updateCastRoleText(index: number, text: string) {
    const match = POLTI_PATTERNS.find((p) => p.name === text.trim());
    updateCastMember(index, { poltiRoleName: text, poltiPatternId: match?.id });
  }
  function applyPoltiPreset(index: number, patternId: number) {
    const pattern = POLTI_PATTERNS.find((p) => p.id === patternId);
    if (pattern) updateCastMember(index, { poltiPatternId: pattern.id, poltiRoleName: pattern.name });
  }
  function addOwnCharacter() {
    setCast((prev) => [...prev, { id: crypto.randomUUID(), firstName: '', lastName: '', poltiRoleName: '' }]);
  }
  const saveSynopsis = () => perform('save-synopsis', () => session.flush());
  const changeTrack = () => perform('save', async () => { await session.flush(); onChangeTrack?.(); });
  const finish = () => perform('save', async () => {
    const saved = await session.flush();
    if (saved) await onFinish?.(saved.payload);
  });

  const words = synopsis.trim() ? synopsis.trim().split(/\s+/).length : 0;
  const chapters = parts.reduce((s, p) => s + (p.chapters?.length ?? 0), 0);

  return (
    <div data-book-wizard className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <Wand2 className="w-5 h-5" />
          <span className="font-mono text-xs font-bold tracking-widest uppercase">Книга за 5 хвилин</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-slate-100">Експрес-майстер</h1>
          {trackTitle && (
            <span className="badge-glass rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-400">
              {trackTitle}
            </span>
          )}
          {onChangeTrack && (
            <button
              type="button"
              onClick={() => void changeTrack()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              змінити напрям
            </button>
          )}
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
          Опишіть задум одним реченням. Далі студія пропонує — ви приймаєте або міняєте. Наприкінці
          отримаєте готовий план: частини, глави, героїв і звʼязки між ними.
        </p>
      </header>

      {/* Смуга кроків */}
      <ol className="mb-6 flex flex-wrap items-center gap-1.5">
        {STEPS.map(({label, number:n}, i) => {
          const currentIndex = STEPS.findIndex(s => s.number === step);
          const done = i < currentIndex;
          const active = n === step;
          return (
            <li key={label} className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!draft || i > currentIndex || busy !== null}
                onClick={() => void goTo(n)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'badge-glass text-emerald-400'
                    : done
                      ? 'text-emerald-400 hover:bg-white/[0.04]'
                      : 'text-slate-500'
                } ${!draft || i > currentIndex ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px] font-mono">
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {label}
              </button>
              {n < STEPS.length && <span className="text-slate-700">·</span>}
            </li>
          );
        })}
      </ol>

      {useAi && engines.length === 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Немає жодного налаштованого рушія ШІ. Зверніться до адміністратора щодо доступу до моделей або продовжте вручну.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {view.draft && <p role="status" className="mb-3 text-xs text-slate-400">
        {view.dirty ? 'Є незбережені правки' : 'Чернетку збережено'}{view.pending ? ' · зберігаю…' : ''}
      </p>}
      {view.conflict && <div className="mb-4 rounded-xl border border-amber-500/40 p-4 text-sm text-slate-200">
        <p>Інша вкладка змінила чернетку. Порівняйте версії перед продовженням.</p>
        <details className="mt-2"><summary>Мої незбережені правки</summary>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(view.payload, null, 2)}</pre>
        </details>
        <details className="mt-2"><summary>Поточна серверна версія</summary>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(view.conflict.payload, null, 2)}</pre>
        </details>
        <button type="button" className="mt-3 underline" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(view.payload, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = 'wizard-local-draft.json'; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Завантажити мою копію</button>
        <button type="button" className="ml-4 mt-3 underline" onClick={() => {
          session.useServer(); setProposal(null); setLocalError(null);
        }}>Продовжити із серверною версією</button>
      </div>}
      <fieldset disabled={busy !== null} className="min-w-0">
      {/* Крок Е1 — зерно задуму */}
      {step === 1 && (
        <section className="glass-panel rounded-2xl p-6">
          <WizardScenarioFields value={view.payload} onChange={editInputs} currentBook={currentBook}
            onBeforeLeave={() => session.flush()} onBusyChange={setSourceBusy}/>
          <label className="mb-1.5 block text-sm font-semibold text-slate-200">
            Про що ваша книга?
          </label>
          <textarea
            name="wizard-seed" value={seed}
            onChange={(e) => setSeed(e.target.value)}
            rows={3}
            maxLength={400}
            placeholder="Одне-два речення. Наприклад: реставраторка знаходить у підкладці ікони лист, який змінює історію її роду."
            className="w-full resize-none rounded-xl border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{seed.trim().length < 20 ? 'Мінімум 20 символів' : ' '}</span>
            <span className="font-mono">{seed.length}/400</span>
          </div>

          <label className="mt-4 mb-1.5 block text-sm font-semibold text-slate-200">Жанр</label>
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Історичний детектив, філософський кіберпанк…"
            className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
          />

          {engines.length > 1 && (
            <>
              <label className="mt-4 mb-1.5 block text-sm font-semibold text-slate-200">Модель</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/50"
              >
                {engines.map((e) => (
                  <option key={e.engine} value={e.engine} className="bg-slate-900">
                    {e.modelId} {e.source === 'platform' ? '(ключ Nova)' : '(серверний ключ)'}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startWizard(true)}
              disabled={seed.trim().length < 20 || busy !== null || engines.length === 0 || scenarioErrors(view.payload).length > 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Почати
            </button>
            <button type="button" onClick={() => void startWizard(false)}
              disabled={seed.trim().length < 20 || busy !== null || scenarioErrors(view.payload).length > 0}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 disabled:opacity-40">Продовжити без ШІ</button>
            <button
              type="button"
              onClick={() => void rollDice()}
              disabled={busy !== null || engines.length === 0}
              title="Згенерувати випадковий задум"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
            >
              {busy === 'seed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
              Кинути кубик
            </button>
          </div>
        </section>
      )}

      {step === 6 && <section className="glass-panel rounded-2xl p-6" data-wizard-world>
        <h2 className="text-xl font-bold mb-2">Світ книги · необов’язковий крок</h2>
        <p className="text-sm text-slate-400 mb-3">Правила та обстановка підтримають усі наступні пропозиції. Нотатки не стають текстом книги. Можна пропустити.</p>
        <WorldFields value={view.payload.storyWorld} onChange={patch=>editInputs({storyWorld:{id:session.view.payload.storyWorld?.id||crypto.randomUUID(),name:'',description:'',approved:false,...session.view.payload.storyWorld,...patch}})}/>
        <WorldPhotoAnalysis target="world" snapshotKey={JSON.stringify(view.payload.storyWorld)}
          beforeAnalyze={async()=>{await session.flush();let d=session.view.draft;if(!d)throw new Error('Збережіть чернетку.');if(!d.userId){d=await api<Draft>('/api/express/claim',{method:'POST',body:JSON.stringify({draftId:d.id,expectedRevision:d.revision})});session.open(d);}return {draftId:d.id,expectedRevision:d.revision};}}
          onAccept={(text,p)=>editInputs({storyWorld:{id:session.view.payload.storyWorld?.id||crypto.randomUUID(),name:'Світ книги',...session.view.payload.storyWorld,description:text,approved:false,descriptionOrigin:acceptAiOrigin(session.view.draft?.userId||'local-author',null,undefined,crypto.randomUUID())}})}/>
        <StepNav onBack={()=>void goTo(1)} onNext={()=>void goTo(2)} nextDisabled={busy !== null}/>
      </section>}

      {/* Крок Е2 — модель розповіді */}
      {step === 2 && (
        <section className="glass-panel rounded-2xl p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Модель розповіді</h2>
              {rationale && <p className="mt-1 text-sm text-slate-400">{rationale}</p>}
            </div>
            <button
              type="button"
              onClick={() => draft && void requestSuggestion('framework')}
              disabled={busy !== null}
              className="shrink-0 rounded-lg border border-white/15 p-2 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
              title="Запропонувати ще раз"
            >
              {busy === 'framework' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {FRAMEWORKS.map((f) => (
              <button
                data-story-model={f.id} key={f.id}
                type="button"
                aria-pressed={framework === f.id}
                onClick={() => { editInputs({ framework: f.id, frameworkRationale: '' }); }}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  framework === f.id
                    ? 'border-emerald-500/60 bg-emerald-500/10'
                    : 'border-white/10 hover:border-white/25 hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  {framework === f.id && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                  {f.name}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-400">{f.blurb}</span>
              </button>
            ))}
          </div>

          <p className="mt-3 rounded-lg bg-slate-950/70 p-3 text-xs text-slate-300">{storyModel(framework).beats.join(' → ')}</p>
          <label className="mt-3 block text-xs text-slate-300">Скільки героїв пропонувати? (для нонфікшну можна 0)
            <input type="number" min={0} max={20} value={view.payload.targetCastSize ?? 2} onChange={e=>setField('targetCastSize',Number(e.target.value))} className="ml-2 w-20 rounded border border-slate-700 bg-slate-900 p-2"/>
          </label>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={nature} onChange={(e) => setNature(e.target.checked)} className="accent-emerald-500" />
              Звʼязок героїв зі стихіями й порами року
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={archetypes} onChange={(e) => setArchetypes(e.target.checked)} className="accent-emerald-500" />
              36 патернів Польті
            </label>
          </div>

          <StepNav onBack={() => void goTo(6)} onNext={() => void goTo(3)} nextDisabled={!framework || busy !== null} />
        </section>
      )}

      {/* Крок Е3 — каст */}
      {step === 3 && (
        <section className="glass-panel rounded-2xl p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Герої та звʼязки</h2>
              <p className="mt-1 text-sm text-slate-400">
                Задайте героїв, їхні цілі й зв’язки. Ролі та образи приймає автор; додаткові варіанти не замінюють наявний склад.
              </p>
            </div>
            <button
              type="button"
              onClick={() => draft && void requestSuggestion('cast')}
              disabled={busy !== null}
              className="shrink-0 rounded-lg border border-white/15 p-2 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
              title="Запропонувати інший каст"
            >


          {busy === 'cast' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

              {proposal && <div className="mb-4 rounded-xl border border-emerald-500/40 p-4">
            <h3 className="text-sm font-semibold text-emerald-300">Нова пропозиція героїв</h3>
            <ul className="my-2 space-y-1 text-sm text-slate-300">{proposal.cast.map((c) =>
              <li key={c.id}>{c.firstName} {c.lastName} — {c.poltiRoleName || c.hook}</li>
            )}</ul>
            <div className="flex flex-wrap gap-4 text-sm text-emerald-300">
              <button type="button" onClick={() => void acceptCast('add')}>Додати</button>
              <button type="button" onClick={() => void acceptCast('replace')}>Замінити наявних героїв</button>
              <button type="button" onClick={() => setProposal(null)}>Ігнорувати</button>
            </div>
          </div>}

          {busy === 'cast' && cast.length === 0 ? (
            <Waiting label="Придумую героїв…" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {cast.map((c, i) => (
                <div key={c.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* Ім'я — редаговане: майстер лише пропонує, письменник
                        може перейменувати героя, не чекаючи перегенерації
                        всього касту. */}
                    <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0">
                      <input
                        value={c.firstName}
                        onChange={(e) => updateCastMember(i, { firstName: e.target.value })}
                        aria-label="Ім’я героя" placeholder="Ім'я"
                        className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                      />
                      <input
                        value={c.lastName}
                        onChange={(e) => updateCastMember(i, { lastName: e.target.value })}
                        aria-label="Прізвище героя" placeholder="Прізвище"
                        className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setCast((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 text-slate-500 hover:text-red-400 mt-1"
                      title="Прибрати"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {c.psychotype && <p className="mt-1.5 text-xs text-slate-400">{c.psychotype}</p>}

                  {/* Роль героя — вільний текст, який лишається джерелом
                      істини. Список поруч — лише швидка підказка з 36
                      патернів Польті: обрати номер, щоб заповнити поле, або
                      просто вписати власну роль, не торкаючись списку. */}
                  <div className="mt-2 flex flex-col gap-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Роль у книзі
                    </label>
                    <input
                      value={c.poltiRoleName ?? ''}
                      onChange={(e) => updateCastRoleText(i, e.target.value)}
                      placeholder="Роль у творі своїми словами"
                      className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                    />
                    {archetypes && <select
                      value=""
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        if (id) applyPoltiPreset(i, id);
                      }}
                      className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-400 outline-none focus:border-emerald-500/50 cursor-pointer"
                      title="Підставити одну з 36 драматичних ситуацій Польті"
                    >
                      <option value="" className="bg-slate-900">
                        — обрати з 36 типів ролей —
                      </option>
                      {POLTI_PATTERNS.map((p) => (
                        <option key={p.id} value={p.id} className="bg-slate-900">
                          №{p.id} {p.name}
                        </option>
                      ))}
                    </select>}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.poltiPatternId != null && c.poltiRoleName && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        №{c.poltiPatternId} {c.poltiRoleName}
                      </span>
                    )}
                    {c.vedicRole && (
                      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-300">
                        {c.vedicRole}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="text-xs text-slate-300">Зовнішність / авторський опис
                      <textarea value={c.appearance ?? ''} onChange={e=>updateCastMember(i,{appearance:e.target.value,approved:false})} rows={3} className="mt-1 w-full rounded border border-slate-700 bg-slate-950/70 p-2"/>
                    </label>
                    <label className="text-xs text-slate-300">Мета<input value={c.goal ?? ''} onChange={e=>updateCastMember(i,{goal:e.target.value,approved:false})} className="mt-1 w-full rounded border border-slate-700 bg-slate-950/70 p-2"/></label>
                    <label className="text-xs text-slate-300">Внутрішня суперечність<input value={c.flaw ?? ''} onChange={e=>updateCastMember(i,{flaw:e.target.value,approved:false})} className="mt-1 w-full rounded border border-slate-700 bg-slate-950/70 p-2"/></label>
                    <label className="flex items-center gap-2 text-xs text-emerald-200"><input type="checkbox" checked={c.approved===true} onChange={e=>updateCastMember(i,{approved:e.target.checked})}/> Опис героя перевірено</label>
                  </div>
                  {c.hook && <p className="mt-2 text-xs italic leading-relaxed text-slate-500">{c.hook}</p>}
                </div>
              ))}
            </div>
          )}

          {busy !== 'cast' && (
            <button
              type="button"
              onClick={addOwnCharacter}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-3.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Додати свого героя
            </button>
          )}

          {view.payload.entryMode === 'characters_photos' && <WizardSourcesPanel value={view.payload.sourceMaterials ?? []}
            onChange={sourceMaterials=>editInputs({sourceMaterials})} characters={cast}
            onBeforeLeave={()=>session.flush()} onBusyChange={setSourceBusy}
            onApplyCharacter={(id,text)=>setCast(prev=>prev.map(c=>c.id===id?{...c,appearance:text,approved:false}:c))}/>}
          {/* Крива головного героя — заповнюється тут-таки, поки протагоніст
              і решта касту вже перед очима. Той самий стан переноситься в
              книгу разом з рештою плану (App.tsx::applyExpressPlan). */}
          {cast.length > 0 && framework === 'hero_journey' && (
            <div className="mt-4">
              <HeroArcPanel value={heroArc} onChange={setHeroArc} heroName={`${cast[0].firstName} ${cast[0].lastName}`.trim()} />
            </div>
          )}

          <StepNav
            onBack={() => void goTo(2)}
            onNext={() => void goTo(4)}
            nextDisabled={
              ((view.payload.targetCastSize ?? 2) > 0 && cast.length === 0) ||
              (view.payload.entryMode === 'characters_photos' && (cast.length === 0 || cast.some(c=>!c.approved))) ||
              busy !== null ||
              cast.some((c) => !c.firstName.trim())
            }
          />
        </section>
      )}

      {/* Крок Е4 — синопсис */}
      {step === 4 && (
        <section className="glass-panel rounded-2xl p-6">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Синопсис</h2>
              <p className="mt-1 text-sm text-slate-400">Правте прямо тут — далі структура будується саме з нього.</p>
            </div>
            <button
              type="button"
              onClick={() => draft && void requestSuggestion('synopsis')}
              disabled={busy !== null}
              className="shrink-0 rounded-lg border border-white/15 p-2 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
              title="Переписати"
            >
              {busy === 'synopsis' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

          <div className="mb-4 rounded-xl border border-white/10 bg-slate-900/40 p-3 text-sm text-slate-300">
            <p className="font-semibold">Синопсис буде створено на основі:</p>
            <p className="mt-1">{cast.map((c) => c.firstName + ' ' + c.lastName + ' (' + (c.poltiRoleName || 'роль не задано') + ')').join(', ')}</p>
            <p className="mt-1">Задум і конфлікт: {seed}</p>
            {cast.some((c) => c.hook) && <p className="mt-1">{cast.filter((c) => c.hook).map((c) => c.hook).join(' · ')}</p>}
            <p className="mt-1">Сценарій: {selectedScenario.title}</p>
            <p className="mt-1">Модель: {FRAMEWORKS.find((f) => f.id === framework)?.name || framework}</p>
            <p className="mt-1">Джерела: {(view.payload.sourceMaterials ?? []).filter(s=>s.approved).map(s=>s.title).join(', ') || 'лише авторські поля'}</p>
            <button type="button" className="mt-3 font-semibold text-emerald-300 underline"
              onClick={() => void requestSuggestion('synopsis')}>{synopsis ? 'Створити новий синопсис із цих даних' : 'Створити синопсис із цих даних'}</button>
          </div>
          {busy === 'synopsis' && !synopsis ? (
            <Waiting label="Пишу синопсис…" />
          ) : (
            <>
              <textarea
                name="wizard-synopsis" value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                onBlur={() => void saveSynopsis()}
                rows={14}
                className="w-full resize-y rounded-xl border border-white/10 bg-slate-900/60 px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none focus:border-emerald-500/50"
              />
              {/* ТЗ просить 500-700 слів. Модель регулярно недобирає, тож
                  показуємо це прямо, а не мовчимо — інакше недобір поїде
                  далі у структуру й проявиться вже главами «ні про що». */}
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className={words < 500 ? 'text-amber-400' : 'text-emerald-400'}>
                  {words < 500
                    ? `${words} слів — за ТЗ потрібно 500–700. Натисніть «Переписати», щоб отримати повніший.`
                    : `${words} слів — у межах норми`}
                </span>
              </div>
            </>
          )}

          <label className="mt-4 block text-sm text-slate-300">Загальний план трьох частин
            <textarea name="wizard-composition" value={view.payload.compositionPlan ?? ''} rows={7} onChange={e=>setField('compositionPlan',e.target.value)}
              placeholder="Початковий стан, ключові події й наслідки кожної частини" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-sm"/>
          </label>
          {useAi && <button type="button" className="mt-2 text-xs text-emerald-300 underline" disabled={!synopsis.trim()} onClick={()=>void requestSuggestion('plan')}>Запропонувати загальний план</button>}
          <label className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><input type="checkbox" checked={view.payload.reviewConfirmed===true}
            onChange={e=>session.edit({reviewConfirmed:e.target.checked})}/> Перевірив джерела, синопсис і загальний план</label>
          <StepNav onBack={() => void goTo(3)} onNext={() => void goTo(5)} nextDisabled={!synopsis || !view.payload.compositionPlan?.trim() || !view.payload.reviewConfirmed || busy !== null} />
        </section>
      )}

      {/* Крок Е5 — структура */}
      {step === 5 && (
        <section className="glass-panel rounded-2xl p-6">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-100">Структура книги</h2>
            <p className="mt-1 text-sm text-slate-400">
              {parts.length < TOTAL_PARTS
                ? `Частина ${parts.length + 1} з ${TOTAL_PARTS} — частини зʼявляються по черзі.`
                : `${parts.length} частини, ${chapters} глав.`}
            </p>
          </div>

          <div className="space-y-3">
            {parts.map((p, i) => (
              <details key={i} open className="rounded-xl border border-white/10 bg-slate-900/40">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-100">
                  Частина {p.partNumber ?? i + 1}. {p.partTitle}
                  {p.frameworkStage && (
                    <span className="ml-2 text-xs font-normal text-slate-500">{p.frameworkStage}</span>
                  )}
                </summary>
                <div className="space-y-2 px-4 pb-4">
                  {(p.chapters ?? []).map((ch, j) => (
                    <div key={j} className="rounded-lg border border-white/[0.06] bg-slate-950/40 p-3">
                      <p className="text-sm font-medium text-slate-200">
                        {ch.chapterNumber}. {ch.chapterTitle}
                      </p>
                      <label className="mt-2 block text-xs text-slate-300">Назва глави<input value={ch.chapterTitle ?? ''} onChange={e=>{
                        const next=structuredClone(session.view.payload.parts ?? []);next[i].chapters![j].chapterTitle=e.target.value;editInputs({parts:next});
                      }} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"/></label>
                      <label className="mt-2 block text-xs text-slate-300">Зміст глави<textarea value={ch.summary ?? ''} rows={4} onChange={e=>{
                        const next=structuredClone(session.view.payload.parts ?? []);next[i].chapters![j].summary=e.target.value;editInputs({parts:next});
                      }} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"/></label>
                      {ch.choices?.map((choice,k)=><p key={k} className="mt-1 text-xs text-cyan-300">{choice.label} → {choice.destination}: {choice.consequence}</p>)}
                      {ch.turningPoint && (
                        <p className="mt-1.5 text-xs text-emerald-300/80">Поворот: {ch.turningPoint}</p>
                      )}
                      {ch.environmentalContext && (
                        <p className="mt-1 text-xs italic text-slate-500">{ch.environmentalContext}</p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            ))}

            {busy?.startsWith('part-') && <Waiting label={`Пишу частину ${parts.length + 1}…`} />}
          </div>

          {parts.length < TOTAL_PARTS && !busy && <div className="mt-4 flex flex-wrap gap-4 text-xs text-emerald-300">
            {useAi && <button type="button" onClick={()=>void perform('structure',generateParts)}>Згенерувати решту частин</button>}
            <button type="button" onClick={()=>editInputs({parts:[...parts,{partNumber:parts.length+1,partTitle:'Частина '+(parts.length+1),chapters:[{chapterNumber:chapters+1,chapterTitle:'Нова глава',summary:'',source:'author'}]}]})}>Додати частину вручну</button>
          </div>}
          {parts.length > 0 && <label className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><input type="checkbox" checked={view.payload.structureConfirmed===true} onChange={e=>session.edit({structureConfirmed:e.target.checked})}/> Структуру та зміст глав перевірено</label>}
          {parts.length === TOTAL_PARTS && view.payload.structureConfirmed && parts.every(p=>p.chapters?.every(ch=>ch.chapterTitle?.trim() && ch.summary?.trim())) && busy === null && (
            <button
              type="button"
              onClick={() => void finish()}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400"
            >
              <BookOpen className="h-4 w-4" />
              Почати писати
            </button>
          )}
        </section>
      )}
      </fieldset>
    </div>
  );
};

const Waiting: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-slate-900/40 px-4 py-6 text-sm text-slate-400">
    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
    {label}
  </div>
);

const StepNav: React.FC<{ onBack: () => void; onNext: () => void; nextDisabled: boolean }> = ({
  onBack,
  onNext,
  nextDisabled,
}) => (
  <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Назад
    </button>
    <button
      type="button"
      onClick={onNext}
      disabled={nextDisabled}
      className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Далі
      <ArrowRight className="h-4 w-4" />
    </button>
  </div>
);
