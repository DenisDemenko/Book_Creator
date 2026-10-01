/**
 * Прогін контрольного набору «живих персонажів» (Т2.8 В1, `PLAN_QUALITY.md`).
 *
 * Набір проходить **справжнім ходом допиту** (`startInterview` →
 * `askQuestion`: знімок героя станом на сцену → рішення Jev → голос героя) —
 * без окремого «тестового» шляху, тож міряється те, що бачить автор. Книга
 * синхронізується в окреме сховище в пам'яті: продуктова база не
 * засмічується, а прогін на справжніх моделях не залишає слідів у ядрі.
 *
 * Два режими (FLC 2.0, етап 2 — «порівняти з Jev і без Jev»):
 *   with_jev    — рішення ухвалює Jev (справжній чи підставний);
 *   without_jev — Jev немає: те саме питання ставиться запасному LLM.
 *
 * Кожен виклик моделі голосу й кожен стан, переданий Jev, перехоплюються —
 * саме в них (і у відповіді) шукаються витоки приватного й майбутнього.
 * Виміри рахує `qualityMetrics.ts` — чисті функції без моделі.
 *
 * В2: Jev-суддя (рішення власника §2 п.1 — EVALUATOR, ТЗ Graph Studio §21):
 * кожну відповідь Jev оцінює над знімком того самого героя станом на ту саму
 * сцену — «у характері героя» (SCORE), «у стилі автора» (SCORE, зразок —
 * текст книги в знімку), «суперечить підтвердженому стану героя» (NOUL).
 * Оцінка лишається числом у звіті — фактом канону вона не стає. Суддя один
 * для обох режимів, тож порівняння з Jev / без Jev чесне.
 */

import { MemoryCoreRepository } from '../memoryRepository';
import { syncBookToCore } from '../sync';
import { reconcileParagraphIds } from '../../../src/utils/paragraphIds';
import { addAuthorMemory, collectTagMemories } from '../characterMemory';
import { askQuestion, INTERVIEW_ACTIONS, setAgent, startInterview, type InterviewDeps, type VoiceGenerate } from '../interview';
import { buildCharacterSnapshot } from '../characterSnapshot';
import { stripEntityTags } from '../../../src/utils/coreEntities';
import type { JevQuestion } from '../../ai/contracts';
import { jevState, LlmFallbackJevAdapter, JEV_USD_PER_MTOK, type JevAdapter, type LlmJson } from '../../ai/adapters/jev';
import type { CharacterDecisionRow, CoreRepository } from '../types';
import { forbiddenFor, type ControlSet, type QualityCase } from './controlSet';
import { computeMetrics, evaluateGates, type GateResult, type QualityMetrics } from './qualityMetrics';

export type QualityMode = 'with_jev' | 'without_jev';
export const QUALITY_MODES: QualityMode[] = ['with_jev', 'without_jev'];
export const QUALITY_ACTOR = 'user:quality-runner';

export interface QualityTurn {
  caseId: string;
  hero: string;
  dimension: QualityCase['dimension'];
  pair: string | null;
  /** Пам'ять: що мало прозвучати. */
  expect: string[];
  question: string;
  status: 'answered' | 'awaiting' | 'failed' | 'error';
  reply: string;
  action: string | null;
  source: string | null;
  fallbackReason: string | null;
  error: string | null;
  latencyMs: number;
  voice: { inputTokens: number; outputTokens: number; costUsd: number; model: string | null };
  /** Що саме модель голосу й Jev бачили на цьому ході (для пошуку витоків). */
  seen: { prompts: string[]; jevStates: string[] };
  forbidden: { secret: string[]; future: string[] };
  /** Оцінка Jev-судді (В2); null — судді немає чи хід без відповіді. */
  judge: TurnJudgement | null;
}

export interface TurnJudgement {
  /** 0–10. */
  characterFit: number | null;
  styleFit: number | null;
  /** Імовірність «суперечить» 0–1. */
  contradiction: number | null;
  source: string;
  inputTokens: number;
  costUsd: number;
  error: string | null;
}

