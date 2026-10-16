import type { Book } from '../types';
import { CORE_ENTITY_DEFINITIONS } from './coreEntities';

export interface JevEntityCandidate {
  id: string;
  slug: string;
  name: string;
  description?: string;
}

export interface JevSemanticMatch {
  slug: string;
  entityId: string;
  name: string;
  confidence: number;
  evidence?: string;
}

export interface JevSemanticResponse {
  matches: JevSemanticMatch[];
  model?: string;
}

const TAG_RE = /\[(?:\/)?([a-z][a-z0-9_-]*):([^\]\n]+)\]/gi;

function cleanValue(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function candidateId(slug: string, value: string): string {
  const normalized = value.toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return `${slug}:${normalized || 'entity'}`;
}

function entityBySlug(slug: string) {
  return CORE_ENTITY_DEFINITIONS.find((item) => item.slug === slug);
}

/**
 * Build the ONLY candidates JEV is allowed to classify against.
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
            });
          }
        }
      }
    }
  }

  return [...out.values()];
}

export async function classifyExistingEntitiesWithJev(
  text: string,
  candidates: JevEntityCandidate[],
  signal?: AbortSignal,
): Promise<JevSemanticResponse> {
  const response = await fetch('/api/semantic/jev/entities', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, candidates }),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || `JEV semantic request failed (${response.status})`));
  }

  return {
    matches: Array.isArray(payload?.matches) ? payload.matches : [],
    model: typeof payload?.model === 'string' ? payload.model : undefined,
  };
}
