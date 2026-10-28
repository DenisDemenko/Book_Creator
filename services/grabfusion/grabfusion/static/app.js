'use strict';
/* GrabFusion — сторінка викладача (етап 2, MVP). Без фреймворків і збірки.
   Токена Studio тут немає: сервер тримає його в сесії (cookie httpOnly). */

const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const state = {
  view: 'boot', limits: null, drafts: [], draft: null, queue: [], user: null,
  online: navigator.onLine, urls: new Map(), editing: false, needsRender: false,
};
let pollTimer = null, flushing = false, flushTimer = null;

/* ---------- утиліти ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const chars = (s) => [...s].length; // кодові точки, як у контракті
class ApiError extends Error { constructor(kind, message, status, extra) { super(message); this.kind = kind; this.status = status; Object.assign(this, extra || {}); } }

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

async function api(method, path, body, isForm) {
  let resp;
  try {
    resp = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (e) { throw new ApiError('network', 'Немає звʼязку.', 0); }
  let data = null;
  try { data = await resp.json(); } catch (e) { /* не JSON */ }
  if (!resp.ok) {
    const err = new ApiError((data && data.kind) || 'server_error', (data && data.error) || 'Помилка сервера.', resp.status, { blockers: data && data.blockers });
    if (err.kind === 'unauthenticated' || err.kind === 'invalid_token') { state.user = null; go('pair'); }
    throw err;
  }
  return data;
}

/* ---------- черга без звʼязку (IndexedDB, запасний варіант — памʼять) ---------- */
const mem = new Map();
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('grabfusion', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'clientId' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }).catch(() => null);
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => d ? new Promise((res, rej) => { const t = d.transaction('queue', mode); const r = fn(t.objectStore('queue')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }) : null);
}
const qAll = async () => { const r = await tx('readonly', (s) => s.getAll()); return (r || [...mem.values()]).sort((a, b) => a.order - b.order); };
const qPut = async (it) => { mem.set(it.clientId, it); await tx('readwrite', (s) => s.put(it)).catch(() => {}); };
const qDel = async (id) => { mem.delete(id); await tx('readwrite', (s) => s.delete(id)).catch(() => {}); };

function urlFor(item) {
  if (!state.urls.has(item.clientId)) state.urls.set(item.clientId, URL.createObjectURL(item.blob));
  return state.urls.get(item.clientId);
}
function dropUrl(id) { const u = state.urls.get(id); if (u) { URL.revokeObjectURL(u); state.urls.delete(id); } }

/* ---------- стиснення в браузері (canvas прибирає EXIF; сервер перестраховує Pillow) ---------- */
async function downscale(file, maxSide) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), hgt = Math.round(bmp.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (bmp.close) bmp.close();
    if (blob && blob.size > 0) return blob;
  } catch (e) { /* формат, який браузер не вміє (HEIC): віддаємо як є, сервер розбереться */ }
  return file;
}

/* ---------- навігація ---------- */
function go(view) {
  state.view = view; clearTimeout(pollTimer);
  document.getElementById('btn-back').hidden = view !== 'draft';
  document.getElementById('btn-logout').hidden = !state.user;
  render();
}
function render() {
  if (state.editing && state.view === 'draft') { state.needsRender = true; return; }
  state.needsRender = false;
  app.replaceChildren();
  const v = { pair: viewPair, list: viewList, create: viewCreate, draft: viewDraft, boot: () => h('p', { class: 'muted', text: 'Завантаження…' }) }[state.view];
  titleEl.textContent = state.view === 'draft' && state.draft ? (state.draft.title || 'Чернетка без назви') : 'GrabFusion';
  app.append(v());
}
function setNet() { document.getElementById('net').hidden = state.online; }
addEventListener('online', () => { state.online = true; setNet(); flushQueue(); });
addEventListener('offline', () => { state.online = false; setNet(); });
document.getElementById('btn-back').addEventListener('click', () => openList());
document.getElementById('btn-logout').addEventListener('click', async () => { await api('POST', '/logout').catch(() => {}); state.user = null; go('pair'); });

