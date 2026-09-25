/**
 * Хронологія (Т2.1, ТЗ-11 §7 «Story Timeline»).
 *
 * Дві шкали: `narrative_order` — порядок розкриття читачеві (порядок сцен у
 * книзі: глава, розділ) і `story_time` — час у світі книги (точки часу автора,
 * `story_time_points`). Сцена, чий час у світі раніший за час уже розказаних
 * сцен, — флешбек: вона показується окремо від поточного часу оповіді
 * (критерій сторінки 6). Паралельні лінії — сюжетні лінії (`/storyline`) у
 * сценах. Зв'язки часу — `precedes` / `follows` / `overlaps` (реєстр, К5);
 * суперечності між ними й датами — попередження з переходом до сцени.
 *
 * Знання героя в часі (для ТЗ-H, knowledge boundary): що герой міг знати до
 * сцени — розкриття таємниць, де він суб'єкт (`[/revelation:… @Герой]`),
 * події, у яких він брав участь чи був присутній, і підтверджені факти
 * профілю — лише з того, що сталося РАНІШЕ за сцену в часі світу (а якщо часу
 * немає — раніше в книзі). Флешбек, розказаний пізніше, не «знає» майбутнього.
 */

import type { CoreRepository, EntityRow, MentionRow, RelationRow, TimePointRow } from './types';
import { bookIndex, EVENT_TYPES, PROFILE_FACT, type BookIndex } from './characterProfile';
import { paragraphExcerpt } from './search/text';
import { describeStoryTime, type StoryTimeKind } from '../../src/utils/storyTime';

export const TIME_RELATIONS = new Set(['precedes', 'follows', 'overlaps']);

export interface TimeValue {
  kind: StoryTimeKind;
  start: string | null;
  end: string | null;
  key: number | null;
  endKey: number | null;
  label: string;
  /** Звідки: точка автора, порядок сцени зі Студії, успадковано від сцени. */
  source: 'author' | 'ai' | 'tag' | 'studio' | 'scene';
  status: string;
}

export interface TimelineScene {
  sectionId: string;
  title: string;
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string;
  /** Місце в порядку розкриття читачеві (1…N). */
  narrativeIndex: number;
  firstParagraphId: string | null;
  excerpt: string;
  time: TimeValue | null;
  /** Час у світі раніший за вже розказане — флешбек. */
  flashback: boolean;
  /** Сцена, після якої стався стрибок назад (для підпису). */
  flashbackAfter: string | null;
  characters: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  storylines: { id: string; name: string }[];
}

export interface TimelineEvent {
  entityId: string;
  name: string;
  type: string;
  sectionId: string | null;
  paragraphId: string | null;
  narrativeIndex: number | null;
  time: TimeValue | null;
}

export interface TimelineWarning {
  kind: 'relation_order' | 'relation_overlap' | 'cycle';
  message: string;
  subjects: string[];
  sectionId: string | null;
  chapterId: string | null;
  paragraphId: string | null;
}

export interface Timeline {
  scenes: TimelineScene[];
  events: TimelineEvent[];
  relations: { id: string; type: string; from: string; to: string; status: string }[];
  warnings: TimelineWarning[];
  lanes: { id: string; name: string }[];
  filters: { character: string | null; location: string | null; storyline: string | null };
}

export interface TimelineOptions {
  character?: string | null;
  location?: string | null;
  storyline?: string | null;
  /** Порядок сцени в часі світу зі Студії (`Scene.timelineOrder`), якщо автор його вів. */
  studioOrder?: Map<string, number>;
}

const fromPoint = (p: TimePointRow): TimeValue => ({
  kind: p.kind,
  start: p.start,
  end: p.end,
  key: p.sortKey,
  endKey: p.endKey,
  label: p.label || describeStoryTime({ kind: p.kind, start: p.start, end: p.end }),
  source: p.source,
  status: p.status,
});

interface SceneScan {
  scenes: TimelineScene[];
  bySection: Map<string, TimelineScene>;
  mentions: MentionRow[];
  entities: Map<string, EntityRow>;
  ix: BookIndex;
  sectionOfParagraph: Map<string, string>;
}

