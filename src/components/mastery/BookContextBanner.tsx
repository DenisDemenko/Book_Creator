import React, { useState, useEffect } from "react";
import { useWriterBook } from "../../context/WriterBookContext";
import {
  BookMarked,
  Sparkles,
  Edit3,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  RotateCcw,
  BookOpen,
  Feather,
  Coffee,
  HelpCircle,
  ListTree,
  FileText,
  MousePointerClick,
} from "lucide-react";

interface BookContextBannerProps {
  onInsertText?: (text: string, source: "lastParagraph" | "bookIdea" | "chapterExcerpt") => void;
  compact?: boolean;
}

export const BookContextBanner: React.FC<BookContextBannerProps> = ({
  onInsertText,
  compact = false,
}) => {
  const { bookContext, updateBookContext, resetToDefaultBookContext, bookExcerpts, chapters, getSectionsForChapter, activeExcerptId, setActiveExcerpt } = useWriterBook();
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Chapter / section picker state for training texts from the real book
  const [pickerChapterId, setPickerChapterId] = useState<string>("");
  const [pickerSectionId, setPickerSectionId] = useState<string>("");

  // Derive current chapter & section options
  const activeExcerpt = bookExcerpts.find((e) => e.id === activeExcerptId) || null;
  const pickerSections = pickerChapterId ? getSectionsForChapter(pickerChapterId) : [];
  const pickerSection = pickerSections.find((s) => s.id === pickerSectionId) || null;

  // Sync picker state with the active excerpt from context
  useEffect(() => {
    if (activeExcerpt) {
      setPickerChapterId(activeExcerpt.chapterId);
      setPickerSectionId(activeExcerpt.sectionId);
    } else if (chapters.length > 0) {
      setPickerChapterId(chapters[0].id);
      setPickerSectionId("");
    }
  }, [activeExcerptId, bookExcerpts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Form state for inline editing
  const [tempTitle, setTempTitle] = useState(bookContext.bookTitle);
  const [tempGenre, setTempGenre] = useState(bookContext.genre);
  const [tempIdea, setTempIdea] = useState(bookContext.bookIdea);
  const [tempParagraph, setTempParagraph] = useState(bookContext.lastParagraph);
  const [tempProtagonist, setTempProtagonist] = useState(bookContext.protagonist);

  const handleStartEdit = () => {
    setTempTitle(bookContext.bookTitle);
    setTempGenre(bookContext.genre);
    setTempIdea(bookContext.bookIdea);
    setTempParagraph(bookContext.lastParagraph);
    setTempProtagonist(bookContext.protagonist);
    setIsEditing(true);
    setIsExpanded(true);
  };

  const handleSave = () => {
    updateBookContext({
      bookTitle: tempTitle,
      genre: tempGenre,
      bookIdea: tempIdea,
      lastParagraph: tempParagraph,
      protagonist: tempProtagonist,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="neo-extruded bg-gradient-to-br from-[#f8faf8] via-[#fdfefe] to-[#f4f7f4] p-4 sm:p-5 rounded-3xl border border-emerald-200/80 shadow-sm flex flex-col gap-3.5 transition-all">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-600/10 text-[#006d37] neo-pressed-soft flex items-center justify-center">
            <BookMarked className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-extrabold text-[#1a1c1c] tracking-tight">
                Контекст вашої книги
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100/80 text-emerald-800 flex items-center gap-1">
                <Coffee className="w-2.5 h-2.5 text-emerald-600" />
                <span>Відпочинок & Практика</span>
              </span>
            </div>
            <p className="text-[11px] text-[#556956] font-medium hidden sm:block">
              Всі тренажери адаптуються під ваш реальний рукопис для саморозвитку під час написання книги.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!isEditing ? (
            <button
              onClick={handleStartEdit}
              className="neo-extruded-soft neo-button-interactive bg-white hover:bg-emerald-50/50 text-[#006d37] px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border border-emerald-100 shadow-xs cursor-pointer"
              title="Редагувати дані та уривок вашої книги"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Змінити книгу / уривок</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCancel}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 cursor-pointer"
              >
                Скасувати
              </button>
              <button
                onClick={handleSave}
                className="neo-extruded-soft neo-button-interactive bg-[#006d37] text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Зберегти</span>
              </button>
            </div>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100 neo-pressed-soft transition-colors cursor-pointer"
            title={isExpanded ? "Згорнути панель" : "Розгорнути панель"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div className="flex flex-col gap-3 pt-1 border-t border-emerald-100/80 animate-in fade-in duration-200">
          {!isEditing ? (
            <>
              {/* Meta row: Book Title & Genre */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black text-[#1a1c1c] bg-white px-2.5 py-1 rounded-lg border border-emerald-100 neo-pressed-soft">
                  📖 {bookContext.bookTitle}
                </span>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/60">
                  🎭 {bookContext.genre}
                </span>
                {bookContext.protagonist && (
                  <span className="text-[11px] font-medium text-gray-600 bg-gray-100/70 px-2.5 py-1 rounded-lg">
                    👤 {bookContext.protagonist}
                  </span>
                )}
              </div>

              {/* 2-Column Grid: Book Idea + Last Paragraph */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                {/* 1. Book Premise / Idea */}
                <div className="bg-white/90 p-3.5 rounded-2xl border border-gray-100 neo-pressed-soft flex flex-col justify-between gap-2 group hover:border-emerald-200 transition-all">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] uppercase tracking-wider font-extrabold text-[#006d37] flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        Головна ідея / Синопсис
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {bookContext.bookIdea.length} симв.
                      </span>
                    </div>
                    <p className="text-xs text-[#2c382d] leading-relaxed line-clamp-3">
                      {bookContext.bookIdea}
                    </p>
                  </div>

                  {/* Insert CTA button */}
                  {onInsertText && (
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-1">
                      <button
                        onClick={() => onInsertText(bookContext.bookIdea, "bookIdea")}
                        className="text-[11px] font-extrabold text-[#006d37] hover:text-[#005a2d] hover:underline flex items-center gap-1 cursor-pointer"
                        title="Вставити цю ідею в робоче поле вправи"
                      >
                        <Feather className="w-3 h-3 text-emerald-600" />
                        <span>Вставити ідею в тренажер</span>
                      </button>

                      <button
                        onClick={() => handleCopy(bookContext.bookIdea, "idea")}
                        className="text-gray-400 hover:text-gray-700 text-[10px] flex items-center gap-0.5 cursor-pointer"
                        title="Копіювати"
                      >
                        {copiedKey === "idea" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === "idea" ? "Скопійовано" : "Копія"}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Last Paragraph / WIP Excerpt */}
                <div className="bg-white/90 p-3.5 rounded-2xl border border-gray-100 neo-pressed-soft flex flex-col justify-between gap-2 group hover:border-emerald-200 transition-all">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] uppercase tracking-wider font-extrabold text-[#006397] flex items-center gap-1">
                        <BookOpen className="w-3 h-3 text-sky-500" />
                        Останній абзац першої глави / сцени
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {bookContext.lastParagraph.split(/\s+/).length} слів
                      </span>
                    </div>
                    <p className="text-xs text-[#2c382d] leading-relaxed italic line-clamp-3 font-serif">
                      «{bookContext.lastParagraph}»
                    </p>
                  </div>

                  {/* Insert CTA button */}
                  {onInsertText && (
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-1">
                      <button
                        onClick={() => onInsertText(bookContext.lastParagraph, "lastParagraph")}
                        className="text-[11px] font-extrabold text-[#006397] hover:text-[#004e77] hover:underline flex items-center gap-1 cursor-pointer"
                        title="Вставити цей уривок у поле вправи для вдосконалення"
                      >
                        <Feather className="w-3 h-3 text-sky-600" />
                        <span>Вставити уривок для опрацювання</span>
                      </button>

                      <button
                        onClick={() => handleCopy(bookContext.lastParagraph, "paragraph")}
                        className="text-gray-400 hover:text-gray-700 text-[10px] flex items-center gap-0.5 cursor-pointer"
                        title="Копіювати"
                      >
                        {copiedKey === "paragraph" ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === "paragraph" ? "Скопійовано" : "Копія"}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Choose any text from the real book for training */}
              <div className="bg-white/90 p-3.5 rounded-2xl border border-sky-100 neo-pressed-soft flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider font-extrabold text-[#006397] flex items-center gap-1.5">
                    <ListTree className="w-3.5 h-3.5 text-sky-600" />
                    Оберіть текст з вашої книги для тренування
                  </span>
                  {bookExcerpts.length > 0 && (
                    <span className="text-[10px] font-mono text-gray-400">
                      {bookExcerpts.length} текстів
                    </span>
                  )}
                </div>

                {bookExcerpts.length === 0 ? (
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    У поточній книзі ще немає розділів із текстом. Напишіть кілька абзаців у вкладці
                    «Книга & Текст», і вони з'являться тут для тренувань.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {/* Chapter select */}
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Глава книги
                        </label>
                        <select
                          value={pickerChapterId}
                          onChange={(e) => {
                            setPickerChapterId(e.target.value);
                            setPickerSectionId("");
                          }}
                          className="w-full px-2.5 py-1.5 rounded-xl neo-pressed bg-white text-[11px] font-bold text-[#1a1c1c] focus:outline-none focus:ring-1 focus:ring-sky-500 border border-gray-100 cursor-pointer"
                        >
                          {chapters.map((ch) => (
                            <option key={ch.id} value={ch.id}>
                              {ch.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Section select */}
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 mb-1">
                          Розділ / сцена
                        </label>
                        <select
                          value={pickerSectionId}
                          onChange={(e) => {
                            const secId = e.target.value;
                            setPickerSectionId(secId);
                            if (secId) {
                              const excerpt = bookExcerpts.find((ex) => ex.sectionId === secId && ex.chapterId === pickerChapterId);
                              if (excerpt) setActiveExcerpt(excerpt.id);
                            }
                          }}
                          disabled={!pickerChapterId || pickerSections.length === 0}
                          className="w-full px-2.5 py-1.5 rounded-xl neo-pressed bg-white text-[11px] font-bold text-[#1a1c1c] focus:outline-none focus:ring-1 focus:ring-sky-500 border border-gray-100 disabled:opacity-50 cursor-pointer"
                        >
                          <option value="">— Оберіть розділ —</option>
                          {pickerSections.map((sec) => (
                            <option key={sec.id} value={sec.id}>
                              {sec.title} ({sec.wordCount} сл.)
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Preview + insert button */}
                    {activeExcerpt && (
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <p className="text-[11px] text-[#2c382d] italic line-clamp-2 leading-relaxed flex-1 min-w-0">
                          «{activeExcerpt.text.slice(0, 180)}{activeExcerpt.text.length > 180 ? "…" : ""}»
                        </p>
                        {onInsertText && (
                          <button
                            onClick={() => onInsertText(activeExcerpt.text, "chapterExcerpt")}
                            className="shrink-0 px-3 py-1.5 rounded-xl bg-[#006397] hover:bg-[#004e77] text-white text-[11px] font-extrabold flex items-center gap-1.5 shadow-sm cursor-pointer"
                            title="Вставити обраний текст книги в робоче поле вправи"
                          >
                            <MousePointerClick className="w-3 h-3" />
                            <span>Вставити в тренажер</span>
                          </button>
                        )}
                      </div>
                    )}

                    {!activeExcerpt && (
                      <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-gray-400" />
                        Оберіть главу та розділ, щоб завантажити його текст у тренування.
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            /* Editing Form */
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Назва вашої книги
                  </label>
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    placeholder="Наприклад: Код Аура..."
                    className="w-full px-3 py-1.5 rounded-xl neo-pressed bg-white text-xs text-[#1a1c1c] font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Жанр / Напрям
                  </label>
                  <input
                    type="text"
                    value={tempGenre}
                    onChange={(e) => setTempGenre(e.target.value)}
                    placeholder="Наприклад: Фантастика, Детектив, Нон-фікшн..."
                    className="w-full px-3 py-1.5 rounded-xl neo-pressed bg-white text-xs text-[#1a1c1c] font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Головна ідея / Синопсис книги (вводиться перед тренуванням)
                </label>
                <textarea
                  value={tempIdea}
                  onChange={(e) => setTempIdea(e.target.value)}
                  rows={2}
                  placeholder="Опишіть головний задум, конфлікт або тезу вашої книги..."
                  className="w-full p-2.5 rounded-xl neo-pressed bg-white text-xs text-[#1a1c1c] focus:outline-none focus:ring-1 focus:ring-emerald-500 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Останній абзац першої глави / сцени, над якою ви працювали
                </label>
                <textarea
                  value={tempParagraph}
                  onChange={(e) => setTempParagraph(e.target.value)}
                  rows={3}
                  placeholder="Вставте уривок або останній абзац глави вашого рукопису..."
                  className="w-full p-2.5 rounded-xl neo-pressed bg-white text-xs text-[#1a1c1c] focus:outline-none focus:ring-1 focus:ring-emerald-500 leading-relaxed font-serif"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={resetToDefaultBookContext}
                  className="text-[11px] font-bold text-gray-400 hover:text-gray-700 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Відновити приклад
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
                  >
                    Скасувати
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-4 py-1.5 rounded-xl bg-[#006d37] hover:bg-[#005a2d] text-white text-xs font-bold shadow-sm cursor-pointer flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Зберегти зміни</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
