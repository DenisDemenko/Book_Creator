/**
 * Налаштування локального сервера приватного сховища (журнал #549). Усе — зі змінних середовища; нічого не пишеться у файли,
 * крім даних у PRIVATE_STORE_DATA_DIR. Невідоме чи небезпечне значення — відмова на старті, а не тихий «запасний» режим.
 */

const toInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Хости, з якими Studio можна говорити відкритим http: лише локальні (інакше токен і код підключення пішли б відкритим текстом). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname).toLowerCase());
}

/** Адреса Studio: https, або http лише для локальних хостів. Повертає адресу без кінцевого `/`. */
export function normalizeStudioUrl(raw) {
  if (!raw) return '';
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error('STUDIO_URL має бути адресою, напр. https://www.fusionlab.in.ua/studio');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error('STUDIO_URL має бути https (http дозволено лише для localhost, 127.0.0.1 і host.docker.internal).');
  }
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(env = process.env) {
  const port = toInt(env.PRIVATE_STORE_PORT, 8787, 1, 65535);
  const publicUrl = String(env.PRIVATE_STORE_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  let publicHost;
  try {
    publicHost = new URL(publicUrl).host;
  } catch {
    throw new Error('PRIVATE_STORE_PUBLIC_URL має бути адресою, напр. http://127.0.0.1:8787');
  }
  const extraHosts = String(env.PRIVATE_STORE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, publicHost.toLowerCase(), ...extraHosts]);
  const extraOrigins = String(env.PRIVATE_STORE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return {
    port,
    host: env.PRIVATE_STORE_HOST || '0.0.0.0', // всередині контейнера; назовні порт публікує лише 127.0.0.1 (див. docker-compose.yml)
    publicUrl,
    allowedHosts,
    extraOrigins,
    dataDir: env.PRIVATE_STORE_DATA_DIR || './data',
    masterKeyFile: env.PRIVATE_STORE_MASTER_KEY_FILE || '/run/secrets/private_store_master_key',
    studioUrl: normalizeStudioUrl(env.STUDIO_URL),
    pairingCode: String(env.PAIRING_CODE || '').trim(),
    name: String(env.PRIVATE_STORE_NAME || 'Локальний сервер').slice(0, 80),
    maxBodyBytes: toInt(env.PRIVATE_STORE_MAX_BODY_MB, 64, 1, 512) * 1024 * 1024,
    heartbeatMs: toInt(env.PRIVATE_STORE_HEARTBEAT_SEC, 60, 10, 3600) * 1000,
    rateLimitPerMinute: toInt(env.PRIVATE_STORE_RATE_LIMIT, 1200, 10, 100000),
    version: '0.1.0',
  };
}
