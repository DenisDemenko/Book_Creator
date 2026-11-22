'use strict';
/* GrabFusion — сторінка викладача (етап 2, MVP). Без фреймворків і збірки.
   Токена Studio тут немає: сервер тримає його в сесії (cookie httpOnly). */

const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const state = {
  view: 'boot', limits: null, drafts: [], draft: null, queue: [], user: null,
  online: navigator.onLine, urls: new Map(), editing: false, needsRender: false,
  studioOrigin: '', hint: '', writing: false, blockers: null, target: null, photosOpen: true,
  ai: null, // вибір моделі ШІ й бали за прохід (контракт 1.4.0), див. loadAi
  privateStores: [], // локальні сервери приватного сховища автора (стан і ключ скриньки, журнал #549/#550)
  privateDraft: null, privateItems: [], privateDrafts: [], // приватні чернетки цього телефона (private.js)
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
    resp = await fetch('api' + path, {
      method, credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (e) { throw new ApiError('network', tr('Немає звʼязку.'), 0); }
  let data = null;
  try { data = await resp.json(); } catch (e) { /* не JSON */ }
  if (!resp.ok) {
    const kind = data?.kind || 'server_error';
    const message = data?.error || 'Помилка сервера.';
    const err = new ApiError(kind, grabApiMessage(kind, message), resp.status, { blockers: data?.blockers });
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
  document.getElementById('btn-back').hidden = view !== 'draft' && view !== 'private-draft';
  document.getElementById('btn-logout').hidden = !state.user;
  render();
}
function render(force) {
  if (force) state.editing = false; // дія користувача (напр. нові фото) важливіша за відкладення; зайнятий елемент зникне разом із перемальовкою
  if (state.editing && state.view === 'draft') { state.needsRender = true; return; }
  state.needsRender = false;
  app.replaceChildren();
  const v = { pair: viewPair, choose: viewChoose, 'choose-course': viewChooseCourse, list: viewList, create: viewCreate, draft: viewDraft, 'private-draft': viewPrivateDraft, boot: () => h('p', { class: 'muted', text: tr('Завантаження…') }), offline: viewOffline }[state.view];
  titleEl.textContent = state.view === 'draft' && state.draft ? (state.draft.title || tr('Чернетка без назви')) : state.view === 'private-draft' && state.privateDraft ? (state.privateDraft.title || tr('Приватна чернетка')) : 'GrabFusion';
  app.append(v());
}
function setNet() { document.getElementById('net').hidden = state.online; }
addEventListener('online', () => { state.online = true; setNet(); flushQueue(); });
addEventListener('offline', () => { state.online = false; setNet(); });
document.getElementById('btn-back').addEventListener('click', () => (state.view === 'private-draft' ? openPrivateList() : openList()));
document.getElementById('btn-logout').addEventListener('click', async () => { await api('POST', '/logout').catch(() => {}); state.user = null; go('pair'); });
applyGrabLanguage();
document.getElementById('btn-language').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (state.view === 'draft' && document.activeElement !== button) document.activeElement?.blur();
    await saveChain;
    const view = state.view;
    const fields = view === 'create' || view === 'pair'
      ? [...app.querySelectorAll('input[id], select[id]')].map((field) => [field.id, field.value]) : [];
    toggleGrabLanguage();
    document.getElementById('toast').hidden = true;
    render(true);
    for (const [id, value] of fields) {
      const field = document.getElementById(id);
      if (!field || field.value === value) continue;
      field.value = value;
      if (field.tagName === 'SELECT') field.dispatchEvent(new Event('change'));
    }
  } finally { button.disabled = false; }
});

/* ---------- підключення ---------- */
/* Код з посилання QR: `#pair=ABCD-EFGH`. Фрагмент браузер нікуди не надсилає, тож код не потрапляє ні в проксі, ні в журнали, ні в Referer.
   Лише літери, цифри й дефіс (так його видає Studio); усе інше — не наш код. */
function pairCodeFromHash(hash) {
  const m = /^#pair=([A-Za-z0-9-]{4,32})$/.exec(hash || '');
  return m ? m[1] : null;
}

function viewPair() {
  const err = h('p', { class: 'err', id: 'pair-err' });
  // Невдалий вхід за QR (прострочений, уже використаний): пояснюємо тут, а ручний ввід лишається запасним шляхом.
  err.textContent = state.pairNotice || ''; state.pairNotice = '';
  const input = h('input', { id: 'code', placeholder: tr('Код підключення'), autocomplete: 'off', autocapitalize: 'characters' });
  const form = h('form', { class: 'card hero', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try {
      const r = await api('POST', '/pair', { code: input.value.trim() });
      state.user = r.user; await start({ chooseFirst: true });
    } catch (e2) { err.textContent = e2.message; }
  } },
    h('h2', { text: tr('Підключіть застосунок') }),
    h('p', { class: 'muted', text: tr('Введіть код підключення нижче. Його видає сторінка fusionlab.in.ua/grabfusion (кнопка «Отримати код») на комп’ютері. Або в Studio: Медіатека → Скани з телефону → «QR-код для входу в GrabFusion» — наведіть камеру, і застосунок підключиться сам. Код діє 5 хвилин.') }),
    h('label', { for: 'code', text: tr('Код') }), input, err,
    h('p', null, h('button', { class: 'primary', type: 'submit', text: tr('Підключити') })));
  return h('div', null, form, viewPairByEmail(input, err));
}

/* Не біля комп'ютера: код надсилається на пошту облікового запису (журнал #541). Відповідь Studio однакова, чи є такий обліковий запис. */
function viewPairByEmail(codeInput, codeErr) {
  let saved = '';
  try { saved = localStorage.getItem('gf_email') || ''; } catch (e) { /* приватний режим */ }
  const email = h('input', { id: 'pair-email', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', placeholder: tr('пошта вашого облікового запису') });
  email.value = saved;
  const note = h('p', { class: 'muted', id: 'pair-email-note' });
  const err = h('p', { class: 'err', id: 'pair-email-err' });
  const btn = h('button', { class: 'small', type: 'submit', id: 'btn-pair-email', text: tr('Надіслати код на пошту') });
  return h('form', { class: 'card', id: 'pair-email-form', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; note.textContent = '';
    const value = email.value.trim();
    if (!value) { err.textContent = tr('Введіть пошту, з якою ви входите у Fusion Lab.'); return; }
    btn.disabled = true;
    try {
      const r = await api('POST', '/pair/email', { email: value });
      try { localStorage.setItem('gf_email', value); } catch (e2) { /* не критично */ }
      note.textContent = (grabLanguage === 'en' ? tr('Якщо для цієї пошти є обліковий запис, ми надіслали лист із кодом.') : r.message) + tr(' Відкрийте лист на цьому телефоні: натисніть кнопку в листі або введіть код у поле вище.');
      codeInput.focus();
    } catch (e2) { err.textContent = e2.message; } finally { btn.disabled = false; }
  } },
    h('h3', { text: tr('Немає комп’ютера поруч?') }),
    h('p', { class: 'muted', text: tr('Введіть пошту свого облікового запису — ми надішлемо код підключення листом. Код діє 15 хвилин.') }),
    h('label', { for: 'pair-email', text: tr('Пошта') }), email, err, note,
    h('p', null, btn));
}

/* ---------- список чернеток ---------- */
async function openList() {
  state.draft = null;
  try { state.drafts = (await api('GET', '/drafts')).drafts; } catch (e) { toast(e.message); }
  state.privateDrafts = await pDrafts();
  go('list');
}
const KIND = { course: 'Курс', instruction: 'Інструкція', book: 'Глава книги', manuscript: 'Набір книги' };
/* Кадри — сторінки тексту (рукопис і курс зі скану документа, контракт 1.6.0): їх розпізнають дослівно, а не описують. Працює і з чернеткою, і з рядком переліку. */
const photoBook = (draft) => draft?.kind === 'book' && !!draft.newBookTitle;
const textPages = (d) => !!d && (d.kind === 'manuscript' || (d.kind === 'course' && d.courseSource === 'document'));
const kindLabel = (d) => photoBook(d) ? tr('Книга з фото') : (tr(KIND[d.kind]) || d.kind) + (d.kind === 'course' && d.courseSource === 'document' ? tr(' · скан документа') : '');
const STATUS = { collecting: 'збір кадрів', structured: 'є структура', written: 'текст написано', submitted: 'відправлено' };
function viewList() {
  const box = h('div');
  box.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, h('h2', { class: 'grow', text: tr('Чернетки') }),
    h('button', { class: 'primary', id: 'btn-new', text: tr('Нова чернетка'), onclick: () => go('choose') })));
  if (!state.drafts.length && !(state.privateDrafts || []).length) box.append(h('p', { class: 'muted', text: tr('Поки порожньо. Натисніть «Нова чернетка» й оберіть, що створюєте: інструкцію, курс або книгу.') }));
  for (const d of state.drafts) {
    const status = textPages(d) && d.status === 'collecting' ? 'збір сторінок' : STATUS[d.status];
    box.append(h('div', { class: 'card draft-card', 'data-draft': d.draftId },
      h('div', { class: 'grow' }, h('strong', { text: d.title || tr('Без назви') }),
        h('div', { class: 'muted', text: `${kindLabel(d)} · ${tr(status) || d.status} · ${textPages(d) ? tr('сторінок') : tr('кадрів')}: ${d.photoCount}` })),
      h('div', { class: 'row draft-card-actions' },
        h('button', { text: tr('Відкрити'), onclick: () => openDraft(d.draftId) }),
        h('button', { class: 'studio-action', 'data-open-studio': d.draftId, type: 'button',
          text: tr('Відкрити у Студії книг'), onclick: (e) => openDraftInStudio(d.draftId, e.currentTarget) }),
        h('button', { class: 'small danger', 'data-delete-draft': d.draftId, text: tr('Видалити'), onclick: () => deleteDraft(d) }))));
  }
  const priv = privateListSection();
  if (priv) box.append(priv);
  return box;
}

/* Видалення чернетки з системи (запит власника 10.11.2026): прибирає її зі списку, у тому числі відправлену. Те, що вже в Studio
   (книга, курс, інструкція, «Вхідні») і фото в медіатеці, лишається — про це й попереджаємо. */
async function deleteDraft(d) {
  const name = d.title || tr('Без назви');
  const sent = d.status === 'submitted';
  const msg = tr("Видалити чернетку «{0}»?\n\n", name) + (sent
    ? tr('Вона зникне зі списку. Те, що вже відправлено в Studio (книга, курс чи інструкція), і фото в медіатеці лишаться там.')
    : tr('Кадри й текст цієї чернетки буде прибрано зі списку. Дію не можна скасувати.'));
  if (!window.confirm(msg)) return;
  try {
    await api('DELETE', `/drafts/${d.draftId}`);
    state.drafts = state.drafts.filter((x) => x.draftId !== d.draftId);
    toast(tr('Чернетку видалено.'));
  } catch (e) { toast(e.message); }
  render();
}

/* ---------- що створюємо (запит власника 11.11.2026) ----------
   Перший екран після підключення телефону й за кнопкою «Нова чернетка»: користувач сам вирішує, що вийде зі знімків —
   інструкція чи курс (тренінг). Далі шлях той самий: зняли чи відсканували, ШІ розпізнав, людина перевірила, Studio отримала. */
function startNew(preset) { state.newDraft = preset; go('create'); }

function choiceCard(id, icon, title, text, onclick) {
  return h('button', { class: 'choice', type: 'button', id, onclick },
    h('span', { class: 'choice-icon', text: icon }),
    h('span', { class: 'choice-body' }, h('strong', { text: title }), h('span', { class: 'muted', text })));
}

