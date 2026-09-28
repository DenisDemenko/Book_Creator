/**
 * Допит живого персонажа (Т2.7, `PLAN_INTERVIEW.md`; FLC 2.0 §7; ТЗ-H §8,
 * §11).
 *
 * В2: «AI-персонаж» і рівні автономності (рішення власника §6 п.3):
 *   off       — вимкнено: героя не допитують і в сценах він не діє сам;
 *   interview — відповідає на допиті автора (Т2.7);
 *   scene     — ще й учасник сцени (Magic Scene, Т3): поки лише
 *               записується; допитувати такого героя теж можна — вищий
 *               рівень включає нижчий.
 * Налаштування агента — лише відомі поля (межа знань за замовчуванням,
 * сцена за замовчуванням, нотатка автора, ліміт ходів допиту); решта
 * відкидається, щоб у налаштування не потрапило довільне.
 */

import type { AutonomyLevel, CharacterAgentRow, CoreActor, CoreRepository, EntityRow } from './types';
import { AUTONOMY_LEVELS } from './types';
import { CoreRuleError } from './rules';

export const AUTONOMY_LABELS: Record<AutonomyLevel, { title: string; hint: string; available: boolean }> = {
  off: { title: 'Вимкнено', hint: 'героя не допитують і в сценах він не діє сам', available: true },
  interview: { title: 'Допит', hint: 'відповідає на запитання автора від першої особи — дослідницька симуляція, не канон', available: true },
  scene: { title: 'Учасник сцени', hint: 'діє сам у сцені з іншими героями (Magic Scene) — з\'явиться на етапі 3; поки герой доступний для допиту', available: false },
};

/** Ліміт ходів одного допиту за замовчуванням (критерій FLC 2.0 §7 — щонайменше 10 відповідей поспіль). */
export const DEFAULT_MAX_TURNS = 30;
export const MAX_TURNS_LIMIT = 100;

export interface AgentConfig {
  /** Межа знань героя за замовчуванням для нового допиту. */
  asOfChapter?: number | null;
  /** Сцена (розділ) за замовчуванням. */
  sceneId?: string | null;
  /** Нотатка автора для голосу героя (як говорить, чого уникає). */
  note?: string;
  /** Скільки ходів в одному допиті. */
  maxTurns?: number;
}

/** Лише відомі поля; неправильне значення — відмова, невідоме поле — відкинуто. */
export function normalizeAgentConfig(raw: unknown): AgentConfig {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new CoreRuleError('bad_input', 'Налаштування агента — обʼєкт');
  const r = raw as Record<string, unknown>;
  const out: AgentConfig = {};
  if (r.asOfChapter !== undefined && r.asOfChapter !== null && r.asOfChapter !== '') {
    const n = Number(r.asOfChapter);
    if (!Number.isInteger(n) || n < 1) throw new CoreRuleError('bad_input', 'Межа знань — глава ≥ 1');
    out.asOfChapter = n;
  } else if (r.asOfChapter === null) out.asOfChapter = null;
  if (r.sceneId !== undefined) {
    const s = r.sceneId == null ? null : String(r.sceneId).trim();
    if (s && s.length > 200) throw new CoreRuleError('bad_input', 'Сцена — до 200 символів');
    out.sceneId = s || null;
  }
  if (r.note !== undefined) {
    const s = String(r.note ?? '').trim();
    if (s.length > 1000) throw new CoreRuleError('bad_input', 'Нотатка — до 1000 символів');
    out.note = s;
  }
  if (r.maxTurns !== undefined) {
    const n = Number(r.maxTurns);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TURNS_LIMIT) throw new CoreRuleError('bad_input', `Ходів у допиті — від 1 до ${MAX_TURNS_LIMIT}`);
    out.maxTurns = n;
  }
  return out;
}

async function heroOrThrow(repo: CoreRepository, projectId: string, characterId: string): Promise<EntityRow> {
  const e = await repo.getEntity(projectId, characterId);
  if (!e || e.status === 'rejected' || e.type !== 'character') throw new CoreRuleError('not_found', 'Героя не знайдено в ядрі книги');
  return e;
}

export interface AgentView {
  characterId: string;
  enabled: boolean;
  autonomyLevel: AutonomyLevel;
  config: AgentConfig;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const agentView = (characterId: string, a: CharacterAgentRow | null): AgentView => ({
  characterId,
  enabled: a?.enabled ?? false,
  autonomyLevel: a?.autonomyLevel ?? 'off',
  config: (a?.agentConfig ?? {}) as AgentConfig,
  updatedBy: a?.updatedBy ?? null,
  updatedAt: a?.updatedAt ?? null,
});

export async function getAgent(repo: CoreRepository, projectId: string, characterId: string): Promise<AgentView> {
  await heroOrThrow(repo, projectId, characterId);
  return agentView(characterId, await repo.getCharacterAgent(projectId, characterId));
}

/** Увімкнути / вимкнути «AI-персонажа», змінити рівень чи налаштування (налаштування зливаються з наявними). */
export async function setAgent(
  repo: CoreRepository,
  projectId: string,
  characterId: string,
  input: { autonomyLevel?: unknown; config?: unknown },
  actor: CoreActor,
): Promise<AgentView> {
  await heroOrThrow(repo, projectId, characterId);
  const prev = await repo.getCharacterAgent(projectId, characterId);
  const level = (input.autonomyLevel ?? prev?.autonomyLevel ?? 'off') as AutonomyLevel;
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(level)) throw new CoreRuleError('bad_input', `Рівень автономності — один із: ${AUTONOMY_LEVELS.join(', ')}`);
  const patch = normalizeAgentConfig(input.config);
  const config = { ...((prev?.agentConfig ?? {}) as AgentConfig), ...patch };
  const row = await repo.upsertCharacterAgent({ projectId, characterId, autonomyLevel: level, agentConfig: config as Record<string, unknown>, actor });
  return agentView(characterId, row);
}

/** Допит можливий лише для увімкненого героя (рівень «допит» чи вищий). */
export async function requireInterviewAgent(repo: CoreRepository, projectId: string, characterId: string): Promise<{ hero: EntityRow; agent: CharacterAgentRow }> {
  const hero = await heroOrThrow(repo, projectId, characterId);
  const agent = await repo.getCharacterAgent(projectId, characterId);
  if (!agent || !agent.enabled || agent.autonomyLevel === 'off') {
    throw new CoreRuleError('conflict', `«${hero.name}» — не AI-персонаж: увімкніть «AI-персонаж» (рівень «Допит») на сторінці героя`);
  }
  return { hero, agent };
}
