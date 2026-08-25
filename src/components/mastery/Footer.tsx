import React from "react";
import { BookOpen, Sparkles, Heart, Compass, Activity, ArrowUp } from "lucide-react";

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="w-full mt-16 pt-12 pb-16 px-4 bg-[#f4f3f3] border-t border-gray-200/80">
      <div className="max-w-[1240px] mx-auto flex flex-col gap-10">
        <div className="neo-extruded bg-[#f9f9f9] p-8 sm:p-10 rounded-3xl border border-white flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4 text-center md:text-left">
            <div className="w-14 h-14 rounded-2xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006d37] shrink-0">
              <BookOpen className="w-7 h-7" />
            </div>
            <div>
              <div className="text-xl font-extrabold text-[#1a1c1c] tracking-tight">
                Mastery Framework
              </div>
              <p className="text-xs sm:text-sm text-[#5c6f5e] font-medium mt-0.5 max-w-lg">
                Комплексна методологія 18 навичок для створення бестселерів, навчальних курсів та експертних посібників найвищого рівня.
              </p>
            </div>
          </div>

          <button
            onClick={scrollToTop}
            className="neo-extruded neo-button-interactive bg-[#f9f9f9] p-3.5 rounded-full text-[#1a1c1c] hover:text-[#006d37] flex items-center gap-2 text-xs font-bold shrink-0"
            aria-label="Вгору"
          >
            <span>Нагору</span>
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom Credits & Copyright */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6c7b6d] px-2 font-medium">
          <div className="flex items-center gap-1.5">
            <span>© {new Date().getFullYear()} Mastery Framework.</span>
            <span>Створено для письменників, авторів та творців знань.</span>
          </div>

          <div className="flex items-center gap-2">
            <span>Powered by Gemini AI Coach</span>
            <span>•</span>
            <span>Neomorphic Design System</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
