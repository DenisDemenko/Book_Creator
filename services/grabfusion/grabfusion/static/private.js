'use strict';
/* GrabFusion — приватний шлях «на моєму сервері» (журнал #550).
   Знімки шифруються НА ТЕЛЕФОНІ відкритим ключем локального сервера автора (sealed.js) і йдуть до нього через Studio, яка
   бачить лише шифротекст. Розпізнає (Tesseract чи Ollama) і перевіряє текст сам сервер на комп'ютері автора. Чернеток у Studio немає:
   тут лише локальні чернетки телефона й стан доставки кожного знімка. Використовує h, state, api, go, render, toast, downscale з app.js. */

const PRIVATE_KINDS = { course: 'Курс', instruction: 'Інструкція', manuscript: 'Книга' };
const PRIVATE_STATE = { queued: 'в черзі', sending: 'надсилається', sent: 'у Studio, чекає сервер', delivered: 'забрано сервером', failed: 'не надіслано', expired: 'не забрано за 72 год' };
const PRIVATE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
let privateFlushing = false, privatePollTimer = null;

/* ---------- сховище телефона: чернетки й знімки (IndexedDB, запасний варіант — памʼять) ---------- */
const pmem = { drafts: new Map(), items: new Map() };
let pdbp = null;
function pdb() {
  if (!pdbp) pdbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('grabfusion-private', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('drafts', { keyPath: 'draftId' });
        const items = r.result.createObjectStore('items', { keyPath: 'itemId' });
        items.createIndex('draft', 'draftId');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }).catch(() => null);
  return pdbp;
}
function ptx(store, mode, fn) {
  return pdb().then((d) => d ? new Promise((res, rej) => { const t = d.transaction(store, mode); const r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }) : null);
}
const pDrafts = async () => ((await ptx('drafts', 'readonly', (s) => s.getAll())) || [...pmem.drafts.values()]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const pItems = async (draftId) => ((await ptx('items', 'readonly', (s) => s.index('draft').getAll(draftId))) || [...pmem.items.values()].filter((i) => i.draftId === draftId)).sort((a, b) => a.order - b.order);
const pAllItems = async () => (await ptx('items', 'readonly', (s) => s.getAll())) || [...pmem.items.values()];
const pPutDraft = async (d) => { pmem.drafts.set(d.draftId, d); await ptx('drafts', 'readwrite', (s) => s.put(d)).catch(() => {}); };
const pPutItem = async (i) => { pmem.items.set(i.itemId, i); await ptx('items', 'readwrite', (s) => s.put(i)).catch(() => {}); };
const pDelItem = async (id) => { pmem.items.delete(id); await ptx('items', 'readwrite', (s) => s.delete(id)).catch(() => {}); };
async function pDelDraft(draftId) {
  for (const i of await pItems(draftId)) await pDelItem(i.itemId);
  pmem.drafts.delete(draftId);
  await ptx('drafts', 'readwrite', (s) => s.delete(draftId)).catch(() => {});
}

/* ---------- чи доступний приватний шлях ---------- */
const privateStoreReady = () => (state.privateStores || []).filter((s) => s.inbox && s.inboxKey);
const privateAvailableFor = (kind, courseSource) => privateStoreReady().length > 0 && !(kind === 'course' && courseSource === 'photos');
const newDraftId = () => 'pd_' + NovaSealed.newItemId().slice(0, 12).replace(/[^A-Za-z0-9]/g, 'x');

/* ---------- створення локальної чернетки ---------- */
async function startPrivateDraft(body, storeId) {
  const store = privateStoreReady().find((s) => s.id === storeId) || privateStoreReady()[0];
  if (!store) throw new Error('Для вас немає локального сервера, що приймає знімки. Його підключає адміністратор Studio.');
  const draft = Object.assign({ draftId: newDraftId(), storeId: store.id, storeName: store.name, createdAt: new Date().toISOString() }, body);
  await pPutDraft(draft);
  state.privateDraft = draft;
  state.privateItems = [];
  go('private-draft');
}

async function openPrivateDraft(draftId) {
  const draft = (await pDrafts()).find((d) => d.draftId === draftId);
  if (!draft) { toast('Чернетку не знайдено.'); return; }
  state.privateDraft = draft;
  state.privateItems = await pItems(draftId);
  go('private-draft');
  schedulePrivatePoll();
  void flushPrivate();
}

/* ---------- додавання знімків ---------- */
async function addPrivateFiles(files) {
  const draft = state.privateDraft;
  if (!draft || !files.length) return;
  const side = state.limits ? state.limits.recommendedMaxSidePx : 2048;
  let order = state.privateItems.reduce((m, i) => Math.max(m, i.order), 0);
  for (const f of files) {
    const blob = await downscale(f, side);
    const mime = (blob.type || f.type || '').toLowerCase();
    const bad = PRIVATE_MIMES.indexOf(mime) < 0;
    order += 1;
    const item = { itemId: NovaSealed.newItemId(), draftId: draft.draftId, order, blob, mime, bytes: blob.size, state: bad ? 'failed' : 'queued',
      error: bad ? 'Формат не підтримується (наприклад HEIC). У налаштуваннях камери оберіть «Найсумісніший» і зніміть ще раз.' : '', createdAt: new Date().toISOString() };
    await pPutItem(item); state.privateItems.push(item);
  }
  render(true); void flushPrivate();
}

/* ---------- запечатати й надіслати ---------- */
function privateHeader(draft, item) {
  const h0 = { v: 1, draftId: draft.draftId, kind: draft.kind, order: item.order, mime: item.mime, clientId: item.itemId };
  for (const k of ['courseSource', 'instructionMode', 'modelCode', 'title', 'craft', 'audience', 'newBookTitle']) if (draft[k]) h0[k] = draft[k];
  return h0;
}

async function sendPrivateItem(draft, item) {
  const store = (state.privateStores || []).find((s) => s.id === draft.storeId);
  if (!store || !store.inboxKey) throw Object.assign(new Error('Сервер не приймає знімки (немає ключа). Спробуйте пізніше.'), { retry: false });
  const plain = NovaSealed.encodePayload(privateHeader(draft, item), new Uint8Array(await item.blob.arrayBuffer()));
  const sealed = await NovaSealed.seal(store.inboxKey, plain, NovaSealed.aadFor(draft.storeId, item.itemId));
  let resp;
  try {
    resp = await fetch('api/private-inbox/' + encodeURIComponent(draft.storeId) + '/' + encodeURIComponent(item.itemId), {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: sealed,
    });
  } catch (e) { throw Object.assign(new Error('Немає звʼязку.'), { retry: true }); }
  let data = null;
  try { data = await resp.json(); } catch (e) { /* не JSON */ }
  if (resp.status === 401) { state.user = null; go('pair'); throw Object.assign(new Error('Потрібно підключитись заново.'), { retry: false, stop: true }); }
  if (resp.ok) return data;
  const retry = resp.status >= 500 || resp.status === 429;
  throw Object.assign(new Error((data && data.error) || 'Помилка сервера.'), { retry, status: resp.status });
}

async function flushPrivate() {
  if (privateFlushing) return;
  privateFlushing = true;
  let retryIn = 0;
  try {
    const items = (await pAllItems()).filter((i) => i.state === 'queued').sort((a, b) => a.order - b.order);
    const drafts = new Map((await pDrafts()).map((d) => [d.draftId, d]));
    // Ключ скриньки міг змінитись (сервер перевстановлено): беремо актуальний перед відправкою, інакше конверт не розшифрується.
    if (items.length) { try { state.privateStores = (await api('GET', '/private-stores')).stores || state.privateStores; } catch (e) { /* лишаємо відомий ключ */ } }
    for (const it of items) {
      const draft = drafts.get(it.draftId);
      if (!draft) continue;
      it.state = 'sending'; await pPutItem(it); if (state.view === 'private-draft') render();
      try {
        await sendPrivateItem(draft, it);
        it.state = 'sent'; it.error = ''; it.sentAt = new Date().toISOString();
      } catch (e) {
        if (e.stop) { it.state = 'queued'; await pPutItem(it); break; }
        if (e.retry) { it.state = 'queued'; it.error = e.message; retryIn = e.status === 429 ? 60000 : 8000; await pPutItem(it); break; }
        it.state = 'failed'; it.error = e.message;
      }
      await pPutItem(it);
      if (state.privateDraft && state.privateDraft.draftId === it.draftId) state.privateItems = await pItems(it.draftId);
      if (state.view === 'private-draft') render();
    }
  } finally { privateFlushing = false; }
  if (retryIn) setTimeout(flushPrivate, retryIn);
  schedulePrivatePoll();
}

/* Стан доставки: «у Studio, чекає сервер» → «забрано сервером» (Studio видаляє шифротекст після підтвердження сервера). */
function schedulePrivatePoll() {
  clearTimeout(privatePollTimer);
  privatePollTimer = setTimeout(pollPrivate, 7000);
}
async function pollPrivate() {
  const draft = state.privateDraft;
  if (state.view !== 'private-draft' || !draft) return;
  const sent = (await pItems(draft.draftId)).filter((i) => i.state === 'sent');
  let changed = false;
  for (const it of sent.slice(0, 40)) {
    try {
      const r = await api('GET', '/private-inbox/' + encodeURIComponent(draft.storeId) + '/' + encodeURIComponent(it.itemId));
      if (r.state === 'delivered' || r.state === 'expired') {
        it.state = r.state; if (r.state === 'delivered') { it.blob = null; } await pPutItem(it); changed = true;
      } else if (r.state === 'unknown') { it.state = 'queued'; await pPutItem(it); changed = true; }
    } catch (e) { if (e.kind === 'network') break; }
  }
  if (changed) { state.privateItems = await pItems(draft.draftId); render(); void flushPrivate(); }
  if (state.view === 'private-draft' && (state.privateItems || []).some((i) => i.state === 'sent' || i.state === 'queued' || i.state === 'sending')) schedulePrivatePoll();
}

/* ---------- екрани ---------- */
function privateBadge(it) {
  return h('span', { class: 'badge ' + (it.state === 'delivered' ? 'described' : it.state === 'failed' || it.state === 'expired' ? 'failed' : 'queued'), 'data-private-state': it.state, text: PRIVATE_STATE[it.state] || it.state });
}

function viewPrivateDraft() {
  const d = state.privateDraft;
  const items = state.privateItems || [];
  const box = h('div', { id: 'private-draft' });
  const store = (state.privateStores || []).find((s) => s.id === d.storeId);
  const delivered = items.filter((i) => i.state === 'delivered').length;
  box.append(h('p', { class: 'muted', text: [PRIVATE_KINDS[d.kind], d.title, d.craft, d.audience].filter(Boolean).join(' · ') + ` · знімків: ${items.length}` + (delivered ? `, забрано сервером: ${delivered}` : '') }));
  box.append(h('div', { class: 'card', id: 'private-note' },
    h('strong', { text: '🔒 Приватна чернетка: на ваш локальний сервер' }),
    h('p', { class: 'muted', text: `Знімки шифруються на цьому телефоні ключем вашого сервера «${d.storeName}» і йдуть до нього через Studio, яка бачить лише шифротекст. Розпізнає й перевіряє текст сам сервер на вашому комп'ютері: ШІ у хмарі не залучається.` }),
    h('p', { class: 'muted', text: 'Далі: на компʼютері відкрийте Studio → «Приватні матеріали» → «З телефона» — там розпізнаний текст, перевірка й створення ' + (d.kind === 'course' ? 'курсу' : d.kind === 'instruction' ? 'інструкції' : 'книги') + '.' }),
    store && !store.online ? h('p', { class: 'err', id: 'private-offline', text: 'Сервер зараз не на звʼязку. Знімки лежатимуть у Studio в зашифрованому вигляді до 72 годин — увімкніть компʼютер із сервером, і він їх забере.' }) : null));
  const onFiles = (e) => { addPrivateFiles([...e.target.files]); e.target.value = ''; };
  box.append(h('div', { class: 'shoot' },
    h('label', { class: 'btn primary', for: 'pfile-cam', id: 'plbl-cam', text: '📷 Зняти' }),
    h('label', { class: 'btn', for: 'pfile-gal', id: 'plbl-gal', text: 'З галереї' }),
    h('input', { type: 'file', id: 'pfile-cam', accept: 'image/*', capture: 'environment', onchange: onFiles }),
    h('input', { type: 'file', id: 'pfile-gal', accept: 'image/*', multiple: true, onchange: onFiles })));
  const list = h('div', { class: 'frames', id: 'pframes' });
  if (!items.length) list.append(h('p', { class: 'muted', text: 'Скануйте або фотографуйте сторінки по порядку. Кожен знімок одразу шифрується й надсилається.' }));
  items.forEach((it, i) => {
    const url = it.blob ? (state.urls.has(it.itemId) ? state.urls.get(it.itemId) : (state.urls.set(it.itemId, URL.createObjectURL(it.blob)), state.urls.get(it.itemId))) : null;
    list.append(h('div', { class: 'card frame', 'data-private-item': it.itemId },
      url ? h('img', { src: url, alt: 'Знімок ' + (i + 1) }) : h('div', { class: 'muted', text: '✓' }),
      h('div', null,
        h('strong', { text: (d.kind === 'manuscript' || d.kind === 'course' ? 'Сторінка ' : 'Знімок ') + (i + 1) }),
        h('div', null, privateBadge(it), it.state === 'failed' || (it.state === 'queued' && it.error) ? h('div', { class: 'err', text: it.error }) : null),
        h('div', { class: 'row' },
          it.state === 'failed' || it.state === 'expired' ? h('button', { class: 'small', text: 'Спробувати ще', onclick: async () => { if (!it.blob) return; it.state = 'queued'; it.error = ''; await pPutItem(it); render(true); void flushPrivate(); } }) : null,
          it.state === 'queued' || it.state === 'failed' ? h('button', { class: 'small danger', text: 'Прибрати', onclick: async () => { await pDelItem(it.itemId); state.privateItems = await pItems(d.draftId); render(true); } }) : null))));
  });
  box.append(h('h3', { text: 'Знімки' }), list);
  box.append(h('p', { class: 'row' },
    h('button', { id: 'private-done', text: 'Готово', onclick: async () => { await openPrivateList(); } }),
    h('button', { class: 'small danger', id: 'private-delete', text: 'Видалити чернетку з телефона', onclick: async () => {
      if (!window.confirm('Прибрати цю чернетку з телефона? Те, що вже забрав сервер, лишається на сервері.')) return;
      await pDelDraft(d.draftId); state.privateDraft = null; await openPrivateList();
    } })));
  return box;
}

async function openPrivateList() {
  state.privateDrafts = await pDrafts();
  state.privateDraft = null;
  go('list');
}

/* Блок у списку чернеток: приватні чернетки цього телефона. */
function privateListSection() {
  const drafts = state.privateDrafts || [];
  if (!drafts.length) return null;
  const box = h('div', { id: 'private-list' }, h('h3', { text: '🔒 Приватні (на мій сервер)' }));
  for (const d of drafts) {
    box.append(h('div', { class: 'card row', 'data-private-draft': d.draftId },
      h('div', { class: 'grow' }, h('strong', { text: d.title || 'Без назви' }), h('div', { class: 'muted', text: `${PRIVATE_KINDS[d.kind]} · сервер «${d.storeName}»` })),
      h('button', { text: 'Відкрити', onclick: () => openPrivateDraft(d.draftId) })));
  }
  return box;
}
