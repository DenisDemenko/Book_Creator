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

/** Адреса Ollama: ЛИШЕ цей комп'ютер чи локальна мережа — розпізнаний текст не має виходити в інтернет (журнал #550). */
export function normalizeLocalUrl(raw, label = 'OLLAMA_URL') {
  if (!raw) return '';
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error(`${label} має бути адресою, напр. http://host.docker.internal:11434`);
  }
  const host = url.hostname.toLowerCase();
  const privateIpv4 = /^(10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/.test(host);
  const local = LOCAL_HOSTS.has(host) || privateIpv4 || host.endsWith('.local') || host === 'ollama';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !local) {
    throw new Error(`${label} має вказувати на цей комп'ютер чи локальну мережу (localhost, host.docker.internal, 192.168.x.x…): розпізнавання не повинно виходити в інтернет.`);
  }
  return url.origin;
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
    // Розпізнавання знімків із телефона (журнал #550)
    tessdataDir: env.PRIVATE_STORE_TESSDATA_DIR || '',
    tessdataGzip: String(env.PRIVATE_STORE_TESSDATA_GZIP ?? 'true').toLowerCase() !== 'false',
    ollamaUrl: normalizeLocalUrl(env.OLLAMA_URL),
    ollamaModel: String(env.OLLAMA_MODEL || 'qwen2.5vl:7b').slice(0, 100),
    ollamaTimeoutMs: toInt(env.OLLAMA_TIMEOUT_SEC, 600, 10, 3600) * 1000,
    // 0 вимикає опитування Studio (тести викликають pollOnce самі)
    inboxPollMs: String(env.PRIVATE_STORE_INBOX_POLL_SEC) === '0' ? 0 : toInt(env.PRIVATE_STORE_INBOX_POLL_SEC, 15, 2, 600) * 1000,
    autoOcr: String(env.PRIVATE_STORE_AUTO_OCR ?? 'true').toLowerCase() !== 'false',
    version: '0.2.0',
  };
}
