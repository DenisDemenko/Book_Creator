import type { Express } from 'express';
import { registerExpressRoutes as registerBaseExpressRoutes } from './expressRoutesBase';
import { registerExpressHeroArcRoutes } from './expressHeroArcRoutes';

/**
 * Композиційна обгортка Express Wizard.
 *
 * Уся чинна логіка майстра лишається без змін у expressRoutesBase.ts;
 * тут лише додається JEV-аналіз кривої героя після реєстрації базових маршрутів.
 */
export function registerExpressRoutes(
  app: Express,
  deps?: Parameters<typeof registerBaseExpressRoutes>[1],
): void {
  registerBaseExpressRoutes(app, deps);
  registerExpressHeroArcRoutes(app);
}
