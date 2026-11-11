/**
 * «Вхідні з телефона» на локальному сервері (журнал #550): сервер сам забирає запечатані конверти зі Studio, розпечатує їх
 * своїм приватним ключем, кладе знімки як зображення, а розпізнаний текст — у запис виду `scan`. Studio бачила лише шифротекст.
 *
 *   запис `scan_<draftId>` (власник — користувач, що поклав знімок):
 *     payload = { v, draftId, kind: course|instruction|manuscript, courseSource, instructionMode, modelCode, title, craft, audience,
 *                 newBookTitle, createdAt, pages: [{ pageId (= номер елемента), order, assetId, mime, bytes, width, height, receivedAt,
 *                 note, textEdited, ocr: { status: queued|running|done|failed, engine, text, confidence, quality, uncertain[], … } }] }
 *     зображення сторінок — assets `scanimg_<номер елемента>`.
 *
 * Знімок — чужі дані: перевіряємо формат, розміри й ліміти ДО декодування (imageInfo.mjs); незрозумілий конверт відхиляється й
 * підтверджується (щоб не висів у черзі), без вмісту в журналі.
 */
import { RevisionConflict } from './db.mjs';
import { decodePayload, envelopeAad, openEnvelope } from './envelope.mjs';
import { IMAGE_MIMES, imageProblem, sniffImage } from './imageInfo.mjs';
import { inboxAck, inboxFetch, inboxList } from './studioLink.mjs';

