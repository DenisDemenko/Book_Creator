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
 * В5 — «місце» і «предмет», кожне з двох частин (§2 п.4–5 плану): (а)
 * `trait_contradiction` на всіх мітках рис локацій/світу чи предметів
 * (той самий виклик, що й «вік», лише без мітки й із фільтром типів); (б)
 * за тегами сцени — герой у двох несумісних локаціях чи предмет у двох
 * власників у сценах, одночасних у часі світу, без сцени переходу /
 * передачі між ними. Приблизний час чи виведений (не явний) власник —
 * лише пропозиція (`suggested`), не встановлений факт.
 *
 * Автор запускає перевірку командою (як «Розпізнати» в Медіатеці,
 * Т2.3 В4) — не на кожній синхронізації книги: побудова хронології не
 * дешева, і час — не єдине, що могло змінитись між синхронізаціями.
 */
import type { CoreRepository, ContinuityEvidence, ContinuityIssueRow, ContinuityIssueKind, EntityTraitRow } from './types';
import type { AppearanceVersionRow } from './types';
import { buildTimeline, knowledgeCandidates, sceneIsBefore, scanScenes, type TimelineEvent, type KnowledgeCandidate, type SceneScan, type TimeValue } from './timeline';
import { parseEntityValue } from '../../src/utils/coreEntities';
import { bookIndex, type BookIndex } from './characterProfile';
import { paragraphExcerpt } from './search/text';
import { isAiActor } from './rules';
import { overlaps } from './visual';
import type { MentionRow, ParagraphRow } from './types';
import { createHash } from 'node:crypto';
import { blockHash } from '../../src/utils/paragraphIds';
import { refreshCausalityContinuity } from './causality';

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
  const textOf = paragraphTexts(ix);
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
      checkedHash: continuityEvidenceHash(textOf, evA, evB),
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
 * Універсальне правило `trait_contradiction` (В3, перевикористане В5):
 * дві підтверджені риси тієї самої сутності з однаковою міткою, різне
 * значення (без урахування регістру й пробілів), без `supersedes` між
 * ними — суперечність (`kind`). Риса без свого розділу — `insufficientData`
 * (доказ лише з другого боку), обидві без розділу — пропускається.
 *
 * `label` — лише одна мітка (В3: «вік»); без неї — усі мітки, кожна
 * окремо (В5: будь-яка риса локації чи предмета). `entityTypes` — лише
 * сутності цих типів (В5: місце — локації й світ, предмет — предмети).
 */
export async function refreshTraitContradictions(
  repo: CoreRepository,
  projectId: string,
  opts: { label?: string; kind: ContinuityIssueKind; entityTypes?: readonly string[] },
): Promise<RefreshTraitContradictionsResult> {
  const [traits, existing, entities] = await Promise.all([
    repo.listEntityTraits(projectId),
    repo.listContinuityIssues(projectId, { kind: opts.kind }),
    opts.entityTypes ? repo.listEntities(projectId) : Promise.resolve(null),
  ]);
  const norm = (x: string) => x.trim().toLocaleLowerCase('uk');
  const allowed = entities ? new Set(entities.filter((e) => opts.entityTypes!.includes(e.type)).map((e) => e.id)) : null;
  const confirmed = traits.filter((t) =>
    t.status === 'confirmed' && (opts.label === undefined || norm(t.label) === norm(opts.label)) && (!allowed || allowed.has(t.entityId)));
  // Групи «сутність + мітка»: риси з різними мітками не порівнюються між собою.
  const byEntity = new Map<string, EntityTraitRow[]>();
  for (const t of confirmed) {
    const key = `${t.entityId}|${norm(t.label)}`;
    byEntity.set(key, [...(byEntity.get(key) ?? []), t]);
  }

  // Лише записи-риси: той самий kind (object/place) пише й правило сцен В5, але
  // в рис доказ без абзацу (`traitEvidence`), а в сцен — завжди з абзацом.
  // (`createdBy` не годиться: зміна статусу пише туди автора.)
  const byQuoteKey = new Map<string, ContinuityIssueRow>();
  for (const i of existing) if (!i.evidenceA.paragraphId) byQuoteKey.set(`${i.entityId ?? ''}|${i.evidenceA.quote}|${i.evidenceB?.quote ?? ''}`, i);

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
  const textOf = paragraphTexts(ix);
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
      checkedHash: continuityEvidenceHash(textOf, evA, evB),
      createdBy: KNOWLEDGE_RULE_ACTOR,
    });
    prev ? updated++ : created++;
    issues.push(row);
  }
  return { checked: leaks.size, created, updated, skipped, issues };
}