/* Локальні сервери автора (журнал #549/#550): тут лише стан і підказка. Приватна обробка вмикається при створенні чернетки. */
function privateStoresNote() {
  const stores = state.privateStores || [];
  if (!stores.length) return null;
  const ready = privateStoreReady().length > 0;
  return h('div', { class: 'card', id: 'private-stores-note' },
    h('strong', { text: tr('Ваш локальний сервер у Studio') }),
    ...stores.map((st) => h('p', { class: 'muted', 'data-private-store': st.id, text: `${st.name}: ${st.online ? tr('в мережі') : tr('зараз не на звʼязку')}` })),
    h('p', { class: 'muted', text: ready
      ? tr('Є два шляхи: у хмарі (ШІ розпізнає й складає текст) або «На моєму сервері» (знімки шифруються на телефоні, розпізнає ваш комп\u02bcютер, у хмару нічого не потрапляє). Шлях обирається при створенні чернетки.')
      : tr('Чернетки з телефона зберігаються в хмарі Studio: розпізнавання знімків потребує хмари. Приватну обробку на сервері вмикає адміністратор (вид «Вхідні з телефона»).') }));
}

function viewChoose() {
  return h('div', { id: 'choose' },
    h('h2', { text: tr('Що створюємо?') }),
    h('p', { class: 'muted', text: tr('Оберіть, що вийде зі знімків. Далі все так само: знімаєте або скануєте, ШІ розпізнає, ви перевіряєте, і результат лягає в потрібний розділ Studio.') }),
    choiceCard('choose-instruction', '🔧', tr('Інструкція'), tr('Кроки складання чи користування виробом за кадрами й технічною документацією. Результат — експрес-чернетка в майстрі інструкцій Studio.'), () => startNew({ kind: 'instruction' })),
    choiceCard('choose-course', '🎓', tr('Курс (тренінг)'), tr('Навчальний курс за фото майстер-класу або за сканом документа з друкованим чи рукописним текстом. Результат — чернетка в розділі «Курси» Studio: назва, опис, результати, модулі й уроки.'), () => go('choose-course')),
    choiceCard('choose-book', '📖', tr('Створити книгу'), tr('Збирайте фото й замітки у своєму темпі. Коли будете готові, складіть план і напишіть чернетку книги.'), () => startNew({ kind: 'book' })),
    h('p', { class: 'muted' }, h('button', { class: 'link', id: 'choose-manuscript', type: 'button', text: tr('Набрати книгу зі сторінок рукопису'), onclick: () => startNew({ kind: 'manuscript' }) })),
    privateStoresNote(),
    h('p', null, h('button', { class: 'link', id: 'choose-to-list', type: 'button', text: state.drafts.length ? tr("Мої чернетки ({0})", state.drafts.length) : tr('Мої чернетки'), onclick: () => go('list') })));
}

function viewChooseCourse() {
  return h('div', { id: 'choose-course-view' },
    h('h2', { text: tr('Курс: з чого складаємо?') }),
    choiceCard('choose-course-document', '📄', tr('Скан документа'), tr('Друкований чи рукописний текст: ШІ розпізнає сторінки дослівно й розкладе їх на модулі та уроки, нічого не вигадуючи.'), () => startNew({ kind: 'course', courseSource: 'document' })),
    choiceCard('choose-course-photos', '📷', tr('Фото майстер-класу'), tr('Кадри процесу: ШІ опише, що на них видно, і складе уроки за порядком зйомки.'), () => startNew({ kind: 'course', courseSource: 'photos' })),
    h('p', null, h('button', { class: 'link', id: 'choose-back', type: 'button', text: tr('← Назад'), onclick: () => go('choose') })));
}

const NEW_TITLE = { book: 'Нова книга з фото', instruction: 'Нова інструкція', manuscript: 'Новий набір книги' };
function viewCreate() {
  const preset = state.newDraft || { kind: 'course', courseSource: 'photos' };
  const kind = preset.kind;
  const creatingBook = kind === 'book';
  const heading = kind === 'course' ? (preset.courseSource === 'document' ? tr('Новий курс зі скану документа') : tr('Новий курс із фото майстер-класу')) : tr(NEW_TITLE[kind]) || tr('Нова чернетка');
  const f = {
    title: h('input', { id: 'f-title', required: creatingBook, maxlength: 160, placeholder: creatingBook ? tr('Робоча назва книги') : kind === 'course' && preset.courseSource === 'document' ? tr('Назва курсу (можна залишити порожньою — ШІ запропонує)') : tr('Наприклад: Ложка з вишні за один вечір') }),
    craft: h('input', { id: 'f-craft', maxlength: 200, placeholder: creatingBook ? tr('Про що буде книга? (необов’язково)') : kind === 'course' && preset.courseSource === 'document' ? tr('Тема (необовʼязково)') : tr('Ремесло (необовʼязково)') }),
    audience: h('input', { id: 'f-audience', maxlength: 200, placeholder: tr('Для кого (необовʼязково)') }),
    mode: h('select', { id: 'f-mode' }, h('option', { value: 'assembly', text: tr('Складання') }), h('option', { value: 'operation', text: tr('Користування') })),
    model: h('input', { id: 'f-model', maxlength: 200, placeholder: tr('Код або модель виробу') }),
  };
  const extra = h('div', { hidden: kind !== 'instruction' }, h('label', { text: tr('Режим інструкції') }), f.mode, h('label', { text: tr('Код або модель виробу') }), f.model);
  f.booktype = h('select', { id: 'f-booktype' }, h('option', { value: 'new', text: tr('Нова книга') }), h('option', { value: 'existing', text: tr('Існуюча книга (за ID)') }));
  f.newbook = h('input', { id: 'f-newbook', maxlength: 160, placeholder: tr('Назва нової книги') });
  f.bookid = h('input', { id: 'f-bookid', placeholder: tr('ID книги в Studio'), hidden: true });
  f.booktype.addEventListener('change', () => { f.newbook.hidden = f.booktype.value !== 'new'; f.bookid.hidden = f.booktype.value !== 'existing'; });
  const msExtra = h('div', { hidden: kind !== 'manuscript' }, h('label', { text: tr('Книга') }), f.booktype, f.newbook, f.bookid,
    h('p', { class: 'muted', text: tr('Сторінки розпізнаються дослівно, без переписування. Назва вище — це назва глави.') }));
  const docNote = kind === 'course' && preset.courseSource === 'document'
    ? h('p', { class: 'muted', id: 'doc-note', text: tr('Скануйте або фотографуйте сторінки документа по порядку. Студія збере з розпізнаного тексту чернетку курсу: опис, результати навчання, модулі й уроки.') })
    : null;
  const err = h('p', { class: 'err' });
  // Де обробити (журнал #550): у хмарі (ШІ) чи на моєму локальному сервері (приватно). Приватний шлях — лише для знімків із текстом.
  const canPrivate = privateAvailableFor(kind, preset.courseSource);
  const stores = privateStoreReady();
  f.where = h('select', { id: 'f-where' }, h('option', { value: 'cloud', text: tr('☁ У хмарі: розпізнає ШІ (найвища якість, рукопис, фото)') }), h('option', { value: 'private', text: tr('🔒 На моєму сервері: приватно, розпізнає мій комп\u02bcютер') }));
  f.store = h('select', { id: 'f-store', hidden: true }, ...stores.map((st) => h('option', { value: st.id, text: st.name + (st.online ? '' : tr(' (не на звʼязку)')) })));
  const whereHint = h('p', { class: 'muted', id: 'where-hint', hidden: true, text: tr('Знімки шифруються на телефоні й потрапляють лише на ваш сервер: Studio бачить шифротекст, ШІ не залучається. Підходить для друкованого тексту й чітких сканів; рукопис і фото без тексту краще розпізнає хмара.') });
  f.where.addEventListener('change', () => { const priv = f.where.value === 'private'; whereHint.hidden = !priv; f.store.hidden = !priv || stores.length < 2; });
  const whereBlock = canPrivate ? h('div', { id: 'where-block' }, h('label', { text: tr('Де обробити') }), f.where, f.store, whereHint) : null;
  return h('form', { class: 'card', id: 'create-form', 'data-kind': kind, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const body = { kind };
    if (creatingBook) {
      if (!f.title.value.trim()) { err.textContent = tr('Вкажіть робочу назву книги.'); return; }
      body.newBookTitle = f.title.value.trim();
    }
    if (kind === 'course') body.courseSource = preset.courseSource || 'photos';
    for (const k of ['title', 'craft', 'audience']) if (f[k].value.trim()) body[k] = f[k].value.trim();
    if (kind === 'manuscript') {
      if (f.booktype.value === 'new' && f.newbook.value.trim()) body.newBookTitle = f.newbook.value.trim();
      if (f.booktype.value === 'existing' && f.bookid.value.trim()) body.bookId = f.bookid.value.trim();
    }
    if (kind === 'instruction') { body.instructionMode = f.mode.value; if (f.model.value.trim()) body.modelCode = f.model.value.trim(); }
    if (canPrivate && f.where.value === 'private') {
      if (kind === 'manuscript' && f.booktype.value === 'existing') { err.textContent = tr('Приватна книга створюється нова: додавання до наявної книги Studio доступне лише в хмарі.'); return; }
      delete body.bookId;
      try { await startPrivateDraft(body, f.store.value); } catch (e3) { err.textContent = e3.message; }
      return;
    }
    const button = e.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try { const r = await api('POST', '/drafts', body); await openDraft(r.draft.draftId); }
    catch (e2) { err.textContent = e2.message; }
    finally { button.disabled = false; }
  } },
    h('h2', { id: 'create-title', text: heading }),
    docNote, extra, msExtra, whereBlock,
    h('label', { for: 'f-title', text: creatingBook ? tr('Назва книги') : tr('Назва') }), f.title, h('label', { for: 'f-craft', text: creatingBook ? tr('Задум') : kind === 'course' && preset.courseSource === 'document' ? tr('Тема') : tr('Ремесло') }), f.craft, h('label', { text: tr('Аудиторія') }), f.audience, err,
    h('p', { class: 'row' }, h('button', { class: 'primary', type: 'submit', text: tr('Створити') }), h('button', { type: 'button', id: 'create-back', text: tr('Назад'), onclick: () => go('choose') })));
}

/* ---------- чернетка ---------- */
async function openDraft(id) {
  try {
    const { draft } = await api('GET', '/drafts/' + id);
    showDraft(draft, await qAll());
  } catch (e) { toast(e.message); }
}
function showDraft(draft, queue, blockers = null) {
  state.draft = draft;
  state.queue = queue;
  state.blockers = blockers;
  state.target = null;
  go('draft'); schedulePoll(); flushQueue();
}

function studioTargetUrl(target) {
  if (!target || !state.studioOrigin) return null;
  // Older book submissions stored the Studio homepage as their destination.
  const path = target.kind === 'book' && target.id
    ? `/projects/${encodeURIComponent(target.id)}/editor?from=grabfusion`
    : target.studioUrl;
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    ? state.studioOrigin + path : null;
}

