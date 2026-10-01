/**
 * Виміри якості «живих персонажів» (Т2.8 В1, `PLAN_QUALITY.md`) — чисті
 * функції над ходами прогону, без моделі (рішення власника §2 п.1: ізоляція,
 * спойлери, пам'ять і різноманітність — правилами; характер і стиль — Jev,
 * В2).
 *
 *   ізоляція     — частка ходів, де приватне іншого героя з'явилось у запиті
 *                  до голосу, у стані для Jev чи у відповіді;
 *   спойлери     — те саме для майбутнього після межі знань;
 *   пам'ять      — частка кейсів пам'яті, де прозвучало очікуване;
 *   різноманітність — різні дії Jev, частка унікальних біграм, повтори;
 *   сталість     — частка пар перефразувань з однаковою дією;
 *   час і вартість — затримка ходу (середня, p95), токени й $ голосу та
 *                  рішень, частка запасного шляху.
 */

import type { QualityGates } from './controlSet';
import type { DecisionTotals, QualityMode, QualityTurn } from './livingCharacters';

export interface LeakStat {
  checked: number;
  leaks: number;
  rate: number;
  examples: string[];
}

export interface QualityMetrics {
  turns: number;
  answered: number;
  failed: number;
  isolation: LeakStat;
  spoilers: LeakStat;
  memory: { cases: number; hits: number; accuracy: number | null; misses: string[] };
  diversity: { distinctActions: number; actions: Record<string, number>; distinctBigramRatio: number | null; repetitionRate: number | null };
  consistency: { pairs: number; consistent: number; rate: number | null; details: { pair: string; actions: (string | null)[] }[] };
  performance: {
    latencyAvgMs: number;
    latencyP95Ms: number;
    voiceInputTokens: number;
    voiceOutputTokens: number;
    voiceCostUsd: number;
    decisionCalls: number;
    decisionInputTokens: number;
    decisionOutputTokens: number;
    decisionCostUsd: number;
    fallbackShare: number | null;
    totalCostUsd: number;
    costPerTurnUsd: number;
  };
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const norm = (s: string) => s.toLowerCase().replace(/[’ʼ`]/g, "'");
const words = (s: string) => norm(s).match(/[\p{L}\p{N}']+/gu) ?? [];

function leaks(turns: QualityTurn[], pick: (t: QualityTurn) => string[]): LeakStat {
  const out: LeakStat = { checked: 0, leaks: 0, rate: 0, examples: [] };
  for (const t of turns) {
    const phrases = pick(t).map(norm).filter(Boolean);
    if (!phrases.length) continue;
    out.checked++;
    const where: [string, string][] = [
      ...t.seen.prompts.map((p) => ['запит голосу', p] as [string, string]),
      ...t.seen.jevStates.map((p) => ['стан Jev', p] as [string, string]),
      ['відповідь', t.reply],
    ];
    const hit = phrases.flatMap((ph) => where.filter(([, text]) => norm(text).includes(ph)).map(([w]) => `${t.caseId}: «${ph}» — ${w}`));
    if (hit.length) {
      out.leaks++;
      if (out.examples.length < 10) out.examples.push(...hit.slice(0, 10 - out.examples.length));
    }
  }
  out.rate = out.checked ? round(out.leaks / out.checked) : 0;
  return out;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export function computeMetrics(turns: QualityTurn[], decisions: DecisionTotals): QualityMetrics {
  const answered = turns.filter((t) => t.status === 'answered');
  // Пам'ять.
  const memCases = turns.filter((t) => t.dimension === 'memory');
  let hits = 0;
  const misses: string[] = [];
  for (const t of memCases) {
    const exp = t.expect.map(norm);
    if (t.status === 'answered' && exp.some((e) => norm(t.reply).includes(e))) hits++;
    else misses.push(t.caseId);
  }
  // Різноманітність.
  const actions: Record<string, number> = {};
  for (const t of answered) if (t.action) actions[t.action] = (actions[t.action] ?? 0) + 1;
  const bigrams: string[] = [];
  for (const t of answered) {
    const w = words(t.reply);
    for (let i = 0; i + 1 < w.length; i++) bigrams.push(`${w[i]} ${w[i + 1]}`);
  }
  const replies = answered.map((t) => words(t.reply).join(' ')).filter(Boolean);
  const counts = new Map<string, number>();
  for (const r of replies) counts.set(r, (counts.get(r) ?? 0) + 1);
  const repeated = replies.filter((r) => (counts.get(r) ?? 0) > 1).length;
  // Сталість: пари перефразувань — та сама дія.
  const groups = new Map<string, QualityTurn[]>();
  for (const t of turns) if (t.pair) groups.set(t.pair, [...(groups.get(t.pair) ?? []), t]);
  const details = [...groups.entries()].map(([pair, ts]) => ({ pair, actions: ts.map((t) => (t.status === 'answered' ? t.action : null)) }));
  const judged = details.filter((d) => d.actions.length >= 2 && d.actions.every(Boolean));
  const consistent = judged.filter((d) => new Set(d.actions).size === 1).length;
  // Час і вартість.
  const lat = turns.map((t) => t.latencyMs);
  const voiceCost = turns.reduce((a, t) => a + t.voice.costUsd, 0);
  const fallbackTurns = answered.filter((t) => t.source === 'llm_fallback').length;
  const totalCost = voiceCost + decisions.costUsd;
  return {
    turns: turns.length,
    answered: answered.length,
    failed: turns.length - answered.length,
    isolation: leaks(turns, (t) => t.forbidden.secret),
    spoilers: leaks(turns, (t) => t.forbidden.future),
    memory: { cases: memCases.length, hits, accuracy: memCases.length ? round(hits / memCases.length) : null, misses },
    diversity: {
      distinctActions: Object.keys(actions).length,
      actions,
      distinctBigramRatio: bigrams.length ? round(new Set(bigrams).size / bigrams.length) : null,
      repetitionRate: replies.length ? round(repeated / replies.length) : null,
    },
    consistency: { pairs: judged.length, consistent, rate: judged.length ? round(consistent / judged.length) : null, details },
    performance: {
      latencyAvgMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0,
      latencyP95Ms: percentile(lat, 95),
      voiceInputTokens: turns.reduce((a, t) => a + t.voice.inputTokens, 0),
      voiceOutputTokens: turns.reduce((a, t) => a + t.voice.outputTokens, 0),
      voiceCostUsd: round(voiceCost, 6),
      decisionCalls: decisions.calls,
      decisionInputTokens: decisions.inputTokens,
      decisionOutputTokens: decisions.outputTokens,
      decisionCostUsd: decisions.costUsd,
      fallbackShare: answered.length ? round(fallbackTurns / answered.length) : null,
      totalCostUsd: round(totalCost, 6),
      costPerTurnUsd: turns.length ? round(totalCost / turns.length, 6) : 0,
    },
  };
}

export interface GateResult {
  id: string;
  title: string;
  /** hard — для кожного режиму; quality — лише для головного (з Jev). */
  kind: 'hard' | 'quality';
  value: number | null;
  limit: string;
  passed: boolean;
}

export function evaluateGates(g: QualityGates, m: QualityMetrics, mode: QualityMode): GateResult[] {
  const out: GateResult[] = [
    { id: 'answered', title: 'усі кейси з відповіддю', kind: 'hard', value: m.answered, limit: `= ${m.turns}`, passed: m.answered === m.turns },
    { id: 'isolation', title: 'витоки чужого приватного', kind: 'hard', value: m.isolation.leaks, limit: `≤ ${g.isolationLeaksMax}`, passed: m.isolation.leaks <= g.isolationLeaksMax },
    { id: 'spoilers', title: 'витоки майбутнього', kind: 'hard', value: m.spoilers.leaks, limit: `≤ ${g.spoilerLeaksMax}`, passed: m.spoilers.leaks <= g.spoilerLeaksMax },
  ];
  if (mode === 'with_jev') {
    const q = (id: string, title: string, value: number | null, limit: string, ok: (v: number) => boolean): GateResult => ({ id, title, kind: 'quality', value, limit, passed: value != null && ok(value) });
    out.push(
      q('memory', 'точність пам\'яті', m.memory.accuracy, `≥ ${g.memoryAccuracyMin}`, (v) => v >= g.memoryAccuracyMin),
      q('diversity', 'різних дій', m.diversity.distinctActions, `≥ ${g.distinctActionsMin}`, (v) => v >= g.distinctActionsMin),
      q('repetition', 'частка повторів відповіді', m.diversity.repetitionRate, `≤ ${g.repetitionMax}`, (v) => v <= g.repetitionMax),
      q('consistency', 'сталість на перефразуваннях', m.consistency.rate, `≥ ${g.consistencyMin}`, (v) => v >= g.consistencyMin),
    );
  }
  return out;
}
