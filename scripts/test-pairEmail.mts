/**
 * Тести коду підключення GrabFusion на пошту (журнал #541).
 * Запуск: npm run test:pair-email
 *
 *  1. Чисті частини: нормалізація пошти, ліміти, зміст листа.
 *  2. Логіка `requestPairingEmail` з підставною поштою: відповідь не видає, чи є обліковий запис; ліміти; роль; TTL; не скасовує QR.
 *  3. Справжній маршрут POST /api/external/v1/pair/email і обмін отриманого коду на токен (одноразово).
 *  4. СПРАВЖНІЙ SMTP: локальний приймач SMTP із автентифікацією (протокол, не підстава) — лист реально доходить, у ньому код і посилання.
 */
import net from 'node:net';

// ---- Локальний SMTP-приймач: до імпорту server/mail (він читає SMTP_* при завантаженні) -------------------------------------
interface Received {
  from: string;
  to: string[];
  raw: string;
}
const inbox: Received[] = [];
const smtp = net.createServer((sock) => {
  let buf = '';
  let inData = false;
  let data = '';
  let cur: Received = { from: '', to: [], raw: '' };
  let authStep: 'user' | 'pass' | null = null;
  sock.write('220 localhost ESMTP test\r\n');
  const handleLine = (line: string) => {
    if (inData) {
      if (line === '.') {
        inData = false;
        cur.raw = data;
        inbox.push(cur);
        cur = { from: '', to: [], raw: '' };
        data = '';
        sock.write('250 queued\r\n');
      } else {
        data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
      }
      return;
    }
    if (authStep === 'user') {
      authStep = 'pass';
      sock.write('334 UGFzc3dvcmQ6\r\n');
      return;
    }
    if (authStep === 'pass') {
      authStep = null;
      sock.write('235 ok\r\n');
      return;
    }
    const cmd = line.toUpperCase();
    if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
    else if (cmd.startsWith('AUTH PLAIN')) sock.write('235 ok\r\n');
    else if (cmd.startsWith('AUTH LOGIN')) {
      authStep = 'user';
      sock.write('334 VXNlcm5hbWU6\r\n');
    } else if (cmd.startsWith('MAIL FROM')) {
      cur.from = line.slice(10);
      sock.write('250 ok\r\n');
    } else if (cmd.startsWith('RCPT TO')) {
      cur.to.push(line.slice(8));
      sock.write('250 ok\r\n');
    } else if (cmd === 'DATA') {
      inData = true;
      sock.write('354 go\r\n');
    } else if (cmd === 'QUIT') {
      sock.write('221 bye\r\n');
      sock.end();
    } else sock.write('250 ok\r\n');
  };
  sock.on('data', (chunk) => {
    buf += chunk.toString('latin1');
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      handleLine(line);
    }
  });
  sock.on('error', () => undefined);
});
await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
const smtpPort = (smtp.address() as net.AddressInfo).port;
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtpPort);
process.env.SMTP_USER = 'tester';
process.env.SMTP_PASS = 'secret';
process.env.SMTP_FROM = 'GrabFusion Test <noreply@test.local>';
process.env.SMTP_SECURE = 'false';

const DIR = '/tmp/nova-pair-email-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.GRABFUSION_PUBLIC_URL = 'https://www.fusionlab.in.ua/grabfisionstidio';

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const pe = await import('../server/external/pairEmail');
const pc = await import('../server/external/pairingCodes');
const xroutes = await import('../server/external/externalApiRoutes');
const storeMod = await import('../server/store');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

