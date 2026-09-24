/**
 * Синхронізація книги з ядром — задача Т0.6 (журнал #249).
 *
 * Критерії з дорожньої карти: після збереження книги з тегами абзаци й
 * згадки — у базі; повторне збереження без змін нічого не пише; текст
 * рукопису той самий байт-у-байт. Плюс: суб'єкт тега (П1), поля (П2),
 * перейменування героя (П6), номери для старих розділів і для скопійованого
 * розділу, видалення, висновки на перегляд, задача в черзі.
 *
 * Без бази — на сховищі в пам'яті; з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:core-sync
 */
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { syncBookToCore, scheduleCoreSync, coreSyncJobKind, CORE_SYNC_KIND, characterRef, type StoredBookForSync } from '../server/core/sync.ts';
import { reconcileParagraphIds, sectionBlocks } from '../src/utils/paragraphIds.ts';
import type { CoreRepository } from '../server/core/types.ts';
import type { JobStore } from '../server/core/jobs/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const para = (...xs: string[]) => xs.join('\n\n');

/** Розділ так, як його зберігає редактор: з номерами й відбитками (Т0.5). */
function editorSection(id: string, order: number, content: string, extra: Record<string, unknown> = {}) {
  const r = reconcileParagraphIds({ sectionId: id, content });
  return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes, ...extra };
}

function makeBook(projectId: string) {
  return {
    id: projectId,
    title: 'Тиша над рікою',
    characters: [
      { id: 'c-olena', name: 'Олена', surname: 'Коваль', alias: 'Лена' },
      { id: 'c-marko', name: 'Марко' },
    ],
    chapters: [
      {
        id: 'ch-1', title: 'Глава 1', order: 0,
        sections: [
          editorSection('s-1', 0, para(
            '## Ранок',
            '[/character:Олена] прокинулась рано. [/emotion:тривога — 6] не відпускала.',
            'Марко мовчав. [/emotion:сором — 3 @Марко] [/character:Олена]',
            '[[COLOR="#e11d48"]/location:Міст[/COLOR]] над рікою був порожній.',
            '/event:Вибух стався о шостій.',
          ), { scene: { characters: [{ characterId: 'c-marko' }] } }),
          editorSection('s-2', 1, para(
            '[/character:Олена:Я не повернусь.] — сказала вона.',
            '[/goal:втекти] без героя в абзаці, але в сцені один Марко.',
            '[/emotion:] порожній тег.',
          ), { scene: { characters: [{ characterId: 'c-marko' }] } }),
        ],
      },
      {
        id: 'ch-2', title: 'Глава 2', order: 1,
        // Старий розділ, що ще не відкривався в редакторі: номерів немає.
        sections: [{ id: 's-3', title: 'Без номерів', order: 0, content: para('Перший абзац старого розділу.', 'Другий абзац старого розділу.') }],
      },
    ],
  };
}

