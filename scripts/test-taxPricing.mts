/** Тести податкових сценаріїв і розрахунку цін підписок (server/taxPricing.ts). */
import assert from 'node:assert/strict';
import {
  TAX_REGIMES,
  TAX_REGIME_IDS,
  targetMargin,
  monthlyPriceUah,
  priceBreakdown,
  roundUpPrice,
} from '../server/taxPricing.ts';

let passed = 0;
let failed = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${(e as Error).message}`);
  }
}

const PAID = ['start', 'pro', 'ultra', 'team'];

console.log('\nВирівнювання цін:');
t('до 1000 — кратне 10', () => assert.equal(roundUpPrice(213.1), 220));
t('точне кратне не зсувається', () => assert.equal(roundUpPrice(220), 220));
t('від 1000 — кратне 100', () => assert.equal(roundUpPrice(2463.6), 2500));

console.log('\nМаржа 30% у кожному режимі:');
for (const id of TAX_REGIME_IDS) {
  for (const plan of PAID) {
    t(`${id}/${plan}: маржа ≥ 30% і ціна кратна 10/100`, () => {
      const regime = TAX_REGIMES[id];
      const price = monthlyPriceUah(regime, plan);
      const b = priceBreakdown(regime, plan, price);
      assert.ok(b.marginShare >= targetMargin() - 1e-9, `маржа ${b.marginShare}`);
      assert.equal(price % (price < 1000 ? 10 : 100), 0);
      // ціна без запасу в один крок округлення маржу не тримала б
      const lower = priceBreakdown(regime, plan, price - (price < 1000 ? 10 : 100));
      assert.ok(lower.marginShare < targetMargin(), 'ціна завищена більш ніж на крок');
    });
  }
}

console.log('\nПДВ:');
t('260 грн з ПДВ → ПДВ 43.33, без ПДВ 216.67', () => {
  const b = priceBreakdown(TAX_REGIMES.vat_payer, 'start', 260);
  assert.equal(b.vatUah, 43.33);
  assert.equal(b.netUah, 216.67);
});
t('ФОП 5% без ПДВ: ПДВ = 0', () => {
  assert.equal(priceBreakdown(TAX_REGIMES.fop3_5pct, 'start', 260).vatUah, 0);
});
t('ціни зростають із тарифом у кожному режимі', () => {
  for (const id of TAX_REGIME_IDS) {
    const p = PAID.map((plan) => monthlyPriceUah(TAX_REGIMES[id], plan));
    assert.deepEqual([...p].sort((a, b) => a - b), p);
  }
});

console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
if (failed > 0) process.exit(1);
