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

function getTransporter() {
  if (!mailConfig.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
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
  const tx = getTransporter();
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
