/**
 * Адаптер Jev (TypeSafe, System One) — Т1.6, ТЗ Harness + Jev §6; з Т2.5 В1
 * живе тут, у `server/ai/adapters/jev` (ТЗ-H §7.2), а `server/core/flc/jev.ts`
 * реекспортує звідси.
 *
 * Звірено з офіційною документацією 25.09.2026 (docs.typesafe.ai):
 *   • REST: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`;
 *   • тіло: `{ state, model, questions: { <id>: { type, instructions, criteria } } }`;
 *     choice — `criteria` мапа «варіант → опис» (≤255), score — упорядкований
 *     масив рівнів (2–10), noul — так/ні (без `criteria`);
 *   • відповідь: `{ model: "jev-1.13.0", answers: { <id>: … }, usage }`; choice —
 *     `choice`, `probabilities`, `confidence`; score — `score` (зважена
 *     позиція 0…N-1), `legend`, `probabilities`, `confidence`;
 *   • модель закріплено: `jev-1.13.0` (аліас `jev-latest` може змінитись);
 *   • ліміти: 64k токенів на запит (32k — стан + найдовше питання), 1200
 *     запитів/хв; ціна — $0.042 за 1 млн вхідних токенів, вихідні безкоштовні;
 *   • помилки: 401, 422, 429 і 529 (повтор з відступом).
 * Офіційний JS SDK (`@typesafe-ai/sdk` 0.6.0) свідомо не підключено: REST —
 * один запит, а версійні відмінності ізолюються тут, в адаптері.
 *
 * Noul (Т2.5 В1): відповідь нормалізується в імовірність «так» 0–1
 * (`checks`) із будь-якої з форм, які може дати провайдер (`probability`,
 * `probabilities.yes|true`, `score` 0–1, `answer`/`value` так/ні +
 * `confidence`). Точну форму ще не звірено справжнім ключем — у хмарі немає
 * мережі до TypeSafe (відкрите питання №1 звіту Т1.6); різниця ізольована
 * тут, у `noulProbability`.
 *
 * Значення Jev — модельні евристики, не психологічний діагноз і не доказ
 * істини у світі книги (ТЗ-H §2). Серверний валідатор перевіряє, що обрана
 * дія — з дозволеного списку; інакше — найімовірніша дозволена, з позначкою.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { CharacterSnapshot, DecisionResult, JevQuestion } from '../../contracts';
import { canonicalJson, snapshotHash } from '../../contracts';
import { parseModelJson } from '../../../core/ai/schema';

export type { JevQuestion } from '../../contracts';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.13.0';
/** USD за 1 млн вхідних токенів (docs.typesafe.ai/models, 25.09.2026). */
export const JEV_USD_PER_MTOK = 0.042;

/**
 * Змінні оточення, з яких береться ключ Jev, коли адміністратор не ввів його
 * в панелі «Ключі API». `JEV_API_KEY` — історична назва (її вживають локальні
 * та Railway-конфігурації цього проєкту), `TYPESAFE_API_KEY` — назва
 * провайдера. Обидві читаються одним кодом, тож ключ можна покласти в будь-яку.
 */
export const JEV_ENV_KEYS = ['JEV_API_KEY', 'TYPESAFE_API_KEY'] as const;

/** Ключ Jev зі змінних оточення — перший непорожній із `JEV_ENV_KEYS`. */
export function jevKeyFromEnv(): string | undefined {
  for (const name of JEV_ENV_KEYS) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Модель Jev зі змінної оточення; без неї — закріплена константа. */
export function jevModelFromEnv(): string {
  return process.env.TYPESAFE_JEV_MODEL?.trim() || JEV_MODEL;
}

export interface JevAdapter {
  readonly name: 'jev' | 'mock' | 'llm_fallback';
  /** Оцінити знімок атомарними питаннями. Головний вибір — `next_action`, а без нього — перше питання choice. */
  evaluate(snapshot: CharacterSnapshot, questions: JevQuestion[], opts?: { signal?: AbortSignal }): Promise<DecisionResult>;
  /**
   * Т5.5: ті самі питання над довільним станом процесу ШІ (не лише знімком
   * героя). Відповіді — у формі провайдера (`answers`), нормалізує рушій.
   */
  askState?(state: Record<string, unknown>, questions: JevQuestion[], opts?: { signal?: AbortSignal }): Promise<JevRawAnswer>;
}

/** Сира відповідь Jev над станом (Т5.5): відповіді за id питань, модель, витрата. */
export interface JevRawAnswer {
  answers: Record<string, any>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}

export class JevError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = 'JevError';
  }
}