/* ---------- підключення ---------- */
function viewPair() {
  const err = h('p', { class: 'err', id: 'pair-err' });
  const input = h('input', { id: 'code', placeholder: 'Код підключення', autocomplete: 'off', autocapitalize: 'characters' });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await api('POST', '/pair', { code: input.value.trim() });
      state.user = r.user; await start();
    } catch (e2) { err.textContent = e2.message; }
  } },
    h('h2', { text: 'Підключіть застосунок' }),
    h('p', { class: 'muted', text: 'У Studio: Медіатека → Скани з телефону → Підключення застосунку → «Код підключення GrabFusion». Код діє 5 хвилин.' }),
    h('label', { for: 'code', text: 'Код' }), input, err,
    h('p', null, h('button', { class: 'primary', type: 'submit', text: 'Підключити' })));
  return form;
}

/* ---------- список чернеток ---------- */
async function openList() {
  state.draft = null;
  try { state.drafts = (await api('GET', '/drafts')).drafts; } catch (e) { toast(e.message); }
  go('list');
}
const KIND = { course: 'Курс', instruction: 'Інструкція', book: 'Глава книги', manuscript: 'Набір книги' };
const STATUS = { collecting: 'збір кадрів', structured: 'є структура', written: 'текст написано', submitted: 'відправлено' };
function viewList() {
  const box = h('div');
  box.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, h('h2', { class: 'grow', text: 'Чернетки' }),
    h('button', { class: 'primary', id: 'btn-new', text: 'Нова чернетка', onclick: () => go('create') })));
  if (!state.drafts.length) box.append(h('p', { class: 'muted', text: 'Поки порожньо. Створіть чернетку й починайте знімати.' }));
  for (const d of state.drafts) {
    box.append(h('div', { class: 'card row', 'data-draft': d.draftId },
      h('div', { class: 'grow' }, h('strong', { text: d.title || 'Без назви' }),
        h('div', { class: 'muted', text: `${KIND[d.kind] || d.kind} · ${STATUS[d.status] || d.status} · кадрів: ${d.photoCount}` })),
      h('button', { text: 'Відкрити', onclick: () => openDraft(d.draftId) })));
  }
  return box;
}

function viewCreate() {
  const f = {
    kind: h('select', { id: 'f-kind' }, h('option', { value: 'course', text: 'Курс' }), h('option', { value: 'instruction', text: 'Інструкція' })),
    title: h('input', { id: 'f-title', maxlength: 160, placeholder: 'Наприклад: Ложка з вишні за один вечір' }),
    craft: h('input', { id: 'f-craft', maxlength: 200, placeholder: 'Ремесло (необовʼязково)' }),
    audience: h('input', { id: 'f-audience', maxlength: 200, placeholder: 'Для кого (необовʼязково)' }),
    mode: h('select', { id: 'f-mode' }, h('option', { value: 'assembly', text: 'Складання' }), h('option', { value: 'operation', text: 'Користування' })),
    model: h('input', { id: 'f-model', maxlength: 200, placeholder: 'Код або модель виробу' }),
  };
  const extra = h('div', { hidden: true }, h('label', { text: 'Режим інструкції' }), f.mode, h('label', { text: 'Код або модель виробу' }), f.model);
  f.kind.addEventListener('change', () => { extra.hidden = f.kind.value !== 'instruction'; });
  const err = h('p', { class: 'err' });
  return h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const body = { kind: f.kind.value };
    for (const k of ['title', 'craft', 'audience']) if (f[k].value.trim()) body[k] = f[k].value.trim();
    if (body.kind === 'instruction') { body.instructionMode = f.mode.value; if (f.model.value.trim()) body.modelCode = f.model.value.trim(); }
    try { const r = await api('POST', '/drafts', body); await openDraft(r.draft.draftId); } catch (e2) { err.textContent = e2.message; }
  } },
    h('h2', { text: 'Нова чернетка' }),
    h('label', { text: 'Що робимо' }), f.kind, extra,
    h('label', { text: 'Назва' }), f.title, h('label', { text: 'Ремесло' }), f.craft, h('label', { text: 'Аудиторія' }), f.audience, err,
    h('p', { class: 'row' }, h('button', { class: 'primary', type: 'submit', text: 'Створити' }), h('button', { type: 'button', text: 'Скасувати', onclick: () => go('list') })));
}

