/**
 * Надсилає тестовий лист-запрошення через налаштований SMTP.
 *
 * Файловий скрипт, а не термінальний однострочник: кирилиця в командному
 * рядку Windows (PowerShell) може пошкоджуватись під час передавання,
 * через що в тестовому листі зникали перші літери слів.
 *
 * Запуск: npm run test:invite-mail
 */
import 'dotenv/config';
import { sendMail } from '../server/mail';
import { inviteEmailHtml, inviteEmailText } from '../server/collaborationRoutes';

const TO = process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'tropazemli@gmail.com';

const bookTitle = 'Тіні Нео-Києва 2084';
const roleUk = 'Видавець';
const roleBlurb = 'Верстка, поліграфічні стандарти, аудит Amazon KDP і експорт тиражу.';
const inviterName = 'Олександр Радченко';
const base = process.env.STUDIO_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000';
const link = `${base.replace(/\/$/, '')}/?invite=demo-token`;

(async () => {
  const result = await sendMail({
    to: TO,
    subject: `Запрошення до книги «${bookTitle}» — роль: ${roleUk}`,
    html: inviteEmailHtml(bookTitle, roleUk, roleBlurb, inviterName, TO, link),
    text: inviteEmailText(bookTitle, roleUk, roleBlurb, inviterName, TO, link),
  });
  if (!result.ok) console.log('TEST_MAIL_ERROR:', result.error ?? 'unknown');
  console.log(result.ok ? 'TEST_MAIL_OK' : 'TEST_MAIL_FAILED');
  process.exit(result.ok ? 0 : 1);
})();
