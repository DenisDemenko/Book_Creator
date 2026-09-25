/**
 * Емоційний монітор (Т2.2, ТЗ-11 сторінка 4 «Emotion Analytics»).
 *
 * Емоційна динаміка героїв і зв'язок емоцій із подіями: криві по главах,
 * сценах або часу світу (Т2.1), для одного чи кількох героїв; основні,
 * другорядні й приховані емоції; три окремі показники — сила емоції героя,
 * майстерність її передачі в тексті, вплив на сюжет. Критерій сторінки 4:
 * **будь-яку оцінку можна відкрити й перевірити за її вихідними абзацами** —
 * тож кожне значення кривої (середнє глави, сцени чи моменту), кожен рядок
 * «до / після» й кожен настрій сцени несе `pointIds`, а кожна точка — абзац.
 *
 * Джерела точок не змішуються:
 *   • tag    — автор позначив емоцію в тексті: `[/emotion:страх — 7 @Олена]`
 *              (П1 — чия; П2 — друга частина — сила; «прихована» /
 *              «другорядна» серед частин — шар);
 *   • author — точка автора на сторінці (`emotion_points`), зокрема ручне
 *              коригування точки з тега (той самий герой, абзац і емоція —
 *              текст книги не змінюється);
 *   • ai     — пропозиція AI-2 (висновок `emotion_point`), яку автор
 *              підтвердив (можливо, уточнивши оцінки), — теж у `emotion_points`.
 * Непідтверджені пропозиції на криву не потрапляють — лише «на розгляд».
 *
 * «Недостатньо даних» — чесна позначка там, де висновку нема на чому
 * триматися: показник не оцінено, у героя мало точок, з одного боку події
 * точок немає, AI не знайшов доказу.
 *
 * Числа — евристика для редагування художнього тексту, не клінічний вимір.
 */

import type { CoreRepository, EmotionPointRow, EntityRow, FindingRow, MentionRow } from './types';
import { bookIndex, EVENT_TYPES, placeOf, profileParagraphs, type BookIndex, type ProfilePlace } from './characterProfile';
import type { AiRoleDeps, ModelFinding, PreparedFinding } from './ai/roles';
import { parseEntityValue } from '../../src/utils/coreEntities';
import { describeStoryTime } from '../../src/utils/storyTime';
import {
  DEFAULT_INTENSITY,
  EMOTION_FAMILIES,
  clampIntensity,
  emotionFamily,
  familyInfo,
  parseIntensity,
  parseLayer,
  type EmotionAxis,
  type EmotionFamily,
  type EmotionLayer,
  type EmotionMetric,
} from '../../src/utils/emotionScale';

/** Вид висновку AI-2 — пропозиція емоційної точки. */
export const EMOTION_POINT = 'emotion_point';
export const AI_EMOTIONS_JOB_KIND = 'ai_emotions';

/** Різниця сили між сусідніми точками, від якої стрибок без події — попередження. */
export const JUMP_THRESHOLD = 5;
/** Скільки глав з точками без змін — «монотонна крива». */
export const FLAT_MIN_CHAPTERS = 4;
/** Менше точок у героя — «недостатньо даних» для висновків про криву. */
export const MIN_POINTS = 3;

export interface MonitorPlace extends ProfilePlace {
  /** Місце на осі X вибраної шкали: номер відрізка + частка всередині (0…кількість відрізків). */
  x: number | null;
  /** Номер відрізка шкали (глава, сцена, момент часу світу); null — поза шкалою (сцена без часу світу). */
  bucket: number | null;
}

export interface EmotionPoint {
  /** Згадка (tag) або рядок `emotion_points` (author / ai). */
  id: string;
  source: 'tag' | 'author' | 'ai';
  characterId: string | null;
  characterName: string;
  emotion: string;
  family: EmotionFamily;
  layer: EmotionLayer;
  intensity: number;
  /** Сила не вказана в тезі — поставлено середину шкали. */
  estimated: boolean;
  /** null — не оцінено («недостатньо даних» для цього показника). */
  craft: number | null;
  impact: number | null;
  note: string;
  /** Автор скоригував точку з тега (текст не змінено); `tagIntensity` — як було в тезі. */
  corrected: boolean;
  tagIntensity: number | null;
  place: MonitorPlace;
}

export interface EmotionSeries {
  characterId: string;
  characterName: string;
  family: EmotionFamily;
  /** По відрізках шкали: середнє показника або null — точок з оцінкою немає. */
  values: (number | null)[];
  counts: number[];
  /** Докази кожного значення — точки, з яких воно пораховане. */
  pointIds: string[][];
}

