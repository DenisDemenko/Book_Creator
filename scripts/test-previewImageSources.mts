import assert from 'node:assert/strict';
import { assetUrl, normalizeHtmlImageSources } from '../src/utils/assetUrl';

console.log('\nPreview image source normalization:');

assert.equal(assetUrl('/api/media/1', '/studio/'), '/studio/api/media/1');
assert.equal(assetUrl('api/media/1', '/studio/'), '/studio/api/media/1');
assert.equal(assetUrl('/generated/a.png', '/studio/'), '/studio/generated/a.png');
assert.equal(assetUrl('generated/a.png', '/studio/'), '/studio/generated/a.png');
console.log('  ✓ root-relative and legacy relative internal asset paths resolve through BASE_URL');

const html = [
  '<p>before</p>',
  '<img src="api/media/one" alt="one">',
  "<img class='x' src='/generated/two.png'>",
  '<img src=https://cdn.example.com/three.png>',
  '<img src="data:image/png;base64,AAAA">',
  '<p data-src="api/not-an-image">after</p>',
].join('');

const normalized = normalizeHtmlImageSources(html, '/studio/');
assert.ok(normalized.includes('src="/studio/api/media/one"'));
assert.ok(normalized.includes("src='/studio/generated/two.png'"));
assert.ok(normalized.includes('src=https://cdn.example.com/three.png'));
assert.ok(normalized.includes('src="data:image/png;base64,AAAA"'));
assert.ok(normalized.includes('data-src="api/not-an-image"'));
console.log('  ✓ raw imported <img src> is normalized without touching external/data URLs or unrelated attributes');

console.log('\nPreview image source normalization contract passed.');
