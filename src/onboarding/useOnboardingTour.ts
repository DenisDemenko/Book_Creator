import { useCallback, useEffect, useState } from 'react';
import type { AuthUser, NavigationTab } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { TOUR_STEPS } from './tourSteps';

/** Огляд запускається лише вручну; переходи між вкладками не завершують його. */
export function useOnboardingTour(currentTab: NavigationTab, authUser?: AuthUser | null, startRequest = 0) {
  const { t } = useLanguage();
  const userKey = authUser?.id || authUser?.email || 'anon';
  const [session, setSession] = useState<{ user: string; request: number } | null>(null);
  const [position, setPosition] = useState({ tab: currentTab, index: 0, finished: false });
  const steps = TOUR_STEPS[currentTab] || [{ tabId: currentTab, step: 1, dataTour: '', title: t('onboardingTour.tourTitle'), text: t('onboardingTour.sectionHint') }];

  useEffect(() => setSession(null), [userKey]);

  useEffect(() => {
    if (!startRequest) return;
    setSession({ user: userKey, request: startRequest });
    setPosition({ tab: currentTab, index: 0, finished: false });
    // Зміна вкладки не є новим запитом запуску.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRequest]);

  useEffect(() => {
    setPosition({ tab: currentTab, index: 0, finished: false });
  }, [currentTab]);

  const index = position.tab === currentTab ? position.index : 0;
  const active = session?.user === userKey && session.request === startRequest;
  const step = active && !(position.tab === currentTab && position.finished) ? steps[index] || null : null;
  const next = useCallback(() => {
    setPosition({ tab: currentTab, index: Math.min(index + 1, steps.length - 1), finished: index + 1 >= steps.length });
  }, [currentTab, index, steps.length]);
  const previous = useCallback(() => {
    setPosition({ tab: currentTab, index: Math.max(0, index - 1), finished: false });
  }, [currentTab, index]);
  const stop = useCallback(() => setSession(null), []);

  return { step, stepNumber: index + 1, totalSteps: steps.length, isLast: index + 1 >= steps.length, next, previous, stop };
}
