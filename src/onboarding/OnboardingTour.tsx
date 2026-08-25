import React, { useEffect, useRef, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import type { AuthUser, NavigationTab } from '../types';
import { useOnboardingTour } from './useOnboardingTour';
import { useLanguage } from '../i18n/LanguageContext';

interface OnboardingTourProps {
  currentTab: NavigationTab;
  authUser?: AuthUser | null;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 320;
const GUTTER = 14;

/**
 * Спливаюче довідкове вікно поверх кнопок сайту.
 *
 * Для кожної вкладки шукає в DOM елемент з `data-tour="<tabId>__N"`,
 * підсвічує його «прожектором» (затемнення решти екрана + світляна рамка)
 * і малює поруч картку з поясненням у веселковій рамці з ефектом аврори.
 * Один екземпляр монтується один раз у корені застосунку — активна
 * підказка визначається пропом currentTab.
 */
export const OnboardingTour: React.FC<OnboardingTourProps> = ({ currentTab, authUser }) => {
  const { t } = useLanguage();
  const { step, stepNumber, totalSteps, isLast, next, later, gotIt } = useOnboardingTour(currentTab, authUser);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;

    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.dataTour}"]`);
      if (!el) {
        attempts += 1;
        if (attempts < 20) {
          retryTimer.current = setTimeout(measure, 150);
        }
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      const apply = () => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        setPlacement(r.top > window.innerHeight / 2 ? 'top' : 'bottom');
      };
      // Невелика пауза, щоб scrollIntoView встиг доскролити перед виміром.
      retryTimer.current = setTimeout(apply, 260);
    };

    measure();

    const onViewportChange = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.dataTour}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      setPlacement(r.top > window.innerHeight / 2 ? 'top' : 'bottom');
    };
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [step]);

  if (!step || !rect) return null;

  const top = placement === 'bottom' ? rect.top + rect.height + GUTTER : undefined;
  const bottom = placement === 'top' ? window.innerHeight - rect.top + GUTTER : undefined;
  let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - CARD_WIDTH - 10));

  return (
    <>
      {/* Прожектор: затемнює сторінку, лишаючи світлу рамку навколо цільового елемента */}
      <div
        className="nova-tour-spotlight"
        style={{
          top: rect.top - 8,
          left: rect.left - 8,
          width: rect.width + 16,
          height: rect.height + 16,
        }}
      />

      {/* Картка підказки з веселковою рамкою та аврора-світінням */}
      <div
        className="nova-tour-card fixed z-[85]"
        style={{ top, bottom, left, width: CARD_WIDTH }}
        role="dialog"
        aria-live="polite"
      >
        <div className="relative z-10 p-4 rounded-[1.1rem]">
          <div className="flex items-center justify-between mb-1.5 gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-white/85">
              <Sparkles className="w-3 h-3" />
              {t('onboardingTour.stepLabel', { current: String(stepNumber), total: String(totalSteps) })}
            </span>
            <button
              type="button"
              onClick={later}
              aria-label={t('onboardingTour.closeAriaLabel')}
              className="text-white/70 hover:text-white p-0.5 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <h4 className="text-sm font-extrabold text-white mb-1 leading-snug drop-shadow-sm">
            {step.title}
          </h4>
          <p className="text-xs leading-relaxed text-white font-medium mb-3">
            {step.text}
          </p>

          <button
            type="button"
            onClick={next}
            className="w-full px-3 py-2 rounded-xl bg-white text-blue-700 text-xs font-black hover:bg-white/90 active:scale-[0.98] transition-all shadow-md"
          >
            {isLast ? t('onboardingTour.finishBtn') : t('onboardingTour.nextBtn')}
          </button>

          <div className="flex items-center justify-between gap-2 mt-2">
            <button
              type="button"
              onClick={later}
              className="text-[11px] font-bold text-white/85 hover:text-white underline underline-offset-2 decoration-white/40"
            >
              {t('onboardingTour.laterBtn')}
            </button>
            <button
              type="button"
              onClick={gotIt}
              className="text-[11px] font-bold text-white/85 hover:text-white underline underline-offset-2 decoration-white/40"
            >
              {t('onboardingTour.gotItBtn')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
