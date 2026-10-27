import assert from "node:assert/strict";
import type { Express } from "express";
import { requireAdmin } from "../server/auth";
import { registerSlabTableRoutes, requireSlabInventory } from "../server/slabTableBridge";
import { deriveTableTariffs, tableBridge } from "../server/slabTableBridge";
import {
  calculateWoodAndEpoxyCost,
  DEFAULT_CURRENCY_RATES,
} from "../src/components/adminOs/furnitureCalculator/utils/calculator";
import { PRODUCT_TEMPLATES } from "../src/components/adminOs/furnitureCalculator/data/woodPresets";
const input = PRODUCT_TEMPLATES[0].input,
  rates = DEFAULT_CURRENCY_RATES;
const mapped = deriveTableTariffs(input, rates, 6500),
  calc = calculateWoodAndEpoxyCost(input, rates),
  a = mapped.referenceAreaM2;
assert.equal(mapped.data.resin * mapped.data.density, input.epoxyPricePerLiter);
assert.equal(mapped.data.waste, input.epoxyWastePercent);
assert.equal(mapped.data.wood, 6500);
assert.ok(
  Math.abs(mapped.data.finish * a - calc.totalFinishingGroupCost) < 1e-7,
);
assert.ok(Math.abs(mapped.data.metal - calc.metalBaseGroupCost) < 1e-7);
const referenceBase =
  mapped.data.work * a +
  mapped.data.finish * a +
  mapped.data.metal +
  calc.woodCostNet +
  calc.woodDryingCost +
  calc.epoxyMaterialCost;
assert.ok(Math.abs(referenceBase - calc.fullCostPrice) < 1e-7);
assert.ok(
  Math.abs(
    referenceBase * (1 + mapped.data.markup / 100) - calc.totalSellingPrice,
  ) < 1e-6,
);
assert.throws(() =>
  deriveTableTariffs({ ...input, woodWidthMm: 0 }, rates, 6500),
);
assert.throws(() => deriveTableTariffs(input, { ...rates, USD: 0 }, 6500));
let called = false;
const mocked: typeof fetch = async (url, options) => {
  called = true;
  assert.equal(String(url), "https://example.test/bridge/tables/state");
  assert.equal(
    (options?.headers as Record<string, string>)["x-bridge-key"],
    "test-only-key",
  );
  assert.equal(options?.redirect, "error");
  return new Response(JSON.stringify({ slabs: [] }), { status: 200 });
};
assert.deepEqual(
  await tableBridge("GET", "/state", undefined, {
    settings: { url: "https://example.test", key: "test-only-key" },
    fetch: mocked,
  }),
  { slabs: [] },
);
assert.equal(called, true);
await assert.rejects(() =>
  tableBridge("GET", "/../secrets", undefined, {
    settings: { url: "https://example.test", key: "test-only-key" },
    fetch: mocked,
  }),
);
await assert.rejects(
  () =>
    tableBridge("GET", "/state", undefined, {
      settings: { url: "https://example.test", key: "test-only-key" },
      fetch: async () =>
        new Response(JSON.stringify({ message: "Bridge denied" }), {
          status: 403,
        }),
    }),
  /Bridge denied/,
);
console.log(
  "Slab bridge passed: tariff units, complete reference cost reconstruction, markup/tax, invalid inputs, server-only key, route allowlist, redirect rejection, remote errors.",
);

const routes: { path: string; handlers: unknown[] }[] = [];
const app = new Proxy(
  {},
  {
    get:
      () =>
      (path: string, ...handlers: unknown[]) => {
        routes.push({ path, handlers });
      },
  },
) as Express;
registerSlabTableRoutes(app);
assert.equal(routes.length, 9);
for (const r of routes) {
  const inventory = /\/(state|slabs)(\/|$)/.test(r.path);
  assert.equal(r.handlers[0], inventory ? requireSlabInventory : requireAdmin, r.path);
}
for (const principal of [
  undefined,
  { role: "reader", isGuest: false },
  { role: "site_manager", isGuest: false },
  { role: "admin", isGuest: true },
]) {
  let status = 0,
    next = false;
  const res = {
    status: (n: number) => {
      status = n;
      return res;
    },
    json: () => res,
  };
  requireAdmin({ principal } as never, res as never, () => {
    next = true;
  });
  assert.equal(status, 403);
  assert.equal(next, false);
}
console.log(
  "All nine Studio routes guarded; inventory has shared designer access, costs/production/textures remain admin-only.",
);