// ── В5: правила «місце» і «предмет» за тегами сцени ─────────────────────

/** Правила пишуть від імені системи; «слабкий» доказ — пропозиція (suggested), автор підтверджує. */
const PLACE_RULE_ACTOR = 'system:continuity-rule-place';
const OBJECT_RULE_ACTOR = 'system:continuity-rule-object';

/** Сутності, чиї риси — «місце» (trait_contradiction В3 на всіх мітках). */
export const PLACE_ENTITY_TYPES = ['location', 'world'] as const;
/** Сутності-предмети: `object` з реєстру, `tool`, і ті, що Медіатека вже вважає предметами (`visual.ts`). */
export const OBJECT_ENTITY_TYPES = ['object', 'item', 'artifact', 'weapon', 'vehicle', 'tool'] as const;

/** Де сутність «є» в одній сцені: локації (герой) чи власники (предмет) — і звідки це відомо. */
interface ScenePosition {
  sectionId: string;
  sectionTitle: string;
  narrativeIndex: number;
  time: TimeValue;
  /** id локацій чи героїв-власників у цій сцені. */
  positions: Set<string>;
  /** Абзац-доказ (перша згадка позиції в сцені). */
  paragraphId: string;
  /** Позицію визначено непрямо (власник — найближчий герой, без `@Ім'я` чи поля «власник»). */
  inferred: boolean;
}

/** Відрізок часу світу сцени; null — час невідомий (сцена не бере участі). */
function span(t: TimeValue | null): [number, number] | null {
  if (!t || t.kind === 'unknown' || t.key == null) return null;
  return [t.key, t.endKey ?? t.key];
}

function simultaneous(a: TimeValue, b: TimeValue): boolean {
  const x = span(a);
  const y = span(b);
  return !!x && !!y && x[0] <= y[1] && y[0] <= x[1];
}

/** Точний час чи інтервал автора — «твердий»; приблизний (зокрема порядок зі Студії) — ні. */
const hardTime = (t: TimeValue) => t.kind === 'exact' || t.kind === 'interval';

interface SceneConflict {
  entityId: string;
  a: ScenePosition;
  b: ScenePosition;
  /** Скільки ще пар сцен тієї самої сутності з тими самими двома наборами позицій. */
  more: number;
}

/**
 * Спільне ядро обох правил В5: сутність у двох сценах, що перетинаються в
 * часі світу, і позиції цих сцен несумісні (жодна пара не збігається і не
 * вкладена одна в одну) — суперечність, ЯКЩО немає «сцени переходу»: третьої
 * сцени тієї самої сутності, теж одночасної з обома, де є дві різні
 * позиції — одна сумісна з боком А, інша з боком Б (герой у дорозі між
 * містами, предмет переходить із рук у руки). Сцена, де позицій кілька й вони сумісні з обома, — сама і є
 * переходом, тому непересічні набори — умова, а не просто «різні».
 * Кілька пар сцен з тими самими двома наборами позицій — одна проблема
 * (найраніша за порядком розкриття), решта — лічильник.
 */
function sceneConflicts(byEntity: Map<string, ScenePosition[]>, compatible: (x: string, y: string) => boolean): SceneConflict[] {
  const fits = (p: Set<string>, q: Set<string>) => [...p].some((x) => [...q].some((y) => compatible(x, y)));
  const sig = (p: Set<string>) => [...p].sort().join(',');
  // Перехід — ДВІ різні позиції в одній сцені: одна з боку А, інша з боку Б
  // (Київ і Львів; «від Олени до Марка»). Одна ширша позиція, сумісна з
  // обома (Україна для Києва й Львова), — не перехід, а просто не суперечить.
  const bridges = (c: Set<string>, p: Set<string>, q: Set<string>) =>
    [...c].some((x) => [...p].some((y) => compatible(x, y)) && [...c].some((z) => z !== x && [...q].some((w) => compatible(z, w))));
  const out = new Map<string, SceneConflict>();
  for (const [entityId, list] of byEntity) {
    const scenes = [...list].sort((x, y) => x.narrativeIndex - y.narrativeIndex);
    for (let i = 0; i < scenes.length; i++) {
      for (let j = i + 1; j < scenes.length; j++) {
        const a = scenes[i];
        const b = scenes[j];
        if (!simultaneous(a.time, b.time) || fits(a.positions, b.positions)) continue;
        const bridged = scenes.some((c) => c !== a && c !== b &&
          simultaneous(c.time, a.time) && simultaneous(c.time, b.time) && bridges(c.positions, a.positions, b.positions));
        if (bridged) continue;
        const key = `${entityId}|${[sig(a.positions), sig(b.positions)].sort().join('|')}`;
        const cur = out.get(key);
        if (!cur) out.set(key, { entityId, a, b, more: 0 });
        else cur.more++;
      }
    }
  }
  return [...out.values()];
}