async function scanScenes(repo: CoreRepository, projectId: string, points: TimePointRow[], studioOrder?: Map<string, number>): Promise<SceneScan> {
  const [ix, entitiesAll] = await Promise.all([bookIndex(repo, projectId), repo.listEntities(projectId)]);
  const entities = new Map(entitiesAll.filter((e) => e.status !== 'rejected').map((e) => [e.id, e]));
  const sections = [...ix.docs.values()]
    .filter((d) => d.kind === 'section' && !d.deletedAt && d.parentId && ix.chapterNo.has(d.parentId))
    .sort((a, b) => ix.chapterNo.get(a.parentId!)! - ix.chapterNo.get(b.parentId!)! || a.order - b.order || a.id.localeCompare(b.id));
  const live = [...ix.paragraphs.values()].filter((p) => !p.deletedAt);
  const sectionOfParagraph = new Map(live.map((p) => [p.id, p.documentId]));
  const mentions = (await repo.listMentionsByParagraphs(projectId, live.map((p) => p.id))).filter((m) => m.status !== 'rejected');
  const scenePoints = new Map(points.filter((p) => p.subjectKind === 'scene' && p.status !== 'rejected').map((p) => [p.subjectId, p]));

  const scenes: TimelineScene[] = sections.map((s, i) => {
    const paras = live.filter((p) => p.documentId === s.id).sort((a, b) => a.order - b.order);
    const first = paras.find((p) => p.text.trim()) ?? paras[0];
    const chapter = ix.docs.get(s.parentId!);
    const point = scenePoints.get(s.id);
    const order = studioOrder?.get(s.id);
    const time: TimeValue | null = point
      ? fromPoint(point)
      : order && order > 0
        ? { kind: 'approximate', start: String(order), end: null, key: order, endKey: null, label: `порядок у світі: ${order}`, source: 'studio', status: 'confirmed' }
        : null;
    return {
      sectionId: s.id,
      title: s.title,
      chapterId: chapter?.id ?? null,
      chapterNumber: chapter ? ix.chapterNo.get(chapter.id) ?? null : null,
      chapterTitle: chapter?.title ?? '',
      narrativeIndex: i + 1,
      firstParagraphId: first?.id ?? null,
      excerpt: first ? paragraphExcerpt(first.text, 160) : '',
      time,
      flashback: false,
      flashbackAfter: null,
      characters: [],
      locations: [],
      storylines: [],
    };
  });
  const bySection = new Map(scenes.map((s) => [s.sectionId, s]));
  for (const m of mentions) {
    const sc = bySection.get(sectionOfParagraph.get(m.paragraphId) ?? '');
    const e = entities.get(m.entityId);
    if (!sc || !e) continue;
    const add = (list: { id: string; name: string }[], x: EntityRow) => {
      if (!list.some((y) => y.id === x.id)) list.push({ id: x.id, name: x.name });
    };
    if (e.type === 'character') add(sc.characters, e);
    if (e.type === 'location') add(sc.locations, e);
    if (e.type === 'storyline') add(sc.storylines, e);
    const subj = m.subjectEntityId ? entities.get(m.subjectEntityId) : undefined;
    if (subj?.type === 'character') add(sc.characters, subj);
  }

  // Флешбек: час у світі раніший за найпізніший уже розказаний.
  let maxKey: number | null = null;
  let maxScene: string | null = null;
  for (const sc of scenes) {
    const k = sc.time?.key;
    if (k == null) continue;
    if (maxKey != null && k < maxKey) {
      sc.flashback = true;
      sc.flashbackAfter = maxScene;
    } else if (maxKey == null || k >= maxKey) {
      maxKey = k;
      maxScene = sc.sectionId;
    }
  }
  return { scenes, bySection, mentions, entities, ix, sectionOfParagraph };
}

