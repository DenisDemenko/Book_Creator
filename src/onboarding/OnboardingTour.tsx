import React, { useEffect, useRef } from 'react';
import { X, Compass, ArrowLeft, ArrowRight } from 'lucide-react';
import type { AuthUser, NavigationTab } from '../types';
import { useOnboardingTour } from './useOnboardingTour';
import { useLanguage } from '../i18n/LanguageContext';

interface OnboardingTourProps {
  currentTab: NavigationTab;
  authUser?: AuthUser | null;
  startRequest?: number;
}

/** Немодальна довідка залишає навігацію Студією доступною. */
export const OnboardingTour: React.FC<OnboardingTourProps> = ({ currentTab, authUser, startRequest = 0 }) => {
  const { t } = useLanguage();
  const { step, stepNumber, totalSteps, isLast, next, previous, stop } = useOnboardingTour(currentTab, authUser, startRequest);
  const card = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!startRequest) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [startRequest]);

  useEffect(() => {
    if (!step) return;
    card.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stop();
        opener.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, stop]);

  useEffect(() => {
    if (!step) return;
    // Не блокуємо вікно довідки, якщо ціль прихована або ще завантажується.
    const target = document.querySelector<HTMLElement>(`[data-tour="${step.dataTour}"]`);
    target?.classList.add('nova-tour-target');
    return () => target?.classList.remove('nova-tour-target');
  }, [step]);

  if (!step) return null;
  const close = () => { stop(); opener.current?.focus(); };

  return (
    <section ref={card} className="nova-tour-card" role="dialog" aria-modal="false" aria-labelledby="nova-tour-title" aria-describedby="nova-tour-description" tabIndex={-1}>
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
          <Compass className="h-4 w-4" />{t('onboardingTour.tourTitle')}
        </span>
        <button type="button" onClick={close} aria-label={t('onboardingTour.closeAriaLabel')} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="mb-5 mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className="h-full rounded-full bg-cyan-400" style={{ width: `${stepNumber / totalSteps * 100}%` }} />
      </div>
      <p className="mb-2 text-xs text-slate-400">{t('onboardingTour.stepLabel', { current: String(stepNumber), total: String(totalSteps) })}</p>
      <h2 id="nova-tour-title" className="mb-3 text-xl font-bold text-white">{step.title}</h2>
      <p id="nova-tour-description" className="text-sm leading-6 text-slate-200">{step.text}</p>
      <p className="mb-5 mt-4 text-xs leading-5 text-slate-400">{t('onboardingTour.navigationHint')}</p>
      <div className="flex items-center gap-3">
        <button type="button" onClick={previous} disabled={stepNumber === 1} aria-label={t('onboardingTour.previousBtn')} className="rounded-xl border border-white/15 p-3 text-white disabled:opacity-30"><ArrowLeft className="h-4 w-4" /></button>
        <button type="button" onClick={next} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200">{isLast ? t('onboardingTour.finishBtn') : t('onboardingTour.nextBtn')}<ArrowRight className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={close} className="mt-4 text-xs text-slate-400 underline underline-offset-4 hover:text-white">{t('onboardingTour.stopBtn')}</button>
    </section>
  );
};
