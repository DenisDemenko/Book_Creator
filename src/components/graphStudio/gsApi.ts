/**
 * Запити Graph Studio (Т5.2) — тонка обгортка над `/api/core/workflows` і
 * `/api/core/ontology`: відповідь або помилка з повідомленням сервера.
 */

export class GsError extends Error {
  constructor(message: string, readonly status: number, readonly kind?: string) {
    super(message);
  }
}

export async function gs<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GsError((data as { error?: string }).error || `Помилка ${res.status}`, res.status, (data as { kind?: string }).kind);
  return data as T;
}

export interface GsAbilities {
  role: string | null;
  canEdit: boolean;
  canPublish: boolean;
}

export const ENV_LABEL: Record<string, string> = {
  draft: 'Draft (Чернетка)',
  test: 'Test (Тест)',
  production: 'Production (Робоче)',
  archived: 'Archived (Архів)',
};

export const ENV_CLASS: Record<string, string> = {
  draft: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  test: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  production: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  archived: 'bg-slate-800 text-slate-400 border-slate-700',
};
