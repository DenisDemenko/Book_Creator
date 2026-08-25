import React, { useState } from 'react';
import { BookOpenText, Target, PenLine, Sparkles, Loader2, Trophy, AlertTriangle } from 'lucide-react';
import { INITIAL_MASTERY_STATE, getMasteryLevelInfo } from '../data/skillsData';
import type { WriterMasteryState } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { recordAiScore } from '../utils/aiScoreHistory';

export interface TrainerCriterionResult {
  key: string;
  label: string;
  score: number;
}

interface TrainerEvaluation {
  criteria: TrainerCriterionResult[];
  overallScore: number;
  tips: string[];
  xpEarned: number;
}

export interface TrainerConfig {
  trainerType: 'character' | 'dialogue';
  titleKey: string;
  theoryKey: string;
  taskKey: string;
  placeholderKey: string;
  taskPromptKey: string;
}

const MAX_ANSWER_CHARS = 1000;
const MASTERY_STORAGE_KEY = 'nova_writer_mastery_state';

/** Той самий місток, яким Фаза 0/1 уже з'єднують AIStudioView/MasteryView/DashboardView — тренажери нараховують XP у той самий стан. */
function awardXpToMastery(xp: number): void {
  try {
    const saved = localStorage.getItem(MASTERY_STORAGE_KEY);
    const state: WriterMasteryState = saved ? JSON.parse(saved) : INITIAL_MASTERY_STATE;
    const newXp = state.xp + xp;
    const levelInfo = getMasteryLevelInfo(newXp);
    const next: WriterMasteryState = { ...state, xp: newXp, level: levelInfo.level, levelTitle: levelInfo.title };
    localStorage.setItem(MASTERY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* приватний режим / заблоковане сховище — тренажер лишається корисним, просто без нарахування XP */
  }
}

export const TrainerView: React.FC<{ config: TrainerConfig }> = ({ config }) => {
  const { t } = useLanguage();
  const [userAnswer, setUserAnswer] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [result, setResult] = useState<TrainerEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    if (!userAnswer.trim()) return;
    setIsEvaluating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/evaluate-trainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainerType: config.trainerType,
          taskPrompt: t(config.taskPromptKey),
          userAnswer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setResult(data);
      awardXpToMastery(data.xpEarned || 0);
      // Фаза 3, 3.3: Портфоліо рахує середній бал AI-оцінок за всіма джерелами.
      recordAiScore(`trainer:${config.trainerType}`, data.overallScore);
    } catch {
      setError(t('trainersView.evaluateError'));
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setError(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Крок 1: Теорія */}
      <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
        <div className="flex items-center gap-2 mb-2">
          <BookOpenText className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('trainersView.stepTheory')}</h3>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">{t(config.theoryKey)}</p>
      </div>

      {/* Крок 2: Завдання */}
      <div className="nova-glass-dark rounded-2xl border border-amber-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('trainersView.stepTask')}</h3>
        </div>
        <p className="text-sm text-slate-200 font-semibold">{t(config.taskKey)}</p>
      </div>

      {/* Крок 3: Поле введення */}
      {!result && (
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
          <div className="flex items-center gap-2 mb-2">
            <PenLine className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('trainersView.stepAnswer')}</h3>
          </div>
          <textarea
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value.slice(0, MAX_ANSWER_CHARS))}
            placeholder={t(config.placeholderKey)}
            rows={8}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-slate-500">{userAnswer.length} / {MAX_ANSWER_CHARS}</span>
          </div>

          {error && (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Крок 4: Оцінити AI */}
          <button
            onClick={handleEvaluate}
            disabled={isEvaluating || !userAnswer.trim()}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50"
          >
            {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{isEvaluating ? t('trainersView.evaluating') : t('trainersView.evaluateBtn')}</span>
          </button>
        </div>
      )}

      {/* Результат */}
      {result && (
        <div className="nova-glass-dark rounded-2xl border border-emerald-500/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <span className="text-lg font-bold text-slate-100">{result.overallScore}/100</span>
            </div>
            <span className="text-xs font-bold text-amber-400">+{result.xpEarned} XP</span>
          </div>

          <div className="space-y-2.5">
            {result.criteria.map((c) => (
              <div key={c.key}>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>{c.label}</span>
                  <span className="font-mono">{c.score}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-cyan-500 to-indigo-400" style={{ width: `${c.score}%` }} />
                </div>
              </div>
            ))}
          </div>

          {result.tips.length > 0 && (
            <div className="pt-2 border-t border-slate-800">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{t('trainersView.tipsHeading')}</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
                {result.tips.map((tip, idx) => (
                  <li key={idx}>{tip}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleRetry}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            {t('trainersView.tryAgainBtn')}
          </button>
        </div>
      )}
    </div>
  );
};
