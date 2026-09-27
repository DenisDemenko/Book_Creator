/**
 * Правила безперервності (Т2.4): перевіряють книгу і перепаковують
 * знахідки в `continuity_issues`; сторінка 8 бачить лише ці записи — чи
 * правило їх знайшло (kind: 'time' тут, В2, чи 'age', В3), чи AI-2 (В6) —
 * не важливо.
 *
 * В2 — «час»: `timeline.ts` уже обчислює суперечності зв'язків часу
 * (`TimelineWarning` — relation_order / relation_overlap / cycle) щоразу,
 * як будується хронологія (сторінка 6, `buildTimeline`). Тут — лише
 * перепаковка вже обчисленого в проблему з двома доказами (без нової
 * логіки виявлення): суб'єкти попередження — сутності з власним місцем у
 * тексті (`Timeline.events`), перші два — докази А/Б; цикл (N суб'єктів) —
 * перші два вузли кола, решта видно в описі проблеми.
 *
 * В3 — `trait_contradiction` (універсальне правило на `entity_traits`,
 * перевикористає й В5 для місця/предмета) і перенесення віку: дві
 * підтверджені риси тієї самої сутності з однаковою міткою, різне
 * значення, без `supersedes` між ними — суперечність.
 * `appearance_versions.age` (Т2.3 В3) автоматично живить рису з міткою
 * «вік» (`syncAgeTraitFromVersion`, викликає маршрут після кожної зміни
 * версії); похідні риси віку різних версій тієї самої сутності, що не
 * перетинаються главами, автоматично зв'язуються `supersedes`
 * (`relinkAgeTraitChain`) — природне дорослішання, не суперечність;
 * перетинаються главами й різний вік — лишаються не зв'язаними, і
 * `trait_contradiction` справедливо це ловить.
 *
 * В4 — «знання»: узагальнення `characterKnowledge()` (Т2.1, ТЗ-H) —
 * той сам робив «що герой законно знає станом на ОДНУ сцену»; тут —
 * `timeline.ts: knowledgeCandidates()` рахує це одразу для ВСІХ героїв:
 * `subject`-кандидат — сцена, де тег розкриття/події прямо позначає
 * героя суб'єктом (офіційний момент дізнання); `present`-кандидат — БУДЬ-
 * яка згадка того самого факту в сцені, де герой лише серед персонажів
 * сцени. Правило: `present`-кандидат раніший (час світу, а без нього —
 * порядок розкриття) за власний `subject`-момент того самого героя й
 * факту — герой «в кімнаті», де про факт говорять, до того, як він
 * офіційно про нього дізнається — суперечність (kind: 'knowledge').
 *
 * Автор запускає перевірку командою (як «Розпізнати» в Медіатеці,
 * Т2.3 В4) — не на кожній синхронізації книги: побудова хронології не
 * дешева, і час — не єдине, що могло змінитись між синхронізаціями.
 */
import type { CoreRepository, ContinuityEvidence, ContinuityIssueRow, ContinuityIssueKind, EntityTraitRow } from './types';
import type { AppearanceVersionRow } from './types';
import { buildTimeline, knowledgeCandidates, sceneIsBefore, type TimelineEvent, type KnowledgeCandidate } from './timeline';
import { bookIndex, type BookIndex } from './characterProfile';
import { paragraphExcerpt } from './search/text';
import { isAiActor } from './rules';
import { overlaps } from './visual';
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

// ── В3: риса «вік» з версії зовнішності, `trait_contradiction` ─────────────

/** Мітка риси «вік» — та сама, яку вписує автор чи пропонує AI-2 (В6). */
export const AGE_TRAIT_LABEL = 'вік';

/** Правило пише від імені системи — обчислений факт, не пропозиція. */
const TRAIT_RULE_ACTOR = 'system:continuity-rule-trait';

function firstSectionOfChapter(ix: BookIndex, chapterNumber: number): string | null {
  const chapter = ix.chapters[chapterNumber - 1];
  if (!chapter) return null;
  const sections = [...ix.docs.values()]
    .filter((d) => d.kind === 'section' && d.parentId === chapter.id && !d.deletedAt)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return sections[0]?.id ?? null;
}

