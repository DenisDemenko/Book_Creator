import assert from 'node:assert/strict';
import { assetUrl, assetCssUrl, htmlAttribute, internalAssetPath } from '../src/utils/assetUrl';
import { renderSectionBlocksHtml } from '../src/utils/helpers';
import { initialBook } from '../src/data/initialBook';
import { wizardHarness } from './lib/wizardHarness.mts';

let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log('✓ ' + name); };
const base = '/studio/';
for (const [raw, expected] of [
  ['/api/media/file/md-a?x=1#p', '/studio/api/media/file/md-a?x=1#p'],
  ['/generated/a.png', '/studio/generated/a.png'],
  ['/studio/api/media/file/a', '/studio/api/media/file/a'],
  ['/studio/generated/a.png', '/studio/generated/a.png'],
  ['https://cdn.example.test/a.png', 'https://cdn.example.test/a.png'],
  ['//cdn.example.test/a.png', '//cdn.example.test/a.png'],
  ['data:image/png;base64,abc', 'data:image/png;base64,abc'],
  ['blob:https://example.test/id', 'blob:https://example.test/id'],
  ['/apiary/a.png', '/apiary/a.png'],
  ['/assets/a.png', '/assets/a.png'],
]) check('asset URL ' + raw.slice(0, 45), () => {
  assert.equal(assetUrl(raw, base), expected);
  assert.equal(assetUrl(expected, base), expected);
});
check('root deployment preserves internal paths', () => assert.equal(assetUrl('/api/media/file/a', '/'), '/api/media/file/a'));
check('custom deployment prefix and canonical path', () => {
  assert.equal(assetUrl('/api/media/file/a', '/writer/'), '/writer/api/media/file/a');
  assert.equal(internalAssetPath('/writer/api/media/file/a', '/writer/'), '/api/media/file/a');
  assert.equal(internalAssetPath('https://other.test/studio/api/media/file/a'), 'https://other.test/studio/api/media/file/a');
});
check('HTML and CSS escaping are separate', () => {
  assert.equal(htmlAttribute('a"&<>'), 'a&quot;&amp;&lt;&gt;');
  assert.equal(assetCssUrl('/generated/a"b.png'), 'url("/generated/a\\"b.png")');
});
const book: any = { ...initialBook, illustrations: [{ id: 'ill', url: '/api/media/file/md-a', caption: 'Скеля' }] };
const render = (s: string) => renderSectionBlocksHtml(s, book, [], []);
check('standalone image is a figure, never a paragraph', () => {
  const html = render('[IMG: ill "Скеля" wrap=none]');
  assert.ok(html.startsWith('<figure') && html.endsWith('</figure>'));
  assert.ok(!html.includes('<p>'));
});
check('inline marker splits prose without invalid nesting or reordered text', () => {
  const html = render('Перед **фото** [IMG: ill "Скеля" wrap=left] після фото.');
  assert.match(html, /^<p>Перед <strong>фото<\/strong><\/p><figure/);
  assert.match(html, /<\/figure><p>після фото\.<\/p>$/);
});
check('heading and divider do not create invalid paragraphs', () => {
  assert.ok(!render('# Назва').includes('<p>'));
  assert.ok(!render('[DIVIDER]').includes('<p>'));
});
check('unknown images remain visible as markers', () => assert.ok(render('[IMG: missing "Немає"]').includes('[IMG: missing')));
check('caption and attribute cannot create markup', () => {
  const html = render('[IMG: ill "<script>no</script>"]');
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
});
check('service metadata stays invisible', () => assert.equal(render('[/chapter:c]\n\n[AI-DRAFT]\n\nТекст\n\n[/AI-DRAFT]'), '<p>Текст</p>'));

const h = await wizardHarness();
try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1kAAAAASUVORK5CYII=', 'base64');
  const asset = await h.media.saveAsset({ ownerId: 'writer', kind: 'upload', filename: 'media.png', mimeType: 'image/png', bytes: png });
  const { loadImageBytes } = await import('../server/media/imageBytes');
  const url = '/studio' + asset.url;
  const loaded = await loadImageBytes(url, 'writer');
  check('server export reads prefixed private asset with owner check', () => assert.deepEqual(loaded.bytes, png));
  await assert.rejects(loadImageBytes(url, 'other'), /не знайдено/);
  await assert.rejects(loadImageBytes(url), /не знайдено/);
  check('prefixed URLs do not bypass owner or unauthenticated checks', () => {});
} finally { await h.close(); }
console.log('Підсумок: ' + count + ' пройшло.');
