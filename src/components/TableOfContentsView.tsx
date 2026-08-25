import React, { useState } from 'react';
import { 
  ListOrdered, 
  Settings2, 
  Sparkles, 
  Layers, 
  Type, 
  FileText, 
  ChevronRight, 
  Eye, 
  Printer, 
  Copy, 
  Check, 
  Edit3, 
  Hash, 
  AlignLeft, 
  AlignJustify,
  ArrowRight,
  BookOpen,
  Save,
  Plus
} from 'lucide-react';
import { Book, Chapter, TOCConfig, TOCLeaderStyle, TOCNumberingStyle } from '../types';
import { computeTableOfContents, getLeaderSymbol } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';

interface TableOfContentsViewProps {
  book: Book;
  onUpdateBook: (updated: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToSection?: (chapterId: string, sectionId: string) => void;
  onSaveBook?: () => void;
}

export const TableOfContentsView: React.FC<TableOfContentsViewProps> = ({
  book,
  onUpdateBook,
  onNavigateToSection,
  onSaveBook,
}) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState<string>('');

  const layout = book.layoutConfig;
  const tocConfig: TOCConfig = layout.tocConfig || {
    leaderStyle: 'dots',
    numberingStyle: 'arabic',
    showSectionSubitems: true,
    showFrontMatter: true,
    title: 'ЗМІСТ',
    customPrefix: 'Глава',
    pageNumberPosition: 'right',
  };

  const computedItems = computeTableOfContents(book);

  const handleUpdateTocConfig = (updated: Partial<TOCConfig>) => {
    onUpdateBook({
      ...book,
      layoutConfig: {
        ...layout,
        tocConfig: {
          ...tocConfig,
          ...updated,
        },
      },
    });
  };

  // Keyboard inline rename of chapter / section
  const handleStartEditing = (id: string, currentTitle: string) => {
    setEditingItemId(id);
    setEditTitleValue(currentTitle);
  };

  const handleSaveInlineEdit = (itemId: string, itemType: 'chapter' | 'section') => {
    if (!editTitleValue.trim()) {
      setEditingItemId(null);
      return;
    }

    if (itemType === 'chapter') {
      const updatedChapters = book.chapters.map(c => 
        c.id === itemId ? { ...c, title: editTitleValue.trim() } : c
      );
      onUpdateBook({ ...book, chapters: updatedChapters });
    } else {
      const updatedChapters = book.chapters.map(c => ({
        ...c,
        sections: c.sections.map(s => 
          s.id === itemId ? { ...s, title: editTitleValue.trim() } : s
        ),
      }));
      onUpdateBook({ ...book, chapters: updatedChapters });
    }

    setEditingItemId(null);
  };