/** Питання «наступна дія» (Choice) і «сила страху» (Score) — мінімум для критерію ТЗ-H №2. */
export function interrogationQuestions(allowed: string[]): JevQuestion[] {
  const describe: Record<string, string> = {
    answer: 'відповісти чесно',
    lie: 'збрехати',
    silence: 'промовчати',
    deflect: 'ухилитися, змінити тему',
    attack: 'перейти в наступ',
    confess: 'зізнатися',
  };
  return [
    {
      id: 'next_action',
      kind: 'choice',
      instructions: 'Яку дію з дозволеного списку обере персонаж у цій ситуації, зважаючи лише на наданий стан?',
      options: Object.fromEntries(allowed.map((a) => [a, describe[a] ?? null])),
    },
    {
      id: 'fear_intensity',
      kind: 'score',
      instructions: 'Наскільки сильний страх персонажа в цій ситуації?',
      levels: ['спокій, страху немає', 'легке занепокоєння', 'помітний страх, але контроль', 'сильний страх, контроль слабне', 'паніка'],
    },
  ];
}

/** Стан для Jev — компактний знімок без зайвого (ліміт 32k на стан). */
export function jevState(s: CharacterSnapshot): Record<string, unknown> {
  return {
    character: s.name,
    situation: s.situation,
    canon: s.canon.slice(0, 20).map((c) => `${c.label}: ${c.value}`),
    confirmed_facts: s.confirmed_facts.slice(0, 30).map((f) => f.statement),
    current_states: s.current_states.map((x) => `${x.type}: ${x.name}`),
    relations: s.relations.map((r) => (r.direction === 'out' ? `${s.name} → ${r.label} → ${r.other}` : `${r.other} → ${r.label} → ${s.name}`)),
    recent_text: s.recent_appearances.slice(-6).map((a) => a.excerpt),
    // Т2.6 В5: пам'ять героя — лише коли є (знімки без неї не змінюються).
    ...(s.beliefs?.length ? { beliefs: s.beliefs.map((b) => (b.certainty === 'doubts' ? `(сумнівається) ${b.statement}` : b.statement)) } : {}),
    ...(s.memories?.length ? { memories: s.memories.map((m) => `${m.type}: ${m.content}`) } : {}),
  };
}

/** Серверний валідатор дії: лише дозволене; інакше — найімовірніша дозволена. */
export function enforceAllowed(selected: string, dist: Record<string, number> | undefined, allowed: string[]): { action: string; corrected: boolean } {
  if (allowed.includes(selected)) return { action: selected, corrected: false };
  const best = Object.entries(dist ?? {})
    .filter(([k]) => allowed.includes(k))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return { action: best ?? allowed[0], corrected: true };
}

/** Score Jev (позиція 0…N-1) → шкала 0–10, як у ТЗ-H («рубрика 0–10»). */
export const toTen = (score: number, levels: number) => Math.round((score / Math.max(1, levels - 1)) * 100) / 10;

/** Noul: будь-яка з форм відповіді провайдера → імовірність «так» 0–1; null — не розпізнано. */
export function noulProbability(a: any): number | null {
  const clamp = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000;
  if (!a || typeof a !== 'object') return null;
  if (typeof a.probability === 'number') return clamp(a.probability);
  const p = a.probabilities;
  if (p && typeof p === 'object') {
    const yes = p.yes ?? p.true ?? p.Yes ?? p['1'];
    if (typeof yes === 'number') return clamp(yes);
  }
  if (typeof a.score === 'number' && a.score >= 0 && a.score <= 1) return clamp(a.score);
  const v = a.answer ?? a.value ?? a.noul;
  if (typeof v === 'boolean' || v === 'yes' || v === 'no') {
    const yes = v === true || v === 'yes';
    const c = typeof a.confidence === 'number' ? clamp(a.confidence) : 1;
    return clamp(yes ? c : 1 - c);
  }
  return null;
}

/** Головне питання вибору: `next_action`, а без нього — перше choice. */
export const primaryChoice = (questions: JevQuestion[]) =>
  questions.find((q) => q.kind === 'choice' && q.id === 'next_action') ?? questions.find((q) => q.kind === 'choice');