/** Питання судді (Jev як EVALUATOR): дві шкали й одна перевірка «так / ні». */
export const JUDGE_QUESTIONS: JevQuestion[] = [
  {
    id: 'character_fit',
    kind: 'score',
    instructions: 'Ситуація — питання автора й відповідь героя. Наскільки ця відповідь у характері героя, зважаючи на його стан, переконання, пам\'ять і пережите?',
    levels: ['зовсім не схоже на героя', 'нетипово для героя', 'можливо', 'типово для героя', 'цілком у його характері'],
  },
  {
    id: 'style_fit',
    kind: 'score',
    instructions: 'Наскільки мова відповіді героя відповідає авторському стилю книги — фрагменти тексту в recent_text (довжина речень, ритм, діалогова манера, лексика)?',
    levels: ['зовсім інший стиль', 'помітно інший', 'нейтрально', 'близько до стилю автора', 'як у тексті автора'],
  },
  {
    id: 'contradicts_state',
    kind: 'noul',
    instructions: 'Чи суперечить відповідь героя підтвердженим фактам, його пам\'яті чи переконанням, наданим у стані?',
  },
];

export interface DecisionTotals {
  calls: number;
  bySource: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface QualityModeResult {
  mode: QualityMode;
  turns: QualityTurn[];
  decisions: DecisionTotals;
  metrics: QualityMetrics;
  gates: GateResult[];
  passed: boolean;
  durationMs: number;
}

export interface QualityReport {
  setId: string;
  setVersion: number;
  startedAt: string;
  finishedAt: string;
  label: string;
  modes: QualityModeResult[];
  passed: boolean;
}

export interface QualityRunDeps {
  /** Модель голосу героя (модуль «Голос героя (допит)»). */
  voice: VoiceGenerate;
  /** Jev для режиму with_jev; null — режим with_jev теж піде запасним шляхом (і це буде видно у звіті). */
  jev: JevAdapter | null;
  /** Запасний LLM для рішень (і єдиний шлях у режимі without_jev). */
  fallbackLlm: LlmJson;
  /** Вартість рішення запасного LLM, $ (модель, токени); без неї — 0. */
  priceLlm?: (modelId: string, inputTokens: number, outputTokens: number) => number;
  /** Jev-суддя (В2); за замовчуванням — `jev`; null — без судді (виміри характеру й стилю пропущено). */
  judge?: JevAdapter | null;
  /** Підпис прогону у звіті (напр. «підставні моделі», «справжні: gemini-… / jev-1.13.0»). */
  label?: string;
  /** Годинник (тести). */
  now?: () => number;
}

const PROJECT = 'qa-living-characters';

/** Текст автора без тегів — зразок стилю для стилометрії. */
export function authorText(set: ControlSet): string {
  return set.book.chapters.flatMap((ch) => ch.sections.map((s) => stripEntityTags(s.content))).join('\n\n');
}

const sceneChapterOf = (set: ControlSet) => {
  const map = new Map<string, number>();
  set.book.chapters.forEach((ch, i) => ch.sections.forEach((s) => map.set(s.id, i + 1)));
  return (sceneId: string) => map.get(sceneId) ?? null;
};

/** Книга набору → ядро в пам'яті (як після збереження автором), пам'ять героїв, «AI-персонажі». */
export async function seedControlSet(repo: CoreRepository, set: ControlSet): Promise<Map<string, string>> {
  const book = {
    id: PROJECT,
    title: set.book.title,
    characters: set.book.characters,
    chapters: set.book.chapters.map((ch, ci) => ({
      id: ch.id,
      title: ch.title,
      order: ci,
      sections: ch.sections.map((s, si) => {
        const r = reconcileParagraphIds({ sectionId: s.id, content: s.content });
        return { id: s.id, title: s.title, order: si, content: s.content, paragraphIds: r.ids, paragraphHashes: r.hashes };
      }),
    })),
  };
  await syncBookToCore(repo, { id: PROJECT, ownerId: 'quality-runner', title: set.book.title, book } as any);
  await collectTagMemories(repo, PROJECT);
  const heroes = new Map<string, string>();
  for (const c of set.book.characters) {
    const id = await repo.resolveAlias(PROJECT, 'character', c.name);
    if (!id) throw new Error(`Контрольний набір: героя «${c.name}» немає в ядрі після синхронізації`);
    heroes.set(c.name, id);
  }
  for (const m of set.memories) {
    await addAuthorMemory(repo, {
      projectId: PROJECT,
      characterId: heroes.get(m.hero)!,
      memoryType: m.memoryType,
      content: m.content,
      sceneId: m.sceneId ?? null,
      visibility: m.visibility ?? 'project',
      actor: QUALITY_ACTOR,
    });
  }
  for (const [name, id] of heroes) {
    await setAgent(repo, PROJECT, id, { autonomyLevel: 'interview', config: { note: set.notes[name] ?? '', maxTurns: 5 } }, QUALITY_ACTOR);
  }
  return heroes;
}

/** Обгортка Jev: запам'ятовує стан, який пішов у модель рішень. */
function watchJev(inner: JevAdapter, sink: () => string[]): JevAdapter {
  return {
    name: inner.name,
    evaluate: async (snapshot, questions, opts) => {
      sink().push(JSON.stringify(jevState(snapshot)));
      return inner.evaluate(snapshot, questions, opts);
    },
  };
}

function decisionTotals(rows: CharacterDecisionRow[], priceLlm?: QualityRunDeps['priceLlm']): DecisionTotals {
  const out: DecisionTotals = { calls: 0, bySource: {}, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };
  for (const d of rows) {
    if (d.source === 'author') continue;
    out.calls++;
    out.bySource[d.source] = (out.bySource[d.source] ?? 0) + 1;
    const u = d.usage as { input_tokens?: number; output_tokens?: number };
    const inTok = Number(u.input_tokens ?? 0) || 0;
    const outTok = Number(u.output_tokens ?? 0) || 0;
    out.inputTokens += inTok;
    out.outputTokens += outTok;
    out.latencyMs += d.latencyMs || 0;
    if (d.source === 'jev') out.costUsd += (inTok / 1_000_000) * JEV_USD_PER_MTOK;
    else if (d.source === 'llm_fallback' && priceLlm) out.costUsd += priceLlm(d.modelVersion.replace(/^llm:/, ''), inTok, outTok);
  }
  out.costUsd = Math.round(out.costUsd * 1e6) / 1e6;
  return out;
}

export async function runMode(set: ControlSet, mode: QualityMode, deps: QualityRunDeps): Promise<QualityModeResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const repo = new MemoryCoreRepository();
  const heroes = await seedControlSet(repo, set);
  const chapterOf = sceneChapterOf(set);
  let current: QualityTurn | null = null;
  const jevStates = () => current?.seen.jevStates ?? [];
  const voice: VoiceGenerate = async (system, user) => {
    current?.seen.prompts.push(`${system}\n${user}`);
    return deps.voice(system, user);
  };
  const fallback = watchJev(new LlmFallbackJevAdapter(deps.fallbackLlm), jevStates);
  const jev = mode === 'with_jev' && deps.jev ? watchJev(deps.jev, jevStates) : null;
  const interviewDeps: InterviewDeps = { repo, jev, fallback, voice };
  const judge = deps.judge === undefined ? deps.jev : deps.judge;

