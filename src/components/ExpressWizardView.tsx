import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import type { HeroArcState } from '../types';

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
  firstName: string;
  lastName: string;
  psychotype?: string;
  vedicRole?: string;
  poltiPatternId?: number;
  poltiRoleName?: string;
  hook?: string;
}

interface Payload {
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
  environmentalContext?: string | null;
  summary?: string;
  turningPoint?: string;
}

interface Part {
  partNumber?: number;
  partTitle?: string;
  frameworkStage?: string;
  chapters?: Chapter[];
}

interface Draft {
  id: string;
  step: number;
  payload: Payload;
}

interface EngineInfo {
  engine: string;
  modelId: string;
  source: 'platform' | 'server';
}

const FRAMEWORKS: Array<{ id: string; name: string; blurb: string }> = [
  { id: 'hero_journey', name: 'Подорож героя', blurb: '12 стадій Кемпбелла — класична дуга змін.' },
  { id: 'psychotypes', name: 'Психотипи', blurb: 'Сюжет росте зі зіткнення характерів.' },
  { id: 'vedic_archetypes', name: 'Ведичні архетипи', blurb: 'Еволюція через гуни: Тамас → Раджас → Саттва.' },
  { id: 'buddhist_skandhas', name: 'Буддійські скандхи', blurb: 'Розгортання через пʼять скандх.' },
];

const STEPS = ['Зерно', 'Модель', 'Герої', 'Синопсис', 'Структура'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: 'Сервер повернув не JSON.' };
  }
  if (!res.ok) throw new Error(body?.error || `Помилка ${res.status}`);
  return body as T;
}