export function normalize(
  source: DecisionResult['source'],
  s: CharacterSnapshot,
  questions: JevQuestion[],
  answers: Record<string, any>,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
  started: number,
): DecisionResult {
  const scores: Record<string, number> = {};
  const raw: Record<string, Record<string, number>> = {};
  const checks: Record<string, number> = {};
  const choices: Record<string, string> = {};
  const primary = primaryChoice(questions);
  let selected = '';
  let confidence: number | null = null;
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    if (a.probabilities && q.kind !== 'noul') raw[q.id] = a.probabilities;
    if (q.kind === 'choice') {
      if (q === primary) {
        selected = String(a.choice ?? '');
        confidence = typeof a.confidence === 'number' ? a.confidence : null;
      } else {
        // Інший вибір рівня (напр. траєкторія): теж лише з його варіантів.
        const c = String(a.choice ?? '');
        const opts = Object.keys(q.options);
        choices[q.id] = enforceAllowed(c, raw[q.id], opts).action;
      }
    }
    if (q.kind === 'score' && typeof a.score === 'number') scores[q.id] = toTen(a.score, q.levels.length);
    if (q.kind === 'noul') {
      const p = noulProbability(a);
      if (p !== null) checks[q.id] = Math.round(p * 1000) / 1000;
    }
  }
  const allowed = primary?.kind === 'choice' && primary.id !== 'next_action' ? Object.keys(primary.options) : s.allowed_actions;
  const { action, corrected } = primary ? enforceAllowed(selected, raw[primary.id], allowed) : { action: '', corrected: false };
  return {
    selected_action: action,
    scores,
    raw_distributions: raw,
    confidence,
    model_version: model,
    snapshot_hash: snapshotHash(s),
    decision_trace_id: randomUUID(),
    source,
    corrected,
    usage,
    latency_ms: Date.now() - started,
    ...(Object.keys(checks).length ? { checks } : {}),
    ...(Object.keys(choices).length ? { choices } : {}),
  };
}

/** Справжній Jev через REST. */
export class HttpJevAdapter implements JevAdapter {
  readonly name = 'jev' as const;
  constructor(
    private readonly apiKey: string,
    private readonly opts: { model?: string; endpoint?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async evaluate(snapshot: CharacterSnapshot, questions: JevQuestion[], opts: { signal?: AbortSignal } = {}): Promise<DecisionResult> {
    const started = Date.now();
    const raw = await this.request(jevState(snapshot), questions, opts);
    return normalize('jev', snapshot, questions, raw.answers, raw.model, raw.usage, started);
  }

  async askState(state: Record<string, unknown>, questions: JevQuestion[], opts: { signal?: AbortSignal } = {}): Promise<JevRawAnswer> {
    return this.request(state, questions, opts);
  }

  private async request(state: Record<string, unknown>, questions: JevQuestion[], opts: { signal?: AbortSignal }): Promise<JevRawAnswer> {
    const started = Date.now();
    const body = {
      model: this.opts.model ?? JEV_MODEL,
      state,
      questions: Object.fromEntries(
        questions.map((q) => [
          q.id,
          q.kind === 'choice'
            ? { type: 'choice', instructions: q.instructions, criteria: q.options }
            : q.kind === 'score'
              ? { type: 'score', instructions: q.instructions, criteria: q.levels }
              : { type: 'noul', instructions: q.instructions },
        ]),
      ),
    };
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 15_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(this.opts.endpoint ?? JEV_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new JevError(`Jev недоступний: ${(err as Error).message}`, null, true);
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      throw new JevError(`Jev ${res.status}: ${json?.error?.message ?? json?.detail ?? 'помилка'}`, res.status, retryable);
    }
    return {
      answers: json.answers ?? {},
      model: String(json.model ?? body.model),
      usage: { input_tokens: Number(json.usage?.input_tokens) || 0, output_tokens: Number(json.usage?.output_tokens) || 0 },
      latency_ms: Date.now() - started,
    };
  }
}

/**
 * Підставний Jev (з першого дня, ТЗ Т1.6): детерміновано від відбитка знімка,
 * з формою відповіді справжнього Jev. Для тестів і розробки без ключа.
 */
export class MockJevAdapter implements JevAdapter {
  readonly name = 'mock' as const;
  async evaluate(snapshot: CharacterSnapshot, questions: JevQuestion[]): Promise<DecisionResult> {
    const started = Date.now();
    const answers = mockAnswers(snapshotHash(snapshot), questions);
    return normalize('mock', snapshot, questions, answers, 'mock-jev-0', { input_tokens: 0, output_tokens: 0 }, started);
  }

  /** Т5.5: детерміновано від відбитка стану процесу. */
  async askState(state: Record<string, unknown>, questions: JevQuestion[]): Promise<JevRawAnswer> {
    const h = createHash('sha256').update(canonicalJson({ state, questions })).digest('hex');
    return { answers: mockAnswers(h, questions), model: 'mock-jev-0', usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0 };
  }
}

/** Відповіді підставного Jev із відбитка (форма справжнього Jev). */
function mockAnswers(h: string, questions: JevQuestion[]): Record<string, any> {
  const seed = (i: number) => parseInt(h.slice(i * 4, i * 4 + 4), 16) / 0xffff;
  const answers: Record<string, any> = {};
  questions.forEach((q, qi) => {
    if (q.kind === 'choice') {
      const keys = Object.keys(q.options);
      const w = keys.map((_, i) => 0.2 + seed((qi + i) % 8));
      const sum = w.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, Math.round((w[i] / sum) * 1000) / 1000]));
      const choice = keys[w.indexOf(Math.max(...w))];
      answers[q.id] = { type: 'choice', choice, probabilities, confidence: Math.round((Math.max(...w) / sum) * 100) / 100 };
    } else if (q.kind === 'noul') {
      answers[q.id] = { type: 'noul', probability: Math.round(seed(qi) * 1000) / 1000, confidence: 0.5 };
    } else {
      const level = Math.floor(seed(qi) * q.levels.length) % q.levels.length;
      answers[q.id] = { type: 'score', score: level, probabilities: Object.fromEntries(q.levels.map((_, i) => [String(i), i === level ? 1 : 0])), confidence: 0.5 };
    }
  });
  return answers;
}

