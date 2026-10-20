/**
 * Тести гаманця балів і цін у балах (server/creditWallet.ts, creditPricing.ts).
 * Працює на SQLite у памʼяті — справжньої бази не чіпає.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CREDIT_SCHEMA } from '../server/creditSchema.ts';
import { CreditWallet, WalletError } from '../server/creditWallet.ts';
import { creditsForCostUsd, quoteCredits, meetsTargetMargin, CreditPriceError } from '../server/creditPricing.ts';

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

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(CREDIT_SCHEMA);
  return { db, w: new CreditWallet(db as any) };
}
function code(fn: () => unknown): string {
  try {
    fn();
    return 'no-error';
  } catch (e) {
    return (e as WalletError | CreditPriceError).code ?? (e as Error).message;
  }
}

console.log('\nЦіна в балах (маржа 30%, не націнка):');
t('Nano Banana 2 1K $0.067 → 96 балів', () => assert.equal(creditsForCostUsd(0.067), 96));
t('$0.0336 → рівно 48 (без плаваючої похибки)', () => assert.equal(creditsForCostUsd(0.0336), 48));
t('GPT Image 1.5 high 1024² $0.133 → 190', () => assert.equal(creditsForCostUsd(0.133), 190));
t('Nano Banana Pro 4K $0.240 → 343', () => assert.equal(creditsForCostUsd(0.24), 343));
t('інваріант 30% для набору моделей', () => {
  for (const c of [0.0336, 0.067, 0.101, 0.151, 0.134, 0.24, 0.03, 0.04, 0.034, 0.05, 0.2, 0.0449, 0.1121, 0.0762, 0.012]) {
    assert.ok(meetsTargetMargin(c, creditsForCostUsd(c)), `C=${c}`);
  }
});
t('невідома/нульова собівартість → IMAGE_PRICE_UNKNOWN', () => {
  assert.equal(code(() => creditsForCostUsd(0)), 'IMAGE_PRICE_UNKNOWN');
  assert.equal(code(() => creditsForCostUsd(NaN)), 'IMAGE_PRICE_UNKNOWN');
});
t('quote: max ≥ estimated (запас +10%)', () => {
  const q = quoteCredits(0.067);
  assert.equal(q.estimatedCredits, 96);
  assert.ok(q.maxCredits > q.estimatedCredits);
});

console.log('\nНарахування:');
t('грант нараховується один раз за ключем (C-02)', () => {
  const { w } = fresh();
  assert.equal(w.grant('u1', 2000, 'pay-1:2026-10', 'Start'), true);
  assert.equal(w.grant('u1', 2000, 'pay-1:2026-10', 'Start'), false);
  assert.equal(w.getBalance('u1').available, 2000);
});

console.log('\nРезерв і списання:');
t('C-04: є 100, потрібно 120 — відмова, баланс не змінився', () => {
  const { w } = fresh();
  w.grant('u1', 100, 'g1', 't');
  assert.equal(code(() => w.reserve('u1', 'j1', 120)), 'IMAGE_CREDITS_LOW');
  assert.deepEqual(w.getBalance('u1'), { userId: 'u1', available: 100, reserved: 0 });
});
t('C-05: є 120, quote 100 — рівно один резерв 100', () => {
  const { w } = fresh();
  w.grant('u1', 120, 'g1', 't');
  w.reserve('u1', 'j1', 100);
  assert.deepEqual(w.getBalance('u1'), { userId: 'u1', available: 20, reserved: 100 });
});
t('C-06: другий запит на ті самі останні бали не проходить', () => {
  const { w } = fresh();
  w.grant('u1', 100, 'g1', 't');
  w.reserve('u1', 'j1', 100);
  assert.equal(code(() => w.reserve('u1', 'j2', 100)), 'IMAGE_CREDITS_LOW');
});
t('C-10: повтор reserve з тим самим jobKey не резервує вдруге', () => {
  const { w } = fresh();
  w.grant('u1', 300, 'g1', 't');
  w.reserve('u1', 'j1', 100);
  w.reserve('u1', 'j1', 100);
  assert.equal(w.getBalance('u1').available, 200);
});
t('C-07: успіх — списано фактичне, залишок резерву повернено', () => {
  const { w } = fresh();
  w.grant('u1', 500, 'g1', 't');
  w.reserve('u1', 'j1', 110);
  w.settle('j1', 96);
  assert.deepEqual(w.getBalance('u1'), { userId: 'u1', available: 404, reserved: 0 });
});
t('C-19: повторний settle без ефекту', () => {
  const { w } = fresh();
  w.grant('u1', 500, 'g1', 't');
  w.reserve('u1', 'j1', 110);
  w.settle('j1', 96);
  w.settle('j1', 96);
  assert.equal(w.getBalance('u1').available, 404);
});
t('списання понад резерв заборонене', () => {
  const { w } = fresh();
  w.grant('u1', 500, 'g1', 't');
  w.reserve('u1', 'j1', 100);
  assert.equal(code(() => w.settle('j1', 101)), 'CHARGE_EXCEEDS_RESERVE');
});
t('C-08/C-09: release повертає весь резерв; повтор безпечний', () => {
  const { w } = fresh();
  w.grant('u1', 500, 'g1', 't');
  w.reserve('u1', 'j1', 200);
  w.release('j1', '429');
  w.release('j1', '429');
  assert.deepEqual(w.getBalance('u1'), { userId: 'u1', available: 500, reserved: 0 });
});
t('після списання release заборонений, після release — settle', () => {
  const { w } = fresh();
  w.grant('u1', 500, 'g1', 't');
  w.reserve('u1', 'a', 100);
  w.settle('a', 100);
  assert.equal(code(() => w.release('a')), 'RESERVATION_CLOSED');
  w.reserve('u1', 'b', 100);
  w.release('b');
  assert.equal(code(() => w.settle('b', 50)), 'RESERVATION_CLOSED');
});
t('невідомий резерв', () => {
  const { w } = fresh();
  assert.equal(code(() => w.settle('nope', 1)), 'RESERVATION_NOT_FOUND');
});

console.log('\nАдмін-коригування та журнал:');
t('C-18: коригування потребує причини й оператора', () => {
  const { w } = fresh();
  assert.equal(code(() => w.adjust('u1', 50, '', 'admin')), 'REASON_REQUIRED');
  w.adjust('u1', 50, 'компенсація', 'admin@x');
  assert.equal(w.getBalance('u1').available, 50);
  const row = w.listLedger('u1')[0];
  assert.equal(row.kind, 'adjustment');
  assert.equal(row.operator, 'admin@x');
});
t('коригування не веде баланс нижче нуля', () => {
  const { w } = fresh();
  w.grant('u1', 10, 'g1', 't');
  assert.equal(code(() => w.adjust('u1', -11, 'r', 'op')), 'IMAGE_CREDITS_LOW');
});
t('журнал збігається з балансом (звірка)', () => {
  const { w } = fresh();
  w.grant('u1', 1000, 'g1', 't');
  w.reserve('u1', 'j1', 150);
  w.settle('j1', 96);
  w.reserve('u1', 'j2', 80);
  w.release('j2');
  const rows = w.listLedger('u1');
  const avail = rows.reduce((s, r) => s + r.availableDelta, 0);
  const resv = rows.reduce((s, r) => s + r.reservedDelta, 0);
  const b = w.getBalance('u1');
  assert.equal(avail, b.available);
  assert.equal(resv, b.reserved);
  assert.equal(b.available, 1000 - 96);
});
t('баланси користувачів ізольовані (C-17 на рівні сховища)', () => {
  const { w } = fresh();
  w.grant('u1', 100, 'g1', 't');
  assert.equal(w.getBalance('u2').available, 0);
});

console.log(`\nРезультат: ${passed} пройдено, ${failed} провалено`);
if (failed > 0) process.exit(1);
