import React from "react";
import { Play, Sparkles, BookOpen, Layers, CheckCircle2, ArrowDown } from "lucide-react";

interface HeroSectionProps {
  onStartTraining: () => void;
  onOpenDiagnostic: () => void;
  onExploreWheel: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onStartTraining,
  onOpenDiagnostic,
  onExploreWheel,
}) => {
  return (
    <section className="relative w-full pt-8 pb-12 sm:pb-16 flex flex-col items-center text-center px-4">
      {/* Top Banner Tag */}
      <div className="inline-flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-4 py-1.5 rounded-full mb-6 border border-white/80 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="text-xs font-bold uppercase tracking-wider text-[#006d37]">
          Повна система майстерності для книг і курсів
        </span>
      </div>

      {/* Main Headline */}
      <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-[#1a1c1c] max-w-4xl tracking-tight leading-[1.15] mb-6">
        18 Ключових навичок{" "}
        <span className="text-[#006d37] inline-block relative">
          письменника
          <svg className="absolute -bottom-2 left-0 w-full h-3 text-[#2ecc71]/40 -z-10" viewBox="0 0 100 20" preserveAspectRatio="none">
            <path d="M0,15 Q50,0 100,15" stroke="currentColor" strokeWidth="6" fill="none" />
          </svg>
        </span>{" "}
        та експерта
      </h1>

      {/* Subtitle */}
      <p className="text-base sm:text-lg md:text-xl text-[#3d4a3e] max-w-3xl font-medium leading-relaxed mb-8">
        Опануйте повний спектр компетенцій від зародження ідеї та драматургічного конфлікту до неповторного стилю, педагогічної цінності та фінального редагування.
      </p>

      {/* CTA Buttons */}
      <div className="flex flex-wrap justify-center items-center gap-4 mb-12">
        <button
          onClick={onStartTraining}
          className="neo-extruded neo-button-interactive bg-[#006d37] hover:bg-[#005a2d] text-white px-8 py-4 rounded-full text-base sm:text-lg font-bold flex items-center gap-3 shadow-lg group cursor-pointer"
        >
          <span>Почати тренування</span>
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
            <Play className="w-4 h-4 fill-white text-white" />
          </div>
        </button>

        <button
          onClick={onOpenDiagnostic}
          className="neo-extruded neo-button-interactive bg-[#f9f9f9] hover:bg-white text-[#1a1c1c] px-7 py-4 rounded-full text-base sm:text-lg font-bold flex items-center gap-2.5 cursor-pointer"
        >
          <Sparkles className="w-5 h-5 text-emerald-600" />
          <span>Пройти аудит (18 питань)</span>
        </button>

        <button
          onClick={onExploreWheel}
          className="neo-pressed-soft neo-button-interactive bg-[#f4f3f3] hover:bg-[#eae9e9] text-[#006397] px-6 py-4 rounded-full text-base font-bold flex items-center gap-2 cursor-pointer"
        >
          <Layers className="w-5 h-5" />
          <span>Інтерактивне Колесо</span>
        </button>
      </div>

      {/* Feature / Stat Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-4xl">
        <div className="neo-extruded bg-[#f9f9f9] p-4 rounded-2xl flex flex-col items-center text-center border border-white">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#006d37] mb-1">18</div>
          <div className="text-xs sm:text-sm font-bold text-[#1a1c1c]">Ключових навичок</div>
          <div className="text-[11px] text-[#6c7b6d] mt-0.5">Від ідеї до спадщини</div>
        </div>

        <div className="neo-extruded bg-[#f9f9f9] p-4 rounded-2xl flex flex-col items-center text-center border border-white">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#006397] mb-1">9</div>
          <div className="text-xs sm:text-sm font-bold text-[#1a1c1c]">Секторів матриці</div>
          <div className="text-[11px] text-[#6c7b6d] mt-0.5">Кругова синергія</div>
        </div>

        <div className="neo-extruded bg-[#f9f9f9] p-4 rounded-2xl flex flex-col items-center text-center border border-white">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#6b21a8] mb-1">72</div>
          <div className="text-xs sm:text-sm font-bold text-[#1a1c1c]">Суб-компетенції</div>
          <div className="text-[11px] text-[#6c7b6d] mt-0.5">4 критерії на навичку</div>
        </div>

        <div className="neo-extruded bg-[#f9f9f9] p-4 rounded-2xl flex flex-col items-center text-center border border-white">
          <div className="text-2xl sm:text-3xl font-extrabold text-[#ea580c] mb-1">AI Coach</div>
          <div className="text-xs sm:text-sm font-bold text-[#1a1c1c]">Миттєва оцінка</div>
          <div className="text-[11px] text-[#6c7b6d] mt-0.5">Глибокий розбір чернеток</div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="mt-10 flex flex-col items-center text-xs font-semibold text-[#6c7b6d] animate-bounce">
        <span className="mb-1">Гортайте вниз для відкриття навичок</span>
        <ArrowDown className="w-4 h-4" />
      </div>
    </section>
  );
};