/** Вкладеність локацій із зв'язків `contains` / `part_of` (Київ у складі України — не «два різні місця»). */
function locationNesting(relations: { type: string; fromId: string; toId: string; status: string }[]): (x: string, y: string) => boolean {
  const parents = new Map<string, Set<string>>();
  const link = (child: string, parent: string) => parents.set(child, (parents.get(child) ?? new Set()).add(parent));
  for (const r of relations) {
    if (r.status === 'rejected') continue;
    if (r.type === 'contains') link(r.toId, r.fromId);
    if (r.type === 'part_of') link(r.fromId, r.toId);
  }
  const ancestors = (x: string) => {
    const seen = new Set<string>();
    const stack = [x];
    while (stack.length) for (const p of parents.get(stack.pop()!) ?? []) if (!seen.has(p)) { seen.add(p); stack.push(p); }
    return seen;
  };
  const memo = new Map<string, Set<string>>();
  const anc = (x: string) => memo.get(x) ?? (memo.set(x, ancestors(x)), memo.get(x)!);
  return (x, y) => x === y || anc(x).has(y) || anc(y).has(x);
}

export interface RefreshSceneRuleResult {
  /** Скільки конфліктних груп (сутність + два набори позицій) знайдено. */
  checked: number;
  created: number;
  updated: number;
  /** Уже вирішено автором (dismissed/resolved). */
  skipped: number;
  issues: ContinuityIssueRow[];
}

async function writeSceneConflicts(
  repo: CoreRepository,
  projectId: string,
  kind: ContinuityIssueKind,
  actor: string,
  conflicts: SceneConflict[],
  ix: BookIndex,
  summaryOf: (c: SceneConflict) => string,
): Promise<RefreshSceneRuleResult> {
  // Записи правила сцен: з абзацом-доказом (риси — без абзацу) і від правила, не AI-2.
  // (`createdBy` не годиться: зміна статусу пише туди автора.)
  const existing = (await repo.listContinuityIssues(projectId, { kind })).filter((i) => i.source === 'rule' && !!i.evidenceA.paragraphId);
  const byKey = new Map<string, ContinuityIssueRow>();
  for (const i of existing) byKey.set(`${i.entityId ?? ''}|${[i.evidenceA.sectionId, i.evidenceB?.sectionId ?? ''].sort().join('|')}`, i);
  const quote = (paragraphId: string) => paragraphExcerpt(ix.paragraphs.get(paragraphId)?.text ?? '', 200).trim() || '(немає власного тексту в цьому місці)';
  const textOf = paragraphTexts(ix);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: ContinuityIssueRow[] = [];
  for (const c of conflicts) {
    const prev = byKey.get(`${c.entityId}|${[c.a.sectionId, c.b.sectionId].sort().join('|')}`);
    if (prev && (prev.status === 'dismissed' || prev.status === 'resolved')) {
      skipped++;
      continue;
    }
    const firm = hardTime(c.a.time) && hardTime(c.b.time) && !c.a.inferred && !c.b.inferred;
    const summary = summaryOf(c);
    const evidenceA: ContinuityEvidence = { sectionId: c.a.sectionId, paragraphId: c.a.paragraphId, quote: quote(c.a.paragraphId), entityId: c.entityId };
    const evidenceB: ContinuityEvidence = { sectionId: c.b.sectionId, paragraphId: c.b.paragraphId, quote: quote(c.b.paragraphId), entityId: c.entityId };
    const row = await repo.upsertContinuityIssue({
      id: prev?.id,
      projectId,
      kind,
      entityId: c.entityId,
      summary: summary.length <= 500 ? summary : summary.slice(0, 497) + '…',
      evidenceA,
      evidenceB,
      // Статус, який автор уже поставив, не скидається повторним прогоном; «на перегляд» (В6) —
      // правило щойно перевірило змінений текст і знайшло суперечність знову.
      status: prev && prev.status !== 'needs_review' ? prev.status : firm ? 'confirmed' : 'suggested',
      checkedHash: continuityEvidenceHash(textOf, evidenceA, evidenceB),
      createdBy: actor,
    });
    prev ? updated++ : created++;
    issues.push(row);
  }
  return { checked: conflicts.length, created, updated, skipped, issues };
}