let openingStudio = false;
async function openDraftInStudio(id, button) {
  if (openingStudio) return;
  openingStudio = true;
  button.disabled = true;
  button.textContent = tr('Завантаження…');
  try {
    if (!(await ensureStudioOrigin())) return;
    const path = '/drafts/' + encodeURIComponent(id);
    let { draft } = await api('GET', path);
    if (state.view !== 'list') return;
    if (draft.submitted) {
      const href = studioTargetUrl(draft.submitted);
      if (href) location.assign(href);
      else toast(tr('Адреса Студії книг недоступна. Спробуйте ще раз.'));
      return;
    }
    const queue = await qAll();
    if (state.view !== 'list') return;
    const pending = queue.filter((item) => item.draftId === id);
    if (pending.length || (draft.status !== 'written' && draft.kind !== 'manuscript')) {
      showDraft(draft, queue);
      if (pending.some((item) => item.state === 'failed')) {
        toast(tr('Повторіть надсилання невдалих фото або приберіть їх із чернетки.'));
      } else {
        toast(tr(pending.length ? 'Дочекайтеся, поки надішлються всі фото цієї чернетки.' : 'Підготуйте чернетку до відправки, щоб відкрити її у Студії книг.'));
      }
      document.getElementById('actions')?.scrollIntoView({ block: 'start' });
      return;
    }
    button.textContent = tr('Надсилаємо до Студії…');
    let target;
    try {
      ({ target } = await api('POST', path + '/submit'));
    } catch (e) {
      if (e.kind === 'wrong_status') {
        ({ draft } = await api('GET', path));
        target = draft.submitted;
        if (!target) throw e;
      } else if (e.kind === 'submit_blocked' || e.kind === 'job_running') {
        if (state.view !== 'list') return;
        showDraft(draft, queue, e.blockers?.length ? e.blockers : [{ kind: e.kind, message: e.message }]);
        (document.getElementById('blockers') || document.getElementById('actions'))?.scrollIntoView({ block: 'start' });
        return;
      } else throw e;
    }
    if (state.view !== 'list') return;
    const href = studioTargetUrl(target);
    if (href) location.assign(href);
    else toast(tr('Адреса Студії книг недоступна. Спробуйте ще раз.'));
  } catch (e) { toast(e.message); }
  finally {
    openingStudio = false;
    button.disabled = false;
    button.textContent = tr('Відкрити у Студії книг');
  }
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
  const hint = textPages(state.draft);
  const book = photoBook(state.draft);
  const ta = h('textarea', { rows: 2, placeholder: (hint ? tr('Підказка для розпізнавання: імена, мова, почерк… (до ') : tech ? tr('Деталь, інструмент, момент складання… (до ') : book ? tr('Що тут важливе для книги? Місце, герой, подія чи репліка… (до ') : tr('Що на кадрі? (до ')) + maxNote() + tr(' символів)'), id });
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
    if (!text.trim()) { if (cur) { const r = await api('DELETE', `/drafts/${state.draft.draftId}/notes/${cur.noteId}`); state.draft = r.draft; if (photoBook(state.draft)) render(); } return; }
    const r = await api('PUT', `/drafts/${state.draft.draftId}/notes/${cur ? cur.noteId : 'n-' + photoId}`, { photoIds: [photoId], text });
    const rest = (state.draft.notes || []).filter((n) => n.noteId !== r.note.noteId);
    state.draft.notes = [...rest, r.note]; state.draft.revision = r.revision;
    if (photoBook(state.draft)) {
      if (state.draft.status === 'structured' || state.draft.status === 'written') state.draft.status = 'collecting';
      render();
    }
  } catch (e) { toast(e.message); }
}); }

function movePhoto(photoId, delta, toIndex) { return serial(async () => {
  const ids = state.draft.photos.slice().sort((a, b) => a.order - b.order).map((p) => p.photoId);
  const from = ids.indexOf(photoId); const to = toIndex != null ? toIndex : from + delta;
  if (from < 0 || to < 0 || to >= ids.length || to === from) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, photoOrder: ids })).draft; }
  catch (e) { toast(e.kind === 'revision_conflict' ? tr('Чернетку змінено з іншого пристрою — оновлюю.') : e.message); await reloadDraft(); }
  render();
}); }

function photoPreview(src, label) {
  const trigger = h('button', {
    type: 'button', class: 'photo-preview-trigger', 'aria-label': tr("Відкрити: {0}", label), draggable: 'false',
  }, h('img', { src, alt: label, loading: 'lazy', draggable: 'false' }));
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const photo = h('img', { src, alt: label });
    const error = h('p', { class: 'photo-preview-error', role: 'status', hidden: true, text: tr('Не вдалося завантажити фото.') });
    photo.addEventListener('error', () => { photo.hidden = true; error.hidden = false; });
    const close = h('button', {
      type: 'button', class: 'photo-preview-close', 'aria-label': tr('Закрити перегляд фото'), text: '✕', autofocus: true,
    });
    const dialog = h('dialog', { class: 'photo-preview', 'aria-label': label }, close, photo, error);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); if (trigger.isConnected) trigger.focus(); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
  return trigger;
}

function photoCard(p, i, total) {
  const card = h('div', { class: 'card frame', draggable: 'true', 'data-photo': p.photoId },
    photoPreview(`api/drafts/${state.draft.draftId}/photos/${p.photoId}/image`, tr("Кадр №{0}", p.order)),
    h('div', null,
      h('div', { class: 'row' }, h('strong', { text: '#' + p.order }), h('span', { class: 'badge ' + p.status, text: { processing: tr('описується…'), described: tr('описано'), failed: tr('не вдалося') }[p.status] || p.status })),
      photoBook(state.draft) && p.takenAt && h('time', { datetime: p.takenAt, class: 'muted', text: new Date(p.takenAt).toLocaleDateString(grabLocale()) }),
      p.description && h('p', { text: photoBook(state.draft) ? tr('Опис ШІ: ') + p.description : p.description }),
      p.tags && p.tags.length ? h('div', { class: 'tags' }, p.tags.map((t) => h('span', { text: t }))) : null,
      p.status === 'failed' && h('p', { class: 'err', text: p.error ? grabApiMessage('bad_image', p.error) : tr('Не вдалося описати кадр.') }),
      noteBox((noteFor(p.photoId) || {}).text, (text) => saveNote(p.photoId, text)),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'small', text: '↑', title: tr('Вище'), disabled: i === 0, onclick: () => movePhoto(p.photoId, -1) }),
        h('button', { class: 'small', text: '↓', title: tr('Нижче'), disabled: i === total - 1, onclick: () => movePhoto(p.photoId, 1) }),
        p.status === 'failed' && h('button', { class: 'small', text: tr('Повторити'), onclick: async () => { try { await api('POST', `/drafts/${state.draft.draftId}/photos/${p.photoId}/retry`); await reloadDraft(); } catch (e) { toast(e.message); } } }),
        h('button', { class: 'small danger', text: tr('Видалити'), onclick: async () => { try { state.draft = (await api('DELETE', `/drafts/${state.draft.draftId}/photos/${p.photoId}`)).draft; render(); } catch (e) { toast(e.message); } } }))));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.photoId); });
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('dragover'); });
  card.addEventListener('dragleave', () => card.classList.remove('dragover'));
  card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('dragover'); const id = e.dataTransfer.getData('text/plain'); if (id && id !== p.photoId) movePhoto(id, 0, i); });
  return card;
}

function queuedCard(it) {
  const failed = it.state === 'failed';
  return h('div', { class: 'card frame', 'data-queued': it.clientId },
    photoPreview(urlFor(it), tr('Кадр у черзі')),
    h('div', null,
      h('div', { class: 'row' }, h('span', { class: 'badge ' + (failed ? 'failed' : 'queued'), text: failed ? tr('не надіслано') : tr('у черзі') }),
        h('span', { class: 'muted', text: failed ? '' : (state.online ? tr('надсилається…') : tr('надішлеться, коли зʼявиться звʼязок')) })),
      failed && h('p', { class: 'err', text: grabApiMessage(it.errorKind, it.error) }),
      noteBox(it.note, async (text) => { it.note = text; await qPut(it); }),
      h('div', { class: 'row', style: 'margin-top:8px' },
        failed && h('button', { class: 'small', text: tr('Спробувати ще'), onclick: async () => { it.state = 'queued'; it.error = ''; await qPut(it); render(); flushQueue(); } }),
        h('button', { class: 'small danger', text: tr('Прибрати'), onclick: async () => { await qDel(it.clientId); dropUrl(it.clientId); state.queue = state.queue.filter((x) => x.clientId !== it.clientId); render(); } }))));
}

const BOOK_IDEA_LABELS = { character: 'Герой', scene: 'Сцена' };

