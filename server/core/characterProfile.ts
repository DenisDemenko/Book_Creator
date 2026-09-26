/**
 * Жива біографія персонажа (Т1.5, ТЗ-11 §4) і Profile Builder (AI-2, ТЗ-H
 * §4.1 п.2).
 *
 * Профіль складається з частин, що мають РІЗНЕ походження, і сторінка їх не
 * змішує:
 *   • канон автора — картка героя в «Персонажах» (ім'я, роль, зовнішність,
 *     характер, біографія, портрет). ШІ її не змінює ніколи;
 *   • те, що автор уже позначив у тексті тегами: появи героя, його стани
 *     (`[/emotion:страх @Олена]`), події й рішення поруч із ним, — це
 *     підтверджені автором факти, у хронологічному порядку книги;
 *   • підтверджені зв'язки з графа (Т1.4);
 *   • факти Profile Builder (`profile_fact`) — доказові висновки AI-2 з
 *     оцінкою confirmed / suggested / contradicted / unknown (ТЗ-H). Факт,
 *     підтверджений автором, AI більше не змінює: повторний прогін не
 *     пропонує той самий факт удруге, а суперечність із затвердженим
 *     показує окремо як «суперечить».
 *
 * «Стан на главі N» — лише те, що має джерела в главах 1…N (без спойлерів
 * із пізніших): появи, стани, події, зв'язки й факти з пізніших глав, а також
 * картка автора (вона не прив'язана до глав) у цьому режимі приховані.
 *
 * Profile Builder — спільний для сторінки й агентів ТЗ-H: той самий
 * `buildCharacterProfile` дає доказовий snapshot.
 */

import type { CoreRepository, DocumentRow, EntityRow, FindingRow, MentionRow, ParagraphRow } from './types';
import { buildStoryGraph, evidenceRefs, type EvidenceRef } from './storyGraph';
import { heroPortrait } from './visual';
import { CORE_ENTITY_RELATIONS } from '../../src/utils/coreEntities';
import { paragraphExcerpt, searchStems } from './search/text';
import type { PreparedFinding, ModelFinding, AiRoleDeps } from './ai/roles';

export const PROFILE_FACT = 'profile_fact';

const relationName = (key: string) => CORE_ENTITY_RELATIONS.find((r) => r.key === key)?.nameUk ?? key;
export const AI_PROFILE_JOB_KIND = 'ai_profile';

/** Поля профілю, які заповнює Profile Builder (ТЗ-11 §4: цілі, потреби, переконання, стосунки…). */
export const PROFILE_FIELDS: { key: string; label: string }[] = [
  { key: 'appearance', label: 'Зовнішність' },
  { key: 'personality', label: 'Характер' },
  { key: 'biography', label: 'Біографія' },
  { key: 'goal', label: 'Цілі' },
  { key: 'need', label: 'Потреби' },
  { key: 'belief', label: 'Переконання' },
  { key: 'fear', label: 'Страхи' },
  { key: 'relationship', label: 'Стосунки' },
  { key: 'skill', label: 'Уміння' },
  { key: 'other', label: 'Інше' },
];
const FIELD_KEYS = new Set(PROFILE_FIELDS.map((f) => f.key));
export type FactAssessment = 'confirmed' | 'suggested' | 'contradicted' | 'unknown';

/** Типи сутностей — «події й рішення» в біографії. */
export const EVENT_TYPES = new Set(['event', 'decision', 'threshold', 'turning-point', 'conflict', 'revelation', 'consequence']);
/** Типи сутностей — стани героя для арки. */
export const STATE_TYPES = new Set(['emotion', 'character-state', 'belief', 'goal', 'need']);

// ── Канон автора: картка героя в Студії ──────────────────────────────────────