const names = (ids: Set<string>, scan: SceneScan) => [...ids].map((id) => `«${scan.entities.get(id)?.name ?? id}»`).join(', ');
const whenLabel = (t: TimeValue) => t.label || String(t.start ?? '');
const moreLabel = (n: number) => (n > 0 ? ` (і ще ${n} така пара сцен)` : '');

/**
 * Правило «місце» (В5, б): герой у двох сценах, одночасних у часі світу, а
 * локації цих сцен (теги `[/location:…]`) несумісні — і немає сцени
 * переходу. Локації, вкладені одна в одну зв'язком `contains`/`part_of`,
 * сумісні. Сцена без часу чи без локацій — не бере участі (нема що
 * порівнювати, не помилка). Приблизний час бодай з одного боку — лише
 * пропозиція (`suggested`): «приблизно одночасно» ще не суперечність.
 */
export async function refreshPlaceSceneContinuity(repo: CoreRepository, projectId: string): Promise<RefreshSceneRuleResult> {
  const [points, relations] = await Promise.all([repo.listTimePoints(projectId), repo.listRelations(projectId)]);
  const scan = await scanScenes(repo, projectId, points);
  const byEntity = new Map<string, ScenePosition[]>();
  for (const s of scan.scenes) {
    if (!span(s.time) || s.locations.length === 0) continue;
    const locIds = new Set(s.locations.map((l) => l.id));
    const firstLocMention = scan.mentions
      .filter((m) => locIds.has(m.entityId) && scan.sectionOfParagraph.get(m.paragraphId) === s.sectionId)
      .sort((x, y) => (scan.ix.paragraphs.get(x.paragraphId)?.order ?? 0) - (scan.ix.paragraphs.get(y.paragraphId)?.order ?? 0) || x.spanStart - y.spanStart)[0];
    const paragraphId = firstLocMention?.paragraphId ?? s.firstParagraphId;
    if (!paragraphId) continue;
    for (const hero of s.characters) {
      const list = byEntity.get(hero.id) ?? [];
      list.push({ sectionId: s.sectionId, sectionTitle: s.title, narrativeIndex: s.narrativeIndex, time: s.time!, positions: locIds, paragraphId, inferred: false });
      byEntity.set(hero.id, list);
    }
  }
  const conflicts = sceneConflicts(byEntity, locationNesting(relations));
  return writeSceneConflicts(repo, projectId, 'place', PLACE_RULE_ACTOR, conflicts, scan.ix, (c) => {
    const hero = scan.entities.get(c.entityId)?.name ?? c.entityId;
    return `Герой «${hero}» в той самий час (${whenLabel(c.a.time)} / ${whenLabel(c.b.time)}) — у двох місцях: ${names(c.a.positions, scan)} (сцена «${c.a.sectionTitle}») і ${names(c.b.positions, scan)} (сцена «${c.b.sectionTitle}»), без сцени переходу між ними${moreLabel(c.more)}.`;
  });
}

/** Поле «власник» (реєстр: «Назва, властивості, власник, стан») зі значення тега. */
function ownerField(m: MentionRow): string | null {
  const fields = (m.fields as { fields?: { name?: unknown; value?: unknown }[] }).fields;
  if (!Array.isArray(fields)) return null;
  const f = fields.find((x) => typeof x?.name === 'string' && x.name.trim().toLocaleLowerCase('uk') === 'власник');
  return typeof f?.value === 'string' && f.value.trim() ? f.value.trim() : null;
}

/** У самому тезі стоїть `@Ім'я` (П1) — власника названо явно, а не виведено з найближчого героя. */
function explicitSubject(text: string, m: MentionRow): boolean {
  const tag = text.slice(m.spanStart, m.spanEnd);
  const inner = /^\[\/[^:\]]+:([\s\S]*)\]$/.exec(tag);
  return !!inner && !!parseEntityValue(undefined, inner[1]).subject;
}

