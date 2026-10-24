/**
 * Гаманець AI-балів: резервування → списання/повернення (ТЗ v0.5, §2.3, §2.5).
 *
 * Ще НЕ підключений до жодного генератора й нічого не списує в production:
 * це самодостатній шар, який підключають окремо, за feature flag.
 *
 * Гарантії:
 *  - баланс ніколи не стає від'ємним (CHECK у таблиці + перевірка перед записом);
 *  - кожна зміна — незмінний рядок журналу в тій самій транзакції, що й знімок;
 *  - повтор із тим самим ключем не змінює баланс вдруге (grant/reserve/settle/release);
 *  - списати можна не більше за зарезервоване; різниця повертається автоматично.
 *
 * Атомарність: node:sqlite синхронний, а кожна операція — одна транзакція
 * BEGIN IMMEDIATE, тож два паралельні запити на останні бали виконуються
 * послідовно й другий отримує IMAGE_CREDITS_LOW.
 */

export interface WalletDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export type WalletErrorCode =
  | 'IMAGE_CREDITS_LOW'
  | 'RESERVATION_NOT_FOUND'
  | 'RESERVATION_CLOSED'
  | 'CHARGE_EXCEEDS_RESERVE'
  | 'INVALID_AMOUNT'
  | 'REASON_REQUIRED';

export class WalletError extends Error {
  constructor(public code: WalletErrorCode, message: string) {
    super(message);
  }
}

export interface CreditBalance {
  userId: string;
  available: number;
  reserved: number;
}

export interface LedgerRow {
  id: number;
  userId: string;
  kind: string;
  availableDelta: number;
  reservedDelta: number;
  ref: string | null;
  idempotencyKey: string | null;
  reason: string | null;
  operator: string | null;
  createdAt: string;
}

interface ReservationRow {
  job_key: string;
  user_id: string;
  amount: number;
  status: 'reserved' | 'charged' | 'released';
  charged: number;
}

function requireAmount(n: number): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new WalletError('INVALID_AMOUNT', 'Кількість балів має бути додатним цілим числом.');
  }
}

