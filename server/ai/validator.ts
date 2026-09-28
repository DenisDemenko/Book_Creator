/**
 * Серверний валідатор жорстких обмежень рішення (Т2.5 В4; ТЗ-H §6.3
 * «Перевіряти допустимість обраної дії серверним валідатором; якщо
 * порушено обмеження, повернутися до альтернативи або запросити рішення
 * режисера»; FLC 2.0 §3 «серверний валідатор відхиляє порушення жорстких
 * сюжетних і безпекових обмежень»; ТЗ-H §6.2 — confidence для маршрутизації
 * на рішення автора).
 *
 * Не довіряє жодному джерелу — ні Jev, ні запасному LLM, ні кешу:
 *   1. головний вибір — лише з дозволених і не заборонених; інакше —
 *      найімовірніша допустима альтернатива з розподілу; альтернативи немає —
 *      рішення автора;
 *   2. другорядні вибори (мета, траєкторія…) — лише зі своїх варіантів;
 *   3. оцінки — у 0–10, перевірки Noul — у 0–1; нечислове — відкидається;
 *   4. розподіли — лише по допустимих варіантах;
 *   5. впевненість нижче порогу — рішення автора (не «як вийшло»);
 *      відсутня впевненість (запасний LLM її не дає) — не підстава.
 * Чистий модуль: без бази й мережі — його однаково звуть рівні, маршрути й
 * тести.
 */

import type { DecisionResult } from './contracts';

export interface HardConstraints {
  primary: { id: string; allowed: string[]; forbidden?: string[] };
  /** Другорядні вибори рівня: id питання → допустимі варіанти. */
  choices?: Record<string, string[]>;
  /** Нижче — на розгляд автору. null / undefined — без порогу. */
  confidenceThreshold?: number | null;
}

export type ViolationRule = 'not_allowed' | 'forbidden' | 'choice_not_allowed' | 'score_range' | 'check_range' | 'distribution_key' | 'low_confidence' | 'no_alternative';

export interface Violation {
  rule: ViolationRule;
  question?: string;
  detail: string;
}

export interface ValidationOutcome {
  /** Рішення після виправлень (для «чекає автора» — теж, як часткова відповідь). */
  decision: DecisionResult;
  violations: Violation[];
  corrected: boolean;
  /** Прийняти автоматично не можна — вирішує автор. */
  needsAuthor: boolean;
  /** Чому — автор: немає допустимої альтернативи чи низька впевненість. */
  authorReason: 'no_alternative' | 'low_confidence' | null;
}

const bestOf = (dist: Record<string, number> | undefined, ok: (k: string) => boolean): string | null =>
  Object.entries(dist ?? {})
    .filter(([k, v]) => ok(k) && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

export function validateHard(input: DecisionResult, c: HardConstraints): ValidationOutcome {
  const violations: Violation[] = [];
  const forbidden = new Set(c.primary.forbidden ?? []);
  const permitted = (k: string) => c.primary.allowed.includes(k) && !forbidden.has(k);
  const d: DecisionResult = {
    ...input,
    scores: { ...input.scores },
    raw_distributions: Object.fromEntries(Object.entries(input.raw_distributions ?? {}).map(([k, v]) => [k, { ...v }])),
    ...(input.checks ? { checks: { ...input.checks } } : {}),
    ...(input.choices ? { choices: { ...input.choices } } : {}),
  };
  let corrected = false;
  let authorReason: ValidationOutcome['authorReason'] = null;

  // 4. Розподіли — лише по допустимих варіантах (головний і другорядні).
  const cleanDist = (qid: string, ok: (k: string) => boolean) => {
    const dist = d.raw_distributions[qid];
    if (!dist) return;
    for (const k of Object.keys(dist)) {
      if (!ok(k) || !Number.isFinite(dist[k])) {
        violations.push({ rule: 'distribution_key', question: qid, detail: `варіант «${k}» поза допустимими — прибрано з розподілу` });
        delete dist[k];
        corrected = true;
      }
    }
  };

  // 1. Головний вибір.
  const primaryDist = { ...(d.raw_distributions[c.primary.id] ?? {}) };
  if (!permitted(d.selected_action)) {
    violations.push({
      rule: forbidden.has(d.selected_action) ? 'forbidden' : 'not_allowed',
      question: c.primary.id,
      detail: `обрано «${d.selected_action}» — ${forbidden.has(d.selected_action) ? 'заборонено сценою' : 'поза дозволеним списком'}`,
    });
    const alt = bestOf(primaryDist, permitted);
    if (alt) {
      d.selected_action = alt;
      corrected = true;
    } else {
      violations.push({ rule: 'no_alternative', question: c.primary.id, detail: 'допустимої альтернативи в розподілі немає' });
      authorReason = 'no_alternative';
    }
  }
  cleanDist(c.primary.id, permitted);

  // 2. Другорядні вибори.
  for (const [qid, opts] of Object.entries(c.choices ?? {})) {
    const v = d.choices?.[qid];
    if (v === undefined) continue;
    if (!opts.includes(v)) {
      const alt = bestOf(d.raw_distributions[qid], (k) => opts.includes(k));
      violations.push({ rule: 'choice_not_allowed', question: qid, detail: `«${v}» поза варіантами${alt ? ` — замінено на «${alt}»` : ' — прибрано'}` });
      if (alt) d.choices![qid] = alt;
      else delete d.choices![qid];
      corrected = true;
    }
    cleanDist(qid, (k) => opts.includes(k));
  }

  // 3. Межі оцінок і перевірок.
  for (const [k, v] of Object.entries(d.scores)) {
    if (!Number.isFinite(v)) {
      violations.push({ rule: 'score_range', question: k, detail: 'оцінка не число — прибрано' });
      delete d.scores[k];
      corrected = true;
    } else if (v < 0 || v > 10) {
      violations.push({ rule: 'score_range', question: k, detail: `оцінка ${v} поза 0–10 — обмежено` });
      d.scores[k] = Math.max(0, Math.min(10, v));
      corrected = true;
    }
  }
  for (const [k, v] of Object.entries(d.checks ?? {})) {
    if (!Number.isFinite(v)) {
      violations.push({ rule: 'check_range', question: k, detail: 'перевірка не число — прибрано' });
      delete d.checks![k];
      corrected = true;
    } else if (v < 0 || v > 1) {
      violations.push({ rule: 'check_range', question: k, detail: `імовірність ${v} поза 0–1 — обмежено` });
      d.checks![k] = Math.max(0, Math.min(1, v));
      corrected = true;
    }
  }

  // 5. Впевненість.
  if (!authorReason && c.confidenceThreshold != null && d.confidence != null && d.confidence < c.confidenceThreshold) {
    violations.push({ rule: 'low_confidence', question: c.primary.id, detail: `впевненість ${d.confidence} нижче порогу ${c.confidenceThreshold}` });
    authorReason = 'low_confidence';
  }

  d.corrected = input.corrected || corrected;
  return { decision: d, violations, corrected: d.corrected, needsAuthor: authorReason !== null, authorReason };
}
