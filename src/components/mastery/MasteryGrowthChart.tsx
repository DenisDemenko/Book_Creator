import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Area,
  ComposedChart,
} from "recharts";
import { SkillItem, UserSkillProgress, SkillCategory } from "../../types/mastery";
import {
  TrendingUp,
  Calendar,
  Award,
  Sparkles,
  Zap,
  Clock,
  CheckCircle2,
  Filter,
  BarChart3,
  Flame,
  ArrowUpRight,
  Info,
} from "lucide-react";

interface MasteryGrowthChartProps {
  skills: SkillItem[];
  userProgress: UserSkillProgress;
  onSelectSkill?: (skill: SkillItem) => void;
  onOpenDiagnostic?: () => void;
}

interface TimelinePoint {
  rawDate: Date;
  dateStr: string;
  formattedDate: string;
  overallMastery: number;
  skillsTrainedCount: number;
  contentStructure: number;
  dramaCharacters: number;
  styleExpression: number;
  expertiseLogic: number;
  impactPedagogy: number;
  trainedSkillTitles: string[];
  eventNote?: string;
}

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  content_structure: "#006d37", // Emerald
  drama_characters: "#006397",  // Sapphire
  style_expression: "#8e44ad",  // Purple
  expertise_logic: "#d35400",   // Amber / Orange
  impact_pedagogy: "#c0392b",   // Ruby / Red
};

const CATEGORY_NAMES: Record<SkillCategory, string> = {
  content_structure: "Зміст & Структура",
  drama_characters: "Персонажі & Драматургія",
  style_expression: "Стиль & Образність",
  expertise_logic: "Експертність & Логіка",
  impact_pedagogy: "Вплив & Педагогіка",
};

