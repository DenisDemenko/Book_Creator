import type { Book } from '../types';
import { entityBySlug } from './coreEntities';

export interface JevEntityCandidate {
  id: string;
  slug: string;
  name: string;
  description?: string;
}

export interface JevEntityMatch extends JevEntityCandidate {
  confidence: number;
  source: 'jev';
}

export interface JevSemanticResult {
  matches: JevEntityMatch[];
  proposedNewEntities: [];
  provider: 'jev';
  model: string;
}

const TAG_RE = /\[\/([a-z0-9\u0400-\u04FF-]+):([^\]\n]+)\]/giu;

function cleanValue(value: string): string {
  return value.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function candidateId(slug: string, value: string): string {
  return `${slug}:${value.toLocaleLowerCase()}`;
}

/**
 * Canonical candidates that are already part of this book.
 *
 * Two sources are deliberately allowed:
 * 1. stable book characters (including wizard-created heroes);
 * 2. existing canonical entity tags anywhere in UA/EN manuscript.
 *
 * JEV never receives a free-form instruction to invent an entity. A future
 * structured World/Constructor registry can append candidates here, but the
 * same invariant remains: only persisted book entities are eligible.
 */
export function collectJevBookEntityCandidates(book: Book): JevEntityCandidate[] {
  const out = new Map<string, JevEntityCandidate>();

  for (const character of book.characters || []) {
    const name = cleanValue(`${character.name || ''} ${character.surname || ''}`);
    if (!name) continue;
    const id = String(character.id || candidateId('character', name));
    const description = cleanValue(
      [character.alias, character.profession, character.role].filter(Boolean).join(' · ')
    );
    out.set(`character:${id}`, {
      id,
      slug: 'character',
      name,
      description: description || undefined,
    });
  }

  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      for (const source of [section.content, section.contentEn]) {
        if (!source) continue;
        TAG_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = TAG_RE.exec(source))) {
          const rawSlug = match[1].toLowerCase();
          const entity = entityBySlug(rawSlug);
          if (!entity) continue;
          const value = cleanValue(match[2]);
          if (!value) continue;
          const id = candidateId(entity.slug, value);
          const key = `${entity.slug}:${value.toLocaleLowerCase()}`;
          if (!out.has(key)) {
            out.set(key, {
              id,
              slug: entity.slug,
              name: value,
              description: `${entity.nameUk} · ${chapter.title} · ${section.title}`,
            });
          }
        }
      }
    }
  }

  return Array.from(out.values());
}

export async function classifyBookEntitiesWithJev(
  text: string,
  entities: JevEntityCandidate[],
  threshold = 0.65,
  signal?: AbortSignal,
): Promise<JevSemanticResult> {
  const response = await fetch('/api/semantic/jev/entities', {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, entities, threshold }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || 'JEV semantic analysis failed'));
  }
  return payload as JevSemanticResult;
}

/** Backwards-compatible name for callers that want only persisted entities. */
export async function classifyExistingEntitiesWithJev(
  text: string,
  candidates: JevEntityCandidate[],
  signal?: AbortSignal,
): Promise<JevSemanticResult> {
  return classifyBookEntitiesWithJev(text, candidates, 0.65, signal);
}

export function canonicalTag(match: Pick<JevEntityCandidate, 'slug' | 'name'>): string {
  return `[/${match.slug}:${cleanValue(match.name)}]`;
}

/** Prefixes only missing canonical tags. The selected/generated prose is never rewritten. */
export function prependMissingJevTags(text: string, matches: JevEntityMatch[]): string {
  const source = text || '';
  const existing = new Set<string>();
  TAG_RE.lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = TAG_RE.exec(source))) {
    existing.add(`${found[1].toLowerCase()}:${cleanValue(found[2]).toLocaleLowerCase()}`);
  }

  const tags: string[] = [];
  const added = new Set<string>();
  for (const match of matches) {
    if (!entityBySlug(match.slug)) continue;
    const value = cleanValue(match.name);
    if (!value) continue;
    const key = `${match.slug.toLowerCase()}:${value.toLocaleLowerCase()}`;
    if (existing.has(key) || added.has(key)) continue;
    added.add(key);
    tags.push(canonicalTag({ slug: match.slug, name: value }));
  }
  return tags.length ? `${tags.join(' ')}\n${source}` : source;
}
