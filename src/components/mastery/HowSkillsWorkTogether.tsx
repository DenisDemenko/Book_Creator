import React, { useState } from "react";
import { FLOW_STEPS } from "../../data/mastery18";
import {
  Lightbulb,
  Network,
  Users,
  Zap,
  Clapperboard,
  Feather,
  Scale,
  FileEdit,
  GraduationCap,
  ArrowRight,
  Sparkles,
  Play,
  RotateCcw,
  Star,
} from "lucide-react";

interface HowSkillsWorkTogetherProps {
  onStartTraining: () => void;
}

const STEP_ICONS: { [key: string]: any } = {
  Lightbulb,
  Network,
  Users,
  Zap,
  Clapperboard,
  Feather,
  Scale,
  FileEdit,
  GraduationCap,
};

export const HowSkillsWorkTogether: React.FC<HowSkillsWorkTogetherProps> = ({
  onStartTraining,
}) => {
  const [activeStepId, setActiveStepId] = useState<number>(1);
  const currentStep = FLOW_STEPS.find((s) => s.id === activeStepId) || FLOW_STEPS[0];
  const StepIcon = STEP_ICONS[currentStep.iconName] || Lightbulb;

  return (
    <section id="pipeline" className="w-full py-12 flex flex-col gap-10">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-3.5 py-1 rounded-full text-xs font-bold text-[#006d37] mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          Наскрізний виробничий процес
        </div>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#1a1c1c] tracking-tight">
          Як ці навички працюють разом
        </h2>
        <p className="text-sm sm:text-base text-[#3d4a3e] mt-2">
          Повний цикл народження твору: простежте, як сира ідея проходить крізь 9 етапів та перетворюється на бестселер.
        </p>
      </div>

      {/* Horizontal Pipeline Steps Bar */}
      <div className="w-full overflow-x-auto pb-4 scrollbar-none">
        <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-6 rounded-3xl min-w-[860px] flex items-center justify-between gap-2 border border-white relative">
          {FLOW_STEPS.map((step, index) => {
            const Icon = STEP_ICONS[step.iconName] || Lightbulb;
            const isActive = activeStepId === step.id;
            const isPassed = step.id < activeStepId;

            return (
              <React.Fragment key={step.id}>
                {/* Step Node */}
                <div
                  onClick={() => setActiveStepId(step.id)}
                  className={`flex flex-col items-center gap-2 cursor-pointer transition-all group ${
                    isActive ? "scale-105" : "opacity-80 hover:opacity-100"
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                      isActive
                        ? "neo-pressed bg-[#006d37] text-white shadow-md"
                        : isPassed
                        ? "neo-extruded-soft bg-emerald-50 text-[#006d37]"
                        : "neo-extruded-soft bg-[#f9f9f9] text-[#6c7b6d]"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>

                  <div className="text-center">
                    <div
                      className={`text-xs font-extrabold transition-colors ${
                        isActive ? "text-[#006d37]" : "text-[#1a1c1c]"
                      }`}
                    >
                      {step.title}
                    </div>
                    <div className="text-[10px] text-[#6c7b6d] font-semibold">
                      {step.action}
                    </div>
                  </div>
                </div>

                {/* Arrow Connector between steps */}
                {index < FLOW_STEPS.length - 1 && (
                  <div className="flex-1 flex items-center justify-center px-1 text-gray-300">
                    <ArrowRight
                      className={`w-4 h-4 transition-colors ${
                        step.id < activeStepId ? "text-emerald-500" : "text-gray-300"
                      }`}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Dynamic Step Detail & Transformation Simulator */}
      <div className="w-full max-w-5xl mx-auto neo-extruded bg-[#f9f9f9] p-6 sm:p-8 rounded-3xl border border-white flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006d37]">
              <StepIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#6c7b6d] uppercase tracking-wide">
                Етап {currentStep.id} з 9
              </div>
              <h3 className="text-xl font-extrabold text-[#1a1c1c] flex items-center gap-2">
                {currentStep.title} <span className="text-[#006d37]">({currentStep.action})</span>
              </h3>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveStepId(Math.max(1, activeStepId - 1))}
              disabled={activeStepId === 1}
              className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] px-3.5 py-2 rounded-full text-xs font-bold text-[#1a1c1c] disabled:opacity-40"
            >
              ← Попередній
            </button>
            <button
              onClick={() => setActiveStepId(Math.min(FLOW_STEPS.length, activeStepId + 1))}
              disabled={activeStepId === FLOW_STEPS.length}
              className="neo-extruded neo-button-interactive bg-[#006d37] text-white px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40"
            >
              Наступний крок →
            </button>
          </div>
        </div>

        <p className="text-sm sm:text-base text-[#1a1c1c] font-medium leading-relaxed">
          {currentStep.description}
        </p>

        {/* Live Transformation Showcase Box */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Before */}
          <div className="neo-pressed bg-[#f4f3f3] p-5 rounded-2xl flex flex-col gap-2">
            <div className="text-xs font-extrabold text-rose-700 uppercase tracking-wider">
              До застосування навички (Сирий стан):
            </div>
            <p className="text-xs sm:text-sm italic text-[#3d4a3e] leading-relaxed font-['Plus_Jakarta_Sans',sans-serif]">
              {currentStep.sampleTransformation.before}
            </p>
          </div>

          {/* After */}
          <div className="neo-extruded bg-emerald-50/70 p-5 rounded-2xl border border-emerald-200/60 flex flex-col gap-2">
            <div className="text-xs font-extrabold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Після обробки навичкою (Майстерний стан):
            </div>
            <p className="text-xs sm:text-sm font-semibold text-emerald-950 leading-relaxed font-['Plus_Jakarta_Sans',sans-serif]">
              {currentStep.sampleTransformation.after}
            </p>
            <div className="text-[11px] text-emerald-700 font-medium mt-1 pt-2 border-t border-emerald-200/40">
              💡 {currentStep.sampleTransformation.explanation}
            </div>
          </div>
        </div>
      </div>

      {/* Gold Bottom Banner Matching Infographic */}
      <div className="w-full max-w-5xl mx-auto neo-extruded bg-gradient-to-r from-[#003b1d] via-[#006d37] to-[#004f27] text-white p-6 sm:p-8 rounded-3xl shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6 border border-emerald-400/30">
        <div className="flex items-center gap-4 text-center sm:text-left">
          <div className="w-12 h-12 rounded-full bg-amber-400/20 border border-amber-300/40 flex items-center justify-center shrink-0">
            <Star className="w-6 h-6 text-amber-300 fill-amber-300" />
          </div>
          <div>
            <h4 className="text-base sm:text-lg font-extrabold tracking-tight">
              Розвивайте всі 18 навичок системно
            </h4>
            <p className="text-xs sm:text-sm text-emerald-100 mt-0.5">
              І ваші книги та курси змінюватимуть життя людей та стануть справжньою спадщиною!
            </p>
          </div>
        </div>

        <button
          onClick={onStartTraining}
          className="neo-extruded-soft neo-button-interactive bg-white text-[#006d37] hover:bg-emerald-50 px-6 py-3 rounded-full text-xs sm:text-sm font-extrabold shrink-0 shadow-lg cursor-pointer"
        >
          Розпочати навчання зараз
        </button>
      </div>
    </section>
  );
};