/**
 * Правило «предмет» (В5, б): той самий предмет у двох сценах, одночасних у
 * часі світу, у різних власників — і немає сцени передачі (третьої
 * одночасної сцени, де предмет у власників з обох боків). Власник згадки —
 * поле «власник» у тезі, а без нього — суб'єкт згадки (`@Ім'я`; без
 * приписки синхронізація бере найближчого героя — тоді доказ «непрямий», і
 * проблема — лише пропозиція `suggested`, як і за приблизного часу).
 */
export async function refreshObjectSceneContinuity(repo: CoreRepository, projectId: string): Promise<RefreshSceneRuleResult> {
  const points = await repo.listTimePoints(projectId);
  const scan = await scanScenes(repo, projectId, points);
  const objectTypes = new Set<string>(OBJECT_ENTITY_TYPES);
  const ownerByName = new Map<string, string | null>();
  const resolveOwner = async (name: string) => {
    if (!ownerByName.has(name)) {
      ownerByName.set(name, await repo.resolveAlias(projectId, 'character', name));
    }
    return ownerByName.get(name)!;
  };

  const perScene = new Map<string, ScenePosition>();
  for (const m of scan.mentions) {
    const e = scan.entities.get(m.entityId);
    if (!e || !objectTypes.has(e.type)) continue;
    const sectionId = scan.sectionOfParagraph.get(m.paragraphId);
    const s = sectionId ? scan.bySection.get(sectionId) : undefined;
    if (!s || !span(s.time)) continue;
    const text = scan.ix.paragraphs.get(m.paragraphId)?.text ?? '';
    const field = ownerField(m);
    const fieldOwner = field ? await resolveOwner(field) : null;
    const owner = fieldOwner ?? m.subjectEntityId;
    if (!owner || scan.entities.get(owner)?.type !== 'character') continue;
    const inferred = !fieldOwner && !explicitSubject(text, m);
    const key = `${e.id}|${s.sectionId}`;
    const cur = perScene.get(key);
    if (!cur) {
      perScene.set(key, { sectionId: s.sectionId, sectionTitle: s.title, narrativeIndex: s.narrativeIndex, time: s.time!, positions: new Set([owner]), paragraphId: m.paragraphId, inferred });
    } else {
      cur.positions.add(owner);
      cur.inferred = cur.inferred || inferred;
    }
  }
  const byEntity = new Map<string, ScenePosition[]>();
  for (const [key, p] of perScene) {
    const entityId = key.slice(0, key.indexOf('|'));
    byEntity.set(entityId, [...(byEntity.get(entityId) ?? []), p]);
  }
  const conflicts = sceneConflicts(byEntity, (x, y) => x === y);
  return writeSceneConflicts(repo, projectId, 'object', OBJECT_RULE_ACTOR, conflicts, scan.ix, (c) => {
    const obj = scan.entities.get(c.entityId)?.name ?? c.entityId;
    const hint = c.a.inferred || c.b.inferred ? ' Власника в одній зі сцен визначено за найближчим героєм, не явно — перевірте.' : '';
    return `Предмет «${obj}» в той самий час (${whenLabel(c.a.time)} / ${whenLabel(c.b.time)}) — у двох власників: ${names(c.a.positions, scan)} (сцена «${c.a.sectionTitle}») і ${names(c.b.positions, scan)} (сцена «${c.b.sectionTitle}»), без сцени передачі між ними${moreLabel(c.more)}.${hint}`;
  });
}

export interface RefreshPlaceObjectResult extends RefreshSceneRuleResult {
  /** Окремо — що дали теги сцен, і що — суперечності рис (trait_contradiction на всіх мітках). */
  parts: { scenes: Omit<RefreshSceneRuleResult, 'issues'>; traits: Omit<RefreshTraitContradictionsResult, 'issues'> };
}

function combine(scenes: RefreshSceneRuleResult, traits: RefreshTraitContradictionsResult): RefreshPlaceObjectResult {
  const strip = <T extends { issues: unknown }>({ issues: _i, ...rest }: T) => rest;
  return {
    checked: scenes.checked + traits.checked,
    created: scenes.created + traits.created,
    updated: scenes.updated + traits.updated,
    skipped: scenes.skipped + traits.skipped,
    issues: [...scenes.issues, ...traits.issues],
    parts: { scenes: strip(scenes), traits: strip(traits) },
  };
}

/** Правило «місце» повністю (§2 п.4 плану): (а) риси локацій і світу, (б) герой у двох місцях одночасно. */
export async function refreshPlaceContinuity(repo: CoreRepository, projectId: string): Promise<RefreshPlaceObjectResult> {
  const scenes = await refreshPlaceSceneContinuity(repo, projectId);
  const traits = await refreshTraitContradictions(repo, projectId, { kind: 'place', entityTypes: PLACE_ENTITY_TYPES });
  return combine(scenes, traits);
}