export async function buildTimeline(repo: CoreRepository, projectId: string, opts: TimelineOptions = {}): Promise<Timeline> {
  const [points, relationsAll] = await Promise.all([repo.listTimePoints(projectId), repo.listRelations(projectId)]);
  const scan = await scanScenes(repo, projectId, points, opts.studioOrder);
  const { scenes, bySection, mentions, entities, sectionOfParagraph, ix } = scan;
  const eventPoints = new Map(points.filter((p) => p.subjectKind === 'event' && p.status !== 'rejected').map((p) => [p.subjectId, p]));

  // Події: перша згадка в порядку книги; час — свій або сцени, де вперше згадано.
  const firstMention = new Map<string, { sectionId: string; paragraphId: string; narrativeIndex: number; order: number }>();
  for (const m of mentions) {
    const e = entities.get(m.entityId);
    if (!e || !EVENT_TYPES.has(e.type)) continue;
    const sectionId = sectionOfParagraph.get(m.paragraphId);
    const sc = sectionId ? bySection.get(sectionId) : undefined;
    if (!sc) continue;
    const order = ix.paragraphs.get(m.paragraphId)?.order ?? 0;
    const prev = firstMention.get(e.id);
    if (!prev || sc.narrativeIndex < prev.narrativeIndex || (sc.narrativeIndex === prev.narrativeIndex && order < prev.order)) {
      firstMention.set(e.id, { sectionId: sc.sectionId, paragraphId: m.paragraphId, narrativeIndex: sc.narrativeIndex, order });
    }
  }
  const eventIds = new Set([...firstMention.keys(), ...[...eventPoints.keys()].filter((id) => entities.has(id))]);
  const events: TimelineEvent[] = [...eventIds].map((id) => {
    const e = entities.get(id)!;
    const fm = firstMention.get(id);
    const own = eventPoints.get(id);
    const sceneTime = fm ? bySection.get(fm.sectionId)?.time ?? null : null;
    return {
      entityId: id,
      name: e.name,
      type: e.type,
      sectionId: fm?.sectionId ?? null,
      paragraphId: fm?.paragraphId ?? null,
      narrativeIndex: fm?.narrativeIndex ?? null,
      time: own ? fromPoint(own) : sceneTime ? { ...sceneTime, source: 'scene' as const } : null,
    };
  });
  const eventById = new Map(events.map((e) => [e.entityId, e]));

  // Зв'язки часу і суперечності.
  const relations = (relationsAll as RelationRow[]).filter((r) => TIME_RELATIONS.has(r.type) && r.status !== 'rejected' && entities.has(r.fromId) && entities.has(r.toId));
  const warnings: TimelineWarning[] = [];
  const where = (r: RelationRow, subject?: string) => {
    const pid = r.evidence.find((p) => sectionOfParagraph.has(p)) ?? (subject ? eventById.get(subject)?.paragraphId ?? null : null);
    const sid = pid ? sectionOfParagraph.get(pid) ?? null : null;
    return { paragraphId: pid, sectionId: sid, chapterId: sid ? bySection.get(sid)?.chapterId ?? null : null };
  };
  const nameOf = (id: string) => entities.get(id)?.name ?? id;
  const timeOf = (id: string) => eventById.get(id)?.time ?? null;
  const edges: [string, string][] = [];
  for (const r of relations) {
    const [a, b] = r.type === 'follows' ? [r.toId, r.fromId] : [r.fromId, r.toId];
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (r.type === 'overlaps') {
      if (ta?.key != null && tb?.key != null) {
        const aEnd = ta.endKey ?? ta.key;
        const bEnd = tb.endKey ?? tb.key;
        if (aEnd < tb.key || bEnd < ta.key) {
          warnings.push({ kind: 'relation_overlap', message: `«${nameOf(a)}» і «${nameOf(b)}» позначено як одночасні, але їхній час не перетинається (${ta.label} / ${tb.label}).`, subjects: [a, b], ...where(r, a) });
        }
      }
      continue;
    }
    edges.push([a, b]);
    if (ta?.key != null && tb?.key != null && ta.key > tb.key) {
      warnings.push({ kind: 'relation_order', message: `«${nameOf(a)}» має передувати «${nameOf(b)}», але в часі світу стоїть пізніше (${ta.label} > ${tb.label}).`, subjects: [a, b], ...where(r, a) });
    }
  }
  // Цикл «передує» (A → B → … → A).
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) adj.set(a, [...(adj.get(a) ?? []), b]);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const dfs = (v: string) => {
    state.set(v, 1);
    stack.push(v);
    for (const w of adj.get(v) ?? []) {
      if (state.get(w) === 1) {
        const cycle = stack.slice(stack.indexOf(w));
        const key = [...cycle].sort().join();
        if (!reported.has(key)) {
          reported.add(key);
          const ev = eventById.get(w);
          warnings.push({
            kind: 'cycle',
            message: `Замкнене коло «передує»: ${[...cycle, w].map(nameOf).join(' → ')}.`,
            subjects: cycle,
            sectionId: ev?.sectionId ?? null,
            chapterId: ev?.sectionId ? bySection.get(ev.sectionId)?.chapterId ?? null : null,
            paragraphId: ev?.paragraphId ?? null,
          });
        }
      } else if (!state.has(w)) dfs(w);
    }
    stack.pop();
    state.set(v, 2);
  };
  for (const v of adj.keys()) if (!state.has(v)) dfs(v);

  // Фільтри: за героєм, місцем, сюжетною лінією (сцени й події в них).
  const f = { character: opts.character || null, location: opts.location || null, storyline: opts.storyline || null };
  const sceneOk = (s: TimelineScene) =>
    (!f.character || s.characters.some((x) => x.id === f.character)) &&
    (!f.location || s.locations.some((x) => x.id === f.location)) &&
    (!f.storyline || s.storylines.some((x) => x.id === f.storyline));
  const shownScenes = scenes.filter(sceneOk);
  const shownIds = new Set(shownScenes.map((s) => s.sectionId));
  const lanes = new Map<string, string>();
  scenes.forEach((s) => s.storylines.forEach((l) => lanes.set(l.id, l.name)));
  return {
    scenes: shownScenes,
    events: events.filter((e) => !f.character && !f.location && !f.storyline ? true : !!e.sectionId && shownIds.has(e.sectionId)).sort((a, b) => (a.narrativeIndex ?? 1e9) - (b.narrativeIndex ?? 1e9)),
    relations: relations.map((r) => ({ id: r.id, type: r.type, from: r.fromId, to: r.toId, status: r.status })),
    warnings,
    lanes: [...lanes.entries()].map(([id, name]) => ({ id, name })),
    filters: f,
  };
}