function bookIdeaDialog(title, ...contents) {
  const headingId = 'book-idea-dialog-heading';
  const dialog = h('dialog', { class: 'card book-idea-dialog', 'aria-labelledby': headingId },
    h('h3', { id: headingId, text: title }), ...contents,
    h('button', { type: 'button', class: 'small', text: tr('Закрити'), onclick: () => dialog.close() }));
  // Keep automatic photo/job polling from replacing the draft while the author edits a card.
  state.editing = true;
  dialog.addEventListener('close', () => { dialog.remove(); endEditing(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

async function chooseBookIdea(kind) {
  const id = state.draft.draftId;
  await saveChain;
  const draft = state.draft;
  if (!draft || draft.draftId !== id || draft.job?.status === 'running') return;
  const notedIds = new Set(draft.notes.flatMap((note) => note.photoIds));
  const photos = draft.photos.filter((p) => p.status !== 'processing' && (p.description || notedIds.has(p.photoId)));
  if (!photos.some((p) => notedIds.has(p.photoId))) { toast(tr('Додайте нотатку хоча б до одного фото.')); return; }
  const checked = new Set(photos.length <= 8
    ? photos.map((p) => p.photoId)
    : photos.filter((p) => notedIds.has(p.photoId)).slice(-8).map((p) => p.photoId));
  const note = h('p', { 'aria-live': 'polite', class: 'muted' });
  const err = h('p', { role: 'alert', class: 'err' });
  const button = h('button', { type: 'button', class: 'primary', text: tr('Перевірити вартість') });
  let quote = null;
  let busy = false;
  const update = () => {
    quote = null;
    button.textContent = tr('Перевірити вартість');
    button.disabled = busy || checked.size < 1 || checked.size > 8 || ![...checked].some((id) => notedIds.has(id));
    note.textContent = tr("Вибрано: {0} з 8. Потрібне хоча б одне фото з вашою нотаткою.", checked.size);
    err.textContent = '';
  };
  const authorNotes = new Map(photos.map((p) => [
    p.photoId,
    draft.notes.filter((item) => item.photoIds.includes(p.photoId)).map((item) => item.text).join(' '),
  ]));
  const dialog = bookIdeaDialog(kind === 'character' ? tr('Створити героя з нотаток') : tr('Створити сцену з нотаток'),
    h('p', { text: tr('Виберіть фото, які стосуються героя або події.') }),
    h('div', { class: 'book-idea-sources' }, photos.map((photo) => h('label', { class: 'book-idea-source' },
      h('input', { type: 'checkbox', checked: checked.has(photo.photoId), onchange: (e) => {
        if (e.target.checked) checked.add(photo.photoId); else checked.delete(photo.photoId);
        update();
      } }),
      h('img', { src: `api/drafts/${id}/photos/${photo.photoId}/image`, alt: '', loading: 'lazy' }),
      h('span', null, h('strong', { text: tr("Фото №{0}", photo.order) }),
        h('span', { class: 'muted', text: authorNotes.get(photo.photoId) || photo.description || '' }))))),
    note, err, button);
  update();
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; button.disabled = true; err.textContent = '';
    const photoIds = [...checked];
    const selection = photoIds.join(',');
    try {
      if (!quote || quote.selection !== selection) {
        const params = new URLSearchParams({ pass: 'book-idea', kind, photoIds: selection });
        const result = await api('GET', `/drafts/${id}/ai-options?${params}`);
        if (!dialog.open || selection !== [...checked].join(',')) return;
        const usable = result.models.filter((m) => m.usable && m.credits);
        const saved = aiStored();
        const model = usable.find((m) => m.modelId === saved) || usable.find((m) => m.modelId === result.defaultModelId) || usable[0];
        if (!model) throw new Error(tr('Немає доступної моделі з визначеною вартістю.'));
        if (!result.unlimited && result.balance != null && result.balance < model.credits.max) {
          throw new Error(tr("Не вистачає балів: потрібно до {0}, на балансі {1}.", credits(model.credits.max), credits(result.balance)));
        }
        quote = { modelId: model.modelId, selection };
        note.textContent = result.unlimited ? tr("{0} · без списання балів", model.label)
          : tr("{0} · приблизно {1}, до {2}", model.label, credits(model.credits.expected), credits(model.credits.max));
        button.textContent = tr('Створити пропозицію');
        return;
      }
      const result = await api('POST', `/drafts/${id}/book-ideas`, { kind, photoIds, modelId: quote.modelId, ifRevision: draft.revision });
      if (state.draft?.draftId === id) {
        state.draft = result.draft;
        dialog.close(); render(); schedulePoll();
      }
    } catch (error) {
      if (error.kind === 'revision_conflict') { dialog.close(); toast(error.message); await reloadDraft(); }
      else err.textContent = error.message;
    } finally {
      busy = false;
      button.disabled = !checked.size || checked.size > 8 || ![...checked].some((id) => notedIds.has(id));
    }
  });
}

function reviewBookIdea(idea) {
  const title = h('input', { id: 'book-idea-title', maxlength: 160, value: idea.title });
  const description = h('textarea', { id: 'book-idea-description', maxlength: 2400, rows: 10 });
  description.value = idea.text;
  const place = idea.kind === 'scene' ? h('input', { id: 'book-idea-place', maxlength: 160, value: idea.location ?? '' }) : null;
  const time = idea.kind === 'scene' ? h('input', { id: 'book-idea-time', maxlength: 160, value: idea.timeOfDay ?? '' }) : null;
  const err = h('p', { role: 'alert', class: 'err' });
  const save = h('button', { type: 'button', class: 'primary', text: idea.accepted ? tr('Зберегти зміни') : tr('Додати до чернетки') });
  const dialog = bookIdeaDialog(tr(BOOK_IDEA_LABELS[idea.kind]),
    h('label', { for: title.id, text: idea.kind === 'character' ? tr('Ім’я героя') : tr('Назва сцени') }), title,
    place && h('label', { for: place.id, text: tr('Місце') }), place,
    time && h('label', { for: time.id, text: tr('Час') }), time,
    h('label', { for: description.id, text: tr('Опис') }), description, err, save);
  save.addEventListener('click', async () => {
    if (!title.value.trim() || !description.value.trim()) { err.textContent = tr('Заповніть назву й опис.'); return; }
    save.disabled = true;
    try {
      await changeBookIdea(idea.id, {
        action: 'accept', title: title.value.trim(), text: description.value.trim(),
        ...(place && time ? { location: place.value.trim(), timeOfDay: time.value.trim() } : {}),
      });
      dialog.close(); render();
    } catch (error) {
      err.textContent = error.message;
      if (error.kind === 'revision_conflict') await reloadDraft();
    } finally { save.disabled = false; }
  });
}

function changeBookIdea(ideaId, fields) {
  return serial(async () => {
    const draft = state.draft;
    const result = await api('PATCH', `/drafts/${draft.draftId}/book-ideas/${ideaId}`, { ...fields, ifRevision: draft.revision });
    if (state.draft?.draftId === draft.draftId) state.draft = result.draft;
  });
}

function viewBookIdeas(draft, readOnly = false) {
  const ideas = draft.bookIdeas ?? [];
  const job = draft.job;
  const busy = state.writing || job?.status === 'running';
  const hasNotes = draft.notes.some((note) => note.photoIds.some((id) =>
    draft.photos.some((photo) => photo.photoId === id && photo.status !== 'processing')));
  return h('div', { class: 'card', id: 'book-ideas' },
    h('h3', { text: tr('Герої та сцени') }),
    !readOnly && h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', id: 'create-character-from-notes', text: tr('Створити героя з нотаток'), disabled: busy || !hasNotes, onclick: () => chooseBookIdea('character') }),
      h('button', { type: 'button', class: 'primary', id: 'create-scene-from-notes', text: tr('Створити сцену з нотаток'), disabled: busy || !hasNotes, onclick: () => chooseBookIdea('scene') })),
    !readOnly && !hasNotes && h('p', { class: 'muted', text: tr('Додайте авторську нотатку до фото, щоб підготувати героя або сцену.') }),
    job?.bookIdeaKind && h('p', { role: 'status', class: job.status === 'failed' ? 'err' : 'muted',
      text: job.status === 'failed' ? grabApiMessage('server_error', job.error) : (job.bookIdeaKind === 'character' ? tr('ШІ готує героя…') : tr('ШІ готує сцену…')) }),
    [...ideas].reverse().map((idea) => {
      const sources = draft.photos.filter((p) => idea.photoIds.includes(p.photoId)).map((p) => `№${p.order}`).join(', ');
      return h('article', { class: 'book-idea', 'data-book-idea': idea.id },
        h('strong', { text: `${tr(BOOK_IDEA_LABELS[idea.kind])} · ${idea.title}` }),
        h('p', { class: 'muted', text: `${idea.accepted ? tr('Додано до чернетки') : tr('Пропозиція ШІ')}${sources ? tr(' · Фото ') + sources : ''}` }),
        (idea.location || idea.timeOfDay) && h('p', { class: 'muted', text: [idea.location, idea.timeOfDay].filter(Boolean).join(' · ') }),
        h('p', { class: 'book-idea-text', text: idea.text }),
        !readOnly && h('div', { class: 'row' },
          h('button', { type: 'button', class: 'small', disabled: busy, text: idea.accepted ? tr('Редагувати') : tr('Переглянути й додати'), onclick: () => reviewBookIdea(idea) }),
          h('button', { type: 'button', class: 'small', disabled: busy, text: idea.accepted ? tr('Прибрати') : tr('Відхилити'), onclick: async () => {
            try { await changeBookIdea(idea.id, { action: 'remove' }); render(); } catch (error) { toast(error.message); await reloadDraft(); }
          } })));
    }));
}

function viewDraft() {
  const d = state.draft;
  const box = h('div');
  const mine = state.queue.filter((q) => q.draftId === d.draftId);
  const meta = [kindLabel(d), textPages(d) && d.status === 'collecting' ? tr('збір сторінок') : tr(STATUS[d.status]), d.craft, d.audience].filter(Boolean).join(' · ');
  const unit = textPages(d) ? tr('сторінок') : tr('кадрів');
  const cap = textPages(d) && state.limits ? ` / ${state.limits.maxManuscriptPages}` : '';
  box.append(h('p', { class: 'muted', text: meta + ` · ${unit}: ${d.photos.length}${cap}` + (mine.length ? tr(" (+{0} у черзі)", mine.length) : '') }));
  if (d.status !== 'submitted') box.append(h('div', { class: 'row', id: 'save-row' },
    h('button', { class: 'small', id: 'btn-save', text: tr('💾 Зберегти чернетку'), onclick: saveDraft }),
    h('span', { class: 'muted', text: tr('Зміни зберігаються й самі; кнопка — щоб відкласти роботу на потім.') })));
  if (d.status === 'submitted') { box.append(viewSubmitted(d)); if (photoBook(d) && d.bookIdeas?.length) box.append(viewBookIdeas(d, true)); box.append(textPages(d) ? pagesSection(d, mine, true) : photosSection(d, mine, true)); return box; }
  if (photoBook(d)) box.append(h('div', { class: 'card', id: 'book-workflow' },
    h('strong', { text: tr('Матеріали книги') }),
    h('p', { class: 'muted', text: tr('Додавайте фото сьогодні й повертайтеся до цієї чернетки пізніше. Перевіряйте опис ШІ й дописуйте, яку роль кожне фото має в книзі.') })));
  const onFiles = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  box.append(h('div', { class: 'shoot' },
    h('label', { class: 'btn primary', for: 'file-cam', id: 'lbl-cam', text: tr('📷 Зняти') }),
    h('label', { class: 'btn', for: 'file-gal', id: 'lbl-gal', text: tr('З галереї') }),
    h('input', { type: 'file', id: 'file-cam', accept: 'image/*', capture: 'environment', onchange: onFiles }),
    h('input', { type: 'file', id: 'file-gal', accept: 'image/*', multiple: true, onchange: onFiles })));
  if (d.kind === 'manuscript') { box.append(viewMsMeta(d), viewMsActions(d, mine), pagesSection(d, mine, false)); return box; }
  if (textPages(d)) {
    // Курс зі скану документа: сторінки розпізнаються дослівно, а структуру й текст уроків ШІ складає з них (контракт 1.6.0).
    box.append(viewDocMeta(d), viewActions(d, mine));
    if (d.structure) box.append(viewStructure(d));
    box.append(pagesSection(d, mine, false));
    return box;
  }
  if (d.kind === 'instruction') box.append(viewInstructionMeta(d));
  if (photoBook(d)) {
    box.append(viewBookIdeas(d), photosSection(d, mine, false), viewActions(d, mine));
    if (d.structure) box.append(viewStructure(d));
    return box;
  }
  if (d.kind === 'course' || d.kind === 'instruction') box.append(viewActions(d, mine));
  if (d.structure) box.append(viewStructure(d));
  box.append(photosSection(d, mine, false));
  return box;
}

/* «Зберегти чернетку»: дописує все, що ще не пішло (поле у фокусі, черга фото), і повертає до списку. */
async function saveDraft() {
  const id = state.draft.draftId;
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae.blur) ae.blur(); // blur запускає відкладене збереження поля
  await sleep(80);
  await saveChain.catch(() => {});
  await flushQueue();
  await saveChain.catch(() => {});
  const left = state.queue.filter((q) => q.draftId === id && q.state === 'queued').length;
  const failed = state.queue.filter((q) => q.draftId === id && q.state === 'failed').length;
  toast(left ? tr("Чернетку збережено. Фото в черзі ({0}) надішлються, коли зʼявиться звʼязок.", left)
    : failed ? tr("Чернетку збережено, але {0} фото не надіслано — відкрийте її й перегляньте.", failed) : tr('Чернетку збережено. Її можна відкрити пізніше зі списку.'));
  await openList();
}

function photosSection(d, mine, readOnly) {
  const photos = d.photos.slice().sort((a, b) => a.order - b.order);
  const list = h('div', { class: 'frames', id: 'frames' });
  photos.forEach((p, i) => list.append(photoCard(p, i, photos.length)));
  mine.forEach((q) => list.append(queuedCard(q)));
  if (!photos.length && !mine.length) list.append(h('p', { class: 'muted', text: photoBook(d) ? tr('Додайте перше фото. Після розпізнавання допишіть, як воно пов’язане з книгою.') : tr('Знімайте кроки по порядку. Кожен кадр опишеться автоматично; свій опис можна дописати.') }));
  if (!d.structure) return h('div', null, h('h3', { text: tr('Кадри') }), list);
  const det = h('details', { id: 'photos-section' }, h('summary', { text: tr("Кадри ({0})", photos.length) }), list);
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
const JOB_TEXT = { structure: 'ШІ розкладає кадри на кроки…', generate: 'ШІ пише текст…', suggest: 'ШІ пише підказку до уроку…' };

function confirmBtn(label, confirmLabel, fn, props) {
  const b = h('button', Object.assign({ text: label }, props || {}));
  let armed = false, t;
  b.addEventListener('click', () => {
    if (!armed) { armed = true; b.textContent = confirmLabel; b.classList.add('danger'); t = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('danger'); }, 4000); return; }
    clearTimeout(t); armed = false; fn();
  });
  return b;
}

/* ---------- вибір моделі ШІ й бали за прохід (контракт 1.4.0) ----------
   Studio сама перевіряє ключі, які адмін ввів у «Ключах API», і рахує бали за тарифом моделі з адмінки.
   Тут — лише показ: що можна обрати, скільки це коштує й чи вистачить балів. Рішення (резерв, списання) ухвалює Studio. */
const AI_MODEL_KEY = 'gf_ai_model';
const AI_REFRESH_MS = 4 * 60 * 1000; // Studio кешує перевірку ключів на 5 хв
let aiSeq = 0;
function aiPlan(d) {
  const plan = [];
  const words = photoBook(d) ? { s: tr('Скласти план книги'), w: tr('Написати чернетку книги') } : d.kind === 'instruction' ? { s: tr('Розкласти на кроки'), w: tr('Написати кроки') } : { s: tr('Розкласти на уроки'), w: tr('Написати уроки') };
  const left = d.structure ? d.structure.modules.filter((m) => !m.written).map((m) => m.moduleId) : [];
  if (!d.structure || d.status === 'collecting') plan.push({ id: 'structure', label: words.s, pass: 'structure', moduleIds: [] });
  else {
    if (d.status !== 'written' && left.length) plan.push({ id: 'generate', label: words.w, pass: 'generate', moduleIds: left });
    plan.push({ id: 'restructure', label: tr('Розкласти заново'), pass: 'structure', moduleIds: [], secondary: true });
  }
  return plan;
}
const aiKey = (d, plan) => [d.draftId, photoBook(d) ? d.revision : d.photos.length, plan.map((p) => p.id + ':' + p.moduleIds.join(',')).join(';')].join('|');
const aiStored = () => { try { return localStorage.getItem(AI_MODEL_KEY) || ''; } catch (e) { return ''; } };
const aiRemember = (id) => { try { localStorage.setItem(AI_MODEL_KEY, id); } catch (e) { /* без сховища — не критично */ } };

/* Бали за позицію плану для моделі: сума по модулях; null, якщо ціну хоч одного не звірено. */
function aiCost(ai, itemId, modelId) {
  const parts = (ai.costs[itemId] || []).map((m) => m[modelId]);
  if (!parts.length || parts.some((c) => !c)) return null;
  return { expected: parts.reduce((a, c) => a + c.expected, 0), max: parts.reduce((a, c) => a + c.max, 0) };
}

