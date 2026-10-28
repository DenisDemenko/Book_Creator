'use strict';
/* GrabFusion — сторінка викладача (етап 2, MVP). Без фреймворків і збірки.
   Токена Studio тут немає: сервер тримає його в сесії (cookie httpOnly). */

const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const state = {
  view: 'boot', limits: null, drafts: [], draft: null, queue: [], user: null,
  online: navigator.onLine, urls: new Map(), editing: false, needsRender: false,
  studioOrigin: '', writing: false, blockers: null, target: null, photosOpen: true,
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
function busy() { const d = state.draft; return !!d && (d.photos.some((p) => p.status === 'processing') || !!(d.job && d.job.status === 'running')); }
function schedulePoll() {
  clearTimeout(pollTimer);
  if (state.view !== 'draft') return;
  const every = state.limits ? state.limits.pollIntervalMs : 2000;
  pollTimer = setTimeout(async () => { if (busy() && state.online) await reloadDraft(); schedulePoll(); }, every);
}

/* Завершення редагування: відкладене перемальовування, щоб Tab у наступне поле не губився. */
function endEditing() {
  state.editing = false;
  setTimeout(() => { if (!state.editing && state.needsRender) render(); }, 150);
}

function noteFor(photoId) { return (state.draft.notes || []).find((n) => n.photoIds.length === 1 && n.photoIds[0] === photoId); }
const maxNote = () => (state.limits ? state.limits.maxNoteChars : 500);

function noteBox(initial, onSave, id) {
  const tech = state.draft && state.draft.kind === 'instruction';
  const ta = h('textarea', { rows: 2, placeholder: (tech ? 'Деталь, інструмент, момент складання… (до ' : 'Що на кадрі? (до ') + maxNote() + ' символів)', id });
  ta.value = initial || '';
  const cnt = h('div', { class: 'counter' });
  const upd = () => { const n = chars(ta.value); cnt.textContent = `${n} / ${maxNote()}`; cnt.className = 'counter' + (n > maxNote() ? ' over' : ''); return n; };
  upd(); let t;
  ta.addEventListener('focus', () => { state.editing = true; });
  ta.addEventListener('input', () => { if (upd() <= maxNote()) { clearTimeout(t); t = setTimeout(() => onSave(ta.value), 700); } });
  ta.addEventListener('blur', () => { clearTimeout(t); if (upd() <= maxNote()) onSave(ta.value); endEditing(); });
  return h('div', null, ta, cnt);
}

function saveNote(photoId, text) { return serial(async () => {
  const cur = noteFor(photoId);
  if ((cur ? cur.text : '') === text) return;
  try {
    if (!text.trim()) { if (cur) { const r = await api('DELETE', `/drafts/${state.draft.draftId}/notes/${cur.noteId}`); state.draft = r.draft; } return; }
    const r = await api('PUT', `/drafts/${state.draft.draftId}/notes/${cur ? cur.noteId : 'n-' + photoId}`, { photoIds: [photoId], text });
    const rest = (state.draft.notes || []).filter((n) => n.noteId !== r.note.noteId);
    state.draft.notes = [...rest, r.note]; state.draft.revision = r.revision;
  } catch (e) { toast(e.message); }
}); }

function movePhoto(photoId, delta, toIndex) { return serial(async () => {
  const ids = state.draft.photos.slice().sort((a, b) => a.order - b.order).map((p) => p.photoId);
  const from = ids.indexOf(photoId); const to = toIndex != null ? toIndex : from + delta;
  if (from < 0 || to < 0 || to >= ids.length || to === from) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, photoOrder: ids })).draft; }
  catch (e) { toast(e.kind === 'revision_conflict' ? 'Чернетку змінено з іншого пристрою — оновлюю.' : e.message); await reloadDraft(); }
  render();
}); }

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
  if (d.status === 'submitted') { box.append(viewSubmitted(d)); box.append(photosSection(d, mine, true)); return box; }
  const onFiles = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  box.append(h('div', { class: 'shoot' },
    h('label', { class: 'btn primary', for: 'file-cam', id: 'lbl-cam', text: '📷 Зняти' }),
    h('label', { class: 'btn', for: 'file-gal', id: 'lbl-gal', text: 'З галереї' }),
    h('input', { type: 'file', id: 'file-cam', accept: 'image/*', capture: 'environment', onchange: onFiles }),
    h('input', { type: 'file', id: 'file-gal', accept: 'image/*', multiple: true, onchange: onFiles })));
  if (d.kind === 'instruction') box.append(viewInstructionMeta(d));
  if (d.kind === 'course' || d.kind === 'instruction') box.append(viewActions(d, mine));
  if (d.structure) box.append(viewStructure(d));
  box.append(photosSection(d, mine, false));
  return box;
}

