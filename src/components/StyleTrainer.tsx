import React, { useMemo, useRef, useState } from 'react';
import {
  BookOpenText,
  Target,
  PenLine,
  Sparkles,
  Loader2,
  Trophy,
  AlertTriangle,
  CheckCircle2,
  X,
  BookPlus,
  Tag,
  BookMarked,
} from 'lucide-react';
import type { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useWriterBook } from '../context/WriterBookContext';
import { STYLE_COMPONENTS, STYLE_MAX_ANSWER_CHARS } from '../data/styleTrainerData';
import { collectBookTags, insertTextAfterTagInBook, type BookTag } from '../utils/bookTags';
import { recordAiScore } from '../utils/aiScoreHistory';
import { INITIAL_MASTERY_STATE, getMasteryLevelInfo } from '../data/skillsData';
import type { WriterMasteryState } from '../types';

interface StyleTrainerProps {
  book: Book;
  /** Додає текст у кінець обраного розділу (той самий місток, що й у чаті). */
  onSendTextToChapter: (chapterId: string, text: string, sectionId?: string) => void;
  /** Записує зміну книги (для вставки за тегом). */
  onUpdateBook?: (book: Book, logAction?: string, logDetails?: string) => void;
}

interface CriterionResult {
  key: string;
  label: string;
  score: number;
}

interface StyleEvaluation {
  criteria: CriterionResult[];
  overallScore: number;
  tips: string[];
  xpEarned: number;
}

const MASTERY_STORAGE_KEY = 'nova_writer_mastery_state';