export interface SceneMood {
  sectionId: string;
  title: string;
  chapterNumber: number | null;
  points: number;
  dominant: EmotionFamily;
  avgIntensity: number;
  /** −10…10: переважання важких (−) чи ресурсних (+) емоцій із вагою сили. */
  valence: number;
  firstParagraphId: string;
  editorPid: string;
  chapterId: string | null;
  pointIds: string[];
}

export interface EmotionWarning {
  kind: 'jump' | 'flat' | 'no_subject' | 'insufficient';
  message: string;
  characterId: string | null;
  paragraphId: string | null;
  editorPid: string | null;
  sectionId: string | null;
  chapterId: string | null;
  pointIds: string[];
}

export interface EmotionSuggestion {
  id: string;
  characterId: string | null;
  characterName: string;
  emotion: string;
  family: EmotionFamily;
  layer: EmotionLayer;
  intensity: number;
  craft: number | null;
  impact: number | null;
  statement: string;
  quote: string;
  needsReview: boolean;
  /** AI не знайшов доказу — «недостатньо даних»: підтвердити нема чого. */
  insufficient: boolean;
  place: MonitorPlace | null;
}

export interface ImpactRow {
  characterId: string;
  characterName: string;
  family: EmotionFamily;
  before: { avg: number; count: number } | null;
  after: { avg: number; count: number } | null;
  /** after − before; null — з одного боку точок немає («недостатньо даних»). */
  delta: number | null;
  pointIds: string[];
}

export interface EmotionImpact {
  event: { id: string; name: string; type: string; place: MonitorPlace };
  window: number;
  metric: EmotionMetric;
  rows: ImpactRow[];
}

export interface AxisBucket {
  key: string;
  label: string;
  title: string;
}

export interface EmotionMonitor {
  axis: EmotionAxis;
  metric: EmotionMetric;
  buckets: AxisBucket[];
  /** Для шкали часу світу: скільки точок у сценах без часу (на графік не потрапили). */
  untimed: number;
  chapters: { id: string; number: number; title: string }[];
  families: { key: EmotionFamily; label: string; color: string; valence: number; points: number }[];
  characters: { id: string; name: string; points: number }[];
  /** Вибрані герої (порожньо — усі). */
  selected: string[];
  points: EmotionPoint[];
  series: EmotionSeries[];
  /** Точки без оцінки вибраного показника — «недостатньо даних» для нього. */
  unscored: number;
  scenes: SceneMood[];
  warnings: EmotionWarning[];
  suggestions: EmotionSuggestion[];
  /** Події, рішення, конфлікти, пороги… (перша поява) — мітки на графіку і вибір для «до / після». */
  events: { id: string; name: string; type: string; chapterNumber: number | null; x: number | null }[];
  impact: EmotionImpact | null;
  /** Абзаци, де з'являються вибрані герої, — для ручної точки. */
  anchors: (MonitorPlace & { characterId: string })[];
  totals: { tag: number; author: number; ai: number; corrected: number; estimated: number; withoutSubject: number };
}

