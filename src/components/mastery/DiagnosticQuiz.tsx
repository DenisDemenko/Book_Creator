import React, { useState } from "react";
import { SkillItem, UserSkillProgress } from "../../types/mastery";
import { X, Sparkles, Check, ArrowRight, ArrowLeft, RotateCcw, Award, CheckCircle2, Star } from "lucide-react";
import confetti from "canvas-confetti";

interface DiagnosticQuizProps {
  skills: SkillItem[];
  onClose: () => void;
  onApplyResults: (results: { [skillId: number]: number }) => void;
}

export const DiagnosticQuiz: React.FC<DiagnosticQuizProps> = ({
  skills,
  onClose,
  onApplyResults,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [ratings, setRatings] = useState<{ [skillId: number]: number }>({});
  const [isCompleted, setIsCompleted] = useState<boolean>(false);

  const currentSkill = skills[currentStep];

  const handleRate = (skillId: number, score: number) => {
    const nextRatings = { ...ratings, [skillId]: score };
    setRatings(nextRatings);

    if (currentStep < skills.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setIsCompleted(true);
      confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
    }
  };

  const handleQuickRateAll = (defaultScore: number) => {
    const bulk: { [id: number]: number } = {};
    skills.forEach((s) => {
      bulk[s.id] = defaultScore;
    });
    setRatings(bulk);
    setIsCompleted(true);
  };

  const calculateResults = () => {
    const skillScores: { skill: SkillItem; score: number }[] = skills.map((s) => ({
      skill: s,
      score: ratings[s.id] ? ratings[s.id] * 20 : s.defaultProgress,
    }));

    const sortedByWeakest = [...skillScores].sort((a, b) => a.score - b.score);
    const topStrengths = [...skillScores].sort((a, b) => b.score - a.score).slice(0, 3);
    const priorityTraining = sortedByWeakest.slice(0, 3);

    const averageScore = Math.round(
      skillScores.reduce((acc, curr) => acc + curr.score, 0) / skills.length
    );

    return { skillScores, topStrengths, priorityTraining, averageScore };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#f9f9f9] neo-extruded-lg w-full max-w-3xl rounded-3xl flex flex-col overflow-hidden border border-white relative max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-[#f9f9f9]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006d37]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#1a1c1c]">
                Діагностичний аудит 18 навичок
              </h2>
              <p className="text-xs text-[#6c7b6d]">
                Оцініть свій поточний рівень для побудови персонального плану
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full neo-extruded neo-button-interactive bg-[#f9f9f9] flex items-center justify-center text-[#6c7b6d] hover:text-[#1a1c1c]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-grow flex flex-col justify-center">
          {!isCompleted ? (
            /* STEP BY STEP QUESTION */
            <div className="flex flex-col gap-6 max-w-xl mx-auto w-full">
              {/* Progress Indicator */}
              <div className="flex items-center justify-between text-xs font-bold text-[#6c7b6d]">
                <span>Питання {currentStep + 1} з 18</span>
                <span className="text-[#006d37] font-extrabold">
                  {Math.round(((currentStep + 1) / 18) * 100)}%
                </span>
              </div>
              <div className="w-full neo-pressed bg-[#f4f3f3] h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#006d37] h-full transition-all duration-300"
                  style={{ width: `${((currentStep + 1) / 18) * 100}%` }}
                />
              </div>

              {/* Question Card */}
              <div className="neo-extruded bg-[#f9f9f9] p-6 rounded-3xl border border-white text-center flex flex-col items-center gap-3">
                <span className="font-extrabold text-sm text-[#006d37] neo-pressed bg-[#f9f9f9] px-3 py-1 rounded-full">
                  {currentSkill.numberStr} • {currentSkill.categoryName}
                </span>

                <h3 className="text-xl font-extrabold text-[#1a1c1c]">
                  {currentSkill.title}
                </h3>
                <p className="text-xs sm:text-sm text-[#3d4a3e] max-w-md leading-relaxed">
                  {currentSkill.shortDescription}
                </p>

                <div className="neo-pressed-soft bg-[#f4f3f3] p-3 rounded-2xl w-full text-left text-xs text-[#1a1c1c] mt-2">
                  <div className="text-[10px] font-extrabold text-[#6c7b6d] uppercase mb-1">
                    Критерії цієї навички:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {currentSkill.subSkills.map((sub, i) => (
                      <span key={i} className="bg-white px-2 py-0.5 rounded-md text-[11px] font-medium text-gray-800">
                        {sub}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 1 to 5 Rating Buttons */}
                <div className="w-full mt-4 flex flex-col gap-2">
                  <div className="text-xs font-bold text-[#6c7b6d]">
                    Як ви оцінюєте своє володіння цією навичкою?
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { score: 1, label: "Початківець", num: "1" },
                      { score: 2, label: "Базовий", num: "2" },
                      { score: 3, label: "Середній", num: "3" },
                      { score: 4, label: "Впевнений", num: "4" },
                      { score: 5, label: "Майстер", num: "5" },
                    ].map((item) => (
                      <button
                        key={item.score}
                        onClick={() => handleRate(currentSkill.id, item.score)}
                        className={`p-3 rounded-2xl flex flex-col items-center gap-1 transition-all cursor-pointer ${
                          ratings[currentSkill.id] === item.score
                            ? "neo-pressed bg-[#006d37] text-white"
                            : "neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#1a1c1c]"
                        }`}
                      >
                        <span className="text-base font-extrabold">{item.num}</span>
                        <span className="text-[9px] font-medium hidden sm:inline">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Navigation footer */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  disabled={currentStep === 0}
                  className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] px-4 py-2 rounded-full text-xs font-bold text-[#6c7b6d] disabled:opacity-30"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-1" /> Назад
                </button>

                <button
                  onClick={() => handleQuickRateAll(3)}
                  className="text-xs text-[#6c7b6d] hover:text-[#1a1c1c] underline"
                >
                  Заповнити всі як «Середній рівень»
                </button>
              </div>
            </div>
          ) : (
            /* AUDIT RESULTS REPORT */
            (() => {
              const { topStrengths, priorityTraining, averageScore } = calculateResults();

              return (
                <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full animate-in fade-in">
                  <div className="neo-extruded bg-[#f9f9f9] p-6 rounded-3xl border border-white text-center flex flex-col items-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-[#006d37] mb-1">
                      <Award className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-extrabold text-[#1a1c1c]">
                      Ваш інтегральний індекс майстерності
                    </h3>
                    <div className="text-4xl font-extrabold text-[#006d37]">
                      {averageScore}%
                    </div>
                    <p className="text-xs text-[#6c7b6d] max-w-md">
                      {averageScore >= 80
                        ? "Високий рівень! Ваші тексти мають зрілу структуру та сильний голос."
                        : averageScore >= 50
                        ? "Гарний фундамент! Сфокусуйтеся на пріоритетних навичках нижче для системного прориву."
                        : "Чудова відправна точка! Покрокове тренування 18 навичок дасть максимальний приріст якості."}
                    </p>
                  </div>

                  {/* Strengths & Priority Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Strengths */}
                    <div className="neo-extruded bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200">
                      <div className="text-xs font-extrabold text-emerald-800 uppercase mb-2 flex items-center gap-1.5">
                        <Star className="w-4 h-4 text-emerald-600 fill-emerald-600" />
                        Ваші найсильніші навички:
                      </div>
                      <div className="flex flex-col gap-2">
                        {topStrengths.map((item) => (
                          <div key={item.skill.id} className="flex justify-between items-center text-xs font-bold text-emerald-950">
                            <span>{item.skill.numberStr}. {item.skill.title}</span>
                            <span>{item.score}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Priority Training */}
                    <div className="neo-extruded bg-amber-50/70 p-4 rounded-2xl border border-amber-200">
                      <div className="text-xs font-extrabold text-amber-800 uppercase mb-2 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-amber-600" />
                        Рекомендовано прокачати першими:
                      </div>
                      <div className="flex flex-col gap-2">
                        {priorityTraining.map((item) => (
                          <div key={item.skill.id} className="flex justify-between items-center text-xs font-bold text-amber-950">
                            <span>{item.skill.numberStr}. {item.skill.title}</span>
                            <span>{item.score}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Apply Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      onClick={() => {
                        const resultsMap: { [id: number]: number } = {};
                        skills.forEach((s) => {
                          resultsMap[s.id] = ratings[s.id] ? ratings[s.id] * 20 : s.defaultProgress;
                        });
                        onApplyResults(resultsMap);
                        onClose();
                      }}
                      className="flex-1 neo-extruded neo-button-interactive bg-[#006d37] hover:bg-[#005a2d] text-white py-3.5 rounded-full text-xs font-bold flex items-center justify-center gap-2 shadow-md cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Зберегти результати та оновити дашборд</span>
                    </button>

                    <button
                      onClick={() => {
                        setIsCompleted(false);
                        setCurrentStep(0);
                        setRatings({});
                      }}
                      className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] text-[#1a1c1c] px-4 py-3 rounded-full text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Пройти знову
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
};