export class CreditWallet {
  constructor(private db: WalletDb, private now: () => string = () => new Date().toISOString()) {}

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // транзакція вже закрита
      }
      throw err;
    }
  }

  getBalance(userId: string): CreditBalance {
    const row = this.db
      .prepare('SELECT available, reserved FROM credit_accounts WHERE user_id = ?')
      .get(userId) as { available: number; reserved: number } | undefined;
    return { userId, available: row?.available ?? 0, reserved: row?.reserved ?? 0 };
  }

  private move(
    userId: string,
    kind: string,
    availableDelta: number,
    reservedDelta: number,
    meta: { ref?: string; idempotencyKey?: string; reason?: string; operator?: string }
  ): void {
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO credit_accounts (user_id, available, reserved, updated_at) VALUES (?, 0, 0, ?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .run(userId, at);
    this.db
      .prepare('UPDATE credit_accounts SET available = available + ?, reserved = reserved + ?, updated_at = ? WHERE user_id = ?')
      .run(availableDelta, reservedDelta, at, userId);
    this.db
      .prepare(
        `INSERT INTO credit_ledger (user_id, kind, available_delta, reserved_delta, ref, idempotency_key, reason, operator, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        kind,
        availableDelta,
        reservedDelta,
        meta.ref ?? null,
        meta.idempotencyKey ?? null,
        meta.reason ?? null,
        meta.operator ?? null,
        at
      );
  }

  /** Нарахування (підписка, пробна квота). Повтор із тим самим ключем — без ефекту. Повертає true, якщо нараховано. */
  grant(userId: string, amount: number, idempotencyKey: string, reason: string): boolean {
    requireAmount(amount);
    return this.tx(() => {
      const dup = this.db.prepare('SELECT 1 AS x FROM credit_ledger WHERE idempotency_key = ?').get(idempotencyKey);
      if (dup) return false;
      this.move(userId, 'grant', amount, 0, { idempotencyKey, reason });
      return true;
    });
  }

  /**
   * Нарахування нового періоду: НЕЗАЛИШЕНІ бали попереднього періоду згорають
   * (рішення власника, A-08), потім нараховується пакет. Одна транзакція,
   * ідемпотентно за ключем періоду. Повертає true, якщо період нараховано.
   */
  grantPeriod(userId: string, amount: number, idempotencyKey: string, reason: string): boolean {
    requireAmount(amount);
    return this.tx(() => {
      const dup = this.db.prepare('SELECT 1 AS x FROM credit_ledger WHERE idempotency_key = ?').get(idempotencyKey);
      if (dup) return false;
      const left = this.getBalance(userId).available;
      if (left > 0) this.move(userId, 'expire', -left, 0, { reason: 'згоряння залишку періоду' });
      this.move(userId, 'grant', amount, 0, { idempotencyKey, reason });
      return true;
    });
  }

  /** Урізає доступний баланс до cap (підписка закінчилась). Ідемпотентно за ключем. Повертає, скільки згоріло. */
  capAvailable(userId: string, cap: number, idempotencyKey: string, reason: string): number {
    return this.tx(() => {
      const dup = this.db.prepare('SELECT 1 AS x FROM credit_ledger WHERE idempotency_key = ?').get(idempotencyKey);
      if (dup) return 0;
      const excess = Math.max(0, this.getBalance(userId).available - cap);
      // Рядок пишемо й за нульового згоряння — він і є маркером ідемпотентності.
      this.move(userId, 'expire', -excess, 0, { idempotencyKey, reason });
      return excess;
    });
  }

  /** Резерв під генерацію. Повтор із тим самим jobKey повертає наявний резерв без повторного списання. */
  reserve(userId: string, jobKey: string, amount: number): CreditBalance {
    requireAmount(amount);
    return this.tx(() => {
      const existing = this.db
        .prepare('SELECT * FROM credit_reservations WHERE job_key = ?')
        .get(jobKey) as ReservationRow | undefined;
      if (existing) return this.getBalance(existing.user_id);
      const bal = this.getBalance(userId);
      if (bal.available < amount) {
        throw new WalletError('IMAGE_CREDITS_LOW', `Недостатньо балів: потрібно ${amount}, доступно ${bal.available}.`);
      }
      const at = this.now();
      this.db
        .prepare(
          'INSERT INTO credit_reservations (job_key, user_id, amount, status, charged, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
        )
        .run(jobKey, userId, amount, 'reserved', at, at);
      this.move(userId, 'reserve', -amount, amount, { ref: jobKey });
      return this.getBalance(userId);
    });
  }

  /** Фінальне списання actualCredits ≤ резерву; залишок резерву повертається. Повтор — без ефекту. */
  settle(jobKey: string, actualCredits: number): CreditBalance {
    if (!Number.isInteger(actualCredits) || actualCredits < 0) {
      throw new WalletError('INVALID_AMOUNT', "Фактичне списання має бути невід'ємним цілим.");
    }
    return this.tx(() => {
      const r = this.db.prepare('SELECT * FROM credit_reservations WHERE job_key = ?').get(jobKey) as ReservationRow | undefined;
      if (!r) throw new WalletError('RESERVATION_NOT_FOUND', 'Резерв не знайдено.');
      if (r.status === 'charged') return this.getBalance(r.user_id);
      if (r.status === 'released') throw new WalletError('RESERVATION_CLOSED', 'Резерв уже повернено.');
      if (actualCredits > r.amount) {
        throw new WalletError('CHARGE_EXCEEDS_RESERVE', `Списання ${actualCredits} перевищує резерв ${r.amount}.`);
      }
      const refund = r.amount - actualCredits;
      this.move(r.user_id, 'charge', 0, -actualCredits, { ref: jobKey });
      if (refund > 0) this.move(r.user_id, 'release', refund, -refund, { ref: jobKey, reason: 'залишок резерву' });
      this.db
        .prepare('UPDATE credit_reservations SET status = ?, charged = ?, updated_at = ? WHERE job_key = ?')
        .run('charged', actualCredits, this.now(), jobKey);
      return this.getBalance(r.user_id);
    });
  }

  /** Повернення всього резерву (збій провайдера, 429, тайм-аут). Повтор — без ефекту. */
  release(jobKey: string, reason = 'збій генерації'): CreditBalance {
    return this.tx(() => {
      const r = this.db.prepare('SELECT * FROM credit_reservations WHERE job_key = ?').get(jobKey) as ReservationRow | undefined;
      if (!r) throw new WalletError('RESERVATION_NOT_FOUND', 'Резерв не знайдено.');
      if (r.status === 'released') return this.getBalance(r.user_id);
      if (r.status === 'charged') throw new WalletError('RESERVATION_CLOSED', 'Резерв уже списано.');
      this.move(r.user_id, 'release', r.amount, -r.amount, { ref: jobKey, reason });
      this.db.prepare('UPDATE credit_reservations SET status = ?, updated_at = ? WHERE job_key = ?').run('released', this.now(), jobKey);
      return this.getBalance(r.user_id);
    });
  }

  /** Адмін-коригування: лише проводкою, з причиною й оператором; баланс не йде нижче нуля. */
  adjust(userId: string, delta: number, reason: string, operator: string): CreditBalance {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new WalletError('INVALID_AMOUNT', 'Коригування має бути ненульовим цілим.');
    }
    if (!reason.trim() || !operator.trim()) throw new WalletError('REASON_REQUIRED', 'Потрібні причина й оператор.');
    return this.tx(() => {
      if (this.getBalance(userId).available + delta < 0) {
        throw new WalletError('IMAGE_CREDITS_LOW', "Коригування залишило б від'ємний баланс.");
      }
      this.move(userId, 'adjustment', delta, 0, { reason, operator });
      return this.getBalance(userId);
    });
  }

  /** Усі рахунки (для адмін-панелі). */
  listAccounts(): CreditBalance[] {
    const rows = this.db.prepare('SELECT user_id, available, reserved FROM credit_accounts').all() as any[];
    return rows.map((r) => ({ userId: r.user_id, available: r.available, reserved: r.reserved }));
  }

  listLedger(userId: string, limit = 100): LedgerRow[] {
    const rows = this.db
      .prepare('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      availableDelta: r.available_delta,
      reservedDelta: r.reserved_delta,
      ref: r.ref,
      idempotencyKey: r.idempotency_key,
      reason: r.reason,
      operator: r.operator,
      createdAt: r.created_at,
    }));
  }
}