/** Правило «предмет» повністю (§2 п.5 плану): (а) риси предмета, (б) предмет у двох власників одночасно. */
export async function refreshObjectContinuity(repo: CoreRepository, projectId: string): Promise<RefreshPlaceObjectResult> {
  const scenes = await refreshObjectSceneContinuity(repo, projectId);
  const traits = await refreshTraitContradictions(repo, projectId, { kind: 'object', entityTypes: OBJECT_ENTITY_TYPES });
  return combine(scenes, traits);
}

// ── В6: повторна перевірка лише змінених місць ──────────────────────────

/**
 * Відбиток тексту абзаців-доказів проблеми (`checkedHash`): змінився текст
 * бодай одного з двох абзаців — відбиток інший. Доказ без абзацу (риса,
 * В3/В5) — `null`: тексту, що міг би змінитись, немає.
 */
export function continuityEvidenceHash(textOf: Map<string, string>, a: ContinuityEvidence, b: ContinuityEvidence | null): string | null {
  const ids = [a.paragraphId, b?.paragraphId].filter((x): x is string => !!x);
  if (!ids.length) return null;
  const h = createHash('sha256');
  for (const id of ids) h.update(`${id}\u0000${blockHash(textOf.get(id) ?? '')}\u0001`);
  return h.digest('hex').slice(0, 24);
}

/** Текст живих абзаців книги — для відбитка доказів. */
function paragraphTexts(ix: BookIndex): Map<string, string> {
  return new Map([...ix.paragraphs.values()].filter((p) => !p.deletedAt).map((p) => [p.id, p.text]));
}

/** Хто позначає проблему «на перегляд» (зміна статусу пише актора в `createdBy`). */
const REVIEW_ACTOR = 'system:continuity-review';

export interface ContinuityReviewResult {
  /** Позначено «на перегляд»: текст абзацу-доказу змінився чи абзац видалено. */
  flagged: number;
  /** Проблеми без відбитка (знайдені до В6) — прийнято поточний текст як перевірений. */
  baselined: number;
  notifications: number;
}

/**
 * Повторна перевірка лише змінених місць (В6, за зразком
 * `visual.ts: refreshVisualReview`): для відкритих проблем
 * (`suggested`/`confirmed`), чиї абзаци-докази серед `paragraphIds`
 * (типово — змінені синхронізацією; без переліку — усі), відбиток тексту
 * рахується наново: збігся — нічого, розбігся — `needs_review` і ОДНЕ
 * сповіщення на сутність (не на кожну проблему й не на весь розділ).
 * Вирішені автором (`dismissed`/`resolved`) не чіпаються — виправлення
 * тексту після `resolved` саме так і мало статись.
 */
export async function refreshContinuityReview(repo: CoreRepository, projectId: string, opts: { paragraphIds?: string[] } = {}): Promise<ContinuityReviewResult> {
  const out: ContinuityReviewResult = { flagged: 0, baselined: 0, notifications: 0 };
  const scope = opts.paragraphIds ? new Set(opts.paragraphIds) : null;
  const issues = (await repo.listContinuityIssues(projectId)).filter((i) => {
    if (i.status !== 'suggested' && i.status !== 'confirmed') return false;
    const ids = [i.evidenceA.paragraphId, i.evidenceB?.paragraphId].filter((x): x is string => !!x);
    return ids.length > 0 && (!scope || ids.some((id) => scope.has(id)));
  });
  if (!issues.length) return out;
  const textOf = paragraphTexts(await bookIndex(repo, projectId));
  const flaggedBy = new Map<string, ContinuityIssueRow[]>();
  for (const i of issues) {
    const now = continuityEvidenceHash(textOf, i.evidenceA, i.evidenceB);
    if (i.checkedHash == null) {
      // До В6 відбитка не писали. Змінений абзац без відбитка — не знаємо, з чим звіряли: на перегляд.
      if (scope) {
        await repo.setContinuityIssueStatus(projectId, i.id, 'needs_review', REVIEW_ACTOR);
        out.flagged++;
        flaggedBy.set(i.entityId ?? '', [...(flaggedBy.get(i.entityId ?? '') ?? []), i]);
      } else {
        await repo.upsertContinuityIssue({ id: i.id, projectId, kind: i.kind, entityId: i.entityId, summary: i.summary, evidenceA: i.evidenceA, evidenceB: i.evidenceB, insufficientData: i.insufficientData, status: i.status, source: i.source, checkedHash: now, createdBy: i.createdBy });
        out.baselined++;
      }
    } else if (i.checkedHash !== now) {
      await repo.setContinuityIssueStatus(projectId, i.id, 'needs_review', REVIEW_ACTOR);
      out.flagged++;
      flaggedBy.set(i.entityId ?? '', [...(flaggedBy.get(i.entityId ?? '') ?? []), i]);
    }
  }
  if (flaggedBy.size) {
    const names = new Map((await repo.listEntities(projectId)).map((e) => [e.id, e.name]));
    for (const [entityId, list] of flaggedBy) {
      const who = entityId ? `«${names.get(entityId) ?? '?'}»` : 'без головної сутності';
      await repo.addNotification({
        projectId,
        kind: 'continuity_needs_review',
        message: `Текст доказів змінився — проблеми безперервності ${who} на перегляд: ${list.length}`,
        paragraphIds: [...new Set(list.flatMap((i) => [i.evidenceA.paragraphId, i.evidenceB?.paragraphId]).filter((x): x is string => !!x))],
        payload: { entityId: entityId || null, issueIds: list.map((i) => i.id), sectionIds: [...new Set(list.flatMap((i) => [i.evidenceA.sectionId, i.evidenceB?.sectionId]).filter(Boolean))] },
      });
      out.notifications++;
    }
  }
  return out;
}