  const handleCopyTocText = () => {
    let plainText = `${tocConfig.title}\n===============================\n\n`;
    computedItems.forEach(item => {
      const indent = item.type === 'section' ? '   ' : '';
      const prefix = item.displayNumber ? `${item.displayNumber}. ` : '';
      plainText += `${indent}${prefix}${item.title} ........... ${item.pageNumber ?? '—'}\n`;
    });

    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  /**
   * Створення нової глави з початковим розділом та сценою.
   * Логіка ідентична EditorView.handleAddChapter — щоб нова глава
   * однаково з'являлася в редакторі, змісті та PDF-експорті.
   */
  const handleAddChapter = () => {
    const nextOrder = book.chapters.length + 1;
    const newChapterId = `chap-${Date.now()}`;
    const newSectionId = `sec-${Date.now()}`;
    const newChapter: Chapter = {
      id: newChapterId,
      bookId: book.id,
      title: `Глава ${nextOrder}: Нова глава`,
      titleEn: `Chapter ${nextOrder}: New Chapter`,
      order: nextOrder,
      sections: [
        {
          id: newSectionId,
          chapterId: newChapterId,
          title: 'Розділ 1: Початок',
          titleEn: 'Section 1: The Beginning',
          order: 1,
          content: '',
          contentEn: '',
          wordCount: 0,
          lastModified: new Date().toISOString(),
          scene: {
            id: `scene-${Date.now()}`,
            sectionId: newSectionId,
            title: 'Нова сцена',
            act: 1,
            summary: '',
            location: '',
            timeOfDay: 'День',
            timelineOrder: 1,
            intensityScore: 5,
            conflict: '',
            resolution: '',
            characters: [],
          },
        },
      ],
    };

    onUpdateBook(
      {
        ...book,
        chapters: [...book.chapters, newChapter],
        updatedAt: new Date().toISOString(),
      },
      'Створення глави',
      `Створено нову главу «${newChapter.title}» з початковим розділом`
    );

    // Одразу відкриваємо нову главу в редакторі, якщо доступна навігація
    if (onNavigateToSection) {
      onNavigateToSection(newChapterId, newSectionId);
    }
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto bg-slate-950 text-slate-100 space-y-6">
      
      {/* Top Banner */}
      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-amber-400 border border-slate-700">
              {t('tableOfContents.autoTocBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('tableOfContents.formatDynamicNote', { format: layout.formatPreset })}
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 font-heading">
            {t('tableOfContents.heading')}
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          {onSaveBook && (
            <button
              onClick={onSaveBook}
              data-tour="toc__1"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors whitespace-nowrap"
              title={t('tableOfContents.saveTocTooltip')}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('tableOfContents.saveChangesBtn')}</span>
            </button>
          )}

          <button
            onClick={handleCopyTocText}
            data-tour="toc__2"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? t('tableOfContents.copiedBtn') : t('tableOfContents.copyTextBtn')}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Controls Panel (5 cols) & Live Print TOC Preview (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Style & Leader Controls */}
        <div className="lg:col-span-5 space-y-5">
          
          {/* Style Configuration Card */}
          <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Settings2 className="w-4 h-4" />
              {t('tableOfContents.displayParamsHeading')}
            </h3>

            {/* Leader Symbol selection */}
            <div>
              <label className="text-xs text-slate-300 font-bold block mb-2">
                {t('tableOfContents.leaderSymbolLabel')}
              </label>
              <div className="grid grid-cols-2 gap-2" data-tour="toc__3">
                {[
                  { id: 'dots', label: t('tableOfContents.leaderDots'), example: '. . . . . . 42' },
                  { id: 'dashes', label: t('tableOfContents.leaderDashes'), example: '- - - - - - 42' },
                  { id: 'line', label: t('tableOfContents.leaderLine'), example: '______ 42' },
                  { id: 'waves', label: t('tableOfContents.leaderWaves'), example: '~ ~ ~ ~ ~ ~ 42' },
                  { id: 'double-dots', label: t('tableOfContents.leaderDoubleDots'), example: ': : : : : : 42' },
                  { id: 'blank', label: t('tableOfContents.leaderBlank'), example: '           42' },
                ].map(l => (
                  <button
                    key={l.id}
                    onClick={() => handleUpdateTocConfig({ leaderStyle: l.id as TOCLeaderStyle })}
                    className={`p-2.5 rounded-xl text-left border transition-all ${
                      tocConfig.leaderStyle === l.id
                        ? 'bg-cyan-500/20 border-cyan-500 text-white shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold">{l.label}</div>
                    <div className="text-[10px] font-mono text-cyan-400 truncate">{l.example}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Numbering Format */}
            <div className="pt-3 border-t border-slate-800">
              <label className="text-xs text-slate-300 font-bold block mb-2">
                {t('tableOfContents.numberingFormatLabel')}
              </label>
              <div className="grid grid-cols-2 gap-2" data-tour="toc__4">
                {[
                  { id: 'arabic', label: t('tableOfContents.numberingArabic') },
                  { id: 'roman', label: t('tableOfContents.numberingRoman') },
                  { id: 'words', label: t('tableOfContents.numberingWords') },
                  { id: 'none', label: t('tableOfContents.numberingNone') },
                ].map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleUpdateTocConfig({ numberingStyle: n.id as TOCNumberingStyle })}
                    className={`p-2 rounded-xl text-xs font-medium border text-center transition-all ${
                      tocConfig.numberingStyle === n.id
                        ? 'bg-cyan-500/20 border-cyan-500 text-white font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prefix & Heading Text */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{t('tableOfContents.tocTitleLabel')}</label>
                <input
                  type="text"
                  value={tocConfig.title}
                  onChange={(e) => handleUpdateTocConfig({ title: e.target.value })}
                  className="w-full p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{t('tableOfContents.prefixLabel')}</label>
                <input
                  type="text"
                  value={tocConfig.customPrefix}
                  onChange={(e) => handleUpdateTocConfig({ customPrefix: e.target.value })}
                  placeholder={t('tableOfContents.prefixPlaceholder')}
                  className="w-full p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2 pt-3 border-t border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={tocConfig.showSectionSubitems}
                  onChange={(e) => handleUpdateTocConfig({ showSectionSubitems: e.target.checked })}
                  className="rounded-md accent-cyan-400"
                />
                <span>{t('tableOfContents.includeSubitemsLabel')}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={tocConfig.showFrontMatter}
                  onChange={(e) => handleUpdateTocConfig({ showFrontMatter: e.target.checked })}
                  className="rounded-md accent-cyan-400"
                />
                <span>{t('tableOfContents.includeFrontMatterLabel')}</span>
              </label>
            </div>

          </div>

          {/* Quick Edit Chapter Titles from Keyboard List */}
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                {t('tableOfContents.quickEditHeading')}
              </span>
              <span className="flex items-center gap-2">
                <button
                  onClick={handleAddChapter}
                  data-tour="toc__add-chapter"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-[10px] transition-colors"
                  title={t('tableOfContents.addChapterTooltip')}
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                  {t('tableOfContents.addChapterBtn')}
                </button>
                <span className="text-[10px] text-slate-500 font-mono">
                  {book.chapters.length} {t('tableOfContents.chaptersCountSuffix')}
                </span>
              </span>
            </h3>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {book.chapters.map((chap, cIdx) => (
                <div key={chap.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-slate-400 font-mono text-[10px]">
                    <span>{t('tableOfContents.chapterLabel', { n: String(cIdx + 1) })}</span>
                    <button
                      onClick={() => handleStartEditing(chap.id, chap.title)}
                      className="text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" />
                      {t('tableOfContents.editBtn')}
                    </button>
                  </div>

                  {editingItemId === chap.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={editTitleValue}
                        onChange={(e) => setEditTitleValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveInlineEdit(chap.id, 'chapter');
                          if (e.key === 'Escape') setEditingItemId(null);
                        }}
                        className="flex-1 p-1.5 rounded-lg bg-slate-950 border border-cyan-400 text-xs text-white"
                      />
                      <button
                        onClick={() => handleSaveInlineEdit(chap.id, 'chapter')}
                        className="px-2 py-1 rounded-lg bg-cyan-600 text-slate-950 font-bold text-[10px]"
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <div className="font-bold text-white truncate">{chap.title}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: Live Book TOC Page Preview */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col items-center" data-tour="toc__5">

            <div className="w-full flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-4 h-4" />
                {t('tableOfContents.printPreviewLabel')}
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {t('tableOfContents.fontLabel', { format: layout.formatPreset, font: layout.typography.bodyFont })}
              </span>
            </div>

            {/* Realistic Print Page Sheet */}
            <div className="w-full max-w-lg bg-[#fffefc] text-slate-950 rounded-xl shadow-2xl p-8 sm:p-12 border-2 border-slate-300 min-h-[580px] flex flex-col justify-between font-serif-book">
              
              <div>
                {/* Header title */}
                <h2 className="text-2xl font-bold text-center tracking-wider text-slate-900 border-b-2 border-slate-900 pb-3 mb-6 font-serif-book">
                  {tocConfig.title || 'ЗМІСТ'}
                </h2>

                {/* Items list */}
                <div className="space-y-2.5 text-xs leading-relaxed">
                  {computedItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        if (item.type === 'chapter' && onNavigateToSection) {
                          const chap = book.chapters.find(c => c.id === item.id);
                          if (chap && chap.sections[0]) {
                            onNavigateToSection(chap.id, chap.sections[0].id);
                          }
                        }
                      }}
                      className={`flex items-baseline justify-between group cursor-pointer hover:text-cyan-800 transition-colors ${
                        item.type === 'section' ? 'pl-5 text-slate-700 text-[11px]' : 'font-bold text-slate-950'
                      }`}
                    >
                      {/* Title & Prefix */}
                      <span className="shrink-0 flex items-center gap-2">
                        {item.displayNumber && (
                          <span className="font-mono text-slate-600 font-semibold">{item.displayNumber}.</span>
                        )}
                        <span>{item.title}</span>
                      </span>

                      {/* Dynamic Leader line (dots / dashes / waves / solid line) */}
                      <span className="flex-1 mx-2 overflow-hidden text-slate-400 select-none whitespace-nowrap text-[10px] font-mono leading-none tracking-widest text-center">
                        {getLeaderSymbol(tocConfig.leaderStyle)}
                      </span>

                      {/* Page number */}
                      <span className="shrink-0 font-mono font-bold text-slate-900">
                        {item.pageNumber ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Page footer */}
              <div className="text-center text-[10px] font-mono text-slate-400 pt-6 border-t border-slate-100">
                — {layout.frontMatter.showTitlePage ? 'v' : '1'} —
              </div>

            </div>

            <p className="text-[11px] text-slate-400 mt-4 text-center">
              {t('tableOfContents.footerNote')}
            </p>

          </div>
        </div>

      </div>

    </div>
  );
};
