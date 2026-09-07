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
 */
async function resolveSmtpHosts(host: string): Promise<string[]> {
  try {
    const addresses = await dnsPromises.resolve4(host);
    if (addresses.length > 0) return addresses;
  } catch {
    // DNS не відповів — пробуємо з оригінальним hostname.
  }
  return [host];
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
    // обірвати повільний запит раніше, ніж сервер встигне відповісти.
    connectionTimeout: 8_000,
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
 * Список цілей для спроби підключення: кожна IPv4-адреса × порти. Для Gmail
 * додаємо альтернативний порт: 465 (SSL) ⇄ 587 (STARTTLS). Railway часто
 * відкидає вихідний 465, але 587 проходить — тому фолбек рятує ситуацію без
 * зміни змінних на сервері.
 */
function smtpTargets(hosts: string[]): SmtpTarget[] {
  const targets: SmtpTarget[] = [];
  for (const host of hosts) {
    targets.push({ host, port: mailConfig.port, secure: mailConfig.secure });
    if (/g(oogle)?mail\.com$/i.test(mailConfig.host)) {
      const alternate = mailConfig.secure
        ? { port: 587, secure: false }
        : { port: 465, secure: true };
      if (alternate.port !== mailConfig.port) {
        targets.push({ host, ...alternate });
      }
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

  const hosts = await resolveSmtpHosts(mailConfig.host);
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
