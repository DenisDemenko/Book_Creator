/**
 * Посилання для підключення GrabFusion за QR (запис #537).
 *
 * Автор у Студії натискає «Код підключення GrabFusion» і отримує QR; телефон відкриває GrabFusion і підключається
 * сам, без переписування коду. QR несе адресу застосунка й ОДНОРАЗОВИЙ код цього автора:
 *   <адреса GrabFusion>#pair=ABCD-EFGH
 *
 * ЧОМУ КОД У ФРАГМЕНТІ (#), А НЕ В ЗАПИТІ (?). Фрагмент браузер не надсилає нікуди: його не бачать ні проксі
 * маркетплейсу, ні сервер GrabFusion, ні журнали, ні заголовок Referer, ні попередній перегляд посилання в месенджері.
 * Читає його лише сторінка GrabFusion, одразу міняє на токен і прибирає з адреси.
 *
 * Код видає Студія (`PairingCodeStore.issue`): новий щоразу, прив'язаний до автора, живе 5 хвилин, спрацьовує раз,
 * а попередній невикористаний код цього автора скасовується. Тому QR «індивідуальний» без жодного додаткового сховища.
 */

export const GRABFUSION_PAIR_HASH_KEY = 'pair';

/** Код як його видає Студія (`ABCD-EFGH`): лише літери, цифри й дефіс — нічого, що довелося б екранувати. */
const SAFE_CODE = /^[A-Za-z0-9-]{4,32}$/;

/** Посилання для QR або null: адреса GrabFusion не задана чи код має сторонні символи. */
export function buildGrabfusionPairUrl(publicUrl: string | null | undefined, code: string): string | null {
  const base = String(publicUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  const clean = String(code ?? '').trim();
  if (!SAFE_CODE.test(clean)) return null;
  return `${base}#${GRABFUSION_PAIR_HASH_KEY}=${clean}`;
}

/** Публічна адреса GrabFusion з `GRABFUSION_PUBLIC_URL` (без слеша в кінці) або null, коли її не задано чи вона не http(s). */
export function grabfusionPublicUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.GRABFUSION_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : null;
}