// ── Знання героя в часі (ТЗ-H: knowledge boundary) ──────────────────────────

export interface KnownItem {
  kind: 'revelation' | 'event' | 'fact';
  name: string;
  detail: string;
  via: 'subject' | 'present' | 'profile';
  sectionId: string;
  paragraphId: string;
  narrativeIndex: number;
  time: string | null;
}

export interface Knowledge {
  character: { id: string; name: string };
  scene: { sectionId: string; title: string; narrativeIndex: number; time: string | null; flashback: boolean };
  known: KnownItem[];
  /** Скільки такого ж герой дізнається ПІСЛЯ цієї сцени (для автора, без змісту). */
  later: number;
  rule: string;
}

export async function characterKnowledge(repo: CoreRepository, projectId: string, characterId: string, sceneId: string, opts: TimelineOptions = {}): Promise<Knowledge | null> {
  const hero = await repo.getEntity(projectId, characterId);
  if (!hero || hero.status === 'rejected') return null;
  const points = await repo.listTimePoints(projectId);
  const scan = await scanScenes(repo, projectId, points, opts.studioOrder);
  const target = scan.bySection.get(sceneId);
  if (!target) return null;
  const before = (sectionId: string): boolean => {
    if (sectionId === target.sectionId) return false;
    const s = scan.bySection.get(sectionId);
    if (!s) return false;
    const a = s.time?.key;
    const b = target.time?.key;
    if (a != null && b != null) return a < b || (a === b && s.narrativeIndex < target.narrativeIndex);
    return s.narrativeIndex < target.narrativeIndex;
  };
  const items: (KnownItem & { known: boolean })[] = [];
  const push = (m: MentionRow, kind: KnownItem['kind'], via: KnownItem['via']) => {
    const e = scan.entities.get(m.entityId);
    const sectionId = scan.sectionOfParagraph.get(m.paragraphId);
    const s = sectionId ? scan.bySection.get(sectionId) : undefined;
    if (!e || !s) return;
    if (items.some((x) => x.name === e.name && x.sectionId === s.sectionId)) return;
    const value = (m.fields as any)?.value;
    items.push({
      kind,
      name: e.name,
      detail: typeof value === 'string' && value !== e.name ? value : '',
      via,
      sectionId: s.sectionId,
      paragraphId: m.paragraphId,
      narrativeIndex: s.narrativeIndex,
      time: s.time?.label ?? null,
      known: before(s.sectionId),
    });
  };
  const heroSections = new Set(scan.scenes.filter((s) => s.characters.some((c) => c.id === characterId)).map((s) => s.sectionId));
  for (const m of scan.mentions) {
    const e = scan.entities.get(m.entityId);
    if (!e) continue;
    if (e.type === 'revelation' && m.subjectEntityId === characterId) push(m, 'revelation', 'subject');
    else if (EVENT_TYPES.has(e.type)) {
      if (m.subjectEntityId === characterId) push(m, 'event', 'subject');
      else if (heroSections.has(scan.sectionOfParagraph.get(m.paragraphId) ?? '')) push(m, 'event', 'present');
    }
  }
  for (const f of await repo.listFindings(projectId, { entityId: characterId, status: 'confirmed' })) {
    if (f.kind !== PROFILE_FACT || f.visibility === 'hidden') continue;
    const secs = f.sourceParagraphIds.map((p) => scan.sectionOfParagraph.get(p)).filter((x): x is string => !!x);
    if (!secs.length) continue;
    const last = secs.map((s) => scan.bySection.get(s)!).filter(Boolean).sort((a, b) => b.narrativeIndex - a.narrativeIndex)[0];
    if (!last) continue;
    items.push({
      kind: 'fact',
      name: String((f.payload as any).statement ?? ''),
      detail: '',
      via: 'profile',
      sectionId: last.sectionId,
      paragraphId: f.sourceParagraphIds[0],
      narrativeIndex: last.narrativeIndex,
      time: last.time?.label ?? null,
      known: secs.every(before),
    });
  }
  const known = items.filter((i) => i.known).map(({ known: _k, ...rest }) => rest).sort((a, b) => a.narrativeIndex - b.narrativeIndex);
  return {
    character: { id: hero.id, name: hero.name },
    scene: { sectionId: target.sectionId, title: target.title, narrativeIndex: target.narrativeIndex, time: target.time?.label ?? null, flashback: target.flashback },
    known,
    later: items.length - known.length,
    rule: target.time?.key != null
      ? 'Відомо те, що сталося раніше за цю сцену в часі світу (сцени без часу — раніше в книзі).'
      : 'У сцени немає часу у світі — відомо те, що розказано раніше в книзі.',
  };
}
