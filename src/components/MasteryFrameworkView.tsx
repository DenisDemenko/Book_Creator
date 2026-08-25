import React, { useState, useEffect, useMemo } from 'react';
import { SKILLS_DATA } from '../data/mastery18';
import { SkillItem, UserSkillProgress } from '../types/mastery';
import { Header as MasteryHeader } from './mastery/Header';
import { Footer as MasteryFooter } from './mastery/Footer';
import { HeroSection } from './mastery/HeroSection';
import { MasteryGrowthChart } from './mastery/MasteryGrowthChart';
import { WheelOfMastery } from './mastery/WheelOfMastery';
import { SkillsGrid } from './mastery/SkillsGrid';
import { HowSkillsWorkTogether } from './mastery/HowSkillsWorkTogether';
import { EmotionalArcLab } from './mastery/EmotionalArcLab';
import { SkillDetailModal } from './mastery/SkillDetailModal';
import { DiagnosticQuiz } from './mastery/DiagnosticQuiz';
import { BlueprintBuilder } from './mastery/BlueprintBuilder';
import { StyleView } from './StyleView';
import { X, User } from 'lucide-react';
import type { Book, AuthUser } from '../types';

const STORAGE_KEY = 'mastery_framework_user_progress_v1';
/** Ключ, яким користувалась попередня вкладка «Майстерність» для своїх завдань. */
const LEGACY_MASTERY_STATE_KEY = 'nova_writer_mastery_state';

interface MasteryFrameworkViewProps {
  book: Book;
  onUpdateBook?: (updatedBook: Book, auditAction?: string, auditDetails?: string) => void;
  authUser?: AuthUser | null;
}

/** Читає відповіді з виконаних вправ попередньої вкладки для модуля стилю. */
function readLegacyCompletedAnswers(): string[] {
  try {
    const saved = localStorage.getItem(LEGACY_MASTERY_STATE_KEY);
    if (!saved) return [];
    const state = JSON.parse(saved);
    if (state && Array.isArray(state.completedTasks)) {
      return state.completedTasks
        .map((ct: any) => (typeof ct?.userAnswer === 'string' ? ct.userAnswer : null))
        .filter(Boolean);
    }
  } catch (e) {
    console.warn('Could not read legacy mastery answers', e);
  }
  return [];
}

