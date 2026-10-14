export interface ExpressSemanticChapterInput {
  chapterTitle?: string;
  summary?: string;
  involvedCharacters?: string[];
}

export interface ExpressSemanticCastMember {
  id?: string;
  firstName: string;
  lastName: string;
}

function cleanTagValue(value: string): string {
  return value
    .replace(/[\r\n\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fullName(member: ExpressSemanticCastMember): string {
  return cleanTagValue(`${member.firstName ?? ''} ${member.lastName ?? ''}`);
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('uk-UA');
}

/**
 * Детермінований semantic handoff із «Книга за 5 хвилин» у manuscript.
 *
 * Тут немає AI/JEV: ми ставимо тільки ті теги, які wizard уже знає точно.
 * Подальше JEV-enrichment може додати інші сутності, але не має повторно
 * вгадувати chapter/outline/character, які вже відомі зі структури wizard.
 */
export function buildExpressSemanticTagPrefix(
  chapter: ExpressSemanticChapterInput,
  cast: ExpressSemanticCastMember[],
): string {
  const tags: string[] = [];
  const title = cleanTagValue(chapter.chapterTitle || '');
  if (title) {
    tags.push(`[/chapter:${title}]`);
    tags.push(`[/outline:${title}]`);
  }

  const requested = (chapter.involvedCharacters ?? []).map(normalized).filter(Boolean);
  const seen = new Set<string>();

  const candidates = requested.length
    ? cast.filter((member) => {
        const name = fullName(member);
        if (!name) return false;
        const first = normalized(member.firstName || '');
        const last = normalized(member.lastName || '');
        const whole = normalized(name);
        return requested.some((token) => token === whole || token === first || token === last || whole.includes(token));
      })
    : [];

  for (const member of candidates) {
    const name = fullName(member);
    const key = normalized(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    tags.push(`[/character:${name}]`);
  }

  return tags.length ? `${tags.join(' ')}\n\n` : '';
}

export function prependExpressSemanticTags(
  content: string,
  chapter: ExpressSemanticChapterInput,
  cast: ExpressSemanticCastMember[],
): string {
  const prefix = buildExpressSemanticTagPrefix(chapter, cast);
  if (!prefix) return content;
  const alreadyTagged = /^\s*\[\/(?:chapter|outline|character):/i.test(content);
  return alreadyTagged ? content : `${prefix}${content}`;
}
