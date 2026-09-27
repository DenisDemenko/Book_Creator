/**
 * Правила безперервності (Т2.4): перевіряють книгу і перепаковують
 * знахідки в `continuity_issues`; сторінка 8 бачить лише ці записи — чи
 * правило їх знайшло (kind: 'time' тут, В2), чи AI-2 (В6) — не важливо.
 *
 * В2 — «час»: `timeline.ts` уже обчислює суперечності зв'язків часу
 * (`TimelineWarning` — relation_order / relation_overlap / cycle) щоразу,
 * як будується хронологія (сторінка 6, `buildTimeline`). Тут — лише
 * перепаковка вже обчисленого в проблему з двома доказами (без нової
 * логіки виявлення): суб'єкти попередження — сутності з власним місцем у
 * тексті (`Timeline.events`), перші два — докази А/Б; цикл (N суб'єктів) —
 * перші два вузли кола, решта видно в описі проблеми.
 *
 * Автор запускає перевірку командою (як «Розпізнати» в Медіатеці,
 * Т2.3 В4) — не на кожній синхронізації книги: побудова хронології не
 * дешева, і час — не єдине, що могло змінитись між синхронізаціями.
 */
import type { CoreRepository, ContinuityEvidence, ContinuityIssueRow } from './types';
import { buildTimeline, type TimelineEvent, type TimelineWarning } from './timeline';
import { bookIndex } from './characterProfile';
import { paragraphExcerpt } from './search/text';
import type { ParagraphRow } from './types';

/** Правило пише від імені системи — не автор, не AI (не пропозиція, а обчислений факт). */
const TIME_RULE_ACTOR = 'system:continuity-rule-time';

function evidenceFor(paragraphs: Map<string, ParagraphRow>, event: TimelineEvent | undefined, entityId: string): ContinuityEvidence | null {
  const sectionId = event?.sectionId ?? null;
  if (!sectionId) return null;
  const paragraphId = event?.paragraphId ?? null;
  const text = paragraphId ? paragraphs.get(paragraphId)?.text ?? '' : '';
  const quote = paragraphExcerpt(text, 200).trim();
  return { sectionId, paragraphId, quote: quote || '(немає власного тексту в цьому місці — лише час сцени)', entityId };
}

function summaryFor(messages: string[]): string {
  const joined = messages.join(' ');
  return joined.length <= 500 ? joined : joined.slice(0, 497) + '…';
}

export interface RefreshTimeContinuityResult {
  /** Скільки попереджень хронології перевірено разом. */
  checked: number;
  created: number;
  updated: number;
  /** Без місця в тексті бодай для одного суб'єкта (немає що показати як доказ) чи автор уже вирішив (dismissed/resolved). */
  skipped: number;
  issues: ContinuityIssueRow[];
}

/**
 * Перевірка правила «час»: попередження хронології → `continuity_issues`
 * (kind: 'time'). Пара вже вирішена автором (dismissed/resolved) —
 * лишається як є; ще відкрита (suggested/confirmed/needs_review) —
 * оновлюється (нова цитата/опис); нова пара — новий запис (rule/confirmed:
 * правило детерміноване, не пропозиція AI, що потребує підтвердження).
 */
export async function refreshTimeContinuity(repo: CoreRepository, projectId: string): Promise<RefreshTimeContinuityResult> {
  const [timeline, ix, existing] = await Promise.all([
    buildTimeline(repo, projectId),
    bookIndex(repo, projectId),
    repo.listContinuityIssues(projectId, { kind: 'time' }),
  ]);
  const eventById = new Map(timeline.events.map((e) => [e.entityId, e]));
  const byPair = new Map<string, ContinuityIssueRow>();
  for (const i of existing) {
    if (i.evidenceA.entityId && i.evidenceB?.entityId) {
      byPair.set([i.evidenceA.entityId, i.evidenceB.entityId].sort().join('|'), i);
    }
  }

  // Кілька попереджень можуть стосуватись тієї самої пари (наприклад,
  // «передує» і «одночасні» для одних і тих самих двох подій) — одна
  // проблема на пару, а не по одній на кожне попередження.
  const groups = new Map<string, { a: string; b: string; messages: string[] }>();
  let skipped = 0;
  for (const w of timeline.warnings) {
    const [a, b] = w.subjects;
    if (!a || !b) {
      skipped++;
      continue;
    }
    const key = [a, b].sort().join('|');
    const g = groups.get(key);
    if (g) g.messages.push(w.message);
    else groups.set(key, { a, b, messages: [w.message] });
  }

  let created = 0;
  let updated = 0;
  const issues: ContinuityIssueRow[] = [];
  for (const [key, g] of groups) {
    const evA = evidenceFor(ix.paragraphs, eventById.get(g.a), g.a);
    const evB = evidenceFor(ix.paragraphs, eventById.get(g.b), g.b);
    if (!evA || !evB) {
      skipped++;
      continue;
    }
    const prev = byPair.get(key);
    if (prev && (prev.status === 'dismissed' || prev.status === 'resolved')) {
      skipped++;
      continue;
    }
    const row = await repo.upsertContinuityIssue({
      id: prev?.id,
      projectId,
      kind: 'time',
      entityId: g.a,
      summary: summaryFor(g.messages),
      evidenceA: evA,
      evidenceB: evB,
      createdBy: TIME_RULE_ACTOR,
    });
    prev ? updated++ : created++;
    issues.push(row);
  }
  return { checked: timeline.warnings.length, created, updated, skipped, issues };
}
