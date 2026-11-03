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
  { id: 'e1', name: 'Страх', status: 'confirmed', type: 'emotion' },
  { id: 'e2', name: 'Надія', status: 'suggested', type: 'emotion' },
  { id: 'e3', name: 'Олена', status: 'confirmed', type: 'character' },
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


console.log('\nКілька тегів одразу:');
{
  const mentions = [
    { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed' },
    { entityId: 'e3', paragraphId: 'p-s1-0', status: 'confirmed' },
    { entityId: 'e1', paragraphId: 'p-s2-0', status: 'confirmed' },
    { entityId: 'e3', paragraphId: 'p-s3-0', status: 'confirmed' },
  ];
  const any = buildTagHits({ ...base(mentions), slugs: ['emotion', 'character'] });
  t('режим «будь-який» бере всі три абзаци', any.total === 3, String(any.total));
  const all = buildTagHits({ ...base(mentions), slugs: ['emotion', 'character'], mode: 'all' });
  t('режим «усі» лишає тільки абзац з обома', all.total === 1, String(all.total));
  t('це саме той абзац', all.hits[0]?.paragraphId === 'p-s1-0', String(all.hits[0]?.paragraphId));
  t('типи влучення перелічені', all.hits[0]?.types.slice().sort().join(',') === 'character,emotion', String(all.hits[0]?.types));
  const one = buildTagHits({ ...base(mentions), slugs: ['character'] });
  t('вибірка за одним типом відсікає чужі', one.total === 2, String(one.total));
}

console.log('\nПошук за значенням після двокрапки:');
{
  const mentions = [
    { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх висоти' },
    { entityId: 'e1', paragraphId: 'p-s1-1', status: 'confirmed', value: 'страх темряви' },
    { entityId: 'e2', paragraphId: 'p-s2-0', status: 'confirmed', value: 'надія на лист' },
  ];
  const r = buildTagHits({ ...base(mentions), slugs: ['emotion'], value: 'темряв' });
  t('знайдено за підрядком значення', r.total === 1, String(r.total));
  t('це потрібний абзац', r.hits[0]?.paragraphId === 'p-s1-1', String(r.hits[0]?.paragraphId));
  t('значення видно у відповіді', r.hits[0]?.entities[0].value === 'страх темряви', String(r.hits[0]?.entities[0].value));
  const byName = buildTagHits({ ...base(mentions), slugs: ['emotion'], value: 'надія' });
  t('шукає і за назвою сутності', byName.total === 1, String(byName.total));
  const none = buildTagHits({ ...base(mentions), slugs: ['emotion'], value: 'якого немає' });
  t('нічого не знайдено — це порожньо, не помилка', none.total === 0);
}

console.log('\nТа сама сутність із різними значеннями:');
{
  const r = buildTagHits(
    base([
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх висоти' },
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх темряви' },
      { entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх висоти' },
    ])
  );
  t('два різні значення — два записи', r.hits[0].entities.length === 2, String(r.hits[0].entities.length));
  t('повтор того самого значення — один', r.hits[0].entities.filter((e) => e.value === 'страх висоти').length === 1);
}

console.log('\nПосторінкова видача:');
{
  const mentions = ['p-s1-0', 'p-s1-1', 'p-s2-0', 'p-s3-0'].map((paragraphId) => ({
    entityId: 'e1',
    paragraphId,
    status: 'confirmed',
  }));
  const page1 = buildTagHits({ ...base(mentions), limit: 2 });
  const page2 = buildTagHits({ ...base(mentions), limit: 2, offset: 2 });
  t('перша сторінка', page1.hits.map((h) => h.paragraphId).join(',') === 'p-s1-0,p-s1-1', page1.hits.map((h) => h.paragraphId).join(','));
  t('друга сторінка', page2.hits.map((h) => h.paragraphId).join(',') === 'p-s2-0,p-s3-0', page2.hits.map((h) => h.paragraphId).join(','));
  t('сторінки не перетинаються', !page1.hits.some((a) => page2.hits.some((b) => a.paragraphId === b.paragraphId)));
  t('total однаковий на обох', page1.total === 4 && page2.total === 4);
  t('зсув повернено', page2.offset === 2, String(page2.offset));
  t('за межею — порожньо', buildTagHits({ ...base(mentions), offset: 99 }).hits.length === 0);
}


console.log('\nТеги з тексту абзаців (друге джерело):');
{
  // Ядро цього тега не знає: значення порожнє, синк його пропускає.
  const r = buildTagHits({
    ...base([]),
    slugs: ['emotion'],
    textTags: [{ paragraphId: 'p-s1-0', type: 'emotion', value: '' }],
  });
  t('тег із порожнім значенням знайдено', r.total === 1, String(r.total));
  t('це потрібний абзац', r.hits[0]?.paragraphId === 'p-s1-0');
  t('його позначено як «у тексті», не як сутність ядра', r.hits[0]?.entities[0].status === 'in_text', String(r.hits[0]?.entities[0].status));
  t('порожній тег не рахується різною сутністю', r.entitiesFound === 0, String(r.entitiesFound));
}

{
  const r = buildTagHits({
    ...base([{ entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх' }]),
    slugs: ['emotion'],
    textTags: [{ paragraphId: 'p-s1-0', type: 'emotion', value: 'страх' }],
  });
  t('той самий тег із ядра й з тексту — один запис', r.hits[0].entities.length === 1, String(r.hits[0].entities.length));
}

{
  const r = buildTagHits({
    ...base([{ entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх' }]),
    slugs: ['emotion'],
    textTags: [
      { paragraphId: 'p-s1-0', type: 'emotion', value: 'страх @Олена' },
      { paragraphId: 'p-s1-0', type: 'emotion', value: '' },
    ],
  });
  t('«страх @Олена» — той самий, що «Страх» із ядра', r.hits[0].entities.filter((e) => e.value !== '').length === 1, String(r.hits[0].entities.length));
  t('порожній тег лишається окремим записом', r.hits[0].entities.some((e) => e.value === ''));
}

{
  const r = buildTagHits({
    ...base([]),
    slugs: ['emotion'],
    value: 'темряв',
    textTags: [
      { paragraphId: 'p-s1-0', type: 'emotion', value: '' },
      { paragraphId: 'p-s1-1', type: 'emotion', value: 'страх темряви' },
    ],
  });
  t('пошук за значенням не тягне порожні теги', r.total === 1 && r.hits[0].paragraphId === 'p-s1-1', String(r.total));
}

{
  const r = buildTagHits({
    ...base([]),
    slugs: ['emotion', 'character'],
    mode: 'all',
    textTags: [
      { paragraphId: 'p-s1-0', type: 'emotion', value: '' },
      { paragraphId: 'p-s1-0', type: 'character', value: 'Олена' },
      { paragraphId: 'p-s1-1', type: 'emotion', value: '' },
    ],
  });
  t('режим «усі» працює і по тегах із тексту', r.total === 1 && r.hits[0].paragraphId === 'p-s1-0', String(r.total));
}

{
  const r = buildTagHits({
    ...base([]),
    slugs: ['emotion'],
    textTags: [
      { paragraphId: 'p-dead', type: 'emotion', value: 'x' },
      { paragraphId: 'p-in-dead-section', type: 'emotion', value: 'y' },
      { paragraphId: 'p-missing', type: 'emotion', value: 'z' },
      { paragraphId: 'p-s1-0', type: 'location', value: 'чужий тип' },
    ],
  });
  t('видалені абзаци й чужі типи з тексту не потрапляють', r.total === 0, String(r.total));
}


console.log('\nПошук за номером екземпляра:');
{
  const textTags = [
    { paragraphId: 'p-s1-0', type: 'emotion', value: '#1' },
    { paragraphId: 'p-s1-1', type: 'emotion', value: '#2' },
    { paragraphId: 'p-s2-0', type: 'emotion', value: '#17' },
    { paragraphId: 'p-s3-0', type: 'location', value: '#17' },
    { paragraphId: 'p-s1-0', type: 'emotion', value: 'страх #17' },
  ];
  const all = buildTagHits({ ...base([]), slugs: ['emotion'], textTags });
  t('без номера — усі абзаци з емоціями', all.total === 3, String(all.total));
  const one = buildTagHits({ ...base([]), slugs: ['emotion'], textTags, instance: 17 });
  t('емоція №17 — два записи на різних абзацах', one.total === 2, String(one.total));
  t('це p-s1-0 («страх #17») і p-s2-0 («#17»)', one.hits.map((h) => h.paragraphId).join() === 'p-s1-0,p-s2-0', one.hits.map((h) => h.paragraphId).join());
  t('номер екземпляра розібрано з значення', one.hits[1].entities[0].instance === 17, String(one.hits[1].entities[0].instance));
  const other = buildTagHits({ ...base([]), slugs: ['location'], textTags, instance: 17 });
  t('той самий номер іншого типу — окремо', other.total === 1 && other.hits[0].paragraphId === 'p-s3-0');
  const none = buildTagHits({ ...base([]), slugs: ['emotion'], textTags, instance: 99 });
  t('номера немає — порожньо, не помилка', none.total === 0);
  const zero = buildTagHits({ ...base([]), slugs: ['emotion'], textTags, instance: 0 });
  t('номер 0 теж фільтрує (а не вважається «без фільтра»)', zero.total === 0);
  const mention = buildTagHits({ ...base([{ entityId: 'e1', paragraphId: 'p-s1-0', status: 'confirmed', value: 'страх' }]), slugs: ['emotion'], instance: 17 });
  t('запис із ядра номера не має — при фільтрі за номером його немає', mention.total === 0);
}

console.log('\nНомер абзацу з його власного тега:');
{
  const withNumbers = {
    ...base([]),
    paragraphs: [
      { id: 'p-s1-0', documentId: 's1', order: 0, text: '[/emotion:#3] [/paragraph:#412] Абзац.', editorPid: 'pid-a', deletedAt: null },
      { id: 'p-s1-1', documentId: 's1', order: 1, text: '[/emotion:#4] Без номера абзацу.', editorPid: null, deletedAt: null },
      { id: 'p-s2-0', documentId: 's2', order: 0, text: '[/emotion:#5] [/paragraph:Вступ] Іменований, не номер.', editorPid: null, deletedAt: null },
    ],
  };
  const r = buildTagHits({
    ...withNumbers,
    slugs: ['emotion'],
    textTags: [
      { paragraphId: 'p-s1-0', type: 'emotion', value: '#3' },
      { paragraphId: 'p-s1-1', type: 'emotion', value: '#4' },
      { paragraphId: 'p-s2-0', type: 'emotion', value: '#5' },
    ],
  });
  t('номер абзацу взято з тега paragraph', r.hits[0].paragraphNumber === 412, String(r.hits[0].paragraphNumber));
  t('абзац без тега номера — undefined', r.hits[1].paragraphNumber === undefined);
  t('іменований [/paragraph:Вступ] номером не вважається', r.hits[2].paragraphNumber === undefined);

  const byParagraph = buildTagHits({ ...withNumbers, slugs: ['paragraph'], textTags: [{ paragraphId: 'p-s1-0', type: 'paragraph', value: '#412' }], instance: 412 });
  t('шукаємо абзац за його номером: тип paragraph + 412', byParagraph.total === 1 && byParagraph.hits[0].paragraphId === 'p-s1-0');
}

console.log('\nПовний текст для чату:');
{
  const full = {
    ...base([]),
    paragraphs: [
      { id: 'p-s1-0', documentId: 's1', order: 0, text: '[/emotion:#3] [/paragraph:#12] Олена  злякалась на мосту.', editorPid: 'pid-a', deletedAt: null },
      { id: 'p-s1-1', documentId: 's1', order: 1, text: '[/emotion:#4] ' + 'д'.repeat(400), editorPid: null, deletedAt: null },
    ],
  };
  const tags = [
    { paragraphId: 'p-s1-0', type: 'emotion', value: '#3' },
    { paragraphId: 'p-s1-1', type: 'emotion', value: '#4' },
  ];
  const without = buildTagHits({ ...full, slugs: ['emotion'], textTags: tags });
  t('без прапора тексту у влученні його немає', without.hits[0].text === undefined);
  const withText = buildTagHits({ ...full, slugs: ['emotion'], textTags: tags, includeText: true });
  t('з прапором — текст без тегів', withText.hits[0].text === 'Олена злякалась на мосту.', JSON.stringify(withText.hits[0].text));
  t('довгий абзац — ПОВНІСТЮ, не уривок', withText.hits[1].text === 'д'.repeat(400) && withText.hits[1].excerpt.length < 400, String(withText.hits[1].text?.length));
  t('уривок і далі короткий', withText.hits[0].excerpt.length <= 50);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
