import React, { useEffect, useState } from 'react';
import { Blocks, Sparkles, Loader2, CheckCircle2, ArrowRight, RotateCcw, AlertTriangle, BookOpen } from 'lucide-react';
import type { Book, Chapter, NavigationTab } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { calculateWordCount } from '../utils/helpers';

interface BookStructureBuilderProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToTab: (tab: NavigationTab) => void;
}

type TemplateKind = 'nonfiction' | 'fiction';

interface TemplateBlockDef {
  key: string;
  labelKey: string;
}

const TEMPLATES: Record<TemplateKind, { titleKey: string; descKey: string; blocks: TemplateBlockDef[] }> = {
  nonfiction: {
    titleKey: 'structureBuilder.templateNonfiction',
    descKey: 'structureBuilder.templateNonfictionDesc',
    blocks: [
      { key: 'problem', labelKey: 'structureBuilder.blockProblem' },
      { key: 'solution', labelKey: 'structureBuilder.blockSolution' },
      { key: 'evidence', labelKey: 'structureBuilder.blockEvidence' },
      { key: 'exercises', labelKey: 'structureBuilder.blockExercises' },
      { key: 'conclusion', labelKey: 'structureBuilder.blockConclusion' },
    ],
  },
  fiction: {
    titleKey: 'structureBuilder.templateFiction',
    descKey: 'structureBuilder.templateFictionDesc',
    blocks: [
      { key: 'exposition', labelKey: 'structureBuilder.blockExposition' },
      { key: 'risingAction', labelKey: 'structureBuilder.blockRisingAction' },
      { key: 'development', labelKey: 'structureBuilder.blockDevelopment' },
      { key: 'climax', labelKey: 'structureBuilder.blockClimax' },
      { key: 'resolution', labelKey: 'structureBuilder.blockResolution' },
    ],
  },
};

interface BlockDraftState {
  text: string;
  suggestions: string[];
  selectedTitle: string;
  loadingSuggestions: boolean;
  suggestError: boolean;
}

interface PersistedDraft {
  templateKind: TemplateKind | null;
  blocks: Record<string, { text: string; selectedTitle: string }>;
}

const draftKey = (bookId: string) => `nova_structure_draft_${bookId}`;

function emptyBlockState(): BlockDraftState {
  return { text: '', suggestions: [], selectedTitle: '', loadingSuggestions: false, suggestError: false };
}