/**
 * Версію зовнішності створено/змінено — оновити (чи прибрати) її похідну
 * рису «вік» (Т2.4 В3). Викликає маршрут одразу після
 * `upsertAppearanceVersion`. Незатверджена версія (чернетка) чи порожній
 * вік — риси не має (як і портрет незатвердженої версії не діє).
 */
export async function syncAgeTraitFromVersion(repo: CoreRepository, projectId: string, version: AppearanceVersionRow): Promise<EntityTraitRow | null> {
  const value = version.age.trim();
  if (!value || !version.approved) {
    await removeAgeTraitForVersion(repo, projectId, version.entityId, version.id);
    return null;
  }
  const ix = await bookIndex(repo, projectId);
  const sectionId = version.fromChapter ? firstSectionOfChapter(ix, version.fromChapter) : null;
  const trait = await repo.upsertEntityTrait({
    projectId,
    entityId: version.entityId,
    label: AGE_TRAIT_LABEL,
    value,
    sectionId,
    appearanceVersionId: version.id,
    createdBy: version.createdBy,
  });
  await relinkAgeTraitChain(repo, projectId, version.entityId);
  return trait;
}

/** Версію видалено — видалити (в пам'яті; PostgreSQL — ON DELETE CASCADE) її похідну рису й перелаштувати ланцюжок. */
export async function removeAgeTraitForVersion(repo: CoreRepository, projectId: string, entityId: string, versionId: string): Promise<void> {
  const traits = await repo.listEntityTraits(projectId, entityId);
  const found = traits.find((t) => t.appearanceVersionId === versionId);
  if (found) await repo.deleteEntityTrait(projectId, found.id);
  await relinkAgeTraitChain(repo, projectId, entityId);
}

/**
 * Похідні риси «вік» тієї самої сутності, чиї версії не перетинаються
 * главами, — природне дорослішання: пізніша `supersedes` ранішу.
 * Перетинаються главами (і мають різне значення) — лишаються не
 * зв'язаними, щоб `trait_contradiction` справедливо це впіймала.
 */
async function relinkAgeTraitChain(repo: CoreRepository, projectId: string, entityId: string): Promise<void> {
  const [versions, traits] = await Promise.all([
    repo.listAppearanceVersions(projectId, entityId),
    repo.listEntityTraits(projectId, entityId),
  ]);
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const derived = traits
    .filter((t) => t.label === AGE_TRAIT_LABEL && t.appearanceVersionId && versionById.has(t.appearanceVersionId))
    .map((t) => ({ trait: t, version: versionById.get(t.appearanceVersionId!)! }))
    .sort((a, b) => (a.version.fromChapter ?? -1) - (b.version.fromChapter ?? -1) || a.version.createdAt.localeCompare(b.version.createdAt));
  for (let i = 1; i < derived.length; i++) {
    const prev = derived[i - 1];
    const curr = derived[i];
    const shouldChain = !overlaps(prev.version, curr.version);
    const wantSupersedes = shouldChain ? prev.trait.id : null;
    if (curr.trait.supersedes !== wantSupersedes) {
      // Лише зв'язок supersedes — решта поля ті самі, і статус/джерело/автор
      // не змінюються (не рішення про статус, а внутрішнє зчеплення ланцюжка).
      await repo.upsertEntityTrait({
        id: curr.trait.id,
        projectId,
        entityId,
        label: curr.trait.label,
        value: curr.trait.value,
        sectionId: curr.trait.sectionId,
        storyTimeKey: curr.trait.storyTimeKey,
        status: curr.trait.status,
        source: curr.trait.source,
        supersedes: wantSupersedes,
        appearanceVersionId: curr.trait.appearanceVersionId,
        createdBy: curr.trait.createdBy,
      });
    }
  }
}

/** Доказ для риси: її власне місце (розділ) — без абзацу (структуровані дані, не пряма мова тексту). */
function traitEvidence(t: EntityTraitRow): ContinuityEvidence | null {
  if (!t.sectionId) return null;
  return { sectionId: t.sectionId, paragraphId: null, quote: `«${t.label}»: «${t.value}»`, entityId: t.entityId };
}

