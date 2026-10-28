import type { Express, Request, Response } from 'express';
import { requireAdmin } from './auth';
import { readBridgeSettings } from './marketplaceBridge';

// Closed route list. Actor identity comes exclusively from the authenticated Studio session.
export function fundingRouteAllowed(method: string, path: string) {
  return /^(GET \/|PUT \/settings|GET \/campaigns\/[a-zA-Z0-9-]+\/recipient|POST \/campaigns\/[a-zA-Z0-9-]+\/(review|bank-facts)|POST \/campaigns\/[a-zA-Z0-9-]+\/(payouts|reports|refunds)\/[a-zA-Z0-9-]+)$/.test(`${method} ${path}`);
}
export function registerFundingRoutes(app: Express) {
  app.use('/api/admin/crowdfunding', requireAdmin, async (req: Request, res: Response) => {
    if (!fundingRouteAllowed(req.method, req.path)) { res.status(404).json({ error: 'Невідомий фінансовий маршрут.' }); return; }
    const actorUid = req.principal && 'firebaseUid' in req.principal ? req.principal.firebaseUid : null;
    if (!actorUid) { res.status(403).json({ error: 'Увійдіть через Firebase обліковим записом адміністратора маркетплейсу.' }); return; }
    try {
      const settings = await readBridgeSettings();
      const response = await fetch(`${settings.url}/funding-admin${req.path === '/' ? '' : req.path}`, {
        method: req.method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json', 'x-bridge-key': settings.key, 'x-funding-actor-uid': actorUid },
        body: ['GET','HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });
      const data = await response.json();
      res.status(response.status).json(response.ok ? data : { error: Array.isArray(data.message) ? data.message.join('; ') : data.message || 'Помилка фінансового сервера.' });
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Не вдалося зв’язатися з маркетплейсом.' }); }
  });
}
