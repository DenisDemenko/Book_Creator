/**
 * Одноразові коди підключення локального застосунку (DesignCraft-скрипт) до акаунта Студії.
 *
 * ЧОМУ КОД, А НЕ ТОКЕН. Токен `nst_…` довгий, показується один раз і його доводилося
 * копіювати через буфер обміну. Код — 8 символів, живе 5 хвилин, працює ОДИН раз: скрипт
 * обмінює його на токен через `/api/external/v1/pair`, і сам токен ніде не з'являється на
 * екрані. Код не можна вгадати за розумний час: 32^8 ≈ 10^12 варіантів, а невдалі спроби з
 * однієї адреси обмежені.
 *
 * Сховище в пам'яті процесу — свідомо: код короткоживучий, і перезапуск сервера просто
 * робить його недійсним (автор отримає новий). На кількох інстансах це вимагало б спільного
 * сховища; Студія зараз працює одним процесом.
 */
import { randomInt } from 'node:crypto';

/** Без 0/O/1/I — щоб код не плутали, переписуючи з екрана. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const PAIRING_MAX_FAILURES = 10;
export const PAIRING_FAILURE_WINDOW_MS = 10 * 60 * 1000;
/**
 * Загальна стеля невдалих спроб з усіх адрес. За проксі маркетплейсу адреса клієнта береться з
 * X-Forwarded-For, а її можна підробити; стеля не дає перебирати коди, міняючи «адресу».
 */
export const PAIRING_MAX_FAILURES_TOTAL = 500;
const ALL = '__all__';

export interface PairingIssue {
  code: string;
  /** Для показу: `ABCD-EFGH`. */
  display: string;
  expiresAt: string;
}

export type PairingRedeem =
  | { ok: true; userId: string; name: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' };

interface PendingCode {
  userId: string;
  name: string;
  expiresAt: number;
}

export function normalizePairingCode(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export class PairingCodeStore {
  private readonly codes = new Map<string, PendingCode>();
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly random: (max: number) => number = (max) => randomInt(max)
  ) {}

  /** Новий код для автора. Попередній невикористаний код цього автора стає недійсним. */
  issue(userId: string, name = 'DesignCraft (локально)'): PairingIssue {
    this.sweep();
    for (const [code, pending] of this.codes) if (pending.userId === userId) this.codes.delete(code);
    let code = '';
    do {
      code = Array.from({ length: PAIRING_CODE_LENGTH }, () => PAIRING_ALPHABET[this.random(PAIRING_ALPHABET.length)]).join('');
    } while (this.codes.has(code));
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.codes.set(code, { userId, name: String(name || '').slice(0, 80) || 'DesignCraft (локально)', expiresAt });
    return { code, display: formatPairingCode(code), expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Обмін коду: успіх лише раз; невдалі спроби з однієї адреси обмежені. */
  redeem(rawCode: unknown, clientKey: string): PairingRedeem {
    const key = clientKey || 'unknown';
    if (this.isLocked(key)) return { ok: false, reason: 'locked' };
    const code = normalizePairingCode(rawCode);
    const pending = this.codes.get(code);
    if (!pending) {
      this.recordFailure(key);
      return { ok: false, reason: 'invalid' };
    }
    this.codes.delete(code); // одноразовий — навіть якщо прострочений
    if (pending.expiresAt <= this.now()) {
      this.recordFailure(key);
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, userId: pending.userId, name: pending.name };
  }

  private recent(key: string): number {
    const list = (this.failures.get(key) || []).filter((at) => at > this.now() - PAIRING_FAILURE_WINDOW_MS);
    this.failures.set(key, list);
    return list.length;
  }

  private isLocked(key: string): boolean {
    return this.recent(key) >= PAIRING_MAX_FAILURES || this.recent(ALL) >= PAIRING_MAX_FAILURES_TOTAL;
  }

  private recordFailure(key: string): void {
    for (const k of [key, ALL]) {
      const list = this.failures.get(k) || [];
      list.push(this.now());
      this.failures.set(k, list);
    }
  }

  private sweep(): void {
    const t = this.now();
    for (const [code, pending] of this.codes) if (pending.expiresAt <= t) this.codes.delete(code);
  }

  /** Лише для тестів. */
  size(): number {
    return this.codes.size;
  }
}