export interface RefreshTraitContradictionsResult {
  /** Скільки пар підтверджених рис з однаковою міткою перевірено разом. */
  checked: number;
  created: number;
  updated: number;
  /** Обидві риси без розділу (нема доказу) чи автор уже вирішив (dismissed/resolved). */
  skipped: number;
  issues: ContinuityIssueRow[];
}

/**
 * Універсальне правило `trait_contradiction` (В3, перевикористає й В5):
 * дві підтверджені риси тієї самої сутності з міткою `label`, різне
 * значення (без урахування регістру й пробілів), без `supersedes` між
 * ними — суперечність (`kind`). Риса без свого розділу — `insufficientData`
 * (доказ лише з другого боку), обидві без розділу — пропускається.
 */
export async function refreshTraitContradictions(repo: CoreRepository, projectId: string, opts: { label: string; kind: ContinuityIssueKind }): Promise<RefreshTraitContradictionsResult> {
  const [traits, existing] = await Promise.all([
    repo.listEntityTraits(projectId),
    repo.listContinuityIssues(projectId, { kind: opts.kind }),
  ]);
  const confirmed = traits.filter((t) => t.status === 'confirmed' && t.label.trim().toLocaleLowerCase('uk') === opts.label.trim().toLocaleLowerCase('uk'));
  const byEntity = new Map<string, EntityTraitRow[]>();
  for (const t of confirmed) byEntity.set(t.entityId, [...(byEntity.get(t.entityId) ?? []), t]);

  const byQuoteKey = new Map<string, ContinuityIssueRow>();
  for (const i of existing) byQuoteKey.set(`${i.entityId ?? ''}|${i.evidenceA.quote}|${i.evidenceB?.quote ?? ''}`, i);

  let checked = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: ContinuityIssueRow[] = [];
  for (const list of byEntity.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const sameValue = a.value.trim().toLocaleLowerCase('uk') === b.value.trim().toLocaleLowerCase('uk');
        const linked = a.supersedes === b.id || b.supersedes === a.id;
        if (sameValue || linked) continue;
        checked++;
        const evA = traitEvidence(a);
        const evB = traitEvidence(b);
        if (!evA && !evB) {
          skipped++;
          continue;
        }
        const [main, other, insufficientData] = evA ? [evA, evB, !evB] : [evB!, null, true];
        const summary = `Сутність має дві підтверджені риси «${a.label}»: «${a.value}» і «${b.value}» — суперечать одна одній.`;
        const key = `${a.entityId}|${main.quote}|${other?.quote ?? ''}`;
        const prev = byQuoteKey.get(key) ?? byQuoteKey.get(`${a.entityId}|${other?.quote ?? ''}|${main.quote}`);
        if (prev && (prev.status === 'dismissed' || prev.status === 'resolved')) {
          skipped++;
          continue;
        }
        const row = await repo.upsertContinuityIssue({
          id: prev?.id,
          projectId,
          kind: opts.kind,
          entityId: a.entityId,
          summary: summary.length <= 500 ? summary : summary.slice(0, 497) + '…',
          evidenceA: main,
          evidenceB: other,
          insufficientData,
          createdBy: TRAIT_RULE_ACTOR,
        });
        prev ? updated++ : created++;
        issues.push(row);
      }
    }
  }
  return { checked, created, updated, skipped, issues };
}

// ── В4: правило «знання» ────────────────────────────────────────────────

/** Правило пише від імені системи — обчислений факт, не пропозиція. */
const KNOWLEDGE_RULE_ACTOR = 'system:continuity-rule-knowledge';

export interface RefreshKnowledgeContinuityResult {
  /** Скільки пар «герой + факт» із «витоком» (present раніше за subject) перевірено. */
  checked: number;
  created: number;
  updated: number;
  /** Уже вирішено автором (dismissed/resolved). */
  skipped: number;
  issues: ContinuityIssueRow[];
}

