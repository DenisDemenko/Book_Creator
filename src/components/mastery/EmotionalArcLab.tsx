import React, { useState } from "react";
import { EmotionalArcPoint } from "../../types/mastery";
import { useWriterBook } from "../../context/WriterBookContext";
import { Sparkles, TrendingUp, RefreshCw, Loader2, BookOpen, AlertCircle, Info, Feather } from "lucide-react";

const DEFAULT_POINTS: EmotionalArcPoint[] = [
  { chapter: 1, title: "Звичний світ та поклик", score: 4, tension: 20, note: "Старт, цікавість, знайомство" },
  { chapter: 2, title: "Перша перешкода", score: 2, tension: 35, note: "Вихід із зони комфорту" },
  { chapter: 3, title: "Ускладнення та пастка", score: -2, tension: 50, note: "Зростання ставок" },
  { chapter: 4, title: "Точка неповернення", score: -5, tension: 65, note: "Вибір без права на відступ" },
  { chapter: 5, title: "Темна ніч душі (Дно кризи)", score: -9, tension: 95, note: "Найглибша емоційна яма" },
  { chapter: 6, title: "Внутрішнє прозріння", score: -1, tension: 80, note: "Переосмислення істини" },
  { chapter: 7, title: "Кульмінаційна битва / Рішення", score: 6, tension: 90, note: "Прорив крізь спротив" },
  { chapter: 8, title: "Катарсис та новий баланс", score: 9, tension: 30, note: "Тріумф, трансформація, післясмак" },
];