export interface MonitorOptions {
  /** Один чи кілька героїв; порожньо — усі. */
  characters?: string[] | null;
  family?: string | null;
  layer?: string | null;
  axis?: EmotionAxis | string | null;
  metric?: EmotionMetric | string | null;
  /** Подія для «до / після» і вікно в главах з обох боків (типово 2). */
  event?: string | null;
  window?: number;
  /** Порядок сцен у часі світу зі Студії (`Scene.timelineOrder`), коли точки часу немає. */
  studioOrder?: Map<string, number>;
  /** Які висновки AI бачить цей учасник (видимість, ТЗ-H §5.1). */
  visible?: (f: FindingRow) => boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const famIndex = (f: string) => EMOTION_FAMILIES.findIndex((x) => x.key === f);
const pointKey = (characterId: string | null, paragraphId: string, emotion: string) => `${characterId ?? ''}\u0000${paragraphId}\u0000${emotion}`;
const metricOf = (p: EmotionPoint, m: EmotionMetric): number | null => (m === 'intensity' ? p.intensity : m === 'craft' ? p.craft : p.impact);

/**
 * Шкала X: відрізки (глави, сцени або моменти часу світу) і місце кожного
 * абзацу — номер відрізка + частка абзацу всередині нього.
 */
function buildAxis(ix: BookIndex, axis: EmotionAxis, worldKey: (sectionId: string) => { key: number; label: string } | null) {
  const places = [...ix.paragraphs.values()]
    .map((p) => placeOf(ix, p.id))
    .filter((p): p is ProfilePlace => !!p && p.chapterNumber != null)
    .sort((a, b) => a.position - b.position);
  const buckets: AxisBucket[] = [];
  const bucketOf = new Map<string, number>();
  if (axis === 'chapter') {
    ix.chapters.forEach((c, i) => buckets.push({ key: c.id, label: `гл. ${i + 1}`, title: c.title }));
    for (const p of places) bucketOf.set(p.paragraphId, p.chapterNumber! - 1);
  } else if (axis === 'scene') {
    const seen = new Map<string, number>();
    for (const p of places) {
      if (!seen.has(p.sectionId)) {
        seen.set(p.sectionId, buckets.length);
        buckets.push({ key: p.sectionId, label: `${p.chapterNumber}.${buckets.filter((b) => b.label.startsWith(`${p.chapterNumber}.`)).length + 1}`, title: p.sectionTitle });
      }
      bucketOf.set(p.paragraphId, seen.get(p.sectionId)!);
    }
  } else {
    const keys = new Map<number, string>();
    for (const p of places) {
      const w = worldKey(p.sectionId);
      if (w && !keys.has(w.key)) keys.set(w.key, w.label);
    }
    const sorted = [...keys.entries()].sort((a, b) => a[0] - b[0]);
    const idx = new Map(sorted.map(([k], i) => [k, i]));
    sorted.forEach(([k, label]) => buckets.push({ key: String(k), label, title: label }));
    for (const p of places) {
      const w = worldKey(p.sectionId);
      if (w) bucketOf.set(p.paragraphId, idx.get(w.key)!);
    }
  }
  // Частка всередині відрізка — за порядком абзаців у книзі.
  const inBucket = new Map<number, string[]>();
  for (const p of places) {
    const b = bucketOf.get(p.paragraphId);
    if (b == null) continue;
    inBucket.set(b, [...(inBucket.get(b) ?? []), p.paragraphId]);
  }
  const x = new Map<string, number>();
  for (const [b, ids] of inBucket) ids.forEach((id, i) => x.set(id, Math.round((b + (i + 0.5) / ids.length) * 100) / 100));
  const place = (paragraphId: string): MonitorPlace | null => {
    const pl = placeOf(ix, paragraphId);
    if (!pl) return null;
    return { ...pl, x: x.get(paragraphId) ?? null, bucket: bucketOf.get(paragraphId) ?? null };
  };
  return { buckets, place };
}

/** Точка з тега `/emotion`: назва — сутність, сила — друга частина значення, шар — слово серед частин. */
function tagPoint(m: MentionRow, emotion: EntityRow, hero: EntityRow | undefined, place: MonitorPlace): EmotionPoint {
  const value = typeof (m.fields as Record<string, unknown>)?.value === 'string' ? String((m.fields as Record<string, unknown>).value) : emotion.name;
  const parsed = parseEntityValue('emotion', value);
  const intensity = parseIntensity(parsed.parts);
  const layer = parseLayer(parsed.parts);
  return {
    id: m.id,
    source: 'tag',
    characterId: hero?.id ?? null,
    characterName: hero?.name ?? '',
    emotion: emotion.name.toLocaleLowerCase('uk'),
    family: emotionFamily(emotion.name),
    layer,
    intensity: intensity ?? DEFAULT_INTENSITY,
    estimated: intensity == null,
    craft: null,
    impact: null,
    note: parsed.parts.slice(2).filter((x) => x && parseLayer(['', x]) === 'primary' && parseIntensity(['', x]) == null).join(' · '),
    corrected: false,
    tagIntensity: null,
    place,
  };
}

function storedPoint(p: EmotionPointRow, hero: EntityRow | undefined, place: MonitorPlace, tag: EmotionPoint | undefined): EmotionPoint {
  return {
    id: p.id,
    source: p.source,
    characterId: p.characterId,
    characterName: hero?.name ?? '',
    emotion: p.emotion,
    family: (famIndex(p.family) >= 0 ? p.family : 'other') as EmotionFamily,
    layer: p.layer,
    intensity: p.intensity,
    estimated: false,
    craft: p.craft,
    impact: p.impact,
    note: p.note,
    corrected: !!tag,
    tagIntensity: tag ? tag.intensity : null,
    place,
  };
}

export async function buildEmotionMonitor(repo: CoreRepository, projectId: string, opts: MonitorOptions = {}): Promise<EmotionMonitor> {
  const [ix, entities, stored, findings, timePoints] = await Promise.all([
    bookIndex(repo, projectId),
    repo.listEntities(projectId),
    repo.listEmotionPoints(projectId),
    repo.listFindings(projectId),
    repo.listTimePoints(projectId),
  ]);
  const axis: EmotionAxis = opts.axis === 'scene' || opts.axis === 'world' ? opts.axis : 'chapter';
  const metric: EmotionMetric = opts.metric === 'craft' || opts.metric === 'impact' ? opts.metric : 'intensity';
  const sceneTime = new Map(timePoints.filter((t) => t.subjectKind === 'scene' && t.sortKey != null && t.status !== 'rejected').map((t) => [t.subjectId, t]));
  const worldKey = (sectionId: string) => {
    const t = sceneTime.get(sectionId);
    if (t) return { key: t.sortKey!, label: describeStoryTime(t) };
    const n = opts.studioOrder?.get(sectionId);
    return n != null ? { key: n, label: `порядок у світі: ${n}` } : null;
  };
  const { buckets, place } = buildAxis(ix, axis, worldKey);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const live = [...ix.paragraphs.values()].filter((p) => !p.deletedAt && placeOf(ix, p.id));
  const mentions = (await repo.listMentionsByParagraphs(projectId, live.map((p) => p.id))).filter((m) => m.status !== 'rejected');
  const heroOf = (id: string | null | undefined) => {
    const e = id ? byId.get(id) : undefined;
    return e && e.type === 'character' && e.status !== 'rejected' ? e : undefined;
  };

  // ── Усі точки книги: теги, поверх них — коригування й точки автора / AI ──
  const byKey = new Map<string, EmotionPoint>();
  for (const m of mentions) {
    const e = byId.get(m.entityId);
    if (!e || e.type !== 'emotion' || e.status === 'rejected') continue;
    const pl = place(m.paragraphId);
    if (!pl) continue;
    const p = tagPoint(m, e, heroOf(m.subjectEntityId), pl);
    const k = pointKey(p.characterId, pl.paragraphId, p.emotion);
    if (!byKey.has(k)) byKey.set(k, p);
  }
  for (const s of stored) {
    const hero = heroOf(s.characterId);
    const pl = place(s.paragraphId);
    if (!hero || !pl) continue;
    const k = pointKey(s.characterId, s.paragraphId, s.emotion);
    const tag = byKey.get(k)?.source === 'tag' ? byKey.get(k) : undefined;
    if (s.status === 'rejected') {
      // Відхилене автором — ховає й тег (текст лишається, на криву не йде).
      byKey.delete(k);
      continue;
    }
    if (s.status !== 'confirmed') continue;
    byKey.set(k, storedPoint(s, hero, pl, tag));
  }
  const all = [...byKey.values()].sort((a, b) => a.place.position - b.place.position || a.emotion.localeCompare(b.emotion, 'uk'));

  const characterCounts = new Map<string, { id: string; name: string; points: number }>();
  for (const p of all) {
    if (!p.characterId) continue;
    const c = characterCounts.get(p.characterId) ?? { id: p.characterId, name: p.characterName, points: 0 };
    c.points++;
    characterCounts.set(p.characterId, c);
  }
  const characters = [...characterCounts.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'uk'));

