import React, { useMemo, useState } from 'react';
import { Bot, BrainCircuit, Check, ChevronDown, Gauge, MessageSquareText, Sparkles } from 'lucide-react';

export type AIProviderId = 'auto' | 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'jev';
export type AITaskKind = 'chat' | 'generate' | 'analyze' | 'evaluate' | 'route';

export interface AIProviderOption {
  id: AIProviderId;
  name: string;
  description: string;
  capabilities: AITaskKind[];
  badge?: string;
}

export interface AIProviderSelection {
  primary: AIProviderId;
  evaluator?: AIProviderId | null;
}

interface AIProviderSelectorProps {
  task: AITaskKind;
  value: AIProviderSelection;
  onChange: (next: AIProviderSelection) => void;
  compact?: boolean;
  showEvaluator?: boolean;
  label?: string;
}

export const DEFAULT_AI_PROVIDERS: AIProviderOption[] = [
  {
    id: 'auto',
    name: 'Автовибір',
    description: 'Платформа обирає доступний AI для цього типу завдання.',
    capabilities: ['chat', 'generate', 'analyze', 'evaluate', 'route'],
    badge: 'AUTO',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Діалог, творчі варіанти, редагування та аналіз.',
    capabilities: ['chat', 'generate', 'analyze'],
  },
  {
    id: 'anthropic',
    name: 'Claude',
    description: 'Діалог, робота з великим контекстом, творчий і структурний аналіз.',
    capabilities: ['chat', 'generate', 'analyze'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Діалог, генерація та аналіз контексту.',
    capabilities: ['chat', 'generate', 'analyze'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Діалог, генерація варіантів і структурний аналіз.',
    capabilities: ['chat', 'generate', 'analyze'],
  },
  {
    id: 'jev',
    name: 'Jev AI',
    description: 'Типізовані рішення: Choice, Score, Noul. Для оцінки стану, статусу, ризику й routing.',
    capabilities: ['evaluate', 'route', 'analyze'],
    badge: 'DECISION',
  },
];

const taskLabel: Record<AITaskKind, string> = {
  chat: 'Спілкування',
  generate: 'Генерація',
  analyze: 'Аналіз',
  evaluate: 'Оцінка',
  route: 'Рішення / routing',
};

export const AIProviderSelector: React.FC<AIProviderSelectorProps> = ({
  task,
  value,
  onChange,
  compact = false,
  showEvaluator = true,
  label = 'Штучний інтелект',
}) => {
  const [open, setOpen] = useState(false);
  const [evaluatorOpen, setEvaluatorOpen] = useState(false);

  const primaryProviders = useMemo(
    () => DEFAULT_AI_PROVIDERS.filter((provider) => provider.capabilities.includes(task) && provider.id !== 'jev'),
    [task],
  );

  const evaluatorProviders = useMemo(
    () => DEFAULT_AI_PROVIDERS.filter((provider) => provider.capabilities.includes('evaluate')),
    [],
  );

  const selectedPrimary = DEFAULT_AI_PROVIDERS.find((provider) => provider.id === value.primary) || DEFAULT_AI_PROVIDERS[0];
  const selectedEvaluator = value.evaluator
    ? DEFAULT_AI_PROVIDERS.find((provider) => provider.id === value.evaluator) || null
    : null;

  const supportsJev = task === 'analyze' || task === 'evaluate' || task === 'route';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'rounded-2xl border border-slate-800 bg-slate-950 p-3'}`} data-story-experience="ai-provider-selector">
      {!compact && (
        <div className="mr-1 min-w-[150px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="mt-0.5 text-xs text-slate-400">{taskLabel[task]}</div>
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-w-[170px] items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs text-slate-200 hover:border-slate-700"
          aria-expanded={open}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <Bot className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
            <span className="truncate font-semibold">{selectedPrimary.name}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-2 w-[320px] max-w-[85vw] rounded-2xl border border-slate-700 bg-slate-950 p-2 shadow-2xl shadow-black/40">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Основний AI · {taskLabel[task]}</div>
            {primaryProviders.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                selected={value.primary === provider.id}
                onClick={() => {
                  onChange({ ...value, primary: provider.id });
                  setOpen(false);
                }}
              />
            ))}
            {task === 'evaluate' && (
              <ProviderRow
                provider={DEFAULT_AI_PROVIDERS.find((provider) => provider.id === 'jev')!}
                selected={value.primary === 'jev'}
                recommended
                onClick={() => {
                  onChange({ ...value, primary: 'jev' });
                  setOpen(false);
                }}
              />
            )}
          </div>
        )}
      </div>

      {showEvaluator && supportsJev && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setEvaluatorOpen((current) => !current)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
              selectedEvaluator
                ? 'border-violet-500/35 bg-violet-500/10 text-violet-100'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
            aria-expanded={evaluatorOpen}
          >
            <Gauge className="h-3.5 w-3.5" />
            {selectedEvaluator ? `Оцінює: ${selectedEvaluator.name}` : 'Додати AI-оцінювач'}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {evaluatorOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-[340px] max-w-[88vw] rounded-2xl border border-slate-700 bg-slate-950 p-2 shadow-2xl shadow-black/40">
              <div className="px-2 py-1.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">AI-оцінювач</div>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">Оцінювач не замінює основний AI. Він повертає структурований сигнал для стану, статусу або рішення.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...value, evaluator: null });
                  setEvaluatorOpen(false);
                }}
                className="w-full rounded-xl px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                Без окремого оцінювача
              </button>
              {evaluatorProviders.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  selected={value.evaluator === provider.id}
                  recommended={provider.id === 'jev'}
                  onClick={() => {
                    onChange({ ...value, evaluator: provider.id });
                    setEvaluatorOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {value.evaluator === 'jev' && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200" title="Jev використовується як decision/evaluation layer, а не як чат-генератор">
          <BrainCircuit className="h-3 w-3" /> Jev · decision layer
        </span>
      )}
    </div>
  );
};

const ProviderRow: React.FC<{
  provider: AIProviderOption;
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
}> = ({ provider, selected, recommended = false, onClick }) => (
  <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-900">
    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${provider.id === 'jev' ? 'bg-violet-500/15 text-violet-300' : 'bg-cyan-500/10 text-cyan-300'}`}>
      {provider.id === 'jev' ? <BrainCircuit className="h-3.5 w-3.5" /> : provider.id === 'auto' ? <Sparkles className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="text-xs font-bold text-white">{provider.name}</span>
        {provider.badge && <span className="rounded-full border border-slate-700 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">{provider.badge}</span>}
        {recommended && <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[8px] font-bold text-violet-300">РЕКОМЕНДОВАНО</span>}
      </span>
      <span className="mt-1 block text-[10px] leading-4 text-slate-500">{provider.description}</span>
    </span>
    {selected && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />}
  </button>
);
