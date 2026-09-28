/**
 * CharacterMemoryService — довготривала суб'єктивна пам'ять героя (Т2.6;
 * `PLAN_CHARACTER_MEMORY.md`; ТЗ-H §5.1, §10; FLC 2.0 §2, §4).
 *
 * В1: ізоляція. Що з пам'яті може бачити герой (його агент, його знімок):
 *   • лише власні записи героя — пам'ять іншого героя, зокрема приватна,
 *     до нього не потрапляє ніколи (ТЗ-H №5);
 *   • спогади канону — лише підтверджені автором (`confirmed`);
 *     «пропозиція», «перевірити», «відхилено», «замінено» — ні (fail closed);
 *   • спогади прогону — лише свого прогону (і там — ще не відхилені):
 *     незатверджене одного прогону не бачить інший (FLC 2.0 §2);
 *   • `reader_knowledge` — ніколи: це знає читач, а не герой.
 * Межа знань у часі (сцена) — В2.
 */

import type { CharacterMemoryRow, CoreRepository } from './types';

export interface MemoryScope {
  characterId: string;
  /** Прогін, у якому діє герой; без нього — лише канон. */
  simulationId?: string | null;
}

/** Чи бачить герой цей спогад у своєму знімку / агенті (без межі часу — вона в В2). */
export function isVisibleToHero(m: Pick<CharacterMemoryRow, 'characterId' | 'layer' | 'status' | 'simulationId'>, scope: MemoryScope): boolean {
  if (m.characterId !== scope.characterId) return false;
  if (m.layer === 'reader_knowledge') return false;
  if (m.simulationId === null) return m.status === 'confirmed';
  if (!scope.simulationId || m.simulationId !== scope.simulationId) return false;
  return m.status === 'confirmed' || m.status === 'suggested';
}

/** Пам'ять, яку бачить герой: канон (підтверджене) + свій прогін. */
export async function heroMemories(repo: CoreRepository, projectId: string, scope: MemoryScope): Promise<CharacterMemoryRow[]> {
  const canon = await repo.listCharacterMemories(projectId, { characterId: scope.characterId, simulationId: null, status: 'confirmed', limit: 1000 });
  const run = scope.simulationId ? await repo.listCharacterMemories(projectId, { characterId: scope.characterId, simulationId: scope.simulationId, limit: 1000 }) : [];
  return [...canon, ...run].filter((m) => isVisibleToHero(m, scope));
}