async function loadAi(d) {
  const plan = aiPlan(d), key = aiKey(d, plan), seq = ++aiSeq;
  const prev = state.ai && state.ai.key === key ? state.ai : null;
  state.ai = prev ? { ...prev, loading: true } : { key, status: 'loading', loading: true, models: [], costs: {}, modelId: '', balance: null, unlimited: false, at: 0 };
  try {
    const jobs = plan.flatMap((it) => (it.pass === 'structure' ? [''] : it.moduleIds).map((mid) => ({
      it, path: `/drafts/${d.draftId}/ai-options?pass=${it.pass}` + (mid ? '&moduleId=' + encodeURIComponent(mid) : '') })));
    const replies = await Promise.all(jobs.map((j) => api('GET', j.path)));
    if (seq !== aiSeq) return;
    const first = replies[0];
    const costs = {};
    replies.forEach((r, i) => {
      const map = {}; for (const m of r.models) map[m.modelId] = m.credits;
      (costs[jobs[i].it.id] = costs[jobs[i].it.id] || []).push(map);
    });
    const usable = first.models.filter((m) => m.usable);
    const keep = state.ai && state.ai.modelId, saved = aiStored();
    const modelId = [keep, saved, first.defaultModelId].find((id) => id && usable.some((m) => m.modelId === id)) || (usable[0] && usable[0].modelId) || '';
    state.ai = { key, status: 'ready', loading: false, models: first.models, costs, modelId, balance: first.balance, unlimited: first.unlimited, at: Date.now() };
  } catch (e) {
    if (seq !== aiSeq) return;
    state.ai = { key, status: 'error', loading: false, models: [], costs: {}, modelId: '', balance: null, unlimited: false, at: Date.now(), message: e.message };
  }
  if (state.view === 'draft') render();
}
/* Викликається з перемальовування: зайвих запитів нема, поки ключ плану той самий і дані свіжі. */
function ensureAi(d) {
  const plan = aiPlan(d), key = aiKey(d, plan), ai = state.ai;
  if (d.job && d.job.status === 'running') return;
  if (ai && ai.key === key && (ai.loading || Date.now() - ai.at < AI_REFRESH_MS)) return;
  loadAi(d);
}
/* Чому запуск заблоковано (текст для людини) або '' — можна запускати. Поки перевірка триває — теж блок. */
function aiBlock(d) {
  const plan = aiPlan(d).filter((p) => !p.secondary);
  if (!plan.length) return '';
  const ai = state.ai;
  if (!ai || ai.key !== aiKey(d, aiPlan(d)) || ai.status === 'loading') return tr('Перевіряю доступні моделі ШІ…');
  if (ai.status === 'error') return ''; // Studio сама вирішить: запуск піде на її типовій моделі
  const usable = ai.models.filter((m) => m.usable);
  if (!usable.length) return tr('Жодна модель ШІ зараз недоступна.');
  const c = aiCost(ai, plan[0].id, ai.modelId);
  if (!ai.unlimited && c && ai.balance != null && ai.balance < c.max) return tr("Не вистачає балів: потрібно до {0}, на балансі {1}.", c.max, ai.balance);
  return '';
}
const aiBody = (extra) => {
  const ai = state.ai;
  const body = { ...(extra || {}), ...(ai && ai.status === 'ready' && ai.modelId ? { modelId: ai.modelId } : {}) };
  return Object.keys(body).length ? body : undefined;
};
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
const credits = (n) => `${n} ${grabLanguage === 'en' ? (n === 1 ? 'credit' : 'credits') : plural(n, 'бал', 'бали', 'балів')}`;

function viewAiPicker(d) {
  const plan = aiPlan(d), main = plan.find((p) => !p.secondary);
  if (!main) return null;
  const ai = state.ai, box = h('div', { class: 'ai-pick', id: 'ai-pick' });
  if (!ai || ai.key !== aiKey(d, plan) || (ai.status === 'loading')) { box.append(h('p', { class: 'muted', id: 'ai-loading', text: tr('Перевіряю доступні моделі ШІ…') })); return box; }
  if (ai.status === 'error') {
    box.append(h('p', { class: 'muted', id: 'ai-error', text: tr('Не вдалося перевірити моделі ШІ — запуск піде на типовій моделі Studio.') }),
      h('button', { class: 'small', id: 'btn-ai-retry', text: tr('Перевірити ще раз'), onclick: () => loadAi(state.draft) }));
    return box;
  }
  const usable = ai.models.filter((m) => m.usable);
  if (!usable.length) {
    const why = [...new Set(ai.models.map((m) => m.note).filter(Boolean))];
    box.append(h('p', { class: 'err', id: 'ai-none', text: tr('Жодна модель ШІ зараз недоступна — запуск неможливий.') }),
      why.length ? h('p', { class: 'muted', text: why.slice(0, 3).join(' ') }) : null,
      h('p', { class: 'muted', text: tr('Зверніться до адміністратора Studio: у розділі «Ключі API» потрібен дійсний ключ із коштами.') }),
      h('button', { class: 'small', id: 'btn-ai-retry', text: tr('Перевірити ще раз'), onclick: () => loadAi(state.draft) }));
    return box;
  }
  const sel = h('select', { id: 'ai-model', 'aria-label': tr('Модель ШІ') });
  for (const m of usable) {
    const c = aiCost(ai, main.id, m.modelId);
    sel.append(h('option', { value: m.modelId, text: m.label + (c ? ` — ≈ ${credits(c.expected)}` : '') + (m.status === 'busy' ? tr(' (зайнята)') : '') }));
  }
  sel.value = ai.modelId;
  sel.addEventListener('change', () => { ai.modelId = sel.value; aiRemember(sel.value); render(); });
  box.append(h('label', { for: 'ai-model', text: tr('Модель ШІ') }), sel);
  const chosen = usable.find((m) => m.modelId === ai.modelId);
  const c = aiCost(ai, main.id, ai.modelId);
  if (c) {
    // Адміністратор бали не витрачає, але вартість бачить: так її можна звірити з тарифами адмінки.
    box.append(h('p', { class: 'ai-cost', id: 'ai-cost' },
      main.label + ': ', h('strong', { text: '≈ ' + credits(c.expected) }),
      ai.unlimited ? tr(' — для вашого облікового запису бали не списуються')
        : (c.max > c.expected ? tr(" (резерв до {0}, зайве повернеться)", c.max) : '') + (ai.balance != null ? tr(" · на балансі {0}", ai.balance) : '')));
  } else if (ai.unlimited) box.append(h('p', { class: 'ai-cost', id: 'ai-cost', text: tr('Для вашого облікового запису бали за цей прохід не списуються.') }));
  const low = !ai.unlimited && c && ai.balance != null && ai.balance < c.max;
  if (low) box.append(h('p', { class: 'err', id: 'ai-low', text: tr("Не вистачає балів: потрібно до {0}, на балансі {1}. Поповніть підпискою у Studio.", c.max, ai.balance) }));
  if (chosen && chosen.status === 'busy') box.append(h('p', { class: 'muted', id: 'ai-busy', text: (chosen.note || tr('Модель зараз перевантажена.')) + (usable.length > 1 ? tr(' Можна обрати іншу.') : '') }));
  const again = plan.find((p) => p.secondary), ac = again && aiCost(ai, again.id, ai.modelId);
  if (ac) box.append(h('p', { class: 'muted', id: 'ai-cost-again', text: `${again.label}: ≈ ${credits(ac.expected)}` }));
  return box;
}

