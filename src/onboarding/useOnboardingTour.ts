import { useCallback, useEffect, useState } from 'react';
import type { AuthUser, NavigationTab } from '../types';
import { TOUR_STEPS } from './tourSteps';
import type { TourStep } from './types';

const DISABLED_PREFIX = 'nova_tour_disabled_';
const SEEN_TAB_PREFIX = 'nova_tour_seen_';
const SNOOZED_TAB_PREFIX = 'nova_tour_snoozed_';
/** Затримка перед показом туру після переходу на вкладку — дає DOM змонтуватись. */
const MOUNT_DELAY_MS = 500;

function userKey(authUser?: AuthUser | null): string {
  if (!authUser) return 'anon';
  return authUser.id || authUser.email || 'guest';
}

function readLocal(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeLocal(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* приватний режим браузера чи заблоковане сховище — тур просто не запамʼятається */
  }
}

function readSession(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeSession(key: string) {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* ігноруємо — максимум тур покажеться ще раз цього сеансу */
  }
}

export interface OnboardingTourState {
  step: TourStep | null;
  stepNumber: number;
  totalSteps: number;
  isLast: boolean;
  /** Перейти до наступної підказки; на останньому кроці — завершує тур для вкладки. */
  next: () => void;
  /** Відкласти: сховати тур цього сеансу, показати знову за наступного заходу на вкладку. */
  later: () => void;
  /** «Я вже в курсі» — вимкнути довідку повністю для поточного користувача. */
  gotIt: () => void;
}

/**
 * Керує показом довідкового туру для поточної вкладки застосунку.
 *
 * Правила показу:
 * - Якщо користувач раніше натиснув «Я вже в курсі» — тур більше ніколи
 *   не зʼявляється для нього (localStorage, ключ прив'язаний до user.id/email).
 * - Якщо для конкретної вкладки тур уже пройдено до кінця — вона більше
 *   не показує тур повторно (окремий localStorage-прапорець на вкладку).
 * - «Пізніше» лише відкладає показ у межах поточної сесії (sessionStorage) —
 *   тур зʼявиться знову наступного разу, коли користувач відкриє сайт.
 */
export function useOnboardingTour(currentTab: NavigationTab, authUser?: AuthUser | null): OnboardingTourState {
  const uKey = userKey(authUser);
  const steps = TOUR_STEPS[currentTab] || [];

  const [disabled, setDisabled] = useState<boolean>(() => readLocal(`${DISABLED_PREFIX}${uKey}`));
  const [stepIndex, setStepIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<NavigationTab | null>(null);

  useEffect(() => {
    setDisabled(readLocal(`${DISABLED_PREFIX}${uKey}`));
  }, [uKey]);

  useEffect(() => {
    if (disabled || !steps.length) {
      setActiveTab(null);
      return;
    }
    const seenKey = `${SEEN_TAB_PREFIX}${uKey}_${currentTab}`;
    const snoozeKey = `${SNOOZED_TAB_PREFIX}${uKey}_${currentTab}`;
    if (readLocal(seenKey) || readSession(snoozeKey)) {
      setActiveTab(null);
      return;
    }
    const timer = setTimeout(() => {
      setStepIndex(0);
      setActiveTab(currentTab);
    }, MOUNT_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab, disabled, uKey, steps.length]);

  const currentStep = activeTab === currentTab ? steps[stepIndex] || null : null;

  const next = useCallback(() => {
    if (stepIndex + 1 >= steps.length) {
      writeLocal(`${SEEN_TAB_PREFIX}${uKey}_${currentTab}`, true);
      setActiveTab(null);
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, steps.length, uKey, currentTab]);

  const later = useCallback(() => {
    writeSession(`${SNOOZED_TAB_PREFIX}${uKey}_${currentTab}`);
    setActiveTab(null);
  }, [uKey, currentTab]);

  const gotIt = useCallback(() => {
    writeLocal(`${DISABLED_PREFIX}${uKey}`, true);
    setDisabled(true);
    setActiveTab(null);
  }, [uKey]);

  return {
    step: currentStep,
    stepNumber: stepIndex + 1,
    totalSteps: steps.length,
    isLast: stepIndex + 1 >= steps.length,
    next,
    later,
    gotIt,
  };
}