/** Той самий місток нарахування XP, що й у TrainerView.tsx. */
function awardXpToMastery(xp: number): void {
  try {
    const saved = localStorage.getItem(MASTERY_STORAGE_KEY);
    const state: WriterMasteryState = saved ? JSON.parse(saved) : INITIAL_MASTERY_STATE;
    const newXp = state.xp + xp;
    const levelInfo = getMasteryLevelInfo(newXp);
    const next: WriterMasteryState = { ...state, xp: newXp, level: levelInfo.level, levelTitle: levelInfo.title };
    localStorage.setItem(MASTERY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* приватний режим — тренажер лишається корисним, просто без XP */
  }
}

type InsertMode = 'tag' | 'chapter';

/**
 * Тренажер «Стиль письменника» (Фаза 2, 2.2): діалог з ШІ-ядром поверх
 * 8 компонентів авторського стилю. Кожен компонент — 3 вправи, де ШІ
 * ставить цільове запитання на основі уривка з реальної книги, а відповідь
 * автора можна додати в рукопис за тегом або в кінець обраної глави.
 */
export const StyleTrainer: React.FC<StyleTrainerProps> = ({ book, onSendTextToChapter, onUpdateBook }) => {
  const { t } = useLanguage();
  const { bookExcerpts, activeExcerptId } = useWriterBook();

  const [activeComponentIndex, setActiveComponentIndex] = useState(0);
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [result, setResult] = useState<StyleEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Виділення мишкою у полі відповіді.
  const [selectedText, setSelectedText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Модалка «додати до рукопису».
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [insertMode, setInsertMode] = useState<InsertMode>('tag');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');

  // Toast.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const component = STYLE_COMPONENTS[activeComponentIndex];
  const exercise = component.exercises[activeExerciseIndex];

  const bookTags = useMemo(() => collectBookTags(book), [book]);

  // Уривок, який ШІ «обрав» для запитання: активний або перший доступний.
  const activeExcerpt = useMemo(() => {
    if (bookExcerpts.length === 0) return null;
    return bookExcerpts.find((e) => e.id === activeExcerptId) || bookExcerpts[0];
  }, [bookExcerpts, activeExcerptId]);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const selectComponent = (idx: number) => {
    setActiveComponentIndex(idx);
    setActiveExerciseIndex(0);
    setResult(null);
    setError(null);
    setSelectedText('');
  };

  const selectExercise = (idx: number) => {
    setActiveExerciseIndex(idx);
    setResult(null);
    setError(null);
    setSelectedText('');
  };

  const updateSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.substring(el.selectionStart, el.selectionEnd).trim();
    setSelectedText(text);
  };

  const textToInsert = selectedText || userAnswer.trim();

  const openBookModal = () => {
    if (!textToInsert) {
      showToast(t('trainersView.styleNeedText'));
      textareaRef.current?.focus();
      return;
    }
    if (bookTags.length > 0) setSelectedTag((prev) => prev || bookTags[0].name);
    if (book.chapters.length > 0) {
      setSelectedChapterId((prev) => prev || book.chapters[0].id);
      setSelectedSectionId('');
    }
    setBookModalOpen(true);
  };

  const closeBookModal = () => {
    setBookModalOpen(false);
  };

  const handleInsertByTag = () => {
    if (!selectedTag || !textToInsert || !onUpdateBook) {
      showToast(t('trainersView.stylePickTag'));
      return;
    }
    const tag: BookTag | undefined = bookTags.find((tg) => tg.name === selectedTag);
    if (!tag) {
      showToast(t('trainersView.styleTagMissing'));
      return;
    }
    const updated = insertTextAfterTagInBook(book, tag, textToInsert);
    if (!updated) {
      showToast(t('trainersView.styleTagMissing'));
      return;
    }
    onUpdateBook(
      updated,
      'Фрагмент з тренажера «Стиль письменника» додано до книги',
      `Вставка за тегом «${tag.name}» (${tag.chapterTitle} → ${tag.sectionTitle})`
    );
    closeBookModal();
    setSelectedText('');
    showToast(t('trainersView.styleInsertedByTag').replace('{tag}', tag.name));
  };

  const handleInsertByChapter = () => {
    if (!selectedChapterId || !textToInsert) {
      showToast(t('trainersView.stylePickChapter'));
      return;
    }
    onSendTextToChapter(selectedChapterId, textToInsert, selectedSectionId || undefined);
    closeBookModal();
    setSelectedText('');
    const chapter = book.chapters.find((c) => c.id === selectedChapterId);
    showToast(t('trainersView.styleInsertedToChapter').replace('{chapter}', chapter?.title || ''));
  };

  const handleEvaluate = async () => {
    if (!userAnswer.trim()) return;
    setIsEvaluating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/evaluate-trainer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainerType: component.trainerType,
          trainerLabel: component.title,
          taskPrompt: exercise.question,
          userAnswer,
          bookContext: activeExcerpt?.text || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setResult(data);
      awardXpToMastery(data.xpEarned || 0);
      recordAiScore(`trainer:${component.trainerType}`, data.overallScore);
    } catch {
      setError(t('trainersView.evaluateError'));
    } finally {
      setIsEvaluating(false);
    }
  };

  const chapterSections = useMemo(() => {
    const chapter = book.chapters.find((c) => c.id === selectedChapterId);
    if (!chapter) return [];
    return [...chapter.sections].sort((a, b) => a.order - b.order);
  }, [book, selectedChapterId]);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* 8 компонентів авторського стилю */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t('trainersView.styleComponentsHeading')}
          </span>
          <span className="text-[11px] font-semibold text-amber-400/90">
            {t('trainersView.stylePartsHeading')}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STYLE_COMPONENTS.map((comp, idx) => {
            const isActive = idx === activeComponentIndex;
            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => selectComponent(idx)}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all duration-200 border ${
                  isActive
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 border-amber-300'
                    : 'bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 border-slate-800'
                }`}
              >
                <span aria-hidden>{comp.icon}</span>
                <span>{comp.title}</span>
                {comp.part === 1 && (
                  <span className={`text-[9px] uppercase ${isActive ? 'text-slate-700' : 'text-slate-600'}`}>
                    {t('trainersView.stylePart1Short')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-2 px-1">{component.description}</p>
      </div>

      {/* Вибір вправи */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {t('trainersView.styleExerciseFormat')}
        </span>
        {component.exercises.map((ex, idx) => {
          const isActive = idx === activeExerciseIndex;
          return (
            <button
              key={ex.id}
              type="button"
              onClick={() => selectExercise(idx)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition duration-200 flex items-center gap-1.5 ${
                isActive
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 font-semibold'
                  : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <span>{ex.name}</span>
              <span className="text-[10px] opacity-60">({ex.duration})</span>
            </button>
          );
        })}
      </div>

      {/* Крок 1: Теорія */}
      <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
        <div className="flex items-center gap-2 mb-2">
          <BookOpenText className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('trainersView.styleStepTheory', { component: component.title, exercise: exercise.name })}
          </h3>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">{exercise.theory}</p>
      </div>

      {/* Крок 2: Завдання (питання ШІ + уривок з книги) */}
      <div className="nova-glass-dark rounded-2xl border border-amber-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('trainersView.stepTask')}</h3>
        </div>
        <p className="text-sm text-slate-200 font-semibold leading-relaxed">{exercise.question}</p>
        {activeExcerpt && (
          <div className="mt-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/80 mb-1.5">
              {t('trainersView.styleAiPickedExcerpt')}
            </div>
            <p className="text-xs text-slate-400 italic leading-relaxed line-clamp-4 border-l-2 border-cyan-500/40 pl-2.5">
              «{activeExcerpt.text.slice(0, 520)}
              {activeExcerpt.text.length > 520 ? '…' : ''}»
            </p>
            <div className="text-[10px] text-slate-600 mt-1.5">
              {activeExcerpt.chapterTitle} → {activeExcerpt.sectionTitle}
            </div>
          </div>
        )}
      </div>

      {/* Крок 3: Відповідь */}
      {!result && (
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <PenLine className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('trainersView.stepAnswer')}</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setUserAnswer(exercise.sample);
                setResult(null);
              }}
              className="text-xs text-cyan-300/80 hover:text-cyan-200 underline transition"
            >
              {t('trainersView.styleFillSample')}
            </button>
          </div>

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value.slice(0, STYLE_MAX_ANSWER_CHARS))}
              onMouseUp={updateSelection}
              onKeyUp={updateSelection}
              onSelect={updateSelection}
              placeholder={exercise.placeholder}
              rows={8}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-y"
            />
            {selectedText.length > 2 && (
              <button
                type="button"
                onClick={openBookModal}
                className="absolute -top-3 right-3 flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs rounded-lg shadow-md shadow-amber-500/30 transition active:scale-95"
              >
                <BookPlus className="w-3.5 h-3.5" />
                {t('trainersView.styleAddSelection')} ({selectedText.length})
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-slate-500">
              {userAnswer.length} / {STYLE_MAX_ANSWER_CHARS} {t('trainersView.styleChars')}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={openBookModal}
                disabled={!textToInsert}
                className="text-amber-400/90 hover:text-amber-300 font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('trainersView.styleAddToBook')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserAnswer('');
                  setSelectedText('');
                  setResult(null);
                }}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                {t('trainersView.styleClear')}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleEvaluate}
            disabled={isEvaluating || !userAnswer.trim()}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50"
          >
            {isEvaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{isEvaluating ? t('trainersView.evaluating') : t('trainersView.evaluateBtn')}</span>
          </button>
        </div>
      )}

      {/* Крок 4: Результат */}
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
            {(result.criteria || []).map((c) => (
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

          {(result.tips || []).length > 0 && (
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
            type="button"
            onClick={() => {
              setResult(null);
              setError(null);
            }}
            className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            {t('trainersView.tryAgainBtn')}
          </button>
        </div>
      )}

      {/* Модалка: додати до рукопису */}
      {bookModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          onClick={closeBookModal}
        >
          <div
            className="bg-[#0c1527] border border-cyan-500/30 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 text-sm">
                  <BookMarked className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{t('trainersView.styleModalTitle')}</h3>
                  <p className="text-xs text-slate-400">{t('trainersView.styleModalSubtitle')}</p>
                </div>
              </div>
              <button type="button" onClick={closeBookModal} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto max-h-[75vh]">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
                  <span>{t('trainersView.styleSelectedFragment')}</span>
                  <span className="text-cyan-400 lowercase font-mono">{textToInsert.length}</span>
                </div>
                <p className="text-xs text-slate-300 italic line-clamp-3 leading-relaxed border-l-2 border-amber-400 pl-2">«{textToInsert}»</p>
              </div>

              <div className="flex rounded-xl bg-slate-900/80 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setInsertMode('tag')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
                    insertMode === 'tag' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5" />
                  {t('trainersView.styleByTag')}
                </button>
                <button
                  type="button"
                  onClick={() => setInsertMode('chapter')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 ${
                    insertMode === 'chapter' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpenText className="w-3.5 h-3.5" />
                  {t('trainersView.styleToChapter')}
                </button>
              </div>

              {insertMode === 'tag' ? (
                <div className="space-y-3.5">
                  <div>
                    <div className="text-[11px] font-medium text-slate-400 mb-2">{t('trainersView.styleActiveTags')}</div>
                    {bookTags.length === 0 ? (
                      <p className="text-xs text-slate-500">{t('trainersView.styleNoTags')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {bookTags.map((tag) => (
                          <button
                            key={`${tag.chapterId}-${tag.sectionId}-${tag.name}`}
                            type="button"
                            onClick={() => setSelectedTag(tag.name)}
                            className={`text-xs px-2.5 py-1 rounded-md border transition ${
                              selectedTag === tag.name
                                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                                : 'bg-slate-900 border-slate-700 hover:border-cyan-400/60 text-slate-300'
                            }`}
                          >
                            {tag.name}
                            <span className="block text-[9px] opacity-60">{tag.chapterTitle}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleInsertByTag}
                    disabled={!selectedTag || bookTags.length === 0}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-teal-600 hover:brightness-110 text-white font-semibold text-xs rounded-xl shadow-lg shadow-cyan-950/50 transition flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    {t('trainersView.styleInsertByTag')}
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">{t('trainersView.stylePickChapter')}</label>
                    <select
                      value={selectedChapterId}
                      onChange={(e) => {
                        setSelectedChapterId(e.target.value);
                        setSelectedSectionId('');
                      }}
                      className="w-full bg-[#060c18] border border-slate-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 rounded-xl py-2.5 px-3.5 text-xs text-white"
                    >
                      {book.chapters.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">{t('trainersView.stylePickSection')}</label>
                    <select
                      value={selectedSectionId}
                      onChange={(e) => setSelectedSectionId(e.target.value)}
                      className="w-full bg-[#060c18] border border-slate-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 rounded-xl py-2.5 px-3.5 text-xs text-white"
                    >
                      <option value="">{t('trainersView.styleLastSection')}</option>
                      {chapterSections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleInsertByChapter}
                    disabled={!selectedChapterId}
                    className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-950/40 transition flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    <BookOpenText className="w-3.5 h-3.5" />
                    {t('trainersView.styleInsertToChapter')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-[60] flex items-center gap-3 bg-slate-900/95 border border-emerald-500/50 shadow-2xl backdrop-blur-md px-4 py-3 rounded-xl text-sm text-slate-100 max-w-md">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <p className="text-xs text-slate-200">{toast}</p>
        </div>
      )}
    </div>
  );
};
