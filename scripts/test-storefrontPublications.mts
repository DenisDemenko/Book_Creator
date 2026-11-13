/**
 * Тести журналу публікацій у вітрину. Запуск: npm run test:storefront-publications
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Журнал зʼявився (#554), бо на питання «яка версія книги
 * зараз у вітрині і коли її туди поклали» відповіді не було ні в Studio, ні у
 * вітрині. Отже перевіряти треба не «записалось і прочиталось», а те, через що
 * журнал збрехав би саме тоді, коли на нього покладаються:
 *
 *  1. НУМЕРАЦІЯ окрема для кожного (вид, джерело, формат). Друкована й
 *     електронна книга — два лістинги у вітрині; спільний лічильник показував
 *     би в обох чужі номери.
 *  2. НЕВДАЧА записується і НЕ ковтається. Якщо обгортка проглине помилку,
 *     адміністратор побачить «опубліковано», а у вітрині не буде нічого —
 *     гірше, ніж не мати журналу взагалі.
 *  3. `lastPublication` віддає саме останню ВДАЛУ: її бачить покупець.
 *  4. Усі місця, що публікують, проходять через обгортку. Пропущене місце —
 *     тиха дірка: публікації йдуть, журнал їх не бачить.
 */
const DIR = '/tmp/nova-storefront-pub-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
// Без `initDb` сховища немає, і журнал чесно віддає null на кожне звернення —
// саме так він поводиться, коли Studio працює на JSON-бекенді без SQLite.
await db.initDb();
const pub = await import('../server/storefrontPublications');


let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const at = (min: number) => new Date(Date.UTC(2026, 10, 12, 10, min, 0));

console.log('\n── Нумерація публікацій ──');
const b1 = pub.recordPublication({ kind: 'book', sourceId: 'book-1', format: 'digital', version: 'v1.0.0', sourceRevision: 4, status: 'ok', externalId: 'book:book-1', title: 'Тіні Нео-Києва' }, at(1));
const b2 = pub.recordPublication({ kind: 'book', sourceId: 'book-1', format: 'digital', version: 'v1.1.0', sourceRevision: 7, status: 'ok', externalId: 'book:book-1' }, at(2));
const pr1 = pub.recordPublication({ kind: 'book', sourceId: 'book-1', format: 'print', version: 'v1.1.0', status: 'ok', externalId: 'book:book-1:print' }, at(3));
t('перша публікація — №1', b1?.publicationNo === 1, String(b1?.publicationNo));
t('друга того самого формату — №2', b2?.publicationNo === 2, String(b2?.publicationNo));
t('інший формат рахується окремо — знову №1', pr1?.publicationNo === 1, String(pr1?.publicationNo));
t('інше джерело рахується окремо', pub.recordPublication({ kind: 'book', sourceId: 'book-2', format: 'digital', status: 'ok' }, at(4))?.publicationNo === 1);
t('той самий id, але інший вид — окремий лічильник', pub.recordPublication({ kind: 'course', sourceId: 'book-1', status: 'ok' }, at(5))?.publicationNo === 1);
t('версію збережено як є', b2?.version === 'v1.1.0', String(b2?.version));
t('ревізію джерела збережено', b2?.sourceRevision === 7, String(b2?.sourceRevision));
t('назву збережено', b1?.title === 'Тіні Нео-Києва', String(b1?.title));

console.log('\n── Невдала спроба ──');
const bad = pub.recordPublication({ kind: 'book', sourceId: 'book-1', format: 'digital', version: 'v1.2.0', status: 'failed', error: 'міст відповів 502' }, at(6));
t('невдача теж займає номер — №3', bad?.publicationNo === 3, String(bad?.publicationNo));
t('статус — failed', bad?.status === 'failed');
t('текст помилки збережено', bad?.error === 'міст відповів 502');
t('невдача не має externalId', bad?.externalId === null);
const longErr = pub.recordPublication({ kind: 'product', sourceId: 'SKU-1', status: 'failed', error: 'я'.repeat(900) }, at(7));
t('задовгу помилку обрізано до 500', (longErr?.error || '').length === 500, String((longErr?.error || '').length));
const longTitle = pub.recordPublication({ kind: 'product', sourceId: 'SKU-2', status: 'ok', title: 'т'.repeat(400) }, at(8));
t('задовгу назву обрізано до 200', (longTitle?.title || '').length === 200, String((longTitle?.title || '').length));

