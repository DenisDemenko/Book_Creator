import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, GraduationCap, Loader2, Send, Sparkles, RotateCcw, PenLine, ScanSearch, ListChecks } from 'lucide-react';
import type { Book } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * Модалка «AI-коуч» — спливаюче вікно-тренажер, що з'являється після
 * виділення тексту в «Книга і текст» (кнопка в тулбарі «AI Асистент» +
 * значок ✦ біля виділення в EditorView.tsx). Побудована на основі макета
 * fusion_lab_ai_mentor_v4.html, але з двома принциповими відмінностями,
 * підтвердженими власником (AskUserQuestion):
 *
 *   1. Аналіз/чат/аудит виконує СПРАВЖНЯ модель ШІ (server.ts
 *      /api/ai/coach-analyze, /api/ai/coach-chat, /api/ai/coach-book-audit
 *      — те саме ядро generateAiText, що й решта AI-інструментів
 *      продукту), а не локальні regex-детектори макета.
 *   2. «Пам'ять книги» (Character State/Relationship/Plot із макета) НЕ
 *      дублюється тут ручною формою — коуч читає РЕАЛЬНІ дані книги
 *      (book.characters, book.heroArc), які й так редагуються в наявних
 *      картках персонажів/«Шляху героя». Дублювання цього як окремої форми
 *      в попапі означало б два джерела правди для тих самих даних.
 *
 * Вкладки: Аналіз (сцена/фрагмент, MESO+MICRO), Чат (розмова з ментором),
 * Аудит книги (MACRO, Phase 2 — Continuity/Threads/Arc/Setup-Payoff).
 * Знизу — постійна панель «Текст для вставки»: сюди копіюється відповідь
 * ШІ чи власний варіант автора, і звідти єдиною кнопкою текст повертається
 * в рукопис через вже наявний, перевірений маркер [AI-DRAFT]…[/AI-DRAFT]
 * (onInsertToBook, реалізовано в EditorView.tsx — той самий шлях, що й
 * «Вставити абзац за виділенням»).
 */

export interface CoachSeed {
  text: string;
  kind: 'ua' | 'en';
  sceneText?: string;
  sceneTitle?: string;
  chapterTitle?: string;
}

interface CoachModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  seed: CoachSeed | null;
  preferredAiModelId?: string;
  currentModelLabel: string;
  onInsertToBook: (text: string) => void;
}

type Tab = 'analysis' | 'chat' | 'audit';
type HealthStatus = 'clear' | 'weak' | 'missing' | 'uncertain';

interface AnalysisResult {
  health: Record<string, HealthStatus>;
  mainProblem: { label: string; evidence: string; question: string } | null;
  intentGap: { status: string; message: string };
  exercise: string;
}

interface AuditResult {
  continuityIssues: { description: string; locations?: string }[];
  openThreads: { name: string; status: string; note?: string }[];
  arcNotes: { character: string; note: string }[];
  setupPayoff: { setup: string; payoffStatus: string; note?: string }[];
  truncated?: boolean;
}

type ChatMsg = { role: 'author' | 'coach'; text: string };

const HEALTH_KEYS: { key: string; labelKey: string }[] = [
  { key: 'goal', labelKey: 'coachHealthGoal' },
  { key: 'conflict', labelKey: 'coachHealthConflict' },
  { key: 'stakes', labelKey: 'coachHealthStakes' },
  { key: 'choice', labelKey: 'coachHealthChoice' },
  { key: 'emotionalChange', labelKey: 'coachHealthEmotion' },
  { key: 'pov', labelKey: 'coachHealthPov' },
  { key: 'rhythm', labelKey: 'coachHealthRhythm' },
  { key: 'sensory', labelKey: 'coachHealthSensory' },
];

// nm-inset задає власний фон/тінь (неоморфна тема) — тут лишається тільки
// колірний акцент статусу (текст + ліва межа), без bg-*/border-* класів,
// що конфліктували б із фоном nm-inset.
const STATUS_STYLE: Record<HealthStatus, string> = {
  clear: 'text-emerald-300 border-l-2 border-emerald-400/60',
  weak: 'text-amber-300 border-l-2 border-amber-400/60',
  missing: 'text-rose-300 border-l-2 border-rose-400/60',
  uncertain: 'text-[var(--outline)] border-l-2 border-[var(--outline-variant)]',
};

// Клієнтська межа для книжкового аудиту — серверний захисний ліміт (90k)
// лишається окремо в server.ts, ця межа менша, щоб не ганяти зайві токени
// на кожен клік «Запустити аудит» для великих книг.
const COACH_AUDIT_CHAR_CAP = 45000;

