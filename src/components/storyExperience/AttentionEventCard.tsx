import React from 'react';
import { BellRing, Check, Sparkles, X } from 'lucide-react';
import { AttentionAurora } from './AttentionAurora';

export type AttentionEventKind = 'ai' | 'game' | 'diagnostic' | 'system';

interface AttentionEventCardProps {
  title: string;
  description: string;
  kind?: AttentionEventKind;
  active?: boolean;
  actionLabel?: string;
  onOpen?: () => void;
  onDismiss?: () => void;
  onAcknowledge?: () => void;
}

const kindLabel: Record<AttentionEventKind, string> = {
  ai: 'AI-подія',
  game: 'Подія сесії',
  diagnostic: 'Новий висновок',
  system: 'Зміна стану',
};

export const AttentionEventCard: React.FC<AttentionEventCardProps> = ({
  title,
  description,
  kind = 'ai',
  active = true,
  actionLabel = 'Переглянути',
  onOpen,
  onDismiss,
  onAcknowledge,
}) => (
  <AttentionAurora active={active} intensity={kind === 'game' ? 'strong' : 'normal'} ariaLabel={active ? `Потрібна увага: ${title}` : undefined}>
    <article className="rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-xl" data-story-experience="attention-event-card">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-2 text-violet-200">
          {kind === 'ai' || kind === 'diagnostic' ? <Sparkles className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-300">{kindLabel[kind]}</div>
          <h3 className="mt-1 text-sm font-bold text-white">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onOpen && <button type="button" onClick={onOpen} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-950">{actionLabel}</button>}
            {onAcknowledge && <button type="button" onClick={onAcknowledge} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300"><Check className="h-3.5 w-3.5" /> Помічено</button>}
            {onDismiss && <button type="button" onClick={onDismiss} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-500"><X className="h-3.5 w-3.5" /> Приховати</button>}
          </div>
        </div>
      </div>
    </article>
  </AttentionAurora>
);