export const MasteryFrameworkView: React.FC<MasteryFrameworkViewProps> = ({
  book,
  onUpdateBook,
  authUser,
}) => {
  const [activeNavTab, setActiveNavTab] = useState<string>('skills');
  const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState<boolean>(false);
  const [isBlueprintOpen, setIsBlueprintOpen] = useState<boolean>(false);
  const [isStyleOpen, setIsStyleOpen] = useState<boolean>(false);

  // Load progress from localStorage
  const [userProgress, setUserProgress] = useState<UserSkillProgress>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load saved progress', e);
    }
    // Default initial progress map from skills data
    const initial: UserSkillProgress = {};
    const now = Date.now();
    SKILLS_DATA.forEach((s) => {
      const daysOffset = Math.max(1, 24 - s.id * 1.2);
      const initialTrainedDate = new Date(now - daysOffset * 24 * 60 * 60 * 1000).toISOString();
      initial[s.id] = {
        skillId: s.id,
        progress: s.defaultProgress,
        isMastered: s.defaultProgress >= 90,
        customNotes: '',
        lastTrained: initialTrainedDate,
      };
    });
    return initial;
  });

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userProgress));
    } catch (e) {
      console.error('Failed to save progress', e);
    }
  }, [userProgress]);

  // Calculate overall average mastery percent
  const overallMasteryPercent = useMemo(() => {
    const total = SKILLS_DATA.reduce((acc, curr) => {
      const p = userProgress[curr.id]?.progress ?? curr.defaultProgress;
      return acc + p;
    }, 0);
    return Math.round(total / SKILLS_DATA.length);
  }, [userProgress]);

  // Update progress for an individual skill
  const handleUpdateSkillProgress = (
    skillId: number,
    newProgress: number,
    isMastered: boolean = false,
    customNotes: string = ''
  ) => {
    setUserProgress((prev) => ({
      ...prev,
      [skillId]: {
        skillId,
        progress: newProgress,
        isMastered: isMastered || newProgress >= 90,
        customNotes,
        lastTrained: new Date().toISOString(),
      },
    }));
  };

  // Batch update from diagnostic audit
  const handleApplyAuditResults = (results: { [skillId: number]: number }) => {
    setUserProgress((prev) => {
      const updated = { ...prev };
      const now = new Date().toISOString();
      Object.entries(results).forEach(([idStr, score]) => {
        const id = Number(idStr);
        updated[id] = {
          ...(updated[id] || { skillId: id }),
          progress: score,
          isMastered: score >= 90,
          lastTrained: now,
        };
      });
      return updated;
    });
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mastery-fw flex-1 min-h-0 flex flex-col bg-[#f4f3f3] text-[#1a1c1c] font-['Plus_Jakarta_Sans',sans-serif] selection:bg-[#006d37] selection:text-white">
      {/* Сторінка Майстерності (світла тема) / темна — через CSS-перевизначення.
          Контент росте разом зі сторінкою, скрол — колесом миші по вікну,
          як у решті сайту (без вкладеного overflow-контейнера). */}
      {/* Neomorphic Header (не sticky: у студії свій sticky-хедер зверху) */}
      <MasteryHeader
        activeTab={activeNavTab}
        setActiveTab={setActiveNavTab}
        masteryPercent={overallMasteryPercent}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
        onOpenBlueprint={() => setIsBlueprintOpen(true)}
        onOpenStyle={() => setIsStyleOpen(true)}
      />

      {/* Main Content Container */}
      <main className="w-full max-w-[1240px] mx-auto px-4 sm:px-6 flex flex-col gap-12 sm:gap-16 pb-12">
        {/* 1. Hero Section */}
        <HeroSection
          onStartTraining={() => scrollToSection('skills')}
          onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
          onExploreWheel={() => scrollToSection('wheel')}
        />

        {/* 2. Mastery Growth Dashboard with Recharts Line Chart */}
        <MasteryGrowthChart
          skills={SKILLS_DATA}
          userProgress={userProgress}
          onSelectSkill={(skill) => setSelectedSkill(skill)}
          onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
        />

        {/* 3. Interactive Circular Wheel of Mastery */}
        <WheelOfMastery
          skills={SKILLS_DATA}
          onSelectSkill={(skill) => setSelectedSkill(skill)}
        />

        {/* 4. The 18 Skills Directory & Interactive Cards */}
        <SkillsGrid
          skills={SKILLS_DATA}
          userProgress={userProgress}
          onSelectSkill={(skill) => setSelectedSkill(skill)}
        />

        {/* 5. How the Skills Work Together (Pipeline & Simulator) */}
        <HowSkillsWorkTogether
          onStartTraining={() => scrollToSection('skills')}
        />

        {/* 6. Emotional Arc Lab (Center Graphic from Infographic) */}
        <EmotionalArcLab />
      </main>

      {/* Footer */}
      <MasteryFooter />

      {/* MODAL 1: Skill Detail & Live AI Coach Trainer */}
      {selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          userProgress={userProgress}
          onUpdateProgress={handleUpdateSkillProgress}
          book={book}
          onUpdateBook={onUpdateBook}
        />
      )}

      {/* MODAL 2: 18-Skill Diagnostic Audit */}
      {isDiagnosticOpen && (
        <DiagnosticQuiz
          skills={SKILLS_DATA}
          onClose={() => setIsDiagnosticOpen(false)}
          onApplyResults={handleApplyAuditResults}
        />
      )}

      {/* MODAL 3: Book & Course Blueprint Generator */}
      {isBlueprintOpen && (
        <BlueprintBuilder
          onClose={() => setIsBlueprintOpen(false)}
        />
      )}

      {/* MODAL 4: Мій стиль автора (збережено з попередньої версії вкладки) */}
      {isStyleOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0f172a] text-slate-100 w-full max-w-3xl max-h-[92vh] rounded-3xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-100">Мій стиль автора</div>
                  <div className="text-[11px] text-slate-400">Файл ім'я_автора.md — аналіз стилю та підказки для AI</div>
                </div>
              </div>
              <button
                onClick={() => setIsStyleOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
                aria-label="Закрити"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <StyleView
                book={book}
                authUser={authUser || null}
                completedTaskAnswers={readLegacyCompletedAnswers()}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