// ---------------------------------------------------------------------------
console.log('\nЧисті частини');
{
  t('пошта нормалізується (регістр, пробіли)', pe.normalizeEmail('  Anna@Test.UA ') === 'anna@test.ua');
  t('не схоже на пошту — null', [undefined, null, 5, '', 'abc', 'a@b', 'a b@c.ua', '<x>@y.ua', 'a@'.padEnd(300, 'x') + '.ua'].every((v) => pe.normalizeEmail(v) === null));
  let clock = 1_000_000;
  const lim = new pe.PairEmailLimiter(() => clock);
  const takes = [1, 2, 3].map(() => lim.take('1.1.1.1', 'a@t.ua'));
  t('одній пошті — не більше 3 листів за вікно', takes.every((x) => x === null) && lim.take('1.1.1.1', 'a@t.ua') === 'email');
  clock += pe.PAIR_EMAIL_LIMITS.emailWindowMs + 1;
  t('після вікна знову можна', lim.take('1.1.1.1', 'a@t.ua') === null);
  const lim2 = new pe.PairEmailLimiter(() => clock);
  let ipHit: string | null = null;
  for (let i = 0; i < 10 && !ipHit; i++) ipHit = lim2.take('9.9.9.9', `u${i}@t.ua`);
  t('з однієї адреси — не більше 8 запитів за вікно', ipHit === 'ip');
  const lim3 = new pe.PairEmailLimiter(() => clock);
  let globalHit: string | null = null;
  for (let i = 0; i < 120 && !globalHit; i++) globalHit = lim3.take(`10.0.${i % 250}.${Math.floor(i / 250)}`, `g${i}@t.ua`);
  t('на всю Студію — стеля листів за годину', globalHit === 'global');

  const c = pe.pairingEmailContent({ code: 'ABCD-EFGH', link: 'https://x.ua/app#pair=ABCD-EFGH', minutes: 15, name: 'Ірина' });
  t('лист: код, посилання, строк і ім’я', [c.html, c.text].every((s) => s.includes('ABCD-EFGH') && s.includes('#pair=ABCD-EFGH') && s.includes('15')) && c.text.includes('Ірина'));
  t('лист: попередження «якщо не просили»', /не просили/.test(c.text) && /не просили/.test(c.html));
  const noLink = pe.pairingEmailContent({ code: 'ABCD-EFGH', link: null, minutes: 15 });
  t('без адреси застосунку — лише код, без битого посилання', !noLink.html.includes('href=') && noLink.text.includes('ABCD-EFGH'));
}

