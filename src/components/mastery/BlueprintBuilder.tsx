import React, { useState } from "react";
import { useWriterBook } from "../../context/WriterBookContext";
import {
  X,
  FileText,
  Sparkles,
  BookOpen,
  GraduationCap,
  Download,
  Copy,
  Check,
  Loader2,
  Layers,
  Feather,
} from "lucide-react";

interface BlueprintBuilderProps {
  onClose: () => void;
}

export const BlueprintBuilder: React.FC<BlueprintBuilderProps> = ({ onClose }) => {
  const { bookContext } = useWriterBook();
  const [projectType, setProjectType] = useState<"book" | "course">("book");
  const [topic, setTopic] = useState<string>("");
  const [targetAudience, setTargetAudience] = useState<string>("");
  const [format, setFormat] = useState<string>("Нон-фікшн керівництво з практикою");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [blueprintResult, setBlueprintResult] = useState<any | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const handleFillFromMyBook = () => {
    setProjectType("book");
    setTopic(`${bookContext.bookTitle} — ${bookContext.bookIdea}`);
    if (bookContext.genre) {
      setFormat(bookContext.genre);
    }
  };

  const handleGenerateBlueprint = async () => {
    if (!topic.trim()) return;

    setIsGenerating(true);
    try {
      const response = await fetch("/api/ai/generate-blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectType,
          topic,
          targetAudience: targetAudience || "Широка аудиторія фахівців та читачів",
          format,
        }),
      });

      const data = await response.json();
      setBlueprintResult(data);
    } catch (e) {
      console.error("Failed to generate blueprint:", e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!blueprintResult) return;
    const text = `# ${blueprintResult.projectTitle}\n\n${blueprintResult.synopsis}\n\n## Цільова аудиторія\n${blueprintResult.targetAudience}\n\n## Структура розділів:\n${blueprintResult.structure?.map((s: any) => `### ${s.chapter}: ${s.title}\n- **Фокус навичок**: ${s.skillFocus}\n- **Зміст**: ${s.summary}\n- **Практика**: ${s.exercise}`).join("\n\n")}\n\n## Педагогічні артефакти:\n${blueprintResult.pedagogicalArtifacts?.join("\n- ")}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#f9f9f9] neo-extruded-lg w-full max-w-4xl max-h-[92vh] rounded-3xl flex flex-col overflow-hidden border border-white relative">
        {/* Modal Top */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-[#f9f9f9]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl neo-pressed bg-[#f9f9f9] flex items-center justify-center text-[#006397]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#1a1c1c]">
                Генератор Blueprint проекту на основі 18 навичок
              </h2>
              <p className="text-xs text-[#6c7b6d]">
                Архітектура книги або онлайн-курсу з інтегрованими компетенціями
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

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-grow flex flex-col gap-6">
          {/* Configuration Form */}
          <div className="neo-extruded bg-[#f9f9f9] p-6 rounded-3xl border border-white flex flex-col gap-4">
            {bookContext.bookIdea && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                <div className="text-xs text-emerald-900 font-semibold flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Поточний рукопис у роботі: <strong>«{bookContext.bookTitle}»</strong> ({bookContext.genre || 'художній'})</span>
                </div>
                <button
                  type="button"
                  onClick={handleFillFromMyBook}
                  className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Заповнити моєю книгою</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Type toggle */}
              <div>
                <label className="text-xs font-extrabold text-[#1a1c1c] uppercase block mb-1.5">
                  Тип проекту
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setProjectType("book")}
                    className={`py-2.5 px-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      projectType === "book"
                        ? "neo-pressed bg-[#006d37] text-white"
                        : "neo-extruded-soft bg-[#f9f9f9] text-[#1a1c1c]"
                    }`}
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Книга / Повість</span>
                  </button>

                  <button
                    onClick={() => setProjectType("course")}
                    className={`py-2.5 px-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      projectType === "course"
                        ? "neo-pressed bg-[#006397] text-white"
                        : "neo-extruded-soft bg-[#f9f9f9] text-[#1a1c1c]"
                    }`}
                  >
                    <GraduationCap className="w-4 h-4" />
                    <span>Навчальний курс</span>
                  </button>
                </div>
              </div>

              {/* Format input */}
              <div>
                <label className="text-xs font-extrabold text-[#1a1c1c] uppercase block mb-1.5">
                  Формат і жанр
                </label>
                <input
                  type="text"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  placeholder="Наприклад: Практичний нон-фікшн з вправами, або Роман-трилер"
                  className="w-full p-2.5 rounded-2xl neo-pressed bg-[#f9f9f9] text-xs font-medium text-[#1a1c1c] focus:outline-none focus:ring-2 focus:ring-[#006d37]/40"
                />
              </div>
            </div>

            {/* Topic & Audience */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-extrabold text-[#1a1c1c] uppercase block mb-1.5">
                  Тема твору або курсу *
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Наприклад: Мистецтво самодисципліни та фокусу для творців"
                  className="w-full p-2.5 rounded-2xl neo-pressed bg-[#f9f9f9] text-xs font-medium text-[#1a1c1c] focus:outline-none focus:ring-2 focus:ring-[#006d37]/40"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-[#1a1c1c] uppercase block mb-1.5">
                  Цільова аудиторія
                </label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="Наприклад: Підприємці, письменники, студенти"
                  className="w-full p-2.5 rounded-2xl neo-pressed bg-[#f9f9f9] text-xs font-medium text-[#1a1c1c] focus:outline-none focus:ring-2 focus:ring-[#006d37]/40"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={handleGenerateBlueprint}
                disabled={isGenerating || !topic.trim()}
                className="neo-extruded neo-button-interactive bg-[#006d37] hover:bg-[#005a2d] text-white px-6 py-3 rounded-full text-xs font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-md"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>AI проектує структуру за 18 навичками...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-emerald-200" />
                    <span>Скласти повний план проекту</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Generated Result Display */}
          {blueprintResult && (
            <div className="neo-extruded bg-white p-6 rounded-3xl border border-emerald-200 flex flex-col gap-6 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                <div>
                  <span className="text-[10px] font-extrabold text-[#006d37] uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100">
                    Згенерований план
                  </span>
                  <h3 className="text-xl font-extrabold text-[#1a1c1c] mt-1">
                    {blueprintResult.projectTitle}
                  </h3>
                  <p className="text-xs text-[#6c7b6d] mt-0.5">
                    {blueprintResult.synopsis}
                  </p>
                </div>

                <button
                  onClick={handleCopyMarkdown}
                  className="neo-extruded-soft neo-button-interactive bg-[#f9f9f9] px-4 py-2 rounded-full text-xs font-bold text-[#1a1c1c] flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? "Скопійовано!" : "Скопіювати Markdown"}</span>
                </button>
              </div>

              {/* Chapters list */}
              <div className="flex flex-col gap-3">
                <div className="text-xs font-extrabold text-[#1a1c1c] uppercase tracking-wide">
                  Структура розділів та розподіл навичок:
                </div>

                <div className="flex flex-col gap-3">
                  {blueprintResult.structure?.map((chap: any, idx: number) => (
                    <div key={idx} className="neo-pressed-soft bg-[#f9f9f9] p-4 rounded-2xl flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-xs px-2 py-0.5 rounded-lg bg-[#006d37] text-white">
                            {chap.chapter}
                          </span>
                          <h4 className="text-sm font-bold text-[#1a1c1c]">
                            {chap.title}
                          </h4>
                        </div>
                        <span className="text-[11px] font-bold text-[#006397] bg-sky-50 px-2 py-0.5 rounded-full">
                          🎯 {chap.skillFocus}
                        </span>
                      </div>

                      <p className="text-xs text-[#3d4a3e] leading-relaxed">
                        {chap.summary}
                      </p>

                      {chap.exercise && (
                        <div className="text-[11px] text-[#006d37] font-semibold bg-emerald-50 p-2 rounded-xl">
                          ✍️ Практична вправа: {chap.exercise}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Pedagogical Artifacts */}
              {blueprintResult.pedagogicalArtifacts && (
                <div className="neo-pressed-soft bg-gray-50 p-4 rounded-2xl flex flex-col gap-2">
                  <div className="text-xs font-extrabold text-[#1a1c1c] uppercase">
                    Практичні чеклісти та артефакти:
                  </div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {blueprintResult.pedagogicalArtifacts.map((art: string, i: number) => (
                      <li key={i} className="text-xs text-gray-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#006397]" />
                        <span>{art}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