  const selected = [...new Set((opts.characters ?? []).filter((id) => heroOf(id)))];
  const pick = new Set(selected);
  const family = opts.family && famIndex(opts.family) >= 0 ? (opts.family as EmotionFamily) : null;
  const layer = opts.layer === 'primary' || opts.layer === 'secondary' || opts.layer === 'hidden' ? opts.layer : null;
  const points = all.filter((p) => (!pick.size || (p.characterId && pick.has(p.characterId))) && (!family || p.family === family) && (!layer || p.layer === layer));
  // Лічильники — для того, що зараз на екрані.
  const totals = {
    tag: points.filter((p) => p.source === 'tag').length,
    author: points.filter((p) => p.source === 'author').length,
    ai: points.filter((p) => p.source === 'ai').length,
    corrected: points.filter((p) => p.corrected).length,
    estimated: points.filter((p) => p.estimated).length,
    withoutSubject: points.filter((p) => !p.characterId).length,
  };

  // ── Криві: герой × родина × відрізок шкали, вибраний показник ──
  const groups = new Map<string, EmotionPoint[]>();
  for (const p of points) {
    if (!p.characterId) continue;
    const k = `${p.characterId}\u0000${p.family}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const nb = buckets.length;
  let unscored = 0;
  const series: EmotionSeries[] = [];
  for (const ps of groups.values()) {
    const values: (number | null)[] = Array(nb).fill(null);
    const counts: number[] = Array(nb).fill(0);
    const pointIds: string[][] = Array.from({ length: nb }, () => []);
    for (const p of ps) {
      const v = metricOf(p, metric);
      if (v == null) {
        unscored++;
        continue;
      }
      if (p.place.bucket == null) continue;
      counts[p.place.bucket]++;
      pointIds[p.place.bucket].push(p.id);
    }
    for (let i = 0; i < nb; i++) {
      const vs = ps.filter((p) => p.place.bucket === i).map((p) => metricOf(p, metric)).filter((v): v is number => v != null);
      values[i] = vs.length ? avg(vs) : null;
    }
    if (values.some((v) => v != null)) series.push({ characterId: ps[0].characterId!, characterName: ps[0].characterName, family: ps[0].family, values, counts, pointIds });
  }
  series.sort((a, b) => a.characterName.localeCompare(b.characterName, 'uk') || famIndex(a.family) - famIndex(b.family));
  const untimed = axis === 'world' ? points.filter((p) => p.characterId && p.place.bucket == null).length : 0;

  // ── Настрій сцен ──
  const bySection = new Map<string, EmotionPoint[]>();
  for (const p of points) bySection.set(p.place.sectionId, [...(bySection.get(p.place.sectionId) ?? []), p]);
  const scenes: SceneMood[] = [...bySection.values()].map((ps) => {
    const weight = new Map<EmotionFamily, number>();
    for (const p of ps) weight.set(p.family, (weight.get(p.family) ?? 0) + p.intensity);
    const dominant = [...weight.entries()].sort((a, b) => b[1] - a[1] || famIndex(a[0]) - famIndex(b[0]))[0][0];
    const first = ps[0].place;
    return {
      sectionId: first.sectionId,
      title: first.sectionTitle,
      chapterNumber: first.chapterNumber,
      points: ps.length,
      dominant,
      avgIntensity: avg(ps.map((p) => p.intensity)),
      valence: round1(ps.reduce((s, p) => s + familyInfo(p.family).valence * p.intensity, 0) / ps.length),
      firstParagraphId: first.paragraphId,
      editorPid: first.editorPid,
      chapterId: first.chapterId,
      pointIds: ps.map((p) => p.id),
    };
  });
  scenes.sort((a, b) => (placeOf(ix, a.firstParagraphId)?.position ?? 0) - (placeOf(ix, b.firstParagraphId)?.position ?? 0));

  // ── Події, рішення, конфлікти, пороги — мітки і межі ──
  const eventFirst = new Map<string, MonitorPlace>();
  const eventPositions: number[] = [];
  for (const m of mentions) {
    const e = byId.get(m.entityId);
    if (!e || !EVENT_TYPES.has(e.type) || e.status === 'rejected') continue;
    const pl = place(m.paragraphId);
    if (!pl) continue;
    eventPositions.push(pl.position);
    const prev = eventFirst.get(e.id);
    if (!prev || pl.position < prev.position) eventFirst.set(e.id, pl);
  }
  const events = [...eventFirst.entries()]
    .map(([id, pl]) => ({ id, name: byId.get(id)!.name, type: byId.get(id)!.type, chapterNumber: pl.chapterNumber, x: pl.x, position: pl.position }))
    .sort((a, b) => a.position - b.position)
    .map(({ position: _p, ...e }) => e);

  // ── Попередження (за порядком книги, сила емоції) ──
  const warnings: EmotionWarning[] = [];
  const at = (p: EmotionPoint | null) => ({
    paragraphId: p?.place.paragraphId ?? null,
    editorPid: p?.place.editorPid ?? null,
    sectionId: p?.place.sectionId ?? null,
    chapterId: p?.place.chapterId ?? null,
  });
  const chLabel = (n: number | null) => (n == null ? 'поза главами' : `гл. ${n}`);
  for (const ps of groups.values()) {
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1];
      const b = ps[i];
      if (Math.abs(b.intensity - a.intensity) < JUMP_THRESHOLD) continue;
      if (eventPositions.some((pos) => pos >= a.place.position && pos <= b.place.position)) continue;
      warnings.push({
        kind: 'jump',
        message: `${b.characterName}: ${familyInfo(b.family).label.toLocaleLowerCase('uk')} ${a.intensity} → ${b.intensity} (${chLabel(a.place.chapterNumber)} → ${chLabel(b.place.chapterNumber)}) — між точками немає події, рішення чи конфлікту. Чи вмотивована зміна?`,
        characterId: b.characterId,
        ...at(b),
        pointIds: [a.id, b.id],
      });
    }
  }
  const byHero = new Map<string, EmotionPoint[]>();
  for (const p of points) if (p.characterId) byHero.set(p.characterId, [...(byHero.get(p.characterId) ?? []), p]);
  for (const ps of byHero.values()) {
    const chapters = new Set(ps.map((p) => p.place.chapterNumber).filter((n) => n != null));
    const fams = new Set(ps.map((p) => p.family));
    const spread = Math.max(...ps.map((p) => p.intensity)) - Math.min(...ps.map((p) => p.intensity));
    if (chapters.size >= FLAT_MIN_CHAPTERS && fams.size === 1 && spread <= 1) {
      warnings.push({
        kind: 'flat',
        message: `${ps[0].characterName}: у ${chapters.size} главах лише «${familyInfo(ps[0].family).label.toLocaleLowerCase('uk')}» однакової сили — крива пласка. Можливо, героєві бракує розвитку (або так задумано).`,
        characterId: ps[0].characterId,
        ...at(ps[ps.length - 1]),
        pointIds: ps.map((p) => p.id),
      });
    }
    if (ps.length < MIN_POINTS) {
      warnings.push({
        kind: 'insufficient',
        message: `${ps[0].characterName}: недостатньо даних — лише ${ps.length} ${ps.length === 1 ? 'точка' : 'точки'}; висновки про криву ненадійні. Позначте емоції в тексті або запустіть пошук емоцій.`,
        characterId: ps[0].characterId,
        ...at(ps[0]),
        pointIds: ps.map((p) => p.id),
      });
    }
  }
  if (!pick.size) {
    const orphans = points.filter((p) => !p.characterId);
    if (orphans.length) {
      warnings.push({
        kind: 'no_subject',
        message: `Емоцій без героя: ${orphans.length}. Допишіть у тег чию: [/emotion:${orphans[0].emotion} @Ім'я] — тоді вони стануть на криву героя.`,
        characterId: null,
        ...at(orphans[0]),
        pointIds: orphans.map((p) => p.id),
      });
    }
  }

  // ── Пропозиції AI-2 на розгляд ──
  const visible = opts.visible ?? ((f: FindingRow) => f.visibility !== 'hidden');
  const suggestions: EmotionSuggestion[] = findings
    .filter((f) => f.kind === EMOTION_POINT && f.status === 'suggested' && visible(f))
    .filter((f) => !pick.size || (f.entityId && pick.has(f.entityId)))
    .map((f) => {
      const p = f.payload as Record<string, unknown>;
      const emotion = String(p.emotion ?? '').trim();
      const score = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : clampIntensity(Number(v)));
      return {
        id: f.id,
        characterId: f.entityId,
        characterName: heroOf(f.entityId)?.name ?? '',
        emotion,
        family: emotionFamily(emotion),
        layer: (p.layer === 'secondary' || p.layer === 'hidden' ? p.layer : 'primary') as EmotionLayer,
        intensity: clampIntensity(Number(p.intensity ?? DEFAULT_INTENSITY)),
        craft: score(p.craft),
        impact: score(p.impact),
        statement: String(p.statement ?? p.summary ?? ''),
        quote: typeof p.quote === 'string' ? p.quote : '',
        needsReview: f.needsReview,
        insufficient: f.insufficientData || !f.sourceParagraphIds.length,
        place: f.sourceParagraphIds[0] ? place(f.sourceParagraphIds[0]) : null,
      };
    })
    .filter((s) => (s.place || s.insufficient) && (!family || s.family === family))
    .sort((a, b) => (a.place?.position ?? Infinity) - (b.place?.position ?? Infinity));

  const famCounts = new Map<string, number>();
  for (const p of all.filter((p) => !pick.size || (p.characterId && pick.has(p.characterId)))) famCounts.set(p.family, (famCounts.get(p.family) ?? 0) + 1);

  const anchors: EmotionMonitor['anchors'] = [];
  if (pick.size) {
    const seen = new Set<string>();
    for (const m of mentions) {
      const who = pick.has(m.entityId) ? m.entityId : m.subjectEntityId && pick.has(m.subjectEntityId) ? m.subjectEntityId : null;
      if (!who || seen.has(`${who}\u0000${m.paragraphId}`)) continue;
      seen.add(`${who}\u0000${m.paragraphId}`);
      const pl = place(m.paragraphId);
      if (pl) anchors.push({ ...pl, characterId: who });
    }
    anchors.sort((a, b) => a.position - b.position);
    anchors.splice(300);
  }

  return {
    axis,
    metric,
    buckets,
    untimed,
    chapters: ix.chapters.map((c, i) => ({ id: c.id, number: i + 1, title: c.title })),
    families: EMOTION_FAMILIES.filter((f) => famCounts.has(f.key)).map((f) => ({ ...f, points: famCounts.get(f.key)! })),
    characters,
    selected,
    points,
    series,
    unscored,
    scenes,
    warnings,
    suggestions,
    events,
    impact: opts.event ? emotionImpact(points, opts.event, eventFirst, byId, opts.window, metric) : null,
    anchors,
    totals,
  };
}