import type { LlmJson } from '../llm';
export type { LlmJson } from '../llm';

/**
 * Запасний шлях (ТЗ-H №9): Jev недоступний — ті самі питання ставляться LLM зі
 * структурованою відповіддю; результат у тій самій формі, з `source:
 * llm_fallback` і без confidence (LLM його чесно не дає).
 */
export class LlmFallbackJevAdapter implements JevAdapter {
  readonly name = 'llm_fallback' as const;
  constructor(private readonly llm: LlmJson) {}
  async evaluate(snapshot: CharacterSnapshot, questions: JevQuestion[]): Promise<DecisionResult> {
    const started = Date.now();
    const raw = await this.ask(jevState(snapshot), questions, 'Ти оцінюєш стан персонажа книги за наданим знімком. Відповідай ЛИШЕ JSON без пояснень. Не вигадуй фактів поза знімком.');
    return normalize('llm_fallback', snapshot, questions, raw.answers, raw.model, raw.usage, started);
  }

  /** Т5.5: ті самі питання над станом процесу ШІ. */
  async askState(state: Record<string, unknown>, questions: JevQuestion[]): Promise<JevRawAnswer> {
    return this.ask(state, questions, 'Ти ухвалюєш типізоване рішення над наданим станом процесу. Відповідай ЛИШЕ JSON без пояснень. Не вигадуй фактів поза станом.');
  }

  private async ask(state: Record<string, unknown>, questions: JevQuestion[], system: string): Promise<JevRawAnswer & { costUsd?: number }> {
    const started = Date.now();
    const user = [
      `Стан:\n${JSON.stringify(state, null, 1)}`,
      ...questions.map((q) =>
        q.kind === 'choice'
          ? `Питання "${q.id}" (вибір): ${q.instructions}\nВаріанти: ${Object.keys(q.options).join(', ')}`
          : q.kind === 'score'
            ? `Питання "${q.id}" (оцінка): ${q.instructions}\nРівні 0…${q.levels.length - 1}: ${q.levels.map((l, i) => `${i} — ${l}`).join('; ')}`
            : `Питання "${q.id}" (так / ні): ${q.instructions}\nВідповідь — імовірність «так» від 0 до 1.`,
      ),
      `Формат: {"answers": {"<id питання>": {"choice": "<варіант>"} або {"score": <число рівня>} або {"probability": <0…1>}}}`,
    ].join('\n\n');
    const out = await this.llm(system, user);
    const parsed: any = parseModelJson(out.text);
    const answers: Record<string, any> = {};
    for (const q of questions) {
      const a = parsed?.answers?.[q.id];
      if (!a) continue;
      if (q.kind === 'choice') answers[q.id] = { choice: String(a.choice ?? '') };
      else if (q.kind === 'noul') {
        const p = Number(a.probability);
        if (Number.isFinite(p)) answers[q.id] = { probability: p };
      }
      else if (Number.isFinite(Number(a.score))) answers[q.id] = { score: Math.max(0, Math.min(q.levels.length - 1, Number(a.score))) };
    }
    return { answers, model: `llm:${out.modelId}`, usage: { input_tokens: out.inputTokens, output_tokens: out.outputTokens }, latency_ms: Date.now() - started, ...(typeof out.costUsd === 'number' ? { costUsd: out.costUsd } : {}) };
  }
}

/**
 * Jev із запасним шляхом: помилка Jev (мережа, 429/529, 5xx, таймаут, а також
 * 401/422 — налаштування) не зупиняє цикл, а переводить його на LLM; причину
 * повернуто разом із результатом.
 */
export async function evaluateWithFallback(
  primary: JevAdapter | null,
  fallback: JevAdapter,
  snapshot: CharacterSnapshot,
  questions: JevQuestion[],
): Promise<{ decision: DecisionResult; fallbackReason: string | null }> {
  if (primary) {
    try {
      return { decision: await primary.evaluate(snapshot, questions), fallbackReason: null };
    } catch (err) {
      return { decision: await fallback.evaluate(snapshot, questions), fallbackReason: (err as Error).message };
    }
  }
  return { decision: await fallback.evaluate(snapshot, questions), fallbackReason: 'Jev не налаштовано (немає ключа TypeSafe)' };
}
