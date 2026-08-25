import React, { useState, useMemo } from "react";
import { SkillItem, SkillCategory, UserSkillProgress } from "../../types/mastery";
import {
  Search,
  Grid,
  List,
  Sparkles,
  CheckCircle2,
  BookOpen,
  ArrowUpRight,
  Filter,
  Check,
} from "lucide-react";

interface SkillsGridProps {
  skills: SkillItem[];
  userProgress: UserSkillProgress;
  onSelectSkill: (skill: SkillItem) => void;
}

export const SkillsGrid: React.FC<SkillsGridProps> = ({
  skills,
  userProgress,
  onSelectSkill,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const categories = [
    { id: "all", label: "Всі 18 навичок", count: 18 },
    { id: "content_structure", label: "Зміст & Структура", count: 5 },
    { id: "drama_characters", label: "Персонажі & Драма", count: 3 },
    { id: "style_expression", label: "Стиль & Образність", count: 4 },
    { id: "expertise_logic", label: "Експертність & Логіка", count: 3 },
    { id: "impact_pedagogy", label: "Вплив & Педагогіка", count: 3 },
  ];

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const matchCategory =
        selectedCategory === "all" || skill.category === selectedCategory;

      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchCategory;

      const matchText =
        skill.title.toLowerCase().includes(q) ||
        skill.numberStr.includes(q) ||
        skill.shortDescription.toLowerCase().includes(q) ||
        skill.subSkills.some((sub) => sub.toLowerCase().includes(q));

      return matchCategory && matchText;
    });
  }, [skills, selectedCategory, searchQuery]);

  return (
    <section id="skills" className="w-full py-8 flex flex-col gap-8">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-3.5 py-1 rounded-full text-xs font-bold text-[#006d37] mb-2">
            <BookOpen className="w-3.5 h-3.5" />
            Повний каталог компетенцій
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1a1c1c] tracking-tight">
            18 Ключових навичок письменника
          </h2>
          <p className="text-sm text-[#3d4a3e] mt-1">
            Оберіть навичку для відкриття теоретичного розбору, 4 суб-критеріїв та інтерактивного AI-тренажера.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2.5 rounded-full transition-all cursor-pointer ${
              viewMode === "grid"
                ? "neo-pressed bg-[#f9f9f9] text-[#006d37]"
                : "neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#6c7b6d]"
            }`}
            title="Сітка карток"
            aria-label="Вигляд сіткою"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2.5 rounded-full transition-all cursor-pointer ${
              viewMode === "list"
                ? "neo-pressed bg-[#f9f9f9] text-[#006d37]"
                : "neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#6c7b6d]"
            }`}
            title="Список"
            aria-label="Вигляд списком"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center">
        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0 scrollbar-none">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  isActive
                    ? "bg-[#006d37] text-white shadow-sm"
                    : "neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#3d4a3e]"
                }`}
              >
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-white/20 text-white" : "bg-black/5 text-[#6c7b6d]"
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="relative min-w-[260px] sm:min-w-[320px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6c7b6d]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Пошук навички або критерію..."
            className="w-full pl-10 pr-4 py-2.5 rounded-full neo-pressed bg-[#f9f9f9] text-xs sm:text-sm text-[#1a1c1c] placeholder:text-[#8a988b] focus:outline-none focus:ring-2 focus:ring-[#006d37]/40 border-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6c7b6d] hover:text-[#1a1c1c]"
            >
              Очистити
            </button>
          )}
        </div>
      </div>

      {/* Skills Grid / List Display */}
      {filteredSkills.length === 0 ? (
        <div className="neo-pressed bg-[#f9f9f9] p-12 rounded-3xl text-center flex flex-col items-center justify-center">
          <BookOpen className="w-12 h-12 text-[#6c7b6d] mb-3 opacity-60" />
          <h3 className="text-lg font-bold text-[#1a1c1c]">Навичок не знайдено</h3>
          <p className="text-xs text-[#6c7b6d] mt-1 max-w-md">
            За запитом "{searchQuery}" немає збігів. Спробуйте змінити ключове слово або категорію.
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("all");
            }}
            className="mt-4 neo-extruded bg-[#f9f9f9] px-4 py-2 rounded-full text-xs font-bold text-[#006d37]"
          >
            Скинути фільтри
          </button>
        </div>
      ) : viewMode === "grid" ? (
        /* GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7">
          {filteredSkills.map((skill) => {
            const progress = userProgress[skill.id]?.progress ?? skill.defaultProgress;
            const isMastered = userProgress[skill.id]?.isMastered ?? false;

            return (
              <div
                key={skill.id}
                onClick={() => onSelectSkill(skill)}
                className="neo-extruded hover:neo-extruded-lg bg-[#f9f9f9] rounded-3xl p-6 flex flex-col gap-4 border border-white/80 transition-all duration-200 group cursor-pointer relative"
              >
                {/* Card Top: Number & Category Badge */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-[#006d37] neo-pressed bg-[#f9f9f9] px-3 py-1 rounded-full border border-white">
                      {skill.numberStr}
                    </span>
                    <span className="text-[11px] font-bold text-[#6c7b6d] px-2.5 py-0.5 rounded-full neo-pressed-soft bg-[#f4f3f3]">
                      {skill.categoryName}
                    </span>
                  </div>

                  {isMastered ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                      <Check className="w-3 h-3" /> Опановано
                    </span>
                  ) : (
                    <div className="w-8 h-8 rounded-full neo-pressed-soft bg-[#f9f9f9] flex items-center justify-center text-[#6c7b6d] group-hover:text-[#006d37] group-hover:scale-105 transition-all">
                      <ArrowUpRight className="w-4 h-4" />
                    </div>
                  )}
                </div>

                {/* Title & Short Description */}
                <div>
                  <h3 className="text-lg font-extrabold text-[#1a1c1c] group-hover:text-[#006d37] transition-colors mb-1.5 flex items-center gap-2">
                    {skill.title}
                  </h3>
                  <p className="text-xs text-[#3d4a3e] line-clamp-2 leading-relaxed">
                    {skill.shortDescription}
                  </p>
                </div>

                {/* Sub-skills criteria (matching the infographic bullet points) */}
                <div className="neo-pressed-soft bg-[#f4f3f3] p-3 rounded-2xl flex flex-col gap-1.5">
                  <div className="text-[10px] font-extrabold text-[#6c7b6d] uppercase tracking-wider">
                    Ключові критерії:
                  </div>
                  <ul className="grid grid-cols-1 gap-1">
                    {skill.subSkills.map((sub, idx) => (
                      <li key={idx} className="text-xs text-[#1a1c1c] flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#006d37]" />
                        <span className="truncate">{sub}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Progress Bar and Action Button */}
                <div className="mt-auto pt-2 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs font-bold text-[#6c7b6d]">
                    <span>Рівень володіння</span>
                    <span className="text-[#006d37] font-extrabold">{progress}%</span>
                  </div>
                  <div className="w-full neo-pressed bg-[#f4f3f3] h-2.5 rounded-full overflow-hidden p-0.5">
                    <div
                      className="bg-[#006d37] h-full rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSkill(skill);
                    }}
                    className="w-full mt-1 neo-extruded-soft neo-button-interactive group-hover:bg-[#006d37] group-hover:text-white bg-[#f9f9f9] text-[#1a1c1c] py-2.5 rounded-full text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600 group-hover:text-emerald-200" />
                    <span>Відкрити тренажер & AI</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="flex flex-col gap-3">
          {filteredSkills.map((skill) => {
            const progress = userProgress[skill.id]?.progress ?? skill.defaultProgress;
            return (
              <div
                key={skill.id}
                onClick={() => onSelectSkill(skill)}
                className="neo-extruded hover:neo-extruded-lg bg-[#f9f9f9] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-white transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-4">
                  <span className="text-base font-extrabold text-[#006d37] neo-pressed bg-[#f9f9f9] px-3.5 py-2 rounded-xl">
                    {skill.numberStr}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-[#1a1c1c] group-hover:text-[#006d37] transition-colors">
                        {skill.title}
                      </h3>
                      <span className="text-[10px] font-bold text-[#6c7b6d] px-2 py-0.5 rounded-full bg-gray-200/60">
                        {skill.categoryName}
                      </span>
                    </div>
                    <p className="text-xs text-[#3d4a3e] line-clamp-1 mt-0.5">
                      {skill.subSkills.join(" • ")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                  <div className="flex items-center gap-2 min-w-[120px]">
                    <div className="w-20 neo-pressed bg-[#f4f3f3] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#006d37] h-full rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs font-extrabold text-[#006d37]">{progress}%</span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSkill(skill);
                    }}
                    className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] hover:bg-[#006d37] hover:text-white text-[#1a1c1c] px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1.5"
                  >
                    <span>Тренувати</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