function photosSection(d, mine, readOnly) {
  const photos = d.photos.slice().sort((a, b) => a.order - b.order);
  const list = h('div', { class: 'frames', id: 'frames' });
  photos.forEach((p, i) => list.append(photoCard(p, i, photos.length)));
  mine.forEach((q) => list.append(queuedCard(q)));
  if (!photos.length && !mine.length) list.append(h('p', { class: 'muted', text: 'Знімайте кроки по порядку. Кожен кадр опишеться автоматично; свій опис можна дописати.' }));
  if (!d.structure) return h('div', null, h('h3', { text: 'Кадри' }), list);
  const det = h('details', { id: 'photos-section' }, h('summary', { text: `Кадри (${photos.length})` }), list);
  if (state.photosOpen) det.setAttribute('open', '');
  det.addEventListener('toggle', () => { state.photosOpen = det.open; });
  return det;
}

/* ---------- етап 3: структура, текст, перевірка, відправка ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Правки чернетки йдуть по черзі: кожна бере свіжу ревізію, тож швидкі дії підряд не б'ються об revision_conflict. */
let saveChain = Promise.resolve();
const serial = (fn) => { const run = saveChain.then(fn, fn); saveChain = run.catch(() => {}); return run; };
const pollMs = () => (state.limits ? state.limits.pollIntervalMs : 2000);
const JOB_TEXT = { structure: 'ШІ розкладає кадри на кроки…', generate: 'ШІ пише текст…' };

function confirmBtn(label, confirmLabel, fn, props) {
  const b = h('button', Object.assign({ text: label }, props || {}));
  let armed = false, t;
  b.addEventListener('click', () => {
    if (!armed) { armed = true; b.textContent = confirmLabel; b.classList.add('danger'); t = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('danger'); }, 4000); return; }
    clearTimeout(t); armed = false; fn();
  });
  return b;
}

