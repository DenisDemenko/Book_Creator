/**
 * Юніт-тести для server/claudeManuscript.ts (форматування файлу під KDP)
 * та тарифу Claude у server/pricing.ts. Без реального ANTHROPIC_API_KEY
 * можна перевірити лише шлях без ключа й вхідну валідацію — так само,
 * як test-imageGeneration.mts перевіряє no_key без реального GEMINI_API_KEY.
 */
import assert from 'node:assert/strict';
import {
  formatManuscriptWithClaude,
  ClaudeManuscriptError,
  MAX_MANUSCRIPT_CHARS,
} from '../server/claudeManuscript.ts';
import { priceForClaudeText, priceForTextEngine, CLAUDE_TEXT_PRICING } from '../server/pricing.ts';

let passed = 0;
let failed = 0;
function t(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function main() {
  // Гарантуємо, що ключ не заданий для цього прогону (незалежно від .env хосту).
  delete process.env.ANTHROPIC_API_KEY;

  console.log('\nБез ключа Anthropic:');
  try {
    await formatManuscriptWithClaude({ text: 'Якийсь текст рукопису.' });
    t('кидає помилку без ключа', false, 'виклик пройшов, хоча не мав');
  } catch (e: any) {
    t('кидає ClaudeManuscriptError', e instanceof ClaudeManuscriptError);
    t('kind = no_key', e.kind === 'no_key', e.kind);
    t('повідомлення згадує ANTHROPIC_API_KEY', /ANTHROPIC_API_KEY/.test(e.message));
  }

  console.log('\nВалідація вхідних даних (перевіряється до звернення до мережі):');
  process.env.ANTHROPIC_API_KEY = 'fake-key-for-validation-only';
  try {
    await formatManuscriptWithClaude({ text: '   ' });
    t('порожній текст відхиляється', false);
  } catch (e: any) {
    t('kind = bad_input для порожнього тексту', e.kind === 'bad_input', e.kind);
  }

  try {
    await formatManuscriptWithClaude({ text: 'а'.repeat(MAX_MANUSCRIPT_CHARS + 1) });
    t('занадто довгий текст відхиляється', false);
  } catch (e: any) {
    t('kind = too_long для тексту понад ліміт', e.kind === 'too_long', e.kind);
    t('повідомлення називає ліміт символів', e.message.includes(MAX_MANUSCRIPT_CHARS.toLocaleString('uk-UA')));
  }
  delete process.env.ANTHROPIC_API_KEY;

  console.log('\nТариф Claude (server/pricing.ts):');
  t('Claude Sonnet 5: 1 млн вх + 1 млн вих = 12', priceForClaudeText(1_000_000, 1_000_000) === 12);
  t('priceForTextEngine делегує на claude', priceForTextEngine('claude', 1_000_000, 0) === CLAUDE_TEXT_PRICING.inputPerMillionUsd);
  t('модель за замовчуванням claude-sonnet-5', CLAUDE_TEXT_PRICING.modelId === 'claude-sonnet-5');

  console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