console.log('\n── Остання вдала публікація ──');
const last = pub.lastPublication('book', 'book-1', 'digital');
t('остання вдала — друга, а не невдала третя', last?.version === 'v1.1.0', String(last?.version));
t('номер останньої вдалої — 2', last?.publicationNo === 2, String(last?.publicationNo));
t('формат print має свою останню', pub.lastPublication('book', 'book-1', 'print')?.version === 'v1.1.0');
t('без формату беремо найсвіжішу вдалу будь-якого формату', pub.lastPublication('book', 'book-1') !== null);
t('у джерела без публікацій — null', pub.lastPublication('book', 'book-999') === null);

console.log('\n── Читання журналу ──');
const all = pub.listPublications({ limit: 500 });
t('у журналі всі записи — вісім, записаних вище', all.length === 8, String(all.length));
t('найсвіжіший — перший', all[0].at > all[all.length - 1].at);
t('фільтр за видом', pub.listPublications({ kind: 'product' }).every((r) => r.kind === 'product'));
t('фільтр за джерелом', pub.listPublications({ sourceId: 'book-2' }).length === 1);
t('фільтр за статусом — дві невдачі', pub.listPublications({ status: 'failed' }).length === 2, String(pub.listPublications({ status: 'failed' }).length));
t('ліміт дотримано', pub.listPublications({ limit: 2 }).length === 2);
t('нульовий ліміт не віддає все', pub.listPublications({ limit: 0 }).length <= 100);

console.log('\n── Обгортка навколо мосту ──');
const okRes = await pub.withPublicationJournal(
  { kind: 'book', sourceId: 'book-3', format: 'digital', version: 'v2.0.0' },
  async () => ({ externalId: 'book:book-3', slug: 'teni', created: true }),
);
t('обгортка віддає результат мосту', okRes.externalId === 'book:book-3');
const okRow = pub.lastPublication('book', 'book-3', 'digital');
t('вдачу записано', okRow?.status === 'ok');
t('externalId з відповіді мосту', okRow?.externalId === 'book:book-3');
t('slug з відповіді мосту', okRow?.slug === 'teni');
t('created з відповіді мосту', okRow?.created === true);
t('версію передано в запис', okRow?.version === 'v2.0.0');

const boom = new Error('міст недоступний');
let thrown: unknown = null;
try {
  await pub.withPublicationJournal({ kind: 'course', sourceId: 'course-9', title: 'Курс' }, async () => {
    throw boom;
  });
} catch (err) {
  thrown = err;
}
t('помилку віддано далі НЕ змінивши', thrown === boom);
const failRow = pub.listPublications({ kind: 'course', sourceId: 'course-9' })[0];
t('невдачу записано', failRow?.status === 'failed');
t('у записі — текст помилки мосту', failRow?.error === 'міст недоступний');
t('невдала спроба не стає останньою вдалою', pub.lastPublication('course', 'course-9') === null);

const upd = await pub.withPublicationJournal({ kind: 'product', sourceId: 'SKU-7' }, async () => ({ externalId: 'product:SKU-7', created: false }));
t('оновлення наявного лістинга видно як created=false', pub.lastPublication('product', 'SKU-7')?.created === false, String(upd.created));