export interface StudioCharacterLike {
  id: string;
  name?: string;
  surname?: string;
  alias?: string;
  role?: string;
  age?: number;
  gender?: string;
  profession?: string;
  biography?: string;
  avatarUrl?: string;
  appearance?: Record<string, string | undefined>;
  personality?: Record<string, string | string[] | undefined>;
  relationships?: { targetCharacterId: string; type: string; description: string }[];
}

export interface CanonField {
  key: string;
  label: string;
  value: string;
}

const ROLE_UK: Record<string, string> = {
  protagonist: 'головний герой',
  antagonist: 'антагоніст',
  deuteragonist: 'другий головний',
  mentor: 'наставник',
  ally: 'союзник',
  rival: 'суперник',
  minor: 'другорядний',
};
const APPEARANCE_UK: Record<string, string> = {
  height: 'зріст',
  build: 'статура',
  hair: 'волосся',
  eyes: 'очі',
  face: 'обличчя',
  clothing: 'одяг',
  distinguishingMarks: 'прикмети',
};
const PERSONALITY_UK: Record<string, string> = {
  strengths: 'Сильні сторони',
  weaknesses: 'Слабкі сторони',
  fears: 'Страхи',
  desires: 'Бажання',
  goals: 'Цілі',
  motivation: 'Мотивація',
  internalConflict: 'Внутрішній конфлікт',
};

