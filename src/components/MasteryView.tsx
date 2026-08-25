import React, { useState, useMemo, useEffect } from 'react';
import { 
  Book, 
  WriterMasteryState, 
  SkillCategory, 
  SkillTask, 
  MasteryLevel,
  BookIntegrationTarget,
  TaskEvaluationResult
} from '../types';
import { 
  SKILL_CATEGORIES, 
  SKILL_TASKS, 
  DIAGNOSTIC_QUESTIONS, 
  INITIAL_MASTERY_STATE, 
  getMasteryLevelInfo 
} from '../data/skillsData';
import { 
  GraduationCap, 
  Trophy, 
  Sparkles, 
  Brain, 
  Lightbulb, 
  GitBranch, 
  Users, 
  Feather, 
  Heart, 
  CheckSquare, 
  BookOpen, 
  Palette, 
  Award, 
  Flame, 
  Compass, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Target, 
  Zap, 
  HelpCircle, 
  RefreshCw, 
  ChevronRight, 
  Search, 
  Filter, 
  Save, 
  PlusCircle, 
  Check, 
  AlertCircle, 
  Sliders, 
  TrendingUp, 
  Star, 
  Send, 
  FileText, 
  Layers, 
  BarChart3,
  BookmarkPlus,
  Play,
  RotateCcw
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { StyleView } from './StyleView';
import type { AuthUser } from '../types';

interface MasteryViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, auditAction?: string, auditDetails?: string) => void;
  masteryState?: WriterMasteryState;
  onUpdateMasteryState?: (newState: WriterMasteryState) => void;
  authUser?: AuthUser | null;
}

type SubTab = 'trajectory' | 'skill_tree' | 'tasks' | 'diagnostic' | 'achievements' | 'style';

const CATEGORY_ICONS: Record<SkillCategory, React.ComponentType<{ className?: string }>> = {
  thinking: Brain,
  concept: Lightbulb,
  plot: GitBranch,
  characters: Users,
  craft: Feather,
  emotion: Heart,
  editing: CheckSquare,
  book_prep: BookOpen,
  visual: Palette,
  author_brand: Award,
};

// 0.5: бейджі, чий прогрес рахується від реальних метрик (сума слів,
// теги курсу, використання AI-редактора), а не від виконання завдань —
// виключені з генеричного інкременту «+1 за будь-яке завдання».
const METRIC_BASED_ACHIEVEMENT_IDS = new Set(['ach-100k-words', 'ach-first-course', 'ach-editor-50']);
const AI_EDITOR_USAGE_STORAGE_KEY = 'nova_ai_edit_apply_count';

