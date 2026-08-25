import React, { useState } from "react";
import { SkillItem } from "../../types/mastery";
import { Sparkles, ArrowRight, Activity, TrendingUp, Info } from "lucide-react";

interface WheelOfMasteryProps {
  skills: SkillItem[];
  onSelectSkill: (skill: SkillItem) => void;
}

interface SectorConfig {
  id: number;
  title: string;
  shortTitle: string;
  color: string;
  iconType: string;
  angleStart: number;
  angleEnd: number;
  relatedSkillIds: number[];
  tagline: string;
}

const SECTORS: SectorConfig[] = [
  {
    id: 1,
    title: "Ідея та зміст",
    shortTitle: "ІДЕЯ ТА ЗМІСТ",
    color: "#006d37", // Green
    iconType: "lightbulb",
    angleStart: 340,
    angleEnd: 20,
    relatedSkillIds: [1, 9],
    tagline: "Чітка ідея, глибина теми та унікальний кут зору",
  },
  {
    id: 2,
    title: "Структура та композиція",
    shortTitle: "СТРУКТУРА ТА КОМПОЗИЦІЯ",
    color: "#006397", // Blue
    iconType: "network",
    angleStart: 20,
    angleEnd: 60,
    relatedSkillIds: [2, 5],
    tagline: "Логічна архітектура, баланс частин і кліфгенгери",
  },
  {
    id: 3,
    title: "Персонажі та взаємодія",
    shortTitle: "ПЕРСОНАЖІ ТА ВЗАЄМОДІЯ",
    color: "#6b21a8", // Purple
    iconType: "users",
    angleStart: 60,
    angleEnd: 100,
    relatedSkillIds: [3, 7],
    tagline: "Живі герої, внутрішні рани та переконливі діалоги",
  },
  {
    id: 4,
    title: "Стиль та виразність",
    shortTitle: "СТИЛЬ ТА ВИРАЗНІСТЬ",
    color: "#be123c", // Crimson
    iconType: "feather",
    angleStart: 100,
    angleEnd: 140,
    relatedSkillIds: [10, 11, 12],
    tagline: "Авторський голос, 5 органів чуття та музика темпу",
  },
  {
    id: 5,
    title: "Експертність та логіка",
    shortTitle: "ЕКСПЕРТНІСТЬ ТА ЛОГІКА",
    color: "#b45309", // Amber/Brown
    iconType: "scale",
    angleStart: 140,
    angleEnd: 180,
    relatedSkillIds: [13, 14],
    tagline: "Залізна аргументація, факти та глибоке дослідження",
  },
  {
    id: 6,
    title: "Редагування та якість",
    shortTitle: "РЕДАГУВАННЯ ТА ЯКІСТЬ",
    color: "#d97706", // Gold
    iconType: "edit",
    angleStart: 180,
    angleEnd: 220,
    relatedSkillIds: [15],
    tagline: "Усунення «води», точність слів та кришталева ясність",
  },
  {
    id: 7,
    title: "Авторська ідентичність",
    shortTitle: "АВТОРСЬКА ІДЕНТИЧНІСТЬ",
    color: "#0284c7", // Sky blue
    iconType: "star",
    angleStart: 220,
    angleEnd: 260,
    relatedSkillIds: [16, 18],
    tagline: "Особистий маніфест, щирість та довіра аудиторії",
  },
  {
    id: 8,
    title: "Практична цінність та педагогіка",
    shortTitle: "ПРАКТИЧНА ЦІННІСТЬ ТА ПЕДАГОГІКА",
    color: "#0d9488", // Teal
    iconType: "graduation",
    angleStart: 260,
    angleEnd: 300,
    relatedSkillIds: [6, 8],
    tagline: "Пояснення складного просто та результат для читача",
  },
  {
    id: 9,
    title: "Конфлікт та напруга",
    shortTitle: "КОНФЛІКТ ТА НАПРУГА",
    color: "#ea580c", // Orange
    iconType: "zap",
    angleStart: 300,
    angleEnd: 340,
    relatedSkillIds: [4, 17],
    tagline: "Внутрішня і зовнішня боротьба та ескалація ставок",
  },
];

// Helper to calculate SVG arc path
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(x: number, y: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
  // Normalize angles if crossing 0
  let normEnd = endAngle;
  if (normEnd <= startAngle) {
    normEnd += 360;
  }

  const startOuter = polarToCartesian(x, y, outerRadius, startAngle);
  const endOuter = polarToCartesian(x, y, outerRadius, normEnd);
  const startInner = polarToCartesian(x, y, innerRadius, startAngle);
  const endInner = polarToCartesian(x, y, innerRadius, normEnd);

  const largeArcFlag = normEnd - startAngle <= 180 ? "0" : "1";

  return [
    "M", startOuter.x, startOuter.y,
    "A", outerRadius, outerRadius, 0, largeArcFlag, 1, endOuter.x, endOuter.y,
    "L", endInner.x, endInner.y,
    "A", innerRadius, innerRadius, 0, largeArcFlag, 0, startInner.x, startInner.y,
    "Z"
  ].join(" ");
}

