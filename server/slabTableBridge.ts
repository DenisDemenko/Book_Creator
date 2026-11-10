import type { Express, Request, Response, NextFunction } from "express";
import { can, requireAdmin } from "./auth";
import { readFurnitureAccess } from "./furnitureAccess";
import { readBridgeSettings, type BridgeSettings } from "./marketplaceBridge";
import { DrawingsError, drawingsFileName, listDrawingsTemplates, renderDrawingsPdf } from "./tableDrawingsPdf";
import { calculateWoodAndEpoxyCost } from "../src/components/adminOs/furnitureCalculator/utils/calculator";
import type {
  CalculationInput,
  CurrencyRates,
} from "../src/components/adminOs/furnitureCalculator/types";

declare global {
  namespace Express {
    interface Request { slabActorUid?: string; }
  }
}

export async function requireSlabInventory(req: Request, res: Response, next: NextFunction) {
  const user = req.principal;
  if (!user || user.isGuest) {
    res.status(403).json({ error: 'Потрібен вхід із доступом до складу слебів.' });
    return;
  }
  if (user.role === 'admin') return next();
  if (!await can(user.role, 'canManageSlabs')) {
    res.status(403).json({ error: 'Ваша роль не має доступу до складу слебів.' });
    return;
  }
  try {
    const access = await readFurnitureAccess(user);
    if (!access.allowed || !access.firebaseUid) {
      res.status(403).json({ error: 'Доступ до складу відкликано або не надано.' });
      return;
    }
    req.slabActorUid = access.firebaseUid;
    next();
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Не вдалося перевірити доступ.' });
  }
}

// No arbitrary proxy target, redirect or browser-visible bridge secret.
export async function tableBridge(
  method: string,
  path: string,
  body?: unknown,
  deps: { fetch?: typeof fetch; settings?: BridgeSettings; actorUid?: string } = {},
) {
  if (!/^\/cad\/(table|cabinet|wardrobe)\/[a-fA-F0-9-]+\/(obj|stl|dxf|dwg|all|engraving|json|project)$/.test(path) && !/^\/(state|facade-state|wardrobe-production|cabinet-production|slabs|costs|production|resin-textures|leg-settings|leg-designs|leg-plates)(\/[a-zA-Z0-9-]+)?$/.test(path))
    throw new Error("Некоректний маршрут конструктора.");
  const settings = deps.settings ?? (await readBridgeSettings());
  const response = await (deps.fetch ?? fetch)(
    `${settings.url}/bridge/tables${path}`,
    {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(path.startsWith("/cad/") ? 170000 : 20000),
      headers: {
        "x-bridge-key": settings.key,
        "Content-Type": "application/json",
        ...(deps.actorUid ? { "x-slab-actor-uid": deps.actorUid } : {}),
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
            { actorUid: req.slabActorUid },
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
    "/api/admin/slab-tables/facade-state",
    requireSlabInventory,
    proxy("GET", () => "/facade-state"),
  );
  app.get(
    "/api/admin/slab-tables/state",
    requireSlabInventory,
    proxy("GET", () => "/state"),
  );
  app.post(
    "/api/admin/slab-tables/slabs",
    requireSlabInventory,
    proxy("POST", () => "/slabs"),
  );
  app.delete(
    "/api/admin/slab-tables/slabs/:id",
    requireSlabInventory,
    proxy("DELETE", (r) => "/slabs/" + r.params.id),
  );
  // Wooden bases. Drawing legs and defining plates (with their four holes) is
  // open to the furniture designer as well, like the slab stock; the materials,
  // prices and the plate thickness are the administrator's.
  app.put(
    "/api/admin/slab-tables/leg-settings",
    requireAdmin,
    proxy("PUT", () => "/leg-settings"),
  );
  for (const kind of ["leg-designs", "leg-plates"]) {
    app.post(
      `/api/admin/slab-tables/${kind}`,
      requireSlabInventory,
      proxy("POST", () => `/${kind}`),
    );
    app.patch(
      `/api/admin/slab-tables/${kind}/:id`,
      requireSlabInventory,
      proxy("PATCH", (r) => `/${kind}/` + r.params.id),
    );
    app.delete(
      `/api/admin/slab-tables/${kind}/:id`,
      requireSlabInventory,
      proxy("DELETE", (r) => `/${kind}/` + r.params.id),
    );
  }
  app.put(
    "/api/admin/slab-tables/costs",
    requireAdmin,
    proxy("PUT", () => "/costs"),
  );
  app.post(
    "/api/admin/slab-tables/resin-textures",
    requireAdmin,
    proxy("POST", () => "/resin-textures"),
  );
  app.patch(
    "/api/admin/slab-tables/resin-textures/:id",
    requireAdmin,
    proxy("PATCH", (r) => "/resin-textures/" + r.params.id),
  );
  app.delete(
    "/api/admin/slab-tables/resin-textures/:id",
    requireAdmin,
    proxy("DELETE", (r) => "/resin-textures/" + r.params.id),
  );
  app.get(
    "/api/admin/slab-tables/production",
    requireAdmin,
    proxy("GET", () => "/production"),
  );
  app.get('/api/admin/slab-tables/wardrobe-production', requireAdmin, proxy('GET', () => '/wardrobe-production'));
  app.get('/api/admin/slab-tables/cabinet-production', requireAdmin, proxy('GET', () => '/cabinet-production'));
  app.get('/api/admin/slab-tables/cad/:subject/:id/:format', requireAdmin, proxy('GET', r => `/cad/${r.params.subject}/${r.params.id}/${r.params.format}`));
  // The design templates to choose from before the export: the same design themes as the books.
  app.get("/api/admin/slab-tables/drawings-templates", requireAdmin, (_req, res) => {
    res.json({ templates: listDrawingsTemplates() });
  });
  // PDF drawings of one order, made by DesignCraft: the customer, the chosen configuration with the resin, and every
  // sheet of the production files. Not a product of the marketplace: only an administrator can fetch it.
  app.get("/api/admin/slab-tables/drawings/:id", requireAdmin, async (req, res) => {
    try {
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(req.params.id)) throw new DrawingsError("Некоректний номер замовлення.", 400);
      const orders = (await tableBridge("GET", "/production")) as { id: string; number: string }[];
      // by the id of the card or by the number the buyer sees in the cart (TBL-…)
      const order = orders.find((o) => o.id === req.params.id || o.number === req.params.id);
      if (!order) throw new DrawingsError("Замовлення не знайдено.", 404);
      const pdf = await renderDrawingsPdf(order as never, { template: req.query.template });
      res
        .status(200)
        .type("application/pdf")
        .set("Content-Disposition", `attachment; filename="${drawingsFileName(order as never)}"`)
        .set("Cache-Control", "no-store")
        .send(pdf);
    } catch (error) {
      const status = error instanceof DrawingsError ? error.status : (error as { status?: number }).status || 500;
      res.status(status).json({ error: error instanceof Error ? error.message : "Не вдалося скласти креслення." });
    }
  });
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
