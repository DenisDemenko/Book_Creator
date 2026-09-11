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
import { CHAT_MODELS, ENGINE_LABELS, ENGINE_ENV_KEY, engineConfigured, type EngineId } from './chatProviders';
import { dispatch } from './aiCore';
import { platformKeyFor, resolveEngineKey } from './platformKeys';

const KNOWN_ENGINES = new Set<string>(Object.keys(ENGINE_LABELS));

/**
 * Провайдери ЗОБРАЖЕНЬ, для яких автор може задати власний ключ.
 *
 * Тримаються окремо від чатових: у них інший транспорт (Ark REST замість
 * PROVIDERS чату), інша змінна оточення й інша одиниця тарифікації —
 * зображення, а не токени. Спільним лишається тільки сховище ключа.
 */
const IMAGE_KEY_PROVIDERS = [
  {
    engine: 'seedream',
    label: 'Seedream (ByteDance)',
    envKeys: ['ARK_API_KEY', 'SEEDREAM_API_KEY', 'FAL_KEY'],
  },
] as const;

const IMAGE_KEY_ENGINES = new Set<string>(IMAGE_KEY_PROVIDERS.map((p) => p.engine));

function imageServerKeyConfigured(engine: string): boolean {
  const p = IMAGE_KEY_PROVIDERS.find((x) => x.engine === engine);
  if (!p) return false;
  return p.envKeys.some((k) => !!process.env[k]);
}

/**
 * Провайдери ОЗВУЧЕННЯ (Text-to-Speech). Окрема категорія від зображень —
 * інший транспорт (server/narration.ts), інша одиниця тарифікації
 * (символи тексту, а не зображення чи токени). Наразі один провайдер,
 * але список — щоб додати другий (наприклад, запасний TTS) не міняючи
 * форму відповіді.
 */
const AUDIO_KEY_PROVIDERS = [
  {
    engine: 'elevenlabs',
    label: 'ElevenLabs (озвучення)',
    envKeys: ['ELEVENLABS_API_KEY'],
  },
] as const;

const AUDIO_KEY_ENGINES = new Set<string>(AUDIO_KEY_PROVIDERS.map((p) => p.engine));

function audioServerKeyConfigured(engine: string): boolean {
  const p = AUDIO_KEY_PROVIDERS.find((x) => x.engine === engine);
  if (!p) return false;
  return p.envKeys.some((k) => !!process.env[k]);
}

function isEngineId(value: string): value is EngineId {
  return KNOWN_ENGINES.has(value);
}

/** Унікальний префікс ключа Anthropic — єдина ознака, яку можна перевіряти без здогадів. */
const ANTHROPIC_PREFIX = 'sk-ant-';

/**
 * Ловить найпоширенішу помилку в цьому вікні: ключ вставлено не в ту
 * картку. Провайдер про це, звісно, скаже — але аж під час генерації, і
 * формулюванням, у якому причину впізнати важко: OpenAI на ключ Claude
 * відповідає «Incorrect API key provided: sk-ant-…», і виглядає це як
 * зіпсований ключ, а не як переплутана картка.
 *
 * Перевіряється РІВНО ОДИН випадок — префікс `sk-ant-` поза карткою
 * Claude. Він унікальний для Anthropic, тож хибного спрацювання тут
 * бути не може. Зворотну перевірку («ключ OpenAI мусить починатися з
 * sk-») свідомо не робимо: OpenAI-сумісні проксі та шлюзи видають ключі
 * у власних форматах, і відхилити робочий ключ було б гірше, ніж
 * пропустити чужий — цей випадок і так виявиться при першій генерації.
 */