function viewActions(d, mine) {
  const book = photoBook(d);
  const box = h('div', { class: 'card', id: 'actions' });
  if (book) box.append(h('strong', { text: tr('План і чернетка книги') }));
  const job = d.job;
  const running = !!(job && job.status === 'running');
  const photosBusy = d.photos.some((p) => p.status === 'processing');
  const unsent = mine.length > 0;
  const unit = textPages(d) ? { a: tr('сторінки'), b: tr('Сторінки'), done: tr('розпізнаються') } : { a: tr('кадри'), b: tr('Кадри'), done: tr('описуються') };
  ensureAi(d);
  const aiWhy = !running && d.photos.length ? aiBlock(d) : '';
  const lock = running || state.writing || photosBusy || unsent || !d.photos.length || !!aiWhy;
  if (running && !job.bookIdeaKind) box.append(h('p', { class: 'row', id: 'job-banner' }, h('span', { class: 'badge processing', text: tr('працює') }), h('span', { text: (book && job.kind === 'structure' ? tr('ШІ складає план книги…') : tr(JOB_TEXT[job.kind]) || tr('ШІ працює…')) + (job.moduleId ? ' ' + moduleTitle(d, job.moduleId) : '') })));
  if (job && job.status === 'failed' && !job.bookIdeaKind) box.append(h('p', { class: 'err', id: 'job-error', text: job.error ? grabApiMessage('server_error', job.error) : tr('Фонова робота не вдалася. Спробуйте ще раз.') }));
  if (!d.photos.length) box.append(h('p', { class: 'muted', text: tr("Спершу додайте {0}.", unit.a) }));
  else if (photosBusy || unsent) box.append(h('p', { class: 'muted', id: textPages(d) ? 'ocr-banner' : null, text: unsent ? tr("Дочекайтесь, поки всі {0} надішлються.", unit.a) : tr("{0} ще {1}…", unit.b, unit.done) }));
  if (!running && d.photos.length) { const pick = viewAiPicker(d); if (pick) box.append(pick); }
  const row = h('div', { class: 'row' });
  const mods = d.structure ? d.structure.modules : [];
  const left = mods.filter((m) => !m.written);
  if (!d.structure) row.append(h('button', { class: 'primary', id: 'btn-structure', text: book ? tr('Скласти план книги') : d.kind === 'instruction' ? tr('Розкласти на кроки') : tr('Розкласти на уроки'), disabled: lock, onclick: () => doStructure(false) }));
  else if (d.status === 'collecting') {
    box.append(h('p', { class: 'muted', id: 'stale-note', text: book ? tr('Матеріали змінилися. Оновіть план книги.') : tr('Після розкладання додано чи змінено кадри — розкладіть уроки заново.') }));
    row.append(confirmBtn(tr('Розкласти заново'), tr('Так, правки в структурі зникнуть'), () => doStructure(true), { disabled: lock, id: 'btn-restructure', class: 'primary' }));
  } else {
    if (d.status !== 'written') row.append(h('button', { class: 'primary', id: 'btn-write', text: (book ? (left.length === mods.length ? tr('Написати чернетку книги') : tr('Дописати глави')) : d.kind === 'instruction' ? left.length === mods.length ? tr('Написати кроки') : tr('Дописати кроки') : left.length === mods.length ? tr('Написати курс') : tr('Дописати курс')), disabled: lock || !left.length, onclick: () => writeModules(left.map((m) => m.moduleId)) }));
    if (d.kind === 'course' && (left.length === 0 || d.status === 'written')) box.append(h('p', { id: 'submit-explain', text: tr('Після «Відправити» Studio створить чернетку курсу й заповнить у розділі «Курси»:') }), coursePlaces(d));
    if (left.length === 0 || d.status === 'written') row.append(h('button', { class: 'primary', id: 'btn-submit', text: book ? tr('Створити книгу в Studio') : d.kind === 'course' ? tr('Відправити курс у Studio') : tr('Відправити в Studio'), disabled: lock, onclick: doSubmit }));
    const again = confirmBtn(tr('Розкласти заново'), tr('Так, правки в структурі зникнуть'), () => doStructure(true), { disabled: lock, id: 'btn-restructure' });
    row.append(again);
  }
  if (state.writing) row.append(h('span', { class: 'muted', text: tr('Пишемо… можна лишитись на сторінці') }));
  box.append(row);
  if (state.blockers) {
    box.append(h('div', { class: 'err', id: 'blockers' }, h('strong', { text: tr('Ще не готово до відправки:') }),
      h('ul', null, state.blockers.map((b) => h('li', { 'data-blocker': b.kind, text: grabBlockerMessage(b, d) })))));
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
  if (j && j.status === 'failed') { toast(j.error ? grabApiMessage('server_error', j.error) : tr('Фонова робота не вдалася.')); return false; }
  return true;
}
async function doStructure(replace) {
  if (photoBook(state.draft)) await saveChain;
  const id = state.draft.draftId;
  state.writing = true; render();
  const body = aiBody(replace ? { replace: true } : undefined);
  try { await runJob(() => api('POST', `/drafts/${id}/structure`, body)); }
  finally { state.writing = false; state.ai = null; render(); }
}
async function writeModules(ids) {
  if (state.writing) return;
  if (photoBook(state.draft)) await saveChain;
  state.writing = true; render();
  try {
    for (const mid of ids) {
      const id = state.draft.draftId;
      const body = aiBody();
      if (!(await runJob(() => api('POST', `/drafts/${id}/modules/${mid}/generate`, body)))) break;
    }
  } finally { state.writing = false; state.ai = null; render(); }
}
async function doSubmit() {
  if (photoBook(state.draft)) await saveChain;
  state.blockers = null;
  try {
    const r = await api('POST', `/drafts/${state.draft.draftId}/submit`);
    state.draft = r.draft; state.target = r.target; toast(tr('Відправлено в Studio.'));
  } catch (e) {
    if (e.kind === 'submit_blocked') state.blockers = e.blockers || [{ kind: 'x', message: e.message }];
    else if (e.kind === 'wrong_status') await reloadDraft();
    else toast(e.message);
  }
  render();
}

/* Куди потрапляє «Набір книги» без наявної книги (контракт 1.5.0): Studio створює книгу сама й кладе розпізнане в три місця. */
function manuscriptPlaces() {
  return h('ul', { class: 'places', id: 'places' },
    h('li', null, h('strong', { text: tr('Дашборд') }), document.createTextNode(tr(' — нова книга зʼявиться в переліку ваших книг.'))),
    h('li', null, h('strong', { text: tr('Книга & Текст') }), document.createTextNode(tr(' — розпізнаний текст у главі, його можна редагувати; він приїжджає чернеткою ШІ — прийміть або виправте.'))),
    h('li', null, h('strong', { text: tr('Медіатека') }), document.createTextNode(tr(' — фото всіх сторінок цієї книги.'))));
}

function coursePlaces(d) {
  const doc = d.courseSource === 'document';
  return h('ul', { class: 'places', id: 'places' },
    h('li', null, h('strong', { text: tr('Курси') }), document.createTextNode(tr(' — нова чернетка курсу: назва, короткий опис, результати навчання й аудиторія.'))),
    h('li', null, h('strong', { text: tr('Модулі й уроки') }), document.createTextNode(doc ? tr(' — назви, мета, теми й текст кожного уроку з вашого документа; усе можна редагувати.') : tr(' — назви, мета, теми й текст кожного уроку; кадри стають фото уроків, перший — обкладинкою.'))),
    h('li', null, h('strong', { text: tr('Що додасте самі') }), document.createTextNode(tr(' — ціну, категорію й відео. Чернетка нікуди не публікується.'))));
}

function viewSubmitted(d) {
  const t = d.submitted || state.target;
  const href = studioTargetUrl(t);
  if (t && t.kind === 'book') {
    const name = d.newBookTitle || d.title || tr('Нова книга');
    return h('div', { class: 'card', id: 'submitted' },
      h('h2', { text: tr('Книгу створено в Studio') }),
      h('p', { id: 'submitted-text', text: photoBook(d) ? tr("Чернетка «{0}» є в «Книга & Текст». Фото додано до медіатеки, описи й авторські нотатки збережено з джерелами.", name) : tr("Studio створила нову книгу «{0}» і поклала розпізнане в три місця:", name) }),
      !photoBook(d) && manuscriptPlaces(),
      h('p', { class: 'muted', text: tr('Відкрийте книгу в розділі «Книга & Текст», щоб перевірити або відредагувати чернетку.') }),
      href && h('p', null, h('a', { class: 'btn primary', id: 'open-studio', href, target: '_blank', rel: 'noopener', text: tr('Відкрити Studio') })));
  }
  if (t && t.kind === 'course') {
    return h('div', { class: 'card', id: 'submitted' },
      h('h2', { text: tr('Курс створено в Studio') }),
      h('p', { id: 'submitted-text', text: tr("Studio створила чернетку курсу «{0}» у розділі «Курси» й заповнила:", d.title || tr('Курс')) }),
      coursePlaces(d),
      h('p', { class: 'muted', text: tr('Відкрийте Studio → «Курси»: перевірте текст уроків, додайте ціну, категорію й відео.') }),
      href && h('p', null, h('a', { class: 'btn primary', id: 'open-studio', href, target: '_blank', rel: 'noopener', text: tr('Відкрити курс у Studio') })));
  }
  return h('div', { class: 'card', id: 'submitted' },
    h('h2', { text: tr('Відправлено в Studio') }),
    h('p', { text: t && t.kind === 'course' ? tr('Чернетку курсу створено — ціну, категорію й відео додасте в Studio.') : t && t.kind === 'express' ? tr('Експрес-чернетку створено. Відкрийте її в Studio протягом 24 годин — потім вона зникне.') : t && t.kind === 'inbox' ? (d.bookId ? tr('Сторінки лежать у «Вхідних» книги одним пакетом — вставте главу звідти.') : tr('Сторінки лежать у «Вхідних» одним пакетом. Створіть книгу в Studio й натисніть «Вставити главу» — текст приїде чернеткою ШІ.')) : tr('Готово.') }),
    href && h('p', null, h('a', { class: 'btn primary', id: 'open-studio', href, target: '_blank', rel: 'noopener', text: tr('Відкрити в Studio') })));
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
  const ai = (les.aiFields || []).includes(field) && h('span', { class: 'badge ai', text: tr('ШІ — перевірте') });
  const chips = d.kind === 'instruction' && field === 'body' ? stepLineChips(el, les.body) : null;
  const suggest = field === 'body' ? viewSuggest(d, les) : null;
  return h('div', null, h('label', null, label, ' ', ai || ''), el, chips, cnt, suggest);
}

/* ---------- пропозиція ШІ до тексту уроку (контракт 1.7.0) ----------
   Власник просив: під полем тексту — кнопка, що просить ШІ запропонувати текст за кадрами уроку й
   вписаною метою; далі «Прийняти», «Внести зміни» (вікно швидкої правки) або «Відхилити повністю».
   Пропозиція НЕ лягає в поле, доки її не прийняли: `body` лишається тим, що був (див. контракт). */

/** Поточний стан по одному уроку: 'asking' (питаємо ціну), 'confirm' (показали ціну), 'running'. */
function suggestState(lessonId) {
  state.suggest = state.suggest || {};
  return state.suggest[lessonId] || null;
}
function setSuggestState(lessonId, value) {
  state.suggest = state.suggest || {};
  if (value) state.suggest[lessonId] = value; else delete state.suggest[lessonId];
  render();
}

function viewSuggest(d, les) {
  const box = h('div', { class: 'suggest', 'data-lesson': les.lessonId });
  const st = suggestState(les.lessonId);
  const job = d.job;
  const busy = !!(job && job.status === 'running');
  const mine = busy && job.kind === 'suggest' && job.lessonId === les.lessonId;
  if (les.suggestion) {
    box.append(
      h('div', { class: 'suggest-head' }, h('span', { class: 'badge ai', text: tr('ШІ пропонує') }),
        h('span', { class: 'muted', text: tr("{0} символів", chars(les.suggestion.text)) })),
      h('p', { class: 'suggest-text', text: les.suggestion.text }),
      h('div', { class: 'row' },
        h('button', { class: 'primary small', 'data-act': 'accept', text: tr('Прийняти пропозицію'), disabled: busy,
          onclick: () => resolveSuggestion(les.lessonId, 'accept') }),
        h('button', { class: 'small', 'data-act': 'edit', text: tr('Внести зміни'), disabled: busy,
          onclick: () => openSuggestEditor(les) }),
        h('button', { class: 'small', 'data-act': 'reject', text: tr('Відхилити пропозицію повністю'), disabled: busy,
          onclick: () => resolveSuggestion(les.lessonId, 'reject') })),
      h('p', { class: 'muted', text: tr('Доки не вирішите — текст уроку лишається таким, як зараз.') }));
    return box;
  }
  if (mine || (st && st.phase === 'running')) {
    box.append(h('p', { class: 'row' }, h('span', { class: 'badge processing', text: tr('працює') }),
      h('span', { text: tr('ШІ пише підказку до цього уроку…') })));
    return box;
  }
  if (st && st.phase === 'asking') {
    box.append(h('p', { class: 'muted', text: tr('Рахую вартість підказки…') }));
    return box;
  }
  if (st && st.phase === 'confirm') {
    box.append(h('p', { class: 'muted', text: st.message }),
      h('div', { class: 'row' },
        h('button', { class: 'primary small', 'data-act': 'go', text: st.cost ? tr("Так, підказати ({0})", credits(st.cost)) : tr('Так, підказати'),
          onclick: () => startSuggest(les.lessonId, st.modelId) }),
        h('button', { class: 'small', text: tr('Скасувати'), onclick: () => setSuggestState(les.lessonId, null) })));
    return box;
  }
  box.append(h('button', { class: 'small', 'data-act': 'suggest', text: tr('✨ Підказати текст ШІ'), disabled: busy || state.writing,
    onclick: () => askSuggest(d, les.lessonId) }));
  if (st && st.error) box.append(h('p', { class: 'err', text: st.error }));
  return box;
}

/** Крок 1 — ціна. Питаємо Studio ДО запуску: бали списуються, і їх розмір автор має бачити заздалегідь. */
async function askSuggest(d, lessonId) {
  setSuggestState(lessonId, { phase: 'asking' });
  try {
    const r = await api('GET', `/drafts/${d.draftId}/ai-options?pass=lesson&lessonId=${encodeURIComponent(lessonId)}`);
    const usable = (r.models || []).filter((m) => m.usable);
    if (!usable.length) { setSuggestState(lessonId, { error: tr('Жодна модель ШІ зараз недоступна.') }); return; }
    const saved = aiStored();
    const modelId = [state.ai && state.ai.modelId, saved, r.defaultModelId].find((id) => id && usable.some((m) => m.modelId === id)) || usable[0].modelId;
    const picked = usable.find((m) => m.modelId === modelId);
    const cost = picked && picked.credits ? picked.credits.expected : null;
    const max = picked && picked.credits ? picked.credits.max : null;
    if (!r.unlimited && max != null && r.balance != null && r.balance < max) {
      setSuggestState(lessonId, { error: tr("Не вистачає балів: потрібно до {0}, на балансі {1}.", max, r.balance) });
      return;
    }
    const message = r.unlimited
      ? tr("{0}: для вашого облікового запису бали не списуються.", picked.label)
      : `${picked.label}: ≈ ${credits(cost ?? 0)}` + (r.balance != null ? tr(" · на балансі {0}", r.balance) : '');
    setSuggestState(lessonId, { phase: 'confirm', message, cost: r.unlimited ? null : cost, modelId });
  } catch (e) {
    setSuggestState(lessonId, { error: e.message });
  }
}

/** Крок 2 — сам прохід. Фоновий, як решта: чекаємо завершення опитуванням. */
async function startSuggest(lessonId, modelId) {
  if (state.writing) return;
  setSuggestState(lessonId, { phase: 'running' });
  state.writing = true; render();
  const id = state.draft.draftId;
  try {
    await runJob(() => api('POST', `/drafts/${id}/lessons/${encodeURIComponent(lessonId)}/suggest`, modelId ? { modelId } : undefined));
  } finally {
    state.writing = false;
    state.ai = null;
    setSuggestState(lessonId, null);
  }
}

/** Крок 3 — рішення викладача. `text` — виправлений у вікні варіант. */
async function resolveSuggestion(lessonId, action, text) {
  const id = state.draft.draftId;
  try {
    const r = await api('POST', `/drafts/${id}/lessons/${encodeURIComponent(lessonId)}/suggestion`,
      { action, ...(text !== undefined ? { text } : {}) });
    state.draft = r.draft; state.blockers = null;
  } catch (e) {
    toast(e.message);
    await reloadDraft();
  }
  render();
}

/* Вікно швидкої правки: пропозиція вже написана, лишилось підправити формулювання й зберегти. */
function openSuggestEditor(les) {
  const area = h('textarea', { rows: 10, 'aria-label': tr('Текст пропозиції') });
  area.value = (les.suggestion && les.suggestion.text) || '';
  const close = () => { overlay.remove(); state.editing = false; };
  const save = async () => { const v = area.value; close(); await resolveSuggestion(les.lessonId, 'accept', v); };
  const win = h('div', { class: 'modal-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('Внести зміни в пропозицію') },
    h('h3', { text: tr('Внести зміни') }),
    h('p', { class: 'muted', text: tr('Виправте текст і збережіть — він ляже в поле «Текст уроку» як ваш.') }),
    area,
    h('div', { class: 'row' },
      h('button', { class: 'primary', text: tr('Зберегти в урок'), onclick: () => void save() }),
      h('button', { text: tr('Скасувати'), onclick: close })));
  const overlay = h('div', { class: 'modal', onclick: (e) => { if (e.target === overlay) close(); } }, win);
  document.body.append(overlay);
  state.editing = true;
  area.focus();
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
function saveLesson(lessonId, fields) { return serial(async () => {
  try {
    const r = await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, lessons: [{ lessonId, ...fields }] });
    state.draft = r.draft; state.blockers = null;
  } catch (e) { toast(e.kind === 'revision_conflict' ? tr('Чернетку змінено з іншого пристрою — оновлюю.') : e.message); await reloadDraft(); }
}); }
function setAssumption(id, status) { return serial(async () => {
  try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, assumptions: [{ assumptionId: id, status }] })).draft; state.blockers = null; }
  catch (e) { toast(e.message); await reloadDraft(); }
  render();
}); }

