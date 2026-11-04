/**
 * Лист автору про рішення модерації.
 *
 * Раніше автор дізнавався про рішення, лише відкривши курс у редакторі: курс
 * «Повернуто із зауваженнями» міг тижнями лежати непоміченим. Лист — додатковий
 * канал, а не єдиний: поштовий сервіс на хостингу може бути недоступний
 * (див. /api/admin/mail/status), тому відправка best-effort — збій листа НІКОЛИ
 * не скасовує рішення, а лише повертається в відповіді, щоб адмін бачив, що
 * автора треба попередити іншим шляхом.
 */
import { findUserById } from './store';
import { sendMail, type SendMailInput } from './mail';
import type { ModerationEntry } from './moderationStore';

export type ModerationDecision = 'approved' | 'changes_requested' | 'rejected';

export interface NotifyResult {
  sent: boolean;
  /** Чому не надіслано: немає автора, немає пошти, SMTP не налаштовано… */
  reason?: string;
}

type Mailer = (input: SendMailInput) => Promise<{ ok: boolean; error?: string }>;
let mailer: Mailer = sendMail;

/** Лише для тестів: підміна відправника, щоб не ходити в SMTP. */
export function setModerationMailer(next: Mailer | null): void {
  mailer = next ?? sendMail;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const KIND: Record<string, string> = { book: 'книгу', course: 'курс', instruction: 'інструкцію', game: 'гру' };

function compose(entry: ModerationEntry, decision: ModerationDecision, note: string | undefined) {
  const what = `${KIND[entry.itemType] ?? 'публікацію'} «${entry.title}»`;
  const cleanNote = (note ?? '').trim();
  if (decision === 'approved') {
    return {
      subject: `Погоджено: «${entry.title}»`,
      lines: [`Модератор погодив ${what}. Він опублікований у вітрині.`],
    };
  }
  if (decision === 'changes_requested') {
    return {
      subject: `Є зауваження до «${entry.title}»`,
      lines: [
        `Модератор повернув ${what} із зауваженнями. Виправте їх у редакторі й надішліть на модерацію ще раз — це той самий курс, переписувати нічого не потрібно.`,
        `Зауваження: ${cleanNote || '—'}`,
      ],
    };
  }
  return {
    subject: `Відхилено: «${entry.title}»`,
    lines: [`Модератор відхилив ${what}.`, `Причина: ${cleanNote || '—'}`],
  };
}

export async function notifyAuthorOfDecision(
  entry: ModerationEntry,
  decision: ModerationDecision,
  note?: string
): Promise<NotifyResult> {
  try {
    const author = await findUserById(entry.authorId);
    if (!author) return { sent: false, reason: 'автора не знайдено' };
    if (!author.email) return { sent: false, reason: 'у автора немає пошти' };

    const { subject, lines } = compose(entry, decision, note);
    const result = await mailer({
      to: author.email,
      subject,
      text: `${lines.join('\n\n')}\n`,
      html: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
    });
    return result.ok ? { sent: true } : { sent: false, reason: result.error || 'лист не надіслано' };
  } catch (err) {
    return { sent: false, reason: String((err as Error).message || err) };
  }
}