// ---------------------------------------------------------------------------
console.log('\nЛогіка запиту (підставна пошта)');
{
  let now = 5_000_000;
  const store = new pc.PairingCodeStore(() => now);
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const users: Record<string, any> = {
    'anna@t.ua': { id: 'u-anna', email: 'anna@t.ua', name: 'Анна', role: 'writer' },
    'reader@t.ua': { id: 'u-reader', email: 'reader@t.ua', name: 'Читач', role: 'reader' },
    'off@t.ua': { id: 'u-off', email: 'off@t.ua', name: 'Вимкнений', role: 'writer', disabled: true },
  };
  const mk = (over: Partial<import('../server/external/pairEmail').PairEmailDeps> = {}): import('../server/external/pairEmail').PairEmailDeps => ({
    store,
    limiter: new pe.PairEmailLimiter(() => now),
    mailEnabled: () => true,
    findUserByEmail: async (e) => users[e] ?? null,
    canEditContent: async (r) => r !== 'reader',
    sendMail: async (m) => (sent.push(m), { ok: true }),
    publicUrl: () => 'https://www.fusionlab.in.ua/grabfisionstidio',
    ...over,
  });
  const deps = mk();
  const screen = store.issue('u-anna', 'GrabFusion', 'photo-drafts'); // код на екрані Студії
  const ok = await pe.requestPairingEmail(deps, { email: 'Anna@T.ua', ip: '1.1.1.1' });
  t('існуючий акаунт: лист надіслано', ok.kind === 'sent');
  if (ok.kind === 'sent') await ok.delivery;
  t('лист пішов на адресу акаунта, з кодом і посиланням `#pair=`', sent.length === 1 && sent[0].to === 'anna@t.ua' && /#pair=[A-Z0-9]{4}-[A-Z0-9]{4}/.test(sent[0].text), JSON.stringify(sent[0]?.text).slice(0, 120));
  const code = (/#pair=([A-Z0-9-]+)/.exec(sent[0].text) ?? [])[1];
  t('код із листа працює, область — photo-drafts', (() => { const r = store.redeem(code, 'x'); return r.ok === true && (r as any).userId === 'u-anna' && (r as any).scope === 'photo-drafts'; })());
  t('код зі Студії, який автор бачив на екрані, НЕ скасовано листом', (() => { const r = store.redeem(screen.display, 'x'); return r.ok === true; })());
  const e2 = await pe.requestPairingEmail(deps, { email: 'anna@t.ua', ip: '1.1.1.1' });
  if (e2.kind === 'sent') await e2.delivery;
  const code2 = (/#pair=([A-Z0-9-]+)/.exec(sent[1].text) ?? [])[1];
  now += 14 * 60_000;
  t('код із листа живе 15 хв (на 14-й ще діє)', store.redeem(code2, 'x').ok === true);
  const e3 = await pe.requestPairingEmail(deps, { email: 'anna@t.ua', ip: '1.1.1.1' });
  if (e3.kind === 'sent') await e3.delivery;
  const code3 = (/#pair=([A-Z0-9-]+)/.exec(sent[2].text) ?? [])[1];
  now += 16 * 60_000;
  const late = store.redeem(code3, 'x');
  t('…а на 16-й прострочений', late.ok === false && (late as any).reason === 'expired');

  for (const [name, email] of [['невідома пошта', 'nobody@t.ua'], ['вимкнений акаунт', 'off@t.ua'], ['роль без права редагувати (читач)', 'reader@t.ua']] as const) {
    const before = sent.length;
    const r = await pe.requestPairingEmail(mk(), { email, ip: '2.2.2.2' });
    t(`${name}: назовні як «надіслано» (silent), листа немає`, r.kind === 'silent' && sent.length === before);
  }
  t('не схоже на пошту — bad_email', (await pe.requestPairingEmail(mk(), { email: 'abc', ip: '3.3.3.3' })).kind === 'bad_email');
  t('пошта вимкнена на сервері — mail_unavailable, а не мовчазний успіх', (await pe.requestPairingEmail(mk({ mailEnabled: () => false }), { email: 'anna@t.ua', ip: '4.4.4.4' })).kind === 'mail_unavailable');
  const shared = mk();
  const outs: string[] = [];
  for (let i = 0; i < 5; i++) outs.push((await pe.requestPairingEmail(shared, { email: 'anna@t.ua', ip: `5.5.5.${i}` })).kind);
  t('четвертий запит на ту саму пошту — limited', outs.slice(0, 3).every((k) => k === 'sent') && outs[3] === 'limited', outs.join(','));
  const failing = await pe.requestPairingEmail(mk({ sendMail: async () => ({ ok: false, error: 'SMTP down' }) }), { email: 'anna@t.ua', ip: '6.6.6.6' });
  const origWarn = console.warn;
  console.warn = () => undefined;
  if (failing.kind === 'sent') await failing.delivery;
  console.warn = origWarn;
  t('збій SMTP не міняє відповідь (її не відрізнити від успіху)', failing.kind === 'sent');
}

// ---------------------------------------------------------------------------
console.log('\nМаршрут + справжній SMTP');
await storeMod.saveUser({ id: 'u-w', email: 'writer@test.ua', name: 'Авторка', role: 'writer', createdAt: new Date().toISOString() } as any);
await storeMod.saveUser({ id: 'u-r', email: 'reader@test.ua', name: 'Читач', role: 'reader', createdAt: new Date().toISOString() } as any);
const app = express();
app.use(express.json());
const store = new pc.PairingCodeStore();
xroutes.registerExternalApiRoutes(app, { recognize: async () => ({ text: 'x', modelId: 'm' }), schedule: () => undefined, pairing: store });
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const post = async (p: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as any };
};
const waitMail = async (n: number) => {
  for (let i = 0; i < 60 && inbox.length < n; i++) await new Promise((r) => setTimeout(r, 100));
};

/** Розбір MIME-частин із розкодуванням base64 / quoted-printable. */
function decodeMessage(raw: string): string {
  const out: string[] = [];
  const decodeBody = (headers: string, body: string) => {
    const enc = /content-transfer-encoding:\s*(\S+)/i.exec(headers)?.[1]?.toLowerCase();
    if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (enc === 'quoted-printable') {
      const bytes = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
      return Buffer.from(bytes, 'latin1').toString('utf8');
    }
    return body;
  };
  const walk = (chunk: string) => {
    const [headers, ...rest] = chunk.split(/\r?\n\r?\n/);
    const body = rest.join('\n\n');
    const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];
    if (boundary) body.split(`--${boundary}`).slice(1).forEach((part) => part.trim() !== '--' && walk(part.replace(/^\r?\n/, '')));
    else out.push(decodeBody(headers, body));
  };
  walk(raw);
  return out.join('\n');
}

{
  const unknown = await post('/api/external/v1/pair/email', { email: 'nobody@test.ua' });
  const known = await post('/api/external/v1/pair/email', { email: 'writer@test.ua' }, { 'x-forwarded-for': '7.7.7.7' });
  t('202 і для невідомої пошти, і для відомої', unknown.status === 202 && known.status === 202);
  t('тіло відповіді однакове (по ньому акаунт не вгадати)', JSON.stringify(unknown.data) === JSON.stringify(known.data), JSON.stringify(known.data));
  await waitMail(1);
  t('справжній SMTP: лише ОДИН лист дійшов (відомій пошті)', inbox.length === 1 && /writer@test\.ua/.test(inbox[0].to.join(',')), String(inbox.length));
  const body = decodeMessage(inbox[0].raw);
  const m = /#pair=([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(body);
  t('у листі код і посилання на справжню адресу застосунку', !!m && body.includes('https://www.fusionlab.in.ua/grabfisionstidio#pair='), body.slice(0, 200));
  t('тема й відправник', /Subject: .*(GrabFusion|=\?UTF-8)/i.test(inbox[0].raw) && /noreply@test\.local/.test(inbox[0].raw + inbox[0].from));
  const redeemed = await post('/api/external/v1/pair', { code: m![1] });
  t('код із пошти міняється на токен області photo-drafts', redeemed.status === 201 && String(redeemed.data.token).startsWith('nst_') && redeemed.data.record?.scope === 'photo-drafts' && redeemed.data.user.email === 'writer@test.ua', JSON.stringify(redeemed.data).slice(0, 160));
  t('і лише раз', (await post('/api/external/v1/pair', { code: m![1] })).status === 404);

  t('нісенітниця замість пошти — 400', (await post('/api/external/v1/pair/email', { email: 'abc' })).status === 400);
  t('без тіла — 400', (await post('/api/external/v1/pair/email', {})).status === 400);
  const rd = await post('/api/external/v1/pair/email', { email: 'reader@test.ua' }, { 'x-forwarded-for': '8.8.8.8' });
  await new Promise((r) => setTimeout(r, 400));
  t('читач: ті самі 202, але листа немає', rd.status === 202 && inbox.length === 1);
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await post('/api/external/v1/pair/email', { email: `spam${i}@test.ua` }, { 'x-forwarded-for': '9.9.9.9' })).status);
  t('спам з однієї адреси впирається в 429', statuses.includes(429) && statuses.slice(0, 8).every((s) => s === 202), statuses.join(','));
}

// Пошта вимкнена: окремий застосунок із порожнім SMTP не збираємо (mailConfig читається при імпорті) — перевірено логікою вище.
(server as any).closeAllConnections?.();
await new Promise((r) => server.close(r));
await new Promise((r) => smtp.close(r));
db.closeDb();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
