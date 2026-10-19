import assert from 'node:assert/strict';
import { initialBookData } from '../src/data/initialBook';
import { buildStoryHandoffBook, type StoryHandoffRequest } from '../src/utils/storyEntityHandoff';
import { parseEntityTags, stripEntityTags, MAX_ENTITIES_PER_PARAGRAPH } from '../src/utils/coreEntities';

const original = structuredClone(initialBookData);
const sample = 'Нова сцена: герой вирішує вирушити до лісу.';
const make = (): StoryHandoffRequest => ({
  source: { kind: 'screenplay', sourceId: 'scene-1', title: 'Нова сцена' },
  text: sample,
  target: { placement: 'new-section', chapterId: original.chapters[0].id, title: 'Новий епізод' },
  tags: [
    { slug: 'character', value: 'Олена' },
    { slug: 'character-arc', value: 'Від страху до рішучості' },
    { slug: 'plot', value: 'Пошук істини' },
  ],
  expectedRevision: original.revisionNumber,
  expectedUpdatedAt: original.updatedAt,
});
const committed = buildStoryHandoffBook(original, make());
assert.equal(original.chapters[0].sections.length + 1, committed.book.chapters[0].sections.length);
assert.equal(committed.book.chapters[0].sections.at(-1)?.id, committed.sectionId);
const section = committed.book.chapters[0].sections.at(-1)!;
assert.deepEqual(parseEntityTags(section.content).map(tag => tag.slug), ['character', 'character-arc', 'plot']);
assert.match(section.content, /^\[\/character:Олена\] \[\/character-arc:/,
  'Tags must be in the same paragraph as literary text for semantic mentions.');
assert.ok(!section.content.includes('<p>'), 'The manuscript must not contain raw HTML blocks.');
assert.ok(stripEntityTags(section.content).includes(sample));
assert.ok(!stripEntityTags(section.content).includes('[/character:'),
  'The printed/exported text must hide entity markers.');
assert.equal(section.storyHandoffs?.[0].sourceId, 'scene-1');
assert.equal(original.chapters[0].sections.at(-1)?.storyHandoffs, undefined);
assert.throws(() => buildStoryHandoffBook(committed.book, {
  ...make(),
  expectedUpdatedAt: committed.book.updatedAt,
  target: { placement: 'existing', chapterId: committed.chapterId, sectionId: committed.sectionId },
}), /уже перенесено|уже є/);
assert.throws(() => buildStoryHandoffBook(committed.book, {
  ...make(),
  expectedUpdatedAt: committed.book.updatedAt,
  target: { placement: 'new-chapter', title: 'Не створювати дубль' },
}), /уже перенесено/,
  'Moving duplicate text to a new chapter must not bypass book-wide idempotency.');

assert.throws(() => buildStoryHandoffBook(original, { ...make(), expectedUpdatedAt: 'outdated' }), /Книгу змінено/);
assert.throws(() => buildStoryHandoffBook(original, { ...make(), tags: [{ slug: 'not-an-entity', value: 'X' }] }), /Невідомий/);
assert.throws(() => buildStoryHandoffBook(original, { ...make(), tags: Array.from({length:MAX_ENTITIES_PER_PARAGRAPH+1},(_,i)=>({slug:'plot',value:String(i)})) }), /Максимум/);
assert.throws(() => buildStoryHandoffBook(original, { ...make(), source: {kind:'mafia',sourceId:'session',title:'Session'} }), /серверне підтвердження/);
assert.throws(() => buildStoryHandoffBook(original, { ...make(), text: ' ' }), /Додайте текст/);

const newChapter = buildStoryHandoffBook(original, {
  ...make(), target: { placement: 'new-chapter', title: 'Тестова глава' },
});
assert.equal(newChapter.book.chapters.length, original.chapters.length + 1);
assert.equal(newChapter.book.chapters.at(-1)?.sections[0].storyHandoffs?.length, 1);

const existing = buildStoryHandoffBook(original, {
  ...make(),
  text: 'Унікальне доповнення до першого розділу.',
  target: { placement: 'existing', chapterId: original.chapters[0].id, sectionId: original.chapters[0].sections[0].id },
});
assert.ok(existing.book.chapters[0].sections[0].content.includes('Унікальне доповнення'));
assert.ok(original.chapters[0].sections[0].content.includes('Скляні куполи'));
assert.throws(() => buildStoryHandoffBook(original, {
  ...make(), text: '<img src=x onerror=alert(1)>',
}), /HTML-розмітку/,
  'Raw HTML is not valid marker-string manuscript input and must be rejected.');
assert.throws(() => buildStoryHandoffBook(original, {
  ...make(), text: '<script>alert(1)</script>',
}), /HTML-розмітку/);
const literalMath = buildStoryHandoffBook(original, {
  ...make(), text: 'Рівень був < 3, та героїня продовжила шлях.',
});
assert.ok(literalMath.book.chapters[0].sections.at(-1)?.content.includes('< 3'),
  'Ordinary mathematical comparison is allowed.');

console.log('story entity handoff OK: marker-based manuscript, tag parsing/print, provenance, book-wide duplicate prevention, revision/privacy guards');
