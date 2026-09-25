/**
 * `searchInterpret` (Т1.3) — AI-2 тлумачить пошуковий запит автора.
 *
 * ЛИШЕ розкладає запит на фільтри й слова (PLAN_ENTITY_FEATURES §6.1): «Де
 * Сергій приховує страх від дружини?» → персонаж «Сергій», емоція «страх»,
 * слова «приховує від дружини». Відповіді на питання модель не дає і фактів
 * про книгу не вигадує: результат пошуку — завжди знайдені абзаци (ТЗ,
 * сторінка 1: «AI інтерпретує запит, але відповідь ґрунтується на знайдених
 * фрагментах»).
 *
 * Сутності модель називає з переліку відомих сутностей книги; на сервері
 * назва зіставляється з сутністю ядра (за назвою чи псевдонімом, з
 * відмінком). Те, що не зіставилось, не стає фільтром — повертається в
 * `unmatched`, щоб автор бачив, що саме модель «почула».
 *
 * Модуль «Ядра AI» — `coreSearchInterpret`: свій шаблон (адмін редагує текст
 * до маркера схеми) і своя модель у прив'язці «модуль → модель».
 */

import type { CoreRepository, EntityRow } from '../types';
import { parseModelJson, validateAgainstSchema } from '../ai/schema';
import type { AiGenerateInput, AiGenerateOutput } from '../ai/roles';
import { nameTokensInQuery } from './service';
import { searchTokens } from './text';
import {
  factorySearchInterpretTemplate,
  renderSearchInterpretTemplate,
  SEARCH_INTERPRET_MODULE,
  SEARCH_INTERPRET_SCHEMA,
} from './interpretPrompt';

export { SEARCH_INTERPRET_MODULE } from './interpretPrompt';

/** Скільки відомих сутностей іде в підказку моделі (решта — лише за збігом слів запиту). */
const MAX_ENTITIES_IN_PROMPT = 300;
/** Типи, що найчастіше стоять у запитах сторінки 1 (фільтри ТЗ), — ідуть у перелік першими. */
const PRIORITY_TYPES = ['character', 'emotion', 'scene', 'event', 'location', 'relationship', 'object', 'goal', 'decision'];

export interface SearchInterpretation {
  /** Слова для пошуку за текстом. */
  text: string;
  /** Зіставлені сутності; `groups` — альтернативи для однієї названої сутності. */
  entities: { id: string; type: string; name: string }[];
  groups: string[][];
  /** Названі моделлю, але не знайдені в книзі. */
  unmatched: { type: string; name: string }[];
  chapterIds: string[];
  chapterNumbers: number[];
  mentionStatus: 'confirmed' | 'suggested' | null;
  model: string;
  costUsd: number;
}

export interface SearchInterpretDeps {
  repo: CoreRepository;
  generate: (input: AiGenerateInput) => Promise<AiGenerateOutput>;
  resolveModel: () => Promise<string | undefined>;
  loadTemplate?: () => Promise<{ system: string; user: string } | undefined>;
}

const norm = (s: string) => searchTokens(s).join(' ');

/** Сутність книги за назвою від моделі: точна назва/псевдонім, далі — з відмінком; тип спершу той, що назвала модель. */
export function matchEntities(name: string, type: string, entities: EntityRow[], aliases: Map<string, string[]>): EntityRow[] {
  const target = norm(name);
  if (!target) return [];
  const names = (e: EntityRow) => [e.name, ...(aliases.get(e.id) ?? [])];
  const exact = entities.filter((e) => names(e).some((n) => norm(n) === target));
  const fuzzy = exact.length ? exact : entities.filter((e) => names(e).some((n) => nameTokensInQuery(n, searchTokens(name)) !== null));
  const sameType = fuzzy.filter((e) => e.type === type);
  return sameType.length ? sameType : fuzzy;
}

export async function interpretSearchQuery(
  deps: SearchInterpretDeps,
  projectId: string,
  query: string,
  actor: string,
): Promise<SearchInterpretation> {
  const { repo } = deps;
  const [entitiesAll, aliasRows, documents] = await Promise.all([
    repo.listEntities(projectId),
    repo.listAliases(projectId),
    repo.listDocuments(projectId),
  ]);
  const entities = entitiesAll.filter((e) => e.status !== 'rejected');
  const aliases = new Map<string, string[]>();
  const nameOf = new Map(entities.map((e) => [e.id, norm(e.name)]));
  // Псевдонім, що збігається з назвою (так синхронізація записує саму назву), — не «також».
  for (const a of aliasRows) {
    if (nameOf.get(a.entityId) === norm(a.alias)) continue;
    aliases.set(a.entityId, [...(aliases.get(a.entityId) ?? []), a.alias]);
  }
  const chapters = documents.filter((d) => d.kind === 'chapter' && !d.deletedAt).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const rank = (t: string) => {
    const i = PRIORITY_TYPES.indexOf(t);
    return i < 0 ? PRIORITY_TYPES.length : i;
  };
  const listed = [...entities].sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name)).slice(0, MAX_ENTITIES_IN_PROMPT);
  const template = (await deps.loadTemplate?.()) ?? factorySearchInterpretTemplate();
  const rendered = renderSearchInterpretTemplate(template, {
    query,
    entities: listed.map((e) => `${e.type}: ${e.name}${aliases.get(e.id)?.length ? ` (також: ${aliases.get(e.id)!.join(', ')})` : ''}`).join('\n'),
    chapters: chapters.map((c, i) => `${i + 1}. ${c.title || 'без назви'}`).join('\n'),
  });
  const modelId = await deps.resolveModel();
  const out = await deps.generate({
    module: SEARCH_INTERPRET_MODULE,
    modelId,
    system: rendered.system,
    user: rendered.user,
    projectId,
    actor,
  });
  const check = validateAgainstSchema<{ text: string; entities: { type: string; name: string }[]; chapters?: number[]; status?: string }>(
    SEARCH_INTERPRET_SCHEMA,
    parseModelJson(out.text),
  );
  if (!check.ok || !check.value) throw new Error(`Тлумачення запиту не відповідає схемі: ${check.errors.join('; ')}`);
  const v = check.value;

  const groups: string[][] = [];
  const matched: SearchInterpretation['entities'] = [];
  const unmatched: SearchInterpretation['unmatched'] = [];
  for (const it of v.entities) {
    const found = matchEntities(it.name, it.type, entities, aliases);
    if (!found.length) {
      unmatched.push({ type: it.type, name: it.name });
      continue;
    }
    const ids = found.map((e) => e.id).filter((id) => !groups.some((g) => g.includes(id)));
    if (!ids.length) continue;
    groups.push(ids);
    for (const e of found) if (ids.includes(e.id)) matched.push({ id: e.id, type: e.type, name: e.name });
  }
  const chapterNumbers = [...new Set(v.chapters ?? [])].filter((n) => n >= 1 && n <= chapters.length);
  return {
    text: v.text.trim(),
    entities: matched,
    groups,
    unmatched,
    chapterIds: chapterNumbers.map((n) => chapters[n - 1].id),
    chapterNumbers,
    mentionStatus: v.status === 'confirmed' || v.status === 'suggested' ? v.status : null,
    model: out.modelId,
    costUsd: out.costUsd,
  };
}
