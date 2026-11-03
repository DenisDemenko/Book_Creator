/**
 * Пошук абзаців за тегом сутності: порядок книжковий, видалене не видно,
 * відхилені згадки не повертаються (постановка власника 03.11.2026).
 *
 * Без бази: `buildTagHits` — чиста функція над рядками, які їй дають. База
 * тут нічого не доводила б, а перевірку зробила б повільною й залежною від
 * того, чи піднято PostgreSQL.
 */

import { TAG_SEARCH_DEFAULT_LIMIT, buildTagHits, type TagSearchInputs } from '../server/core/tagSearch.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const excerpt = (text: string) => text.slice(0, 50);

const docs = [
  { id: 'ch1', parentId: null, order: 0, title: 'Глава 1', deletedAt: null },
  { id: 'ch2', parentId: null, order: 1, title: 'Глава 2', deletedAt: null },
  { id: 's1', parentId: 'ch1', order: 0, title: 'Розділ 1.1', deletedAt: null },
  { id: 's2', parentId: 'ch1', order: 1, title: 'Розділ 1.2', deletedAt: null },
  { id: 's3', parentId: 'ch2', order: 0, title: 'Розділ 2.1', deletedAt: null },
  { id: 'sDead', parentId: 'ch2', order: 1, title: 'Видалений розділ', deletedAt: '2026-11-03' },
];

const paras = [
  { id: 'p-s2-0', documentId: 's2', order: 0, text: 'Абзац у другому розділі.', editorPid: 'pid-b', deletedAt: null },
  { id: 'p-s1-1', documentId: 's1', order: 1, text: 'Другий абзац першого розділу.', editorPid: null, deletedAt: null },
  { id: 'p-s1-0', documentId: 's1', order: 0, text: 'Перший абзац першого розділу.', editorPid: 'pid-a', deletedAt: null },
  { id: 'p-s3-0', documentId: 's3', order: 0, text: 'Абзац другої глави.', editorPid: 'pid-c', deletedAt: null },
  { id: 'p-dead', documentId: 's1', order: 5, text: 'Видалений абзац.', editorPid: 'pid-x', deletedAt: '2026-11-03' },
  { id: 'p-in-dead-section', documentId: 'sDead', order: 0, text: 'Абзац у видаленому розділі.', editorPid: 'pid-y', deletedAt: null },
];

const entities = [
  { id: 'e1', name: 'Страх', status: 'confirmed' },
  { id: 'e2', name: 'Надія', status: 'suggested' },
];

const base = (mentions: TagSearchInputs['mentions']): TagSearchInputs => ({
  entities,
  mentions,
  paragraphs: paras,
  documents: docs,
  excerpt,
});

console.log('\nПорядок — як у книзі:');
{
  const r = buildTagHits(
    base([
      { entityId: 'e1', paragraphId: 'p-s3-0', status: 'confirmed' },
      { entityId: 'e1', paragraphId: 'p-s2-0', status: 'confirmed' },
      { entityId: 'e1', paragraphId: 'p-s1-1', status: 'confirmed' },
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed' },
    ])
  );
  t(
    'глава → розділ → абзац',
    r.hits.map((h) => h.paragraphId).join(',') === 'p-s1-0,p-s1-1,p-s2-0,p-s3-0',
    r.hits.map((h) => h.paragraphId).join(',')
  );
  t('знайдено всі чотири', r.total === 4, String(r.total));
}

console.log('\nПосилання на главу й розділ:');
{
  const r = buildTagHits(base([{ entityId: 'e1', paragraphId: 'p-s2-0', status: 'confirmed' }]));
  const h = r.hits[0];
  t('назва глави', h.chapterTitle === 'Глава 1', String(h.chapterTitle));
  t('id глави', h.chapterId === 'ch1', String(h.chapterId));
  t('назва розділу', h.sectionTitle === 'Розділ 1.2', String(h.sectionTitle));
  t('адреса в редакторі', h.editorPid === 'pid-b', h.editorPid);
  t('уривок обрізано', h.excerpt === 'Абзац у другому розділі.', h.excerpt);
}

console.log('\nБез editorPid береться id абзаца:');
{
  const r = buildTagHits(base([{ entityId: 'e1', paragraphId: 'p-s1-1', status: 'confirmed' }]));
  t('адреса не порожня', r.hits[0].editorPid === 'p-s1-1', r.hits[0].editorPid);
}

console.log('\nЩо не повертається:');
{
  const r = buildTagHits(
    base([
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'rejected' },
      { entityId: 'e1', paragraphId: 'p-dead', status: 'confirmed' },
      { entityId: 'e1', paragraphId: 'p-in-dead-section', status: 'confirmed' },
      { entityId: 'eX', paragraphId: 'p-s2-0', status: 'confirmed' },
      { entityId: 'e1', paragraphId: 'p-missing', status: 'confirmed' },
    ])
  );
  t('нічого не знайдено', r.total === 0, String(r.total));
  t('відхилена згадка — рішення автора, не показуємо', !r.hits.some((h) => h.paragraphId === 'p-s1-0'));
  t('видалений абзац', !r.hits.some((h) => h.paragraphId === 'p-dead'));
  t('абзац у видаленому розділі', !r.hits.some((h) => h.paragraphId === 'p-in-dead-section'));
}

console.log('\nКілька сутностей одного типу в одному абзаці:');
{
  const r = buildTagHits(
    base([
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed' },
      { entityId: 'e2', paragraphId: 'p-s1-0', status: 'confirmed' },
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed' },
    ])
  );
  t('абзац один, не три', r.total === 1, String(r.total));
  t('сутності перелічені обидві', r.hits[0].entities.length === 2, String(r.hits[0].entities.length));
  t('повтор тієї самої не дублюється', r.hits[0].entities.filter((e) => e.id === 'e1').length === 1);
  t('різних сутностей полічено', r.entitiesFound === 2, String(r.entitiesFound));
  t('статус сутності видно', r.hits[0].entities.some((e) => e.status === 'suggested'));
}

console.log('\nОбмеження видачі:');
{
  const many = Array.from({ length: 5 }, (_, i) => ({
    entityId: 'e1',
    paragraphId: ['p-s1-0', 'p-s1-1', 'p-s2-0', 'p-s3-0'][i % 4],
    status: 'confirmed',
  }));
  const r = buildTagHits({ ...base(many), limit: 2 });
  t('віддано лише два', r.hits.length === 2, String(r.hits.length));
  t('total рахує всі, а не віддані', r.total === 4, String(r.total));
  t('обмеження типово 200', TAG_SEARCH_DEFAULT_LIMIT === 200, String(TAG_SEARCH_DEFAULT_LIMIT));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
