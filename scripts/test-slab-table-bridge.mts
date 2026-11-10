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
assert.equal(routes.length, 23);
assert.ok(routes.some((r) => r.path === "/api/admin/slab-tables/drawings-templates" && r.handlers[0] === requireAdmin), "the list of PDF templates is for the administrator only");
assert.ok(routes.some((r) => r.path === "/api/admin/slab-tables/drawings/:id" && r.handlers[0] === requireAdmin), "the PDF drawings are for the administrator only");
assert.ok(routes.some((r) => r.path === "/api/admin/slab-tables/resin-textures/:id" && r.handlers[0] === requireAdmin), "texture edit route is admin-only");
for (const r of routes) {
  const inventory = /\/(state|facade-state|slabs|leg-designs|leg-plates)(\/|$)/.test(r.path);
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
  "All twenty-three Studio routes guarded; inventory has shared designer access, costs/production/textures remain admin-only.",
);

let facadeForwarded = false;
await tableBridge("GET", "/facade-state", undefined, { settings: { url: "https://example.test", key: "test-only-key" }, fetch: async (url, options) => { facadeForwarded = true; assert.equal(String(url), "https://example.test/bridge/tables/facade-state"); assert.equal((options?.headers as Record<string,string>)["x-bridge-key"], "test-only-key"); return new Response(JSON.stringify({ slabs: [], slabCategory: "cabinet_facade" })); } });
assert(facadeForwarded);

let cadForwarded = false;
await tableBridge("GET", "/cad/cabinet/00000000-0000-4000-8000-000000000001/dwg", undefined, {
 settings: { url: "https://example.test", key: "test-only-key" },
 fetch: async (url, options) => { cadForwarded = true; assert.equal(String(url), "https://example.test/bridge/tables/cad/cabinet/00000000-0000-4000-8000-000000000001/dwg"); assert.equal((options?.headers as Record<string,string>)["x-bridge-key"], "test-only-key"); return new Response(JSON.stringify({ filename: "cabinet.dwg", base64: "QUMxMDE1", type: "image/vnd.dwg" })); }
});
assert(cadForwarded);
for (const path of ["/cad/cabinet/../dwg", "/cad/cabinet/00000000-0000-4000-8000-000000000001/exe", "/cad/customer/00000000-0000-4000-8000-000000000001/obj"])
 await assert.rejects(() => tableBridge("GET", path));
console.log("CAD and cabinet inquiry routes remain admin-only; allowlisted bridge preserves binary payload and refuses arbitrary paths.");

let engravingForwarded = false;
await tableBridge("GET", "/cad/cabinet/00000000-0000-4000-8000-000000000001/engraving", undefined, {
 settings: { url: "https://example.test", key: "test-only-key" },
 fetch: async (url) => { engravingForwarded = true; assert.equal(String(url), "https://example.test/bridge/tables/cad/cabinet/00000000-0000-4000-8000-000000000001/engraving"); return new Response(JSON.stringify({ filename: "cabinet-engraving.zip", base64: "UEs=", type: "application/zip" })); }
});
assert(engravingForwarded);

for (const path of ["/wardrobe-production", "/cad/wardrobe/00000000-0000-4000-8000-000000000001/engraving", "/cad/wardrobe/00000000-0000-4000-8000-000000000001/json"]) {
  let forwarded=false;
  await tableBridge("GET",path,undefined,{settings:{url:"https://example.test",key:"test-only-key"},fetch:async url=>{forwarded=true;assert.equal(String(url),"https://example.test/bridge/tables"+path);return new Response(JSON.stringify({filename:"wardrobe.zip",base64:"UEs="}));}});
  assert(forwarded);
}
