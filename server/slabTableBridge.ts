import type { Express } from "express";
import { requireAdmin } from "./auth";
import { readBridgeSettings, type BridgeSettings } from "./marketplaceBridge";
import { calculateWoodAndEpoxyCost } from "../src/components/adminOs/furnitureCalculator/utils/calculator";
import type {
  CalculationInput,
  CurrencyRates,
} from "../src/components/adminOs/furnitureCalculator/types";

// No arbitrary proxy target, redirect or browser-visible bridge secret.
export async function tableBridge(
  method: string,
  path: string,
  body?: unknown,
  deps: { fetch?: typeof fetch; settings?: BridgeSettings } = {},
) {
  if (!/^\/(state|slabs|costs|production)(\/[a-zA-Z0-9-]+)?$/.test(path))
    throw new Error("Некоректний маршрут конструктора.");
  const settings = deps.settings ?? (await readBridgeSettings());
  const response = await (deps.fetch ?? fetch)(
    `${settings.url}/bridge/tables${path}`,
    {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "x-bridge-key": settings.key,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response
    .json()
    .catch(() => ({ message: "Маркетплейс повернув некоректну відповідь." }));
  if (!response.ok) {
    const error = new Error(
      Array.isArray(data.message)
        ? data.message.join("; ")
        : data.message || "Помилка API маркетплейсу.",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

/** Explicit reference-area tariff model, approved by the administrator on publication. */
export function deriveTableTariffs(
  input: CalculationInput,
  rates: CurrencyRates,
  woodLegs: number,
) {
  if (
    !input ||
    !rates ||
    !Number.isFinite(rates.USD) ||
    rates.USD <= 0 ||
    !Number.isFinite(rates.EUR) ||
    rates.EUR <= 0
  )
    throw new Error("Перевірте курси валют.");
  for (const [key, value] of Object.entries(input))
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0))
      throw new Error(`Некоректне значення ${key}.`);
  const a = (input.woodLengthMm * input.woodWidthMm) / 1e6;
  if (
    !Number.isFinite(a) ||
    a <= 0 ||
    !Number.isFinite(input.epoxyPricePerLiter) ||
    input.epoxyPricePerLiter < 0
  )
    throw new Error("Вкажіть габарити базового виробу та ціну смоли.");
  const r = calculateWoodAndEpoxyCost(input, rates),
    density = 1.1;
  const other =
    r.fullCostPrice -
    r.woodCostNet -
    r.woodDryingCost -
    r.epoxyMaterialCost -
    r.totalFinishingGroupCost -
    r.metalBaseGroupCost;
  const data = {
    resin: input.epoxyPricePerLiter / density,
    density,
    waste: input.epoxyWastePercent,
    work: Math.max(0, other) / a,
    finish: r.totalFinishingGroupCost / a,
    metal: r.metalBaseGroupCost,
    wood: woodLegs,
    none: 0,
    markup: (r.totalSellingPrice / r.fullCostPrice - 1) * 100,
  };
  if (Object.values(data).some((v) => !Number.isFinite(v) || v < 0))
    throw new Error("Калькулятор повернув некоректні ставки.");
  return { data, referenceAreaM2: a };
}
export function registerSlabTableRoutes(app: Express) {
  const proxy =
    (method: string, path: (req: any) => string) =>
    async (req: any, res: any) => {
      try {
        res.json(
          await tableBridge(
            method,
            path(req),
            ["GET", "DELETE"].includes(method) ? undefined : req.body,
          ),
        );
      } catch (e: any) {
        res
          .status(e.status >= 400 && e.status < 600 ? e.status : 502)
          .json({
            error: e.message || "Не вдалося зв’язатися з маркетплейсом.",
          });
      }
    };
  app.get(
    "/api/admin/slab-tables/state",
    requireAdmin,
    proxy("GET", () => "/state"),
  );
  app.post(
    "/api/admin/slab-tables/slabs",
    requireAdmin,
    proxy("POST", () => "/slabs"),
  );
  app.delete(
    "/api/admin/slab-tables/slabs/:id",
    requireAdmin,
    proxy("DELETE", (r) => "/slabs/" + r.params.id),
  );
  app.put(
    "/api/admin/slab-tables/costs",
    requireAdmin,
    proxy("PUT", () => "/costs"),
  );
  app.get(
    "/api/admin/slab-tables/production",
    requireAdmin,
    proxy("GET", () => "/production"),
  );
  app.patch(
    "/api/admin/slab-tables/production/:id",
    requireAdmin,
    proxy("PATCH", (r) => "/production/" + r.params.id),
  );
  app.post(
    "/api/admin/slab-tables/publish-costs",
    requireAdmin,
    async (req, res) => {
      try {
        const current = await tableBridge("GET", "/state");
        const tariff = deriveTableTariffs(
          req.body?.input,
          req.body?.rates,
          current.costs.wood,
        );
        const saved = await tableBridge("PUT", "/costs", {
          expectedVersion: current.costsVersion,
          data: tariff.data,
        });
        res.json({
          ok: true,
          referenceAreaM2: tariff.referenceAreaM2,
          version: saved.version,
        });
      } catch (e: any) {
        res
          .status(e.status >= 400 && e.status < 600 ? e.status : 400)
          .json({ error: e.message || "Не вдалося опублікувати тарифи." });
      }
    },
  );
}