/* ---------- чернетка ---------- */
async function openDraft(id) {
  try { state.draft = (await api('GET', '/drafts/' + id)).draft; } catch (e) { toast(e.message); return; }
  state.queue = await qAll();
  go('draft'); schedulePoll(); flushQueue();
}
async function reloadDraft() {
  if (!state.draft) return;
  try { state.draft = (await api('GET', '/drafts/' + state.draft.draftId)).draft; if (state.view === 'draft') render(); } catch (e) { /* без звʼязку — лишаємо як є */ }
}
function busy() { return state.draft && state.draft.photos.some((p) => p.status === 'processing'); }
function schedulePoll() {
  clearTimeout(pollTimer);
  if (state.view !== 'draft') return;
  const every = state.limits ? state.limits.pollIntervalMs : 2000;
  pollTimer = setTimeout(async () => { if (busy() && state.online) await reloadDraft(); schedulePoll(); }, every);
}

function noteFor(photoId) { return (state.draft.notes || []).find((n) => n.photoIds.length === 1 && n.photoIds[0] === photoId); }
const maxNote = () => (state.limits ? state.limits.maxNoteChars : 500);

function noteBox(initial, onSave, id) {
  const ta = h('textarea', { rows: 2, placeholder: 'Що на кадрі? (до ' + maxNote() + ' символів)', id });
  ta.value = initial || '';
  const cnt = h('div', { class: 'counter' });
  const upd = () => { const n = chars(ta.value); cnt.textContent = `${n} / ${maxNote()}`; cnt.className = 'counter' + (n > maxNote() ? ' over' : ''); return n; };
  upd(); let t;
  ta.addEventListener('focus', () => { state.editing = true; });
  ta.addEventListener('input', () => { if (upd() <= maxNote()) { clearTimeout(t); t = setTimeout(() => onSave(ta.value), 700); } });
  ta.addEventListener('blur', () => { clearTimeout(t); if (upd() <= maxNote()) onSave(ta.value); state.editing = false; if (state.needsRender) render(); });
  return h('div', null, ta, cnt);
}

async function saveNote(photoId, text) {
  const cur = noteFor(photoId);
  if ((cur ? cur.text : '') === text) return;
  try {
    if (!text.trim()) { if (cur) { const r = await api('DELETE', `/drafts/${state.draft.draftId}/notes/${cur.noteId}`); state.draft = r.draft; } return; }
    const r = await api('PUT', `/drafts/${state.draft.draftId}/notes/${cur ? cur.noteId : 'n-' + photoId}`, { photoIds: [photoId], text });
    const rest = (state.draft.notes || []).filter((n) => n.noteId !== r.note.noteId);
    state.draft.notes = [...rest, r.note]; state.draft.revision = r.revision;
  } catch (e) { toast(e.message); }
}

async function movePhoto(photoId, delta, toIndex) {
  const ids = state.draft.photos.slice().sort((a, b) => a.order - b.order).map((p) => p.photoId);
  const from = ids.indexOf(photoId); const to = toIndex != null ? toIndex : from + delta;
  if (from < 0 || to < 0 || to >= ids.length || to === from) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, photoOrder: ids })).draft; }
  catch (e) { toast(e.kind === 'revision_conflict' ? 'Чернетку змінено з іншого пристрою — оновлюю.' : e.message); await reloadDraft(); }
  render();
}