/**
 * «До / після» події: середнє показника кожної емоції кожного героя в `window`
 * главах перед першою появою події і після неї (абзац самої події — межа).
 */
export function emotionImpact(
  points: EmotionPoint[],
  eventId: string,
  eventFirst: Map<string, MonitorPlace>,
  byId: Map<string, EntityRow>,
  window = 2,
  metric: EmotionMetric = 'intensity',
): EmotionImpact | null {
  const at = eventFirst.get(eventId);
  const e = byId.get(eventId);
  if (!at || !e) return null;
  const w = Math.max(1, Math.min(20, Math.floor(window) || 2));
  const n = at.chapterNumber ?? 0;
  const inWindow = (p: EmotionPoint) => p.place.chapterNumber != null && Math.abs(p.place.chapterNumber - n) <= w;
  const rows = new Map<string, { characterId: string; characterName: string; family: EmotionFamily; before: number[]; after: number[]; ids: string[] }>();
  for (const p of points) {
    const v = metricOf(p, metric);
    if (!p.characterId || v == null || !inWindow(p) || p.place.position === at.position) continue;
    const k = `${p.characterId}\u0000${p.family}`;
    const r = rows.get(k) ?? { characterId: p.characterId, characterName: p.characterName, family: p.family, before: [], after: [], ids: [] };
    (p.place.position < at.position ? r.before : r.after).push(v);
    r.ids.push(p.id);
    rows.set(k, r);
  }
  return {
    event: { id: e.id, name: e.name, type: e.type, place: at },
    window: w,
    metric,
    rows: [...rows.values()]
      .map((r) => {
        const before = r.before.length ? { avg: avg(r.before), count: r.before.length } : null;
        const after = r.after.length ? { avg: avg(r.after), count: r.after.length } : null;
        return { characterId: r.characterId, characterName: r.characterName, family: r.family, before, after, delta: before && after ? round1(after.avg - before.avg) : null, pointIds: r.ids };
      })
      .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || a.characterName.localeCompare(b.characterName, 'uk')),
  };
}

