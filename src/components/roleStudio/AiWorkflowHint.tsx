/**
 * Підказка «Процес ШІ» в модулі ШІ (Т6.4 В3; ТЗ Role Onboarding §21): який
 * процес налаштує модель для цього завдання за вашою роллю в проєкті —
 * основне, суміжне чи поза процесом (не заборона). Налаштування застосовує
 * сервер (маршрутизатор); права не змінюються. Немає ролі чи книги в ядрі —
 * підказки немає.
 */
import React, { useEffect, useState } from 'react';
import { Route } from 'lucide-react';
import type { AiRoute, AiTask } from '../../utils/aiWorkflows';
import { fetchAiRoute, ROLE_SPACE_EVENT } from './roleStudioApi';
import { useLanguage } from '../../i18n/LanguageContext';

type Lang = 'uk' | 'en';

export function useAiRoute(projectId: string | null | undefined, task: AiTask): AiRoute | null {
  const [route, setRoute] = useState<AiRoute | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener(ROLE_SPACE_EVENT, on);
    return () => window.removeEventListener(ROLE_SPACE_EVENT, on);
  }, []);
  useEffect(() => {
    let live = true;
    if (!projectId) {
      setRoute(null);
      return;
    }
    void fetchAiRoute(projectId, task).then((r) => live && setRoute(r));
    return () => {
      live = false;
    };
  }, [projectId, task, tick]);
  return route;
}

export const AiWorkflowHint: React.FC<{ projectId: string | null | undefined; task: AiTask; lang?: Lang; className?: string }> = ({ projectId, task, lang: forced, className = '' }) => {
  const { lang: ctx } = useLanguage();
  const lang: Lang = forced ?? (ctx === 'en' ? 'en' : 'uk');
  const route = useAiRoute(projectId, task);
  if (!route) return null;
  const L = (uk: string, en: string) => (lang === 'en' ? en : uk);
  const fit =
    route.fit === 'primary' ? L('ваш процес', 'your workflow') : route.fit === 'secondary' ? L('суміжне завдання', 'related task') : L('поза вашим процесом — загальна допомога', 'outside your workflow — general help');
  const tone = route.fit === 'outside' ? 'border-slate-600/60 text-slate-400' : 'border-violet-400/40 text-violet-200';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border bg-slate-950/60 px-2 py-0.5 text-[10px] font-semibold ${tone} ${className}`}
      title={`${route.reason}. ${L('Налаштовує модель, але не змінює ваш доступ.', 'Tunes the model but never changes your access.')}`}
      data-ai-workflow={route.workflow}
      data-ai-fit={route.fit}
    >
      <Route className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {route.workflowName[lang]} · {fit}
      </span>
    </span>
  );
};

export default AiWorkflowHint;