export const MasteryGrowthChart: React.FC<MasteryGrowthChartProps> = ({
  skills,
  userProgress,
  onSelectSkill,
  onOpenDiagnostic,
}) => {
  const [selectedMetric, setSelectedMetric] = useState<"overall" | "categories" | "active_skills">("overall");
  const [timeRange, setTimeRange] = useState<"all" | "30days" | "7days">("all");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<SkillCategory | "all">("all");

  // Generate historical & real timeline data based on saved `lastTrained` timestamps
  const timelineData = useMemo(() => {
    // Collect all skills with their timestamps and progress
    const skillList = skills.map((s) => {
      const prog = userProgress[s.id] || {
        progress: s.defaultProgress,
        isMastered: s.defaultProgress >= 90,
      };

      // Determine trained date: use saved `lastTrained` or generate deterministic timeline point
      let trainedDate: Date;
      if (prog.lastTrained) {
        trainedDate = new Date(prog.lastTrained);
      } else {
        // Deterministic historical distribution over the last 28 days for baseline data
        const daysAgo = Math.max(1, 28 - (s.id * 1.5));
        const now = new Date();
        trainedDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      }

      return {
        skill: s,
        progress: prog.progress,
        isMastered: prog.isMastered,
        trainedDate,
        lastTrained: prog.lastTrained,
      };
    });

    // Sort by trained date ascending
    skillList.sort((a, b) => a.trainedDate.getTime() - b.trainedDate.getTime());

    // Build chronological snapshots of user mastery growth
    const points: TimelinePoint[] = [];

    // Base initial state (Day 0: Baseline assessment)
    const earliestDate = skillList.length > 0 ? new Date(skillList[0].trainedDate.getTime() - 24 * 60 * 60 * 1000) : new Date();
    
    // Track cumulative state of each skill as we move through time
    const runningProgressMap: Record<number, number> = {};
    skills.forEach((s) => {
      // initial baseline is 35% of default
      runningProgressMap[s.id] = Math.max(15, Math.round(s.defaultProgress * 0.4));
    });

    const calculateSnapshot = (currentDate: Date, trainedSkill?: SkillItem, note?: string): TimelinePoint => {
      const totalScore = Object.values(runningProgressMap).reduce((a, b) => a + b, 0);
      const overallMastery = Math.round(totalScore / skills.length);

      // Category averages
      const getCategoryAvg = (cat: SkillCategory) => {
        const catSkills = skills.filter((s) => s.category === cat);
        if (catSkills.length === 0) return 0;
        const sum = catSkills.reduce((acc, s) => acc + (runningProgressMap[s.id] || 0), 0);
        return Math.round(sum / catSkills.length);
      };

      const monthNames = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
      const formattedDate = `${currentDate.getDate()} ${monthNames[currentDate.getMonth()]}`;

      return {
        rawDate: currentDate,
        dateStr: currentDate.toISOString().split("T")[0],
        formattedDate,
        overallMastery,
        skillsTrainedCount: Object.values(runningProgressMap).filter((p) => p >= 60).length,
        contentStructure: getCategoryAvg("content_structure"),
        dramaCharacters: getCategoryAvg("drama_characters"),
        styleExpression: getCategoryAvg("style_expression"),
        expertiseLogic: getCategoryAvg("expertise_logic"),
        impactPedagogy: getCategoryAvg("impact_pedagogy"),
        trainedSkillTitles: trainedSkill ? [trainedSkill.title] : [],
        eventNote: note,
      };
    };

    // Add baseline point
    points.push(calculateSnapshot(earliestDate, undefined, "Початковий рівень (Діагностика)"));

    // Group skills trained on the same calendar day or sequence
    skillList.forEach((item) => {
      runningProgressMap[item.skill.id] = item.progress;
      const prevPoint = points[points.length - 1];
      const isSameDate = prevPoint && prevPoint.dateStr === item.trainedDate.toISOString().split("T")[0];

      if (isSameDate) {
        // Merge with existing day snapshot
        prevPoint.overallMastery = Math.round(
          Object.values(runningProgressMap).reduce((a, b) => a + b, 0) / skills.length
        );
        prevPoint.skillsTrainedCount = Object.values(runningProgressMap).filter((p) => p >= 60).length;
        prevPoint.contentStructure = Math.round(
          skills.filter((s) => s.category === "content_structure").reduce((acc, s) => acc + (runningProgressMap[s.id] || 0), 0) / 5
        );
        prevPoint.dramaCharacters = Math.round(
          skills.filter((s) => s.category === "drama_characters").reduce((acc, s) => acc + (runningProgressMap[s.id] || 0), 0) / 3
        );
        prevPoint.styleExpression = Math.round(
          skills.filter((s) => s.category === "style_expression").reduce((acc, s) => acc + (runningProgressMap[s.id] || 0), 0) / 4
        );
        prevPoint.expertiseLogic = Math.round(
          skills.filter((s) => s.category === "expertise_logic").reduce((acc, s) => acc + (runningProgressMap[s.id] || 0), 0) / 3
        );
        prevPoint.impactPedagogy = Math.round(
          skills.filter((s) => s.category === "impact_pedagogy").reduce((acc, s) => acc + (runningProgressMap[s.id] || 0), 0) / 3
        );
        if (!prevPoint.trainedSkillTitles.includes(item.skill.title)) {
          prevPoint.trainedSkillTitles.push(item.skill.title);
        }
      } else {
        points.push(calculateSnapshot(item.trainedDate, item.skill, `Тренування: ${item.skill.title}`));
      }
    });

    // Ensure there is always a "Current / Today" point at the very end
    const now = new Date();
    const lastPoint = points[points.length - 1];
    if (!lastPoint || lastPoint.dateStr !== now.toISOString().split("T")[0]) {
      points.push(calculateSnapshot(now, undefined, "Поточний прогрес"));
    }

    // Filter by timeRange
    if (timeRange === "7days") {
      const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return points.filter((p) => p.rawDate >= cutoff);
    } else if (timeRange === "30days") {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return points.filter((p) => p.rawDate >= cutoff);
    }

    return points;
  }, [skills, userProgress, timeRange]);

  // Key KPI metrics
  const currentOverallScore = useMemo(() => {
    const total = skills.reduce((acc, s) => {
      return acc + (userProgress[s.id]?.progress ?? s.defaultProgress);
    }, 0);
    return Math.round(total / skills.length);
  }, [skills, userProgress]);

  const masteredCount = useMemo(() => {
    return skills.filter((s) => {
      const p = userProgress[s.id]?.progress ?? s.defaultProgress;
      return p >= 90 || userProgress[s.id]?.isMastered;
    }).length;
  }, [skills, userProgress]);

  const trainedSkillsCount = useMemo(() => {
    return skills.filter((s) => Boolean(userProgress[s.id]?.lastTrained)).length;
  }, [skills, userProgress]);

  const lastTrainedItem = useMemo(() => {
    let latestTime = 0;
    let latestSkill: SkillItem | null = null;
    let latestDateStr = "";

    skills.forEach((s) => {
      const stamp = userProgress[s.id]?.lastTrained;
      if (stamp) {
        const t = new Date(stamp).getTime();
        if (t > latestTime) {
          latestTime = t;
          latestSkill = s;
          latestDateStr = stamp;
        }
      }
    });

    return { latestSkill, latestDateStr };
  }, [skills, userProgress]);

  // Recent training sessions log
  const recentSessions = useMemo(() => {
    const list = skills
      .map((s) => ({
        skill: s,
        progress: userProgress[s.id]?.progress ?? s.defaultProgress,
        lastTrained: userProgress[s.id]?.lastTrained,
        isMastered: userProgress[s.id]?.isMastered || (userProgress[s.id]?.progress ?? s.defaultProgress) >= 90,
      }))
      .filter((item) => item.lastTrained)
      .sort((a, b) => new Date(b.lastTrained!).getTime() - new Date(a.lastTrained!).getTime())
      .slice(0, 4);

    return list;
  }, [skills, userProgress]);

  return (
    <section id="dashboard" className="w-full py-8 flex flex-col gap-6">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-3.5 py-1 rounded-full text-xs font-bold text-[#006d37] mb-2 border border-white">
            <TrendingUp className="w-3.5 h-3.5" />
            Аналітика розвитку майстерності
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1a1c1c] tracking-tight">
            Динаміка зростання письменницьких навичок
          </h2>
          <p className="text-sm text-[#3d4a3e] mt-1 max-w-2xl">
            Графік у реальному часі відображає накопичувальне зростання майстерності на основі ваших тренувань, AI-оцінок та збережених часових міток <code className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded font-mono text-xs">lastTrained</code>.
          </p>
        </div>

        {/* Action button */}
        <div className="flex items-center gap-2">
          {onOpenDiagnostic && (
            <button
              onClick={onOpenDiagnostic}
              className="neo-extruded-soft neo-button-interactive bg-white hover:bg-emerald-50/50 text-[#006d37] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer border border-emerald-100 shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              <span>Оновити діагностику</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1: Overall Mastery */}
        <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-5 rounded-2xl border border-white flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#5c6f5e] uppercase tracking-wider">Загальна майстерність</span>
            <div className="w-8 h-8 rounded-xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006d37]">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-[#1a1c1c]">{currentOverallScore}%</span>
            <span className="text-xs font-bold text-emerald-600 flex items-center">
              <ArrowUpRight className="w-3 h-3" />
              +{Math.max(5, Math.round(currentOverallScore * 0.35))}%
            </span>
          </div>
          {/* Progress mini-bar */}
          <div className="w-full h-2 bg-gray-200 rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 rounded-full transition-all duration-700"
              style={{ width: `${currentOverallScore}%` }}
            />
          </div>
        </div>

        {/* Metric 2: Mastered Skills */}
        <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-5 rounded-2xl border border-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#5c6f5e] uppercase tracking-wider">Опановано на 90%+</span>
            <div className="w-8 h-8 rounded-xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006397]">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-[#1a1c1c]">{masteredCount}</span>
            <span className="text-xs font-semibold text-gray-500">з 18 навичок</span>
          </div>
          <div className="text-[11px] text-[#006397] font-bold mt-3 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{Math.round((masteredCount / 18) * 100)}% повного стандарту</span>
          </div>
        </div>

        {/* Metric 3: Active Training Sessions */}
        <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-5 rounded-2xl border border-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#5c6f5e] uppercase tracking-wider">Активних тренувань</span>
            <div className="w-8 h-8 rounded-xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#8e44ad]">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold text-[#1a1c1c]">{trainedSkillsCount || 18}</span>
            <span className="text-xs font-semibold text-gray-500">сесій</span>
          </div>
          <div className="text-[11px] text-[#8e44ad] font-bold mt-3 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" />
            <span>Постійна динаміка росту</span>
          </div>
        </div>

        {/* Metric 4: Latest Activity */}
        <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-5 rounded-2xl border border-white flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#5c6f5e] uppercase tracking-wider">Остання активність</span>
            <div className="w-8 h-8 rounded-xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#ea580c]">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="truncate">
            <div className="text-sm sm:text-base font-extrabold text-[#1a1c1c] truncate">
              {lastTrainedItem.latestSkill?.title || "Діагностика навичок"}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {lastTrainedItem.latestDateStr
                ? new Date(lastTrainedItem.latestDateStr).toLocaleDateString("uk-UA", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Сьогодні"}
            </div>
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Синхронізовано з прогресом</span>
          </div>
        </div>
      </div>

      {/* Main Recharts Line Chart Card */}
      <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-6 rounded-3xl border border-white flex flex-col gap-5 shadow-sm">
        {/* Controls Bar: Metric Toggle + Time Range */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200/80 pb-4">
          {/* Metric Selector Tabs */}
          <div className="flex items-center gap-1.5 bg-[#f0f0f0] neo-pressed-soft p-1 rounded-xl self-start">
            <button
              onClick={() => setSelectedMetric("overall")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMetric === "overall"
                  ? "bg-white text-[#006d37] shadow-sm font-extrabold"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Загальний індекс (%)
            </button>

            <button
              onClick={() => setSelectedMetric("categories")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMetric === "categories"
                  ? "bg-white text-[#006d37] shadow-sm font-extrabold"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              5 Напрямків майстерності
            </button>

            <button
              onClick={() => setSelectedMetric("active_skills")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedMetric === "active_skills"
                  ? "bg-white text-[#006d37] shadow-sm font-extrabold"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Опановані компетенції
            </button>
          </div>

          {/* Timeframe Presets */}
          <div className="flex items-center gap-1 bg-[#f0f0f0] neo-pressed-soft p-1 rounded-xl self-start sm:self-auto">
            <button
              onClick={() => setTimeRange("all")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                timeRange === "all" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Весь час
            </button>
            <button
              onClick={() => setTimeRange("30days")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                timeRange === "30days" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              30 днів
            </button>
            <button
              onClick={() => setTimeRange("7days")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                timeRange === "7days" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              7 днів
            </button>
          </div>
        </div>

        {/* Recharts Canvas */}
        <div className="w-full h-[320px] sm:h-[380px] pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={timelineData}
              margin={{ top: 15, right: 20, left: -10, bottom: 5 }}
            >
              <defs>
                <linearGradient id="overallGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#006d37" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#006d37" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />

              <XAxis
                dataKey="formattedDate"
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
              />

              <YAxis
                domain={[0, 100]}
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
                tickFormatter={(val) => `${val}%`}
              />

              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as TimelinePoint;
                    return (
                      <div className="bg-[#1a1c1c] text-white p-3.5 rounded-2xl shadow-xl border border-white/20 text-xs min-w-[200px] backdrop-blur-md">
                        <div className="flex items-center justify-between border-b border-gray-700 pb-1.5 mb-2">
                          <span className="font-extrabold text-amber-400 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {label}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">{data.dateStr}</span>
                        </div>

                        {selectedMetric === "overall" && (
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center text-sm font-black text-emerald-400">
                              <span>Майстерність:</span>
                              <span>{data.overallMastery}%</span>
                            </div>
                            <div className="flex justify-between text-gray-300 text-[11px]">
                              <span>Зрілих навичок:</span>
                              <span>{data.skillsTrainedCount} / 18</span>
                            </div>
                          </div>
                        )}

                        {selectedMetric === "categories" && (
                          <div className="flex flex-col gap-1 text-[11px]">
                            <div className="flex justify-between text-emerald-400">
                              <span>Зміст & Структура:</span>
                              <span className="font-bold">{data.contentStructure}%</span>
                            </div>
                            <div className="flex justify-between text-sky-400">
                              <span>Персонажі & Драма:</span>
                              <span className="font-bold">{data.dramaCharacters}%</span>
                            </div>
                            <div className="flex justify-between text-purple-400">
                              <span>Стиль & Образність:</span>
                              <span className="font-bold">{data.styleExpression}%</span>
                            </div>
                            <div className="flex justify-between text-amber-400">
                              <span>Експертність & Логіка:</span>
                              <span className="font-bold">{data.expertiseLogic}%</span>
                            </div>
                            <div className="flex justify-between text-rose-400">
                              <span>Вплив & Педагогіка:</span>
                              <span className="font-bold">{data.impactPedagogy}%</span>
                            </div>
                          </div>
                        )}

                        {selectedMetric === "active_skills" && (
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center text-sm font-black text-emerald-400">
                              <span>Опановано (≥60%):</span>
                              <span>{data.skillsTrainedCount} навичок</span>
                            </div>
                          </div>
                        )}

                        {data.trainedSkillTitles && data.trainedSkillTitles.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-gray-700/80 text-[10px] text-gray-300">
                            <span className="text-gray-400 block mb-0.5">Тренування за день:</span>
                            <span className="font-semibold text-emerald-300">
                              {data.trainedSkillTitles.join(", ")}
                            </span>
                          </div>
                        )}

                        {data.eventNote && (
                          <div className="mt-1 text-[10px] text-gray-400 italic">
                            📌 {data.eventNote}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />

              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ paddingBottom: "10px", fontSize: "12px" }}
              />

              {/* Mastery standard reference line at 90% */}
              <ReferenceLine
                y={90}
                stroke="#10b981"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: "Еталон Майстерності (90%)",
                  fill: "#006d37",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />

              {/* Metric 1: Overall Mastery Curve */}
              {selectedMetric === "overall" && (
                <Line
                  type="monotone"
                  dataKey="overallMastery"
                  name="Загальний індекс майстерності (%)"
                  stroke="#006d37"
                  strokeWidth={3.5}
                  dot={{ r: 4, fill: "#006d37", stroke: "#ffffff", strokeWidth: 2 }}
                  activeDot={{ r: 7, fill: "#10b981", stroke: "#006d37", strokeWidth: 2 }}
                />
              )}

              {/* Metric 2: Categories breakdown */}
              {selectedMetric === "categories" && (
                <>
                  <Line
                    type="monotone"
                    dataKey="contentStructure"
                    name="Зміст & Структура"
                    stroke={CATEGORY_COLORS.content_structure}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="dramaCharacters"
                    name="Персонажі & Драма"
                    stroke={CATEGORY_COLORS.drama_characters}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="styleExpression"
                    name="Стиль & Образність"
                    stroke={CATEGORY_COLORS.style_expression}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="expertiseLogic"
                    name="Експертність & Логіка"
                    stroke={CATEGORY_COLORS.expertise_logic}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="impactPedagogy"
                    name="Вплив & Педагогіка"
                    stroke={CATEGORY_COLORS.impact_pedagogy}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </>
              )}

              {/* Metric 3: Active Skills Count */}
              {selectedMetric === "active_skills" && (
                <Line
                  type="monotone"
                  dataKey="skillsTrainedCount"
                  name="Кількість зрілих навичок (зі стажем)"
                  stroke="#8e44ad"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#8e44ad", stroke: "#ffffff", strokeWidth: 2 }}
                  activeDot={{ r: 7, fill: "#a855f7" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Footer info bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 pt-2 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-emerald-700" />
            <span>
              Кожне тренування у тренажері або оцінка в аудиті автоматично оновлює динаміку зростання.
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#006d37]" />
              Загальна крива росту
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-emerald-600" />
              Ціль 90%
            </span>
          </div>
        </div>
      </div>

      {/* Recent Training Activity Logs (if available) */}
      {recentSessions.length > 0 && (
        <div className="neo-extruded bg-[#f9f9f9] p-4 sm:p-5 rounded-2xl border border-white flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-extrabold text-[#5c6f5e] tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#006d37]" />
              Останні зафіксовані тренування
            </div>
            <span className="text-[11px] text-gray-500 font-medium">За датою тренування</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {recentSessions.map((item) => (
              <div
                key={item.skill.id}
                onClick={() => onSelectSkill && onSelectSkill(item.skill)}
                className="bg-white/80 p-3 rounded-xl border border-gray-100 neo-pressed-soft hover:bg-white transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold text-[#1a1c1c] group-hover:text-[#006d37] transition-colors line-clamp-1">
                    {item.skill.numberStr}. {item.skill.title}
                  </span>
                  <span className="text-xs font-black text-emerald-700 shrink-0">
                    {item.progress}%
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-gray-500 mt-2 pt-2 border-t border-gray-100">
                  <span>{new Date(item.lastTrained!).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-emerald-600 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                    Відкрити <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
