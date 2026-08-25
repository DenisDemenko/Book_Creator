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
      auth: { user: mailConfig.user, pass: mailConfig.pass },
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
 * Повертає true лише якщо лист реально пішов через SMTP. false — і коли
 * SMTP не налаштований (mailConfig.enabled === false), і коли відправка
 * провалилась (мережа, невірні креденшли тощо) — в обох випадках виклик
 * не повинен падати, а мусить запропонувати запасний варіант (посилання).
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    console.warn(
      `[mail] SMTP не налаштовано (SMTP_HOST/SMTP_USER/SMTP_PASS) — лист до ${input.to} не надіслано. ` +
        'Посилання потрібно передати отримувачу вручну.'
    );
    return false;
  }
  try {
    await tx.sendMail({
      from: mailConfig.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return true;
  } catch (err) {
    console.error('[mail] Не вдалося надіслати лист:', err);
    return false;
  }
}
