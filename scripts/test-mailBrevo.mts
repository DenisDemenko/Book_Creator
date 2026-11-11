/**
 * Тести каналу пошти через HTTPS-API Brevo (журнал #546).
 * Запуск: npm run test:mail-brevo
 *
 * Навіщо канал: Railway не пропускає вихідний SMTP (10.11.2026 «Connection timeout» на 465 і 2525), тож лист із кодом
 * підключення GrabFusion не йшов. API ходить на порт 443.
 *
 *  1. parseSender: «Назва <адреса>» → поля Brevo.
 *  2. Конфігурація: ключ без лапок, enabled лише з API-ключем.
 *  3. Справжній HTTP до підставного сервера Brevo: адреса, заголовок api-key, форма тіла, кирилиця; SMTP не чіпається.
 *  4. Збої: 401/500/мережа з SMTP і без; текст відповіді Brevo доходить до помилки, ключа в ній немає.
 *  5. Запасний SMTP: справжній локальний приймач (протокол) приймає лист, коли API відмовив.
 */
import http from 'node:http';
import net from 'node:net';

// ---- Підставний Brevo (HTTP) ----------------------------------------------------------------------------------------------
type Mode = 'ok' | 'badKey' | 'ip' | 'broken';
let mode: Mode = 'ok';
interface ApiCall {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}
const apiCalls: ApiCall[] = [];
const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body: any = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* не JSON */
    }
    apiCalls.push({ method: req.method || '', url: req.url || '', headers: req.headers, body });
    if (mode === 'ok') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: '<test@brevo>' }));
    } else if (mode === 'badKey') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Key not found', code: 'unauthorized' }));
    } else if (mode === 'ip') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'We have detected you are using an unrecognised IP address 34.1.2.3. Please add it to authorised IPs.', code: 'unauthorized' }));
    } else {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('oops');
    }
  });
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
const apiPort = (api.address() as net.AddressInfo).port;

