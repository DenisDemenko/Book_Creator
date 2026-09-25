/**
 * Адаптер Jev (TypeSafe, System One) — Т1.6, ТЗ Harness + Jev §6.
 *
 * Звірено з офіційною документацією 25.09.2026 (docs.typesafe.ai):
 *   • REST: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`;
 *   • тіло: `{ state, model, questions: { <id>: { type, instructions, criteria } } }`;
 *     choice — `criteria` мапа «варіант → опис» (≤255), score — упорядкований
 *     масив рівнів (2–10), noul — так/ні;
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
 * Значення Jev — модельні евристики, не психологічний діагноз і не доказ
 * істини у світі книги (ТЗ-H §2). Серверний валідатор перевіряє, що обрана
 * дія — з дозволеного списку; інакше — найімовірніша дозволена, з позначкою.
 */

import { randomUUID } from 'node:crypto';
import type { CharacterSnapshot, DecisionResult } from './contracts';
import { snapshotHash } from './contracts';
import { parseModelJson } from '../ai/schema';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-1.13.0';
/** USD за 1 млн вхідних токенів (docs.typesafe.ai/models, 25.09.2026). */
export const JEV_USD_PER_MTOK = 0.042;

/** Питання до Jev у нашому форматі (не формат провайдера). */
export type JevQuestion =
  | { id: string; kind: 'choice'; instructions: string; options: Record<string, string | null> }
  | { id: string; kind: 'score'; instructions: string; levels: string[] };

export interface JevAdapter {
  readonly name: 'jev' | 'mock' | 'llm_fallback';
  evaluate(snapshot: CharacterSnapshot, questions: JevQuestion[], opts?: { signal?: AbortSignal }): Promise<DecisionResult>;
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

function normalize(
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
  let selected = '';
  let confidence: number | null = null;
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    if (a.probabilities) raw[q.id] = a.probabilities;
    if (q.kind === 'choice' && q.id === 'next_action') {
      selected = String(a.choice ?? '');
      confidence = typeof a.confidence === 'number' ? a.confidence : null;
    }
    if (q.kind === 'score' && typeof a.score === 'number') scores[q.id] = toTen(a.score, q.levels.length);
  }
  const { action, corrected } = enforceAllowed(selected, raw.next_action, s.allowed_actions);
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
    const body = {
      model: this.opts.model ?? JEV_MODEL,
      state: jevState(snapshot),
      questions: Object.fromEntries(
        questions.map((q) => [
          q.id,
          q.kind === 'choice' ? { type: 'choice', instructions: q.instructions, criteria: q.options } : { type: 'score', instructions: q.instructions, criteria: q.levels },
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
    return normalize('jev', snapshot, questions, json.answers ?? {}, String(json.model ?? body.model), {
      input_tokens: Number(json.usage?.input_tokens) || 0,
      output_tokens: Number(json.usage?.output_tokens) || 0,
    }, started);
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
    const h = snapshotHash(snapshot);
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
      } else {
        const level = Math.floor(seed(qi) * q.levels.length) % q.levels.length;
        answers[q.id] = { type: 'score', score: level, probabilities: Object.fromEntries(q.levels.map((_, i) => [String(i), i === level ? 1 : 0])), confidence: 0.5 };
      }
    });
    return normalize('mock', snapshot, questions, answers, 'mock-jev-0', { input_tokens: 0, output_tokens: 0 }, started);
  }
}

/** Виклик LLM для запасного шляху — той самий, що в ролях AI (`aiRoleGenerateViaCore`). */
export type LlmJson = (system: string, user: string) => Promise<{ text: string; modelId: string; inputTokens: number; outputTokens: number }>;

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
    const system = 'Ти оцінюєш стан персонажа книги за наданим знімком. Відповідай ЛИШЕ JSON без пояснень. Не вигадуй фактів поза знімком.';
    const user = [
      `Стан:\n${JSON.stringify(jevState(snapshot), null, 1)}`,
      ...questions.map((q) =>
        q.kind === 'choice'
          ? `Питання "${q.id}" (вибір): ${q.instructions}\nВаріанти: ${Object.keys(q.options).join(', ')}`
          : `Питання "${q.id}" (оцінка): ${q.instructions}\nРівні 0…${q.levels.length - 1}: ${q.levels.map((l, i) => `${i} — ${l}`).join('; ')}`,
      ),
      `Формат: {"answers": {"<id питання>": {"choice": "<варіант>"} або {"score": <число рівня>}}}`,
    ].join('\n\n');
    const out = await this.llm(system, user);
    const parsed: any = parseModelJson(out.text);
    const answers: Record<string, any> = {};
    for (const q of questions) {
      const a = parsed?.answers?.[q.id];
      if (!a) continue;
      if (q.kind === 'choice') answers[q.id] = { choice: String(a.choice ?? '') };
      else if (Number.isFinite(Number(a.score))) answers[q.id] = { score: Math.max(0, Math.min(q.levels.length - 1, Number(a.score))) };
    }
    return normalize('llm_fallback', snapshot, questions, answers, `llm:${out.modelId}`, { input_tokens: out.inputTokens, output_tokens: out.outputTokens }, started);
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