export const BookStructureBuilder: React.FC<BookStructureBuilderProps> = ({ book, onUpdateBook, onNavigateToTab }) => {
  const { t } = useLanguage();
  const [templateKind, setTemplateKind] = useState<TemplateKind | null>(null);
  const [blocks, setBlocks] = useState<Record<string, BlockDraftState>>({});
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Відновлюємо чернетку конструктора для цієї конкретної книги — щоб
  // текст блоків не губився при переході на іншу вкладку та назад
  // (сама структура ще не потрапила в книгу, доки автор не натиснув
  // «Створити розділи», тож зберігаємо чернетку окремо в localStorage,
  // той самий підхід, що і в інших легких мостах проєкту).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(book.id));
      if (raw) {
        const parsed: PersistedDraft = JSON.parse(raw);
        if (parsed.templateKind) {
          setTemplateKind(parsed.templateKind);
          const restored: Record<string, BlockDraftState> = {};
          for (const def of TEMPLATES[parsed.templateKind].blocks) {
            const saved = parsed.blocks?.[def.key];
            restored[def.key] = { ...emptyBlockState(), text: saved?.text || '', selectedTitle: saved?.selectedTitle || '' };
          }
          setBlocks(restored);
        }
      }
    } catch {
      /* немає чернетки — почнемо з вибору шаблону */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const persistDraft = (kind: TemplateKind | null, nextBlocks: Record<string, BlockDraftState>) => {
    try {
      const payload: PersistedDraft = {
        templateKind: kind,
        blocks: Object.fromEntries(
          Object.entries(nextBlocks).map(([k, v]) => [k, { text: v.text, selectedTitle: v.selectedTitle }])
        ),
      };
      localStorage.setItem(draftKey(book.id), JSON.stringify(payload));
    } catch {
      /* приватний режим / заблоковане сховище — конструктор лишається робочим, просто без чернетки */
    }
  };

  const pickTemplate = (kind: TemplateKind) => {
    const initial: Record<string, BlockDraftState> = {};
    for (const def of TEMPLATES[kind].blocks) initial[def.key] = emptyBlockState();
    setTemplateKind(kind);
    setBlocks(initial);
    setCreatedCount(null);
    persistDraft(kind, initial);
  };

  const resetTemplate = () => {
    setTemplateKind(null);
    setBlocks({});
    setCreatedCount(null);
    try {
      localStorage.removeItem(draftKey(book.id));
    } catch {
      /* нічого критичного */
    }
  };

  const updateBlockText = (key: string, text: string) => {
    setBlocks((prev) => {
      const next = { ...prev, [key]: { ...prev[key], text } };
      persistDraft(templateKind, next);
      return next;
    });
  };

  const selectTitle = (key: string, title: string) => {
    setBlocks((prev) => {
      const next = { ...prev, [key]: { ...prev[key], selectedTitle: title } };
      persistDraft(templateKind, next);
      return next;
    });
  };

  const suggestTitle = async (def: TemplateBlockDef) => {
    const block = blocks[def.key];
    if (!block?.text.trim()) return;
    setBlocks((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loadingSuggestions: true, suggestError: false } }));
    try {
      const res = await fetch('/api/ai/structure-suggest-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockLabel: t(def.labelKey), blockText: block.text, genre: templateKind, bookTitle: book.title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setBlocks((prev) => ({
        ...prev,
        [def.key]: { ...prev[def.key], suggestions: Array.isArray(data.suggestions) ? data.suggestions : [], loadingSuggestions: false },
      }));
    } catch {
      setBlocks((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loadingSuggestions: false, suggestError: true } }));
    }
  };

  const filledBlocksCount = Object.values(blocks).filter((b) => b.text.trim().length > 0).length;

  const handleCreateChapters = () => {
    if (!templateKind) return;
    setCreateError(null);
    const defs = TEMPLATES[templateKind].blocks;
    const now = new Date().toISOString();
    const baseOrder = book.chapters.length;
    const newChapters: Chapter[] = [];
    let idx = 0;
    for (const def of defs) {
      const block = blocks[def.key];
      if (!block?.text.trim()) continue;
      const title = block.selectedTitle || t(def.labelKey);
      const chapterId = `chap-struct-${Date.now()}-${idx}`;
      const sectionId = `sec-struct-${Date.now()}-${idx}`;
      newChapters.push({
        id: chapterId,
        bookId: book.id,
        title,
        order: baseOrder + idx + 1,
        sections: [
          {
            id: sectionId,
            chapterId,
            title,
            order: 1,
            content: block.text,
            wordCount: calculateWordCount(block.text),
            lastModified: now,
          },
        ],
      });
      idx += 1;
    }

    if (newChapters.length === 0) {
      setCreateError(t('structureBuilder.emptyError'));
      return;
    }

    onUpdateBook(
      { ...book, chapters: [...book.chapters, ...newChapters] },
      'Створено розділи через Конструктор структури',
      `Шаблон «${t(TEMPLATES[templateKind].titleKey)}», створено розділів: ${newChapters.length}`
    );
    setCreatedCount(newChapters.length);
    try {
      localStorage.removeItem(draftKey(book.id));
    } catch {
      /* нічого критичного */
    }
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-5">
      <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 text-violet-400 flex items-center justify-center shrink-0">
            <Blocks className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100">{t('structureBuilder.title')}</h1>
            <p className="text-xs text-slate-500">{t('structureBuilder.subtitle')}</p>
          </div>
        </div>
        {templateKind && (
          <button
            onClick={resetTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('structureBuilder.changeTemplateBtn')}</span>
          </button>
        )}
      </div>

      {!templateKind ? (
        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(Object.keys(TEMPLATES) as TemplateKind[]).map((kind) => (
            <button
              key={kind}
              onClick={() => pickTemplate(kind)}
              className="text-left nova-glass-dark rounded-2xl border border-slate-800 hover:border-violet-500/50 p-5 transition-colors group"
            >
              <h3 className="text-sm font-bold text-slate-100 group-hover:text-violet-300 mb-2">{t(TEMPLATES[kind].titleKey)}</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">{t(TEMPLATES[kind].descKey)}</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES[kind].blocks.map((b) => (
                  <span key={b.key} className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400">
                    {t(b.labelKey)}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="max-w-3xl mx-auto space-y-4">
          {createdCount !== null && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{t('structureBuilder.createdToast', { n: String(createdCount) })}</span>
              </div>
              <button
                onClick={() => onNavigateToTab('editor')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{t('structureBuilder.goToEditorBtn')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {TEMPLATES[templateKind].blocks.map((def) => {
            const block = blocks[def.key] || emptyBlockState();
            return (
              <div key={def.key} className="nova-glass-dark rounded-2xl border border-slate-800 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-100">{t(def.labelKey)}</h3>
                  {block.selectedTitle && (
                    <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold border border-violet-500/30">
                      {block.selectedTitle}
                    </span>
                  )}
                </div>
                <textarea
                  value={block.text}
                  onChange={(e) => updateBlockText(def.key, e.target.value)}
                  placeholder={t('structureBuilder.blockPlaceholder')}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    onClick={() => suggestTitle(def)}
                    disabled={!block.text.trim() || block.loadingSuggestions}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold transition-colors disabled:opacity-40"
                  >
                    {block.loadingSuggestions ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{block.loadingSuggestions ? t('structureBuilder.suggestingTitle') : t('structureBuilder.suggestTitleBtn')}</span>
                  </button>
                  {block.suggestError && (
                    <span className="flex items-center gap-1 text-[11px] text-rose-400">
                      <AlertTriangle className="w-3 h-3" />
                      {t('structureBuilder.suggestError')}
                    </span>
                  )}
                </div>
                {block.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {block.suggestions.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectTitle(def.key, s)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                          block.selectedTitle === s
                            ? 'bg-violet-500 text-white border-violet-500'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {createError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          <button
            onClick={handleCreateChapters}
            disabled={filledBlocksCount === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-40"
          >
            <Blocks className="w-4 h-4" />
            <span>{t('structureBuilder.createChaptersBtn', { n: String(filledBlocksCount) })}</span>
          </button>
        </div>
      )}
    </div>
  );
};
