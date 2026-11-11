/**
 * Запуск локального сервера приватного сховища (журнал #549).
 *
 *   node src/server.mjs
 *
 * Порядок на старті (будь-яка помилка до слухання порту — вихід із кодом 1, а не «напівзапущений» сервер):
 *   1. налаштування зі змінних середовища;  2. головний ключ із файлу-секрету (немає чи слабкий — відмова);
 *   3. відкрити базу (зашифровану);  4. ключова пара сервера (створюється один раз);
 *   5. якщо є код підключення й сервер ще не підключено (або код новий) — обмін коду зі Studio;
 *   6. пульс до Studio раз на хвилину;  7. слухати порт.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { deriveDataKey, generateIdentity, loadMasterKey, sha256Hex } from './crypto.mjs';
import { Db } from './db.mjs';
import { PrivateStoreApp } from './app.mjs';
import { generateInboxKey } from './envelope.mjs';
import { ScanService } from './inbox.mjs';
import { OcrEngines } from './ocr.mjs';
import { pairWithStudio, sendHeartbeat } from './studioLink.mjs';

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, log?: { log: (m: string) => void, error: (m: string) => void } }} [options]
 */
export async function createPrivateStore({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  const config = loadConfig(env);
  const key = deriveDataKey(loadMasterKey(config.masterKeyFile));
  const db = new Db(config.dataDir, key);

  let identity = db.getState('identity');
  if (!identity) {
    identity = generateIdentity();
    db.setState('identity', identity);
  }
  // Ключ «скриньки» для знімків із телефона (журнал #550): публічний йде у Studio в пульсі, приватний не покидає цей сервер.
  let inbox = db.getState('inbox');
  if (!inbox) {
    inbox = generateInboxKey();
    db.setState('inbox', inbox);
  }
  const state = { link: db.getState('link'), identity, inbox };

  const pair = async () => {
    // Новий код (відмінний від останнього використаного) дозволяє перепідключити сервер, не втрачаючи даних.
    const codeHash = config.pairingCode ? sha256Hex(config.pairingCode) : null;
    if (!config.pairingCode || !config.studioUrl) return;
    if (state.link && db.getState('pairedCodeHash') === codeHash) return;
    try {
      state.link = await pairWithStudio({ studioUrl: config.studioUrl, code: config.pairingCode, identity, config, fetchImpl });
      db.setState('link', state.link);
      db.setState('pairedCodeHash', codeHash);
      db.audit('paired', { ref: state.link.vaultId });
      log.log(`[private-store] підключено до Studio, id сервера ${state.link.vaultId}; відбиток ключа Studio: ${sha256Hex(state.link.studioPublicKey).slice(0, 16)} (має збігтися з відбитком в адмінпанелі)`);
    } catch (err) {
      log.error(`[private-store] ${err.message}`);
    }
  };

  let timer = null;
  const beat = async () => {
    if (!state.link) return;
    try {
      const totals = db.totals();
      const next = await sendHeartbeat({
        link: state.link,
        identity,
        info: { version: config.version, docs: totals.docs, assets: totals.assets, bytes: totals.bytes, endpoint: config.publicUrl, uptimeSec: Math.round(process.uptime()), inboxKey: inbox.publicKey },
        fetchImpl,
      });
      if (JSON.stringify(next) !== JSON.stringify(state.link)) {
        if (next.status !== state.link.status) log.log(`[private-store] стан підключення: ${next.status}`);
        state.link = next;
        db.setState('link', next);
      }
    } catch (err) {
      log.error(`[private-store] пульс до Studio не вдався: ${String(err.message).slice(0, 160)}`);
    }
  };

  const ocr = new OcrEngines({ config, fetchImpl, log });
  const scans = new ScanService({ config, db, state, ocr, fetchImpl, log });
  const app = new PrivateStoreApp({ config, db, state, scans });
  const server = http.createServer(app.handle);
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;

  return {
    config,
    db,
    state,
    app,
    scans,
    ocr,
    server,
    async start() {
      await pair();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, resolve);
      });
      void beat();
      timer = setInterval(() => void beat(), config.heartbeatMs);
      timer.unref();
      scans.start();
      log.log(`[private-store] слухає ${config.host}:${config.port}; ${state.link ? `підключено (${state.link.status})` : 'НЕ підключено до Studio — задайте STUDIO_URL і PAIRING_CODE'}`);
      return server.address();
    },
    beat,
    async stop() {
      if (timer) clearInterval(timer);
      await scans.stop();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      db.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const store = await createPrivateStore();
    await store.start();
    const shutdown = async () => {
      await store.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error(`[private-store] не вдалося запустити: ${err.message}`);
    process.exit(1);
  }
}
