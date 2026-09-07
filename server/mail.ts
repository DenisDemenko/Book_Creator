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

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterHost = '';

/**
 * Резолвить SMTP-хост лише в IPv4.
 *
 * Чому це критично: контейнер Railway не має IPv6-маршруту, і DNS для
 * smtp.gmail.com повертає AAAA першим. nodemailer пробує IPv6 і падає з
 * «connect ENETUNREACH 2a00:...:465», не повертаючись до IPv4. Тому адресу
 * A-запису отримуємо самі й передаємо як host, а hostname лишаємо в
 * servername для TLS/SNI (Gmail віддає сертифікат саме на smtp.gmail.com).
 */
async function resolveSmtpHost(host: string): Promise<string> {
  try {
    const addresses = await dnsPromises.resolve4(host);
    if (addresses.length > 0) return addresses[0];
  } catch {
    // DNS не відповів — пробуємо з оригінальним hostname.
  }
  return host;
}

function getTransporter(host: string) {
  if (!mailConfig.enabled) return null;
  if (!transporter || transporterHost !== host) {
    transporter = nodemailer.createTransport({
      host,
      port: mailConfig.port,
      tls: { servername: mailConfig.host },
      secure: mailConfig.secure,
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
    transporterHost = host;
  }
  return transporter;
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
  const host = await resolveSmtpHost(mailConfig.host);
  const tx = getTransporter(host);
  if (!tx) {
    console.warn(
      `[mail] SMTP не налаштовано (SMTP_HOST/SMTP_USER/SMTP_PASS) — лист до ${input.to} не надіслано. ` +
        'Посилання потрібно передати отримувачу вручну.'
    );
    return { ok: false, error: 'SMTP не налаштовано' };
  }
  try {
    await tx.sendMail({
      from: mailConfig.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true };
  } catch (err) {
    const message = String((err as Error).message || err);
    console.error('[mail] Не вдалося надіслати лист:', message);
    return { ok: false, error: message };
  }
}