function viewActions(d, mine) {
  const box = h('div', { class: 'card', id: 'actions' });
  const job = d.job;
  const running = !!(job && job.status === 'running');
  const photosBusy = d.photos.some((p) => p.status === 'processing');
  const unsent = mine.length > 0;
  const lock = running || state.writing || photosBusy || unsent || !d.photos.length;
  if (running) box.append(h('p', { class: 'row', id: 'job-banner' }, h('span', { class: 'badge processing', text: 'працює' }), h('span', { text: (JOB_TEXT[job.kind] || 'ШІ працює…') + (job.moduleId ? ' ' + moduleTitle(d, job.moduleId) : '') })));
  if (job && job.status === 'failed') box.append(h('p', { class: 'err', id: 'job-error', text: job.error || 'Фонова робота не вдалася. Спробуйте ще раз.' }));
  if (!d.photos.length) box.append(h('p', { class: 'muted', text: 'Спершу додайте кадри.' }));
  else if (photosBusy || unsent) box.append(h('p', { class: 'muted', text: unsent ? 'Дочекайтесь, поки всі кадри надішлються.' : 'Кадри ще описуються…' }));
  const row = h('div', { class: 'row' });
  const mods = d.structure ? d.structure.modules : [];
  const left = mods.filter((m) => !m.written);
  if (!d.structure) row.append(h('button', { class: 'primary', id: 'btn-structure', text: d.kind === 'instruction' ? 'Розкласти на кроки' : 'Розкласти на уроки', disabled: lock, onclick: () => doStructure(false) }));
  else if (d.status === 'collecting') {
    box.append(h('p', { class: 'muted', id: 'stale-note', text: 'Після розкладання додано чи змінено кадри — розкладіть уроки заново.' }));
    row.append(confirmBtn('Розкласти заново', 'Так, правки в структурі зникнуть', () => doStructure(true), { disabled: lock, id: 'btn-restructure', class: 'primary' }));
  } else {
    if (d.status !== 'written') row.append(h('button', { class: 'primary', id: 'btn-write', text: (d.kind === 'instruction' ? left.length === mods.length ? 'Написати кроки' : 'Дописати кроки' : left.length === mods.length ? 'Написати курс' : 'Дописати курс'), disabled: lock || !left.length, onclick: () => writeModules(left.map((m) => m.moduleId)) }));
    if (left.length === 0 || d.status === 'written') row.append(h('button', { class: 'primary', id: 'btn-submit', text: d.kind === 'course' ? 'Відправити курс у Studio' : 'Відправити в Studio', disabled: lock, onclick: doSubmit }));
    const again = confirmBtn('Розкласти заново', 'Так, правки в структурі зникнуть', () => doStructure(true), { disabled: lock, id: 'btn-restructure' });
    row.append(again);
  }
  if (state.writing) row.append(h('span', { class: 'muted', text: 'Пишемо… можна лишитись на сторінці' }));
  box.append(row);
  if (state.blockers) {
    box.append(h('div', { class: 'err', id: 'blockers' }, h('strong', { text: 'Ще не готово до відправки:' }),
      h('ul', null, state.blockers.map((b) => h('li', { 'data-blocker': b.kind, text: b.message })))));
  }
  return box;
}
function moduleTitle(d, id) { const m = d.structure && d.structure.modules.find((x) => x.moduleId === id); return m ? `«${m.title}»` : ''; }

async function waitJobDone() {
  for (;;) {
    await sleep(pollMs());
    await reloadDraft();
    const j = state.draft && state.draft.job;
    if (!j || j.status !== 'running') return;
  }
}
async function runJob(startFn) {
  state.blockers = null;
  try { const r = await startFn(); state.draft = r.draft; render(); }
  catch (e) { if (e.kind !== 'job_running') { toast(e.message); return false; } }
  await waitJobDone();
  const j = state.draft.job;
  if (j && j.status === 'failed') { toast(j.error || 'Фонова робота не вдалася.'); return false; }
  return true;
}
async function doStructure(replace) {
  const id = state.draft.draftId;
  state.writing = true; render();
  try { await runJob(() => api('POST', `/drafts/${id}/structure`, replace ? { replace: true } : undefined)); }
  finally { state.writing = false; render(); }
}
async function writeModules(ids) {
  if (state.writing) return;
  state.writing = true; render();
  try {
    for (const mid of ids) {
      const id = state.draft.draftId;
      if (!(await runJob(() => api('POST', `/drafts/${id}/modules/${mid}/generate`)))) break;
    }
  } finally { state.writing = false; render(); }
}
async function doSubmit() {
  state.blockers = null;
  try {
    const r = await api('POST', `/drafts/${state.draft.draftId}/submit`);
    state.draft = r.draft; state.target = r.target; toast('Відправлено в Studio.');
  } catch (e) {
    if (e.kind === 'submit_blocked') state.blockers = e.blockers || [{ kind: 'x', message: e.message }];
    else if (e.kind === 'wrong_status') await reloadDraft();
    else toast(e.message);
  }
  render();
}