/** Розділи, де є проблеми «на перегляд» — їх і переганяє AI-2 командою «змінені місця». */
export async function sectionsNeedingReview(repo: CoreRepository, projectId: string): Promise<string[]> {
  const issues = await repo.listContinuityIssues(projectId, { status: 'needs_review' });
  return [...new Set(issues.flatMap((i) => [i.evidenceB?.sectionId ?? i.evidenceA.sectionId]))];
}

// ── В8: сторінка 8 — огляд для інтерфейсу ───────────────────────────────

export interface ContinuityPlace {
  paragraphId: string | null;
  editorPid: string | null;
  sectionId: string;
  sectionTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  /** Абзацу чи розділу вже немає в книзі (видалено після перевірки). */
  missing: boolean;
}

export interface ContinuityOverview {
  issues: ContinuityIssueRow[];
  /** Де в книзі кожен доказ: ключ — `paragraphId` або `section:<id>` (риса без абзацу). */
  places: Record<string, ContinuityPlace>;
  entities: Record<string, { name: string; type: string }>;
  /** Лічильники по всій книзі (без фільтрів) — для вкладок і фільтрів. */
  counts: { byKind: Record<string, number>; byStatus: Record<string, number>; total: number };
}

export const continuityPlaceKey = (e: ContinuityEvidence) => e.paragraphId ?? `section:${e.sectionId}`;

function placeFor(ix: BookIndex, e: ContinuityEvidence): ContinuityPlace {
  const p = e.paragraphId ? ix.paragraphs.get(e.paragraphId) : undefined;
  const section = ix.docs.get(p?.documentId ?? e.sectionId);
  const chapter = section ? (section.kind === 'chapter' ? section : section.parentId ? ix.docs.get(section.parentId) : undefined) : undefined;
  const chapterId = chapter && !chapter.deletedAt ? chapter.id : null;
  return {
    paragraphId: e.paragraphId,
    editorPid: p ? p.editorPid ?? p.id : null,
    sectionId: section?.id ?? e.sectionId,
    sectionTitle: section?.title ?? '',
    chapterId,
    chapterNumber: chapterId ? ix.chapterNo.get(chapterId) ?? null : null,
    missing: !section || !!section.deletedAt || (!!e.paragraphId && (!p || !!p.deletedAt)),
  };
}

/**
 * Проблеми для сторінки 8 разом з усім, що треба показати їх без додаткових
 * запитів: місце кожного доказу в книзі (глава, розділ, абзац редактора —
 * «відкрити в тексті»), назви сутностей і лічильники. Порядок — спершу ті,
 * що чекають автора (на перегляд, пропозиції), далі підтверджені, наприкінці
 * вирішені.
 */
