import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const startView = await readFile(new URL('../src/components/ExpressStartView.tsx', import.meta.url), 'utf8');
assert.match(startView, /prependExpressSemanticTags/);
assert.match(startView, /summary:\s*prependExpressSemanticTags\(chapter\.summary \?\? '', chapter, cast\)/);
assert.match(
  startView,
  /const deterministic = withDeterministicSemanticHandoff\(payload\);\s*void withJevSemanticEnrichment\(deterministic, currentBook\)\.then\(\(enriched\) => onFinish\?\.\(enriched\)\);/s,
);
console.log('  ✓ ExpressStartView applies deterministic tags first, then JEV enrichment, then hands payload to App');

assert.match(startView, /JEV failure ніколи не скасовує готову книгу/);
assert.match(startView, /catch \(error\)[\s\S]*nova:jev-wizard-enrichment[\s\S]*status: 'skipped'/);
console.log('  ✓ JEV enrichment is best-effort and cannot cancel the deterministic handoff');

console.log('\nExpress semantic handoff regression contract passed.');