function viewSubmitted(d) {
  const t = d.submitted || state.target;
  const href = t ? state.studioOrigin + t.studioUrl : '#';
  return h('div', { class: 'card', id: 'submitted' },
    h('h2', { text: 'Відправлено в Studio' }),
    h('p', { text: t && t.kind === 'course' ? 'Чернетку курсу створено — ціну, категорію й відео додасте в Studio.' : t && t.kind === 'express' ? 'Експрес-чернетку створено. Відкрийте її в Studio протягом 24 годин — потім вона зникне.' : 'Готово.' }),
    h('p', null, h('a', { class: 'btn primary', id: 'open-studio', href, target: '_blank', rel: 'noopener', text: 'Відкрити в Studio' })));
}

function lessonField(d, les, field, label, multiline) {
  const maxLen = field === 'body' && state.limits ? state.limits.maxLessonBodyChars : 0;
  const el = multiline ? h('textarea', { rows: field === 'body' ? 8 : 2, 'data-field': field }) : h('input', { 'data-field': field });
  el.value = les[field] || '';
  const cnt = maxLen ? h('div', { class: 'counter' }) : null;
  const upd = () => { if (cnt) { const n = chars(el.value); cnt.textContent = `${n} / ${maxLen}`; cnt.className = 'counter' + (n > maxLen ? ' over' : ''); } };
  upd();
  el.addEventListener('focus', () => { state.editing = true; });
  el.addEventListener('input', upd);
  el.addEventListener('blur', async () => {
    const v = el.value;
    if (v !== (les[field] || '') && (!maxLen || chars(v) <= maxLen)) {
      await saveLesson(les.lessonId, { [field]: v });
      if (ai && !aiStill()) ai.remove(); // поле тепер викладача — без повного перемальовування (не збити Tab)
    }
    endEditing();
  });
  const aiStill = () => { const m = state.draft.structure.modules.flatMap((x) => x.lessons).find((x) => x.lessonId === les.lessonId); return !!m && m.aiFields.includes(field); };
  const ai = (les.aiFields || []).includes(field) && h('span', { class: 'badge ai', text: 'ШІ — перевірте' });
  const chips = d.kind === 'instruction' && field === 'body' ? stepLineChips(el, les.body) : null;
  return h('div', null, h('label', null, label, ' ', ai || ''), el, chips, cnt);
}
function saveLesson(lessonId, fields) { return serial(async () => {
  try {
    const r = await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, lessons: [{ lessonId, ...fields }] });
    state.draft = r.draft; state.blockers = null;
  } catch (e) { toast(e.kind === 'revision_conflict' ? 'Чернетку змінено з іншого пристрою — оновлюю.' : e.message); await reloadDraft(); }
}); }
function setAssumption(id, status) { return serial(async () => {
  try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, assumptions: [{ assumptionId: id, status }] })).draft; state.blockers = null; }
  catch (e) { toast(e.message); await reloadDraft(); }
  render();
}); }

const TERMS = {
  course: { structure: 'Структура курсу', lesson: 'Урок', title: 'Назва уроку', goal: 'Мета', body: 'Текст уроку' },
  instruction: { structure: 'Кроки інструкції', lesson: 'Крок', title: 'Назва кроку', goal: 'Мета кроку', body: 'Опис кроку' },
};
const termsFor = (d) => TERMS[d.kind] || TERMS.course;
const STEP_LINES = ['Деталі', 'Інструменти', 'Увага', 'Результат кроку'];
const MAX_SOURCE_STEPS = 20; // Studio робить кроки-джерела з перших 20; решта дописується до останнього
const hasLine = (text, key) => new RegExp('^\\*\\*' + key + ':\\*\\*', 'm').test(text || '');