  const turns: QualityTurn[] = [];
  for (const c of set.cases) {
    const heroId = heroes.get(c.hero);
    const turn: QualityTurn = {
      caseId: c.id,
      hero: c.hero,
      dimension: c.dimension,
      pair: c.pair ?? null,
      expect: c.expect ?? [],
      question: c.question,
      status: 'error',
      reply: '',
      action: null,
      source: null,
      fallbackReason: null,
      error: null,
      latencyMs: 0,
      voice: { inputTokens: 0, outputTokens: 0, costUsd: 0, model: null },
      seen: { prompts: [], jevStates: [] },
      forbidden: forbiddenFor(set, c, chapterOf),
      judge: null,
    };
    current = turn;
    const t0 = now();
    try {
      if (!heroId) throw new Error(`Героя «${c.hero}» немає в наборі`);
      const sim = await startInterview(repo, { projectId: PROJECT, characterId: heroId, sceneId: c.sceneId ?? null, asOfChapter: c.asOfChapter ?? null, title: c.id, actor: QUALITY_ACTOR });
      const r = await askQuestion(interviewDeps, { projectId: PROJECT, simulationId: sim.id, question: c.question, actor: QUALITY_ACTOR });
      const p = r.event.publicPayload as Record<string, any>;
      turn.status = r.status;
      turn.reply = r.status === 'answered' ? String(p.text ?? '') : '';
      turn.action = typeof p.action === 'string' ? p.action : null;
      turn.source = typeof p.source === 'string' ? p.source : null;
      turn.fallbackReason = typeof p.fallbackReason === 'string' ? p.fallbackReason : null;
      turn.error = typeof p.error === 'string' ? p.error : null;
      const u = (p.usage ?? {}) as { inputTokens?: number; outputTokens?: number; costUsd?: number };
      turn.voice = { inputTokens: Number(u.inputTokens ?? 0) || 0, outputTokens: Number(u.outputTokens ?? 0) || 0, costUsd: Number(u.costUsd ?? 0) || 0, model: typeof p.model === 'string' ? p.model : null };
    } catch (err) {
      turn.status = 'error';
      turn.error = (err as Error).message.slice(0, 500);
    }
    turn.latencyMs = Math.max(0, now() - t0);
    if (judge && heroId && turn.status === 'answered') turn.judge = await judgeTurn(repo, judge, turn, c, heroId);
    turns.push(turn);
  }
  current = null;
  const decisions = decisionTotals(await repo.listCharacterDecisions(PROJECT, { limit: 5000 }), deps.priceLlm);
  const metrics = computeMetrics(turns, decisions, { authorText: authorText(set) });
  const gates = evaluateGates(set.gates, metrics, mode);
  return { mode, turns, decisions, metrics, gates, passed: gates.every((g) => g.passed), durationMs: Math.max(0, now() - started) };
}

