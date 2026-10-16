import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { Book } from '../src/types';
import {
  collectJevBookEntityCandidates,
  mergeJevEntityCandidates,
} from '../src/utils/jevSemanticClient';

const book = {
  id: 'book-registry-test',
  title: 'Книга реєстру',
  theme: 'Свобода проти контролю',
  characters: [
    {
      id: 'char-1',
      bookId: 'book-registry-test',
      name: 'Марта',
      surname: 'Коваль',
      alias: 'Іскра',
      profession: 'інженерка',
      role: 'protagonist',
    },
  ],
  storyWorld: {
    id: 'world-1',
    bookId: 'book-registry-test',
    name: 'Нео-Київ',
    description: 'Місто майбутнього',
    era: '2084',
    geography: 'Дніпро',
    approved: true,
  },
  storyLocations: [
    {
      id: 'loc-approved',
      bookId: 'book-registry-test',
      name: 'Лабораторія Сварог',
      description: 'Підземна лабораторія',
      architecture: 'бетон і скло',
      spatialLayout: 'три рівні',
      objects: 'секретний меч, стіл, реактор',
      approved: true,
    },
    {
      id: 'loc-draft',
      bookId: 'book-registry-test',
      name: 'Чернеткова локація',
      description: 'Не затверджена',
      approved: false,
    },
  ],
  visualBible: {
    styleName: 'Neo Noir',
    keyMotifs: ['розбите дзеркало', 'золоте коло'],
  },
  illustrations: [
    {
      id: 'img-1',
      caption: 'Марта біля реактора',
      promptUsed: 'portrait near reactor',
      style: 'cinematic',
    },
    {
      id: 'img-no-caption',
      caption: '',
      promptUsed: 'must not become entity without human caption',
    },
  ],
  knowledgeFiles: [
    {
      id: 'source-1',
      fileName: 'research-reactor.md',
      fileType: 'md',
      fileSizeLabel: '1 KB',
      createdAt: '2026-10-16T00:00:00.000Z',
    },
  ],
  chapters: [
    {
      id: 'chapter-1',
      title: 'Пробудження',
      description: 'Початок історії',
      sections: [
        {
          id: 'section-1',
          title: 'Сигнал',
          content: 'Марта входить до лабораторії.',
          contentEn: '',
          scene: {
            id: 'scene-1',
            title: 'Перше проникнення',
            summary: 'Марта шукає джерело сигналу',
            location: 'Лабораторія Сварог',
            timeOfDay: 'Ніч',
          },
        },
        {
          id: 'section-2',
          title: 'Наслідки',
          content: '[/group:Рада Семи] приховує правду. [/object:Ключ Оріону] зникає.',
          contentEn: '[/location:Old Harbor] is mentioned in another language.',
        },
      ],
    },
  ],
} as unknown as Book;

const candidates = collectJevBookEntityCandidates(book);
const keys = new Set(candidates.map((c) => `${c.slug}:${c.name}`));

assert(keys.has('character:Марта Коваль'), 'persisted character must be available');
assert(keys.has('world:Нео-Київ'), 'approved Story World must be available');
assert(keys.has('location:Лабораторія Сварог'), 'approved Story Location must be available');
assert(!keys.has('location:Чернеткова локація'), 'unapproved Story Location must stay outside the whitelist');
assert(keys.has('theme:Свобода проти контролю'), 'book theme must be available');
assert(keys.has('motif:розбите дзеркало'), 'Visual Bible motif must be available');
assert(keys.has('image:Марта біля реактора'), 'captioned persisted illustration must be available');
assert(!Array.from(keys).some((key) => key.includes('must not become entity')), 'prompt text must not become an image entity');
assert(keys.has('source:research-reactor.md'), 'Knowledge Base file must be available as source');
assert(keys.has('chapter:Пробудження'), 'chapter must be available');
assert(keys.has('section:Сигнал'), 'section must be available');
assert(keys.has('scene:Перше проникнення'), 'persisted scene must be available');
assert(keys.has('group:Рада Семи'), 'canonical group tag in another section must be visible whole-book');
assert(keys.has('object:Ключ Оріону'), 'canonical object tag must stay in whitelist');
assert(keys.has('location:Old Harbor'), 'canonical tag from EN manuscript must be visible');
assert(!Array.from(keys).some((key) => key.includes('секретний меч')), 'free-form StoryLocation.objects must not be split into invented entities');

const merged = mergeJevEntityCandidates(
  candidates,
  [
    { id: 'duplicate-other-id', slug: 'character', name: 'Марта Коваль', description: 'local duplicate' },
    { id: 'live-local', slug: 'character', name: 'Олег Нова', description: 'unsaved local character' },
    { id: 'invalid', slug: 'not-a-core-entity', name: 'Невалідна сутність' },
  ],
);
assert.equal(merged.filter((c) => c.slug === 'character' && c.name === 'Марта Коваль').length, 1, 'merge must deduplicate canonical identity');
assert(merged.some((c) => c.id === 'live-local' && c.name === 'Олег Нова'), 'live local overlay must survive merge');
assert(!merged.some((c) => c.id === 'invalid'), 'unknown Core Entity slug must never enter JEV whitelist');

const pluginSource = await fs.readFile(new URL('../src/components/manuscriptEditor/JevAutoTagPlugin.ts', import.meta.url), 'utf8');
assert.match(pluginSource, /loadJevBookEntityCandidates/);
assert.match(pluginSource, /mergeJevEntityCandidates\(serverCandidates, localCandidates\)/);
assert.match(pluginSource, /registrySource: 'whole-book' \| 'local-fallback'/);
assert.match(pluginSource, /proposedNewEntities \[\]/, 'plugin documentation must preserve no-invention invariant');
assert.match(pluginSource, /getBookId: \(\) => string \| null \| undefined/);
assert.match(pluginSource, /resolveBookId\(options\.getBookId\(\), characters\)/);
assert.match(pluginSource, /if \(explicit\) return explicit;/, 'explicit manuscript book id must win over character fallback');

const extensionsSource = await fs.readFile(new URL('../src/components/manuscriptEditor/extensions.ts', import.meta.url), 'utf8');
assert.match(extensionsSource, /getBookId\?: \(\) => string \| null \| undefined/);
assert.match(extensionsSource, /getBookId: getBookId \|\| \(\(\) => null\)/);

const editorSource = await fs.readFile(new URL('../src/components/EditorView.tsx', import.meta.url), 'utf8');
const explicitBookIdCallbacks = editorSource.match(/\(\) => bookRef\.current\.id/g) || [];
assert.equal(explicitBookIdCallbacks.length, 2, 'UA and EN manuscript editors must both pass the current book id explicitly');
assert.match(
  editorSource,
  /\(\) => entityTagsVisibleRef\.current,\s*\(\) => langRef\.current,\s*\(\) => bookRef\.current\.id\s*\)/,
  'book id must be the final manuscript extension callback after UI language',
);

console.log(`JEV whole-book entity registry contract: OK (${candidates.length} candidates; explicit charless-book id wired)`);
