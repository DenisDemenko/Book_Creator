/**
 * Гейт «ця функція доступна лише певним тарифним планам» на клієнті —
 * той самий факт, що вже перевіряє сервер (server/subscriptions.ts →
 * requirePlanAtLeast), тільки тут потрібен ЗАЗДАЛЕГІДЬ, щоб не показувати
 * автору кнопку, яка все одно поверне 403.
 *
 * Раніше цю перевірку кожен екран писав собі окремо (найперший приклад —
 * ManuscriptFormatterView.tsx, «Форматування під KDP»): свій useState,
 * свій fetch('/api/subscription/me'), своя умова hasAccess. Озвучення —
 * другий такий екран (і третій, за тегами курсів), тож перевірку
 * винесено сюди один раз, а не скопійовано втретє.
 */
import { useEffect, useState } from 'react';
import type { AuthUser } from '../types';

export type PlanId = 'free' | 'start' | 'pro' | 'ultra';

export interface PlanAccessState {
  loading: boolean;
  /** Зареєстрований і не гість. */
  isRegistered: boolean;
  /** true для адміністратора (він завжди проходить тарифні гейти) або якщо план автора у allowedPlans. */
  hasAccess: boolean;
  plan: PlanId | null;
  planNameUk: string | null;
  planNameEn: string | null;
}

interface SubscriptionMeResponse {
  subscription?: { plan?: string };
  plan?: { id?: string; nameUk?: string; nameEn?: string };
}

export function usePlanAccess(authUser: AuthUser | null | undefined, allowedPlans: PlanId[]): PlanAccessState {
  const isRegistered = !!authUser?.id && !authUser.isGuest;
  const isAdmin = authUser?.role === 'admin';

  const [state, setState] = useState<PlanAccessState>({
    loading: isRegistered && !isAdmin,
    isRegistered,
    hasAccess: isAdmin,
    plan: isAdmin ? 'ultra' : null,
    planNameUk: null,
    planNameEn: null,
  });

  useEffect(() => {
    if (!isRegistered || isAdmin) {
      setState({
        loading: false,
        isRegistered,
        hasAccess: isAdmin,
        plan: isAdmin ? 'ultra' : null,
        planNameUk: isAdmin ? 'Ultra' : null,
        planNameEn: isAdmin ? 'Ultra' : null,
      });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    fetch('/api/subscription/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SubscriptionMeResponse | null) => {
        if (cancelled) return;
        const plan = (data?.subscription?.plan as PlanId) || 'free';
        setState({
          loading: false,
          isRegistered,
          hasAccess: allowedPlans.includes(plan),
          plan,
          planNameUk: data?.plan?.nameUk || null,
          planNameEn: data?.plan?.nameEn || null,
        });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegistered, isAdmin, allowedPlans.join(',')]);

  return state;
}
