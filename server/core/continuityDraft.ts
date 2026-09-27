/**
 * Перевірка чернетки на «витік знання» (Т2.4 В7, ТЗ-H; `PLAN_CONTINUITY.md`
 * §2 «Чернетка-симуляція»).
 *
 * Той самий перевіряльник, що й правило «знання» (В4): `knowledgeCandidates()`
 * дає, де й як герой дізнається кожен факт книги — розкриття таємниці лише
 * як суб'єкт тегу (`[/revelation:… @Герой]`), подію — як суб'єкт або
 * присутній у сцені (ті самі правила, що `characterKnowledge()` для сторінки
 * «Хронологія»). Але перевіряється текст, якого в книзі ще немає: чернетка
 * сцени чи репліка симуляції. Нічого не записується в розділи й у
 * `continuity_issues` — лише в історію перевірок (`continuity_draft_checks`).
 *
 * Що вважається згадкою факту в чернетці:
 *   • тег розкриття чи події (`[/revelation:Таємниця]`, `/event:Напад`) —
 *     назва чи псевдонім сутності книги (`match: 'tag'`);
 *   • назва чи псевдонім у звичайному тексті — усі значущі слова назви є
 *     словами чернетки за основою (`match: 'name'`; слабший доказ — назва
 *     на кшталт «Напад» буває й звичайним словом).
 *
 * Станом на що. `sectionId` — знання на ПОЧАТОК цієї сцени (те, що герой
 * дізнається в ній самій, ще не відоме — чернетка її й пише); без сцени —
 * на кінець книги (витік тоді — лише те, чого герой не дізнається ніколи).
 */

import type { CoreRepository, DraftCheckFinding, EntityRow } from './types';
import { EVENT_TYPES } from './characterProfile';
import { knowledgeCandidates, scanScenes, sceneIsBefore, type KnowledgeCandidate, type TimelineScene } from './timeline';
import { searchStems, searchTokens } from './search/text';
import { entityBySlug, parseEntityTagsInSource } from '../../src/utils/coreEntities';
import { entityNameFromTag } from './sync';

export interface DraftKnowledgeCheck {
  character: { id: string; name: string };
  /** Сцена, станом на початок якої рахувалось знання; null — кінець книги. */
  scene: { sectionId: string; title: string; chapterNumber: number | null; time: string | null } | null;
  findings: DraftCheckFinding[];
  /** Скільки фактів книги згадано в чернетці (відомих і ні). */
  mentioned: number;
  /** З них відомі героєві станом на сцену — не витік. */
  known: string[];
  /** Теги подій і розкриттів у чернетці, яких у книзі немає — перевіряти нема з чим. */
  unknownTags: string[];
  rule: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Речення чернетки навколо позиції — доказ згадки. */
function sentenceAround(text: string, at: number): string {
  const left = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('!', at - 1), text.lastIndexOf('?', at - 1), text.lastIndexOf('\n', at - 1));
  const rights = ['.', '!', '?', '\n'].map((c) => text.indexOf(c, at)).filter((i) => i >= 0);
  const right = rights.length ? Math.min(...rights) + 1 : text.length;
  return clip(text.slice(left + 1, right).trim(), 240);
}

/** Текст без тегів (значення тега лишається — «Олена знала [/event:Напад]» → «Олена знала Напад»), з картою позицій. */
function visibleText(draft: string): { text: string; toSource: number[] } {
  const tags = parseEntityTagsInSource(draft);
  let text = '';
  const toSource: number[] = [];
  let cursor = 0;
  for (const t of tags) {
    for (let i = cursor; i < t.start; i++) { text += draft[i]; toSource.push(i); }
    const value = t.value ?? '';
    for (let i = 0; i < value.length; i++) { text += value[i]; toSource.push(t.start); }
    cursor = t.end;
  }
  for (let i = cursor; i < draft.length; i++) { text += draft[i]; toSource.push(i); }
  return { text, toSource };
}

/** Позиція першого слова, з якого починається `stem` (за основою); -1 — немає. */
function findStem(lower: string, stem: string): number {
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) if (m[0].startsWith(stem)) return m.index;
  return -1;
}