export async function continuityOverview(
  repo: CoreRepository,
  projectId: string,
  filter: { kind?: ContinuityIssueKind; status?: ContinuityIssueRow['status']; entityId?: string } = {},
): Promise<ContinuityOverview> {
  const [all, ix, entities] = await Promise.all([repo.listContinuityIssues(projectId), bookIndex(repo, projectId), repo.listEntities(projectId)]);
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const i of all) {
    byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  }
  const rank: Record<string, number> = { needs_review: 0, suggested: 1, confirmed: 2, resolved: 3, dismissed: 4 };
  const issues = all
    .filter((i) => (!filter.kind || i.kind === filter.kind) && (!filter.status || i.status === filter.status) && (!filter.entityId || i.entityId === filter.entityId))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const places: Record<string, ContinuityPlace> = {};
  const names = new Map(entities.map((e) => [e.id, e]));
  const used: Record<string, { name: string; type: string }> = {};
  for (const i of issues) {
    for (const e of [i.evidenceA, i.evidenceB]) {
      if (!e) continue;
      places[continuityPlaceKey(e)] ??= placeFor(ix, e);
      if (e.entityId && names.has(e.entityId)) used[e.entityId] = { name: names.get(e.entityId)!.name, type: names.get(e.entityId)!.type };
    }
    if (i.entityId && names.has(i.entityId)) used[i.entityId] = { name: names.get(i.entityId)!.name, type: names.get(i.entityId)!.type };
  }
  return { issues, places, entities: used, counts: { byKind, byStatus, total: all.length } };
}

export interface ContinuityTraitsOverview {
  entities: { id: string; name: string; type: string; traits: EntityTraitRow[] }[];
  sections: Record<string, { title: string; chapterNumber: number | null }>;
  /** Пропозицій AI-2, що чекають автора. */
  suggested: number;
}

/** Риси всіх сутностей книги, згруповані за сутністю (відхилені — ні): вкладка «Риси» сторінки 8. */
export async function continuityTraitsOverview(repo: CoreRepository, projectId: string): Promise<ContinuityTraitsOverview> {
  const [traits, entities, ix] = await Promise.all([repo.listEntityTraits(projectId), repo.listEntities(projectId), bookIndex(repo, projectId)]);
  const byEntity = new Map<string, EntityTraitRow[]>();
  for (const t of traits) if (t.status !== 'rejected') byEntity.set(t.entityId, [...(byEntity.get(t.entityId) ?? []), t]);
  const sections: ContinuityTraitsOverview['sections'] = {};
  for (const t of traits) {
    if (!t.sectionId || sections[t.sectionId]) continue;
    const s = ix.docs.get(t.sectionId);
    const chapterNumber = s?.parentId ? ix.chapterNo.get(s.parentId) ?? null : null;
    sections[t.sectionId] = { title: s?.title ?? '', chapterNumber };
  }
  const list = entities
    .filter((e) => byEntity.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      traits: byEntity.get(e.id)!.sort((a, b) => Number(b.status === 'suggested') - Number(a.status === 'suggested') || a.label.localeCompare(b.label, 'uk') || a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => b.traits.filter((t) => t.status === 'suggested').length - a.traits.filter((t) => t.status === 'suggested').length || a.name.localeCompare(b.name, 'uk'));
  return { entities: list, sections, suggested: traits.filter((t) => t.status === 'suggested').length };
}

export interface ContinuityRulesRun {
  rules: Record<'time' | 'age' | 'knowledge' | 'place' | 'object' | 'causality', { checked: number; created: number; updated: number; skipped: number }>;
  created: number;
  updated: number;
}

/** «Перевірити зараз» (В8): усі п'ять правил без AI поспіль — одна команда автора. */
export async function refreshAllContinuityRules(repo: CoreRepository, projectId: string): Promise<ContinuityRulesRun> {
  const pick = (r: { checked: number; created: number; updated: number; skipped: number }) => ({ checked: r.checked, created: r.created, updated: r.updated, skipped: r.skipped });
  const time = pick(await refreshTimeContinuity(repo, projectId));
  const age = pick(await refreshTraitContradictions(repo, projectId, { label: AGE_TRAIT_LABEL, kind: 'age' }));
  const knowledge = pick(await refreshKnowledgeContinuity(repo, projectId));
  const place = pick(await refreshPlaceContinuity(repo, projectId));
  const object = pick(await refreshObjectContinuity(repo, projectId));
  const causality = pick(await refreshCausalityContinuity(repo, projectId));
  const rules = { time, age, knowledge, place, object, causality };
  const all = Object.values(rules);
  return { rules, created: all.reduce((n, r) => n + r.created, 0), updated: all.reduce((n, r) => n + r.updated, 0) };
}