const termsFor = (d) => ({
  book: { structure: tr('План книги'), lesson: tr('Сцена'), title: tr('Назва сцени'), goal: tr('Що має відбутися'), body: tr('Чернетка сцени') },
  course: { structure: tr('Структура курсу'), lesson: tr('Урок'), title: tr('Назва уроку'), goal: tr('Мета'), body: tr('Текст уроку') },
  instruction: { structure: tr('Кроки інструкції'), lesson: tr('Крок'), title: tr('Назва кроку'), goal: tr('Мета кроку'), body: tr('Опис кроку') },
})[d.kind === 'book' || d.kind === 'instruction' ? d.kind : 'course'];
const STEP_LINES = ['Деталі', 'Інструменти', 'Увага', 'Результат кроку'];
const MAX_SOURCE_STEPS = 20; // Studio робить кроки-джерела з перших 20; решта дописується до останнього
const hasLine = (text, key) => {
  const english = GRAB_EN[key];
  return (text || '').split('\n').some((line) =>
    line.startsWith(`**${key}:**`) || line.startsWith(`**${english}:**`));
};

/* Інструкція: режим і код виробу (PATCH instructionMode / modelCode) */
function viewInstructionMeta(d) {
  const mode = h('select', { id: 'i-mode' }, h('option', { value: 'assembly', text: tr('Складання') }), h('option', { value: 'operation', text: tr('Користування') }));
  mode.value = d.instructionMode || 'assembly';
  const model = h('input', { id: 'i-model', maxlength: 200, placeholder: tr('Код або модель виробу'), value: d.modelCode || '' });
  const save = (fields) => serial(async () => {
    try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, ...fields })).draft; state.blockers = null; }
    catch (e) { toast(e.kind === 'revision_conflict' ? tr('Чернетку змінено з іншого пристрою — оновлюю.') : e.message); await reloadDraft(); }
  });
  mode.addEventListener('change', () => save({ instructionMode: mode.value }));
  model.addEventListener('focus', () => { state.editing = true; });
  model.addEventListener('blur', async () => { const v = model.value.trim(); if (v !== (state.draft.modelCode || '')) await save({ modelCode: v }); endEditing(); });
  return h('div', { class: 'card', id: 'instruction-meta' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', { text: tr('Що описуємо') }), mode), h('div', { class: 'grow' }, h('label', { text: tr('Код або модель виробу') }), model)),
    h('p', { class: 'muted', text: tr('Кожен крок спирається на свої кадри. Деталі, інструменти, застереження й результат пишіть окремими рядками — Studio розкладе їх по полях кроку.') }));
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
  catch (e) { toast(e.kind === 'revision_conflict' ? tr('Чернетку змінено з іншого пристрою — оновлюю.') : e.message); await reloadDraft(); }
  render();
}); }

function stepFrames(d, les) {
  const byId = new Map(d.photos.map((p) => [p.photoId, p]));
  const steps = d.structure.modules.flatMap((m) => m.lessons);
  const wrap = h('div', { class: 'thumbs big' });
  les.photoIds.forEach((id) => {
    const p = byId.get(id); if (!p) return;
    const sel = h('select', { class: 'move', 'data-move': id, title: tr('Перенести кадр в інший крок') }, h('option', { value: '', text: tr("Кадр {0} →", p.order) }),
      steps.filter((x) => x.lessonId !== les.lessonId).map((x) => h('option', { value: x.lessonId, text: tr('до «{0}»', (x.title || x.lessonId).slice(0, 30)) })));
    sel.addEventListener('change', () => { if (sel.value) moveFrame(id, sel.value); });
    wrap.append(h('div', { class: 'frame-chip' }, photoPreview(`api/drafts/${d.draftId}/photos/${id}/image`, tr("Кадр №{0}", p.order)), sel));
  });
  if (!les.photoIds.length) wrap.append(h('p', { class: 'err', 'data-nofram': les.lessonId, text: tr('У кроку немає кадру — перенесіть сюди кадр з іншого кроку.') }));
  return wrap;
}

function stepLineChips(ta, body) {
  const row = h('div', { class: 'row chips', 'data-chips': '' });
  STEP_LINES.forEach((k) => {
    const b = h('button', { type: 'button', class: 'small chip', 'data-key': k, text: (hasLine(body, k) ? '✓ ' : '+ ') + tr(k), onclick: () => {
      if (!hasLine(ta.value, k)) { ta.value = (ta.value && !ta.value.endsWith('\n') ? ta.value + '\n' : ta.value) + `**${tr(k)}:** `; ta.dispatchEvent(new Event('input')); }
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    } });
    row.append(b);
  });
  const mark = () => row.querySelectorAll('button').forEach((b) => { const on = hasLine(ta.value, b.dataset.key); b.textContent = (on ? '✓ ' : '+ ') + tr(b.dataset.key); b.classList.toggle('on', on); });
  ta.addEventListener('input', mark); mark();
  return row;
}

/* ---------- етап 6: «Набір книги» (рукопис із фото сторінок) ---------- */
function viewDocMeta(d) {
  const hint = h('input', { id: 'ms-hint', maxlength: 500, placeholder: tr('Імена, терміни, мова, почерк — для всіх наступних сторінок'), value: state.hint });
  hint.addEventListener('focus', () => { state.editing = true; });
  hint.addEventListener('input', () => { state.hint = hint.value; });
  hint.addEventListener('blur', endEditing);
  return h('div', { class: 'card', id: 'doc-meta' },
    h('label', { text: tr('Підказка розпізнаванню') }), hint,
    h('p', { class: 'muted', text: tr('Скануйте або фотографуйте сторінки документа по порядку. Текст розпізнається дослівно — його можна виправити нижче; з нього ШІ складе опис, результати, модулі й уроки курсу.') }));
}

function viewMsMeta(d) {
  const title = h('input', { id: 'ms-title', maxlength: 160, placeholder: tr('Назва глави, напр. «Розділ 1. Млин»'), value: d.title || '' });
  const existing = !!d.bookId;
  const type = h('select', { id: 'ms-booktype' }, h('option', { value: 'new', text: tr('Нова книга') }), h('option', { value: 'existing', text: tr('Існуюча книга (за ID)') }));
  type.value = existing ? 'existing' : 'new';
  const book = h('input', { id: 'ms-book', placeholder: existing ? tr('ID книги в Studio') : tr('Назва нової книги'), value: existing ? d.bookId : (d.newBookTitle || '') });
  type.addEventListener('change', () => { book.placeholder = type.value === 'existing' ? tr('ID книги в Studio') : tr('Назва нової книги'); book.value = ''; book.focus(); });
  const hint = h('input', { id: 'ms-hint', maxlength: 500, placeholder: tr('Імена героїв, мова, почерк — для всіх наступних сторінок'), value: state.hint });
  const save = (fields) => serial(async () => {
    try { state.draft = (await api('PATCH', '/drafts/' + state.draft.draftId, { ifRevision: state.draft.revision, ...fields })).draft; state.blockers = null; }
    catch (e) { toast(e.kind === 'revision_conflict' ? tr('Чернетку змінено з іншого пристрою — оновлюю.') : e.message); await reloadDraft(); }
  });
  for (const el of [title, book, hint]) { el.addEventListener('focus', () => { state.editing = true; }); }
  title.addEventListener('blur', async () => { const v = title.value.trim(); if (v !== (state.draft.title || '')) await save({ title: v }); endEditing(); });
  book.addEventListener('blur', async () => {
    const v = book.value.trim();
    const cur = state.draft.bookId || state.draft.newBookTitle || '';
    if (v !== cur || (type.value === 'existing') !== !!state.draft.bookId) await save(type.value === 'existing' ? { bookId: v || null, newBookTitle: null } : { newBookTitle: v || null, bookId: null });
    endEditing();
  });
  hint.addEventListener('input', () => { state.hint = hint.value; });
  hint.addEventListener('blur', endEditing);
  return h('div', { class: 'card', id: 'ms-meta' },
    h('label', { text: tr('Глава') }), title,
    h('label', { text: tr('Куди') }), h('div', { class: 'row' }, h('div', { style: 'flex:0 0 11em' }, type), h('div', { class: 'grow' }, book)),
    h('label', { text: tr('Підказка розпізнаванню') }), hint,
    h('p', { class: 'muted', text: tr('Знімайте сторінки по порядку. Текст розпізнається дослівно — його можна виправити нижче.') }));
}

function viewMsActions(d, mine) {
  const processing = d.photos.some((p) => p.status === 'processing');
  const lock = processing || mine.length > 0 || !d.photos.length || state.writing;
  const box = h('div', { class: 'card', id: 'actions' });
  if (!d.photos.length) box.append(h('p', { class: 'muted', text: tr('Спершу зніміть хоч одну сторінку.') }));
  else if (mine.length) box.append(h('p', { class: 'muted', text: tr('Дочекайтесь, поки всі сторінки надішлються.') }));
  else if (processing) box.append(h('p', { class: 'muted', id: 'ocr-banner', text: tr('Сторінки розпізнаються…') }));
  // Що станеться після натискання — одразу над кнопкою (запит власника 10.11.2026).
  if (!d.bookId) {
    box.append(h('p', { id: 'submit-explain', text: tr("Після «Відправити» Studio сама створить нову книгу «{0}» і покладе розпізнане в три місця:", d.newBookTitle || d.title || tr('Нова книга')) }), manuscriptPlaces());
  } else {
    box.append(h('p', { class: 'muted', id: 'submit-explain', text: tr('Після «Відправити» сторінки потраплять у «Вхідні» вибраної книги одним пакетом — вставте главу звідти.') }));
  }
  box.append(h('div', { class: 'row' }, h('button', { class: 'primary', id: 'btn-submit', text: tr('Відправити главу у Studio'), disabled: lock, onclick: doSubmit })));
  if (state.blockers) box.append(h('div', { class: 'err', id: 'blockers' }, h('strong', { text: tr('Ще не готово до відправки:') }),
    h('ul', null, state.blockers.map((b) => h('li', { 'data-blocker': b.kind, text: grabBlockerMessage(b, d) })))));
  return box;
}

function saveText(photoId, text) {
  return serial(async () => {
    try {
      const r = await api('PUT', `/drafts/${state.draft.draftId}/photos/${photoId}/text`, { text });
      const i = state.draft.photos.findIndex((p) => p.photoId === photoId);
      if (i >= 0) state.draft.photos[i] = r.photo;
      state.draft.revision = r.revision; state.blockers = null;
    } catch (e) { toast(e.message); await reloadDraft(); }
  });
}