// ---- Локальний SMTP-приймач (той самий протокол, що в test-pairEmail) -----------------------------------------------------------
interface Received {
  to: string[];
  raw: string;
}
const inbox: Received[] = [];
const smtp = net.createServer((sock) => {
  let buf = '';
  let inData = false;
  let data = '';
  let cur: Received = { to: [], raw: '' };
  let authStep: 'user' | 'pass' | null = null;
  sock.write('220 localhost ESMTP test\r\n');
  const handleLine = (line: string) => {
    if (inData) {
      if (line === '.') {
        inData = false;
        cur.raw = data;
        inbox.push(cur);
        cur = { to: [], raw: '' };
        data = '';
        sock.write('250 queued\r\n');
      } else data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
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

// Конфігурацію server/mail читає при імпорті — задаємо ДО нього. Ключ навмисно в лапках, як його вставляють з панелей.
const KEY = 'xkeysib-test-key-123';
process.env.BREVO_API_KEY = `"${KEY}"`;
process.env.BREVO_API_URL = `http://127.0.0.1:${apiPort}/v3/smtp/email`;
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtpPort);
process.env.SMTP_USER = 'tester';
process.env.SMTP_PASS = 'secret';
process.env.SMTP_FROM = 'Fusion Lab Studio <noreply@fusionlab.in.ua>';
process.env.SMTP_SECURE = 'false';

const { sendMail, parseSender, mailConfig } = await import('../server/mail');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const letter = { to: 'author@test.ua', subject: 'Код підключення GrabFusion', html: '<p>Код <b>123456</b></p>', text: 'Код 123456' };
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const err = console.error;
  const warn = console.warn;
  console.error = () => undefined;
  console.warn = () => undefined;
  try {
    return await fn();
  } finally {
    console.error = err;
    console.warn = warn;
  }
};

// ---------------------------------------------------------------------------
console.log('\nparseSender');
{
  t('«Назва <адреса>»', JSON.stringify(parseSender('Fusion Lab Studio <noreply@fusionlab.in.ua>')) === JSON.stringify({ name: 'Fusion Lab Studio', email: 'noreply@fusionlab.in.ua' }));
  t('назва в лапках', JSON.stringify(parseSender('"Fusion Lab" <a@b.ua>')) === JSON.stringify({ name: 'Fusion Lab', email: 'a@b.ua' }));
  t('лише <адреса>', JSON.stringify(parseSender('<a@b.ua>')) === JSON.stringify({ email: 'a@b.ua' }));
  t('проста адреса', JSON.stringify(parseSender(' a@b.ua ')) === JSON.stringify({ email: 'a@b.ua' }));
  t('без адреси — null', parseSender('просто назва') === null && parseSender('') === null && parseSender('Назва <>') === null);
}

// ---------------------------------------------------------------------------
console.log('\nКонфігурація');
{
  t('ключ без лапок', mailConfig.brevoKey === KEY, mailConfig.brevoKey);
  t('enabled і smtpEnabled', mailConfig.enabled && mailConfig.smtpEnabled);
}

// ---------------------------------------------------------------------------
console.log('\nУспішна відправка через API');
{
  mode = 'ok';
  apiCalls.length = 0;
  const logs: string[] = [];
  const logWas = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.join(' '));
  const r = await sendMail(letter);
  console.log = logWas;
  const call = apiCalls[0];
  t('ok, один запит до API', r.ok === true && apiCalls.length === 1, JSON.stringify(r));
  t('POST на /v3/smtp/email', call?.method === 'POST' && call?.url === '/v3/smtp/email', `${call?.method} ${call?.url}`);
  t('заголовок api-key = ключ без лапок', call?.headers['api-key'] === KEY);
  t('JSON з accept', String(call?.headers['content-type']).includes('application/json') && call?.headers.accept === 'application/json');
  t('відправник розібрано на поля', JSON.stringify(call?.body?.sender) === JSON.stringify({ name: 'Fusion Lab Studio', email: 'noreply@fusionlab.in.ua' }));
  t('отримувач, тема, html, текст', JSON.stringify(call?.body?.to) === JSON.stringify([{ email: 'author@test.ua' }]) && call?.body?.subject === letter.subject && call?.body?.htmlContent === letter.html && call?.body?.textContent === letter.text);
  t('SMTP не чіпали (листів 0)', inbox.length === 0);
  const okLog = logs.find((l) => l.includes('Brevo API: лист прийнято')) || '';
  t('успіх лишає в логу номер листа й домен одержувача', okLog.includes('messageId <test@brevo>') && okLog.includes('@test.ua'), okLog);
  t('у логу немає ні ключа, ні повної адреси', !logs.some((l) => l.includes(KEY) || l.includes('author@test.ua')));
}

// ---------------------------------------------------------------------------
console.log('\nAPI відмовило, SMTP працює → запасний канал');
{
  mode = 'badKey';
  apiCalls.length = 0;
  inbox.length = 0;
  const r = await quiet(() => sendMail(letter));
  t('лист дійшов через SMTP', r.ok === true && inbox.length === 1 && /author@test\.ua/.test(inbox[0].to.join(',')), JSON.stringify(r));
  t('до API таки стукали', apiCalls.length === 1);
}

// ---------------------------------------------------------------------------
console.log('\nУсі канали відмовили');
await new Promise((r) => smtp.close(r)); // SMTP «лягає»
{
  mode = 'badKey';
  const r = await quiet(() => sendMail(letter));
  t('ok=false', r.ok === false);
  t('є текст відповіді Brevo і слово SMTP', /Brevo API 401: Key not found/.test(r.error || '') && /SMTP:/.test(r.error || ''), r.error);
  t('ключа в помилці немає', !(r.error || '').includes(KEY));

  mode = 'ip';
  const ip = await quiet(() => sendMail(letter));
  t('причина про адресу доходить до помилки', /unrecognised IP address/.test(ip.error || ''), ip.error);

  mode = 'broken';
  const broken = await quiet(() => sendMail(letter));
  t('500 без JSON — лише код', /Brevo API 500(?!:)/.test(broken.error || ''), broken.error);

  const urlWas = mailConfig.brevoUrl;
  mailConfig.brevoUrl = 'http://127.0.0.1:1/v3/smtp/email';
  const net1 = await quiet(() => sendMail(letter));
  t('мережа недоступна — помилка, без винятку', net1.ok === false && /Brevo API:/.test(net1.error || ''), net1.error);
  mailConfig.brevoUrl = urlWas;

  const fromWas = mailConfig.from;
  mailConfig.from = 'це не адреса';
  const badFrom = await quiet(() => sendMail(letter));
  t('відправник без адреси — зрозуміла помилка', /SMTP_FROM/.test(badFrom.error || ''), badFrom.error);
  mailConfig.from = fromWas;
}

// ---------------------------------------------------------------------------
console.log('\nЛише API (SMTP не налаштовано)');
{
  const hostWas = mailConfig.host;
  mailConfig.host = '';
  t('enabled лише завдяки ключу', mailConfig.enabled === true && mailConfig.smtpEnabled === false);
  mode = 'ok';
  apiCalls.length = 0;
  const ok = await sendMail(letter);
  t('лист іде через API', ok.ok === true && apiCalls.length === 1);

  mode = 'badKey';
  const started = Date.now();
  const bad = await quiet(() => sendMail(letter));
  t('збій API без SMTP: помилка Brevo без «SMTP:» і швидко', bad.ok === false && /Brevo API 401/.test(bad.error || '') && !/SMTP:/.test(bad.error || '') && Date.now() - started < 3000, bad.error);

  const keyWas = mailConfig.brevoKey;
  mailConfig.brevoKey = '';
  t('без ключа й SMTP пошта вимкнена', mailConfig.enabled === false);
  const off = await quiet(() => sendMail(letter));
  t('sendMail нічого не кидає, ok=false', off.ok === false && /не налаштовано/.test(off.error || ''), off.error);
  mailConfig.brevoKey = keyWas;
  mailConfig.host = hostWas;
}

await new Promise((r) => api.close(r));
(api as any).closeAllConnections?.();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exitCode = fail ? 1 : 0;