console.log('\n── Місця, що публікують, проходять через журнал ──');
const src = (p: string) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const pdfRoutes = src('server/pdfRoutesBase.ts');
const adminRoutes = src('server/adminRoutes.ts');
const moderation = src('server/moderationRoutes.ts');
const furniture = src('server/furnitureProductRoutes.ts');
const sources: Array<[string, string]> = [
  ['книга (pdfRoutesBase)', pdfRoutes],
  ['курс в адмінці (adminRoutes)', adminRoutes],
  ['курс у модерації (moderationRoutes)', moderation],
  ['виріб (furnitureProductRoutes)', furniture],
];
for (const [name, text] of sources) {
  t(name + ' імпортує журнал', text.includes("from './storefrontPublications'"));
  t(name + ' обгортає виклик', text.includes('withPublicationJournal('));
}
// НАЙВАЖЛИВІШЕ, і перевірка тут навмисно суцільна, а не по трьох відомих
// файлах: журнал нічого не вартий, якщо хоч один виклик мосту лишився повз
// нього. Саме так і сталося — тестова публікація мосту в адмінці (кнопка
// «Опублікувати тестову книгу») рік стояла осторонь і зʼявилась у вітрині,
// не лишивши сліду в обліку. Знайдено живою перевіркою 12.11.2026 (#557).
// Тому тут проглядається ВЕСЬ server/: кожен виклик `publish*ToMarketplace(`
// мусить мати `withPublicationJournal(` в попередніх рядках.
{
  const dir = new URL('../server/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const bare: string[] = [];
  let calls = 0;
  for (const f of files) {
    if (f === 'marketplaceBridge.ts') continue; // тут вони ОГОЛОШЕНІ, а не викликані
    const text = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of text.matchAll(/publish(?:Book|Course|Product)ToMarketplace\s*\(/g)) {
      // Вікно велике навмисно: опис публікації в журналі займає до десятка
      // рядків, і на 400 символах обгортка не влізала — тест «знаходив» як
      // дірки якраз ті місця, що вже обгорнуті.
      const before = text.slice(Math.max(0, m.index! - 1000), m.index!);
      const NL = String.fromCharCode(10);
      // Рядок імпорту — не виклик: `publishBookToMarketplace,` у списку імпорту.
      if (/^\s*publish(?:Book|Course|Product)ToMarketplace,?$/m.test(before.split(NL).pop() ?? '')) continue;
      calls++;
      if (!before.includes('withPublicationJournal(')) {
        bare.push(`${f}:${text.slice(0, m.index!).split(NL).length}`);
      }
    }
  }
  t('виклики мосту знайдено', calls >= 5, String(calls));
  t('жоден виклик мосту не йде повз журнал', bare.length === 0, bare.join(', '));
}
t('тестова публікація мосту теж у журналі',
  adminRoutes.includes("sourceId: bridgeTestBook().bookId"));
t('конструкторську картку теж записано', furniture.includes("kind: 'product', sourceId: String(constructorId(id))"));
t('книга передає свою версію й ревізію', pdfRoutes.includes('sourceRevision: stored.revision'));

console.log('\n── Читання з адмінки ──');
t('маршрут журналу є', adminRoutes.includes("app.get('/api/admin/storefront-publications'"));
t('маршрут лише для адміна', adminRoutes.includes("app.get('/api/admin/storefront-publications', requireAdmin"));
t('маршрут фільтрує вид', adminRoutes.includes("kind === 'book' || kind === 'course' || kind === 'product'"));
const view = src('src/components/AdminProductsView.tsx');
t('адмінка читає журнал', view.includes('/api/admin/storefront-publications?limit=200'));
t('журнал показано окремим розділом', view.includes('Публікації у вітрину'));
t('у рядку вітрини видно версію й дату', view.includes('pubVersionLabel(pub)') && view.includes('pubWhen(pub.at)'));
t('невдалі спроби видно в адмінці', view.includes("'Не вдалося'"));
t('відмова журналу не ховає решти переліку', view.includes('if (pubRes.ok && Array.isArray(pubData.publications))'));

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail) process.exit(1);