export const CoachModal: React.FC<CoachModalProps> = ({
  isOpen,
  onClose,
  book,
  seed,
  preferredAiModelId,
  currentModelLabel,
  onInsertToBook,
}) => {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('analysis');
  const [intent, setIntent] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState('');
  const [insertedFlash, setInsertedFlash] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  // Скидання стану попереднього фрагмента при відкритті з НОВИМ виділенням —
  // інакше автор побачив би аналіз учорашнього фрагмента поверх нового.
  useEffect(() => {
    if (!isOpen) return;
    setTab('analysis');
    setAnalysis(null);
    setAnalyzeError(null);
    setMessages([]);
    setChatError(null);
    setAudit(null);
    setAuditError(null);
    setIntent('');
    setDraftText(seed?.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, seed?.text]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages, chatBusy]);

  // useMemo МУСИТЬ виконатись до раннього return — інакше кількість хуків
  // відрізняється між рендером isOpen=false і isOpen=true («Rendered more
  // hooks than during the previous render»), бо цей компонент змонтований
  // постійно (EditorView.tsx рендерить <CoachModal isOpen={coachOpen} .../>
  // завжди, не умовно) і перемикає isOpen без демонтажу.
  const characterContext = useMemo(
    () =>
      (book.characters || []).slice(0, 12).map((c) => ({
        name: c.name,
        personality: c.personality,
        relationships: c.relationships,
      })),
    [book.characters]
  );

  if (!isOpen) return null;

  const runAnalysis = async () => {
    if (!seed?.text) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/ai/coach-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          modelId: preferredAiModelId || undefined,
          fragment: seed.text,
          sceneText: seed.sceneText,
          intent: intent.trim() || undefined,
          bookTitle: book.title,
          genre: book.genre,
          chapterTitle: seed.chapterTitle,
          sceneTitle: seed.sceneTitle,
          characters: characterContext,
          bookId: book.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || t('editor.coachError')));
      setAnalysis(data as AnalysisResult);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : t('editor.coachError'));
    } finally {
      setAnalyzing(false);
    }
  };

  const sendChat = async (initialText?: string) => {
    const text = (initialText ?? chatInput).trim();
    if (!text) return;
    const nextMessages: ChatMsg[] = [...messages, { role: 'author', text }];
    setMessages(nextMessages);
    setChatInput('');
    setChatBusy(true);
    setChatError(null);
    try {
      const res = await fetch('/api/ai/coach-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          modelId: preferredAiModelId || undefined,
          messages: nextMessages,
          fragment: seed?.text,
          sceneTitle: seed?.sceneTitle,
          bookTitle: book.title,
          genre: book.genre,
          bookId: book.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || t('editor.coachError')));
      setMessages((prev) => [...prev, { role: 'coach', text: String(data.reply || '') }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : t('editor.coachError'));
    } finally {
      setChatBusy(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    setAuditError(null);
    try {
      let used = 0;
      const chaptersText = book.chapters.map((ch) => ({
        chapterTitle: ch.title,
        sections: ch.sections.map((s) => {
          const remaining = Math.max(0, COACH_AUDIT_CHAR_CAP - used);
          const text = (s.content || '').replace(/\[[^\]]*\]/g, ' ').slice(0, remaining);
          used += text.length;
          return { title: s.title, text };
        }),
      }));
      const res = await fetch('/api/ai/coach-book-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          modelId: preferredAiModelId || undefined,
          bookTitle: book.title,
          genre: book.genre,
          synopsis: book.synopsis,
          characters: characterContext,
          heroArcSummary: book.heroArc ? Object.values(book.heroArc.answers || {}).filter(Boolean).join(' · ') : undefined,
          chaptersText,
          bookId: book.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || t('editor.coachError')));
      setAudit(data as AuditResult);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : t('editor.coachError'));
    } finally {
      setAuditing(false);
    }
  };

  const doInsert = () => {
    const text = draftText.trim();
    if (!text) return;
    onInsertToBook(text);
    setInsertedFlash(true);
    setTimeout(() => setInsertedFlash(false), 2500);
  };

  // Стиль попапу переюзаний з QuickAiModal.tsx («AI Літературний
  // Консультант») — та сама неоморфна тема Modul_token
  // (src/styles/tokenModuleTheme.css, клас .token-module-scope + nm-*),
  // щоб коуч виглядав як частина того самого продукту, а не окремий,
  // різкіший за кольором попап поверх нього. Логіка/хендлери не змінені.
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="token-module-scope rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="shrink-0 p-4 nm-outset-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
              <GraduationCap className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[14px] font-bold text-[var(--on-surface)] leading-tight truncate">{t('editor.coachTitle')}</h2>
              <p className="text-[11px] text-[var(--outline)] truncate">
                {seed?.sceneTitle || book.title} · {currentModelLabel}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)] shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 px-4 pt-3 pb-0 flex items-center gap-1">
          {([
            { id: 'analysis' as Tab, icon: ScanSearch, key: 'coachTabAnalysis' },
            { id: 'chat' as Tab, icon: Sparkles, key: 'coachTabChat' },
            { id: 'audit' as Tab, icon: ListChecks, key: 'coachTabAudit' },
          ]).map(({ id, icon: Icon, key }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                tab === id
                  ? 'nm-inset text-[var(--primary)] border-b-2 border-[var(--primary)]'
                  : 'nm-btn text-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(`editor.${key}`)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 nm-flat">
          {tab === 'analysis' && (
            <div className="space-y-4">
              <div className="rounded-xl nm-inset p-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--outline)] mb-1">{t('editor.coachFragmentLabel')}</div>
                <p className="text-sm text-[var(--on-surface-variant)] whitespace-pre-wrap max-h-32 overflow-y-auto">{seed?.text}</p>
              </div>

              <div>
                <label className="text-xs text-[var(--outline)] block mb-1">{t('editor.coachIntentLabel')}</label>
                <input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder={t('editor.coachIntentPlaceholder')}
                  className="w-full px-3 py-2 rounded-lg nm-inset text-sm text-[var(--on-surface)] outline-none bg-transparent placeholder:text-[var(--outline)]"
                />
              </div>

              <button
                onClick={runAnalysis}
                disabled={analyzing || !seed?.text}
                className="nm-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                {t('editor.coachRunAnalysis')}
              </button>

              {analyzeError && <p className="text-sm text-rose-400">{analyzeError}</p>}

              {analysis && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {HEALTH_KEYS.map(({ key, labelKey }) => {
                      const status = (analysis.health?.[key] as HealthStatus) || 'uncertain';
                      return (
                        <div
                          key={key}
                          className={`nm-inset px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${STATUS_STYLE[status]}`}
                          title={t(`editor.${labelKey}`)}
                        >
                          <div className="truncate">{t(`editor.${labelKey}`)}</div>
                          <div className="opacity-80">{status}</div>
                        </div>
                      );
                    })}
                  </div>

                  {analysis.mainProblem && (
                    <div className="rounded-xl nm-inset p-3 space-y-1.5 border-l-2 border-amber-400/60">
                      <div className="text-sm font-semibold text-amber-300">{analysis.mainProblem.label}</div>
                      <div className="text-xs text-[var(--on-surface-variant)]">{analysis.mainProblem.evidence}</div>
                      <div className="text-sm text-[var(--on-surface)] italic">« {analysis.mainProblem.question} »</div>
                      <button
                        onClick={() => {
                          setTab('chat');
                          void sendChat(analysis.mainProblem!.question);
                        }}
                        className="text-xs text-[var(--primary)] hover:opacity-80 mt-1"
                      >
                        {t('editor.coachDiscussInChat')} →
                      </button>
                    </div>
                  )}

                  {analysis.intentGap?.message && (
                    <div className="text-xs text-[var(--outline)] border-l-2 border-[var(--outline-variant)] pl-2">{analysis.intentGap.message}</div>
                  )}

                  {analysis.exercise && (
                    <div className="rounded-xl nm-inset p-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-[var(--outline)] mb-1">{t('editor.coachExerciseLabel')}</div>
                        <p className="text-sm text-[var(--on-surface)]">{analysis.exercise}</p>
                      </div>
                      <button
                        onClick={() => setDraftText(analysis.exercise)}
                        className="nm-btn shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-[var(--on-surface)]"
                      >
                        <PenLine className="w-3.5 h-3.5" />
                        {t('editor.coachToDraft')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'chat' && (
            <div className="flex flex-col h-full min-h-[360px]">
              {/* msg-user/msg-assistant — ті самі класи-градієнти, що й у
                  QuickAiModal.tsx (чат «AI Літературний Консультант»),
                  щоб бульбашки коуча виглядали ідентично. */}
              <div ref={feedRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
                {messages.length === 0 && <p className="text-sm text-[var(--outline)]">{t('editor.coachChatEmpty')}</p>}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] p-3.5 text-sm text-[var(--on-surface)] whitespace-pre-wrap ${
                      m.role === 'author' ? 'ml-auto msg-user' : 'msg-assistant'
                    }`}
                  >
                    {m.text}
                    {m.role === 'coach' && (
                      <div className="mt-1.5">
                        <button
                          onClick={() => setDraftText(m.text)}
                          className="text-[11px] text-[var(--primary)] hover:opacity-80"
                        >
                          {t('editor.coachToDraft')} →
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {chatBusy && <Loader2 className="w-4 h-4 animate-spin text-[var(--outline)]" />}
              </div>
              {chatError && <p className="text-sm text-rose-400 mt-2">{chatError}</p>}
              <div className="shrink-0 flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                  placeholder={t('editor.coachChatPlaceholder')}
                  className="flex-1 px-3 py-2 rounded-lg nm-inset text-sm text-[var(--on-surface)] outline-none bg-transparent placeholder:text-[var(--outline)]"
                />
                <button
                  onClick={() => void sendChat()}
                  disabled={chatBusy || !chatInput.trim()}
                  className="nm-btn-primary p-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--outline)]">{t('editor.coachAuditHint')}</p>
              <button
                onClick={runAudit}
                disabled={auditing}
                className="nm-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {auditing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
                {t('editor.coachRunAudit')}
              </button>
              {auditError && <p className="text-sm text-rose-400">{auditError}</p>}
              {audit && (
                <div className="space-y-4">
                  {audit.truncated && <p className="text-xs text-amber-400">{t('editor.coachAuditTruncated')}</p>}
                  {(
                    [
                      { key: 'continuityIssues', titleKey: 'coachAuditContinuity' },
                      { key: 'openThreads', titleKey: 'coachAuditThreads' },
                      { key: 'arcNotes', titleKey: 'coachAuditArc' },
                      { key: 'setupPayoff', titleKey: 'coachAuditSetupPayoff' },
                    ] as const
                  ).map(({ key, titleKey }) => {
                    const items = (audit as any)[key] as any[];
                    return (
                      <div key={key}>
                        <h4 className="text-xs uppercase tracking-wide text-[var(--outline)] mb-1.5">{t(`editor.${titleKey}`)}</h4>
                        {!items || items.length === 0 ? (
                          <p className="text-sm text-[var(--outline)]">{t('editor.coachAuditNone')}</p>
                        ) : (
                          <div className="space-y-1.5">
                            {items.map((it, i) => (
                              <div key={i} className="rounded-lg nm-inset p-2.5 text-sm text-[var(--on-surface)]">
                                {key === 'continuityIssues' && (
                                  <>
                                    <div>{it.description}</div>
                                    {it.locations && <div className="text-xs text-[var(--outline)] mt-0.5">{it.locations}</div>}
                                  </>
                                )}
                                {key === 'openThreads' && (
                                  <>
                                    <div>
                                      <b>{it.name}</b> · <span className="text-amber-400">{it.status}</span>
                                    </div>
                                    {it.note && <div className="text-xs text-[var(--outline)] mt-0.5">{it.note}</div>}
                                  </>
                                )}
                                {key === 'arcNotes' && (
                                  <>
                                    <div>
                                      <b>{it.character}</b>
                                    </div>
                                    <div className="text-xs text-[var(--outline)] mt-0.5">{it.note}</div>
                                  </>
                                )}
                                {key === 'setupPayoff' && (
                                  <>
                                    <div>
                                      {it.setup} · <span className="text-amber-400">{it.payoffStatus}</span>
                                    </div>
                                    {it.note && <div className="text-xs text-[var(--outline)] mt-0.5">{it.note}</div>}
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Постійна панель вставки — доступна на будь-якій вкладці.
            Кнопка вставки лишається смарагдовою (не var(--primary)) —
            єдиний свідомий відступ від чат-дровера: це дія іншого типу
            (закомітити текст у рукопис, а не надіслати повідомлення), тож
            зберігає власний колірний акцент, але в тій самій неоморфній
            мові тіней (nm-btn/nm-outset), що й решта попапу. */}
        <div className="shrink-0 border-t border-[var(--border-subtle)] nm-outset-sm px-5 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wide text-[var(--outline)]">{t('editor.coachDraftLabel')}</label>
            <button
              onClick={() => setDraftText(seed?.text || '')}
              className="flex items-center gap-1 text-[11px] text-[var(--outline)] hover:text-[var(--on-surface)]"
            >
              <RotateCcw className="w-3 h-3" />
              {t('editor.coachDraftReset')}
            </button>
          </div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg nm-inset text-sm text-[var(--on-surface)] outline-none bg-transparent resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400" style={{ opacity: insertedFlash ? 1 : 0, transition: 'opacity .3s' }}>
              {t('editor.coachInserted')}
            </span>
            <button
              onClick={doInsert}
              disabled={!draftText.trim()}
              className="nm-btn flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PenLine className="w-4 h-4" />
              {t('editor.coachInsertToBook')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
