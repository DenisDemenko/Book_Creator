import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Check,
  X,
  RotateCcw,
  Sliders,
  Gauge,
  BookOpen,
  History,
  Wand2,
  FileText,
  Layers,
  BarChart3,
  MessageSquare,
  Flame,
  CheckCheck,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Book, AIProposal } from '../types';
import { computeWordDiff, calculateWordCount } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';
import { recordAiScore } from '../utils/aiScoreHistory';

interface AIStudioViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book) => void;
}

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

export const AIStudioView: React.FC<AIStudioViewProps> = ({ book, onUpdateBook }) => {
  const { t } = useLanguage();
  const [selectedChapterId, setSelectedChapterId] = useState<string>(book.chapters[0]?.id || '');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(book.chapters[0]?.sections[0]?.id || '');
  const [customPrompt, setCustomPrompt] = useState('');
  const [activePreset, setActivePreset] = useState('improve');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentProposal, setCurrentProposal] = useState<AIProposal | null>(null);

  // 0.1: реальна AI-перевірка граматики/стилю/читабельності — раніше тут
  // були захардкоджені 88/100 та 92%.
  const [grammarCheck, setGrammarCheck] = useState<GrammarCheckResult | null>(null);
  const [isCheckingGrammar, setIsCheckingGrammar] = useState(false);
  const [grammarCheckError, setGrammarCheckError] = useState<string | null>(null);

  const selectedChapter = book.chapters.find((c) => c.id === selectedChapterId) || book.chapters[0];
  const selectedSection = selectedChapter?.sections.find((s) => s.id === selectedSectionId) || selectedChapter?.sections[0];

  // Calculate some analytics
  const totalWords = book.chapters.reduce((acc, c) => acc + c.sections.reduce((sAcc, s) => sAcc + s.wordCount, 0), 0);
  const totalChars = book.chapters.reduce((acc, c) => acc + c.sections.reduce((sAcc, s) => sAcc + s.content.length, 0), 0);

  // Pacing and dialogue stats
  const sampleText = selectedSection?.content || '';
  const dialogueLines = sampleText.split('\n').filter((l) => l.trim().startsWith('—') || l.trim().startsWith('-')).length;
  const totalParagraphs = sampleText.split('\n\n').filter((p) => p.trim().length > 0).length;
  const dialoguePercentage = totalParagraphs > 0 ? Math.min(100, Math.round((dialogueLines / totalParagraphs) * 100)) : 30;

  // Словникове різноманіття — рахуємо реально з тексту розділу (частка
  // унікальних слів), а не показуємо статичні 92%.
  const vocabWords = (sampleText.toLowerCase().match(/[а-яіїєґ'a-z]+/gi) || []);
  const vocabDiversity = vocabWords.length > 0
    ? Math.round((new Set(vocabWords).size / vocabWords.length) * 100)
    : 0;

  // Скидаємо результат попередньої AI-перевірки при зміні розділу —
  // інакше показувались би застарілі дані для іншого тексту.
  useEffect(() => {
    setGrammarCheck(null);
    setGrammarCheckError(null);
  }, [selectedSectionId]);

  const handleCheckGrammar = async () => {
    if (!selectedSection?.content?.trim()) return;
    setIsCheckingGrammar(true);
    setGrammarCheckError(null);
    try {
      const res = await fetch('/api/ai/check-grammar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selectedSection.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'request failed');
      setGrammarCheck(data);
      // Фаза 1, 1.4: Дашборд показує «Останній AI-аналіз» — той самий
      // localStorage-місток, яким Фаза 0 уже зʼєднала AIStudioView з
      // MasteryView (nova_ai_edit_apply_count), тепер для короткого
      // підсумку останньої перевірки граматики.
      try {
        localStorage.setItem(
          'nova_last_ai_analysis',
          JSON.stringify({
            readabilityScore: data.readabilityScore,
            issuesCount: Array.isArray(data.issues) ? data.issues.length : 0,
            checkedAt: new Date().toISOString(),
            sectionTitle: selectedSection.title,
          })
        );
      } catch {
        // приватний режим / заблоковане сховище — не критично
      }
      // Фаза 3, 3.3: Портфоліо рахує середній бал AI-оцінок за всіма джерелами.
      recordAiScore('grammar', data.readabilityScore);
    } catch (err: any) {
      console.error('Error in /api/ai/check-grammar:', err);
      setGrammarCheckError(t('aiStudio.grammarCheckError'));
    } finally {
      setIsCheckingGrammar(false);
    }
  };

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

  const handleGenerateAi = async (category: string) => {
    if (!selectedSection?.content) return;
    setIsGenerating(true);

    try {
      const res = await fetch('/api/ai/edit-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectedSection.content,
          category,
          instruction: customPrompt || category,
          bookContext: `${book.title} (${book.genre})`,
          sceneContext: selectedSection.scene ? `${selectedSection.scene.title} - ${selectedSection.scene.summary}` : undefined,
        }),
      });

      const data = await res.json();
      if (data.proposedText) {
        const diffs = computeWordDiff(selectedSection.content, data.proposedText);
        setCurrentProposal({
          id: `prop-${Date.now()}`,
          sectionId: selectedSection.id,
          originalText: selectedSection.content,
          proposedText: data.proposedText,
          instruction: customPrompt || category,
          category: category as any,
          status: 'pending',
          diffSegments: diffs,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Error in AI Studio:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyProposal = () => {
    if (!currentProposal || !selectedChapter || !selectedSection) return;

    const updatedChapters = book.chapters.map((chap) => {
      if (chap.id !== selectedChapter.id) return chap;
      return {
        ...chap,
        sections: chap.sections.map((sec) => {
          if (sec.id !== selectedSection.id) return sec;
          return {
            ...sec,
            content: currentProposal.proposedText,
            wordCount: calculateWordCount(currentProposal.proposedText),
            lastModified: new Date().toISOString(),
          };
        }),
      };
    });

    onUpdateBook({ ...book, chapters: updatedChapters });

    try {
      const key = 'nova_ai_edit_apply_count';
      const prevCount = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      localStorage.setItem(key, String(prevCount + 1));
    } catch {
      // приватний режим / заблоковане сховище — лічильник просто не оновиться
    }

    setCurrentProposal(null);
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      
      {/* Header Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {t('aiStudio.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('aiStudio.headerSubBadge')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('aiStudio.headerTitle')}
          </h1>
        </div>
      </div>

      {/* Analytics Diagnostics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
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
          <p className="text-[11px] text-slate-400">
            {t('aiStudio.readabilityHint')}
          </p>
          <button
            onClick={handleCheckGrammar}
            disabled={isCheckingGrammar || !selectedSection?.content?.trim()}
            className="mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 text-cyan-300 text-[11px] font-bold disabled:opacity-40 transition-colors"
          >
            {isCheckingGrammar ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{t('aiStudio.readabilityChecking')}</span>
              </>
            ) : (
              <span>{grammarCheck ? t('aiStudio.readabilityCheckAgainBtn') : t('aiStudio.readabilityCheckBtn')}</span>
            )}
          </button>
          {grammarCheckError && (
            <p className="text-[11px] text-rose-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>{grammarCheckError}</span>
            </p>
          )}
        </div>

        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
            {t('aiStudio.dialogueBalanceLabel')}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{dialoguePercentage}%</span>
            <span className="text-xs text-indigo-300">{t('aiStudio.dialogueWord')}</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${dialoguePercentage}%` }} />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-purple-400" />
            {t('aiStudio.vocabDiversityLabel')}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{vocabDiversity}%</span>
            {vocabDiversity >= 70 && <span className="text-xs text-purple-300">{t('aiStudio.richLanguage')}</span>}
          </div>
          <p className="text-[11px] text-slate-400">
            {t('aiStudio.vocabHint')}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            {t('aiStudio.pacingLabel')}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{t('aiStudio.pacingDynamic')}</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {t('aiStudio.pacingHint')}
          </p>
        </div>
      </div>

      {/* Список зауважень реальної AI-перевірки граматики/стилю */}
      {grammarCheck && (
        <div className="p-5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              {t('aiStudio.grammarIssuesHeading')}
            </h3>
            <span className="text-[11px] text-slate-500">
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
                <div
                  key={issue.id}
                  className={`p-3 rounded-xl border text-xs space-y-1.5 ${severityStyles[issue.severity] || severityStyles.info}`}
                >
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

      {/* Transformation Playground */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Target Section & Prompt Settings (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              {t('aiStudio.materialSelectionHeading')}
            </h3>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">{t('aiStudio.chapterLabel')}</label>
              <select
                value={selectedChapterId}
                onChange={(e) => {
                  setSelectedChapterId(e.target.value);
                  const chap = book.chapters.find((c) => c.id === e.target.value);
                  if (chap && chap.sections[0]) {
                    setSelectedSectionId(chap.sections[0].id);
                  }
                }}
                data-tour="ai-studio__1"
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              >
                {book.chapters.map((chap) => (
                  <option key={chap.id} value={chap.id}>
                    {chap.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">{t('aiStudio.sectionLabel')}</label>
              <select
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              >
                {selectedChapter?.sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.title} ({sec.wordCount} {t('aiStudio.wordsCountSuffix')})
                  </option>
                ))}
              </select>
            </div>

            {/* Custom Instruction */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <label className="text-xs text-slate-400 block">{t('aiStudio.customRequestLabel')}</label>
              <textarea
                rows={3}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={t('aiStudio.customRequestPlaceholder')}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-cyan-400 focus:outline-hidden"
              />
            </div>

            {/* Preset categories */}
            <div className="grid grid-cols-2 gap-2 pt-2" data-tour="ai-studio__2">
              <button
                onClick={() => handleGenerateAi('artistic')}
                disabled={isGenerating}
                className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-xs text-left font-medium text-slate-300 hover:text-white"
              >
                {t('aiStudio.presetArtistic')}
              </button>
              <button
                onClick={() => handleGenerateAi('cinematic')}
                disabled={isGenerating}
                className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-xs text-left font-medium text-slate-300 hover:text-white"
              >
                {t('aiStudio.presetCinematic')}
              </button>
              <button
                onClick={() => handleGenerateAi('dialogue')}
                disabled={isGenerating}
                className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-xs text-left font-medium text-slate-300 hover:text-white"
              >
                {t('aiStudio.presetDialogue')}
              </button>
              <button
                onClick={() => handleGenerateAi('emotional')}
                disabled={isGenerating}
                className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-xs text-left font-medium text-slate-300 hover:text-white"
              >
                {t('aiStudio.presetEmotional')}
              </button>
            </div>

            <button
              onClick={() => handleGenerateAi('custom')}
              disabled={isGenerating || !customPrompt.trim()}
              data-tour="ai-studio__3"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg transition-all disabled:opacity-40"
            >
              {isGenerating ? t('aiStudio.generating') : t('aiStudio.runProcessingBtn')}
            </button>
          </div>
        </div>

        {/* Right: Diff & Decision Area (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {currentProposal ? (
            <div className="p-6 rounded-2xl bg-slate-950/90 border-2 border-cyan-500/60 space-y-4 shadow-2xl" data-tour="ai-studio__4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
                    {t('aiStudio.generatedProposalLabel')}
                  </span>
                  <h3 className="text-sm font-bold text-white">
                    {selectedSection?.title} — {currentProposal.instruction}
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {t('aiStudio.needsApprovalBadge')}
                </span>
              </div>

              {/* Side-by-side or Colored Diff */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-sm font-serif-book leading-relaxed max-h-96 overflow-y-auto">
                {currentProposal.diffSegments.map((part, idx) => {
                  if (part.type === 'added') {
                    return (
                      <span key={idx} className="bg-emerald-500/30 text-emerald-200 px-0.5 rounded border-b border-emerald-400">
                        {part.text}
                      </span>
                    );
                  }
                  if (part.type === 'removed') {
                    return (
                      <span key={idx} className="bg-rose-500/30 text-rose-300 line-through px-0.5 rounded opacity-70">
                        {part.text}
                      </span>
                    );
                  }
                  return <span key={idx} className="text-slate-300">{part.text}</span>;
                })}
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleApplyProposal}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition-all active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>{t('aiStudio.acceptAndWriteBtn')}</span>
                </button>

                <button
                  onClick={() => setCurrentProposal(null)}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all active:scale-95"
                >
                  <X className="w-4 h-4" />
                  <span>{t('aiStudio.rejectBtn')}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-2xl bg-slate-950/50 border border-slate-800 flex flex-col items-center justify-center text-center space-y-3">
              <Sparkles className="w-12 h-12 text-slate-600 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-300">
                {t('aiStudio.readyHeading')}
              </h3>
              <p className="text-xs text-slate-500 max-w-md">
                {t('aiStudio.readyHint')}
              </p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
