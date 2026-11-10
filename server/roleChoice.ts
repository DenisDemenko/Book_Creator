/**
 * Вибір ролей галочками при реєстрації (журнал #539, запит власника 10.11.2026): користувач ставить їх ОДИН раз,
 * далі ролі змінює лише адміністратор; робочий простір і меню вантажаться за головною роллю облікового запису.
 *
 * Чого тут навмисно немає: ролі `admin` та службових. Адмін — завжди адмін за поштою, і жодна кнопка його не
 * видає. Усі дозволені тут ролі мають права НЕ вищі за типову `writer` (див. BASE_SERVER_PERMISSIONS), тож вибір
 * нічого не підвищує; а щоб не можна було змінити роль, видану маркетплейсом (`reader` для експерта чи викладача),
 * вибір дозволено лише щойно створеному обліковому запису з типовою роллю.
 */

import type { StoredRole, StoredUser } from './store';

export const REGISTRATION_ROLES = ['writer', 'publisher', 'designer', 'translator', 'reader'] as const;
export type RegistrationRole = (typeof REGISTRATION_ROLES)[number];

/** Скільки після створення облікового запису ще можна обрати ролі. */
export const ROLE_CHOICE_WINDOW_MS = 60 * 60 * 1000;

/** Очищений перелік у порядку пріоритету; `null` — порожньо чи є зайве (тоді запит відхиляється цілком). */
export function normalizeRegistrationRoles(input: unknown): RegistrationRole[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > REGISTRATION_ROLES.length) return null;
  const set = new Set<string>();
  for (const r of input) {
    if (typeof r !== 'string' || !(REGISTRATION_ROLES as readonly string[]).includes(r)) return null;
    set.add(r);
  }
  return REGISTRATION_ROLES.filter((r) => set.has(r));
}

/** Головна роль — перша за пріоритетом (письменник → видавець → дизайнер → перекладач → читач). */
export function primaryRegistrationRole(roles: readonly RegistrationRole[]): StoredRole {
  return roles[0] as StoredRole;
}

/** Один тип, а не обʼєднання: у tsconfig немає strict, і `ok` не звужує обʼєднання. */
export interface RoleChoiceVerdict {
  ok: boolean;
  reason?: 'already_chosen' | 'not_new' | 'admin';
}

export function canChooseRoles(user: Pick<StoredUser, 'role' | 'rolesChosenAt' | 'createdAt'>, nowMs: number): RoleChoiceVerdict {
  if (user.role === 'admin') return { ok: false, reason: 'admin' };
  if (user.rolesChosenAt) return { ok: false, reason: 'already_chosen' };
  const created = Date.parse(user.createdAt);
  if (user.role !== 'writer' || !Number.isFinite(created) || nowMs - created > ROLE_CHOICE_WINDOW_MS) {
    return { ok: false, reason: 'not_new' };
  }
  return { ok: true };
}

export const ROLE_CHOICE_MESSAGES: Record<'already_chosen' | 'not_new' | 'admin', string> = {
  already_chosen: 'Ролі вже обрано. Змінити їх може лише адміністратор.',
  not_new: 'Ролі обирають лише при реєстрації. Змінити їх може адміністратор.',
  admin: 'Роль адміністратора не змінюється.',
};
