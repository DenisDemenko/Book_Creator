import { useState, useEffect, useCallback } from 'react';
import type { AuthUser, UserRole } from '../types';

/**
 * Поточний користувач сесії.
 *
 * Гість — не помилка й не «немає користувача»: сервер завжди повертає
 * когось, просто з роллю guest і без права на платні генерації. Тому
 * стан завантаження закінчується завжди, а застосунок працює одразу.
 */

export interface AuthState {
  user: AuthUser | null;
  /** Дозволи, обчислені сервером з урахуванням перевизначень адміністратора. */
  permissions: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  googleEnabled: boolean;
  /** Чи не залишився гість гостем через свідомий вибір «продовжити без входу». */
  dismissedLogin: boolean;
}

const DISMISS_KEY = 'nova_guest_dismissed_login';

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    permissions: {},
    loading: true,
    error: null,
    googleEnabled: false,
    dismissedLogin: (() => {
      try {
        return localStorage.getItem(DISMISS_KEY) === '1';
      } catch {
        return false;
      }
    })(),
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        user: data.user,
        permissions: data.permissions || {},
        googleEnabled: !!data.googleEnabled,
        loading: false,
        error: null,
      }));
    } catch (err) {
      // Сервер недоступний — працюємо як гість, а не показуємо білий екран.
      console.warn('[auth] Не вдалося отримати профіль', err);
      setState((prev) => ({
        ...prev,
        user: { id: null, email: null, name: 'Гість', role: 'guest', isGuest: true },
        permissions: {},
        loading: false,
        error: null,
      }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setState((p) => ({ ...p, error: null }));
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState((p) => ({ ...p, error: data?.error || 'Не вдалося увійти.' }));
          return false;
        }
        try {
          localStorage.removeItem(DISMISS_KEY);
        } catch {
          /* не критично */
        }
        setState((p) => ({
          ...p,
          user: { ...data.user, isGuest: false },
          permissions: data.permissions || {},
          error: null,
          dismissedLogin: false,
        }));
        return true;
      } catch {
        setState((p) => ({ ...p, error: 'Сервер недоступний. Спробуйте пізніше.' }));
        return false;
      }
    },
    []
  );

  const register = useCallback(
    async (email: string, password: string, name: string): Promise<boolean> => {
      setState((p) => ({ ...p, error: null }));
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState((p) => ({ ...p, error: data?.error || 'Не вдалося зареєструватися.' }));
          return false;
        }
        try {
          localStorage.removeItem(DISMISS_KEY);
        } catch {
          /* не критично */
        }
        setState((p) => ({
          ...p,
          user: { ...data.user, isGuest: false },
          permissions: data.permissions || {},
          error: null,
          dismissedLogin: false,
        }));
        return true;
      } catch {
        setState((p) => ({ ...p, error: 'Сервер недоступний. Спробуйте пізніше.' }));
        return false;
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* навіть якщо не вийшло — локально скидаємо */
    }
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* не критично */
    }
    setState((p) => ({
      ...p,
      user: { id: null, email: null, name: 'Гість', role: 'guest', isGuest: true },
      permissions: {},
      dismissedLogin: false,
    }));
  }, []);

  /** Свідомий вибір «оглянути без реєстрації» — щоб не показувати екран входу щоразу. */
  const continueAsGuest = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* не критично */
    }
    setState((p) => ({ ...p, dismissedLogin: true }));
  }, []);

  const clearError = useCallback(() => setState((p) => ({ ...p, error: null })), []);

  const isGuest = !state.user || state.user.isGuest;
  const isAdmin = state.user?.role === 'admin';
  const canGenerateImages = state.permissions.canGenerateImages === true;
  const role: UserRole = (state.user?.role as UserRole) || 'guest';

  return {
    ...state,
    isGuest,
    isAdmin,
    canGenerateImages,
    role,
    refresh,
    login,
    register,
    logout,
    continueAsGuest,
    clearError,
  };
}
