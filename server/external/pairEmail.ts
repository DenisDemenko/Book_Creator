/**
 * Код підключення GrabFusion на пошту (журнал #541, запит власника 10.11.2026): коли автор не біля комп'ютера і не може
 * взяти код чи QR зі Студії, застосунок на телефоні просить надіслати код на пошту облікового запису.
 *
 * Безпека (маршрут без входу, тому обережно):
 *  - відповідь ОДНАКОВА, чи є такий обліковий запис, чи ні, — по ній адреси не вгадати; лист надсилається у фоні, тож і час
 *    відповіді нічого не видає;
 *  - код іде лише на адресу облікового запису й обмінюється тим самим одноразовим механізмом, що й код зі Студії
 *    (токен лише області `photo-drafts`, невдалі спроби обміну обмежені);
 *  - частота запитів обмежена за адресою, за поштою й загалом, щоб маршрут не став розсилкою спаму на чужу пошту;
 *  - запит не скасовує код, який автор зараз бачить на екрані Студії (`keepOthers`);
 *  - ролі без права редагувати контент (читач) листа не отримують — як і в кнопки «Отримати код» у Студії.
 *
 * Усе зовнішнє — через `PairEmailDeps`, щоб тести не ходили ні в базу, ні в SMTP.
 */

import { buildGrabfusionPairUrl, grabfusionPublicUrl } from '../../shared/grabfusionPair';
import { PAIRING_EMAIL_TTL_MS, type PairingCodeStore } from './pairingCodes';

export const PAIR_EMAIL_LIMITS = {
  /** Запитів з однієї адреси за вікно. */
  perIp: 8,
  ipWindowMs: 10 * 60_000,
  /** Листів на одну пошту за вікно (скільки листів можна «накрутити» чужій скриньці). */
  perEmail: 3,
  emailWindowMs: 30 * 60_000,
  /** Усього листів за годину з усієї Студії. */
  global: 100,
  globalWindowMs: 60 * 60_000,
} as const;

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,255}\.[^\s@<>"']{2,}$/u;

/** Нормалізована пошта чи `null`, якщо це не схоже на адресу. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export type LimitHit = 'ip' | 'email' | 'global';

export class PairEmailLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private count(key: string, windowMs: number): number {
    const list = (this.hits.get(key) ?? []).filter((at) => at > this.now() - windowMs);
    this.hits.set(key, list);
    return list.length;
  }

  private add(key: string): void {
    this.hits.set(key, [...(this.hits.get(key) ?? []), this.now()]);
  }

  /** Перевіряє й одразу рахує запит. `null` — можна. */
  take(ip: string, email: string): LimitHit | null {
    const L = PAIR_EMAIL_LIMITS;
    const ipKey = `ip:${ip || 'unknown'}`;
    const mailKey = `mail:${email}`;
    if (this.count(ipKey, L.ipWindowMs) >= L.perIp) return 'ip';
    this.add(ipKey);
    if (this.count('all', L.globalWindowMs) >= L.global) return 'global';
    if (this.count(mailKey, L.emailWindowMs) >= L.perEmail) return 'email';
    this.add('all');
    this.add(mailKey);
    return null;
  }
}

