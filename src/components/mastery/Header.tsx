import React, { useState } from "react";
import { BookOpen, Sparkles, Compass, Activity, Award, Menu, X, FileText, Sun, SunDim, TrendingUp, User } from "lucide-react";
import { useSunLighting } from "../../context/SunLightingContext";

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  masteryPercent: number;
  onOpenDiagnostic: () => void;
  onOpenBlueprint: () => void;
  /** Відкрити модуль «Мій стиль автора» (збережено з попередньої версії). */
  onOpenStyle?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  masteryPercent,
  onOpenDiagnostic,
  onOpenBlueprint,
  onOpenStyle,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isSunEnabled, toggleSunEnabled, selectedColor } = useSunLighting();

  const navLinks = [
    { id: "dashboard", label: "Динаміка росту", icon: TrendingUp },
    { id: "skills", label: "18 Навичок", icon: BookOpen },
    { id: "wheel", label: "Колесо Майстерності", icon: Compass },
    { id: "pipeline", label: "Як це працює", icon: Activity },
    { id: "arc", label: "Емоційна дуга", icon: Sparkles },
  ];

  return (
    <header className="w-full py-3 px-4 sm:px-6 relative z-30 bg-[#f4f3f3]/90 transition-all">
      <div className="bg-[#f9f9f9] w-full py-3 px-4 sm:px-6 neo-extruded flex justify-between items-center max-w-[1240px] mx-auto rounded-2xl border border-white/60">
        {/* Brand */}
        <div 
          onClick={() => { setActiveTab("skills"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex items-center gap-3 cursor-pointer group select-none"
        >
          <div className="w-10 h-10 rounded-xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006d37] group-hover:scale-105 transition-transform">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg sm:text-xl font-extrabold text-[#1a1c1c] tracking-tight leading-tight flex items-center gap-2">
              Mastery Framework
              <span className="hidden sm:inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 neo-pressed-soft">
                18 Skills
              </span>
            </div>
            <div className="text-[11px] text-[#5c6f5e] font-medium hidden sm:block">
              Система створення книг і навчальних курсів
            </div>
          </div>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex gap-1 xl:gap-2 items-center bg-[#f4f3f3] neo-pressed-soft px-3 py-1.5 rounded-full">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = activeTab === link.id;
            return (
              <button
                key={link.id}
                onClick={() => {
                  setActiveTab(link.id);
                  const el = document.getElementById(link.id);
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  isActive
                    ? "bg-[#006d37] text-white shadow-sm"
                    : "text-[#3d4a3e] hover:text-[#006d37] hover:bg-white/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {link.label}
              </button>
            );
          })}
        </nav>

        {/* Progress & Actions */}
        <div className="hidden md:flex items-center gap-2.5">
          {/* Sun Toggle in Header */}
          <button
            onClick={toggleSunEnabled}
            className={`neo-extruded-soft neo-button-interactive px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              isSunEnabled
                ? "bg-white text-[#1a1c1c] border border-amber-200/80 shadow-sm"
                : "bg-gray-100 text-gray-500 hover:text-gray-800 border border-gray-200"
            }`}
            title={
              isSunEnabled
                ? "Вимкнути сонце (приховати сонечко та світлові ефекти)"
                : "Увімкнути сонце (активувати 3D сонечко, 12 кольорів та 10-хв фокус)"
            }
          >
            {isSunEnabled ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500 animate-spin" style={{ animationDuration: "14s" }} />
                <span className="hidden xl:inline">Сонце:</span>
                <span className="text-[#006d37] font-extrabold">Увімк.</span>
              </>
            ) : (
              <>
                <SunDim className="w-3.5 h-3.5 text-gray-400" />
                <span className="hidden xl:inline">Сонце:</span>
                <span className="text-gray-500">Вимк.</span>
              </>
            )}
          </button>

          {/* Progress pill */}
          <div className="flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-3.5 py-1.5 rounded-full">
            <Award className="w-4 h-4 text-emerald-600" />
            <div className="text-xs font-bold text-[#1a1c1c]">
              Прогрес: <span className="text-emerald-700">{masteryPercent}%</span>
            </div>
            <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden neo-pressed-soft">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${masteryPercent}%` }}
              />
            </div>
          </div>

          {onOpenStyle && (
            <button
              onClick={onOpenStyle}
              className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] px-3.5 py-2 rounded-full text-xs font-bold text-[#7c2d12] flex items-center gap-1.5"
              title="Файл ім'я_автора.md: сформувати та використовувати ваш стиль"
            >
              <User className="w-3.5 h-3.5" />
              Мій стиль
            </button>
          )}

          <button
            onClick={onOpenBlueprint}
            className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] px-3.5 py-2 rounded-full text-xs font-bold text-[#006397] flex items-center gap-1.5"
            title="Скласти план книги/курсу"
          >
            <FileText className="w-3.5 h-3.5" />
            План проекту
          </button>

          <button
            onClick={onOpenDiagnostic}
            className="neo-extruded neo-button-interactive bg-[#006d37] hover:bg-[#005a2d] px-4 py-2 rounded-full text-xs font-bold text-white flex items-center gap-1.5 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
            Тест навичок
          </button>
        </div>

        {/* Mobile menu buttons */}
        <div className="flex lg:hidden items-center gap-2">
          {/* Quick mobile Sun toggle button */}
          <button
            onClick={toggleSunEnabled}
            className={`neo-extruded-soft neo-button-interactive p-2 rounded-full text-xs font-bold transition-all ${
              isSunEnabled ? "bg-white text-amber-600 border border-amber-200" : "bg-gray-100 text-gray-400"
            }`}
            title={isSunEnabled ? "Вимкнути сонце" : "Увімкнути сонце"}
          >
            {isSunEnabled ? <Sun className="w-4 h-4" /> : <SunDim className="w-4 h-4" />}
          </button>

          <button
            onClick={onOpenDiagnostic}
            className="neo-extruded-soft neo-button-interactive bg-[#006d37] p-2 rounded-full text-white text-xs font-bold sm:hidden"
            title="Тест"
          >
            <Sparkles className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="neo-extruded neo-button-interactive bg-[#f9f9f9] p-2.5 rounded-full text-[#1a1c1c]"
            aria-label="Меню"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden mt-3 bg-[#f9f9f9] neo-extruded rounded-2xl p-5 border border-white max-w-[1240px] mx-auto animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = activeTab === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => {
                    setActiveTab(link.id);
                    setMobileMenuOpen(false);
                    const el = document.getElementById(link.id);
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all text-left ${
                    isActive
                      ? "bg-[#006d37] text-white shadow-md"
                      : "neo-pressed-soft text-[#3d4a3e]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </button>
              );
            })}

            {/* Sun Control Row in Mobile Menu */}
            <div className="mt-1 p-3.5 rounded-xl bg-white/80 border border-gray-200/80 neo-pressed-soft flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
                  style={{
                    background: isSunEnabled ? selectedColor.gradient : "#e5e7eb",
                  }}
                >
                  {isSunEnabled ? (
                    <Sun className="w-4 h-4 text-white animate-spin" style={{ animationDuration: "12s" }} />
                  ) : (
                    <SunDim className="w-4 h-4 text-gray-500" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-extrabold text-[#1a1c1c] flex items-center gap-1.5">
                    <span>Сонце та Освітлення</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                        isSunEnabled ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {isSunEnabled ? "Увімкнено" : "Вимкнено"}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {isSunEnabled ? `Колір: ${selectedColor.name}` : "Ефекти приховані"}
                  </div>
                </div>
              </div>

              <button
                onClick={toggleSunEnabled}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isSunEnabled
                    ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                    : "bg-[#006d37] text-white shadow-md hover:bg-[#005a2d]"
                }`}
              >
                {isSunEnabled ? "Вимкнути" : "Увімкнути"}
              </button>
            </div>

            <div className="pt-3 border-t border-gray-200 flex flex-col gap-2">
              {onOpenStyle && (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenStyle();
                  }}
                  className="w-full neo-extruded-soft neo-button-interactive bg-[#f9f9f9] py-3 rounded-xl text-sm font-bold text-[#7c2d12] flex items-center justify-center gap-2"
                >
                  <User className="w-4 h-4" />
                  Мій стиль автора (ім'я_автора.md)
                </button>
              )}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenBlueprint();
                }}
                className="w-full neo-extruded-soft neo-button-interactive bg-[#f9f9f9] py-3 rounded-xl text-sm font-bold text-[#006397] flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Скласти Blueprint книги/курсу
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenDiagnostic();
                }}
                className="w-full neo-extruded neo-button-interactive bg-[#006d37] text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-emerald-200" />
                Пройти діагностику (18 питань)
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
