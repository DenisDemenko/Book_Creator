/**
 * Юніт-тест галереї медіа виробу (фото + відео) — частина завдання
 * «слайд-шоу товару + відео в галереї» (журнал, ~17.09.2026).
 *
 * На відміну від `test-furniturePublish.mts` (справжні файли власника, тому
 * пропускається, якщо теки з фото немає на диску), цей файл — суто юніт:
 * синтетичні data URL, без залежності від файлів на диску, тож виконується
 * щоразу в `npm run test`, на будь-якій машині.
 *
 * ЩО ПЕРЕВІРЯЄ:
 *   1. `uploadProductMedia` з мішаним набором фото+відео: обкладинкою стає
 *      ПЕРШЕ ФОТО за масивом (не буквально перший елемент — відео, навіть
 *      якщо воно опинилось у чорнетці раніше за фото, обкладинкою не стає).
 *   2. Відео їде окремим видом `'video'`, зі своїм mime і розширенням файла.
 *   3. Оборонне обрізання лишків понад `MAX_GALLERY_PHOTOS`/`MAX_GALLERY_VIDEOS`
 *      на сервері (клієнт цю межу теж тримає, але тут — друга лінія захисту).
 *   4. Чисті функції моделі: `isVideoMedia`, `furniturePublishIssues` — нові
 *      зауваження «забагато фото» / «забагато відео».
 */
import { blankFurnitureProduct, furniturePublishIssues, isVideoMedia, MAX_GALLERY_PHOTOS, MAX_GALLERY_VIDEOS } from '../src/components/adminOs/furnitureProduct';
import { uploadProductMedia } from '../server/furnitureProductRoutes';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const settings = { url: 'http://localhost:9999', key: 'test-bridge-key' };
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_VIDEO = Buffer.from('fake-mp4-bytes-for-test').toString('base64');

console.log('\nЧисті функції моделі (isVideoMedia, furniturePublishIssues):');
{
  t('isVideoMedia({kind: "video"}) === true', isVideoMedia({ kind: 'video' }) === true);
  t('isVideoMedia({kind: "image"}) === false', isVideoMedia({ kind: 'image' }) === false);
  t('isVideoMedia({}) === false (немає поля — старі чорнетки лишаються фото)', isVideoMedia({}) === false);

  const tooManyPhotos = blankFurnitureProduct();
  tooManyPhotos.media = Array.from({ length: MAX_GALLERY_PHOTOS + 1 }, (_, i) => ({
    id: `p${i}`,
    label: `Фото ${i + 1}`,
    src: 'data:image/png;base64,x',
    kind: 'image' as const,
  }));
  const issuesPhotos = furniturePublishIssues(tooManyPhotos);
  t(
    `${MAX_GALLERY_PHOTOS + 1} фото → зауваження про межу`,
    issuesPhotos.some((i) => i.includes('Забагато фото')),
    issuesPhotos.join(' | ')
  );

  const tooManyVideos = blankFurnitureProduct();
  tooManyVideos.media = [
    { id: 'cover', label: 'Головний банер', src: 'data:image/png;base64,x', kind: 'image' },
    ...Array.from({ length: MAX_GALLERY_VIDEOS + 1 }, (_, i) => ({
      id: `v${i}`,
      label: `Відео ${i + 1}`,
      src: 'data:video/mp4;base64,x',
      kind: 'video' as const,
    })),
  ];
  const issuesVideos = furniturePublishIssues(tooManyVideos);
  t(
    `${MAX_GALLERY_VIDEOS + 1} відео → зауваження про межу`,
    issuesVideos.some((i) => i.includes('Забагато відео')),
    issuesVideos.join(' | ')
  );

  const withinLimits = blankFurnitureProduct();
  withinLimits.media = [{ id: 'cover', label: 'Головний банер', src: 'data:image/png;base64,x', kind: 'image' }];
  Object.assign(withinLimits, { name: 'Тест', sku: 'T-1', priceUah: 100 });
  t('у межах ліміту — без зауважень про фото/відео', !furniturePublishIssues(withinLimits).some((i) => i.includes('Забагато')));
}