export interface PairingEmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Лист із кодом і (якщо відома адреса GrabFusion) посиланням, що підключає телефон одним дотиком. */
export function pairingEmailContent(p: { code: string; link: string | null; minutes: number; name?: string }): PairingEmailContent {
  const greeting = p.name ? `Вітаємо, ${p.name}!` : 'Вітаємо!';
  const linkHtml = p.link
    ? `<p style="margin:18px 0"><a href="${p.link}" style="background:#b4733f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">Відкрити GrabFusion і підключитися</a></p>
       <p style="color:#6b5b4e;font-size:13px">Натисніть кнопку на телефоні — застосунок підключиться сам. Якщо вона не спрацювала, введіть код вручну.</p>`
    : '<p style="color:#6b5b4e;font-size:13px">Введіть цей код у GrabFusion на телефоні, на екрані «Підключіть застосунок».</p>';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#2b1a10">
  <h2 style="margin:0 0 12px">Код підключення GrabFusion</h2>
  <p>${greeting} Ви (чи хтось від вашого імені) попросили код для входу в GrabFusion.</p>
  <p style="font-size:30px;letter-spacing:6px;font-weight:700;margin:18px 0;font-family:monospace">${p.code}</p>
  <p style="color:#6b5b4e;font-size:13px">Код одноразовий і діє ${p.minutes} хвилин.</p>
  ${linkHtml}
  <p style="color:#8d8378;font-size:12px;margin-top:24px">Якщо ви цього не просили — просто проігноруйте лист: без коду ніхто не зможе підключитися до вашого облікового запису.</p>
</div>`;
  const text = [
    'Код підключення GrabFusion',
    '',
    `${greeting} Ви (чи хтось від вашого імені) попросили код для входу в GrabFusion.`,
    '',
    `Код: ${p.code}`,
    `Код одноразовий і діє ${p.minutes} хвилин.`,
    ...(p.link ? ['', `Підключитися одним дотиком (на телефоні): ${p.link}`] : ['', 'Введіть цей код у GrabFusion на телефоні.']),
    '',
    'Якщо ви цього не просили — проігноруйте лист: без коду ніхто не зможе підключитися до вашого облікового запису.',
  ].join('\n');
  return { subject: 'Код підключення GrabFusion', html, text };
}

export interface PairEmailDeps {
  store: PairingCodeStore;
  limiter: PairEmailLimiter;
  mailEnabled: () => boolean;
  findUserByEmail: (email: string) => Promise<{ id: string; email: string; name: string; role: string; disabled?: boolean } | null | undefined>;
  /** Чи має роль право редагувати контент (так само, як для кнопки «Отримати код» у Студії). */
  canEditContent: (role: string) => Promise<boolean>;
  sendMail: (input: { to: string; subject: string; html: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Адреса GrabFusion для посилання в листі; `null` — лист лише з кодом. */
  publicUrl: () => string | null;
}

export type PairEmailOutcome =
  | { kind: 'sent'; delivery: Promise<{ ok: boolean; error?: string }> }
  | { kind: 'silent' }
  | { kind: 'bad_email' }
  | { kind: 'limited'; by: LimitHit }
  | { kind: 'mail_unavailable' };

/**
 * `sent` і `silent` назовні виглядають однаково (маршрут відповідає 202 в обох випадках); `delivery` — для тестів і логу.
 * Лист надсилається у фоні: час відповіді не залежить від того, чи є такий обліковий запис.
 */
export async function requestPairingEmail(deps: PairEmailDeps, input: { email: unknown; ip: string }): Promise<PairEmailOutcome> {
  if (!deps.mailEnabled()) return { kind: 'mail_unavailable' };
  const email = normalizeEmail(input.email);
  if (!email) return { kind: 'bad_email' };
  const hit = deps.limiter.take(input.ip, email);
  if (hit) return { kind: 'limited', by: hit };

  const user = await deps.findUserByEmail(email);
  if (!user || user.disabled || !(await deps.canEditContent(user.role))) return { kind: 'silent' };

  const issued = deps.store.issue(user.id, 'GrabFusion (пошта)', 'photo-drafts', { ttlMs: PAIRING_EMAIL_TTL_MS, keepOthers: true });
  const link = buildGrabfusionPairUrl(deps.publicUrl(), issued.display);
  const content = pairingEmailContent({ code: issued.display, link, minutes: Math.round(PAIRING_EMAIL_TTL_MS / 60_000), name: user.name });
  const delivery = deps.sendMail({ to: user.email, ...content }).catch((err) => ({ ok: false, error: String((err as Error)?.message ?? err) }));
  void delivery.then((r) => {
    if (!r.ok) console.warn('[pairEmail] лист із кодом не надіслано:', String(r.error ?? '').slice(0, 200));
  });
  return { kind: 'sent', delivery };
}

export { grabfusionPublicUrl };