/** Jev-суддя над знімком того самого героя станом на ту саму сцену; стан теж перевіряється на витоки. */
async function judgeTurn(repo: CoreRepository, judge: JevAdapter, turn: QualityTurn, c: QualityCase, heroId: string): Promise<TurnJudgement> {
  try {
    const built = await buildCharacterSnapshot(repo, {
      projectId: PROJECT,
      characterId: heroId,
      sceneId: c.sceneId ?? null,
      asOfChapter: c.asOfChapter ?? null,
      situation: `Питання автора: «${turn.question}»\nВідповідь героя: «${turn.reply}»`.slice(0, 2000),
      allowedActions: INTERVIEW_ACTIONS,
      lenientScene: true,
    });
    turn.seen.jevStates.push(JSON.stringify(jevState(built.snapshot)));
    const r = await judge.evaluate(built.snapshot, JUDGE_QUESTIONS);
    const inTok = Number(r.usage?.input_tokens ?? 0) || 0;
    return {
      characterFit: typeof r.scores.character_fit === 'number' ? r.scores.character_fit : null,
      styleFit: typeof r.scores.style_fit === 'number' ? r.scores.style_fit : null,
      contradiction: typeof r.checks?.contradicts_state === 'number' ? r.checks.contradicts_state : null,
      source: r.source,
      inputTokens: inTok,
      costUsd: r.source === 'jev' ? Math.round((inTok / 1_000_000) * JEV_USD_PER_MTOK * 1e6) / 1e6 : 0,
      error: null,
    };
  } catch (err) {
    return { characterFit: null, styleFit: null, contradiction: null, source: 'error', inputTokens: 0, costUsd: 0, error: (err as Error).message.slice(0, 300) };
  }
}

/** Увесь набір в обох режимах — звіт із числами для кожного виміру. */
export async function runLivingCharacters(set: ControlSet, deps: QualityRunDeps, modes: QualityMode[] = QUALITY_MODES): Promise<QualityReport> {
  const startedAt = new Date().toISOString();
  const results: QualityModeResult[] = [];
  for (const m of modes) results.push(await runMode(set, m, deps));
  return {
    setId: set.id,
    setVersion: set.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    label: deps.label ?? '',
    modes: results,
    passed: results.every((r) => r.passed),
  };
}