/* Інструкція: режим і код виробу (PATCH instructionMode / modelCode) */
function viewInstructionMeta(d) {
  const mode = h('select', { id: 'i-mode' }, h('option', { value: 'assembly', text: 'Складання' }), h('option', { value: 'operation', text: 'Користування' }));
  mode.value = d.instructionMode || 'assembly';
  const model = h('input', { id: 'i-model', maxlength: 200, placeholder: 'Код або модель виробу', value: d.modelCode || '' });
  const save = (fields) => serial(async () => {
    try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, ...fields })).draft; state.blockers = null; }
    catch (e) { toast(e.kind === 'revision_conflict' ? 'Чернетку змінено з іншого пристрою — оновлюю.' : e.message); await reloadDraft(); }
  });
  mode.addEventListener('change', () => save({ instructionMode: mode.value }));
  model.addEventListener('focus', () => { state.editing = true; });
  model.addEventListener('blur', async () => { const v = model.value.trim(); if (v !== (state.draft.modelCode || '')) await save({ modelCode: v }); endEditing(); });
  return h('div', { class: 'card', id: 'instruction-meta' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { text: 'Що описуємо' }), mode), h('div', { class: 'grow' }, h('label', { text: 'Код або модель виробу' }), model)),
    h('p', { class: 'muted', text: 'Кожен крок спирається на свої кадри. Деталі, інструменти, застереження й результат пишіть окремими рядками — Studio розкладе їх по полях кроку.' }));
}

/* Перенесення кадра в інший крок: PATCH structure (замінює структуру повністю, незмінені поля лишаються «від ШІ») */
function moveFrame(photoId, toLessonId) { return serial(async () => {
  const order = new Map(state.draft.photos.map((p) => [p.photoId, p.order]));
  const mods = JSON.parse(JSON.stringify(state.draft.structure.modules));
  for (const m of mods) for (const l of m.lessons) l.photoIds = l.photoIds.filter((x) => x !== photoId);
  const target = mods.flatMap((m) => m.lessons).find((l) => l.lessonId === toLessonId);
  if (!target) return;
  target.photoIds.push(photoId); target.photoIds.sort((x, y) => order.get(x) - order.get(y));
  const structure = { modules: mods.map((m) => ({ moduleId: m.moduleId, title: m.title, summary: m.summary, lessons: m.lessons.map((l) => ({ lessonId: l.lessonId, title: l.title, goal: l.goal, photoIds: l.photoIds, body: l.body, topics: l.topics })) })) };
  try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, structure })).draft; state.blockers = null; }
  catch (e) { toast(e.kind === 'revision_conflict' ? 'Чернетку змінено з іншого пристрою — оновлюю.' : e.message); await reloadDraft(); }
  render();
}); }

function stepFrames(d, les) {
  const byId = new Map(d.photos.map((p) => [p.photoId, p]));
  const steps = d.structure.modules.flatMap((m) => m.lessons);
  const wrap = h('div', { class: 'thumbs big' });
  les.photoIds.forEach((id) => {
    const p = byId.get(id); if (!p) return;
    const sel = h('select', { class: 'move', 'data-move': id, title: 'Перенести кадр в інший крок' }, h('option', { value: '', text: `Кадр ${p.order} →` }),
      steps.filter((x) => x.lessonId !== les.lessonId).map((x) => h('option', { value: x.lessonId, text: 'в «' + (x.title || x.lessonId).slice(0, 30) + '»' })));
    sel.addEventListener('change', () => { if (sel.value) moveFrame(id, sel.value); });
    wrap.append(h('div', { class: 'frame-chip' }, h('img', { src: `/api/drafts/${d.draftId}/photos/${id}/image`, alt: 'Кадр ' + p.order, loading: 'lazy' }), sel));
  });
  if (!les.photoIds.length) wrap.append(h('p', { class: 'err', 'data-nofram': les.lessonId, text: 'У кроку немає кадру — перенесіть сюди кадр з іншого кроку.' }));
  return wrap;
}

