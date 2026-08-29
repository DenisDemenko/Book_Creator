import { useState, useEffect, useCallback } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth, googleProvider } from '../utils/firebase';
import type { AuthUser, UserRole } from '../types';

/**
 * Поточний користувач сесії.
 *
 * Гість — не помилка й не «немає користувача»: сервер завжди повертає
 * когось, просто з роллю guest і без права на платні генерації. Тому
 * стан завантаження закінчується завжди, а застосунок працює одразу.
 *
 * Фаза G1 (docs/migration-plan.md маркетплейсу): вхід тепер завжди йде
 * через Firebase — пошта/пароль чи Google, сервер більше не розрізняє.
 * Після успіху у Firebase клієнт обмінює виданий ID-токен на сесію цього
 * сервера через POST /api/auth/firebase-session; сесія далі — той самий
 * cookie, що й раніше, тож усі інші запити застосунку лишаються
 * незмінними.
 */

export interface AuthState {
  user: AuthUser | null;
  /** Дозволи, обчислені сервером з урахуванням перевизначень адміністратора. */
  permissions: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  /** Чи налаштований Firebase-вхід на сервері — якщо ні, форма ховається. */
  firebaseEnabled: boolean;
  /** Чи не залишився гість гостем через свідомий вибір «продовжити без входу». */
  dismissedLogin: boolean;
}

const DISMISS_KEY = 'nova_guest_dismissed_login';

/** Спільна частина login/register/Google: обмінює Firebase-користувача на сесію сервера. */
async function exchangeForSession(): Promise<{ user: AuthUser; permissions: Record<string, boolean> } | { error: string }> {
  const current = auth.currentUser;
  if (!current) return { error: 'Не вдалося визначити користувача Firebase.' };

  const idToken = await current.getIdToken();
  const res = await fetch('/api/auth/firebase-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (!res.ok) return { error: data?.error || 'Не вдалося увійти.' };
  return { user: { ...data.user, isGuest: false }, permissions: data.permissions || {} };
}

/** Повідомлення Firebase — англійські коди помилок, людям такого не показують. */
function firebaseErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Ця пошта вже зареєстрована. Спробуйте увійти.';
    case 'auth/invalid-email':
      return 'Некоректна електронна пошта.';
    case 'auth/weak-password':
      return 'Пароль занадто простий (мінімум 8 символів).';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Невірна пошта або пароль.';
    case 'auth/popup-closed-by-user':
      return 'Вікно входу закрито до завершення.';
    case 'auth/network-request-failed':
      return 'Немає звʼязку з сервером автентифікації. Перевірте інтернет.';
    default:
      return 'Не вдалося увійти. Спробуйте ще раз.';
  }
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    permissions: {},
    loading: true,
    error: null,
    firebaseEnabled: false,
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
        firebaseEnabled: !!data.firebaseEnabled,
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

  function applySessionResult(result: { user: AuthUser; permissions: Record<string, boolean> } | { error: string }): boolean {
    if ('error' in result) {
      setState((p) => ({ ...p, error: result.error }));
      return false;
    }
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* не критично */
    }
    setState((p) => ({
      ...p,
      user: result.user,
      permissions: result.permissions,
      error: null,
      dismissedLogin: false,
    }));
    return true;
  }

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setState((p) => ({ ...p, error: null }));
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return applySessionResult(await exchangeForSession());
    } catch (err) {
      setState((p) => ({ ...p, error: firebaseErrorMessage(err) }));
      return false;
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string): Promise<boolean> => {
      setState((p) => ({ ...p, error: null }));
      try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        if (name.trim()) {
          await updateProfile(credential.user, { displayName: name.trim() });
        }
        return applySessionResult(await exchangeForSession());
      } catch (err) {
        setState((p) => ({ ...p, error: firebaseErrorMessage(err) }));
        return false;
      }
    },
    []
  );

  const loginWithGoogle = useCallback(async (): Promise<boolean> => {
    setState((p) => ({ ...p, error: null }));
    try {
      await signInWithPopup(auth, googleProvider);
      return applySessionResult(await exchangeForSession());
    } catch (err) {
      setState((p) => ({ ...p, error: firebaseErrorMessage(err) }));
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* навіть якщо не вийшло — локально скидаємо */
    }
    try {
      await firebaseSignOut(auth);
    } catch {
      /* не критично для локального виходу */
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
    loginWithGoogle,
    logout,
    continueAsGuest,
    clearError,
  };
}