const ID_RE = /^[A-Za-z0-9_-]{6,60}$/;
const KINDS = new Set(['course', 'instruction', 'manuscript']);
const COURSE_SOURCES = new Set(['photos', 'document']);
const INSTRUCTION_MODES = new Set(['assembly', 'operation']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PAGES_PER_DRAFT = 300;
const MAX_TEXT_CHARS = 200_000;

const short = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

/** Заголовок конверта (від телефона, тобто недовірений) → перевірені поля. Кидає Error із причиною. */
export function parseHeader(raw) {
  if (raw.v !== 1) throw new Error('Невідома версія конверта.');
  if (typeof raw.draftId !== 'string' || !ID_RE.test(raw.draftId)) throw new Error('Некоректний номер чернетки.');
  if (!KINDS.has(raw.kind)) throw new Error('Невідомий вид чернетки.');
  const order = Number.isInteger(raw.order) && raw.order >= 0 && raw.order <= 9999 ? raw.order : 0;
  const mime = typeof raw.mime === 'string' ? raw.mime.toLowerCase() : '';
  if (!IMAGE_MIMES.has(mime)) throw new Error('Невідомий тип зображення.');
  return {
    draftId: raw.draftId,
    kind: raw.kind,
    courseSource: raw.kind === 'course' && COURSE_SOURCES.has(raw.courseSource) ? raw.courseSource : raw.kind === 'course' ? 'document' : null,
    instructionMode: raw.kind === 'instruction' && INSTRUCTION_MODES.has(raw.instructionMode) ? raw.instructionMode : null,
    modelCode: short(raw.modelCode, 200),
    title: short(raw.title, 200),
    craft: short(raw.craft, 200),
    audience: short(raw.audience, 200),
    newBookTitle: short(raw.newBookTitle, 200),
    note: short(raw.note, 500),
    order,
    mime,
    clientId: short(raw.clientId, 80),
  };
}

export class ScanService {
  /**
   * @param {{ config: any, db: import('./db.mjs').Db, state: { link: any, identity: any, inbox: { publicKey: string, privateKey: string } }, ocr: import('./ocr.mjs').OcrEngines, fetchImpl?: typeof fetch, log?: any, now?: () => number }} deps
   */
  constructor({ config, db, state, ocr, fetchImpl = fetch, log = console, now = () => Date.now() }) {
    this.config = config;
    this.db = db;
    this.state = state;
    this.ocr = ocr;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.now = now;
    this.timer = null;
    this.polling = false;
    this.lock = Promise.resolve();
    this.queue = [];
    this.working = false;
    this.idleWaiters = [];
  }

  // ---- запис документа: усе, що змінює `scan`, іде через цей замок (ніяких «загублених оновлень» між воркером і HTTP) --------
  withDoc(owner, docId, mutator) {
    const run = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const doc = this.db.getDoc(owner, docId);
        const payload = doc ? doc.payload : null;
        const next = await mutator(payload, doc);
        if (next === undefined) return null;
        try {
          return this.db.putDoc(owner, { id: docId, kind: 'scan', meta: this.metaOf(next), payload: next, expectedRevision: doc ? doc.revision : undefined }, new Date(this.now()));
        } catch (err) {
          if (err instanceof RevisionConflict && attempt < 4) continue;
          throw err;
        }
      }
      return null;
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  metaOf(payload) {
    const pages = payload.pages || [];
    const done = pages.filter((p) => p.ocr && p.ocr.status === 'done');
    return {
      title: payload.title || (payload.kind === 'manuscript' && payload.newBookTitle) || (payload.kind === 'course' ? 'Курс із телефона' : payload.kind === 'instruction' ? 'Інструкція з телефона' : 'Книга з телефона'),
      kind: payload.kind,
      pages: pages.length,
      recognized: done.length,
      poor: done.filter((p) => p.ocr.quality === 'poor').length,
      running: pages.filter((p) => p.ocr && (p.ocr.status === 'queued' || p.ocr.status === 'running')).length,
      updatedAt: payload.updatedAt,
    };
  }

  // ---- прийом конверта ---------------------------------------------------------------------------------------------------
  /** @returns {Promise<{ status: 'stored' | 'duplicate' | 'rejected', reason?: string, docId?: string, pageId?: string }>} */
  async ingest({ itemId, userId, bytes }) {
    let header;
    let image;
    try {
      const opened = openEnvelope(this.state.inbox.privateKey, bytes, envelopeAad(this.state.link.vaultId, itemId));
      const decoded = decodePayload(opened);
      header = parseHeader(decoded.header);
      image = decoded.image;
    } catch (err) {
      return { status: 'rejected', reason: String(err.message).slice(0, 120) };
    }
    if (typeof userId !== 'string' || !userId || userId.length > 120) return { status: 'rejected', reason: 'Некоректний власник.' };
    if (!image.length || image.length > MAX_IMAGE_BYTES) return { status: 'rejected', reason: 'Зображення порожнє або завелике.' };
    const info = sniffImage(image);
    const problem = imageProblem(info);
    if (problem) return { status: 'rejected', reason: problem };
    if (info.mime !== header.mime) return { status: 'rejected', reason: 'Заявлений тип не збігається з вмістом.' };

    const docId = `scan_${header.draftId}`;
    const assetId = `scanimg_${itemId}`;
    let duplicate = false;
    let rejected = null;
    try {
      await this.withDoc(userId, docId, (payload) => {
        const at = new Date(this.now()).toISOString();
        const base = payload ?? { v: 1, draftId: header.draftId, kind: header.kind, createdAt: at, pages: [] };
        if (base.pages.some((p) => p.pageId === itemId)) {
          duplicate = true;
          return undefined;
        }
        if (base.pages.length >= MAX_PAGES_PER_DRAFT) {
          rejected = 'У чернетці забагато сторінок.';
          return undefined;
        }
        // Заголовок чернетки: беремо найновіше непорожнє значення (телефон повторює його в кожному конверті).
        const pick = (key) => header[key] || base[key] || '';
        const next = {
          ...base,
          kind: base.kind || header.kind,
          courseSource: header.courseSource ?? base.courseSource ?? null,
          instructionMode: header.instructionMode ?? base.instructionMode ?? null,
          modelCode: pick('modelCode'),
          title: pick('title'),
          craft: pick('craft'),
          audience: pick('audience'),
          newBookTitle: pick('newBookTitle'),
          updatedAt: at,
          pages: [
            ...base.pages,
            {
              pageId: itemId,
              order: header.order,
              assetId,
              mime: info.mime,
              bytes: image.length,
              width: info.width,
              height: info.height,
              receivedAt: at,
              note: header.note,
              clientId: header.clientId,
              textEdited: false,
              ocr: { status: this.config.autoOcr ? 'queued' : 'idle' },
            },
          ].sort((a, b) => a.order - b.order || a.receivedAt.localeCompare(b.receivedAt)),
        };
        this.db.putAsset(userId, { id: assetId, docId, mime: info.mime, bytes: image }, new Date(this.now()));
        return next;
      });
    } catch (err) {
      // Номер чернетки вже належить іншому користувачу (чи збій запису): знімок не лишаємо напівзбереженим.
      this.db.deleteAsset(userId, assetId);
      if (err && (err.kind === 'id_taken' || err.kind === 'kind_mismatch')) return { status: 'rejected', reason: 'Номер чернетки зайнятий.' };
      throw err;
    }
    if (rejected) return { status: 'rejected', reason: rejected };
    if (duplicate) return { status: 'duplicate', docId, pageId: itemId };
    this.db.audit('inbox_stored', { subject: userId, ref: docId, detail: `${image.length} B` });
    if (this.config.autoOcr) this.enqueueOcr({ owner: userId, docId, pageId: itemId, engine: 'tesseract' });
    return { status: 'stored', docId, pageId: itemId };
  }

  // ---- опитування Studio -------------------------------------------------------------------------------------------------
  async pollOnce() {
    if (this.polling) return { stored: 0, rejected: 0 };
    const link = this.state.link;
    if (!link || link.status !== 'active') return { stored: 0, rejected: 0 };
    this.polling = true;
    const out = { stored: 0, rejected: 0, duplicates: 0, errors: 0 };
    try {
      const common = { link, identity: this.state.identity, fetchImpl: this.fetchImpl };
      const list = await inboxList(common);
      if (list.revoked) return out;
      for (const item of list.items.slice(0, 20)) {
        try {
          const bytes = await inboxFetch({ ...common, itemId: item.id });
          if (!bytes) continue;
          const result = await this.ingest({ itemId: item.id, userId: item.userId, bytes });
          if (result.status === 'rejected') {
            out.rejected += 1;
            this.db.audit('inbox_rejected', { subject: item.userId, ref: item.id, detail: result.reason });
          } else if (result.status === 'duplicate') out.duplicates += 1;
          else out.stored += 1;
          // Підтверджуємо лише ПІСЛЯ збереження (або остаточної відмови): збій посередині не губить знімок — наступне опитування повторить.
          await inboxAck({ ...common, itemId: item.id });
        } catch (err) {
          out.errors += 1;
          this.log.error(`[private-store] вхідний елемент ${item.id}: ${String(err.message).slice(0, 160)}`);
        }
      }
    } catch (err) {
      this.log.error(`[private-store] опитування черги не вдалося: ${String(err.message).slice(0, 160)}`);
    } finally {
      this.polling = false;
    }
    return out;
  }

  start() {
    if (this.timer || !this.config.inboxPollMs) return;
    const tick = () => void this.pollOnce();
    this.timer = setInterval(tick, this.config.inboxPollMs);
    this.timer.unref?.();
    setTimeout(tick, 1000).unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
    // Довге розпізнавання (модель зору) не тримає зупинку: чекаємо недовго й закриваємо рушій.
    await Promise.race([this.whenIdle(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    await this.ocr.close();
  }

  // ---- розпізнавання (черга по одному: Tesseract і модель зору важкі) ---------------------------------------------------------
  enqueueOcr(job) {
    const key = `${job.owner}|${job.docId}|${job.pageId}`;
    this.queue = this.queue.filter((j) => `${j.owner}|${j.docId}|${j.pageId}` !== key);
    this.queue.push(job);
    void this.drain();
  }

  async drain() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        await this.runOcr(job).catch((err) => this.log.error(`[private-store] розпізнавання: ${String(err.message).slice(0, 160)}`));
      }
    } finally {
      this.working = false;
      const waiters = this.idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  }

  whenIdle() {
    if (!this.working && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  setPageOcr(owner, docId, pageId, patch) {
    return this.withDoc(owner, docId, (payload) => {
      if (!payload) return undefined;
      const page = payload.pages.find((p) => p.pageId === pageId);
      if (!page) return undefined;
      page.ocr = { ...page.ocr, ...patch };
      if (patch.status === 'done') {
        page.ocr.original = patch.text;
        page.textEdited = false;
      }
      payload.updatedAt = new Date(this.now()).toISOString();
      return payload;
    });
  }

  async runOcr({ owner, docId, pageId, engine, model }) {
    const doc = this.db.getDoc(owner, docId);
    const page = doc && doc.payload.pages.find((p) => p.pageId === pageId);
    if (!page) return;
    const asset = this.db.getAsset(owner, page.assetId);
    if (!asset) {
      await this.setPageOcr(owner, docId, pageId, { status: 'failed', engine, error: 'Зображення сторінки не знайдено.', at: new Date(this.now()).toISOString() });
      return;
    }
    await this.setPageOcr(owner, docId, pageId, { status: 'running', engine, error: null });
    try {
      const result = await this.ocr.recognize(engine, asset.bytes, { mime: asset.mime, model });
      const { mime: _unused, ...kept } = result;
      await this.setPageOcr(owner, docId, pageId, { ...kept, status: 'done', error: null, at: new Date(this.now()).toISOString() });
      this.db.audit('ocr_done', { subject: owner, ref: docId, detail: `${engine} ${result.quality}` });
    } catch (err) {
      // У повідомленні про помилку вмісту немає: лише причина рушія.
      await this.setPageOcr(owner, docId, pageId, { status: 'failed', engine, error: String(err.message || 'Помилка розпізнавання.').slice(0, 200), at: new Date(this.now()).toISOString() });
      this.db.audit('ocr_failed', { subject: owner, ref: docId, detail: engine });
    }
  }

  // ---- дії користувача (HTTP) ---------------------------------------------------------------------------------------------
  requestOcr(owner, docId, pageId, engine, model) {
    const doc = this.db.getDoc(owner, docId);
    if (!doc || doc.kind !== 'scan') return false;
    const page = doc.payload.pages.find((p) => p.pageId === pageId);
    if (!page) return false;
    if (page.ocr && (page.ocr.status === 'queued' || page.ocr.status === 'running')) return true;
    this.setPageOcr(owner, docId, pageId, { status: 'queued', engine, error: null }).then(() => this.enqueueOcr({ owner, docId, pageId, engine, model }));
    return true;
  }

  async setPageText(owner, docId, pageId, text) {
    let found = false;
    const result = await this.withDoc(owner, docId, (payload) => {
      const page = payload && payload.pages.find((p) => p.pageId === pageId);
      if (!page) return undefined;
      found = true;
      page.ocr = { ...(page.ocr || {}), text, status: 'done' };
      page.textEdited = true;
      payload.updatedAt = new Date(this.now()).toISOString();
      return payload;
    });
    return found ? result : null;
  }

  /** Шапка чернетки: лише дозволені поля (вид, назва, джерело…) і позначка «з цього створено матеріал». */
  async editDoc(owner, docId, patch) {
    let ok = false;
    const result = await this.withDoc(owner, docId, (payload) => {
      if (!payload) return undefined;
      ok = true;
      if (patch.title !== undefined) payload.title = short(patch.title, 200);
      if (patch.craft !== undefined) payload.craft = short(patch.craft, 200);
      if (patch.audience !== undefined) payload.audience = short(patch.audience, 200);
      if (patch.modelCode !== undefined) payload.modelCode = short(patch.modelCode, 200);
      if (patch.newBookTitle !== undefined) payload.newBookTitle = short(patch.newBookTitle, 200);
      if (KINDS.has(patch.kind)) payload.kind = patch.kind;
      if (COURSE_SOURCES.has(patch.courseSource)) payload.courseSource = patch.courseSource;
      if (INSTRUCTION_MODES.has(patch.instructionMode)) payload.instructionMode = patch.instructionMode;
      if (patch.consumed === null) delete payload.consumed;
      else if (patch.consumed && typeof patch.consumed === 'object' && ['book', 'course', 'instruction'].includes(patch.consumed.kind) && typeof patch.consumed.id === 'string' && ID_RE.test(patch.consumed.id)) {
        payload.consumed = { kind: patch.consumed.kind, id: patch.consumed.id, at: new Date(this.now()).toISOString() };
      }
      payload.updatedAt = new Date(this.now()).toISOString();
      return payload;
    });
    return ok ? result : null;
  }

  async deletePage(owner, docId, pageId) {
    let assetId = null;
    const result = await this.withDoc(owner, docId, (payload) => {
      const page = payload && payload.pages.find((p) => p.pageId === pageId);
      if (!page) return undefined;
      assetId = page.assetId;
      payload.pages = payload.pages.filter((p) => p.pageId !== pageId);
      payload.updatedAt = new Date(this.now()).toISOString();
      return payload;
    });
    if (assetId) this.db.deleteAsset(owner, assetId);
    return assetId ? result : null;
  }
}

export { MAX_TEXT_CHARS };
