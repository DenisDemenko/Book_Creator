/**
 * Рушії розпізнавання тексту на локальному сервері (журнал #550). Дані не залишають комп'ютер автора:
 *   - `tesseract` — Tesseract (tesseract.js, WASM) із мовними моделями, вбудованими в образ: без мережі й без ШІ-провайдера;
 *   - `ollama`    — модель зору на цьому ж комп'ютері (Ollama): для рукопису, фото й поганих знімків; вмикається адресою
 *                   OLLAMA_URL, яка МУСИТЬ вказувати на локальний комп'ютер чи локальну мережу (config.mjs).
 *
 * Якість Tesseract оцінюється за довірою до слів. Погана якість (`poor`) — підстава запропонувати користувачу Ollama:
 * сервер сам нічого в інтернет не надсилає й рушія не змінює без вибору користувача.
 */
import fs from 'node:fs';
import path from 'node:path';
import { prepareForOcr } from './scanPrep.mjs';

const WORKER_IDLE_MS = 2 * 60 * 1000;

/** Оцінка якості розпізнаного: середня довіра за довжиною слів, частка ненадійних слів, наявність слів узагалі. */
export function scoreWords(words) {
  // Слова-сміття (одна-дві літери, знаки з країв знімка: край столу, тінь) якість не визначають — рахуємо змістовні слова з 3+ літер.
  const real = words.filter((w) => w.text && (w.text.match(/\p{L}/gu) || []).length >= 3);
  if (real.length < 3) return { quality: 'poor', confidence: real.length ? Math.round(real.reduce((s, w) => s + w.conf, 0) / real.length) : 0, lowShare: 1, uncertain: [] };
  let weighted = 0;
  let length = 0;
  let low = 0;
  const uncertain = new Set();
  for (const w of real) {
    const len = Math.max(1, w.text.length);
    weighted += w.conf * len;
    length += len;
    if (w.conf < 60) {
      low += 1;
      if (w.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 && uncertain.size < 100) uncertain.add(w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
    }
  }
  const confidence = Math.round(weighted / length);
  const lowShare = low / real.length;
  let quality = confidence >= 80 && lowShare < 0.2 ? 'good' : confidence >= 62 && lowShare < 0.4 ? 'fair' : 'poor';
  // Перемішані абетки в одному слові («nitepolo», «носеpxi») і латиниця посеред кириличного тексту — типова ознака того,
  // що рушій вгадує літери навмання, навіть коли сама «довіра» висока: знижуємо оцінку на ступінь.
  const cyr = (t) => (t.match(/[Ѐ-ӿ]/g) || []).length;
  const lat = (t) => (t.match(/[A-Za-z]/g) || []).length;
  const cyrillicText = real.filter((w) => cyr(w.text) > lat(w.text)).length / real.length > 0.6;
  const suspicious = real.filter((w) => (cyr(w.text) > 0 && lat(w.text) > 0) || (cyrillicText && cyr(w.text) === 0 && lat(w.text) >= 3 && w.conf < 80)).length / real.length;
  if (suspicious > 0.12) quality = quality === 'good' ? 'fair' : 'poor';
  // Сміття навколо тексту (край столу, тінь, пальці): слів із довірою < 50 багато, хоча змістовні слова гарні. Такий знімок
  // треба перевірити людині (або Ollama) — не позначаємо його «добре».
  const everyWord = words.filter((w) => w.text && w.text.trim());
  const noise = everyWord.length ? everyWord.filter((w) => w.conf < 50).length / everyWord.length : 1;
  if (noise > 0.45) quality = 'poor';
  else if (noise > 0.25 && quality === 'good') quality = 'fair';
  return { quality, confidence, lowShare: Math.round(lowShare * 100) / 100, suspiciousShare: Math.round(suspicious * 100) / 100, noiseShare: Math.round(noise * 100) / 100, uncertain: [...uncertain] };
}

function wordsOf(data) {
  const words = [];
  for (const block of data.blocks || []) for (const para of block.paragraphs || []) for (const line of para.lines || []) for (const w of line.words || []) words.push({ text: String(w.text ?? ''), conf: Number(w.confidence) || 0 });
  return words;
}

export const OLLAMA_PROMPT =
  'Ти — модуль розпізнавання тексту. Перепиши ДОСЛІВНО весь текст зі зображення мовою оригіналу (переважно українська). ' +
  'Збережи абзаци, нумерацію й списки. Не перекладай, не виправляй, не додавай пояснень і не вигадуй. ' +
  'Якщо слово неможливо прочитати, постав на його місці [?]. Відповідь — лише розпізнаний текст.';

export class OcrEngines {
  /**
   * @param {{ config: ReturnType<import('./config.mjs').loadConfig>, fetchImpl?: typeof fetch, log?: { log: Function, error: Function } }} deps
   */
  constructor({ config, fetchImpl = fetch, log = console }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.worker = null;
    this.workerPromise = null;
    this.idleTimer = null;
    this.tesseractLoaded = undefined;
  }

  async loadTesseract() {
    if (this.tesseractLoaded !== undefined) return this.tesseractLoaded;
    try {
      this.tesseractLoaded = await import('tesseract.js');
    } catch {
      this.tesseractLoaded = null;
    }
    return this.tesseractLoaded;
  }

  tessdataProblem() {
    const dir = this.config.tessdataDir;
    if (!dir) return 'Не задано каталог мовних моделей Tesseract (PRIVATE_STORE_TESSDATA_DIR).';
    const ext = this.config.tessdataGzip ? '.traineddata.gz' : '.traineddata';
    for (const lang of ['ukr', 'eng']) if (!fs.existsSync(path.join(dir, `${lang}${ext}`))) return `У каталозі мовних моделей немає ${lang}${ext}.`;
    return null;
  }

  async tesseractStatus() {
    const mod = await this.loadTesseract();
    if (!mod) return { available: false, reason: 'Tesseract не встановлено в образі.' };
    const problem = this.tessdataProblem();
    return problem ? { available: false, reason: problem } : { available: true, langs: ['ukr', 'eng'] };
  }

  async ollamaStatus() {
    const url = this.config.ollamaUrl;
    if (!url) return { configured: false, available: false, model: this.config.ollamaModel, models: [] };
    try {
      const res = await this.fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models.map((m) => String(m.name || m.model || '')).filter(Boolean) : [];
      return { configured: true, available: true, model: this.config.ollamaModel, models, modelReady: models.includes(this.config.ollamaModel) };
    } catch (err) {
      return { configured: true, available: false, model: this.config.ollamaModel, models: [], reason: `Ollama не відповідає за ${new URL(url).host}: ${String(err.message).slice(0, 120)}` };
    }
  }

  async status() {
    return { tesseract: await this.tesseractStatus(), ollama: await this.ollamaStatus() };
  }

  async getWorker() {
    if (this.worker) return this.worker;
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const mod = await this.loadTesseract();
        if (!mod) throw new Error('Tesseract не встановлено.');
        const problem = this.tessdataProblem();
        if (problem) throw new Error(problem);
        const worker = await mod.createWorker('ukr+eng', 1, {
          langPath: this.config.tessdataDir,
          gzip: this.config.tessdataGzip,
          cacheMethod: 'none',
          errorHandler: (err) => this.log.error(`[private-store] tesseract: ${String(err && err.message ? err.message : err).slice(0, 160)}`),
        });
        this.worker = worker;
        return worker;
      })().finally(() => {
        this.workerPromise = null;
      });
    }
    return this.workerPromise;
  }

  touchIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.closeWorker(), WORKER_IDLE_MS);
    this.idleTimer.unref?.();
  }

  async closeWorker() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate().catch(() => undefined);
  }

  async close() {
    await this.closeWorker();
  }

  async tesseractOnce(worker, input) {
    const result = await worker.recognize(input, {}, { blocks: true, text: true });
    const words = wordsOf(result.data);
    return { text: String(result.data.text || '').trim(), ...scoreWords(words) };
  }

  /** Tesseract: спершу по обробленому знімку; якщо якість погана — ще й по оригіналу, лишаємо кращий. */
  async recognizeTesseract(bytes) {
    const started = Date.now();
    const worker = await this.getWorker();
    try {
      const prep = await prepareForOcr(bytes);
      let best = await this.tesseractOnce(worker, prep ? prep.png : bytes);
      let usedPrep = !!prep;
      if (prep && best.quality === 'poor') {
        const plain = await this.tesseractOnce(worker, bytes);
        if (plain.confidence > best.confidence) {
          best = plain;
          usedPrep = false;
        }
      }
      return { engine: 'tesseract', ...best, usedPrep, angle: prep ? Math.round(prep.angle * 100) / 100 : null, ms: Date.now() - started };
    } finally {
      this.touchIdle();
    }
  }

  /** Ollama: модель зору на цьому комп'ютері. Довіри за словами немає — якість 'unknown', а [?] у тексті рахується. */
  async recognizeOllama(bytes, { mime = 'image/jpeg', model } = {}) {
    const url = this.config.ollamaUrl;
    if (!url) throw new Error('Ollama не підключено: задайте OLLAMA_URL у налаштуваннях сервера.');
    const useModel = String(model || this.config.ollamaModel);
    const started = Date.now();
    const res = await this.fetchImpl(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        stream: false,
        messages: [{ role: 'user', content: OLLAMA_PROMPT, images: [bytes.toString('base64')] }],
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(this.config.ollamaTimeoutMs),
      redirect: 'error',
    });
    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err && err.error) reason = String(err.error).slice(0, 160);
      } catch {
        /* не JSON */
      }
      throw new Error(`Ollama відхилила запит: ${reason}`);
    }
    const data = await res.json();
    const text = String(data?.message?.content || '').trim();
    const unreadable = (text.match(/\[\?\]/g) || []).length;
    return { engine: 'ollama', model: useModel, text, confidence: null, quality: text ? (unreadable > 3 ? 'fair' : 'unknown') : 'poor', unreadable, uncertain: [], usedPrep: false, ms: Date.now() - started, mime };
  }

  async recognize(engine, bytes, options = {}) {
    if (engine === 'tesseract') return this.recognizeTesseract(bytes);
    if (engine === 'ollama') return this.recognizeOllama(bytes, options);
    throw new Error('Невідомий рушій розпізнавання.');
  }
}