function photoCard(p, i, total) {
  const card = h('div', { class: 'card frame', draggable: 'true', 'data-photo': p.photoId },
    h('img', { src: `/api/drafts/${state.draft.draftId}/photos/${p.photoId}/image`, alt: 'Кадр ' + p.order, loading: 'lazy' }),
    h('div', null,
      h('div', { class: 'row' }, h('strong', { text: '#' + p.order }), h('span', { class: 'badge ' + p.status, text: { processing: 'описується…', described: 'описано', failed: 'не вдалося' }[p.status] || p.status })),
      p.description && h('p', { text: p.description }),
      p.tags && p.tags.length ? h('div', { class: 'tags' }, p.tags.map((t) => h('span', { text: t }))) : null,
      p.status === 'failed' && h('p', { class: 'err', text: p.error || 'Не вдалося описати кадр.' }),
      noteBox((noteFor(p.photoId) || {}).text, (text) => saveNote(p.photoId, text)),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'small', text: '↑', title: 'Вище', disabled: i === 0, onclick: () => movePhoto(p.photoId, -1) }),
        h('button', { class: 'small', text: '↓', title: 'Нижче', disabled: i === total - 1, onclick: () => movePhoto(p.photoId, 1) }),
        p.status === 'failed' && h('button', { class: 'small', text: 'Повторити', onclick: async () => { try { await api('POST', `/drafts/${state.draft.draftId}/photos/${p.photoId}/retry`); await reloadDraft(); } catch (e) { toast(e.message); } } }),
        h('button', { class: 'small danger', text: 'Видалити', onclick: async () => { try { state.draft = (await api('DELETE', `/drafts/${state.draft.draftId}/photos/${p.photoId}`)).draft; render(); } catch (e) { toast(e.message); } } }))));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.photoId); });
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('dragover'); });
  card.addEventListener('dragleave', () => card.classList.remove('dragover'));
  card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('dragover'); const id = e.dataTransfer.getData('text/plain'); if (id && id !== p.photoId) movePhoto(id, 0, i); });
  return card;
}

function queuedCard(it) {
  const failed = it.state === 'failed';
  return h('div', { class: 'card frame', 'data-queued': it.clientId },
    h('img', { src: urlFor(it), alt: 'Кадр у черзі' }),
    h('div', null,
      h('div', { class: 'row' }, h('span', { class: 'badge ' + (failed ? 'failed' : 'queued'), text: failed ? 'не надіслано' : 'у черзі' }),
        h('span', { class: 'muted', text: failed ? '' : (state.online ? 'надсилається…' : 'надішлеться, коли зʼявиться звʼязок') })),
      failed && h('p', { class: 'err', text: it.error }),
      noteBox(it.note, async (text) => { it.note = text; await qPut(it); }),
      h('div', { class: 'row', style: 'margin-top:8px' },
        failed && h('button', { class: 'small', text: 'Спробувати ще', onclick: async () => { it.state = 'queued'; it.error = ''; await qPut(it); render(); flushQueue(); } }),
        h('button', { class: 'small danger', text: 'Прибрати', onclick: async () => { await qDel(it.clientId); dropUrl(it.clientId); state.queue = state.queue.filter((x) => x.clientId !== it.clientId); render(); } }))));
}

function viewDraft() {
  const d = state.draft;
  const box = h('div');
  const mine = state.queue.filter((q) => q.draftId === d.draftId);
  const meta = [KIND[d.kind], STATUS[d.status], d.craft, d.audience].filter(Boolean).join(' · ');
  box.append(h('p', { class: 'muted', text: meta + ` · кадрів: ${d.photos.length}` + (mine.length ? ` (+${mine.length} у черзі)` : '') }));
  const onFiles = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  box.append(h('div', { class: 'shoot' },
    h('label', { class: 'btn primary', for: 'file-cam', id: 'lbl-cam', text: '📷 Зняти' }),
    h('label', { class: 'btn', for: 'file-gal', id: 'lbl-gal', text: 'З галереї' }),
    h('input', { type: 'file', id: 'file-cam', accept: 'image/*', capture: 'environment', onchange: onFiles }),
    h('input', { type: 'file', id: 'file-gal', accept: 'image/*', multiple: true, onchange: onFiles })));
  const photos = d.photos.slice().sort((a, b) => a.order - b.order);
  const list = h('div', { class: 'frames', id: 'frames' });
  photos.forEach((p, i) => list.append(photoCard(p, i, photos.length)));
  mine.forEach((q) => list.append(queuedCard(q)));
  if (!photos.length && !mine.length) list.append(h('p', { class: 'muted', text: 'Знімайте кроки по порядку. Кожен кадр опишеться автоматично; свій опис можна дописати.' }));
  box.append(list);
  return box;
}