// ── AI-2: пропозиції емоційних точок ─────────────────────────────────────────

export function emotionTask(heroName: string): string {
  return [
    `Знайди в наданих абзацах емоційні стани персонажа «${heroName}» — лише його, не інших героїв.`,
    `Кожен висновок — один стан в одному абзаці: kind "emotion_point"; "emotion" — назва емоції одним-двома словами українською (страх, радість, провина, рішучість, гнів, сум, любов, надія…);`,
    `"layer" — "primary" (основна), "secondary" (другорядна) або "hidden" (прихована: герой її не показує, видно з підтексту);`,
    `"intensity" — сила емоції героя 0–10; "craft" — майстерність передачі в тексті 0–10 (10 — показано дією, тілом, підтекстом; 0–3 — лише назване); "impact" — вплив на сюжет 0–10 (чи змінює емоція рішення й події);`,
    `"summary" — чому ти так вважаєш, одним реченням; paragraph_ids — рівно один абзац; quote — дослівна цитата-доказ.`,
    `Не вигадуй: якщо стану в абзаці не видно — не пиши висновок. Якщо емоція натякнута, але доказу замало — kind "emotion_point" з insufficient_data: true і без paragraph_ids.`,
    `Оцінки — евристика для редагування художнього тексту, не клінічний вимір; зважай на жанр.`,
  ].join('\n');
}