function pageCard(p, i, total, readOnly) {
  const maxText = state.limits ? state.limits.maxPageTextChars : 20000;
  const processing = p.status === 'processing';
  const ta = h('textarea', { rows: 6, 'data-field': 'text', readonly: readOnly || processing, placeholder: processing ? tr('Розпізнається…') : tr('Тексту немає — введіть вручну або приберіть сторінку') });
  ta.value = p.text || '';
  const cnt = h('div', { class: 'counter' });
  const upd = () => { const n = chars(ta.value); cnt.textContent = `${n} / ${maxText}`; cnt.className = 'counter' + (n > maxText ? ' over' : ''); };
  upd();
  ta.addEventListener('focus', () => { state.editing = true; });
  ta.addEventListener('input', upd);
  ta.addEventListener('blur', async () => {
    if (!readOnly && ta.value !== (p.text || '') && chars(ta.value) <= maxText) { await saveText(p.photoId, ta.value); state.needsRender = true; }
    endEditing();
  });
  const empty = p.status === 'described' && !(p.text || '').trim();
  const hintNote = (state.draft.notes || []).find((n) => n.photoIds.includes(p.photoId));
  return h('div', { class: 'card frame', 'data-page': p.photoId },
    photoPreview(`api/drafts/${state.draft.draftId}/photos/${p.photoId}/image`, tr("Сторінка №{0}", p.order)),
    h('div', null,
      h('div', { class: 'row' }, h('strong', { text: tr('Сторінка ') + p.order }),
        h('span', { class: 'badge ' + p.status, text: { processing: tr('розпізнається…'), described: tr('розпізнано'), failed: tr('не вдалося') }[p.status] || p.status }),
        p.textEdited && h('span', { class: 'badge', text: tr('правлено') }),
        empty && h('span', { class: 'badge failed', text: tr('немає тексту') })),
      p.status === 'failed' && h('p', { class: 'err', text: p.error ? grabApiMessage('bad_image', p.error) : tr('Не вдалося розпізнати сторінку.') }),
      hintNote && h('p', { class: 'muted', text: tr('Підказка: ') + hintNote.text }),
      ta, cnt,
      !readOnly && h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'small', text: '↑', title: tr('Вище'), disabled: i === 0, onclick: () => movePhoto(p.photoId, -1) }),
        h('button', { class: 'small', text: '↓', title: tr('Нижче'), disabled: i === total - 1, onclick: () => movePhoto(p.photoId, 1) }),
        p.status === 'failed' && h('button', { class: 'small', text: tr('Повторити'), onclick: async () => { try { await api('POST', `/drafts/${state.draft.draftId}/photos/${p.photoId}/retry`); await reloadDraft(); } catch (e) { toast(e.message); } } }),
        h('button', { class: 'small danger', text: tr('Видалити'), onclick: async () => { try { state.draft = (await api('DELETE', `/drafts/${state.draft.draftId}/photos/${p.photoId}`)).draft; render(); } catch (e) { toast(e.message); } } }))));
}

function pagesSection(d, mine, readOnly) {
  const pages = d.photos.slice().sort((a, b) => a.order - b.order);
  const list = h('div', { class: 'frames', id: 'pages' });
  pages.forEach((p, i) => list.append(pageCard(p, i, pages.length, readOnly)));
  if (!readOnly) mine.forEach((q) => list.append(queuedCard(q)));
  if (!pages.length && !mine.length) list.append(h('p', { class: 'muted', text: tr('Сторінок ще немає.') }));
  if (d.kind === 'course' && d.structure) {
    const det = h('details', { id: 'pages-section' }, h('summary', { text: tr("Сторінки ({0})", pages.length) }), list);
    if (state.photosOpen) det.setAttribute('open', '');
    det.addEventListener('toggle', () => { state.photosOpen = det.open; });
    return det;
  }
  return h('div', null, h('h3', { text: tr('Сторінки') }), list);
}

function viewStructure(d) {
  const box = h('div', { id: 'structure' });
  const T = termsFor(d);
  box.append(h('h3', { text: T.structure }));
  if (d.kind === 'course' && (d.structure.summary || (d.structure.outcomes || []).length)) {
    box.append(h('div', { class: 'card', id: 'course-about' }, h('strong', { text: tr('Про курс (запропонував ШІ)') }),
      d.structure.summary && h('p', { id: 'course-summary', text: d.structure.summary }),
      (d.structure.outcomes || []).length ? h('div', null, h('span', { class: 'muted', text: tr('Після курсу учень зможе:') }), h('ul', { id: 'course-outcomes' }, d.structure.outcomes.map((o) => h('li', { text: o })))) : null,
      h('p', { class: 'muted', text: tr('Ці поля потрапляють у курс у Studio; там їх можна змінити.') })));
  }
  const stepCount = d.structure.modules.reduce((n, m) => n + m.lessons.length, 0);
  if (d.kind === 'instruction' && stepCount > MAX_SOURCE_STEPS) box.append(h('p', { class: 'muted', id: 'steps-over', text: tr("Кроків {0}: Studio зробить джерелами перші {1}, решту допише до останнього.", stepCount, MAX_SOURCE_STEPS) }));
  const open = d.assumptions.filter((a) => a.status === 'open');
  if (d.assumptions.length) {
    box.append(h('div', { class: 'card', id: 'assumptions' }, h('strong', { text: tr('ШІ припустив — підтвердьте або відхиліть') }),
      d.assumptions.map((a) => h('div', { class: 'row', 'data-assumption': a.assumptionId, style: 'margin-top:8px' },
        h('span', { class: 'grow', text: a.text }),
        h('span', { class: 'badge ' + (a.status === 'open' ? 'processing' : a.status === 'confirmed' ? 'described' : 'failed'), text: { open: tr('очікує'), confirmed: tr('підтверджено'), rejected: tr('відхилено') }[a.status] }),
        a.status !== 'confirmed' && h('button', { class: 'small', 'data-act': 'confirm', text: tr('Підтвердити'), onclick: () => setAssumption(a.assumptionId, 'confirmed') }),
        a.status !== 'rejected' && h('button', { class: 'small', 'data-act': 'reject', text: tr('Відхилити'), onclick: () => setAssumption(a.assumptionId, 'rejected') })))));
  }
  const byId = new Map(d.photos.map((p) => [p.photoId, p]));
  d.structure.modules.forEach((m, mi) => {
    const running = d.job && d.job.status === 'running' && d.job.moduleId === m.moduleId;
    const card = h('div', { class: 'card', 'data-module': m.moduleId },
      h('div', { class: 'row' }, h('strong', { class: 'grow', text: `${mi + 1}. ${m.title}` }),
        h('span', { class: 'badge ' + (m.written ? 'described' : running ? 'processing' : ''), text: m.written ? tr('текст є') : running ? tr('пишеться…') : tr('без тексту') }),
        h('button', { class: 'small', text: m.written ? tr('Переписати') : tr('Написати'), disabled: state.writing || !!(d.job && d.job.status === 'running'), onclick: () => writeModules([m.moduleId]) })),
      m.summary && h('p', { class: 'muted', text: m.summary }));
    m.lessons.forEach((les) => {
      card.append(h('div', { class: 'lesson', 'data-lesson': les.lessonId },
        d.kind === 'instruction' ? stepFrames(d, les) : h('div', { class: 'thumbs' }, les.photoIds.map((id) => byId.has(id) && photoPreview(`api/drafts/${d.draftId}/photos/${id}/image`, tr("Кадр №{0}", byId.get(id).order)))),
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
      draftId: state.draft.draftId, blob, note: textPages(state.draft) ? (state.hint || '') : '', state: 'queued', error: '',
      takenAt: f.lastModified ? new Date(f.lastModified).toISOString() : null, order: Date.now() + Math.random(),
    };
    await qPut(it); state.queue.push(it);
  }
  render(true); flushQueue();
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
        it.state = 'failed'; it.error = e.message; it.errorKind = e.kind; await qPut(it);
        if (state.view === 'draft') render();
      }
    }
  } finally { flushing = false; }
  if (retryIn) flushTimer = setTimeout(flushQueue, retryIn);
  else if (state.draft) { await reloadDraft(); schedulePoll(); }
}

/* ---------- старт ---------- */
async function ensureStudioOrigin() {
  if (state.studioOrigin) return true;
  try { configureStudio(await api('GET', '/config')); } catch (e) { /* Present a localized error below. */ }
  if (!state.studioOrigin) toast(tr('Адреса Студії книг недоступна. Спробуйте ще раз.'));
  return !!state.studioOrigin;
}
function configureStudio(cfg) {
  state.studioOrigin = (cfg.studioPublicUrl || new URL(cfg.studioUrl).origin).replace(/\/$/, '');
}
async function start(opts) {
  try { state.limits = (await api('GET', '/limits')).limits; } catch (e) { /* дефолти */ }
  // Посилання на Студію ведемо на справжню адресу (studioPublicUrl, напр. https://www.fusionlab.in.ua/studio); без неї — на походження API.
  try { configureStudio(await api('GET', '/config')); } catch (e) { /* без посилання */ }
  try { state.privateStores = (await api('GET', '/private-stores')).stores || []; } catch (e) { state.privateStores = []; }
  state.queue = await qAll();
  state.privateDrafts = await pDrafts();
  void flushPrivate();
  document.getElementById('btn-logout').hidden = false;
  await openList();
  if (opts && opts.chooseFirst) go('choose'); // щойно підключили телефон: спершу «що створюємо?»
  if (state.queue.length) flushQueue();
}
function viewOffline() {
  return h('div', { class: 'card' },
    h('p', { text: tr('Немає звʼязку з сервісом.') }),
    state.queue.length ? h('p', { class: 'muted', text: tr('Фото в черзі: {0} — вони надішлються, коли звʼязок зʼявиться.', state.queue.length) }) : null,
    h('button', { class: 'primary', text: tr('Спробувати знову'), onclick: () => location.reload() }));
}
(async function boot() {
  setNet();
  const qrCode = pairCodeFromHash(location.hash);
  if (qrCode) {
    // Код одноразовий: з адреси його прибираємо ще до обміну, щоб він не лишився в історії й закладках.
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const r = await api('POST', '/pair', { code: qrCode });
      state.user = r.user; await start({ chooseFirst: true }); return;
    } catch (e) {
      state.pairNotice = e.kind === 'network'
        ? tr('Немає звʼязку з сервісом. Відскануйте QR ще раз, коли звʼязок зʼявиться.')
        : (e.message || tr('Не вдалося підключитись за QR.')) + tr(' Створіть новий QR у Studio або введіть код вручну.');
      go('pair'); return;
    }
  }
  try {
    const s = await api('GET', '/session');
    if (s.paired) { state.user = s.user; await start(); } else go('pair');
  } catch (e) {
    if (e.kind !== 'network') { go('pair'); return; }
    // Без звʼязку при відкритті: не кидаємо на екран підключення, фото в черзі нікуди не діваються.
    state.queue = await qAll(); go('offline');
  }
})();

/* ---------- PWA: service worker, встановлення, повернення в застосунок ---------- */
if ('serviceWorker' in navigator) {
  // SW працює лише в безпечному контексті (https або localhost); без нього сторінка просто не офлайн.
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
}
let installPrompt = null;
const installBtn = document.getElementById('btn-install');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (!isStandalone()) installBtn.hidden = false; });
addEventListener('appinstalled', () => { installPrompt = null; installBtn.hidden = true; });
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch (e) { /* не критично */ }
  installPrompt = null; installBtn.hidden = true;
});
(function iosHint() {
  // Safari на iPhone/iPad не показує запит на встановлення — підказуємо шлях вручну (раз).
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let seen = false;
  try { seen = localStorage.getItem('gf_ios_hint') === '1'; } catch (e) { /* без сховища */ }
  const box = document.getElementById('install-hint');
  if (!ios || isStandalone() || seen) return;
  box.hidden = false;
  document.getElementById('install-hint-close').addEventListener('click', () => {
    box.hidden = true;
    try { localStorage.setItem('gf_ios_hint', '1'); } catch (e) { /* не критично */ }
  });
})();
// Повернулись у застосунок із фону — надсилаємо те, що назбиралось без звʼязку.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine && state.queue && state.queue.length) flushQueue(); });