export const MasteryView: React.FC<MasteryViewProps> = ({
  book,
  onUpdateBook,
  masteryState: externalMasteryState,
  onUpdateMasteryState,
  authUser,
}) => {
  const { lang, t } = useLanguage();
  const categoryTitle = (cat: { titleUk: string; titleEn: string }) => (lang === 'en' ? cat.titleEn : cat.titleUk);

  // Local state for persistence if not controlled externally
  const [internalMastery, setInternalMastery] = useState<WriterMasteryState>(() => {
    try {
      const saved = localStorage.getItem('nova_writer_mastery_state');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Could not load writer mastery state from localStorage', e);
    }
    return INITIAL_MASTERY_STATE;
  });

  const mastery = externalMasteryState || internalMastery;

  const updateMastery = (updater: (prev: WriterMasteryState) => WriterMasteryState) => {
    const nextState = updater(mastery);
    setInternalMastery(nextState);
    if (onUpdateMasteryState) {
      onUpdateMasteryState(nextState);
    }
    try {
      localStorage.setItem('nova_writer_mastery_state', JSON.stringify(nextState));
    } catch (e) {
      console.warn('LocalStorage save error', e);
    }
  };

  const [activeSubTab, setActiveSubTab] = useState<SubTab>('trajectory');
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory | 'all'>('all');
  const [selectedLevelFilter, setSelectedLevelFilter] = useState<MasteryLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Active Task Modal / Workspace
  const [activeTask, setActiveTask] = useState<SkillTask | null>(null);
  const [userAnswer, setUserAnswer] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<BookIntegrationTarget>('chapter_scene');
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationResult, setEvaluationResult] = useState<TaskEvaluationResult | null>(null);
  const [taskAppliedToast, setTaskAppliedToast] = useState<string | null>(null);

  // Diagnostic Quiz State
  const [isDiagnosticRunning, setIsDiagnosticRunning] = useState<boolean>(false);
  const [diagnosticCurrentStep, setDiagnosticCurrentStep] = useState<number>(0);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<Record<string, number>>({});
  const [isDiagnosticSubmitting, setIsDiagnosticSubmitting] = useState<boolean>(false);

  // Level Info calculations
  const levelInfo = useMemo(() => getMasteryLevelInfo(mastery.xp), [mastery.xp]);

  // Daily task resolution
  const dailyTask = useMemo(() => {
    return SKILL_TASKS.find(t => t.id === mastery.todayTaskId) || SKILL_TASKS[0];
  }, [mastery.todayTaskId]);

  // 0.3: Реальна ротація «Завдання дня» + Streak. Раніше todayTaskId і
  // dailyStreak виставлялись один раз при ініціалізації й ніколи не
  // оновлювались — щодня показувалось те саме завдання. Тепер: якщо з
  // моменту останнього візиту настав новий календарний день, підбираємо
  // нове завдання (зважено на слабкі навички автора) і скидаємо позначку
  // виконання; якщо пропущено більш ніж один день — серія (streak)
  // переривається.
  useEffect(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastStr = mastery.lastActiveDate ? mastery.lastActiveDate.slice(0, 10) : '';
    if (lastStr === todayStr) return;

    const daysSinceLast = lastStr
      ? Math.round((new Date(todayStr).getTime() - new Date(lastStr).getTime()) / (24 * 60 * 60 * 1000))
      : null;

    updateMastery(prev => {
      const scores = prev.diagnostic.categoryScores || {};
      const candidates = SKILL_TASKS.filter(task => task.id !== prev.todayTaskId);
      const pool = candidates.length > 0 ? candidates : SKILL_TASKS;
      const weighted = pool.map(task => {
        const catScore = scores[task.category] ?? 60;
        const weaknessScore = 100 - catScore;
        return { task, sortValue: weaknessScore * 0.7 + Math.random() * 100 * 0.3 };
      });
      weighted.sort((a, b) => b.sortValue - a.sortValue);
      const nextTask = weighted[0]?.task || SKILL_TASKS[0];

      // Серія зберігається лише якщо це рівно наступний день і вчорашнє
      // завдання було виконано (сам інкремент відбувається в момент
      // виконання завдання, див. handleSubmitForEvaluation/handleApplyToBook).
      const streakBroken = daysSinceLast === null || daysSinceLast > 1 || (daysSinceLast === 1 && !prev.todayTaskCompleted);

      return {
        ...prev,
        todayTaskId: nextTask.id,
        todayTaskCompleted: false,
        dailyStreak: streakBroken ? 0 : prev.dailyStreak,
        lastActiveDate: new Date().toISOString(),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 0.4: Персоналізація черги вправ. Раніше бралися перші 6 завдань зі
  // статичного списку SKILL_TASKS — тепер сортуємо весь пул за
  // (weakness_score * 0.7 + randomness * 0.3), де weakness_score вищий
  // для категорій з нижчим рівнем автора за діагностикою.
  const recommendedTasks = useMemo(() => {
    const scores = mastery.diagnostic.categoryScores || {};
    const weighted = SKILL_TASKS.map(task => {
      const catScore = scores[task.category] ?? 60;
      const weaknessScore = 100 - catScore;
      const randomness = Math.random() * 100;
      return { task, sortValue: weaknessScore * 0.7 + randomness * 0.3 };
    });
    weighted.sort((a, b) => b.sortValue - a.sortValue);
    return weighted.slice(0, 6).map(w => w.task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mastery.diagnostic.categoryScores]);

  // 0.5: синхронізація трьох метричних бейджів («100 000 слів», «Перший
  // курс», «50 відредагованих текстів») з реальними показниками — сума
  // слів у книзі, кількість тегів курсу та лічильник застосованих
  // AI-правок (він інкрементується в AIStudioView.handleApplyProposal і
  // зберігається в тому самому localStorage, звідки MasteryView його читає).
  const totalBookWords = useMemo(
    () => book.chapters.reduce((acc, c) => acc + c.sections.reduce((sAcc, s) => sAcc + (s.wordCount || 0), 0), 0),
    [book.chapters]
  );
  const courseTagsCount = book.course?.tags?.length || 0;

  useEffect(() => {
    let aiEditorUsageCount = 0;
    try {
      aiEditorUsageCount = parseInt(localStorage.getItem(AI_EDITOR_USAGE_STORAGE_KEY) || '0', 10) || 0;
    } catch {
      // приватний режим / заблоковане сховище — лічильник просто буде 0
    }

    const metrics: Record<string, { current: number; target: number }> = {
      'ach-100k-words': { current: totalBookWords, target: 100000 },
      'ach-first-course': { current: courseTagsCount, target: 3 },
      'ach-editor-50': { current: aiEditorUsageCount, target: 50 },
    };

    updateMastery(prev => {
      let changed = false;
      const nextAchievements = prev.achievements.map(ach => {
        const metric = metrics[ach.id];
        if (!metric) return ach;
        const nextCurrent = Math.min(metric.current, metric.target);
        const nextProgress = Math.min(100, Math.round((metric.current / metric.target) * 100));
        if (nextCurrent === ach.currentProgress && nextProgress === ach.progress) return ach;
        changed = true;
        return {
          ...ach,
          currentProgress: nextCurrent,
          progress: nextProgress,
          unlockedAt: nextProgress >= 100 && !ach.unlockedAt ? new Date().toISOString() : ach.unlockedAt,
        };
      });
      return changed ? { ...prev, achievements: nextAchievements } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalBookWords, courseTagsCount]);

  // Filtered Task List
  const filteredTasks = useMemo(() => {
    return SKILL_TASKS.filter(task => {
      if (selectedCategory !== 'all' && task.category !== selectedCategory) return false;
      if (selectedLevelFilter !== 'all' && task.level !== selectedLevelFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesSkill = task.skillName.toLowerCase().includes(query);
        const matchesGoal = task.goal.toLowerCase().includes(query);
        if (!matchesTitle && !matchesSkill && !matchesGoal) return false;
      }
      return true;
    });
  }, [selectedCategory, selectedLevelFilter, searchQuery]);

  // Open Task Workspace
  const handleOpenTask = (task: SkillTask) => {
    setActiveTask(task);
    setSelectedTarget(task.targetBookEntity || 'chapter_scene');
    // Check if task was previously completed to pre-fill
    const previousRecord = mastery.completedTasks.find(ct => ct.taskId === task.id);
    if (previousRecord) {
      setUserAnswer(previousRecord.userAnswer);
      setEvaluationResult(previousRecord.evaluation || null);
    } else {
      setUserAnswer('');
      setEvaluationResult(null);
    }
  };

  // Close Task Workspace
  const handleCloseTask = () => {
    setActiveTask(null);
    setUserAnswer('');
    setEvaluationResult(null);
  };

  // Submit Task for AI Mentorship Evaluation
  const handleEvaluateTask = async () => {
    if (!activeTask || !userAnswer.trim()) return;
    setIsEvaluating(true);
    try {
      const bookContext = {
        title: book.title,
        genre: book.genre,
        synopsis: book.synopsis,
        logline: book.logline,
        theme: book.theme,
        charactersCount: book.characters.length,
        firstCharacter: book.characters[0]?.name || 'Головний герой',
        chaptersCount: book.chapters.length,
      };

      const res = await fetch('/api/ai/evaluate-skill-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: activeTask,
          userAnswer,
          bookContext
        })
      });

      if (!res.ok) {
        throw new Error(t('mastery.aiAnalysisError'));
      }

      const evalData: TaskEvaluationResult = await res.json();
      setEvaluationResult(evalData);
      if (evalData.suggestedBookIntegration?.target) {
        setSelectedTarget(evalData.suggestedBookIntegration.target);
      }

      // Award XP and record completion
      updateMastery(prev => {
        const alreadyCompleted = prev.completedTasks.some(ct => ct.taskId === activeTask.id);
        const xpToAdd = alreadyCompleted ? Math.round(evalData.xpEarned / 2) : evalData.xpEarned;
        const newXp = prev.xp + xpToAdd;
        const newLevelInfo = getMasteryLevelInfo(newXp);

        const newRecord = {
          taskId: activeTask.id,
          taskTitle: activeTask.title,
          category: activeTask.category,
          skillName: activeTask.skillName,
          level: activeTask.level,
          userAnswer: userAnswer.trim(),
          xpEarned: xpToAdd,
          evaluation: evalData,
          completedAt: new Date().toISOString(),
          appliedToBook: false
        };

        const updatedCompleted = prev.completedTasks.filter(ct => ct.taskId !== activeTask.id);
        updatedCompleted.unshift(newRecord);

        // Update achievement progress. Метричні бейджі (слова/курс/AI-редактор)
        // синхронізуються окремим ефектом нижче за реальними показниками —
        // тут їх свідомо пропускаємо, щоб не інкрементувати вдвічі.
        const updatedAchievements = prev.achievements.map(ach => {
          if (METRIC_BASED_ACHIEVEMENT_IDS.has(ach.id)) return ach;
          if (ach.category === activeTask.category || ach.category === 'general') {
            const nextCur = ach.currentProgress + 1;
            const nextProg = Math.min(100, Math.round((nextCur / (ach.maxProgress || 5)) * 100));
            return {
              ...ach,
              currentProgress: nextCur,
              progress: nextProg,
              unlockedAt: nextProg >= 100 && !ach.unlockedAt ? new Date().toISOString() : ach.unlockedAt
            };
          }
          return ach;
        });

        // If today's task, mark completed
        const isToday = activeTask.id === prev.todayTaskId;
        // Серія (streak) росте лише в момент першого виконання завдання дня.
        const justCompletedToday = isToday && !prev.todayTaskCompleted;

        return {
          ...prev,
          xp: newXp,
          level: newLevelInfo.level,
          levelTitle: newLevelInfo.title,
          todayTaskCompleted: isToday ? true : prev.todayTaskCompleted,
          dailyStreak: justCompletedToday ? prev.dailyStreak + 1 : prev.dailyStreak,
          completedTasks: updatedCompleted,
          achievements: updatedAchievements
        };
      });

    } catch (err: any) {
      console.error(err);
      alert(t('mastery.alertAnalysisErrorPrefix') + (err.message || t('mastery.alertAnalysisErrorFallback')));
    } finally {
      setIsEvaluating(false);
    }
  };

  // Apply Task Output Directly to Book Project
  const handleApplyToBook = (overrideContent?: string, overrideTarget?: BookIntegrationTarget) => {
    if (!activeTask) return;
    const content = (overrideContent || evaluationResult?.suggestedBookIntegration?.extractedContent || userAnswer || '').trim();
    
    if (!content) {
      alert(t('mastery.alertEmptyContent'));
      return;
    }

    const target = overrideTarget || selectedTarget || evaluationResult?.suggestedBookIntegration?.target || activeTask.targetBookEntity || 'chapter_scene';

    let updatedBook: Book = JSON.parse(JSON.stringify(book));
    let toastMessage = t('mastery.toastDefault');

    if (
      target === 'character_conflict' || 
      target === 'character_desire' || 
      target === 'character_fear' || 
      target === 'character_flaw' || 
      target === 'character_bio'
    ) {
      if (!updatedBook.characters) updatedBook.characters = [];

      if (updatedBook.characters.length > 0) {
        const mainChar = { ...updatedBook.characters[0] };
        const pers = mainChar.personality || {
          strengths: [],
          weaknesses: [],
          fears: [],
          desires: [],
          goals: [],
          motivation: '',
          internalConflict: ''
        };

        if (target === 'character_conflict') {
          mainChar.personality = {
            ...pers,
            internalConflict: content
          };
          toastMessage = t('mastery.toastInternalConflict', { name: mainChar.name });
        } else if (target === 'character_desire') {
          mainChar.personality = {
            ...pers,
            desires: [content, ...(pers.desires || [])],
            motivation: content
          };
          toastMessage = t('mastery.toastDesireMotivation', { name: mainChar.name });
        } else if (target === 'character_fear') {
          mainChar.personality = {
            ...pers,
            fears: [content, ...(pers.fears || [])]
          };
          toastMessage = t('mastery.toastFear', { name: mainChar.name });
        } else if (target === 'character_flaw') {
          mainChar.personality = {
            ...pers,
            weaknesses: [content, ...(pers.weaknesses || [])]
          };
          toastMessage = t('mastery.toastFlaw', { name: mainChar.name });
        } else {
          mainChar.biography = mainChar.biography
            ? `${mainChar.biography}\n\n${content}`
            : content;
          toastMessage = t('mastery.toastBioArc', { name: mainChar.name });
        }
        updatedBook.characters = [mainChar, ...updatedBook.characters.slice(1)];
      } else {
        // Create new character
        const newChar = {
          id: `char-${Date.now()}`,
          bookId: book.id,
          name: 'Головний герой',
          role: 'protagonist' as const,
          appearance: {},
          personality: {
            strengths: ['Цілеспрямованість'],
            weaknesses: target === 'character_flaw' ? [content] : ['Внутрішній сумнів'],
            fears: target === 'character_fear' ? [content] : ['Втрата контролю'],
            desires: target === 'character_desire' ? [content] : ['Досягнення мети'],
            goals: ['Змінити хід подій у книзі'],
            motivation: target === 'character_desire' ? content : '',
            internalConflict: target === 'character_conflict' ? content : ''
          },
          biography: target === 'character_bio' ? content : '',
          relationships: [],
          tags: ['Головний герой']
        };
        updatedBook.characters = [newChar];
        toastMessage = t('mastery.toastNewCharacter');
      }
    } else if (target === 'logline') {
      updatedBook.logline = content;
      toastMessage = t('mastery.toastLogline');
    } else if (target === 'synopsis') {
      updatedBook.synopsis = updatedBook.synopsis ? `${updatedBook.synopsis}\n\n${content}` : content;
      toastMessage = t('mastery.toastSynopsis');
    } else if (target === 'theme') {
      updatedBook.theme = content;
      toastMessage = t('mastery.toastTheme');
    } else if (target === 'chapter_scene' || target === 'dialogue') {
      if (!updatedBook.chapters || updatedBook.chapters.length === 0) {
        const newChapId = `chap-${Date.now()}`;
        updatedBook.chapters = [
          {
            id: newChapId,
            bookId: book.id,
            title: 'Глава 1. Початок',
            order: 1,
            sections: [
              {
                id: `sec-${Date.now()}`,
                chapterId: newChapId,
                title: activeTask.skillName || 'Сцена 1',
                order: 1,
                content: content,
                wordCount: content.split(/\s+/).filter(Boolean).length,
                lastModified: new Date().toISOString()
              }
            ]
          }
        ];
        toastMessage = t('mastery.toastNewChapter');
      } else {
        const firstChap = { ...updatedBook.chapters[0] };
        if (!firstChap.sections || firstChap.sections.length === 0) {
          firstChap.sections = [
            {
              id: `sec-${Date.now()}`,
              chapterId: firstChap.id,
              title: activeTask.skillName || 'Сцена 1',
              order: 1,
              content: content,
              wordCount: content.split(/\s+/).filter(Boolean).length,
              lastModified: new Date().toISOString()
            }
          ];
        } else {
          const firstSec = { ...firstChap.sections[0] };
          firstSec.content = firstSec.content 
            ? `${firstSec.content}\n\n/* Застосовано з майстерні навичок: ${activeTask.title} */\n${content}`
            : content;
          firstSec.wordCount = firstSec.content.split(/\s+/).filter(Boolean).length;
          firstSec.lastModified = new Date().toISOString();
          firstChap.sections = [firstSec, ...firstChap.sections.slice(1)];
        }
        updatedBook.chapters = [firstChap, ...updatedBook.chapters.slice(1)];
        toastMessage = t('mastery.toastChapterAppended', { title: firstChap.title });
      }
    } else if (target === 'visual_concept') {
      updatedBook.visualBible = {
        id: updatedBook.visualBible?.id || `vb-${Date.now()}`,
        bookId: book.id,
        styleName: updatedBook.visualBible?.styleName || 'Авторський візуальний стиль',
        artStyle: updatedBook.visualBible?.artStyle || 'Digital Art',
        colorPalette: updatedBook.visualBible?.colorPalette || ['#1e293b', '#f59e0b', '#0f172a'],
        lighting: updatedBook.visualBible?.lighting || 'Кінематографічне',
        mood: content,
        referenceNotes: updatedBook.visualBible?.referenceNotes
          ? `${updatedBook.visualBible.referenceNotes}\n\n${content}`
          : content,
        keyMotifs: updatedBook.visualBible?.keyMotifs || ['Ключовий символ книги'],
        aspectRatio: updatedBook.visualBible?.aspectRatio || '16:9'
      };
      toastMessage = t('mastery.toastVisualConcept');
    } else if (target === 'book_blurb') {
      updatedBook.coverConfig = {
        ...(updatedBook.coverConfig || {
          format: 'paperback',
          spineWidthMm: 14,
          frontTitle: book.title,
          subtitle: book.subtitle || '',
          authorName: book.author,
          barcode: '978-0-123456-47-2',
          palette: ['#0f172a', '#f59e0b', '#ffffff'],
          theme: 'modern_minimal'
        }),
        backDescription: content
      };
      toastMessage = t('mastery.toastBlurb');
    } else if (target === 'author_bio') {
      updatedBook.coverConfig = {
        ...(updatedBook.coverConfig || {
          format: 'paperback',
          spineWidthMm: 14,
          frontTitle: book.title,
          subtitle: book.subtitle || '',
          authorName: book.author,
          barcode: '978-0-123456-47-2',
          palette: ['#0f172a', '#f59e0b', '#ffffff'],
          theme: 'modern_minimal',
          backDescription: ''
        }),
        authorBio: content
      };
      toastMessage = t('mastery.toastAuthorBio');
    } else {
      updatedBook.synopsis = updatedBook.synopsis ? `${updatedBook.synopsis}\n\n${content}` : content;
      toastMessage = t('mastery.toastSynopsisFallback');
    }

    onUpdateBook(updatedBook, 'Практичне завдання', `Застосовано навичку «${activeTask.title}» до книги (${target})`);
    
    // Mark as applied in state and award XP
    updateMastery(prev => {
      const alreadyCompleted = prev.completedTasks.some(ct => ct.taskId === activeTask.id);
      const xpToAdd = alreadyCompleted ? 10 : (evaluationResult?.xpEarned || activeTask.xpReward);
      const newXp = prev.xp + xpToAdd;
      const newLevelInfo = getMasteryLevelInfo(newXp);

      const newRecord = {
        taskId: activeTask.id,
        taskTitle: activeTask.title,
        category: activeTask.category,
        skillName: activeTask.skillName,
        level: activeTask.level,
        userAnswer: userAnswer.trim() || content,
        xpEarned: xpToAdd,
        evaluation: evaluationResult || undefined,
        completedAt: new Date().toISOString(),
        appliedToBook: true
      };

      const updatedCompleted = prev.completedTasks.filter(ct => ct.taskId !== activeTask.id);
      updatedCompleted.unshift(newRecord);

      const isToday = activeTask.id === prev.todayTaskId;
      const justCompletedToday = isToday && !prev.todayTaskCompleted;

      return {
        ...prev,
        xp: newXp,
        level: newLevelInfo.level,
        levelTitle: newLevelInfo.title,
        todayTaskCompleted: isToday ? true : prev.todayTaskCompleted,
        dailyStreak: justCompletedToday ? prev.dailyStreak + 1 : prev.dailyStreak,
        completedTasks: updatedCompleted
      };
    });

    setTaskAppliedToast(toastMessage);
    setTimeout(() => setTaskAppliedToast(null), 5000);
  };

  // Start Diagnostic Quiz
  const handleStartDiagnostic = () => {
    setIsDiagnosticRunning(true);
    setDiagnosticCurrentStep(0);
    setDiagnosticAnswers({});
  };

  // Select option in Diagnostic
  const handleSelectDiagnosticOption = (questionId: string, score: number) => {
    const nextAnswers = { ...diagnosticAnswers, [questionId]: score };
    setDiagnosticAnswers(nextAnswers);

    if (diagnosticCurrentStep < DIAGNOSTIC_QUESTIONS.length - 1) {
      setDiagnosticCurrentStep(prev => prev + 1);
    } else {
      // Calculate final results
      handleFinishDiagnostic(nextAnswers);
    }
  };

  // Finish Diagnostic Quiz
  const handleFinishDiagnostic = async (answers: Record<string, number>) => {
    setIsDiagnosticSubmitting(true);
    try {
      // Calculate scores for each category
      const catScores: Record<SkillCategory, number> = {
        thinking: 50,
        concept: 50,
        plot: 50,
        characters: 50,
        craft: 50,
        emotion: 50,
        editing: 50,
        book_prep: 50,
        visual: 50,
        author_brand: 50
      };

      DIAGNOSTIC_QUESTIONS.forEach(q => {
        const score = answers[q.id] || 50;
        catScores[q.category] = score;
      });

      // Call AI diagnostic endpoint
      const bookContext = {
        title: book.title,
        genre: book.genre,
        synopsis: book.synopsis
      };

      const res = await fetch('/api/ai/diagnostic-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryScores: catScores, bookContext })
      });

      let aiResult: any;
      if (res.ok) {
        aiResult = await res.json();
      } else {
        aiResult = {
          authorArchetype: t('mastery.fallbackArchetype'),
          levelTitle: t('mastery.fallbackLevelTitle'),
          strengths: [t('mastery.fallbackStrength1'), t('mastery.fallbackStrength2')],
          weaknesses: [t('mastery.fallbackWeakness1'), t('mastery.fallbackWeakness2')],
          trajectorySummary: t('mastery.fallbackTrajectorySummary'),
          recommendedTaskIds: ['task-char-internal-conflict', 'task-editing-clutter-removal', 'task-craft-dialogue-subtext']
        };
      }

      updateMastery(prev => ({
        ...prev,
        diagnostic: {
          completed: true,
          completedAt: new Date().toISOString(),
          categoryScores: catScores,
          strengths: aiResult.strengths || [t('mastery.fallbackImagination'), t('mastery.fallbackCharactersWord')],
          weaknesses: aiResult.weaknesses || [t('mastery.fallbackEditingWord'), t('mastery.fallbackDialoguesWord')],
          authorArchetype: aiResult.authorArchetype || t('mastery.defaultArchetype'),
          levelTitle: aiResult.levelTitle || t('mastery.fallbackLevelTitle'),
          trajectorySummary: aiResult.trajectorySummary || '',
          recommendedTaskIds: aiResult.recommendedTaskIds || ['task-char-internal-conflict']
        }
      }));

      setIsDiagnosticRunning(false);
      setActiveSubTab('trajectory');
    } catch (e) {
      console.error(e);
      setIsDiagnosticRunning(false);
    } finally {
      setIsDiagnosticSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-950 text-slate-100 flex flex-col">
      {/* Toast Notification */}
      {taskAppliedToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-emerald-500 text-slate-950 font-semibold rounded-xl shadow-2xl shadow-emerald-500/20 border border-emerald-400 animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{taskAppliedToast}</span>
        </div>
      )}

      {/* Top Header: Writer Rank, XP Bar & Streak */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          {/* Author Badge & Level */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-400 p-[2px] shadow-lg shadow-amber-500/20">
                <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                  <GraduationCap className="w-7 h-7 text-amber-400" />
                </div>
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-[10px] font-bold text-slate-950">
                Lvl {levelInfo.level}
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  {t('mastery.headerTitle')}
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 text-xs font-semibold">
                  {levelInfo.title}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('mastery.headerSubtitle', { title: book.title })}
              </p>
            </div>
          </div>

          {/* XP Progress & Streak Counter */}
          <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
            {/* Daily Streak */}
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800">
              <Flame className="w-5 h-5 text-orange-500 animate-pulse" />
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">{t('mastery.streakLabel')}</div>
                <div className="text-sm font-bold text-orange-400">{t('mastery.streakDays', { n: String(mastery.dailyStreak) })}</div>
              </div>
            </div>

            {/* XP Progress Bar */}
            <div data-tour="mastery__2" className="flex-1 md:w-64 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-slate-300 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> {levelInfo.currentXp} XP
                </span>
                <span className="text-slate-400">
                  {levelInfo.isMaxLevel ? t('mastery.maxLevel') : `${levelInfo.xpInLevel} / ${levelInfo.xpRequiredForNext} XP`}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                  style={{ width: `${levelInfo.percentage}%` }}
                />
              </div>
            </div>

            {/* Action to re-diagnose */}
            <button
              onClick={handleStartDiagnostic}
              data-tour="mastery__4"
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
              title={t('mastery.diagnosticTooltip')}
            >
              <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('mastery.diagnosticBtn')}</span>
            </button>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div data-tour="mastery__1" className="max-w-7xl mx-auto mt-5 flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setActiveSubTab('trajectory')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
              activeSubTab === 'trajectory'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>{t('mastery.tabTrajectory')}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('skill_tree')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
              activeSubTab === 'skill_tree'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>{t('mastery.tabSkillTree')}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('tasks')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
              activeSubTab === 'tasks'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Target className="w-4 h-4" />
            <span>{t('mastery.tabTasks', { n: String(SKILL_TASKS.length) })}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('diagnostic')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
              activeSubTab === 'diagnostic'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>{t('mastery.tabDiagnostic')}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('achievements')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
              activeSubTab === 'achievements'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>{t('mastery.tabAchievements', { x: String(mastery.achievements.filter(a => a.progress >= 100).length), y: String(mastery.achievements.length) })}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('style')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all ${
              activeSubTab === 'style'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-bold'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>{t('mastery.tabStyle')}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {/* SUBTAB 1: Щоденні завдання & Траєкторія */}
        {activeSubTab === 'trajectory' && (
          <div className="space-y-6">
            {/* Daily Task Widget */}
            <div className="mastery-today-card relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 p-6 shadow-xl">
              <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold uppercase tracking-wider border border-amber-500/30">
                      <Sparkles className="w-3.5 h-3.5" /> {t('mastery.todaysTaskBadge')}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-300 text-[11px] font-bold border border-orange-500/30">
                      <Flame className="w-3.5 h-3.5" /> {t('mastery.dayNumberBadge', { n: String(mastery.dailyStreak) })}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium">
                      <Clock className="w-3.5 h-3.5" /> {dailyTask.estimatedMinutes} {t('mastery.minutesShort')}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-bold">
                      <Zap className="w-3.5 h-3.5" /> +{dailyTask.xpReward} XP
                    </span>
                  </div>

                  <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
                    {dailyTask.title}
                  </h2>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    {dailyTask.goal}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-400">
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                      {t('mastery.skillLabel', { name: dailyTask.skillName })}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                      {t('mastery.levelDifficultyLabel', { level: String(dailyTask.level), difficulty: dailyTask.difficulty })}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 font-medium">
                      {t('mastery.integrationLabel', { title: book.title })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                  <button
                    onClick={() => handleOpenTask(dailyTask)}
                    data-tour="mastery__3"
                    className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition-all hover:scale-[1.02]"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{t('mastery.startTaskBtn')}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* UX Cycle Principle Banner */}
            <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" /> {t('mastery.cyclePrincipleHeading')}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center text-xs">
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-slate-300">{t('mastery.cycleStep1')}</div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-slate-300">{t('mastery.cycleStep2')}</div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-amber-400 font-semibold border-amber-500/30">{t('mastery.cycleStep3')}</div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-emerald-400 font-semibold border-emerald-500/30">{t('mastery.cycleStep4')}</div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-slate-300">{t('mastery.cycleStep5')}</div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-slate-300">{t('mastery.cycleStep6')}</div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-medium text-indigo-400 font-semibold border-indigo-500/30">{t('mastery.cycleStep7')}</div>
              </div>
            </div>

            {/* Personalized Recommended Queue (Формула рекомендацій) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    {t('mastery.trajectoryHeading')}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {t('mastery.trajectoryDesc')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recommendedTasks.map((task) => {
                  const Icon = CATEGORY_ICONS[task.category] || Target;
                  const isCompleted = mastery.completedTasks.some(ct => ct.taskId === task.id);

                  return (
                    <div
                      key={task.id}
                      onClick={() => handleOpenTask(task)}
                      data-tour={task.id === recommendedTasks[0]?.id ? 'mastery__5' : undefined}
                      className={`group relative rounded-xl p-5 border transition-all cursor-pointer flex flex-col justify-between ${
                        isCompleted
                          ? 'bg-slate-900/40 border-emerald-500/30 hover:border-emerald-500/60'
                          : 'bg-slate-900/90 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-amber-400 group-hover:text-amber-300">
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 uppercase">
                              {task.skillName}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isCompleted && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                                <Check className="w-3 h-3" /> {t('mastery.completedBadge')}
                              </span>
                            )}
                            <span className="text-xs font-bold text-amber-400">+{task.xpReward} XP</span>
                          </div>
                        </div>

                        <h4 className="text-sm font-bold text-slate-100 group-hover:text-amber-300 transition-colors mb-1.5 line-clamp-2">
                          {task.title}
                        </h4>

                        <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                          {task.goal}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {task.estimatedMinutes} {t('mastery.minutesShort')}
                        </span>
                        <span className="text-amber-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 font-semibold">
                          {t('mastery.goToBtn')} <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: Дерево навичок (10 Напрямків) */}
        {activeSubTab === 'skill_tree' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-amber-400" />
                {t('mastery.skillTreeHeading')}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {t('mastery.skillTreeDesc')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {SKILL_CATEGORIES.map((cat, idx) => {
                const Icon = CATEGORY_ICONS[cat.id] || Brain;
                const score = mastery.diagnostic.categoryScores?.[cat.id] || 60;
                const catTasks = SKILL_TASKS.filter(t => t.category === cat.id);
                const completedInCat = mastery.completedTasks.filter(ct => ct.category === cat.id).length;

                return (
                  <div
                    key={cat.id}
                    className="rounded-2xl bg-slate-900 border border-slate-800 p-5 hover:border-slate-700 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center text-white shadow-md`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {t('mastery.directionLabel', { n: String(idx + 1) })}
                            </div>
                            <h3 className="text-base font-bold text-slate-100">{categoryTitle(cat)}</h3>
                          </div>
                        </div>

                        <span className="text-sm font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                          {score}%
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed mb-3">
                        {cat.description}
                      </p>

                      {/* Sub-skills chips */}
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {cat.subSkills.map((sub, sIdx) => (
                          <span
                            key={sIdx}
                            className="px-2 py-0.5 rounded-md bg-slate-950 text-[10px] text-slate-400 border border-slate-800 font-medium"
                          >
                            • {sub}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">
                        {t('mastery.tasksCompletedLabel')} <strong className="text-slate-200">{completedInCat}</strong>
                      </span>
                      <button
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setActiveSubTab('tasks');
                        }}
                        className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      >
                        {t('mastery.categoryTasksLink')} <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SUBTAB 3: Бібліотека практичних завдань */}
        {activeSubTab === 'tasks' && (
          <div className="space-y-6">
            {/* Filters Bar */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('mastery.searchPlaceholder')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-amber-500"
                  />
                </div>

                {/* Category Filter */}
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-hidden focus:border-amber-500"
                >
                  <option value="all">{t('mastery.allCategoriesOption')}</option>
                  {SKILL_CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{categoryTitle(c)}</option>
                  ))}
                </select>

                {/* Level Filter */}
                <select
                  value={selectedLevelFilter}
                  onChange={(e) => setSelectedLevelFilter(e.target.value === 'all' ? 'all' : Number(e.target.value) as MasteryLevel)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-hidden focus:border-amber-500"
                >
                  <option value="all">{t('mastery.allLevelsOption')}</option>
                  <option value="1">{t('mastery.level1Option')}</option>
                  <option value="2">{t('mastery.level2Option')}</option>
                  <option value="3">{t('mastery.level3Option')}</option>
                  <option value="4">{t('mastery.level4Option')}</option>
                  <option value="5">{t('mastery.level5Option')}</option>
                </select>
              </div>

              <div className="text-xs text-slate-400 self-center">
                {t('mastery.tasksFoundLabel')} <strong className="text-amber-400">{filteredTasks.length}</strong>
              </div>
            </div>

            {/* Task Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((task) => {
                const Icon = CATEGORY_ICONS[task.category] || Target;
                const isCompleted = mastery.completedTasks.some(ct => ct.taskId === task.id);

                return (
                  <div
                    key={task.id}
                    onClick={() => handleOpenTask(task)}
                    className={`rounded-2xl p-5 border cursor-pointer transition-all flex flex-col justify-between ${
                      isCompleted
                        ? 'bg-slate-900/60 border-emerald-500/30 hover:border-emerald-500/60'
                        : 'bg-slate-900 border-slate-800 hover:border-amber-500/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-amber-400">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">
                              {task.skillName}
                            </span>
                            <div className="text-[10px] text-slate-500">
                              {t('mastery.levelDifficultyShort', { level: String(task.level), difficulty: task.difficulty })}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {isCompleted ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                              <Check className="w-3 h-3" /> {t('mastery.completedBadge')}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20">
                              +{task.xpReward} XP
                            </span>
                          )}
                        </div>
                      </div>

                      <h4 className="text-sm font-bold text-slate-100 mb-2">
                        {task.title}
                      </h4>

                      <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed mb-4">
                        {task.goal}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {task.estimatedMinutes} {t('mastery.minutesShort')}
                      </span>
                      <span className="font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1">
                        {t('mastery.practiceLink')} <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SUBTAB 4: Персональна діагностика письменника */}
        {activeSubTab === 'diagnostic' && (
          <div className="space-y-6">
            {/* Header / Re-run */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    {t('mastery.profileLabel')}
                  </span>
                  <span className="text-xs text-slate-400">•</span>
                  <span className="text-xs text-slate-400">{t('mastery.diagnosticLabel2')}</span>
                </div>
                <h2 className="text-xl font-bold text-slate-100 mt-1">
                  {mastery.diagnostic.authorArchetype || t('mastery.defaultArchetype')}
                </h2>
                <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
                  {mastery.diagnostic.trajectorySummary || t('mastery.defaultTrajectorySummary')}
                </p>
              </div>

              <button
                onClick={handleStartDiagnostic}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{t('mastery.rerunDiagnosticBtn')}</span>
              </button>
            </div>

            {/* Radar / Bars of Competencies */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Category Scores */}
              <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                  {t('mastery.categoryScoresHeading')}
                </h3>

                <div className="space-y-3">
                  {SKILL_CATEGORIES.map(cat => {
                    const score = mastery.diagnostic.categoryScores?.[cat.id] || 50;
                    return (
                      <div key={cat.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300">{categoryTitle(cat)}</span>
                          <span className="font-bold text-amber-400">{score}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Strengths & Growth Areas */}
              <div className="space-y-6">
                {/* Strengths */}
                <div className="p-6 rounded-2xl bg-slate-900 border border-emerald-500/30">
                  <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4" />
                    {t('mastery.strengthsHeading')}
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-300">
                    {mastery.diagnostic.strengths.map((str, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{str}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Weaknesses / Growth Areas */}
                <div className="p-6 rounded-2xl bg-slate-900 border border-amber-500/30">
                  <h4 className="text-sm font-bold text-amber-400 flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4" />
                    {t('mastery.growthAreasHeading')}
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-300">
                    {mastery.diagnostic.weaknesses.map((weak, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-amber-400 font-bold">•</span>
                        <span>{weak}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 5: Досягнення & Історія прогресу */}
        {activeSubTab === 'achievements' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                {t('mastery.achievementsHeading')}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {t('mastery.achievementsDesc')}
              </p>
            </div>

            {/* Achievements Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mastery.achievements.map((ach) => {
                const isUnlocked = ach.progress >= 100;
                return (
                  <div
                    key={ach.id}
                    className={`rounded-2xl p-5 border transition-all ${
                      isUnlocked
                        ? 'bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900 border-amber-500/50 shadow-lg shadow-amber-500/10'
                        : 'bg-slate-900/80 border-slate-800 opacity-85'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isUnlocked ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-500'
                      }`}>
                        <Trophy className="w-5 h-5" />
                      </div>

                      <span className="text-xs font-bold text-amber-400">
                        +{ach.xpBonus} XP
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-slate-100 mb-1">{ach.title}</h4>
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">{ach.description}</p>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">{t('mastery.progressLabel')}</span>
                        <span className="font-bold text-slate-300">{ach.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-500"
                          style={{ width: `${ach.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Completed Tasks History Log */}
            <div className="mt-8 space-y-4">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                {t('mastery.historyHeading', { n: String(mastery.completedTasks.length) })}
              </h3>

              {mastery.completedTasks.length === 0 ? (
                <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                  {t('mastery.emptyHistory')}
                </div>
              ) : (
                <div className="space-y-3">
                  {mastery.completedTasks.map((ct, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-200">{ct.taskTitle}</span>
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-amber-400 font-semibold">
                            +{ct.xpEarned} XP
                          </span>
                          {ct.appliedToBook && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                              {t('mastery.appliedToBookBadge')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 italic line-clamp-1">
                          «{ct.userAnswer}»
                        </p>
                      </div>

                      <div className="text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(ct.completedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const task = SKILL_TASKS.find(t => t.id === ct.taskId) || ({
                              id: ct.taskId,
                              title: ct.taskTitle,
                              category: ct.category,
                              skillName: ct.skillName,
                              level: ct.level,
                              difficulty: 'Середній',
                              estimatedMinutes: 15,
                              goal: 'Вдосконалення твору',
                              explanation: '',
                              instruction: '',
                              example: '',
                              targetBookEntity: 'chapter_scene',
                              xpReward: ct.xpEarned
                            } as SkillTask);
                            handleOpenTask(task);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-400" />
                          <span>{t('mastery.viewBtn')}</span>
                        </button>

                        <button
                          onClick={() => {
                            const task = SKILL_TASKS.find(t => t.id === ct.taskId) || ({
                              id: ct.taskId,
                              title: ct.taskTitle,
                              category: ct.category,
                              skillName: ct.skillName,
                              level: ct.level,
                              difficulty: 'Середній',
                              estimatedMinutes: 15,
                              goal: '',
                              explanation: '',
                              instruction: '',
                              example: '',
                              targetBookEntity: 'chapter_scene',
                              xpReward: ct.xpEarned
                            } as SkillTask);
                            setActiveTask(task);
                            handleApplyToBook(ct.userAnswer, task.targetBookEntity || 'chapter_scene');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
                        >
                          <BookmarkPlus className="w-3.5 h-3.5" />
                          <span>{t('mastery.applyBtn')}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUBTAB 6: Мій Стиль (Фаза 1, 1.2) */}
        {activeSubTab === 'style' && (
          <StyleView
            book={book}
            authUser={authUser || null}
            completedTaskAnswers={mastery.completedTasks.map((ct) => ct.userAnswer)}
          />
        )}
      </div>

      {/* Task Execution Workspace Modal */}
      {activeTask && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-950/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  Lvl {activeTask.level}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {activeTask.category} → {activeTask.skillName}
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="text-[11px] text-amber-400 font-bold">+{activeTask.xpReward} XP</span>
                  </div>
                  <h3 className="text-base font-bold text-slate-100">{activeTask.title}</h3>
                </div>
              </div>

              <button
                onClick={handleCloseTask}
                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Task Instructions & Example */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Instruction */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-amber-400 uppercase flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> {t('mastery.instructionLabel')}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeTask.instruction}
                  </p>
                </div>

                {/* Example */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-yellow-400" /> {t('mastery.exampleLabel')}
                  </div>
                  <p className="text-xs text-slate-300 italic leading-relaxed">
                    {activeTask.example}
                  </p>
                </div>
              </div>

              {/* Live Context from Author's Current Book */}
              <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                  <span className="text-indigo-200 font-medium">
                    {t('mastery.bookContextLabel')} <strong className="text-white">«{book.title}»</strong> ({book.genre || t('mastery.defaultGenreFallback')})
                  </span>
                </div>
                <span className="text-[11px] text-indigo-300">
                  {t('mastery.autoAddNote')}
                </span>
              </div>

              {/* Target Entity in Book Selection */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <BookmarkPlus className="w-3.5 h-3.5 text-emerald-400" />
                    {t('mastery.applyTargetLabel', { title: book.title })}
                  </label>
                  <span className="text-[11px] text-emerald-400 font-bold">
                    {selectedTarget === 'character_conflict' ? t('mastery.targetCharConflict') :
                     selectedTarget === 'character_desire' ? t('mastery.targetCharDesire') :
                     selectedTarget === 'character_fear' ? t('mastery.targetCharFear') :
                     selectedTarget === 'character_flaw' ? t('mastery.targetCharFlaw') :
                     selectedTarget === 'character_bio' ? t('mastery.targetCharBio') :
                     selectedTarget === 'logline' ? t('mastery.targetLogline') :
                     selectedTarget === 'synopsis' ? t('mastery.targetSynopsis') :
                     selectedTarget === 'theme' ? t('mastery.targetTheme') :
                     selectedTarget === 'chapter_scene' || selectedTarget === 'dialogue' ? t('mastery.targetChapterScene') :
                     selectedTarget === 'visual_concept' ? t('mastery.targetVisualConcept') :
                     selectedTarget === 'book_blurb' ? t('mastery.targetBookBlurb') :
                     selectedTarget === 'author_bio' ? t('mastery.targetAuthorBio') : t('mastery.targetManuscript')}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {[
                    { id: 'character_conflict', label: t('mastery.targetBtnCharConflict') },
                    { id: 'character_desire', label: t('mastery.targetBtnCharDesire') },
                    { id: 'character_fear', label: t('mastery.targetBtnCharFear') },
                    { id: 'character_bio', label: t('mastery.targetBtnCharBio') },
                    { id: 'logline', label: t('mastery.targetLogline') },
                    { id: 'synopsis', label: t('mastery.targetSynopsis') },
                    { id: 'theme', label: t('mastery.targetBtnTheme') },
                    { id: 'chapter_scene', label: t('mastery.targetBtnChapterScene') },
                    { id: 'dialogue', label: t('mastery.targetBtnDialogue') },
                    { id: 'visual_concept', label: t('mastery.targetBtnVisualConcept') },
                    { id: 'book_blurb', label: t('mastery.targetBtnBookBlurb') },
                    { id: 'author_bio', label: t('mastery.targetAuthorBio') },
                  ].map((tgt) => (
                    <button
                      key={tgt.id}
                      type="button"
                      onClick={() => setSelectedTarget(tgt.id as BookIntegrationTarget)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-left transition-all border ${
                        selectedTarget === tgt.id
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-xs'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {tgt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* User Answer Textarea */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Feather className="w-3.5 h-3.5 text-amber-400" />
                    {t('mastery.yourAnswerLabel')}
                  </label>
                  <span className="text-slate-500">{userAnswer.length} {t('mastery.charsCountSuffix')}</span>
                </div>

                <textarea
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  rows={6}
                  placeholder={t('mastery.answerPlaceholder')}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl p-4 text-xs text-slate-100 leading-relaxed focus:outline-hidden placeholder:text-slate-600 resize-y"
                />
              </div>

              {/* AI Evaluation Display */}
              {evaluationResult && (
                <div className="p-5 rounded-2xl bg-slate-950 border border-amber-500/40 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <h4 className="text-sm font-bold text-amber-400">{t('mastery.aiAnalysisHeading')}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-300">{t('mastery.scoreLabel', { score: String(evaluationResult.score) })}</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[11px] font-bold">
                        +{evaluationResult.xpEarned} XP
                      </span>
                    </div>
                  </div>

                  {/* Strengths & Growth Areas */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1">
                      <span className="font-bold text-emerald-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> {t('mastery.strengthsColonLabel')}
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                        {evaluationResult.strengths.map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-1">
                      <span className="font-bold text-amber-400 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> {t('mastery.growthColonLabel')}
                      </span>
                      <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                        {evaluationResult.growthAreas.map((g, idx) => (
                          <li key={idx}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                    <strong className="text-slate-100">{t('mastery.recommendationLabel')}</strong>
                    {evaluationResult.recommendation}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                onClick={handleCloseTask}
                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                {t('mastery.closeBtn')}
              </button>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={handleEvaluateTask}
                  disabled={!userAnswer.trim() || isEvaluating}
                  className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md"
                >
                  {isEvaluating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{t('mastery.aiAnalyzing')}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>{t('mastery.aiAnalyzeBtn')}</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleApplyToBook()}
                  disabled={!userAnswer.trim() && !evaluationResult}
                  className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-500/20"
                  title={!userAnswer.trim() && !evaluationResult ? t('mastery.applyDisabledTooltip') : t('mastery.applyEnabledTooltip')}
                >
                  <BookmarkPlus className="w-4 h-4" />
                  <span>{t('mastery.applyToBookBtn')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Quiz Modal */}
      {isDiagnosticRunning && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-6 animate-in fade-in zoom-in-95">
            {/* Quiz Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  {t('mastery.diagnosticQuizLabel')}
                </div>
                <h3 className="text-base font-bold text-slate-100 mt-0.5">
                  {t('mastery.questionOfLabel', { cur: String(diagnosticCurrentStep + 1), total: String(DIAGNOSTIC_QUESTIONS.length) })}
                </h3>
              </div>
              <button
                onClick={() => setIsDiagnosticRunning(false)}
                className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center text-sm"
              >
                ✕
              </button>
            </div>

            {/* Quiz Progress */}
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-300"
                style={{ width: `${((diagnosticCurrentStep + 1) / DIAGNOSTIC_QUESTIONS.length) * 100}%` }}
              />
            </div>

            {/* Question Text */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                {t('mastery.directionSkillLabel', { skill: DIAGNOSTIC_QUESTIONS[diagnosticCurrentStep].skillName })}
              </span>
              <h4 className="text-base font-bold text-slate-100">
                {DIAGNOSTIC_QUESTIONS[diagnosticCurrentStep].question}
              </h4>
              {DIAGNOSTIC_QUESTIONS[diagnosticCurrentStep].description && (
                <p className="text-xs text-slate-400">
                  {DIAGNOSTIC_QUESTIONS[diagnosticCurrentStep].description}
                </p>
              )}
            </div>

            {/* Options */}
            <div className="space-y-2.5">
              {DIAGNOSTIC_QUESTIONS[diagnosticCurrentStep].options.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectDiagnosticOption(DIAGNOSTIC_QUESTIONS[diagnosticCurrentStep].id, opt.score)}
                  disabled={isDiagnosticSubmitting}
                  className="w-full text-left p-4 rounded-xl bg-slate-950 hover:bg-amber-500/10 border border-slate-800 hover:border-amber-500/40 text-xs text-slate-200 leading-relaxed transition-all flex items-start gap-3 group"
                >
                  <span className="w-6 h-6 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 group-hover:text-amber-400 group-hover:border-amber-500/40 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span>{opt.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
