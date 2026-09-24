/**
 * HTTP-шар реєстру сутностей ядра.
 *
 * ЩО ВІДДАЄ. Словник із бази (118 типів сутностей, 39 типів зв'язків, групи)
 * плюс індексні відповіді про чат: які сутності згадані в сесії та в яких
 * сесіях згадано конкретну сутність.
 *
 * ЧОМУ РЕЄСТР ВЗАГАЛІ ВІДДАЄТЬСЯ ЧЕРЕЗ СЕРВЕР, ЯКЩО ВІН Є В КОДІ КЛІЄНТА.
 * Бо клієнтський модуль — це перелік ТИПІВ, а не фактів про книгу. Із
 * сервера приходить те, чого в коді немає й бути не може: скільки згадок
 * сутності накопичилось у розмовах автора і які саме сесії її чіпали.
 * Панель сутностей працює з тим, що в коді; аналітика й групування в
 * чаті — з тим, що тут.
 *
 * ДОСТУП. `requireAuth` без додаткових прав: реєстр — не секрет, це
 * публічний словник проєкту (він описаний у документі власника), а от
 * згадки в чаті прив'язані до `userId` і ніколи не змішуються між
 * користувачами — фільтр стоїть у самих запитах сховища.
 */

import type { Express, Request, Response } from 'express';
import { requireAuth } from './auth';
import {
  coreEntityStats,
  listChosenChatEntityGroups,
  listCoreEntities,
  listCoreRelations,
  listSessionsMentioningEntity,
} from './coreEntityStore';
import { CORE_ENTITY_GROUPS, entityTagRegexp, MAX_ENTITIES_PER_PARAGRAPH } from '../src/utils/coreEntities';

export function registerCoreEntityRoutes(app: Express): void {
  /**
   * Увесь реєстр одним запитом.
   *
   * Одним, а не трьома (сутності / зв'язки / групи): панель відкривається
   * цілим екраном і потребує все одразу, а три паралельні запити в цьому
   * випадку — три способи отримати напівпорожню панель.
   */
  app.get('/api/core/entities', requireAuth, async (_req: Request, res: Response) => {
    try {
      const [entities, relations, stats] = await Promise.all([
        listCoreEntities(),
        listCoreRelations(),
        coreEntityStats(),
      ]);
      res.json({
        entities,
        relations,
        groups: CORE_ENTITY_GROUPS,
        stats,
        maxPerParagraph: MAX_ENTITIES_PER_PARAGRAPH,
        // Формат тега віддається разом із даними, а не лише живе в коді
        // клієнта: якщо формат колись зміниться, інтерфейс, який будується
        // з цієї відповіді, не розійдеться з тим, що сервер уміє розібрати.
        tagFormat: entityTagRegexp().source,
      });
    } catch (err) {
      const message = (err as Error)?.message || 'Не вдалося прочитати реєстр сутностей.';
      console.error('[core-entities]', message);
      res.status(500).json({ error: message });
    }
  });

  /** Сутності, згадані в одній чат-сесії — групування під історією розмови. */
  app.get('/api/core/chat/sessions/:id/entities', requireAuth, async (req: Request, res: Response) => {
    try {
      res.json({ groups: await listChosenChatEntityGroups(String(req.params.id || '')) });
    } catch (err) {
      const message = (err as Error)?.message || 'Не вдалося прочитати згадки сутностей у сесії.';
      console.error('[core-entities]', message);
      res.status(500).json({ error: message });
    }
  });

  /** Сесії, у яких згадано цю сутність — «показати розмови про /threshold». */
  app.get('/api/core/entities/:slug/sessions', requireAuth, async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || '').replace(/^\//, '').toLowerCase();
      const userId = req.principal?.id ?? '';
      res.json({ slug, sessions: await listSessionsMentioningEntity(userId, slug) });
    } catch (err) {
      const message = (err as Error)?.message || 'Не вдалося прочитати сесії з цією сутністю.';
      console.error('[core-entities]', message);
      res.status(500).json({ error: message });
    }
  });
}