console.log('\nuploadProductMedia — мішаний набір фото + відео:');
{
  const calls: { method: string; url: string; kind?: string; name?: string; mime?: string }[] = [];
  const mediaFetch = (async (url: string, init: any = {}) => {
    const u = String(url);
    const method = String(init.method || 'GET');
    if (u.endsWith('/media') && method === 'DELETE') {
      calls.push({ method, url: u });
      return { status: 200, ok: true, text: async () => JSON.stringify({ cleared: 0 }) };
    }
    const form = init.body as FormData;
    const file = form.get('file') as unknown as { name?: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> };
    const buf = Buffer.from(await file.arrayBuffer());
    calls.push({ method, url: u, kind: String(form.get('kind')), name: file.name, mime: String(file.type) });
    void buf;
    return { status: 200, ok: true, text: async () => JSON.stringify({ attached: true, kind: form.get('kind'), replaced: 0 }) };
  }) as never;

  // Відео СПЕРШУ в масиві, фото — після. Обкладинкою має стати перше ФОТО,
  // а не буквально media[0].
  const mixedDraft = {
    sku: 'BK-ORG-VIDEO-TEST',
    media: [
      { src: `data:video/mp4;base64,${TINY_VIDEO}`, kind: 'video' as const },
      { src: `data:image/png;base64,${TINY_PNG}`, kind: 'image' as const },
      { src: `data:image/png;base64,${TINY_PNG}`, kind: 'image' as const },
    ],
  };
  const mixedRes = await uploadProductMedia(mixedDraft, 'product:BK-ORG-VIDEO-TEST', { fetch: mediaFetch, settings });

  t('усі 3 файли (2 фото + 1 відео) поїхали', mixedRes.uploaded === 3, `uploaded=${mixedRes.uploaded}`);
  t('жодної невдачі', mixedRes.failed.length === 0, mixedRes.failed.join('; '));
  t('спершу DELETE', calls[0]?.method === 'DELETE', String(calls[0]?.method));
  t('перше ФОТО (не відео!) стало обкладинкою', calls[1]?.kind === 'cover', String(calls[1]?.kind));
  t('друге фото — галерея', calls[2]?.kind === 'gallery', String(calls[2]?.kind));
  t('відео поїхало окремим видом "video"', calls[3]?.kind === 'video', String(calls[3]?.kind));
  t('відео зберегло свій mime-тип', calls[3]?.mime === 'video/mp4', String(calls[3]?.mime));
  t('імʼя відеофайла має розширення mp4', /\.mp4$/.test(String(calls[3]?.name)), String(calls[3]?.name));
}

console.log('\nuploadProductMedia — оборонне обрізання лишків понад межу:');
{
  const calls: { kind?: string }[] = [];
  const mediaFetch = (async (url: string, init: any = {}) => {
    const u = String(url);
    const method = String(init.method || 'GET');
    if (u.endsWith('/media') && method === 'DELETE') {
      return { status: 200, ok: true, text: async () => JSON.stringify({ cleared: 0 }) };
    }
    const form = init.body as FormData;
    calls.push({ kind: String(form.get('kind')) });
    return { status: 200, ok: true, text: async () => JSON.stringify({ attached: true, kind: form.get('kind'), replaced: 0 }) };
  }) as never;

  const overLimitDraft = {
    sku: 'BK-ORG-LIMIT-TEST',
    media: [
      ...Array.from({ length: MAX_GALLERY_PHOTOS + 2 }, () => ({ src: `data:image/png;base64,${TINY_PNG}`, kind: 'image' as const })),
      ...Array.from({ length: MAX_GALLERY_VIDEOS + 1 }, () => ({ src: `data:video/mp4;base64,${TINY_VIDEO}`, kind: 'video' as const })),
    ],
  };
  const res = await uploadProductMedia(overLimitDraft, 'product:BK-ORG-LIMIT-TEST', { fetch: mediaFetch, settings });
  const uploadedPhotos = calls.filter((c) => c.kind === 'cover' || c.kind === 'gallery').length;
  const uploadedVideos = calls.filter((c) => c.kind === 'video').length;

  t(`сервер обрізає фото до межі (${MAX_GALLERY_PHOTOS})`, uploadedPhotos === MAX_GALLERY_PHOTOS, String(uploadedPhotos));
  t(`сервер обрізає відео до межі (${MAX_GALLERY_VIDEOS})`, uploadedVideos === MAX_GALLERY_VIDEOS, String(uploadedVideos));
  t(
    'звіт uploaded відповідає реально надісланим файлам',
    res.uploaded === MAX_GALLERY_PHOTOS + MAX_GALLERY_VIDEOS,
    String(res.uploaded)
  );
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);
