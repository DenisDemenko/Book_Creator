/**
 * Тести аудиту лістинга Etsy. Запуск: npm run test:listing-audit
 *
 * ЩО САМЕ ПЕРЕВІРЯЄТЬСЯ. Аудит не має доступу до ринку — він читає лише той
 * текст, який ввів автор. Тому цінність тут не в тому, що «бал порахувався»,
 * а в двох речах:
 *
 *  1. Кожна перевірка спрацьовує на своєму випадку й мовчить на чужому:
 *     задовгий тег — це провал ліміту Etsy, а не привід знизити бал за
 *     кількість тегів.
 *  2. Бал ВІДТВОРЮЄТЬСЯ з показаних перевірок. Це та сама вимога, що й до
 *     Opportunity Score (ТЗ 28): якщо підсумок не збігається із сумою
 *     видимих доданків, він вигаданий, скільки б не був схожий на правду.
 *     Саме на цьому провалився вихідний набір: три з п'яти складників його
 *     бала були константами 90/84/88.
 */
import {
  auditListing,
  parseTags,
  ETSY_TAG_MAX,
  ETSY_TITLE_MAX,
} from '../src/components/etsy/listingAudit';

let pass = 0;
let fail = 0;
function t(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
const find = (r: ReturnType<typeof auditListing>, id: string) => r.checks.find((c) => c.id === id)!;

console.log('Розбір тегів:');
{
  t('кома-роздільник, обрізання, нижній регістр',
    JSON.stringify(parseTags(' Ceramic Mug ,  HANDMADE pottery ,, ')) ===
      JSON.stringify(['ceramic mug', 'handmade pottery']),
    JSON.stringify(parseTags(' Ceramic Mug ,  HANDMADE pottery ,, ')));
  t('подвійні пробіли всередині тега стискаються',
    parseTags('gift   for   her')[0] === 'gift for her');
  t('порожній рядок → порожній список', parseTags('   ').length === 0);
}

console.log('\nНазва:');
{
  const long = 'x'.repeat(ETSY_TITLE_MAX + 1);
  t('назва понад ліміт → fail',
    find(auditListing({ title: long, tags: '' }), 'title-length').status === 'fail');
  t('порожня назва → fail',
    find(auditListing({ title: '', tags: '' }), 'title-length').status === 'fail');
  t('коротка назва → warn (місце не використане)',
    find(auditListing({ title: 'Ceramic Mug', tags: '' }), 'title-length').status === 'warn');
  t('назва 60–140 → pass',
    find(auditListing({ title: 'Handmade Ceramic Coffee Mug with Botanical Glaze, Artisan Gift', tags: '' }), 'title-length').status === 'pass');

  const head = auditListing({
    title: 'Ceramic coffee mug handmade, botanical glaze, cottagecore kitchen',
    tags: 'ceramic coffee mug, botanical glaze',
  });
  t('тег у перших 40 символах → pass', find(head, 'title-head').status === 'pass',
    find(head, 'title-head').detail);

  const noHead = auditListing({
    title: 'A very long decorative introduction phrase that says nothing at all, ceramic coffee mug',
    tags: 'ceramic coffee mug',
  });
  t('тег лише в хвості назви → warn', find(noHead, 'title-head').status === 'warn');
  t('без тегів перевірка початку не карає (вага 0)',
    find(auditListing({ title: 'Some title here', tags: '' }), 'title-head').weight === 0);

  t('САПС у назві → warn',
    find(auditListing({ title: 'HANDMADE CERAMIC mug for coffee lovers', tags: '' }), 'title-caps').status === 'warn');
  t('звичайний регістр → pass',
    find(auditListing({ title: 'Handmade ceramic mug for coffee lovers', tags: '' }), 'title-caps').status === 'pass');
  t('короткі абревіатури не рахуються за САПС',
    find(auditListing({ title: 'Ceramic mug 12oz USA made by hand', tags: '' }), 'title-caps').status === 'pass');

  t('сім роздільників → warn',
    find(auditListing({ title: 'a | b | c | d, e - f — g – h', tags: '' }), 'title-separators').status === 'warn');
}

console.log('\nТеги:');
{
  const thirteen = Array.from({ length: ETSY_TAG_MAX }, (_, i) => `tag number ${i}`).join(', ');
  t('13 тегів → pass',
    find(auditListing({ title: 'x', tags: thirteen }), 'tag-count').status === 'pass');
  t('11 тегів → warn (не провал)',
    find(auditListing({ title: 'x', tags: thirteen.split(', ').slice(0, 11).join(', ') }), 'tag-count').status === 'warn');
  t('3 теги → fail',
    find(auditListing({ title: 'x', tags: 'a b, c d, e f' }), 'tag-count').status === 'fail');

  const tooLong = auditListing({ title: 'x', tags: 'personalized leather wallet for men, mug' });
  t('тег понад 20 символів → fail з переліком',
    find(tooLong, 'tag-length').status === 'fail' && find(tooLong, 'tag-length').detail.includes('personalized'),
    find(tooLong, 'tag-length').detail);
  t('усі теги в ліміті → pass',
    find(auditListing({ title: 'x', tags: 'ceramic mug, cozy gift' }), 'tag-length').status === 'pass');

  const dup = auditListing({ title: 'x', tags: 'ceramic mug, ceramic mugs, cozy gift' });
  t('однина/множина → дубль',
    find(dup, 'tag-duplicates').status === 'warn', find(dup, 'tag-duplicates').detail);
  t('різні теги дублем не вважаються',
    find(auditListing({ title: 'x', tags: 'ceramic mug, leather wallet' }), 'tag-duplicates').status === 'pass');

  t('чотири однослівні теги → warn',
    find(auditListing({ title: 'x', tags: 'mug, gift, pottery, cup, cozy kitchen' }), 'tag-longtail').status === 'warn');
  t('переважно фрази → pass',
    find(auditListing({ title: 'x', tags: 'ceramic mug, cozy gift, kitchen decor, mug' }), 'tag-longtail').status === 'pass');

  const overlap = auditListing({
    title: 'ceramic mug cozy gift kitchen decor handmade',
    tags: 'ceramic mug, cozy gift, kitchen decor',
  });
  t('три теги в назві → pass', find(overlap, 'tag-title-overlap').status === 'pass');
  t('перелік збігів повертається', overlap.tagsInTitle.length === 3, overlap.tagsInTitle.join('|'));

  const cyr = auditListing({ title: 'x', tags: 'керамічна чашка, ceramic mug' });
  t('кирилиця в тегах → довідкова позначка, вага 0',
    find(cyr, 'tag-language').status === 'info' && find(cyr, 'tag-language').weight === 0);
  t('без кирилиці перевірки мови немає',
    auditListing({ title: 'x', tags: 'ceramic mug' }).checks.every((c) => c.id !== 'tag-language'));
}

console.log('\nОпис і ціна:');
{
  t('порожній опис → fail',
    find(auditListing({ title: 'x', tags: '' }), 'description-head').status === 'fail');
  t('короткий опис → warn',
    find(auditListing({ title: 'x', tags: '', description: 'Коротко.' }), 'description-head').status === 'warn');
  t('опис ≥160 символів → pass',
    find(auditListing({ title: 'x', tags: '', description: 'о'.repeat(200) }), 'description-head').status === 'pass');
  t('ціна не вказана → fail',
    find(auditListing({ title: 'x', tags: '' }), 'price-set').status === 'fail');
  t('нульова ціна → fail',
    find(auditListing({ title: 'x', tags: '', priceUsd: 0 }), 'price-set').status === 'fail');
  t('ціна вказана → pass',
    find(auditListing({ title: 'x', tags: '', priceUsd: 34 }), 'price-set').status === 'pass');
}

console.log('\nБал відтворюється з показаних перевірок (ТЗ 28):');
{
  const report = auditListing({
    title: 'Handmade ceramic coffee mug with botanical glaze, cozy cottagecore kitchen decor',
    tags: 'ceramic coffee mug, botanical glaze, cozy kitchen, handmade pottery, mug',
    description: 'о'.repeat(300),
    priceUsd: 34,
  });

  // Перерахунок «руками» — рівно те, що зробив би читач, склавши стовпчик.
  let earned = 0;
  let possible = 0;
  for (const check of report.checks) {
    if (check.weight === 0) continue;
    possible += check.weight;
    if (check.status === 'pass') earned += check.weight;
    else if (check.status === 'warn') earned += check.weight / 2;
  }
  t('бал = сума ваг пройдених перевірок',
    report.score === Math.round((earned / possible) * 100),
    `${report.score} vs ${Math.round((earned / possible) * 100)}`);
  t('розкладка збігається з перерахунком',
    Math.abs(report.breakdown.earned - Math.round(earned * 100) / 100) < 1e-9 &&
      report.breakdown.possible === possible,
    JSON.stringify(report.breakdown));
  t('довідкові перевірки не входять у знаменник',
    report.checks.filter((c) => c.weight === 0).every(() => true) &&
      possible === report.checks.reduce((sum, c) => sum + c.weight, 0));
  t('бал у межах 0–100', report.score >= 0 && report.score <= 100, String(report.score));

  // Головна перевірка чесності бала. Порожній лістинг спершу набирав 43 зі
  // 100: він «проходив» перевірки на задовгі теги й дублі саме тому, що
  // тегів не було взагалі. Правдиві доданки складались у брехливий підсумок.
  const empty = auditListing({ title: '', tags: '' });
  t('порожній лістинг → 0, а не бали за відсутність помилок',
    empty.score === 0, String(empty.score));
  t('порожній лістинг: жодна перевірка не в статусі pass',
    empty.checks.every((c) => c.status !== 'pass'),
    empty.checks.filter((c) => c.status === 'pass').map((c) => c.id).join(',') || '—');
  t('перевірки без даних мають вагу 0',
    empty.checks.filter((c) => c.status === 'info').every((c) => c.weight === 0));
  t('бал не падає в NaN', Number.isFinite(empty.score), String(empty.score));

  // Лише назва — бал має піднятись рівно на її вагу, не більше.
  const titleOnly = auditListing({ title: 'Handmade ceramic coffee mug with botanical glaze, artisan gift', tags: '' });
  t('сама лише назва не дає більшості бала',
    titleOnly.score > 0 && titleOnly.score < 50, String(titleOnly.score));

  const perfect = auditListing({
    title: 'Ceramic coffee mug handmade, botanical glaze, cozy kitchen decor, stoneware gift for coffee lovers',
    tags: Array.from({ length: ETSY_TAG_MAX }, (_, i) => `phrase tag ${i}`).join(', '),
    description: 'о'.repeat(300),
    priceUsd: 34,
  });
  t('жодна перевірка не дає бал вище 100', perfect.score <= 100, String(perfect.score));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