export const WheelOfMastery: React.FC<WheelOfMasteryProps> = ({
  skills,
  onSelectSkill,
}) => {
  const [selectedSectorId, setSelectedSectorId] = useState<number>(1);
  const [hoveredSectorId, setHoveredSectorId] = useState<number | null>(null);
  const [activeCurveType, setActiveCurveType] = useState<"standard" | "man_in_hole">("standard");

  const activeSector = SECTORS.find((s) => s.id === (hoveredSectorId || selectedSectorId)) || SECTORS[0];
  const relatedSkills = skills.filter((sk) => activeSector.relatedSkillIds.includes(sk.id));

  return (
    <section id="wheel" className="w-full py-8 flex flex-col items-center">
      {/* Section Header */}
      <div className="text-center max-w-3xl mb-8">
        <div className="inline-flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-3.5 py-1 rounded-full text-xs font-bold text-[#006d37] mb-3">
          <Activity className="w-3.5 h-3.5" />
          Центральна візуальна матриця
        </div>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#1a1c1c] tracking-tight">
          Кругова матриця 18 навичок
        </h2>
        <p className="text-sm sm:text-base text-[#3d4a3e] mt-2">
          Натискайте на сектори колеса або центральну емоційну дугу для дослідження взаємозв'язків компетенцій.
        </p>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* SVG Wheel Interactive Canvas */}
        <div className="lg:col-span-7 flex flex-col items-center justify-center relative">
          <div className="relative w-[340px] h-[340px] sm:w-[460px] sm:h-[460px] md:w-[500px] md:h-[500px] flex items-center justify-center select-none">
            {/* Outer Neomorphic Ring Shadow */}
            <div className="absolute inset-0 rounded-full neo-extruded bg-[#f9f9f9] -z-10" />

            <svg viewBox="0 0 500 500" className="w-full h-full transform transition-all duration-300">
              <defs>
                <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Background circular guide */}
              <circle cx="250" cy="250" r="235" fill="none" stroke="#e5e7eb" strokeWidth="2" />
              <circle cx="250" cy="250" r="145" fill="none" stroke="#e5e7eb" strokeWidth="2" />

              {/* 9 Wheel Sectors */}
              {SECTORS.map((sector) => {
                const isSelected = selectedSectorId === sector.id;
                const isHovered = hoveredSectorId === sector.id;
                const active = isSelected || isHovered;

                const pathD = describeArc(250, 250, 148, 230, sector.angleStart, sector.angleEnd);

                // Calculate center of sector arc for label placement
                const midAngle = (sector.angleStart + (sector.angleEnd < sector.angleStart ? sector.angleEnd + 360 : sector.angleEnd)) / 2;
                const labelPos = polarToCartesian(250, 250, 188, midAngle);

                return (
                  <g
                    key={sector.id}
                    className="cursor-pointer transition-all duration-200"
                    onMouseEnter={() => setHoveredSectorId(sector.id)}
                    onMouseLeave={() => setHoveredSectorId(null)}
                    onClick={() => setSelectedSectorId(sector.id)}
                  >
                    {/* Sector slice */}
                    <path
                      d={pathD}
                      fill={sector.color}
                      fillOpacity={active ? 0.95 : 0.78}
                      stroke="#ffffff"
                      strokeWidth={active ? "3" : "1.5"}
                      className="transition-all duration-200 hover:brightness-110"
                      style={{
                        filter: active ? "url(#softGlow)" : "none",
                        transformOrigin: "250px 250px",
                        transform: active ? "scale(1.02)" : "scale(1)",
                      }}
                    />

                    {/* Sector Text Label */}
                    <text
                      x={labelPos.x}
                      y={labelPos.y}
                      fill="#ffffff"
                      fontSize={midAngle > 90 && midAngle < 270 ? "9.5" : "10"}
                      fontWeight="bold"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="pointer-events-none drop-shadow-sm font-['Manrope']"
                      transform={`rotate(${midAngle > 90 && midAngle < 270 ? midAngle + 180 : midAngle}, ${labelPos.x}, ${labelPos.y})`}
                    >
                      {sector.shortTitle}
                    </text>
                  </g>
                );
              })}

              {/* Center Circle: Emotional Arc Graph */}
              <g
                className="cursor-pointer group"
                onClick={() => setActiveCurveType(activeCurveType === "standard" ? "man_in_hole" : "standard")}
              >
                {/* Center background disk */}
                <circle
                  cx="250"
                  cy="250"
                  r="140"
                  fill="#f9f9f9"
                  stroke="#ffffff"
                  strokeWidth="4"
                  className="neo-pressed-soft shadow-inner"
                />

                {/* Grid lines inside center */}
                <line x1="140" y1="250" x2="360" y2="250" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 3" />
                <line x1="250" y1="140" x2="250" y2="360" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4 3" />

                {/* Curve labels */}
                <text x="250" y="165" fill="#006d37" fontSize="11" fontWeight="800" textAnchor="middle" className="font-['Manrope']">
                  Емоції та підйом
                </text>
                <text x="350" y="246" fill="#94a3b8" fontSize="8" fontWeight="600" textAnchor="end">
                  нейтральні
                </text>
                <text x="145" y="180" fill="#059669" fontSize="8" fontWeight="600">
                  +10 (радість)
                </text>
                <text x="145" y="325" fill="#e11d48" fontSize="8" fontWeight="600">
                  -10 (криза)
                </text>

                {/* Emotional Arc U-Curve / W-Curve Path */}
                {activeCurveType === "standard" ? (
                  // Classic U-Curve (Man in a Hole)
                  <path
                    d="M 155,185 C 190,190 205,315 250,320 C 295,315 310,190 345,185"
                    fill="none"
                    stroke="#006397"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                ) : (
                  // W-Curve Double Climax
                  <path
                    d="M 155,200 C 180,270 200,280 220,220 C 240,180 260,330 290,325 C 320,310 335,190 345,180"
                    fill="none"
                    stroke="#ea580c"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                )}

                {/* Dots along chapters */}
                <circle cx="155" cy={activeCurveType === "standard" ? "185" : "200"} r="4" fill="#006d37" />
                <circle cx="250" cy={activeCurveType === "standard" ? "320" : "250"} r="5" fill="#e11d48" />
                <circle cx="345" cy={activeCurveType === "standard" ? "185" : "180"} r="4" fill="#006397" />

                {/* Chapter Axis */}
                <g className="text-[7px] fill-slate-500 font-semibold">
                  <text x="160" y="260">1</text>
                  <text x="180" y="260">2</text>
                  <text x="200" y="260">3</text>
                  <text x="220" y="260">4</text>
                  <text x="240" y="260">5</text>
                  <text x="260" y="260">6</text>
                  <text x="280" y="260">7</text>
                  <text x="300" y="260">8</text>
                  <text x="320" y="260">9</text>
                  <text x="340" y="260">10</text>
                  <text x="250" y="348" textAnchor="middle" fill="#64748b" fontSize="8" fontWeight="bold">
                    Глави твору (Крива спадів і підйомів)
                  </text>
                </g>
              </g>
            </svg>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#5c6f5e]">
            <Info className="w-4 h-4 text-emerald-600" />
            <span>Натисніть на центр, щоб змінити форму дуги (U-подібна / W-подібна)</span>
          </div>
        </div>

        {/* Dynamic Sector Insight & Skills Cards */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="neo-extruded bg-[#f9f9f9] p-6 rounded-3xl border border-white">
            {/* Sector Header */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: activeSector.color }}
                />
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#6c7b6d]">
                  Сектор #{activeSector.id} з 9
                </span>
              </div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full neo-pressed bg-[#f4f3f3] text-[#1a1c1c]">
                {relatedSkills.length} навички
              </span>
            </div>

            <h3 className="text-xl font-extrabold text-[#1a1c1c] mb-1">
              {activeSector.title}
            </h3>
            <p className="text-xs sm:text-sm text-[#3d4a3e] font-medium leading-relaxed mb-4">
              {activeSector.tagline}
            </p>

            {/* List of related skills inside this sector */}
            <div className="flex flex-col gap-2.5 mb-5">
              <div className="text-xs font-bold text-[#6c7b6d] uppercase tracking-wide">
                Навички в цьому секторі:
              </div>
              {relatedSkills.map((skill) => (
                <div
                  key={skill.id}
                  onClick={() => onSelectSkill(skill)}
                  className="neo-pressed-soft hover:neo-extruded bg-[#f9f9f9] p-3.5 rounded-2xl flex items-center justify-between cursor-pointer group transition-all"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded-lg bg-white neo-pressed text-[#1a1c1c]">
                      {skill.numberStr}
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-[#1a1c1c] group-hover:text-[#006d37] transition-colors">
                        {skill.title}
                      </h4>
                      <p className="text-[11px] text-[#6c7b6d] line-clamp-1">
                        {skill.subSkills.slice(0, 2).join(" • ")}
                      </p>
                    </div>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-[#006d37] group-hover:translate-x-1 transition-transform">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Sector CTA */}
            {relatedSkills[0] && (
              <button
                onClick={() => onSelectSkill(relatedSkills[0])}
                className="w-full neo-extruded neo-button-interactive bg-[#006d37] text-white py-3 rounded-full text-xs font-bold flex items-center justify-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                <span>Відкрити тренажер для {relatedSkills[0].title}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