/** Картка героя → поля канону (лише заповнені). */
export function studioCanon(ch: StudioCharacterLike | null, others: StudioCharacterLike[] = []): { fields: CanonField[]; portraitUrl: string | null } {
  if (!ch) return { fields: [], portraitUrl: null };
  const out: CanonField[] = [];
  const add = (key: string, label: string, value: unknown) => {
    const v = Array.isArray(value) ? value.filter(Boolean).join('; ') : value == null ? '' : String(value).trim();
    if (v) out.push({ key, label, value: v });
  };
  add('role', 'Роль', ch.role ? ROLE_UK[ch.role] ?? ch.role : '');
  add('age', 'Вік', ch.age);
  add('gender', 'Стать', ch.gender);
  add('profession', 'Професія', ch.profession);
  add('alias', 'Прізвисько', ch.alias);
  const look = Object.entries(ch.appearance ?? {})
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${APPEARANCE_UK[k] ?? k}: ${String(v).trim()}`);
  add('appearance', 'Зовнішність', look.join('; '));
  for (const [k, v] of Object.entries(ch.personality ?? {})) add(`personality.${k}`, PERSONALITY_UK[k] ?? k, v);
  add('biography', 'Біографія', ch.biography);
  const rel = (ch.relationships ?? [])
    .map((r) => {
      const o = others.find((x) => x.id === r.targetCharacterId);
      const who = o ? [o.name, o.surname].filter(Boolean).join(' ') : '';
      return who ? `${who} — ${r.type}${r.description ? ` (${r.description})` : ''}` : '';
    })
    .filter(Boolean);
  add('relationships', 'Стосунки', rel);
  return { fields: out, portraitUrl: ch.avatarUrl || null };
}

/** Картка героя для сутності ядра: за зв'язком `studio:character:<id>` (Т0.6). */
export function studioFromBook(book: { characters?: StudioCharacterLike[] } | null | undefined, entity: EntityRow) {
  const all = (book?.characters ?? []) as StudioCharacterLike[];
  const ref = entity.externalRef?.startsWith('studio:character:') ? entity.externalRef.slice('studio:character:'.length) : String((entity.canonical as any)?.studioCharacterId ?? '');
  return { character: (ref && all.find((c) => c.id === ref)) || null, all };
}

// ── Профіль ─────────────────────────────────────────────────────────────────

export interface ProfilePlace extends EvidenceRef {
  sectionTitle: string;
  chapterNumber: number | null;
  /** Позиція в книзі: глава, розділ, абзац — для хронології. */
  position: number;
}

export interface ProfileFact {
  id: string;
  field: string;
  fieldLabel: string;
  statement: string;
  quote: string;
  /** Рішення автора щодо висновку AI: suggested — ще не розглянуто. */
  status: 'suggested' | 'confirmed' | 'rejected';
  /** Оцінка Profile Builder (ТЗ-H): чи тримається твердження на тексті. */
  assessment: FactAssessment;
  needsReview: boolean;
  sources: ProfilePlace[];
  chapterNumber: number | null;
  createdBy: string;
  createdAt: string;
}

export interface ProfileItem {
  entityId: string;
  type: string;
  name: string;
  /** Значення тега (`страх — 4`) або примітка зв'язку. */
  detail: string;
  via: 'tag' | 'relation' | 'scene';
  place: ProfilePlace | null;
}

export interface CharacterProfile {
  entity: { id: string; name: string; type: string; status: string };
  aliases: string[];
  /** Колишні імена (перейменування, П6) — з історії сутності. */
  formerNames: string[];
  /**
   * Канон автора. `portraitUrl` — портрет із бібліотеки ілюстрацій (Т2.3 В2:
   * підтверджений зв'язок «портрет»), а без нього — з картки героя;
   * `portraitSource` каже, звідки саме.
   */
  canon: { fields: CanonField[]; portraitUrl: string | null; portraitSource: 'link' | 'card' | null; hidden: boolean; linked: boolean };
  chapters: { id: string; number: number; title: string }[];
  upto: number | null;
  appearances: { total: number; items: ProfilePlace[] };
  timeline: ProfileItem[];
  arc: { initial: ProfileItem[]; intermediate: ProfileItem[]; current: ProfileItem[] };
  relations: { id: string; kind: 'relation' | 'tag'; type: string; label: string; direction: 'out' | 'in'; otherId: string; otherName: string; sources: EvidenceRef[] }[];
  facts: { confirmed: ProfileFact[]; suggested: ProfileFact[]; contradicted: ProfileFact[]; unknown: ProfileFact[] };
}

export interface BookIndex {
  paragraphs: Map<string, ParagraphRow>;
  docs: Map<string, DocumentRow>;
  chapters: DocumentRow[];
  chapterNo: Map<string, number>;
}

export async function bookIndex(repo: CoreRepository, projectId: string): Promise<BookIndex> {
  const [paragraphs, documents] = await Promise.all([repo.listAllParagraphs(projectId), repo.listDocuments(projectId)]);
  const docs = new Map(documents.map((d) => [d.id, d]));
  const chapters = documents.filter((d) => d.kind === 'chapter' && !d.deletedAt).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { paragraphs: new Map(paragraphs.map((p) => [p.id, p])), docs, chapters, chapterNo: new Map(chapters.map((c, i) => [c.id, i + 1])) };
}

/** Живий абзац → місце в книзі з позицією для хронології; null — абзацу немає. */
export function placeOf(ix: BookIndex, paragraphId: string): ProfilePlace | null {
  const p = ix.paragraphs.get(paragraphId);
  const section = p ? ix.docs.get(p.documentId) : undefined;
  if (!p || p.deletedAt || !section || section.deletedAt) return null;
  const chapter = section.kind === 'chapter' ? section : section.parentId ? ix.docs.get(section.parentId) : undefined;
  const chapterId = chapter && !chapter.deletedAt ? chapter.id : null;
  const chapterNumber = chapterId ? ix.chapterNo.get(chapterId) ?? null : null;
  return {
    paragraphId: p.id,
    editorPid: p.editorPid ?? p.id,
    sectionId: section.id,
    sectionTitle: section.title,
    chapterId,
    chapterNumber,
    excerpt: paragraphExcerpt(p.text, 220),
    position: (chapterNumber ?? 9999) * 1e8 + (section.kind === 'section' ? section.order : 0) * 1e4 + p.order,
  };
}

/** Затверджене автором — завжди «confirmed», хоч би як його оцінив AI. */
const assessmentOf = (f: FindingRow): FactAssessment => {
  if (f.status === 'confirmed') return 'confirmed';
  if (f.insufficientData || (f.payload as Record<string, unknown>).assessment === 'unknown') return 'unknown';
  if ((f.payload as Record<string, unknown>).assessment === 'contradicted') return 'contradicted';
  return 'suggested';
};

export function toProfileFact(ix: BookIndex, f: FindingRow): ProfileFact {
  const p = f.payload as Record<string, unknown>;
  const field = typeof p.field === 'string' && FIELD_KEYS.has(p.field) ? p.field : 'other';
  const sources = f.sourceParagraphIds.map((id) => placeOf(ix, id)).filter((x): x is ProfilePlace => !!x);
  const nums = sources.map((s) => s.chapterNumber).filter((n): n is number => n != null);
  return {
    id: f.id,
    field,
    fieldLabel: PROFILE_FIELDS.find((x) => x.key === field)!.label,
    statement: String(p.statement ?? p.summary ?? ''),
    quote: typeof p.quote === 'string' ? p.quote : '',
    status: f.status,
    assessment: assessmentOf(f),
    needsReview: f.needsReview,
    sources,
    chapterNumber: nums.length ? Math.max(...nums) : null,
    createdBy: f.createdBy,
    createdAt: f.createdAt,
  };
}

export interface ProfileOptions {
  /** «Стан на главі N» (номер з 1); null — уся книга. */
  upto?: number | null;
  /** Картка героя в Студії та решта героїв (для імен у стосунках). */
  studio?: { character: StudioCharacterLike | null; all: StudioCharacterLike[] };
}

export async function buildCharacterProfile(repo: CoreRepository, projectId: string, entityId: string, opts: ProfileOptions = {}): Promise<CharacterProfile | null> {
  const entity = await repo.getEntity(projectId, entityId);
  if (!entity || entity.status === 'rejected') return null;
  const [ix, aliases, versions, own, subjectAll, entities, findings, graph] = await Promise.all([
    bookIndex(repo, projectId),
    repo.listAliases(projectId, entityId),
    repo.listEntityVersions(projectId, entityId),
    repo.listMentionsByEntity(projectId, entityId),
    repo.listSubjectMentions(projectId),
    repo.listEntities(projectId),
    repo.listFindings(projectId, { entityId }),
    buildStoryGraph(repo, projectId, { focus: entityId, depth: 1, includeSuggested: false }),
  ]);
  const upto = opts.upto && opts.upto >= 1 ? Math.min(Math.floor(opts.upto), Math.max(1, ix.chapters.length)) : null;
  const visible = (place: { chapterNumber: number | null } | null): boolean =>
    !!place && (upto == null || (place.chapterNumber != null && place.chapterNumber <= upto));
  const entityById = new Map<string, EntityRow>(entities.map((e) => [e.id, e]));

  // Появи: згадки героя й абзаци, де він — суб'єкт чужого тега.
  const heroMentions = own.filter((m) => m.status !== 'rejected');
  const subjectOfHero = subjectAll.filter((m) => m.subjectEntityId === entityId && m.status !== 'rejected');
  const heroParagraphs = new Set([...heroMentions, ...subjectOfHero].map((m) => m.paragraphId));
  const places = [...heroParagraphs].map((id) => placeOf(ix, id)).filter(visible) as ProfilePlace[];
  places.sort((a, b) => a.position - b.position);

  // Стани (арка) і події — з тегів, де герой — суб'єкт, і з сусідства в тих самих абзацах.
  const item = (m: MentionRow, via: ProfileItem['via']): ProfileItem | null => {
    const e = entityById.get(m.entityId);
    if (!e || e.status === 'rejected') return null;
    const place = placeOf(ix, m.paragraphId);
    if (!visible(place)) return null;
    const value = (m.fields as Record<string, unknown>)?.value;
    return { entityId: e.id, type: e.type, name: e.name, detail: typeof value === 'string' ? value : '', via, place };
  };
  const states = subjectOfHero
    .map((m) => (STATE_TYPES.has(entityById.get(m.entityId)?.type ?? '') ? item(m, 'tag') : null))
    .filter((x): x is ProfileItem => !!x)
    .sort((a, b) => a.place!.position - b.place!.position);
  const byChapter = new Map<number, ProfileItem[]>();
  for (const s of states) {
    const n = s.place!.chapterNumber ?? 0;
    byChapter.set(n, [...(byChapter.get(n) ?? []), s]);
  }
  const chaptersWithStates = [...byChapter.keys()].sort((a, b) => a - b);
  const arc = {
    initial: chaptersWithStates.length ? byChapter.get(chaptersWithStates[0])! : [],
    intermediate: chaptersWithStates.length > 2 ? chaptersWithStates.slice(1, -1).flatMap((n) => byChapter.get(n)!) : [],
    current: chaptersWithStates.length > 1 ? byChapter.get(chaptersWithStates[chaptersWithStates.length - 1])! : [],
  };

  const timelineMap = new Map<string, ProfileItem>();
  const pushEvent = (it: ProfileItem | null) => {
    if (!it || !EVENT_TYPES.has(it.type)) return;
    const k = `${it.entityId}\u0000${it.place?.paragraphId ?? ''}`;
    if (!timelineMap.has(k) || it.via === 'tag') timelineMap.set(k, it);
  };
  for (const m of subjectOfHero) pushEvent(item(m, 'tag'));
  if (heroParagraphs.size) {
    for (const m of await repo.listMentionsByParagraphs(projectId, [...heroParagraphs])) {
      if (m.entityId === entityId || m.status === 'rejected') continue;
      pushEvent(item(m, 'scene'));
    }
  }
  const relations: CharacterProfile['relations'] = [];
  for (const e of graph.edges) {
    const other = e.from === entityId ? e.to : e.from;
    const node = graph.nodes.find((n) => n.id === other);
    const sources = e.evidence.filter((ev) => visible(placeOf(ix, ev.paragraphId)));
    if (upto != null && !sources.length) continue;
    relations.push({ id: e.id, kind: e.kind, type: e.type, label: relationName(e.type), direction: e.from === entityId ? 'out' : 'in', otherId: other, otherName: node?.name ?? '', sources });
    if (node && EVENT_TYPES.has(node.type)) {
      for (const s of sources) {
        const place = placeOf(ix, s.paragraphId);
        if (place) pushEvent({ entityId: other, type: node.type, name: node.name, detail: relationName(e.type), via: 'relation', place });
      }
    }
  }
  const timeline = [...timelineMap.values()].sort((a, b) => a.place!.position - b.place!.position);

  // Факти Profile Builder.
  const facts: CharacterProfile['facts'] = { confirmed: [], suggested: [], contradicted: [], unknown: [] };
  for (const f of findings) {
    if (f.kind !== PROFILE_FACT || f.status === 'rejected' || f.visibility === 'hidden') continue;
    const fact = toProfileFact(ix, f);
    if (upto != null && (fact.chapterNumber == null || fact.chapterNumber > upto || fact.sources.some((s) => (s.chapterNumber ?? 9999) > upto))) continue;
    facts[fact.assessment].push(fact);
  }

  const canonAll = studioCanon(opts.studio?.character ?? null, opts.studio?.all ?? []);
  const hidden = upto != null;
  const portrait = await heroPortrait(repo, projectId, entityId, canonAll.portraitUrl);
  const canon = {
    fields: hidden ? canonAll.fields.filter((f) => f.key === 'role') : canonAll.fields,
    portraitUrl: portrait?.url ?? null,
    portraitSource: portrait?.source ?? null,
    hidden,
    linked: !!opts.studio?.character,
  };
  const formerNames = [...new Set(versions.map((v) => (v.snapshot as EntityRow).name).filter((n) => n && n !== entity.name))];
  return {
    entity: { id: entity.id, name: entity.name, type: entity.type, status: entity.status },
    aliases: [...new Set(aliases.map((a) => a.alias).filter((a) => a !== entity.name))],
    formerNames,
    canon,
    chapters: ix.chapters.map((c, i) => ({ id: c.id, number: i + 1, title: c.title })),
    upto,
    appearances: { total: places.length, items: places.slice(0, 200) },
    timeline,
    arc,
    relations,
    facts,
  };
}

// ── Profile Builder (AI-2) ───────────────────────────────────────────────────

const norm = (s: string) => s.toLocaleLowerCase('uk').replace(/[\s.,;:!?«»"'()—–-]+/g, ' ').trim();

/** Завдання AI-2 для Profile Builder. */
export function profileTask(name: string, canon: CanonField[], known: { field: string; statement: string; status: string }[]): string {
  const fields = PROFILE_FIELDS.map((f) => `${f.key} (${f.label.toLowerCase()})`).join(', ');
  return [
    `Склади доказовий профіль персонажа «${name}» з наданих абзаців книги.`,
    `Кожен висновок — один факт про героя: kind "profile_fact", поле "field" — одне з: ${fields};`,
    `"summary" — твердження одним реченням; paragraph_ids — абзаци, на яких воно тримається; quote — дослівна цитата-доказ.`,
    `Поле "assessment": "supported" — текст прямо це показує; "contradicted" — текст суперечить канону автора нижче; "unknown" — натяк без достатніх даних (тоді insufficient_data: true).`,
    `Не вигадуй: лише те, що є в абзацах. Не повторюй уже відомі факти. Канон автора не змінюй — лише порівнюй з ним.`,
    canon.length ? `Канон автора:\n${canon.map((c) => `- ${c.label}: ${c.value}`).join('\n')}` : 'Канон автора: (картки героя немає)',
    known.length ? `Уже відомі факти (не повторювати):\n${known.map((k) => `- [${k.field}] ${k.statement} (${k.status})`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Обробка висновків Profile Builder: лише факти, поле з переліку, без повторів і без змін затвердженого. */
export function createProfilePreparer(entityId: string, existing: FindingRow[]) {
  const seen = new Set(existing.filter((f) => f.kind === PROFILE_FACT).map((f) => norm(String((f.payload as any).statement ?? (f.payload as any).summary ?? ''))));
  return async (f: ModelFinding, evidence: { paragraphIds: string[] }): Promise<PreparedFinding[]> => {
    if (f.kind !== PROFILE_FACT && f.kind !== 'profile' && f.kind !== 'trait') return [];
    const statement = String(f.summary ?? '').trim();
    const key = norm(statement);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    const field = typeof f.field === 'string' && FIELD_KEYS.has(f.field) ? f.field : 'other';
    const a = String(f.assessment ?? '');
    const assessment = f.insufficient_data || a === 'unknown' ? 'unknown' : a === 'contradicted' ? 'contradicted' : 'supported';
    return [{ kind: PROFILE_FACT, entityId, payload: { field, statement, assessment, quote: typeof f.quote === 'string' ? f.quote : '' }, paragraphIds: evidence.paragraphIds }];
  };
}

/** Скільки абзаців іде в один прогін Profile Builder. */
export const PROFILE_MAX_PARAGRAPHS = 60;

/**
 * Абзаци для Profile Builder: появи героя (теги, суб'єкт) і абзаци, де його
 * ім'я чи псевдонім є в тексті без тега. Спершу ті, на які ще не спирається
 * жоден факт, — так нова глава потрапляє в прогін першою.
 */
export async function profileParagraphs(repo: CoreRepository, projectId: string, entityId: string): Promise<{ id: string; text: string }[]> {
  const [ix, own, subj, aliases, findings] = await Promise.all([
    bookIndex(repo, projectId),
    repo.listMentionsByEntity(projectId, entityId),
    repo.listSubjectMentions(projectId),
    repo.listAliases(projectId, entityId),
    repo.listFindings(projectId, { entityId }),
  ]);
  const entity = await repo.getEntity(projectId, entityId);
  const ids = new Set([...own.filter((m) => m.status !== 'rejected'), ...subj.filter((m) => m.subjectEntityId === entityId)].map((m) => m.paragraphId));
  const names = [...new Set([entity?.name ?? '', ...aliases.map((a) => a.alias)])].filter(Boolean);
  for (const n of names) {
    const stems = searchStems(n);
    if (!stems.length) continue;
    for (const h of await repo.searchParagraphsByText(projectId, stems, 200)) {
      const text = ix.paragraphs.get(h.paragraphId)?.text ?? '';
      // Усі слова імені мають бути в абзаці (інакше «Олена» знайде будь-яку «Олю»).
      const words = text.toLocaleLowerCase('uk');
      if (stems.every((s) => words.includes(s))) ids.add(h.paragraphId);
    }
  }
  const covered = new Set(findings.filter((f) => f.kind === PROFILE_FACT && !f.needsReview).flatMap((f) => f.sourceParagraphIds));
  const list = [...ids]
    .map((id) => ({ id, place: placeOf(ix, id), text: ix.paragraphs.get(id)?.text ?? '' }))
    .filter((x) => x.place && x.text.trim())
    .sort((a, b) => Number(covered.has(a.id)) - Number(covered.has(b.id)) || a.place!.position - b.place!.position)
    .slice(0, PROFILE_MAX_PARAGRAPHS)
    .sort((a, b) => a.place!.position - b.place!.position);
  return list.map((x) => ({ id: x.id, text: x.text }));
}

export interface AiProfileJobDeps {
  repo: () => CoreRepository | null;
  generate: AiRoleDeps['generate'];
  resolveModel: AiRoleDeps['resolveModel'];
  loadTemplate?: AiRoleDeps['loadTemplate'];
  /** Картка героя в Студії — канон для порівняння. */
  loadStudio?: (projectId: string, entity: EntityRow) => Promise<{ character: StudioCharacterLike | null; all: StudioCharacterLike[] }>;
}

export function aiProfileJobKind(deps: AiProfileJobDeps) {
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
      const entityId = String(ctx.job.payload.entityId ?? '');
      const entity = await repo.getEntity(projectId, entityId);
      if (!entity) return { status: 'no_entity', facts: 0 };
      const paragraphs = await profileParagraphs(repo, projectId, entityId);
      if (!paragraphs.length) return { status: 'nothing', facts: 0 };
      const existing = await repo.listFindings(projectId, { entityId });
      const studio = deps.loadStudio ? await deps.loadStudio(projectId, entity) : { character: null, all: [] };
      const canon = studioCanon(studio.character, studio.all).fields;
      const known = existing
        .filter((f) => f.kind === PROFILE_FACT && f.status !== 'rejected')
        .map((f) => ({ field: String((f.payload as any).field ?? 'other'), statement: String((f.payload as any).statement ?? ''), status: f.status }));
      const project = await repo.getProject(projectId);
      await ctx.setProgress({ step: 'model', paragraphs: paragraphs.length });
      await ctx.checkpoint();
      const res = await runAiRole(
        { repo, generate: deps.generate, resolveModel: deps.resolveModel, loadTemplate: deps.loadTemplate, recordUsage: (u) => ctx.recordUsage(u) },
        {
          projectId,
          role: 'AI-2',
          task: profileTask(entity.name, canon, known),
          paragraphs,
          entityId,
          sourceRevision: project?.revision ?? null,
          createdBy: ctx.job.createdBy,
          signal: ctx.signal,
          prepare: createProfilePreparer(entityId, existing),
        },
      );
      if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
      return { runId: res.run.id, status: res.status, facts: res.findings.length, rejected: res.rejected.length, paragraphs: paragraphs.length, errors: res.errors };
    },
  };
}