async function suite(label: string, repo: CoreRepository, makeJobStore: () => JobStore, P: string) {
  console.log(`\nСинхронізація книги (${label}):`);
  const book = makeBook(P);
  const snapshot = JSON.stringify(book);
  const stored = (b: any): StoredBookForSync => ({ id: P, ownerId: 'author-1', title: b.title, book: b });

  // Перша синхронізація
  const r1 = await syncBookToCore(repo, stored(book));
  t('книгу не змінено ні на байт', JSON.stringify(book) === snapshot);
  t('проєкт і власник', (await repo.getProject(P))?.ownerId === 'author-1' && (await repo.getMemberRole(P, 'author-1')) === 'owner');
  const docs = await repo.listDocuments(P);
  t('глави й розділи — документи', docs.length === 5 && docs.find((d) => d.id === 's-2')?.parentId === 'ch-1', docs.map((d) => d.id).join());
  const s1 = await repo.listParagraphs(P, 's-1');
  const s1ids = (book.chapters[0].sections[0] as any).paragraphIds as string[];
  t('абзаци розділу — з номерами редактора', s1.length === 5 && s1.map((p) => p.id).join() === s1ids.join());
  t('вид блоку: заголовок і абзаци', s1[0].kind === 'heading' && s1[1].kind === 'paragraph');
  t('текст абзацу в ядрі — як у рукописі (з тегами)', s1[1].text === '[/character:Олена] прокинулась рано. [/emotion:тривога — 6] не відпускала.');
  t('лічильники першого прогону', r1.paragraphs.created === 10 && r1.revision === 1 && r1.wroteAnything, JSON.stringify(r1.paragraphs));

  const olenaId = (await repo.findEntityByExternalRef(P, 'character', characterRef('c-olena')))?.id!;
  const markoId = (await repo.findEntityByExternalRef(P, 'character', characterRef('c-marko')))?.id!;
  t('герої книги — сутності з зв\'язком зі Студією', !!olenaId && !!markoId && (await repo.getEntity(P, olenaId))?.name === 'Олена Коваль');
  t('псевдоніми героя: ім\'я, повне ім\'я, прізвисько',
    (await repo.resolveAlias(P, 'character', 'олена')) === olenaId && (await repo.resolveAlias(P, 'character', 'Олена Коваль')) === olenaId && (await repo.resolveAlias(P, 'character', 'Лена')) === olenaId);
  t('тег героя не створив другої Олени', (await repo.listEntities(P, 'character')).length === 2);

  const olenaMentions = await repo.listMentionsByEntity(P, olenaId);
  t('згадки Олени: у двох абзацах і в діалоговій формі', olenaMentions.length === 3, olenaMentions.map((m) => m.paragraphId.slice(0, 4)).join());
  const trivoga = (await repo.listEntities(P, 'emotion')).find((e) => e.name === 'тривога')!;
  const trivogaM = (await repo.listMentionsByEntity(P, trivoga.id))[0];
  t('емоція — сутність за першим полем, поля збережено (П2)',
    !!trivoga && (trivogaM.fields as any).fields?.[1]?.value === '6' && trivogaM.status === 'confirmed' && trivogaM.source === 'tag');
  t('суб\'єкт: найближчий попередній /character (П1)', trivogaM.subjectEntityId === olenaId);
  const sorom = (await repo.listEntities(P, 'emotion')).find((e) => e.name === 'сором')!;
  t('суб\'єкт: явна приписка @Марко важить більше за порядок (П1)', (await repo.listMentionsByEntity(P, sorom.id))[0]?.subjectEntityId === markoId);
  const goal = (await repo.listEntities(P, 'goal'))[0];
  t('суб\'єкт: без героя в абзаці — єдиний учасник сцени', (await repo.listMentionsByEntity(P, goal.id))[0]?.subjectEntityId === markoId);
  const loc = (await repo.listEntities(P, 'location'))[0];
  const locM = (await repo.listMentionsByEntity(P, loc?.id ?? ''))[0];
  t('тег, розрізаний кольором, — теж згадка з позицією в рукописі',
    loc?.name === 'Міст' && locM && s1[3].text.slice(locM.spanStart, locM.spanEnd).startsWith('[[COLOR'), loc?.name);
  t('«сирий» тег /event:Вибух — теж згадка', (await repo.listEntities(P, 'event'))[0]?.name === 'Вибух');
  t('порожній тег — без сутності', r1.mentions.withoutValue === 1);

  const s3 = await repo.listParagraphs(P, 's-3');
  const expected3 = reconcileParagraphIds({ sectionId: 's-3', content: book.chapters[1].sections[0].content });
  t('старий розділ без номерів — номери як у редакторі (той самий алгоритм)', s3.map((p) => p.id).join() === expected3.ids.join());

  // Повторне збереження без змін
  const versionsBefore = (await repo.listParagraphVersions(P, s1ids[1])).length;
  const docsBefore = JSON.stringify(await repo.listDocuments(P));
  const r2 = await syncBookToCore(repo, stored(JSON.parse(snapshot)));
  t('повторне збереження без змін нічого не пише (Т0.6)', !r2.wroteAnything && r2.paragraphs.unchanged === 10 && r2.revision === 1, JSON.stringify(r2.paragraphs));
  t('ні версій, ні документів не додалось',
    (await repo.listParagraphVersions(P, s1ids[1])).length === versionsBefore && JSON.stringify(await repo.listDocuments(P)) === docsBefore);

  // Правка абзацу + висновок AI на ньому
  const finding = await repo.addFinding({ projectId: P, entityId: olenaId, kind: 'trait', sourceParagraphIds: [s1ids[1]], createdBy: 'ai:AI-1' });
  const other = await repo.addFinding({ projectId: P, entityId: olenaId, kind: 'trait', sourceParagraphIds: [s1ids[2]], createdBy: 'ai:AI-1' });
  const edited = JSON.parse(snapshot);
  const sec = edited.chapters[0].sections[0];
  const blocks = sectionBlocks(sec.content);
  blocks[1] = '[/character:Олена] прокинулась пізно. [/emotion:спокій — 2] прийшов.';
  sec.content = blocks.join('\n\n');
  const re = reconcileParagraphIds({ sectionId: 's-1', content: sec.content, prevIds: sec.paragraphIds, prevHashes: sec.paragraphHashes });
  sec.paragraphIds = re.ids;
  sec.paragraphHashes = re.hashes;
  const r3 = await syncBookToCore(repo, stored(edited));
  t('правка одного абзацу — одна нова версія, решта без змін', r3.paragraphs.changed === 1 && r3.paragraphs.unchanged === 9 && r3.revision === 2, JSON.stringify(r3.paragraphs));
  t('номер абзацу після правки той самий', (await repo.getParagraph(P, s1ids[1]))?.version === 2);
  t('згадки перераховано: тривоги в абзаці більше немає, спокій з\'явився',
    (await repo.listMentionsByEntity(P, trivoga.id)).length === 0 && (await repo.listEntities(P, 'emotion')).some((e) => e.name === 'спокій'));
  t('висновок AI на зміненому абзаці — «на перегляд», інший — ні',
    (await repo.getFinding(P, finding.id))?.needsReview === true && (await repo.getFinding(P, other.id))?.needsReview === false);
  const notes = await repo.listNotifications(P);
  t('сповіщення про вплив правки', notes.length === 1 && notes[0].kind === 'findings_need_review' && notes[0].paragraphIds.includes(s1ids[1]));

  // Видалення абзацу й розділу
  const cut = JSON.parse(JSON.stringify(edited));
  const cs = cut.chapters[0].sections[0];
  const cb = sectionBlocks(cs.content);
  cb.splice(4, 1);
  cs.content = cb.join('\n\n');
  const rc = reconcileParagraphIds({ sectionId: 's-1', content: cs.content, prevIds: cs.paragraphIds, prevHashes: cs.paragraphHashes });
  cs.paragraphIds = rc.ids;
  cs.paragraphHashes = rc.hashes;
  cut.chapters[1].sections = [];
  const r4 = await syncBookToCore(repo, stored(cut));
  t('видалений абзац і розділ — позначені, не стерті', r4.paragraphs.deleted === 3 && r4.documents.deleted === 1 && !!(await repo.getParagraph(P, s1ids[4]))?.deletedAt, JSON.stringify(r4.paragraphs));
  const eventId = (await repo.listEntities(P, 'event'))[0].id;
  t('згадки видаленого абзацу прибрано', (await repo.listMentionsByEntity(P, eventId)).length === 0);
  const back = await syncBookToCore(repo, stored(edited));
  t('повернений розділ і абзац — знову живі, без нових версій тексту',
    back.paragraphs.changed === 3 && back.documents.written >= 1 && (await repo.getParagraph(P, s1ids[4]))?.deletedAt === null && (await repo.getParagraph(P, s1ids[4]))?.version === 1,
    JSON.stringify(back.paragraphs));

  // Копія розділу з тими самими номерами
  const copied = JSON.parse(JSON.stringify(edited));
  copied.chapters[1].sections.push({ ...JSON.parse(JSON.stringify(copied.chapters[0].sections[1])), id: 's-2-copy', order: 1 });
  const r5 = await syncBookToCore(repo, stored(copied));
  const copyParas = await repo.listParagraphs(P, 's-2-copy');
  const origIds = copied.chapters[0].sections[1].paragraphIds as string[];
  t('скопійований розділ: у ядрі свої номери, редакторські — пам\'ятаються',
    r5.paragraphs.duplicateIdsRemapped === 3 && copyParas.length === 3 && copyParas.every((p, i) => p.id !== origIds[i] && p.editorPid === origIds[i]),
    `${r5.paragraphs.duplicateIdsRemapped}`);
  t('номери у ядрі унікальні в межах книги', new Set((await repo.listAllParagraphs(P)).map((p) => p.id)).size === (await repo.listAllParagraphs(P)).length);
  const r6 = await syncBookToCore(repo, stored(JSON.parse(JSON.stringify(copied))));
  t('і стабільні: повторний прогін з копією нічого не пише', !r6.wroteAnything, JSON.stringify(r6.paragraphs));

  // Перейменування героя (П6) і герой, що з'явився в списку після тега
  const renamed = JSON.parse(JSON.stringify(copied));
  renamed.characters[0].name = 'Олеся';
  renamed.chapters[0].sections[0].content += '\n\n[/character:Віра] увійшла.';
  const rr = reconcileParagraphIds({ sectionId: 's-1', content: renamed.chapters[0].sections[0].content, prevIds: renamed.chapters[0].sections[0].paragraphIds, prevHashes: renamed.chapters[0].sections[0].paragraphHashes });
  renamed.chapters[0].sections[0].paragraphIds = rr.ids;
  renamed.chapters[0].sections[0].paragraphHashes = rr.hashes;
  await syncBookToCore(repo, stored(renamed));
  const viraFromTag = (await repo.listEntities(P, 'character')).find((e) => e.name === 'Віра');
  // Наступне збереження: автор додав Віру в список героїв книги.
  renamed.characters.push({ id: 'c-vira', name: 'Віра' });
  await syncBookToCore(repo, stored(renamed));
  t('перейменування: та сама сутність, нова назва, старе ім\'я — далі псевдонім (П6)',
    (await repo.getEntity(P, olenaId))?.name === 'Олеся Коваль' && (await repo.resolveAlias(P, 'character', 'Олена')) === olenaId && (await repo.resolveAlias(P, 'character', 'Олеся')) === olenaId);
  const viras = (await repo.listEntities(P, 'character')).filter((e) => e.name === 'Віра');
  t('герой, доданий у список після тега, — та сама сутність, не дубль',
    !!viraFromTag && !viraFromTag.externalRef && viras.length === 1 && viras[0].id === viraFromTag.id && viras[0].externalRef === characterRef('c-vira'));

  // Книга без власника
  t('книга без власника — пропуск', (await syncBookToCore(repo, { id: P + '-guest', ownerId: null, book: makeBook('x') })).skipped === 'no_owner');

  // Задача в черзі
  console.log(`\nЗадача core_sync у черзі (${label}):`);
  const Q = P + '-q';
  let latest: StoredBookForSync = { id: Q, ownerId: 'author-1', title: 'Черга', book: makeBook(Q) };
  let clock = Date.parse('2026-09-24T12:00:00Z');
  const q = new JobQueue(makeJobStore(), { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(CORE_SYNC_KIND, coreSyncJobKind({ repo: () => repo, loadBook: async () => latest }));
  const deps = { repo, queue: q };
  t('збереження ставить синхронізацію', (await scheduleCoreSync(deps, latest, 'user:author-1')) === 'scheduled');
  t('друге збереження, поки задача чекає, — нової не ставить', (await scheduleCoreSync(deps, latest, 'user:author-1')) === 'already_queued');
  t('пауза: одразу задачу не беруть (автозбереження злиються)', (await q.runOnce()) === null);
  clock += 3_500;
  const later = makeBook(Q);
  later.chapters[0].sections[0].content += '\n\nНовий абзац наприкінці.';
  latest = { ...latest, book: later };
  const job = await q.runOnce();
  const jobRow = await q.store.get(Q, job!.id);
  t('задача читає найсвіжішу книгу й завершується з підсумком',
    jobRow?.status === 'succeeded' && (jobRow.result as any)?.paragraphs?.created === 11 && jobRow.progress.done === 3, jobRow?.error ?? JSON.stringify((jobRow?.result as any)?.paragraphs));
  t('після виконання наступне збереження ставить нову', (await scheduleCoreSync(deps, latest, 'user:author-1')) === 'scheduled');
  t('без ядра — нічого не ставиться', (await scheduleCoreSync({ repo: null, queue: null }, latest, 'user:a')) === 'skipped');
}

await suite('memory', new MemoryCoreRepository(), () => new MemoryJobStore(), 'book-mem');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    const mig = await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    console.log('\nPostgreSQL — міграції:');
    t('міграції разом із 0004 накотились на порожню базу', mig.applied.includes(4), mig.applied.join());
    await suite('postgres', new PgCoreRepository(pool), () => new PgJobStore(pool), 'book-pg');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);
