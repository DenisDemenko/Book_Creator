import React, { useEffect, useMemo, useState } from 'react';
import { Bot, BrainCircuit, Check, ChevronDown, Gauge, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';

/**
 * Основний AI тепер обирається НЕ зі статичного UX-списку, а з живого
 * `/api/chat/models`, який уже є єдиним реєстром моделей у Studio.
 * Це означає, що UX автоматично підхоплює OpenAI / Claude / Gemini /
 * DeepSeek / Groq / Mistral та майбутні моделі без дублювання каталогу.
 */
export type AIProviderId = string;
export type AITaskKind = 'chat' | 'generate' | 'analyze' | 'evaluate' | 'route';

export interface CoreAiModelOption {
  id: string;
  label: string;
  engine: string;
  provider?: string;
  available: boolean;
  vision?: boolean;
  contextWindow?: string;
}

export interface AIProviderSelection {
  /** Порожній рядок = серверний/адмінський автовибір. Інакше — реальний modelId. */
  primary: AIProviderId;
  /** Jev поки окремий evaluation layer і не входить до CHAT_MODELS. */
  evaluator?: 'jev' | null;
}

interface AIProviderSelectorProps {
  task: AITaskKind;
  value: AIProviderSelection;
  onChange: (next: AIProviderSelection) => void;
  compact?: boolean;
  showEvaluator?: boolean;
  label?: string;
  /** Модель, уже обрана для книги (`book.preferredAiModelId`). */
  preferredModelId?: string;
  /** Якщо конкретна дія потребує vision — відсікаємо текстові моделі серверним прапорцем. */
  requireVision?: boolean;
}

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
  preferredModelId,
  requireVision = false,
}) => {
  const [open, setOpen] = useState(false);
  const [evaluatorOpen, setEvaluatorOpen] = useState(false);
  const [models, setModels] = useState<CoreAiModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    fetch('/api/chat/models', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('models unavailable');
        return response.json();
      })
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data?.models) ? (data.models as CoreAiModelOption[]) : [];
        setModels(list);
      })
      .catch(() => {
        if (!alive) return;
        setModels([]);
        setLoadError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const primaryModels = useMemo(
    () => models.filter((model) => !requireVision || model.vision === true),
    [models, requireVision],
  );

  const selectedPrimary = primaryModels.find((model) => model.id === value.primary)
    || models.find((model) => model.id === value.primary)
    || null;

  const supportsJev = task === 'analyze' || task === 'evaluate' || task === 'route';

  const chooseBookModel = () => {
    if (!preferredModelId) return;
    onChange({ ...value, primary: preferredModelId });
    setOpen(false);
  };

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
          className="inline-flex min-w-[190px] items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs text-slate-200 hover:border-slate-700"
          aria-expanded={open}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <Bot className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
            <span className="truncate font-semibold">
              {loading ? 'Завантаження моделей…' : selectedPrimary?.label || (value.primary ? value.primary : 'Автоматично')}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-2 w-[360px] max-w-[88vw] rounded-2xl border border-slate-700 bg-slate-950 p-2 shadow-2xl shadow-black/40">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Основний AI · {taskLabel[task]}</div>

            <button
              type="button"
              onClick={() => {
                onChange({ ...value, primary: '' });
                setOpen(false);
              }}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-900"
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-300"><Sparkles className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1"><span className="text-xs font-bold text-white">Автоматично</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">Використати серверний вибір або прив’язку адміністратора.</span></span>
              {!value.primary && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />}
            </button>

            {preferredModelId && preferredModelId !== value.primary && (
              <button type="button" onClick={chooseBookModel} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-900">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-300"><Bot className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1"><span className="text-xs font-bold text-white">Модель книги</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{models.find((model) => model.id === preferredModelId)?.label || preferredModelId}</span></span>
              </button>
            )}

            {loading && <div className="px-3 py-4 text-xs text-slate-500">Завантажуємо каталог Studio…</div>}

            {!loading && loadError && (
              <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-xs text-amber-300 hover:bg-slate-900">
                <RefreshCw className="h-3.5 w-3.5" /> Не вдалося завантажити моделі. Спробувати ще раз
              </button>
            )}

            {!loading && !loadError && primaryModels.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={value.primary === model.id}
                preferred={preferredModelId === model.id}
                onClick={() => {
                  if (!model.available) return;
                  onChange({ ...value, primary: model.id });
                  setOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showEvaluator && supportsJev && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setEvaluatorOpen((current) => !current)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
              value.evaluator === 'jev'
                ? 'border-violet-500/35 bg-violet-500/10 text-violet-100'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
            aria-expanded={evaluatorOpen}
          >
            <Gauge className="h-3.5 w-3.5" />
            {value.evaluator === 'jev' ? 'Оцінює: Jev AI' : 'Додати AI-оцінювач'}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {evaluatorOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-[340px] max-w-[88vw] rounded-2xl border border-slate-700 bg-slate-950 p-2 shadow-2xl shadow-black/40">
              <div className="px-2 py-1.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">AI-оцінювач</div>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">Це окремий decision layer. Він не замінює основну модель Studio.</p>
              </div>
              <button type="button" onClick={() => { onChange({ ...value, evaluator: null }); setEvaluatorOpen(false); }} className="w-full rounded-xl px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-900 hover:text-white">Без окремого оцінювача</button>
              <button type="button" onClick={() => { onChange({ ...value, evaluator: 'jev' }); setEvaluatorOpen(false); }} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-900">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300"><BrainCircuit className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-xs font-bold text-white">Jev AI</span><span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[8px] font-bold text-violet-300">DECISION</span></span><span className="mt-1 block text-[10px] leading-4 text-slate-500">Choice / Score / Noul для стану, статусу, severity та human-review сигналів.</span></span>
                {value.evaluator === 'jev' && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />}
              </button>
            </div>
          )}
        </div>
      )}

      {value.evaluator === 'jev' && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-200" title="Jev працює окремим evaluation layer">
          <BrainCircuit className="h-3 w-3" /> Jev · decision layer
        </span>
      )}
    </div>
  );
};

const ModelRow: React.FC<{
  model: CoreAiModelOption;
  selected: boolean;
  preferred: boolean;
  onClick: () => void;
}> = ({ model, selected, preferred, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!model.available}
    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ${model.available ? 'hover:bg-slate-900' : 'cursor-not-allowed opacity-45'}`}
  >
    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-300"><MessageSquareText className="h-3.5 w-3.5" /></span>
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-white">{model.label}</span>
        {preferred && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-300">МОДЕЛЬ КНИГИ</span>}
        {!model.available && <span className="rounded-full border border-slate-700 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">НЕМАЄ КЛЮЧА</span>}
      </span>
      <span className="mt-1 block text-[10px] leading-4 text-slate-500">{model.provider || model.engine}{model.contextWindow ? ` · ${model.contextWindow}` : ''}{model.vision ? ' · Vision' : ''}</span>
    </span>
    {selected && <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />}
  </button>
);
