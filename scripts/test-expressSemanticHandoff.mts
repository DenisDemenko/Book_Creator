import assert from 'node:assert/strict';
import {
  buildExpressSemanticTagPrefix,
  prependExpressSemanticTags,
} from '../src/utils/expressSemanticHandoff';

const cast = [
  { id: 'char-1', firstName: 'Марина', lastName: 'Василенко' },
  { id: 'char-2', firstName: 'Олександра', lastName: 'Ковальчук' },
  { id: 'char-3', firstName: 'Тарас', lastName: 'Вальц' },
];

console.log('\nExpress semantic handoff regression contract:');

const prefix = buildExpressSemanticTagPrefix(
  {
    chapterTitle: 'Початок шляху',
    involvedCharacters: ['Марина Василенко', 'Олександра'],
  },
  cast,
);

assert.match(prefix, /^\[\/chapter:Початок шляху\] \[\/outline:Початок шляху\]/);
assert.ok(prefix.includes('[/character:Марина Василенко]'));
assert.ok(prefix.includes('[/character:Олександра Ковальчук]'));
assert.ok(!prefix.includes('Тарас Вальц'));
console.log('  ✓ chapter, outline and only involved known characters are tagged deterministically');

const sanitized = buildExpressSemanticTagPrefix(
  { chapterTitle: 'Глава [1]\nНовий старт', involvedCharacters: [] },
  cast,
);
assert.ok(!sanitized.includes('\nНовий'));
assert.ok(!sanitized.includes('[1]'));
console.log('  ✓ tag values are normalized so generated text cannot break marker syntax');

const manuscript = prependExpressSemanticTags(
  '[AI-DRAFT]\n\nТекст глави\n\n[/AI-DRAFT]',
  { chapterTitle: 'Початок', involvedCharacters: ['Марина'] },
  cast,
);
assert.match(manuscript, /^\[\/chapter:Початок\].*\[AI-DRAFT\]/s);
console.log('  ✓ semantic metadata is placed before the generated AI draft block');

const idempotent = prependExpressSemanticTags(
  '[/chapter:Початок] [/outline:Початок]\n\n[AI-DRAFT]\nТекст\n[/AI-DRAFT]',
  { chapterTitle: 'Початок', involvedCharacters: ['Марина'] },
  cast,
);
assert.equal((idempotent.match(/\[\/chapter:/g) ?? []).length, 1);
console.log('  ✓ repeated handoff does not duplicate an existing semantic prefix');

console.log('\nExpress semantic handoff regression contract passed.');