export const EmotionalArcLab: React.FC = () => {
  const { bookContext } = useWriterBook();
  const [points, setPoints] = useState<EmotionalArcPoint[]>(DEFAULT_POINTS);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number>(4);
  const [userOutline, setUserOutline] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<any | null>(null);

  // Apply arc presets
  const applyPreset = (type: "hole" | "cinderella" | "nonfiction" | "tragedy") => {
    if (type === "hole") {
      setPoints([
        { chapter: 1, title: "Комфортний старт", score: 3, tension: 20, note: "Герой у безпеці" },
        { chapter: 2, title: "Виклик", score: 1, tension: 40, note: "Перші труднощі" },
        { chapter: 3, title: "Падіння в яму", score: -4, tension: 65, note: "Втрата контролю" },
        { chapter: 4, title: "Дно ями (Криза)", score: -9, tension: 95, note: "Все здається втраченим" },
        { chapter: 5, title: "Пошук виходу", score: -3, tension: 80, note: "Нова стратегія" },
        { chapter: 6, title: "Сходження", score: 4, tension: 85, note: "Боротьба за життя" },
        { chapter: 7, title: "Тріумф", score: 8, tension: 40, note: "Краще, ніж було на початку" },
      ]);
    } else if (type === "cinderella") {
      setPoints([
        { chapter: 1, title: "Злидні та приниження", score: -6, tension: 30, note: "Героїня на дні" },
        { chapter: 2, title: "Диво / Бал", score: 8, tension: 60, note: "Ейфорія та щастя" },
        { chapter: 3, title: "Опівнічний удар", score: -8, tension: 95, note: "Втрата всього, відчай" },
        { chapter: 4, title: "Пошук черевика", score: -2, tension: 80, note: "Напружене очікування" },
        { chapter: 5, title: "Вічне визнання", score: 10, tension: 20, note: "Абсолютний хепі-енд" },
      ]);
    } else if (type === "nonfiction") {
      setPoints([
        { chapter: 1, title: "Анатомія болю", score: -4, tension: 30, note: "Чому стара система не працює" },
        { chapter: 2, title: "Помилкові рішення", score: -7, tension: 50, note: "Пастки типових порад" },
        { chapter: 3, title: "Новий фреймворк", score: 2, tension: 40, note: "Перший промінь надії" },
        { chapter: 4, title: "Практика та труднощі", score: -1, tension: 60, note: "Опір звичок" },
        { chapter: 5, title: "Системний прорив", score: 7, tension: 70, note: "Перші стабільні результати" },
        { chapter: 6, title: "Майстерність на все життя", score: 9, tension: 20, note: "Трансформація світогляду" },
      ]);
    } else if (type === "tragedy") {
      setPoints([
        { chapter: 1, title: "Сходження та амбіції", score: 5, tension: 30, note: "Герой на піку сили" },
        { chapter: 2, title: "Гординя та сліпота", score: 7, tension: 50, note: "Зневага до попереджень" },
        { chapter: 3, title: "Фатальна помилка", score: 0, tension: 75, note: "Тріщина в системі" },
        { chapter: 4, title: "Руйнація світу", score: -6, tension: 90, note: "Наслідки вибору" },
        { chapter: 5, title: "Катастрофа", score: -10, tension: 100, note: "Повне падіння та розплата" },
      ]);
    }
    setSelectedPointIndex(0);
  };

  // Call AI to analyze user synopsis
  const handleAnalyzeStoryOutline = async () => {
    if (!userOutline.trim()) return;

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze-emotional-arc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyOutline: userOutline, chaptersCount: 8 }),
      });
      const data = await res.json();
      if (data.chapters && data.chapters.length > 0) {
        setPoints(data.chapters);
        setAiAnalysisResult(data);
        setSelectedPointIndex(0);
      }
    } catch (e) {
      console.error("Failed to analyze emotional arc:", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Convert points to SVG path coordinates
  const svgWidth = 700;
  const svgHeight = 320;
  const paddingX = 60;
  const paddingY = 40;

  const pointsCoords = points.map((p, idx) => {
    const x = paddingX + (idx / (points.length - 1)) * (svgWidth - 2 * paddingX);
    // score is -10 to +10 -> y mapped from height-paddingY down to paddingY
    const normalizedScore = (p.score + 10) / 20; // 0 to 1
    const y = svgHeight - paddingY - normalizedScore * (svgHeight - 2 * paddingY);
    return { x, y, point: p, index: idx };
  });

  // Build smooth bezier curve
  let curvePath = "";
  if (pointsCoords.length > 0) {
    curvePath = `M ${pointsCoords[0].x},${pointsCoords[0].y}`;
    for (let i = 0; i < pointsCoords.length - 1; i++) {
      const p0 = pointsCoords[i];
      const p1 = pointsCoords[i + 1];
      const cpX1 = p0.x + (p1.x - p0.x) / 2;
      const cpY1 = p0.y;
      const cpX2 = p0.x + (p1.x - p0.x) / 2;
      const cpY2 = p1.y;
      curvePath += ` C ${cpX1},${cpY1} ${cpX2},${cpY2} ${p1.x},${p1.y}`;
    }
  }

  const selectedPt = points[selectedPointIndex] || points[0];

  return (
    <section id="arc" className="w-full py-10 flex flex-col gap-8">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 neo-pressed bg-[#f9f9f9] px-3.5 py-1 rounded-full text-xs font-bold text-[#006d37] mb-3">
          <TrendingUp className="w-3.5 h-3.5" />
          Інтерактивна лабораторія емоційного ритму
        </div>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#1a1c1c] tracking-tight">
          Архітектура емоційної дуги книги
        </h2>
        <p className="text-sm sm:text-base text-[#3d4a3e] mt-2">
          Побудуйте хвилі підйомів та спадів за розділами вашого рукопису, щоб утримувати читача в напрузі до останньої крапки.
        </p>
      </div>

      {/* Main Graph Card */}
      <div className="w-full max-w-5xl mx-auto neo-extruded bg-[#f9f9f9] p-6 sm:p-8 rounded-3xl border border-white flex flex-col gap-6">
        {/* Presets Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-200/80">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-xs font-bold text-[#6c7b6d] mr-1">Архетипи дуг:</span>
            <button
              onClick={() => applyPreset("hole")}
              className="neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#006d37] px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            >
              Людина в ямі (Курт Воннегут)
            </button>
            <button
              onClick={() => applyPreset("cinderella")}
              className="neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#6b21a8] px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            >
              Попелюшка (Зліт і падіння)
            </button>
            <button
              onClick={() => applyPreset("nonfiction")}
              className="neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#006397] px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            >
              Нон-фікшн Трансформація
            </button>
            <button
              onClick={() => applyPreset("tragedy")}
              className="neo-extruded-soft hover:neo-extruded bg-[#f9f9f9] text-[#be123c] px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            >
              Трагедія (Розплата)
            </button>
          </div>
        </div>

        {/* SVG Interactive Canvas */}
        <div className="w-full overflow-x-auto">
          <div className="min-w-[620px] relative neo-pressed bg-[#f9f9f9] rounded-2xl p-4">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto">
              {/* Grid Lines */}
              {/* Zero baseline (Neutral 0) */}
              <line
                x1={paddingX}
                y1={svgHeight / 2}
                x2={svgWidth - paddingX}
                y2={svgHeight / 2}
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />
              <text x={svgWidth - paddingX + 8} y={svgHeight / 2 + 4} fill="#64748b" fontSize="10" fontWeight="bold">
                0 (Нейтрально)
              </text>

              {/* +10 Line */}
              <line
                x1={paddingX}
                y1={paddingY}
                x2={svgWidth - paddingX}
                y2={paddingY}
                stroke="#d1fae5"
                strokeWidth="1"
              />
              <text x={paddingX - 10} y={paddingY + 4} textAnchor="end" fill="#059669" fontSize="10" fontWeight="bold">
                +10 (Ейфорія)
              </text>

              {/* -10 Line */}
              <line
                x1={paddingX}
                y1={svgHeight - paddingY}
                x2={svgWidth - paddingX}
                y2={svgHeight - paddingY}
                stroke="#ffe4e6"
                strokeWidth="1"
              />
              <text x={paddingX - 10} y={svgHeight - paddingY + 4} textAnchor="end" fill="#e11d48" fontSize="10" fontWeight="bold">
                -10 (Криза)
              </text>

              {/* Shaded Area Under Curve */}
              <path
                d={`${curvePath} L ${pointsCoords[pointsCoords.length - 1].x},${svgHeight / 2} L ${pointsCoords[0].x},${svgHeight / 2} Z`}
                fill="#006d37"
                fillOpacity="0.08"
              />

              {/* Smooth Emotional Curve Line */}
              <path
                d={curvePath}
                fill="none"
                stroke="#006d37"
                strokeWidth="4"
                strokeLinecap="round"
                className="drop-shadow-sm"
              />

              {/* Chapter Nodes Interactive Circles */}
              {pointsCoords.map(({ x, y, point, index }) => {
                const isSelected = selectedPointIndex === index;
                const isPositive = point.score >= 0;

                return (
                  <g
                    key={index}
                    onClick={() => setSelectedPointIndex(index)}
                    className="cursor-pointer group"
                  >
                    {/* Outer glow on select */}
                    {isSelected && (
                      <circle
                        cx={x}
                        cy={y}
                        r="14"
                        fill={isPositive ? "#006d37" : "#e11d48"}
                        fillOpacity="0.25"
                      />
                    )}

                    {/* Main Node Point */}
                    <circle
                      cx={x}
                      cy={y}
                      r={isSelected ? "8" : "6"}
                      fill={isPositive ? "#006d37" : "#e11d48"}
                      stroke="#ffffff"
                      strokeWidth="2.5"
                      className="transition-transform group-hover:scale-125"
                    />

                    {/* Chapter Label below */}
                    <text
                      x={x}
                      y={svgHeight - 12}
                      textAnchor="middle"
                      fill={isSelected ? "#006d37" : "#64748b"}
                      fontSize={isSelected ? "11" : "9"}
                      fontWeight={isSelected ? "800" : "600"}
                    >
                      Гл. {point.chapter}
                    </text>

                    {/* Score value above node */}
                    <text
                      x={x}
                      y={y - 12}
                      textAnchor="middle"
                      fill={isPositive ? "#006d37" : "#e11d48"}
                      fontSize="9"
                      fontWeight="bold"
                    >
                      {point.score > 0 ? `+${point.score}` : point.score}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Selected Chapter Details & Adjuster */}
        {selectedPt && (
          <div className="neo-pressed-soft bg-[#f4f3f3] p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white font-extrabold text-sm ${
                selectedPt.score >= 0 ? "bg-[#006d37]" : "bg-rose-600"
              }`}>
                #{selectedPt.chapter}
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-[#1a1c1c]">
                  Глава {selectedPt.chapter}: {selectedPt.title}
                </h4>
                <p className="text-xs text-[#6c7b6d] mt-0.5">
                  {selectedPt.note}
                </p>
              </div>
            </div>

            {/* Quick score tuner */}
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <span className="text-xs font-bold text-[#6c7b6d]">Емоційний заряд:</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const newPts = [...points];
                    newPts[selectedPointIndex].score = Math.max(-10, newPts[selectedPointIndex].score - 1);
                    setPoints(newPts);
                  }}
                  className="w-7 h-7 rounded-full neo-extruded bg-[#f9f9f9] flex items-center justify-center font-bold text-xs"
                >
                  -
                </button>
                <span className={`text-sm font-extrabold px-2 ${
                  selectedPt.score >= 0 ? "text-[#006d37]" : "text-rose-600"
                }`}>
                  {selectedPt.score > 0 ? `+${selectedPt.score}` : selectedPt.score}
                </span>
                <button
                  onClick={() => {
                    const newPts = [...points];
                    newPts[selectedPointIndex].score = Math.min(10, newPts[selectedPointIndex].score + 1);
                    setPoints(newPts);
                  }}
                  className="w-7 h-7 rounded-full neo-extruded bg-[#f9f9f9] flex items-center justify-center font-bold text-xs"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI Synopsis Analyzer Section */}
        <div className="pt-4 border-t border-gray-200/80 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-extrabold text-[#1a1c1c] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              Побудувати емоційну дугу вашого рукопису через AI
            </h4>
            
            {bookContext.bookIdea && (
              <button
                type="button"
                onClick={() => setUserOutline(`Книга: «${bookContext.bookTitle}» (Жанр: ${bookContext.genre || 'художня література'}). Ідея та зав'язка: ${bookContext.bookIdea}`)}
                className="text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Feather className="w-3.5 h-3.5 text-emerald-600" />
                <span>Завантажити ідею «{bookContext.bookTitle}»</span>
              </button>
            )}
          </div>

          <textarea
            value={userOutline}
            onChange={(e) => setUserOutline(e.target.value)}
            placeholder="Опишіть коротко сюжет вашої книги або тему розділів: наприклад, «Розділ 1: Герой втрачає роботу і розлучається. Розділ 2: Знаходить дивний щоденник...»"
            rows={3}
            className="w-full p-3.5 rounded-2xl neo-pressed bg-[#f9f9f9] text-xs sm:text-sm text-[#1a1c1c] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#006d37]/50 border-none"
          />

          <div className="flex justify-end">
            <button
              onClick={handleAnalyzeStoryOutline}
              disabled={isAnalyzing || !userOutline.trim()}
              className="neo-extruded neo-button-interactive bg-[#006d37] hover:bg-[#005a2d] text-white px-5 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>AI розраховує криву напруги...</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 text-emerald-200" />
                  <span>Згенерувати графік для моєї книги</span>
                </>
              )}
            </button>
          </div>

          {aiAnalysisResult && (
            <div className="neo-extruded bg-white p-5 rounded-2xl border border-emerald-200 mt-2 flex flex-col gap-2 animate-in fade-in">
              <div className="text-xs font-bold text-emerald-800 uppercase">
                Аналіз драматургічного темпу: {aiAnalysisResult.arcName}
              </div>
              <p className="text-xs text-[#1a1c1c] leading-relaxed">
                {aiAnalysisResult.description}
              </p>
              <div className="text-xs text-[#006397] font-semibold">
                📊 {aiAnalysisResult.pacingAssessment}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