/* ---------- додавання фото й відправка черги ---------- */
async function addFiles(files) {
  if (!state.draft || !files.length) return;
  const side = state.limits ? state.limits.recommendedMaxSidePx : 2048;
  for (const f of files) {
    const blob = await downscale(f, side);
    const it = {
      clientId: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      draftId: state.draft.draftId, blob, note: '', state: 'queued', error: '',
      takenAt: f.lastModified ? new Date(f.lastModified).toISOString() : null, order: Date.now() + Math.random(),
    };
    await qPut(it); state.queue.push(it);
  }
  render(); flushQueue();
}

async function flushQueue() {
  if (flushing) return; flushing = true; clearTimeout(flushTimer);
  let retryIn = 0;
  try {
    state.queue = await qAll();
    for (const it of state.queue.filter((q) => q.state === 'queued')) {
      const fd = new FormData();
      fd.append('clientId', it.clientId); fd.append('file', it.blob, 'photo.jpg');
      if (it.note && it.note.trim() && chars(it.note) <= maxNote()) fd.append('note', it.note);
      if (it.takenAt) fd.append('takenAt', it.takenAt);
      try {
        const r = await api('POST', `/drafts/${it.draftId}/photos`, fd, true);
        await qDel(it.clientId); dropUrl(it.clientId);
        state.queue = state.queue.filter((x) => x.clientId !== it.clientId);
        if (state.draft && state.draft.draftId === it.draftId && !state.draft.photos.some((p) => p.photoId === r.photo.photoId)) {
          state.draft.photos.push(r.photo); state.draft.revision = Math.max(state.draft.revision, r.revision);
        }
        if (state.view === 'draft') render();
      } catch (e) {
        if (e.kind === 'unauthenticated' || e.kind === 'invalid_token') break;
        if (e.kind === 'network' || e.kind === 'server_error' || e.status >= 500) { retryIn = 5000; break; }
        if (e.kind === 'rate_limited') { retryIn = 30000; break; }
        it.state = 'failed'; it.error = e.message; await qPut(it);
        if (state.view === 'draft') render();
      }
    }
  } finally { flushing = false; }
  if (retryIn) flushTimer = setTimeout(flushQueue, retryIn);
  else if (state.draft) { await reloadDraft(); schedulePoll(); }
}

/* ---------- старт ---------- */
async function start() {
  try { state.limits = (await api('GET', '/limits')).limits; } catch (e) { /* дефолти */ }
  state.queue = await qAll();
  document.getElementById('btn-logout').hidden = false;
  await openList();
  if (state.queue.length) flushQueue();
}
(async function boot() {
  setNet();
  try {
    const s = await api('GET', '/session');
    if (s.paired) { state.user = s.user; await start(); } else go('pair');
  } catch (e) {
    if (e.kind !== 'network') { go('pair'); return; }
    // Без звʼязку при відкритті: не кидаємо на екран підключення, фото в черзі нікуди не діваються.
    state.queue = await qAll(); app.replaceChildren(h('div', { class: 'card' },
      h('p', { text: 'Немає звʼязку з сервісом.' }),
      state.queue.length ? h('p', { class: 'muted', text: `Фото в черзі: ${state.queue.length} — вони надішлються, коли звʼязок зʼявиться.` }) : null,
      h('button', { class: 'primary', text: 'Спробувати знову', onclick: () => location.reload() })));
  }
})();