/** Обробка пропозицій AI-2: лише емоції героя, по абзацу, без повторів уже відомого. */
export function createEmotionPreparer(characterId: string, known: { paragraphId: string; family: string }[]) {
  const seen = new Set(known.map((k) => `${k.paragraphId}\u0000${k.family}`));
  const score = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : clampIntensity(Number(v)));
  return async (f: ModelFinding, evidence: { paragraphIds: string[] }): Promise<PreparedFinding[]> => {
    if (f.kind !== EMOTION_POINT && f.kind !== 'emotion') return [];
    const emotion = String(f.emotion ?? f.entity_name ?? '').trim().toLocaleLowerCase('uk').slice(0, 80);
    if (!emotion) return [];
    const family = emotionFamily(emotion);
    const payload = {
      emotion,
      family,
      layer: f.layer === 'secondary' || f.layer === 'hidden' ? f.layer : 'primary',
      intensity: clampIntensity(Number(f.intensity ?? DEFAULT_INTENSITY)),
      craft: score(f.craft),
      impact: score(f.impact),
      statement: String(f.summary ?? ''),
      quote: typeof f.quote === 'string' ? f.quote : '',
    };
    if (!evidence.paragraphIds.length) {
      // «Недостатньо даних» — чесна позначка без доказу (раз на емоцію).
      const k = `insufficient\u0000${family}`;
      if (!f.insufficient_data || seen.has(k)) return [];
      seen.add(k);
      return [{ kind: EMOTION_POINT, entityId: characterId, payload: { ...payload, insufficient: true }, paragraphIds: [] }];
    }
    const out: PreparedFinding[] = [];
    for (const pid of evidence.paragraphIds.slice(0, 1)) {
      const k = `${pid}\u0000${family}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ kind: EMOTION_POINT, entityId: characterId, payload, paragraphIds: [pid] });
    }
    return out;
  };
}

export interface AiEmotionsJobDeps {
  repo: () => CoreRepository | null;
  generate: AiRoleDeps['generate'];
  resolveModel: AiRoleDeps['resolveModel'];
  loadTemplate?: AiRoleDeps['loadTemplate'];
}

export function aiEmotionsJobKind(deps: AiEmotionsJobDeps) {
  return {
    maxAttempts: 2,
    rateLimit: { max: 10, windowMs: 60_000 },
    handler: async (ctx: {
      job: { projectId: string; payload: Record<string, unknown>; createdBy: string };
      signal: AbortSignal;
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
      recordUsage(u: { tokens?: number; requests?: number }): Promise<void>;
    }) => {
      const { runAiRole } = await import('./ai/roles');
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const projectId = ctx.job.projectId;
      const characterId = String(ctx.job.payload.characterId ?? '');
      const hero = await repo.getEntity(projectId, characterId);
      if (!hero || hero.type !== 'character') return { status: 'no_entity', points: 0 };
      const paragraphs = await profileParagraphs(repo, projectId, characterId);
      if (!paragraphs.length) return { status: 'nothing', points: 0 };
      // Уже відоме — теги, точки автора й будь-які попередні пропозиції (зокрема відхилені).
      const monitor = await buildEmotionMonitor(repo, projectId, { characters: [characterId] });
      const findings = await repo.listFindings(projectId, { entityId: characterId });
      const known = [
        ...monitor.points.map((p) => ({ paragraphId: p.place.paragraphId, family: p.family })),
        ...findings
          .filter((f) => f.kind === EMOTION_POINT)
          .map((f) => {
            const p = f.payload as Record<string, unknown>;
            const family = String(p.family ?? emotionFamily(String(p.emotion ?? '')));
            return { paragraphId: f.sourceParagraphIds[0] ?? 'insufficient', family };
          }),
      ];
      const project = await repo.getProject(projectId);
      await ctx.setProgress({ step: 'model', paragraphs: paragraphs.length });
      await ctx.checkpoint();
      const res = await runAiRole(
        { repo, generate: deps.generate, resolveModel: deps.resolveModel, loadTemplate: deps.loadTemplate, recordUsage: (u) => ctx.recordUsage(u) },
        {
          projectId,
          role: 'AI-2',
          task: emotionTask(hero.name),
          paragraphs,
          entityId: characterId,
          sourceRevision: project?.revision ?? null,
          createdBy: ctx.job.createdBy,
          signal: ctx.signal,
          prepare: createEmotionPreparer(characterId, known),
        },
      );
      if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
      return { runId: res.run.id, status: res.status, points: res.findings.length, rejected: res.rejected.length, paragraphs: paragraphs.length, errors: res.errors };
    },
  };
}