/**
 * Перевірка правила «знання» (В4): `knowledgeCandidates()` дає всіх
 * кандидатів «герой ↔ факт» одразу (усі герої, один прохід); тут —
 * групуємо за парою «герой + факт», знаходимо офіційний момент дізнання
 * (найраніший `subject`-кандидат — тег розкриття чи події прямо на
 * героя) і будь-які `present`-кандидати РАНІШЕ за нього (той самий факт
 * згадано в сцені, де герой лише присутній) — це і є суперечність.
 * Кілька таких сцен для тієї самої пари — одна проблема (найраніша —
 * доказ А, решта — лічильник в описі), не декілька. Пара без офіційного
 * `subject`-моменту взагалі — не оцінюється (нема з чим порівнювати,
 * не помилка, а просто нетегована сутність).
 */
export async function refreshKnowledgeContinuity(repo: CoreRepository, projectId: string): Promise<RefreshKnowledgeContinuityResult> {
  const [candidates, ix, existing] = await Promise.all([
    knowledgeCandidates(repo, projectId),
    bookIndex(repo, projectId),
    repo.listContinuityIssues(projectId, { kind: 'knowledge' }),
  ]);

  const genesis = new Map<string, KnowledgeCandidate>();
  for (const c of candidates) {
    if (c.via !== 'subject') continue;
    const key = `${c.characterId}|${c.entityId}`;
    const prev = genesis.get(key);
    if (!prev || sceneIsBefore(c, prev)) genesis.set(key, c);
  }

  const leaks = new Map<string, { genesis: KnowledgeCandidate; earliest: KnowledgeCandidate; count: number }>();
  for (const c of candidates) {
    if (c.via !== 'present') continue;
    const key = `${c.characterId}|${c.entityId}`;
    const g = genesis.get(key);
    if (!g || g.sectionId === c.sectionId || !sceneIsBefore(c, g)) continue;
    const cur = leaks.get(key);
    if (!cur) leaks.set(key, { genesis: g, earliest: c, count: 1 });
    else {
      cur.count++;
      if (sceneIsBefore(c, cur.earliest)) cur.earliest = c;
    }
  }

  const quote = (paragraphId: string) => paragraphExcerpt(ix.paragraphs.get(paragraphId)?.text ?? '', 200).trim() || '(немає власного тексту в цьому місці)';
  const byKey = new Map<string, ContinuityIssueRow>();
  for (const i of existing) byKey.set(`${i.evidenceA.entityId ?? ''}|${i.evidenceA.sectionId}|${i.evidenceB?.sectionId ?? ''}`, i);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: ContinuityIssueRow[] = [];
  for (const leak of leaks.values()) {
    const { genesis: g, earliest: w, count } = leak;
    const evA: ContinuityEvidence = { sectionId: w.sectionId, paragraphId: w.paragraphId, quote: quote(w.paragraphId), entityId: w.characterId };
    const evB: ContinuityEvidence = { sectionId: g.sectionId, paragraphId: g.paragraphId, quote: quote(g.paragraphId), entityId: g.characterId };
    const key = `${w.characterId}|${w.sectionId}|${g.sectionId}`;
    const prev = byKey.get(key);
    if (prev && (prev.status === 'dismissed' || prev.status === 'resolved')) {
      skipped++;
      continue;
    }
    const extra = count > 1 ? ` (і ще ${count - 1} така сцена)` : '';
    const summary = `Сутність «${w.characterName}» присутня в сцені зі згадкою «${w.entityName}»${extra}, раніше за сцену, де це стає їй офіційно відомо.`;
    const row = await repo.upsertContinuityIssue({
      id: prev?.id,
      projectId,
      kind: 'knowledge',
      entityId: w.characterId,
      summary: summary.length <= 500 ? summary : summary.slice(0, 497) + '…',
      evidenceA: evA,
      evidenceB: evB,
      createdBy: KNOWLEDGE_RULE_ACTOR,
    });
    prev ? updated++ : created++;
    issues.push(row);
  }
  return { checked: leaks.size, created, updated, skipped, issues };
}
