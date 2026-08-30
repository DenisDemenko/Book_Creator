/**
 * Розділ «Ключі API» — власні ключі провайдерів ШІ, які автор може задати
 * замість спільного серверного (ARCHITECTURE_TOKEN_MODULE_INTEGRATION.md,
 * розділ 4, «опційний override»). Той самий патерн, що в
 * Modul_token/src/components/SettingsModal.tsx, але ключ шифрується й живе
 * в БД (server/userApiKeyCrypto.ts, таблиця user_api_keys), а не в
 * localStorage браузера.
 *
 * Ключ ніколи не повертається назад у відповідях GET — лише прапорець
 * `configured` і короткий `fingerprint` для UI («це той самий ключ, що я
 * вставляв минулого разу»).
 */

import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';
import { getUserApiKey, listUserApiKeys, upsertUserApiKey, deleteUserApiKey } from './store';
import { encryptApiKey, apiKeyFingerprint, isApiKeyCryptoConfigured } from './userApiKeyCrypto';
import { CHAT_MODELS, ENGINE_LABELS, engineConfigured, type EngineId } from './chatProviders';

const KNOWN_ENGINES = new Set<string>(Object.keys(ENGINE_LABELS));

function isEngineId(value: string): value is EngineId {
  return KNOWN_ENGINES.has(value);
}

export function registerApiKeysRoutes(app: Express): void {
  /** Статус ключів автора для всіх 6 провайдерів чату. */
  app.get('/api/account/api-keys', requireAuth, requirePermission('canManageApiKeys'), async (req, res) => {
    try {
      const userId = req.principal!.id as string;
      const stored = await listUserApiKeys(userId);
      const byEngine = new Map(stored.map((k) => [k.engine, k]));

      const engines = [...new Set(CHAT_MODELS.map((m) => m.engine))];
      const keys = engines.map((engine) => {
        const own = byEngine.get(engine);
        return {
          engine,
          label: ENGINE_LABELS[engine],
          serverKeyConfigured: engineConfigured(engine),
          configured: !!own,
          fingerprint: own?.fingerprint,
          updatedAt: own?.updatedAt,
        };
      });

      res.json({ keys, cryptoConfigured: isApiKeyCryptoConfigured() });
    } catch (err) {
      console.error('[api-keys] list:', err);
      res.status(500).json({ error: 'Не вдалося завантажити ключі API.' });
    }
  });

  /** Зберігає (або замінює) власний ключ автора для одного провайдера. */
  app.put('/api/account/api-keys/:engine', requireAuth, requirePermission('canManageApiKeys'), async (req, res) => {
    try {
      const engine = req.params.engine;
      if (!isEngineId(engine)) {
        return res.status(400).json({ error: `Невідомий провайдер: ${engine}.` });
      }
      const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      if (!apiKey) {
        return res.status(400).json({ error: 'Введіть ключ API.' });
      }
      if (!isApiKeyCryptoConfigured()) {
        return res.status(503).json({
          error: 'Шифрування ключів не налаштоване на сервері (немає USER_API_KEY_SECRET). Зверніться до адміністратора.',
        });
      }

      const userId = req.principal!.id as string;
      const now = new Date().toISOString();
      const existing = await getUserApiKey(userId, engine);
      await upsertUserApiKey({
        userId,
        engine,
        encryptedKey: encryptApiKey(apiKey),
        fingerprint: apiKeyFingerprint(apiKey),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });

      res.json({
        engine,
        label: ENGINE_LABELS[engine],
        configured: true,
        fingerprint: apiKeyFingerprint(apiKey),
        updatedAt: now,
      });
    } catch (err) {
      console.error('[api-keys] save:', err);
      res.status(500).json({ error: 'Не вдалося зберегти ключ API.' });
    }
  });

  /** Видаляє власний ключ — чат повертається на спільний серверний (якщо є). */
  app.delete('/api/account/api-keys/:engine', requireAuth, requirePermission('canManageApiKeys'), async (req, res) => {
    try {
      const engine = req.params.engine;
      if (!isEngineId(engine)) {
        return res.status(400).json({ error: `Невідомий провайдер: ${engine}.` });
      }
      const userId = req.principal!.id as string;
      await deleteUserApiKey(userId, engine);
      res.json({ ok: true, engine, serverKeyConfigured: engineConfigured(engine) });
    } catch (err) {
      console.error('[api-keys] delete:', err);
      res.status(500).json({ error: 'Не вдалося видалити ключ API.' });
    }
  });
}