export const ExpressWizardView: React.FC<{
  onFinish?: (payload: Payload) => void;
}> = ({ onFinish }) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [seed, setSeed] = useState('');
  const [genre, setGenre] = useState('');
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engine, setEngine] = useState<string>('');

  const [framework, setFramework] = useState<string>('');
  const [rationale, setRationale] = useState<string>('');
  const [nature, setNature] = useState(true);
  const [archetypes, setArchetypes] = useState(true);

  const [cast, setCast] = useState<CastMember[]>([]);
  const [heroArc, setHeroArc] = useState<HeroArcState>(defaultHeroArcState());
  const [synopsis, setSynopsis] = useState('');
  const [parts, setParts] = useState<Part[]>([]);

  // Стежить, щоб автозапит кроку не полетів двічі на один вхід — у
  // StrictMode ефекти виконуються парою, а кожен зайвий запит тут коштує
  // грошей на ключі користувача.
  const autoRan = useRef<Record<number, boolean>>({});

  useEffect(() => {
    void api<{ engines: EngineInfo[] }>('/api/express/engines')
      .then((r) => {
        setEngines(r.engines);
        if (r.engines[0]) setEngine(r.engines[0].engine);
      })
      .catch(() => setEngines([]));
  }, []);

  // Відновлення незавершеної чернетки.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = localStorage.getItem(DRAFT_KEY);
    } catch {
      /* приватний режим — просто почнемо заново */
    }
    if (!id) return;

    void api<Draft>(`/api/express/draft/${id}`)
      .then((d) => {
        setDraft(d);
        setStep(d.step || 1);
        setSeed(d.payload.seed ?? '');
        setGenre(d.payload.genre ?? '');
        setFramework(d.payload.framework ?? '');
        setRationale(d.payload.frameworkRationale ?? '');
        setNature(d.payload.natureConnection !== false);
        setArchetypes(d.payload.archetypes36 !== false);
        setCast(d.payload.cast ?? []);
        if (d.payload.heroArc) setHeroArc(d.payload.heroArc);
        setSynopsis(d.payload.synopsis ?? '');
        setParts((d.payload.parts ?? []).filter(Boolean) as Part[]);
        // Крок уже пройдено — не переганяємо його ще раз.
        for (let i = 1; i <= (d.step || 1); i++) autoRan.current[i] = true;
      })
      .catch(() => {
        // Чернетка протермінувалась або зникла — прибираємо посилання,
        // щоб наступний вхід не спотикався об те саме.
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* не критично */
        }
      });
  }, []);

  const suggest = useCallback(
    async (draftId: string, stage: 'framework' | 'cast' | 'synopsis') => {
      setBusy(stage);
      setError(null);
      try {
        const r = await api<{ payload: Payload; draft: Draft }>('/api/express/suggest', {
          method: 'POST',
          body: JSON.stringify({ draftId, stage, engine }),
        });
        if (stage === 'framework') {
          setFramework(r.payload.framework ?? '');
          setRationale(r.payload.frameworkRationale ?? '');
          setNature(r.payload.natureConnection !== false);
          setArchetypes(r.payload.archetypes36 !== false);
        }
        if (stage === 'cast') setCast(r.payload.cast ?? []);
        if (stage === 'synopsis') setSynopsis(r.payload.synopsis ?? '');
        setDraft(r.draft);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [engine]
  );

  /** Крок Е1 → Е2. Створює чернетку й одразу просить модель розповіді. */
  async function startWizard() {
    if (!seed.trim()) return;
    setBusy('draft');
    setError(null);
    try {
      const d = await api<Draft>('/api/express/draft', {
        method: 'POST',
        body: JSON.stringify({ seed: seed.trim(), genre: genre.trim() }),
      });
      setDraft(d);
      try {
        localStorage.setItem(DRAFT_KEY, d.id);
      } catch {
        /* не критично */
      }
      setStep(2);
      autoRan.current[2] = true;
      await suggest(d.id, 'framework');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function rollDice() {
    setBusy('seed');
    setError(null);
    try {
      const r = await api<{ seed: string; genre: string }>('/api/express/seed', {
        method: 'POST',
        body: JSON.stringify({ engine }),
      });
      setSeed(r.seed);
      if (r.genre) setGenre(r.genre);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Перехід на крок, який ще не запитували, тягне свою пропозицію сам. */
  async function goTo(next: number) {
    setStep(next);
    if (!draft) return;
    if (autoRan.current[next]) return;
    autoRan.current[next] = true;
    if (next === 3) await suggest(draft.id, 'cast');
    if (next === 4) {
      await flushCastSave(draft.id);
      await suggest(draft.id, 'synopsis');
    }
    if (next === 5) {
      await flushCastSave(draft.id);
      await generateParts(draft.id);
    }
  }

  /** Крок Е5: частини приходять по одній — структура росте на очах. */
  async function generateParts(draftId: string) {
    setError(null);
    setParts([]);
    for (let n = 1; n <= TOTAL_PARTS; n++) {
      setBusy(`part-${n}`);
      try {
        const r = await api<{ part: Part; draft: Draft }>('/api/express/generate', {
          method: 'POST',
          body: JSON.stringify({ draftId, partNumber: n, engine }),
        });
        setParts((prev) => [...prev, r.part]);
        setDraft(r.draft);
      } catch (e) {
        setError((e as Error).message);
        break;
      }
    }
    setBusy(null);
  }

  /**
   * Каст і крива головного героя майстер віддає лише як пропозицію
   * (§3.4.5): за ТЗ письменник має право поправити ім'я, роль, додати
   * власного героя чи довести дугу героя, не чекаючи нової генерації.
   * Обидва зберігаються разом одним дебаунсом — вони заповнюються на
   * тому самому кроці Е3, і окремий таймер на кожен дав би два майже
   * ідентичні PATCH-запити на кожну паузу в наборі тексту.
   */
  const castSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const castRef = useRef(cast);
  castRef.current = cast;
  const heroArcRef = useRef(heroArc);
  heroArcRef.current = heroArc;

  const persistCast = useCallback(
    (id: string) =>
      api(`/api/express/draft/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payload: { cast: castRef.current, heroArc: heroArcRef.current } }),
      }).catch(() => {
        /* чернетка — не критично, наступна успішна правка перезапише */
      }),
    []
  );

  useEffect(() => {
    if (!draft || step < 3) return;
    if (castSaveTimer.current) clearTimeout(castSaveTimer.current);
    castSaveTimer.current = setTimeout(() => void persistCast(draft.id), 600);
    return () => {
      if (castSaveTimer.current) clearTimeout(castSaveTimer.current);
    };
  }, [cast, heroArc, draft, step, persistCast]);

  /**
   * Кроки Е4/Е5 читають каст із СЕРВЕРНОЇ чернетки (synopsisPrompt,
   * partPrompt), а не з локального стану клієнта — тож перехід «Далі»
   * одразу після правки касту мусить дочекатись збереження, інакше AI
   * дописуватиме синопсис за іменами, які письменник щойно змінив.
   */
  async function flushCastSave(draftId: string) {
    if (castSaveTimer.current) clearTimeout(castSaveTimer.current);
    await persistCast(draftId);
  }

  function updateCastMember(index: number, patch: Partial<CastMember>) {
    setCast((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  /**
   * Довільний текст ролі завжди лишається джерелом істини; номер патерну —
   * лише підказка, яку скидаємо, щойно текст перестає збігатися з
   * канонічною назвою. Інакше картка могла б показувати «№33» поруч із
   * роллю, яку письменник насправді вже переписав на свою.
   */
  function updateCastRoleText(index: number, text: string) {
    const match = POLTI_PATTERNS.find((p) => p.name === text.trim());
    updateCastMember(index, { poltiRoleName: text, poltiPatternId: match?.id });
  }

  function applyPoltiPreset(index: number, patternId: number) {
    const pattern = POLTI_PATTERNS.find((p) => p.id === patternId);
    if (!pattern) return;
    updateCastMember(index, { poltiPatternId: pattern.id, poltiRoleName: pattern.name });
  }

  /** Новий герой власного вигаду — ім'я й роль порожні, письменник заповнює сам. */
  function addOwnCharacter() {
    setCast((prev) => [...prev, { firstName: '', lastName: '', poltiRoleName: '' }]);
  }

  async function saveSynopsis() {
    if (!draft) return;
    setBusy('save-synopsis');
    try {
      const d = await api<Draft>(`/api/express/draft/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payload: { synopsis }, step: 4 }),
      });
      setDraft(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const words = synopsis.trim() ? synopsis.trim().split(/\s+/).length : 0;
  const chapters = parts.reduce((s, p) => s + (p.chapters?.length ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <Wand2 className="w-5 h-5" />
          <span className="font-mono text-xs font-bold tracking-widest uppercase">Книга за 5 хвилин</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-slate-100">Експрес-майстер</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
          Опишіть задум одним реченням. Далі студія пропонує — ви приймаєте або міняєте. Наприкінці
          отримаєте готовий план: частини, глави, героїв і звʼязки між ними.
        </p>
      </header>

      {/* Смуга кроків */}
      <ol className="mb-6 flex flex-wrap items-center gap-1.5">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const active = n === step;
          return (
            <li key={label} className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!draft || n > step}
                onClick={() => void goTo(n)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'badge-glass text-emerald-400'
                    : done
                      ? 'text-emerald-400 hover:bg-white/[0.04]'
                      : 'text-slate-500'
                } ${!draft || n > step ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px] font-mono">
                  {done ? <Check className="h-3 w-3" /> : n}
                </span>
                {label}
              </button>
              {n < STEPS.length && <span className="text-slate-700">·</span>}
            </li>
          );
        })}
      </ol>

      {engines.length === 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Немає жодного налаштованого рушія ШІ. Додайте власний ключ у розділі «Ключі API» — без
            нього майстер не зможе нічого запропонувати.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Крок Е1 — зерно задуму */}
      {step === 1 && (
        <section className="glass-panel rounded-2xl p-6">
          <label className="mb-1.5 block text-sm font-semibold text-slate-200">
            Про що ваша книга?
          </label>
          <textarea
            value={seed}
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
              onClick={() => void startWizard()}
              disabled={seed.trim().length < 20 || busy !== null || engines.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Почати
            </button>
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
              onClick={() => draft && void suggest(draft.id, 'framework')}
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
                key={f.id}
                type="button"
                onClick={() => setFramework(f.id)}
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

          <StepNav onBack={() => setStep(1)} onNext={() => void goTo(3)} nextDisabled={!framework || busy !== null} />
        </section>
      )}

      {/* Крок Е3 — каст */}
      {step === 3 && (
        <section className="glass-panel rounded-2xl p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100">Герої та звʼязки</h2>
              <p className="mt-1 text-sm text-slate-400">
                Ведичні ролі не повторюються, а патерни Польті підібрані парами — саме з них потім
                росте граф конфліктів.
              </p>
            </div>
            <button
              type="button"
              onClick={() => draft && void suggest(draft.id, 'cast')}
              disabled={busy !== null}
              className="shrink-0 rounded-lg border border-white/15 p-2 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
              title="Запропонувати інший каст"
            >
              {busy === 'cast' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

          {busy === 'cast' && cast.length === 0 ? (
            <Waiting label="Придумую героїв…" />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {cast.map((c, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* Ім'я — редаговане: майстер лише пропонує, письменник
                        може перейменувати героя, не чекаючи перегенерації
                        всього касту. */}
                    <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0">
                      <input
                        value={c.firstName}
                        onChange={(e) => updateCastMember(i, { firstName: e.target.value })}
                        placeholder="Ім'я"
                        className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                      />
                      <input
                        value={c.lastName}
                        onChange={(e) => updateCastMember(i, { lastName: e.target.value })}
                        placeholder="Прізвище"
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
                      placeholder="Своя роль або оберіть із 36 типів нижче…"
                      className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
                    />
                    <select
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
                    </select>
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

          {/* Крива головного героя — заповнюється тут-таки, поки протагоніст
              і решта касту вже перед очима. Той самий стан переноситься в
              книгу разом з рештою плану (App.tsx::applyExpressPlan). */}
          {cast.length > 0 && (
            <div className="mt-4">
              <HeroArcPanel value={heroArc} onChange={setHeroArc} heroName={`${cast[0].firstName} ${cast[0].lastName}`.trim()} />
            </div>
          )}

          <StepNav
            onBack={() => setStep(2)}
            onNext={() => void goTo(4)}
            nextDisabled={
              cast.length === 0 ||
              busy !== null ||
              cast.some((c) => !c.firstName.trim() || !c.poltiRoleName?.trim())
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
              onClick={() => draft && void suggest(draft.id, 'synopsis')}
              disabled={busy !== null}
              className="shrink-0 rounded-lg border border-white/15 p-2 text-slate-300 hover:bg-white/[0.06] disabled:opacity-40"
              title="Переписати"
            >
              {busy === 'synopsis' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

          {busy === 'synopsis' && !synopsis ? (
            <Waiting label="Пишу синопсис…" />
          ) : (
            <>
              <textarea
                value={synopsis}
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

          <StepNav onBack={() => setStep(3)} onNext={() => void goTo(5)} nextDisabled={!synopsis || busy !== null} />
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
                      {ch.summary && <p className="mt-1 text-xs leading-relaxed text-slate-400">{ch.summary}</p>}
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

          {parts.length === TOTAL_PARTS && busy === null && (
            <button
              type="button"
              onClick={() =>
                onFinish?.({
                  seed,
                  genre,
                  framework,
                  natureConnection: nature,
                  archetypes36: archetypes,
                  cast,
                  heroArc,
                  synopsis,
                  parts,
                })
              }
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400"
            >
              <BookOpen className="h-4 w-4" />
              Почати писати
            </button>
          )}
        </section>
      )}
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