function stepLineChips(ta, body) {
  const row = h('div', { class: 'row chips', 'data-chips': '' });
  const refresh = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', hasLine(ta.value, b.dataset.key)));
  STEP_LINES.forEach((k) => {
    const b = h('button', { type: 'button', class: 'small chip', 'data-key': k, text: (hasLine(body, k) ? '✓ ' : '+ ') + k, onclick: () => {
      if (!hasLine(ta.value, k)) { ta.value = (ta.value && !ta.value.endsWith('\n') ? ta.value + '\n' : ta.value) + `**${k}:** `; ta.dispatchEvent(new Event('input')); }
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    } });
    row.append(b);
  });
  const mark = () => row.querySelectorAll('button').forEach((b) => { const on = hasLine(ta.value, b.dataset.key); b.textContent = (on ? '✓ ' : '+ ') + b.dataset.key; b.classList.toggle('on', on); });
  ta.addEventListener('input', mark); mark();
  return row;
}

function viewStructure(d) {
  const box = h('div', { id: 'structure' });
  const T = termsFor(d);
  box.append(h('h3', { text: T.structure }));
  const stepCount = d.structure.modules.reduce((n, m) => n + m.lessons.length, 0);
  if (d.kind === 'instruction' && stepCount > MAX_SOURCE_STEPS) box.append(h('p', { class: 'muted', id: 'steps-over', text: `Кроків ${stepCount}: Studio зробить джерелами перші ${MAX_SOURCE_STEPS}, решту допише до останнього.` }));
  const open = d.assumptions.filter((a) => a.status === 'open');
  if (d.assumptions.length) {
    box.append(h('div', { class: 'card', id: 'assumptions' }, h('strong', { text: 'ШІ припустив — підтвердьте або відхиліть' }),
      d.assumptions.map((a) => h('div', { class: 'row', 'data-assumption': a.assumptionId, style: 'margin-top:8px' },
        h('span', { class: 'grow', text: a.text }),
        h('span', { class: 'badge ' + (a.status === 'open' ? 'processing' : a.status === 'confirmed' ? 'described' : 'failed'), text: { open: 'очікує', confirmed: 'підтверджено', rejected: 'відхилено' }[a.status] }),
        a.status !== 'confirmed' && h('button', { class: 'small', 'data-act': 'confirm', text: 'Підтвердити', onclick: () => setAssumption(a.assumptionId, 'confirmed') }),
        a.status !== 'rejected' && h('button', { class: 'small', 'data-act': 'reject', text: 'Відхилити', onclick: () => setAssumption(a.assumptionId, 'rejected') })))));
  }
  const byId = new Map(d.photos.map((p) => [p.photoId, p]));
  d.structure.modules.forEach((m, mi) => {
    const running = d.job && d.job.status === 'running' && d.job.moduleId === m.moduleId;
    const card = h('div', { class: 'card', 'data-module': m.moduleId },
      h('div', { class: 'row' }, h('strong', { class: 'grow', text: `${mi + 1}. ${m.title}` }),
        h('span', { class: 'badge ' + (m.written ? 'described' : running ? 'processing' : ''), text: m.written ? 'текст є' : running ? 'пишеться…' : 'без тексту' }),
        h('button', { class: 'small', text: m.written ? 'Переписати' : 'Написати', disabled: state.writing || !!(d.job && d.job.status === 'running'), onclick: () => writeModules([m.moduleId]) })),
      m.summary && h('p', { class: 'muted', text: m.summary }));
    m.lessons.forEach((les) => {
      card.append(h('div', { class: 'lesson', 'data-lesson': les.lessonId },
        d.kind === 'instruction' ? stepFrames(d, les) : h('div', { class: 'thumbs' }, les.photoIds.map((id) => byId.has(id) && h('img', { src: `/api/drafts/${d.draftId}/photos/${id}/image`, alt: '', loading: 'lazy' }))),
        lessonField(d, les, 'title', T.title, false),
        lessonField(d, les, 'goal', T.goal, true),
        lessonField(d, les, 'body', T.body, true)));
    });
    box.append(card);
  });
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
  try { state.studioOrigin = new URL((await api('GET', '/config')).studioUrl).origin; } catch (e) { /* без посилання */ }
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