function detectMisplacedKey(engine: EngineId, apiKey: string): string | null {
  if (apiKey.startsWith(ANTHROPIC_PREFIX) && engine !== 'claude') {
    return (
      `Схоже, це ключ Anthropic Claude (починається з «${ANTHROPIC_PREFIX}»), ` +
      `а ви зберігаєте його як ${ENGINE_LABELS[engine]}. ` +
      `Вставте його в картку «Anthropic Claude».`
    );
  }
  return null;
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
          kind: 'text' as const,
        };
      });

      // Двигуни зображень — тим самим списком, щоб панель лишалась одним
      // місцем для всіх ключів автора, а не двома схожими екранами.
      const imageKeys = IMAGE_KEY_PROVIDERS.map((p) => {
        const own = byEngine.get(p.engine);
        return {
          engine: p.engine,
          label: p.label,
          serverKeyConfigured: imageServerKeyConfigured(p.engine),
          configured: !!own,
          fingerprint: own?.fingerprint,
          updatedAt: own?.updatedAt,
          kind: 'image' as const,
        };
      });

      keys.push(...(imageKeys as unknown as typeof keys));

      // Провайдери озвучення — тим самим списком, третя секція панелі.
      const audioKeys = AUDIO_KEY_PROVIDERS.map((p) => {
        const own = byEngine.get(p.engine);
        return {
          engine: p.engine,
          label: p.label,
          serverKeyConfigured: audioServerKeyConfigured(p.engine),
          configured: !!own,
          fingerprint: own?.fingerprint,
          updatedAt: own?.updatedAt,
          kind: 'audio' as const,
        };
      });
      keys.push(...(audioKeys as unknown as typeof keys));

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
      if (!isEngineId(engine) && !IMAGE_KEY_ENGINES.has(engine) && !AUDIO_KEY_ENGINES.has(engine)) {
        return res.status(400).json({ error: `Невідомий провайдер: ${engine}.` });
      }
      const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      if (!apiKey) {
        return res.status(400).json({ error: 'Введіть ключ API.' });
      }

      const misplaced = isEngineId(engine) ? detectMisplacedKey(engine, apiKey) : null;
      if (misplaced) {
        return res.status(400).json({ error: misplaced });
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
      const isImage = IMAGE_KEY_ENGINES.has(engine);
      const isAudio = AUDIO_KEY_ENGINES.has(engine);
      if (!isEngineId(engine) && !isImage && !isAudio) {
        return res.status(400).json({ error: `Невідомий провайдер: ${engine}.` });
      }
      const userId = req.principal!.id as string;
      await deleteUserApiKey(userId, engine);
      res.json({
        ok: true,
        engine,
        serverKeyConfigured: isEngineId(engine)
          ? engineConfigured(engine)
          : isAudio
            ? audioServerKeyConfigured(engine)
            : imageServerKeyConfigured(engine),
      });
    } catch (err) {
      console.error('[api-keys] delete:', err);
      res.status(500).json({ error: 'Не вдалося видалити ключ API.' });
    }
  });

  /**
   * «Перевірити ключ» — справжній, найдешевший можливий виклик провайдера
   * тим самим ключем і тим самим шляхом, яким ходить продукт
   * (`resolveEngineKey`: платформний → власний → змінна оточення).
   *
   * Навіщо окремий маршрут. Досі на скаргу «провайдер каже, що ключ
   * невалідний» не було чим відповісти, крім здогадок: панель показує
   * ЗБЕРЕЖЕНИЙ ключ, а в запит могла піти змінна оточення з зовсім іншим
   * ключем, і зовні ці два випадки не розрізнити. Тут повертається
   * ДЖЕРЕЛО ключа і його відбиток — той самий sha256-префікс, що показує
   * панель, тож збіг або розбіжність видно очима.
   *
   * `last4` — останні 4 символи ключа. Це не витік: провайдери самі
   * друкують їх у тексті помилки («Your api key: ****3986 is invalid»),
   * а саме за ними власник і звіряє, чи пішов у запит той ключ, що він
   * вставив. Маршрут доступний лише тому, хто й так має право керувати
   * ключами.
   */
  app.post('/api/account/api-keys/:engine/test', requireAuth, requirePermission('canManageApiKeys'), async (req, res) => {
    const engine = req.params.engine;
    if (!isEngineId(engine)) {
      return res.status(400).json({ error: `Перевірка доступна лише для текстових рушіїв, а не для «${engine}».` });
    }
    try {
      const userId = req.principal!.id as string;
      const key = await resolveEngineKey(userId, engine, 'key-test');
      const source = key
        ? (await platformKeyFor(engine)) === key
          ? 'платформний ключ із цієї панелі'
          : 'власний ключ цього користувача'
        : 'змінна оточення сервера';

      if (!key && !engineConfigured(engine)) {
        return res.json({
          ok: false,
          engine,
          source,
          error: `Ключа немає ніде: ні в цій панелі, ні у змінній оточення ${ENGINE_ENV_KEY[engine]}.`,
        });
      }

      const modelId = CHAT_MODELS.find((m) => m.engine === engine)?.id || '';
      // Найдешевший осмислений запит: одне слово на вхід, одне на вихід.
      await dispatch(engine, modelId, 'ping', 'Reply with the single word: pong.', key);

      res.json({
        ok: true,
        engine,
        source,
        fingerprint: key ? apiKeyFingerprint(key) : undefined,
        last4: key ? key.slice(-4) : undefined,
        modelId,
      });
    } catch (err: any) {
      // Помилку провайдера віддаємо як є: саме в ній він називає, який
      // ключ відхилив — і це головна цінність перевірки.
      const key = await resolveEngineKey(req.principal!.id as string, engine, 'key-test').catch(() => undefined);
      res.json({
        ok: false,
        engine,
        source: key ? 'ключ знайдено' : 'ключа немає',
        fingerprint: key ? apiKeyFingerprint(key) : undefined,
        last4: key ? key.slice(-4) : undefined,
        error: String(err?.message || err),
      });
    }
  });
}
