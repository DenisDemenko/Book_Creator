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

interface StoredBookPayload {
  book?: Book;
}

const TAG_RE = /\[\/([a-z0-9\u0400-\u04FF-]+):([^\]\n]+)\]/giu;

function cleanValue(value: string): string {
  return value.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function candidateId(slug: string, value: string): string {
  return `${slug}:${value.toLocaleLowerCase()}`;
}

function candidateKey(candidate: Pick<JevEntityCandidate, 'slug' | 'name'>): string {
  return `${candidate.slug.toLocaleLowerCase()}:${cleanValue(candidate.name).toLocaleLowerCase()}`;
}

function addCandidate(
  out: Map<string, JevEntityCandidate>,
  candidate: JevEntityCandidate,
): void {
  const entity = entityBySlug(candidate.slug);
  const name = cleanValue(candidate.name);
  if (!entity || !name) return;
  const normalized: JevEntityCandidate = {
    id: cleanValue(candidate.id) || candidateId(entity.slug, name),
    slug: entity.slug,
    name,
    description: candidate.description ? cleanValue(candidate.description) || undefined : undefined,
  };
  const key = candidateKey(normalized);
  if (!out.has(key)) out.set(key, normalized);
}

/** Merge registries without creating a second entity identity for the same canonical tag. */
export function mergeJevEntityCandidates(
  ...groups: Array<ReadonlyArray<JevEntityCandidate> | null | undefined>
): JevEntityCandidate[] {
  const out = new Map<string, JevEntityCandidate>();
  for (const group of groups) {
    for (const candidate of group || []) addCandidate(out, candidate);
  }
  return Array.from(out.values());
}

/**
 * Canonical candidates that are already part of this book.
 *
 * This is the single client-side whole-book registry used by JEV. It only
 * materializes persisted objects/values that already have a matching type in
 * the 118-type Core Entity Registry. Free-form fields (for example a prose
 * list in StoryLocation.objects) are deliberately NOT split into entities.
 *
 * Sources:
 * - characters;
 * - approved Story World + Story Locations;
 * - chapters, sections and persisted scenes;
 * - book theme + Visual Bible motifs;
 * - persisted illustrations with a human caption;
 * - Knowledge Base files as sources;
 * - canonical entity tags anywhere in UA/EN manuscript.
 *
 * JEV still never receives an instruction to invent an entity: this registry
 * is a whitelist, and the server returns proposedNewEntities: [] by contract.
 */
export function collectJevBookEntityCandidates(book: Book): JevEntityCandidate[] {
  const out = new Map<string, JevEntityCandidate>();

  for (const character of book.characters || []) {
    const name = cleanValue(`${character.name || ''} ${character.surname || ''}`);
    if (!name) continue;
    addCandidate(out, {
      id: String(character.id || candidateId('character', name)),
      slug: 'character',
      name,
      description: [character.alias, character.profession, character.role].filter(Boolean).join(' · '),
    });
  }

  if (book.storyWorld?.approved) {
    addCandidate(out, {
      id: book.storyWorld.id,
      slug: 'world',
      name: book.storyWorld.name,
      description: [book.storyWorld.description, book.storyWorld.era, book.storyWorld.geography]
        .filter(Boolean)
        .join(' · '),
    });
  }

  for (const location of book.storyLocations || []) {
    if (!location.approved) continue;
    addCandidate(out, {
      id: location.id,
      slug: 'location',
      name: location.name,
      description: [location.description, location.architecture, location.spatialLayout]
        .filter(Boolean)
        .join(' · '),
    });
  }

  const theme = cleanValue(book.theme || '');
  if (theme) {
    addCandidate(out, {
      id: candidateId('theme', theme),
      slug: 'theme',
      name: theme,
      description: 'Тема книги',
    });
  }

  for (const motif of book.visualBible?.keyMotifs || []) {
    const name = cleanValue(motif || '');
    if (!name) continue;
    addCandidate(out, {
      id: candidateId('motif', name),
      slug: 'motif',
      name,
      description: `Visual Bible · ${book.visualBible.styleName || 'book'}`,
    });
  }

  for (const illustration of book.illustrations || []) {
    const name = cleanValue(illustration.caption || '');
    if (!name) continue;
    addCandidate(out, {
      id: illustration.id,
      slug: 'image',
      name,
      description: cleanValue(illustration.promptUsed || illustration.style || ''),
    });
  }

  for (const source of book.knowledgeFiles || []) {
    const name = cleanValue(source.fileName || '');
    if (!name) continue;
    addCandidate(out, {
      id: source.id,
      slug: 'source',
      name,
      description: source.fileType,
    });
  }

  for (const chapter of book.chapters || []) {
    addCandidate(out, {
      id: chapter.id,
      slug: 'chapter',
      name: chapter.title,
      description: cleanValue(chapter.description || chapter.titleEn || ''),
    });

    for (const section of chapter.sections || []) {
      addCandidate(out, {
        id: section.id,
        slug: 'section',
        name: section.title,
        description: `${chapter.title}${section.titleEn ? ` · ${section.titleEn}` : ''}`,
      });

      if (section.scene?.title) {
        addCandidate(out, {
          id: section.scene.id,
          slug: 'scene',
          name: section.scene.title,
          description: [section.scene.summary, section.scene.location, section.scene.timeOfDay]
            .filter(Boolean)
            .join(' · '),
        });
      }

      for (const source of [section.content, section.contentEn]) {
        if (!source) continue;
        TAG_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = TAG_RE.exec(source))) {
          const entity = entityBySlug(match[1].toLowerCase());
          const value = cleanValue(match[2]);
          if (!entity || !value) continue;
          addCandidate(out, {
            id: candidateId(entity.slug, value),
            slug: entity.slug,
            name: value,
            description: `${entity.nameUk} · ${chapter.title} · ${section.title}`,
          });
        }
      }
    }
  }

  return Array.from(out.values());
}

/**
 * Loads the author's current server copy and builds the same canonical
 * registry from it. Used by the long-lived TipTap extension so right-click
 * tagging sees entities from the WHOLE book, not just the open section.
 */
export async function loadJevBookEntityCandidates(
  bookId: string,
  signal?: AbortSignal,
): Promise<JevEntityCandidate[]> {
  const id = cleanValue(bookId);
  if (!id) return [];
  const response = await fetch(`/api/books/${encodeURIComponent(id)}`, {
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    throw new Error('Не вдалося завантажити реєстр сутностей книги.');
  }
  const payload = await response.json() as StoredBookPayload;
  if (!payload.book) return [];
  return collectJevBookEntityCandidates(payload.book);
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
