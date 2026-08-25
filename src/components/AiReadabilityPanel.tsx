import React, { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, CheckCheck, Gauge } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * Компактна «AI читабельність + зауваження перевірки», яка дублює функції
 * розділу «AI Редактор» (AIStudioView) і може бути викликана прямо в
 * редакторі «Книга & Текст» через контекстне меню (правий клік по полю).
 */
interface GrammarIssue {
  id: string;
  type: 'spelling' | 'grammar' | 'syntax' | 'repetition' | 'style' | 'cliche';
  word: string;
  context: string;
  message: string;
  suggestions: string[];
  severity: 'error' | 'warning' | 'info';
}

interface GrammarCheckResult {
  issues: GrammarIssue[];
  readabilityScore: number;
  stats: {
    wordCount: number;
    uniqueWordsCount: number;
    readingTimeMinutes: number;
  };
}

interface AiReadabilityPanelProps {
  /** Текст поточного розділу для перевірки. */
  text: string;
  /** ID розділу — при зміні скидаємо результат попередньої перевірки. */
  sectionId: string;
  /** Чи показувати блок читабельності. */
  showReadability?: boolean;
  /** Чи показувати блок «Знайдені зауваження AI-перевірки». */
  showIssues?: boolean;
}

export const AiReadabilityPanel: React.FC<AiReadabilityPanelProps> = ({
  text,
  sectionId,
  showReadability = true,
  showIssues = true,
}) => {
  const { t } = useLanguage();
  const [grammarCheck, setGrammarCheck] = useState<GrammarCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Скидаємо результат при зміні розділу — інакше показувались би застарілі дані.
  useEffect(() => {
    setGrammarCheck(null);
    setError(null);
  }, [sectionId]);

  const readabilityLabelFor = (score: number) => {
    if (score >= 80) return { text: t('aiStudio.readabilityHigh'), color: 'text-emerald-400' };
    if (score >= 60) return { text: t('aiStudio.readabilityMedium'), color: 'text-amber-400' };
    return { text: t('aiStudio.readabilityLow'), color: 'text-rose-400' };
  };

  const severityStyles: Record<GrammarIssue['severity'], string> = {
    error: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    warning: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    info: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  };

  const issueTypeLabel = (type: GrammarIssue['type']): string => {
    const key: Record<GrammarIssue['type'], string> = {
      spelling: 'aiStudio.issueTypeSpelling',
      grammar: 'aiStudio.issueTypeGrammar',
      syntax: 'aiStudio.issueTypeSyntax',
      repetition: 'aiStudio.issueTypeRepetition',
      style: 'aiStudio.issueTypeStyle',
      cliche: 'aiStudio.issueTypeCliche',
    };
    return t(key[type] || 'aiStudio.issueTypeStyle');
  };

  const handleCheck = async () => {
    if (!text?.trim()) return;
    setIsChecking(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/check-grammar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'request failed');
      setGrammarCheck(data);
    } catch {
      setError(t('aiStudio.grammarCheckError'));
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="space-y-3">
      {showReadability && (
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            {t('aiStudio.readabilityLabel')}
          </span>
          {grammarCheck ? (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">{grammarCheck.readabilityScore} / 100</span>
              <span className={`text-xs font-medium ${readabilityLabelFor(grammarCheck.readabilityScore).color}`}>
                {readabilityLabelFor(grammarCheck.readabilityScore).text}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-600">—</span>
              <span className="text-xs text-slate-500 font-medium">{t('aiStudio.readabilityNotChecked')}</span>
            </div>
          )}
          <p className="text-[11px] text-slate-400">{t('aiStudio.readabilityHint')}</p>
          <button
            onClick={handleCheck}
            disabled={isChecking || !text?.trim()}
            className="mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 text-[11px] font-bold disabled:opacity-40 transition-colors"
          >
            {isChecking ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{t('aiStudio.readabilityChecking')}</span>
              </>
            ) : (
              <span>{grammarCheck ? t('aiStudio.readabilityCheckAgainBtn') : t('aiStudio.readabilityCheckBtn')}</span>
            )}
          </button>
          {error && (
            <p className="text-[11px] text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>
      )}

      {showIssues && !grammarCheck && (
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-500">
          {t('editor.aiIssuesPendingHint')}
        </div>
      )}

      {showIssues && grammarCheck && (
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">
              {t('aiStudio.grammarIssuesHeading')}
            </h3>
            <span className="text-[10px] text-slate-500">
              {grammarCheck.stats.wordCount} {t('aiStudio.grammarStatsWords')} · {grammarCheck.stats.uniqueWordsCount} {t('aiStudio.grammarStatsUnique')} · {grammarCheck.stats.readingTimeMinutes} {t('aiStudio.grammarStatsReadingTime')}
            </span>
          </div>

          {grammarCheck.issues.length === 0 ? (
            <p className="text-xs text-emerald-300 flex items-center gap-2">
              <CheckCheck className="w-4 h-4" />
              <span>{t('aiStudio.grammarIssuesEmpty')}</span>
            </p>
          ) : (
            <div className="space-y-2">
              {grammarCheck.issues.map((issue) => (
                <div key={issue.id} className={`p-3 rounded-xl border text-xs space-y-1.5 ${severityStyles[issue.severity] || severityStyles.info}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/20 border border-white/10">
                      {issueTypeLabel(issue.type)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/20 border border-white/10">
                      {issue.severity === 'error' ? t('aiStudio.severityError') : issue.severity === 'warning' ? t('aiStudio.severityWarning') : t('aiStudio.severityInfo')}
                    </span>
                  </div>
                  {issue.context && (
                    <p className="font-serif-book leading-relaxed text-slate-200">
                      {issue.context.split(issue.word).map((part, idx, arr) => (
                        <React.Fragment key={idx}>
                          {part}
                          {idx < arr.length - 1 && (
                            <mark className="bg-yellow-400/80 text-slate-950 rounded px-0.5">{issue.word}</mark>
                          )}
                        </React.Fragment>
                      ))}
                    </p>
                  )}
                  <p className="text-slate-300">{issue.message}</p>
                  {issue.suggestions?.length > 0 && (
                    <p className="text-slate-400">
                      <span className="font-bold">{t('aiStudio.suggestionsLabel')}</span> {issue.suggestions.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
