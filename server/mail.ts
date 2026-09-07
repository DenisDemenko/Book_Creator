/**
 * Надсилання листів (наразі лише cowork-запрошення дизайнеру/видавцю/
 * перекладачу — server/collaborationRoutes.ts).
 *
 * Налаштовується через SMTP_* змінні середовища — так само, як LiqPay/
 * PayPal/Google OAuth у цьому проєкті (server/payments/*, server/auth.ts):
 * реальні секрети задаються на продакшн-сервері, тут лише код з graceful
 * фолбеком. Якщо SMTP не налаштовано, sendMail() не кидає виняток — просто
 * повертає `false`, і виклик, що надсилав запрошення, показує користувачу
 * посилання для ручного надсилання замість листа.
 *
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS — дані поштового сервера.
 * SMTP_FROM — адреса відправника (напр. "NOVA STUDIO <noreply@novastudio.ua>").
 * SMTP_SECURE — "true", якщо порт вимагає TLS одразу (зазвичай 465).
 */

import nodemailer from 'nodemailer';
import { promises as dnsPromises } from 'node:dns';

export const mailConfig = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  secure: process.env.SMTP_SECURE === 'true',
  get enabled() {
    return !!(this.host && this.user && this.pass);
  },
};

interface SmtpTarget {
  host: string;
  port: number;
  secure: boolean;
}

const transporterCache = new Map<string, ReturnType<typeof nodemailer.createTransport>>();

/**
 * Резолвить SMTP-хост лише в IPv4 і повертає ВСІ A-адреси.
 *
 * Чому це критично: контейнер Railway не має IPv6-маршруту, і DNS для
 * smtp.gmail.com повертає AAAA першим. nodemailer пробує IPv6 і падає з
 * «connect ENETUNREACH 2a00:...:465», не повертаючись до IPv4. Тому адреси
 * A-запису отримуємо самі й передаємо як host, а hostname лишаємо в
 * servername для TLS/SNI (Gmail віддає сертифікат саме на smtp.gmail.com).
 *
 * DNS без таймауту може зависнути назавжди (hosting-хости часом не
 * відповідають на A-запит із датацентру) — тоді запит до /invite висне, а
 * проксі вбиває його раніше, ніж ми встигли відповісти. Тому резолвінг
 * обмежено 5 секундами.
 */
const DNS_TIMEOUT_MS = 5_000;

async function resolveSmtpHosts(host: string): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const addresses = await Promise.race([
      dnsPromises.resolve4(host),
      new Promise<string[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`DNS не відповів за ${DNS_TIMEOUT_MS / 1000} с (${host})`)), DNS_TIMEOUT_MS);
      }),
    ]);
    return addresses.length > 0 ? addresses : [host];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [host]; // пробуємо за hostname
    throw err; // DNS-таймаут або інша помилка — піднімається до sendMail
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getTransporter(target: SmtpTarget) {
  const key = `${target.host}:${target.port}:${target.secure ? 'ssl' : 'starttls'}`;
  const cached = transporterCache.get(key);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: target.host,
    port: target.port,
    secure: target.secure,
    // host — це вже IPv4-адреса, тож SNI/перевірка сертифіката йдуть за
    // оригінальним hostname (smtp.gmail.com), а не за IP.
    tls: { servername: mailConfig.host },
    // Без таймаутів з'єднання, яке «не відповідає», крутить спінер назавжди.
    // Ліміти свідомо малі: проксі перед студією (Vercel/Cloudflare) може
    // обірвати повільний запит раніше, ніж сервер встигне відповісти, а
    // фолбек-ланцюжок може містити до 3 портів на адресу.
    connectionTimeout: 6_000,
    greetingTimeout: 6_000,
    socketTimeout: 12_000,
    auth: {
      user: mailConfig.user.trim(),
      // Пароль додатка Gmail часто копіюють у вигляді «aaaa bbbb cccc dddd» —
      // пробіли тут зайві, Gmail очікує 16 символів підряд.
      pass: mailConfig.pass.replace(/\s+/g, ''),
    },
  });
  transporterCache.set(key, transporter);
  return transporter;
}

/**
 * Список цілей для спроби підключення: кожна IPv4-адреса × порти. Порядок:
 * налаштований порт → альтернативний (465 SSL ⇄ 587 STARTTLS) → 2525.
 * Порт 2525 — штатний запасний для середовищ, де 25/465/587 закриті
 * вихідним фаєрволом (як на Railway). Його підтримують Brevo, SendGrid та
 * частина хостингів — тому пробуємо його останнім без зміни змінних.
 */
function smtpTargets(hosts: string[]): SmtpTarget[] {
  const targets: SmtpTarget[] = [];
  const seen = new Set<string>();
  for (const host of hosts) {
    const candidates: Array<{ port: number; secure: boolean }> = [
      { port: mailConfig.port, secure: mailConfig.secure },
      mailConfig.secure ? { port: 587, secure: false } : { port: 465, secure: true },
      { port: 2525, secure: false },
    ];
    for (const c of candidates) {
      const key = `${host}:${c.port}:${c.secure}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ host, port: c.port, secure: c.secure });
    }
  }
  return targets;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Надсилає лист і повертає результат з причиною помилки (без винятків).
 * ok === false і коли SMTP не налаштований, і коли відправка провалилась —
 * виклик не падає, а мусить запропонувати запасний варіант (посилання).
 */
export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; error?: string }> {
  if (!mailConfig.enabled) {
    console.warn(
      `[mail] SMTP не налаштовано (SMTP_HOST/SMTP_USER/SMTP_PASS) — лист до ${input.to} не надіслано. ` +
        'Посилання потрібно передати отримувачу вручну.'
    );
    return { ok: false, error: 'SMTP не налаштовано' };
  }

  let hosts: string[];
  try {
    hosts = await resolveSmtpHosts(mailConfig.host);
  } catch (err) {
    const message = String((err as Error).message || err);
    console.error('[mail] Помилка резолвінгу SMTP-хосту:', message);
    return { ok: false, error: message };
  }

  const attempted: string[] = [];
  let lastError: string | undefined;
  for (const target of smtpTargets(hosts)) {
    const label = `${target.host}:${target.port} ${target.secure ? 'SSL' : 'STARTTLS'}`;
    attempted.push(label);
    try {
      await getTransporter(target).sendMail({
        from: mailConfig.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { ok: true };
    } catch (err) {
      lastError = String((err as Error).message || err);
      console.error(`[mail] Не вдалося надіслати через ${label}:`, lastError);
    }
  }

  // Користувач бачить не лише причину, а й що саме пробували — це одразу
  // показує, чи спрацював фолбек 465→587, чи відпав уже на першому порту.
  return { ok: false, error: `${lastError} — ${attempted.join(', ')}` };
}