export async function checkDraftKnowledge(
  repo: CoreRepository,
  projectId: string,
  input: { characterId: string; draftText: string; sectionId?: string | null },
): Promise<DraftKnowledgeCheck | { error: 'no_character' | 'no_section' }> {
  const hero = await repo.getEntity(projectId, input.characterId);
  if (!hero || hero.status === 'rejected' || hero.type !== 'character') return { error: 'no_character' };
  const [points, entitiesAll, aliases] = await Promise.all([repo.listTimePoints(projectId), repo.listEntities(projectId), repo.listAliases(projectId)]);
  const scan = await scanScenes(repo, projectId, points);
  let anchor: TimelineScene | null = null;
  if (input.sectionId) {
    anchor = scan.bySection.get(input.sectionId) ?? null;
    if (!anchor) return { error: 'no_section' };
  }

  // Де й як герой дізнається кожен факт: розкриття — лише суб'єктом, подія — суб'єктом чи присутнім.
  const learns = new Map<string, KnowledgeCandidate>();
  for (const c of await knowledgeCandidates(repo, projectId)) {
    if (c.characterId !== hero.id) continue;
    if (c.entityKind === 'revelation' && c.via !== 'subject') continue;
    const prev = learns.get(c.entityId);
    if (!prev || sceneIsBefore(c, prev)) learns.set(c.entityId, c);
  }
  const knownNow = (entityId: string) => {
    const l = learns.get(entityId);
    return !!l && (!anchor || sceneIsBefore(l, anchor));
  };

  const facts = entitiesAll.filter((e) => e.status !== 'rejected' && EVENT_TYPES.has(e.type));
  const byId = new Map(facts.map((e) => [e.id, e]));
  const draft = input.draftText;
  const hits = new Map<string, { e: EntityRow; match: 'tag' | 'name'; offset: number }>();
  const unknownTags: string[] = [];

  // 1) Теги в чернетці.
  for (const t of parseEntityTagsInSource(draft)) {
    const entity = t.entity ?? entityBySlug(t.slug);
    if (!entity || !EVENT_TYPES.has(entity.slug)) continue;
    const name = entityNameFromTag(entity, t.value).name;
    if (!name) continue;
    const id = await repo.resolveAlias(projectId, entity.slug, name);
    const e = id ? byId.get(id) : undefined;
    if (!e) {
      unknownTags.push(`${entity.slug}:${name}`);
      continue;
    }
    if (!hits.has(e.id)) hits.set(e.id, { e, match: 'tag', offset: t.start });
  }

  // 2) Назви й псевдоніми у звичайному тексті.
  const vis = visibleText(draft);
  const lower = vis.text.toLocaleLowerCase('uk');
  const words = new Set(searchTokens(vis.text));
  const namesOf = new Map<string, string[]>();
  for (const e of facts) namesOf.set(e.id, [e.name]);
  for (const a of aliases) if (namesOf.has(a.entityId)) namesOf.get(a.entityId)!.push(a.alias);
  for (const e of facts) {
    if (hits.has(e.id)) continue;
    for (const name of new Set(namesOf.get(e.id))) {
      const stems = searchStems(name);
      if (!stems.length || !stems.every((s) => [...words].some((w) => w.startsWith(s)))) continue;
      const at = findStem(lower, stems[0]);
      hits.set(e.id, { e, match: 'name', offset: at >= 0 ? vis.toSource[at] ?? 0 : 0 });
      break;
    }
  }

  const findings: DraftCheckFinding[] = [];
  const known: string[] = [];
  for (const { e, match, offset } of [...hits.values()].sort((a, b) => a.offset - b.offset)) {
    if (knownNow(e.id)) {
      known.push(e.name);
      continue;
    }
    const l = learns.get(e.id) ?? null;
    const s = l ? scan.bySection.get(l.sectionId) : undefined;
    findings.push({
      entityId: e.id,
      entityName: e.name,
      entityType: e.type,
      kind: e.type === 'revelation' ? 'revelation' : 'event',
      match,
      quote: sentenceAround(draft, offset),
      offset,
      reason: l ? 'learns_later' : 'never_learns',
      learnsAt: l && s ? { sectionId: s.sectionId, paragraphId: l.paragraphId, title: s.title, chapterNumber: s.chapterNumber, via: l.via } : null,
    });
  }

  return {
    character: { id: hero.id, name: hero.name },
    scene: anchor ? { sectionId: anchor.sectionId, title: anchor.title, chapterNumber: anchor.chapterNumber, time: anchor.time?.label ?? null } : null,
    findings,
    mentioned: hits.size,
    known,
    unknownTags,
    rule: anchor
      ? 'Відоме героєві — те, що він дізнався раніше за початок цієї сцени (час світу, а без нього — порядок книги): розкриття — лише як суб\'єкт, подію — суб\'єктом чи присутнім.'
      : 'Без сцени — станом на кінець книги: витік — лише те, чого герой у книзі не дізнається зовсім.',
  };
}
