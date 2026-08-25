import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Bot, User, Trash2, Plus, Coins, Loader2, Search, X, Paperclip, FileText, Image as ImageIcon, BookPlus, Copy, Check, FileCode2, TerminalSquare, Cpu, Lock as LockIcon, AlertTriangle, Save, RotateCcw, Terminal } from 'lucide-react';
import { Book, Chapter, AuthUser } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { extractChatFileText, fileToBase64 } from '../utils/extractChatFileText';
import {
  renderTemplate,
  usedPlaceholders,
  type PromptPlaceholderValues,
} from '../../server/promptTemplates';
import type { CoreModuleKey } from '../../server/coreAiRegistry';

interface QuickAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  authUser?: AuthUser | null;
  /**
   * «Передати текст у книгу» (виділення в чаті → кінець розділу). Власник
   * (App.tsx) сам дописує книгу, одразу відкриває редактор на цій секції й
   * виділяє вставлений фрагмент — тут лише передаємо, ЩО і КУДИ.
   */
  onSendTextToChapter?: (chapterId: string, text: string) => void;
  /**
   * Знімок "сонечка" (DraggableSun → кнопка «Скріншот для AI»), який чекає
   * прикріплення в чат — власник (App.tsx) відкриває модалку й передає файл
   * сюди; модалка сама прикріплює його й одразу підказує текст повідомлення.
   */
  pendingAttachmentFile?: File | null;
  /** Викликається одразу після того, як файл прикріплено — щоб власник обнулив свій стан. */
  onAttachmentConsumed?: () => void;
  /**
   * Контекст фото, з яким конструктор промтів відкрили з меню правого
   * кліку в редакторі розділу. Заданий — модалка одразу відкривається на
   * вкладці конструктора, з потрібною кількістю абзаців і живим
   * контекстом саме цього зображення.
   */
  promptContext?: PromptConstructorContext | null;
  /** «Зберегти й згенерувати» — власник (App.tsx) закриває вікно й просить редактор догенерувати текст за тим самим фото. */
  onPromptSavedAndGenerate?: () => void;
  /**
   * Записує зміну книги (той самий колбек, що й в EditorView.tsx). Потрібен
   * лише для того, щоб зберегти `book.preferredAiModelId` при зміні моделі
   * в селекторі — «рушій книги» для решти AI-ядра (наразі: аналіз фото в
   * редакторі розділу). Не задано — селектор далі працює як і раніше,
   * просто без запису вибору на рівні книги.
   */
  onUpdateBook?: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
}

const ALLOWED_ATTACHMENT_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'txt', 'md'];
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_MB = 8;

interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  extension: string;
  kind: 'image' | 'text';
  status: 'reading' | 'ready' | 'error';
  error?: string;
  mimeType?: string;
  base64?: string;
  textContent?: string;
}

interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
  /** Модель, яка відповіла (для реплік асистента). */
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** Оціночні токени автора (реальні рахує сервер). */
  estimated?: boolean;
}

interface ChatSessionSummary {
  id: string;
  title: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  updatedAt: string;
}

interface ChatModelOption {
  id: string;
  label: string;
  provider: string;
  available: boolean;
  /** Рушій моделі (gemini/gpt/claude/deepseek/groq/mistral) — сервер завжди його віддає (server/chatProviders.ts::CHAT_MODELS), тут лише типізовано. */
  engine?: string;
  /** Ціна за мільйон токенів (server/pricing.ts) — щоб автор бачив різницю вартості ПЕРЕД вибором моделі. */
  inputPerMillionUsd?: number | null;
  outputPerMillionUsd?: number | null;
}

/** «$2/$10 за млн» — компактний запис ціни моделі для селектора. */
function formatModelPrice(m: ChatModelOption): string {
  if (m.inputPerMillionUsd == null || m.outputPerMillionUsd == null) return '';
  const fmt = (n: number) => (n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 1 : 0));
  return `$${fmt(m.inputPerMillionUsd)}/$${fmt(m.outputPerMillionUsd)} за млн`;
}

const guestHistoryKey = 'nova_assistant_chat_guest';

/** Груба оцінка токенів тексту (~4 символи/токен) — як у Modul_token PricingService. */
function estimateTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  return Math.max(1, Math.round(chars / 4) + Math.round(words / 2));
}

/**
 * AI-асистент письменника.
 *
 * Фаза 3.2 дала цьому чату пам'ять у localStorage. Тепер для
 * зареєстрованих авторів історія живе в БАЗІ (chat_sessions /
 * chat_messages, server/chatRoutes.ts): розмови переживають зміну
 * пристрою, їх можна вести кілька паралельно, і кожна показує
 * накопичену вартість у токенах і доларах.
 *
 * Гостьовий режим свідомо лишили на localStorage: у гостя немає
 * user.id, тож прив'язати сесію в БД нема до чого — але й позбавляти
 * його асистента через це не варто.
 */

/* =====================================================================
   КОНСТРУКТОР ПРОМТІВ — адмінська вкладенка в AI-асистенті
   Показує, ЯК саме формується промпт до моделі ШІ: ліворуч форма
   параметрів, праворуч — живий перегляд системної інструкції, промпту
   користувача та JSON-payload запиту. Перший конструктор — «Аналіз фото →
   AI-текст книги» (той самий server/manuscriptImagePrompt.ts, що викликає
   сервер для правого кліку по зображенню в редакторі розділу). Нові
   конструктори додаються простою декларацією в PROMPT_CONSTRUCTORS.
   ===================================================================== */

interface TemplatesResponse {
  canEdit: boolean;
  isAdmin: boolean;
  hasOwnLayer: boolean;
  placeholders: string[];
  maxChars: number;
  factory: Record<'1' | '2' | '3', { system: string; user: string }>;
  effective: Record<'1' | '2' | '3', { system: string; user: string }>;
}

/** Контекст фото, з яким конструктор відкрили з меню правого кліку в редакторі. */
export interface PromptConstructorContext {
  paragraphCount: 1 | 2 | 3;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  imageCaption?: string;
  contextBefore?: string;
  contextAfter?: string;
}

const COUNTS: ('1' | '2' | '3')[] = ['1', '2', '3'];

/**
 * Конструктор промтів: редактор ЖИВОГО тексту промту, який реально піде в
 * модель за правим кліком по фото в редакторі розділу.
 *
 * Шаблонів три — по одному на 1, 2 і 3 абзаци: автор редагує текст
 * інструкції, а текст не параметризується числом. Мова лишається
 * параметром усередині шаблону (плейсхолдер {МОВА}).
 *
 * Шари й те, хто що редагує, — на сервері (server/promptTemplates.ts):
 * адмін пише глобальний дефолт для всіх авторів, автор на Pro/Ultra —
 * свій власний шар поверх нього.
 */
const PromptConstructorPanel: React.FC<{
  book: Book;
  onClose: () => void;
  models: ChatModelOption[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isRegistered: boolean;
  /** Заданий, якщо конструктор відкрили з меню фото — тоді з'являється «Зберегти й згенерувати». */
  photoContext?: PromptConstructorContext | null;
  onSaveAndGenerate?: () => void;
}> = ({ book, onClose, models, selectedModel, onSelectModel, isRegistered, photoContext, onSaveAndGenerate }) => {
  const { t } = useLanguage();

  const [meta, setMeta] = useState<TemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** Текст помилки завантаження шаблонів — окремо від «немає доступу за тарифом». */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { system: string; user: string }>>({});
  const [activeCount, setActiveCount] = useState<'1' | '2' | '3'>(
    photoContext ? (String(photoContext.paragraphCount) as '1' | '2' | '3') : '2'
  );
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copied, setCopied] = useState<'prompt' | 'payload' | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState<'uk' | 'en'>('uk');
  const userRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await fetch('/api/ai/prompt-templates', { credentials: 'same-origin' });
    // Сервер зі старою збіркою віддає на цей шлях HTML самого застосунку
    // (SPA-фолбек Vite), а не JSON. Мовчазний catch показував би тоді
    // тарифну заглушку — тобто «купіть Pro» замість «сервер не оновлено»,
    // і причину неможливо було б відрізнити від справжнього обмеження.
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      throw new Error(`prompt-templates: HTTP ${res.status}, content-type ${contentType || '—'}`);
    }
    const data = (await res.json()) as TemplatesResponse;
    setMeta(data);
    setDrafts({ ...data.effective });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const draft = drafts[activeCount] || { system: '', user: '' };
  const setDraft = (patch: Partial<{ system: string; user: string }>) =>
    setDrafts((prev) => ({ ...prev, [activeCount]: { ...prev[activeCount], ...patch } }));

  /**
   * Значення для живого перегляду. Коли конструктор відкрили з фото —
   * це РЕАЛЬНИЙ контекст того зображення, тож автор бачить саме той
   * промпт, який піде в модель, а не абстрактний зразок.
   */
  const previewValues: PromptPlaceholderValues = useMemo(
    () => ({
      language: previewLanguage,
      paragraphCount: Number(activeCount) as 1 | 2 | 3,
      bookTitle: photoContext?.bookTitle || book.title,
      genre: photoContext?.genre || book.genre,
      chapterTitle: photoContext?.chapterTitle,
      imageCaption: photoContext?.imageCaption,
      // Файл стилю сервер підмішує сам із user_styles — тут показуємо,
      // що саме стане на місце плейсхолдера, не розкриваючи чужих даних.
      styleGuide: t('quickAi.promptConstructor.stylePreviewStub'),
      contextBefore: photoContext?.contextBefore,
      contextAfter: photoContext?.contextAfter,
    }),
    [previewLanguage, activeCount, photoContext, book.title, book.genre, t]
  );

  const previewSystem = useMemo(() => renderTemplate(draft.system, previewValues), [draft.system, previewValues]);
  const previewUser = useMemo(() => renderTemplate(draft.user, previewValues), [draft.user, previewValues]);

  const usedInUser = useMemo(() => usedPlaceholders(draft.user), [draft.user]);
  const usedInSystem = useMemo(() => usedPlaceholders(draft.system), [draft.system]);
  const noPlaceholders = usedInUser.length === 0 && usedInSystem.length === 0;

  const payload = useMemo(
    () => ({
      endpoint: '/api/ai/generate-manuscript-paragraphs-from-image',
      method: 'POST',
      imageUrl: '<зображення з рукопису: data: / /generated/ / http…>',
      modelId: book.preferredAiModelId || '<«рушій книги» — остання модель чату>',
      paragraphCount: Number(activeCount),
      language: previewLanguage,
      bookTitle: previewValues.bookTitle,
      genre: previewValues.genre,
      chapterTitle: previewValues.chapterTitle,
      imageCaption: previewValues.imageCaption,
      bookId: book.id,
      contextBefore: previewValues.contextBefore,
      contextAfter: previewValues.contextAfter,
    }),
    [activeCount, previewLanguage, previewValues, book.preferredAiModelId, book.id]
  );

  const copy = async (kind: 'prompt' | 'payload') => {
    const text = kind === 'prompt' ? `${previewSystem}\n\n${previewUser}` : JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard недоступний — кнопка просто не скопіює */
    }
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };

  const persist = async (): Promise<boolean> => {
    setSaving('saving');
    try {
      const res = await fetch('/api/ai/prompt-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ templates: { manuscriptPhoto: drafts } }),
      });
      if (!res.ok) throw new Error('save failed');
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 2000);
      return true;
    } catch {
      setSaving('idle');
      return false;
    }
  };

  /** «Відновити налаштування адміна» — прибирає власний шар і перечитує те, що діє після цього. */
  const restore = async () => {
    try {
      await fetch('/api/ai/prompt-templates', { method: 'DELETE', credentials: 'same-origin' });
      const res = await fetch('/api/ai/prompt-templates', { credentials: 'same-origin' });
      const data = (await res.json()) as TemplatesResponse;
      setMeta(data);
      setDrafts({ ...data.effective });
    } catch {
      /* мережа впала — лишаємо чернетку як є */
    }
  };

  /** Вставляє плейсхолдер у промпт користувача на позицію курсора. */
  const insertPlaceholder = (token: string) => {
    const el = userRef.current;
    if (!el) {
      setDraft({ user: `${draft.user}${token}` });
      return;
    }
    const start = el.selectionStart ?? draft.user.length;
    const end = el.selectionEnd ?? start;
    const next = draft.user.slice(0, start) + token + draft.user.slice(end);
    setDraft({ user: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const header = (
    <div className="p-4 nm-outset-sm flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
          <Cpu className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-[var(--on-surface)] truncate">
            {t('quickAi.promptConstructor.heading')}
          </h3>
          <p className="text-[11px] text-[var(--outline)] truncate">
            {meta?.isAdmin
              ? t('quickAi.promptConstructor.adminScopeHint')
              : t('quickAi.promptConstructor.subheading')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isRegistered && (
          <select
            value={selectedModel || models[0]?.id || ''}
            onChange={(e) => onSelectModel(e.target.value)}
            title={t('quickAi.modelSelectTitle')}
            className="min-w-[200px] max-w-[300px] nm-outset-xs rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[var(--on-surface)] bg-transparent outline-none cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.label}
                {formatModelPrice(m) ? ` · ${formatModelPrice(m)}` : ''}
                {m.available ? '' : ` (${t('quickAi.modelWithoutKey')})`}
              </option>
            ))}
          </select>
        )}
        <button onClick={onClose} className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--outline)]">
          {t('quickAi.promptConstructor.loading')}
        </div>
      </div>
    );
  }

  // Шаблони не завантажились. Це НЕ те саме, що «немає доступу за
  // тарифом», і показувати тут заглушку підписки означало б збрехати про
  // причину — найчастіше це просто сервер, запущений зі старою збіркою.
  if (loadError) {
    return (
      <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="nm-outset rounded-2xl p-6 max-w-md text-center space-y-3">
            <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
            <h4 className="text-[15px] font-bold text-[var(--on-surface)]">
              {t('quickAi.promptConstructor.loadFailedTitle')}
            </h4>
            <p className="text-[12px] text-[var(--outline)] leading-relaxed">
              {t('quickAi.promptConstructor.loadFailedDesc')}
            </p>
            <p className="text-[10px] font-mono text-[var(--outline)] break-all nm-inset rounded-lg px-2.5 py-1.5">
              {loadError}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                load()
                  .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setLoading(false));
              }}
              className="nm-btn px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--primary)] inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('quickAi.promptConstructor.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Free та гість: вкладка видима, але замість форми — чесна заглушка з
  // переходом на підписку (той самий патерн, що в «Форматуванні рукопису»).
  if (!meta?.canEdit) {
    return (
      <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="nm-outset rounded-2xl p-6 max-w-md text-center space-y-3">
            <LockIcon className="w-8 h-8 mx-auto text-[var(--primary)]" />
            <h4 className="text-[15px] font-bold text-[var(--on-surface)]">
              {t('quickAi.promptConstructor.lockedTitle')}
            </h4>
            <p className="text-[12px] text-[var(--outline)] leading-relaxed">
              {t('quickAi.promptConstructor.lockedDesc')}
            </p>
            <p className="text-[11px] text-[var(--outline)] leading-relaxed italic">
              {t('quickAi.promptConstructor.lockedStillWorks')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
      {header}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {/* Який саме шаблон редагуємо: 1, 2 чи 3 абзаци */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[11px] font-semibold text-[var(--outline)]">
            {t('quickAi.promptConstructor.templateFor')}
          </span>
          {COUNTS.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCount(c)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                c === activeCount
                  ? 'nm-inset text-[var(--primary)]'
                  : 'nm-btn text-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{t(`quickAi.promptConstructor.paragraphs${c}`)}</span>
            </button>
          ))}

          <div className="flex-1" />

          <select
            value={previewLanguage}
            onChange={(e) => setPreviewLanguage(e.target.value as 'uk' | 'en')}
            title={t('quickAi.promptConstructor.previewLanguageTitle')}
            className="nm-inset rounded-lg px-2.5 py-1.5 text-[11px] bg-transparent text-[var(--on-surface)] outline-none cursor-pointer"
          >
            <option value="uk">{t('quickAi.promptConstructor.languageUk')}</option>
            <option value="en">{t('quickAi.promptConstructor.languageEn')}</option>
          </select>
        </div>

        {photoContext && (
          <div className="mb-4 nm-inset rounded-xl px-3 py-2 text-[11px] text-[var(--on-surface)] flex items-start gap-2">
            <ImageIcon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--primary)]" />
            <span>{t('quickAi.promptConstructor.photoContextNote')}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {/* ---- Редактор шаблону ---- */}
          <div className="nm-outset rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span className="text-[13px] font-bold text-[var(--on-surface)]">
                {t('quickAi.promptConstructor.photoName')}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[var(--outline)] break-all nm-inset rounded-lg px-2.5 py-1.5">
              POST /api/ai/generate-manuscript-paragraphs-from-image
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                {t('quickAi.promptConstructor.systemLabel')}
              </label>
              <textarea
                rows={3}
                value={draft.system}
                maxLength={meta.maxChars}
                onChange={(e) => setDraft({ system: e.target.value })}
                className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] outline-none resize-y font-mono"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-[var(--on-surface)]">
                  {t('quickAi.promptConstructor.userPromptLabel')}
                </label>
                <span
                  className={`text-[10px] font-mono ${
                    draft.user.length > meta.maxChars * 0.9 ? 'text-amber-500' : 'text-[var(--outline)]'
                  }`}
                >
                  {draft.user.length} / {meta.maxChars}
                </span>
              </div>
              <textarea
                ref={userRef}
                rows={14}
                value={draft.user}
                maxLength={meta.maxChars}
                onChange={(e) => setDraft({ user: e.target.value })}
                className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] outline-none resize-y font-mono leading-relaxed"
              />
            </div>

            {/* Плейсхолдери — клік вставляє на позицію курсора */}
            <div>
              <p className="text-[10px] text-[var(--outline)] mb-1.5">
                {t('quickAi.promptConstructor.placeholdersHint')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {meta.placeholders.map((p) => {
                  const used = (usedInUser as string[]).includes(p) || (usedInSystem as string[]).includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => insertPlaceholder(p)}
                      title={t('quickAi.promptConstructor.insertPlaceholder')}
                      className={`px-2 py-1 rounded-md text-[10px] font-mono transition-all ${
                        used ? 'nm-inset text-[var(--primary)]' : 'nm-btn text-[var(--outline)]'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {noPlaceholders && (
              <div className="flex items-start gap-2 text-[11px] text-amber-500 nm-inset rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{t('quickAi.promptConstructor.noPlaceholdersWarning')}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void persist()}
                disabled={saving === 'saving'}
                className="nm-btn px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--primary)] flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving === 'saved' ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saving === 'saved'
                  ? t('quickAi.promptConstructor.saved')
                  : t('quickAi.promptConstructor.save')}
              </button>

              {photoContext && onSaveAndGenerate && (
                <button
                  onClick={async () => {
                    if (await persist()) onSaveAndGenerate();
                  }}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[var(--primary)] text-[var(--on-primary)] flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('quickAi.promptConstructor.saveAndGenerate')}
                </button>
              )}

              <div className="flex-1" />

              <button
                onClick={() => void restore()}
                className="nm-btn px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--outline)] flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {meta.isAdmin
                  ? t('quickAi.promptConstructor.restoreFactory')
                  : t('quickAi.promptConstructor.restoreAdmin')}
              </button>
            </div>
          </div>

          {/* ---- Живий перегляд: що РЕАЛЬНО піде в модель ---- */}
          <div className="space-y-3">
            <div className="nm-outset rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                  <TerminalSquare className="w-3.5 h-3.5" /> {t('quickAi.promptConstructor.systemLabel')}
                </span>
              </div>
              <pre className="text-[11px] leading-relaxed text-[var(--on-surface)] whitespace-pre-wrap font-mono nm-inset rounded-xl p-3 max-h-32 overflow-y-auto">
                {previewSystem || '—'}
              </pre>
            </div>

            <div className="nm-outset rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5" /> {t('quickAi.promptConstructor.userPromptLabel')}
                </span>
                <button
                  onClick={() => copy('prompt')}
                  title={t('quickAi.promptConstructor.copyPrompt')}
                  className="nm-btn p-1.5 rounded-lg text-[var(--primary)] shrink-0"
                >
                  {copied === 'prompt' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <pre className="text-[11px] leading-relaxed text-[var(--on-surface)] whitespace-pre-wrap font-mono nm-inset rounded-xl p-3 max-h-80 overflow-y-auto">
                {previewUser || '—'}
              </pre>
            </div>

            <div className="nm-outset rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> {t('quickAi.promptConstructor.payloadLabel')}
                </span>
                <button
                  onClick={() => copy('payload')}
                  title={t('quickAi.promptConstructor.copyPayload')}
                  className="nm-btn p-1.5 rounded-lg text-[var(--primary)] shrink-0"
                >
                  {copied === 'payload' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <pre className="text-[11px] leading-relaxed text-[var(--on-surface)] whitespace-pre-wrap font-mono nm-inset rounded-xl p-3 max-h-56 overflow-y-auto">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


interface CoreTemplatesResponse {
  modules: CoreModuleKey[];
  placeholders: Record<CoreModuleKey, string[]>;
  hasJsonSchema: Record<CoreModuleKey, boolean>;
  maxChars: number;
  factory: Record<CoreModuleKey, { system: string; user: string }>;
  effective: Record<CoreModuleKey, { system: string; user: string }>;
  schemaSuffix: Record<CoreModuleKey, string>;
  hasAdminLayer: boolean;
}

interface CoreTestCallResult {
  text: string;
  renderedSystem: string;
  renderedUser: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  engine: string;
  modelId: string;
}

const CORE_MODULE_LABELS: Record<CoreModuleKey, string> = {
  chat: 'Чат-асистент',
  textFromImage: 'Текст за фото (Ілюстрації)',
  kdp: 'Верстка KDP',
  illustrationPromptCraft: 'Промпт ілюстрації',
  characterPromptCraft: 'Промпт персонажа',
  characterBioPrompt: 'Біографія персонажа',
  synopsisToChapter: 'Синопсис → глава',
};

const CORE_MODULE_DESCRIPTIONS: Record<CoreModuleKey, string> = {
  chat: 'Системна інструкція AI-асистента в чаті. Формат історії розмови — окремий протокол, не редагується.',
  textFromImage: 'Текст сцени за фото на вкладці «Ілюстрації» (окремо від правого кліку по фото в тексті розділу).',
  kdp: 'Форматування готового рукопису під Amazon KDP. Модель повертає JSON із главами — схема не редагується.',
  illustrationPromptCraft: 'Уривок тексту → англомовний промпт для генерації ілюстрації. Схема відповіді не редагується.',
  characterPromptCraft: 'Дані персонажа → англомовний промпт для генерації портрета. Схема відповіді не редагується.',
  characterBioPrompt: 'Опис ідеї → повна біографія й характеристика персонажа. Схема відповіді не редагується.',
  synopsisToChapter: 'НОВИЙ модуль: синопсис → чернетка тексту глави. Поки лише тут, без кнопки в інтерфейсі письменника.',
};

/** Плейсхолдер → поле тестових вхідних даних. Одна мапа обслуговує форму й підказки одразу для всіх модулів. */
const CORE_FIELD_DEFS: Record<string, { key: string; label: string; textarea?: boolean; placeholder?: string }> = {
  '{СТИЛЬ}': { key: 'styleGuide', label: 'Файл стилю (зразок)', textarea: true },
  '{НАЗВА_КНИГИ}': { key: 'bookTitle', label: 'Назва книги' },
  '{ЖАНР}': { key: 'genre', label: 'Жанр' },
  '{СИНОПСИС}': { key: 'synopsis', label: 'Синопсис', textarea: true },
  '{РОЗДІЛ}': { key: 'chapterTitle', label: 'Розділ' },
  '{ПІДКАЗКА}': { key: 'captionHint', label: 'Підказка автора' },
  '{АВТОР}': { key: 'author', label: 'Автор' },
  '{РУКОПИС}': { key: 'manuscriptText', label: 'Тестовий фрагмент рукопису', textarea: true },
  '{МОДЕЛЬ}': { key: 'modelLabel', label: 'Назва image-моделі (лише текст у промпті)', placeholder: 'nano-banana' },
  '{СТИЛЬ_ПРЕСЕТ}': { key: 'stylePreset', label: 'Стильовий пресет', placeholder: 'cyberpunk-photoreal' },
  '{СПІВВІДНОШЕННЯ}': { key: 'aspectRatio', label: 'Співвідношення сторін', placeholder: '16:9' },
  '{VISUAL_BIBLE}': { key: 'visualBibleJson', label: 'Visual Bible (JSON)', textarea: true },
  '{ТЕКСТ}': { key: 'selectedText', label: 'Виділений уривок тексту', textarea: true },
  '{ІМ_Я}': { key: 'characterName', label: "Ім'я персонажа" },
  '{ПРІЗВИЩЕ}': { key: 'characterSurname', label: 'Прізвище персонажа' },
  '{РОЛЬ}': { key: 'characterRole', label: 'Роль' },
  '{ПРОФЕСІЯ}': { key: 'characterProfession', label: 'Професія' },
  '{ЗОВНІШНІСТЬ}': { key: 'appearanceJson', label: 'Зовнішність (JSON)', textarea: true },
  '{ПСИХОЛОГІЯ}': { key: 'personalityJson', label: 'Психологія (JSON)', textarea: true },
  '{ОПИС}': { key: 'promptDescription', label: 'Опис ідеї персонажа', textarea: true },
  '{ОБСЯГ}': { key: 'wordBudget', label: 'Обсяг (слів)', placeholder: '800-1500' },
};

/**
 * Третя вкладка конструктора — «Ядро AI (адмін)» (Q16 grilling-сесії).
 * Виключно для адміна: сім модулів ядра, кожен — рівно ОДИН шаблон
 * `{system, user}` (не варіанти '1'/'2'/'3', як у фото-конструктора).
 * Правки одразу впливають на реальні виклики решти сайту (Q6) — тому тут
 * є РЕАЛЬНИЙ тестовий виклик (Q11/Q14), не лише текстовий прев'ю.
 */
/** Одне зображення медіатеки книги — ті самі три джерела, що й InsertImageModal.tsx / MediaLibraryView.tsx. */
interface CoreMediaItem {
  id: string;
  url: string;
  title: string;
}

/** Усі зображення книги для пікера «Текст за фото» — обкладинка, портрети героїв, ілюстрації розділів. */
function collectBookMedia(book: Book): CoreMediaItem[] {
  const items: CoreMediaItem[] = [];
  if (book.coverConfig?.frontArtUrl) {
    items.push({ id: 'cover-front', url: book.coverConfig.frontArtUrl, title: 'Обкладинка' });
  }
  book.characters.forEach((c) => {
    if (c.avatarUrl) items.push({ id: `char-${c.id}`, url: c.avatarUrl, title: `${c.name} ${c.surname || ''}`.trim() });
  });
  (book.illustrations || []).forEach((ill) => {
    items.push({ id: ill.id, url: ill.url, title: ill.caption || 'Без підпису' });
  });
  return items;
}

const CoreAiPanel: React.FC<{
  book: Book;
  onClose: () => void;
  models: ChatModelOption[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
}> = ({ book, onClose, models, selectedModel, onSelectModel }) => {
  const { t } = useLanguage();

  const [meta, setMeta] = useState<CoreTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<CoreModuleKey>('chat');
  const [drafts, setDrafts] = useState<Record<string, { system: string; user: string }>>({});
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [testFields, setTestFields] = useState<Record<string, Record<string, string>>>({});
  const [testResult, setTestResult] = useState<CoreTestCallResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  /** Пікер медіатеки для «Текст за фото» — відкритий/закритий стан окремо від самих тестових полів. */
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const bookMedia = useMemo(() => collectBookMedia(book), [book]);

  /** «Згенерувати персонажа» після тестового виклику «Промпт персонажа» — окремий, реальний виклик генерації арту. */
  const [charGenLoading, setCharGenLoading] = useState(false);
  const [charGenError, setCharGenError] = useState<string | null>(null);
  const [charGenResult, setCharGenResult] = useState<{ imageUrl: string; modelUsed: string } | null>(null);
  /**
   * Рушій ГЕНЕРАЦІЇ КАРТИНКИ (Nano Banana Lite/2/Pro, Seedream) — окремий
   * від рушія ТЕКСТУ, обраного вгорі панелі. Раніше кнопка мовчки йшла на
   * дефолтний рушій без жодного вибору; тепер, як і для тексту в чаті, є
   * явний селектор із живою доступністю (є ключ чи нема).
   */
  const [imageEngines, setImageEngines] = useState<{ id: string; label: string; provider: string; available: boolean }[]>([]);
  const [selectedImageEngine, setSelectedImageEngine] = useState('');
  useEffect(() => {
    fetch('/api/ai/image-engines', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        const engines = data?.engines || [];
        setImageEngines(engines);
        setSelectedImageEngine((prev) => prev || engines.find((e: any) => e.available)?.id || engines[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await fetch('/api/ai/core-prompt-templates', { credentials: 'same-origin' });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      throw new Error(`core-prompt-templates: HTTP ${res.status}, content-type ${contentType || '—'}`);
    }
    const data = (await res.json()) as CoreTemplatesResponse;
    setMeta(data);
    setDrafts({ ...data.effective });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const draft = drafts[activeModule] || { system: '', user: '' };
  const setDraft = (patch: Partial<{ system: string; user: string }>) =>
    setDrafts((prev) => ({ ...prev, [activeModule]: { ...prev[activeModule], ...patch } }));

  const fields = testFields[activeModule] || {};
  const setField = (key: string, value: string) =>
    setTestFields((prev) => ({ ...prev, [activeModule]: { ...prev[activeModule], [key]: value } }));

  const isChat = activeModule === 'chat';
  const hasSchema = meta?.hasJsonSchema[activeModule] ?? false;
  const schemaSuffix = meta?.schemaSuffix[activeModule] || '';
  const placeholders = meta?.placeholders[activeModule] || [];
  const usedInSystem = useMemo(
    () => placeholders.filter((p) => draft.system.includes(p)),
    [placeholders, draft.system]
  );
  const usedInUser = useMemo(
    () => placeholders.filter((p) => draft.user.includes(p)),
    [placeholders, draft.user]
  );
  const noPlaceholders = !isChat && usedInSystem.length === 0 && usedInUser.length === 0;

  const selectedModelInfo = models.find((m) => m.id === (selectedModel || models[0]?.id));

  // Прогноз вартості ДО виклику — груба оцінка символів (Q19 grilling-сесії):
  // орієнтовний, не точний. Точний рахунок з'являється лише після реального виклику.
  const estimate = useMemo(() => {
    const testPromptLen = isChat
      ? (fields.testMessage || '').length + (fields.prevAssistantReply || '').length
      : draft.user.length;
    const estIn = estimateTokens(draft.system) + estimateTokens(' '.repeat(testPromptLen));
    const estOut = 500; // типовий вихід — грубе орієнтування, точні дані лише після виклику
    if (!selectedModelInfo?.inputPerMillionUsd || !selectedModelInfo?.outputPerMillionUsd) return null;
    const cost =
      (estIn / 1_000_000) * selectedModelInfo.inputPerMillionUsd +
      (estOut / 1_000_000) * selectedModelInfo.outputPerMillionUsd;
    return { estIn, estOut, cost };
  }, [draft.system, draft.user, fields.testMessage, fields.prevAssistantReply, isChat, selectedModelInfo]);

  const persist = async (): Promise<boolean> => {
    setSaving('saving');
    try {
      const res = await fetch('/api/ai/core-prompt-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ module: activeModule, template: draft }),
      });
      if (!res.ok) throw new Error('save failed');
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 2000);
      await load();
      return true;
    } catch {
      setSaving('idle');
      return false;
    }
  };

  const restoreFactory = async () => {
    try {
      await fetch(`/api/ai/core-prompt-templates?module=${activeModule}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      await load();
    } catch {
      /* мережа впала — лишаємо чернетку як є */
    }
  };

  const insertPlaceholder = (token: string, target: 'system' | 'user') => {
    setDraft({ [target]: `${draft[target]}${draft[target] && !draft[target].endsWith('\n') ? ' ' : ''}${token}` });
  };

  const runTestCall = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    setCharGenResult(null);
    setCharGenError(null);
    try {
      const res = await fetch('/api/ai/core-prompt-templates/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          module: activeModule,
          template: draft,
          fields,
          modelId: selectedModel || models[0]?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setTestResult(data as CoreTestCallResult);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  /**
   * «Промпт персонажа» повертає JSON із готовим текстовим промптом для
   * ПОРТРЕТА (не саму картинку). Якщо відповідь справді розпізнається як
   * такий JSON — з'являється кнопка, що передає цей промпт напряму в
   * реальну генерацію арту (той самий /api/ai/generate-character-art, що
   * вже вміє прийняти готовий текстовий prompt без character-об'єкта).
   */
  const craftedCharacterPrompt = useMemo(() => {
    if (activeModule !== 'characterPromptCraft' || !testResult?.text) return null;
    try {
      const parsed = JSON.parse(testResult.text.trim());
      return typeof parsed?.prompt === 'string' && parsed.prompt.trim() ? parsed : null;
    } catch {
      return null;
    }
  }, [activeModule, testResult]);

  const runGenerateCharacterFromPrompt = async () => {
    if (!craftedCharacterPrompt) return;
    setCharGenLoading(true);
    setCharGenError(null);
    setCharGenResult(null);
    try {
      const res = await fetch('/api/ai/generate-character-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt: craftedCharacterPrompt.prompt,
          aspectRatio: craftedCharacterPrompt.recommendedAspect || '1:1',
          engine: selectedImageEngine || undefined,
          bookId: book.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error || !data?.imageUrl) {
        throw new Error(data?.error || 'Не вдалося згенерувати портрет.');
      }
      setCharGenResult({ imageUrl: data.imageUrl, modelUsed: data.modelUsed || '' });
    } catch (err) {
      setCharGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setCharGenLoading(false);
    }
  };

  const header = (
    <div className="p-4 nm-outset-sm flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
          <Terminal className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-[var(--on-surface)] truncate">Ядро AI (адмін)</h3>
          <p className="text-[11px] text-[var(--outline)] truncate">
            Правки тут одразу впливають на реальні виклики решти сайту
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={selectedModel || models[0]?.id || ''}
          onChange={(e) => onSelectModel(e.target.value)}
          className="min-w-[200px] max-w-[300px] nm-outset-xs rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[var(--on-surface)] bg-transparent outline-none cursor-pointer"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.label}
              {formatModelPrice(m) ? ` · ${formatModelPrice(m)}` : ''}
              {m.available ? '' : ' (без ключа)'}
            </option>
          ))}
        </select>
        <button onClick={onClose} className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--outline)]">
          Завантаження шаблонів…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="nm-outset rounded-2xl p-6 max-w-md text-center space-y-3">
            <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
            <h4 className="text-[15px] font-bold text-[var(--on-surface)]">Не вдалося завантажити шаблони</h4>
            <p className="text-[12px] text-[var(--outline)] leading-relaxed">
              Сервер не відповів на /api/ai/core-prompt-templates коректним JSON. Найчастіша причина — сервер
              запущено зі старою збіркою: перезапустіть його командою npm run dev.
            </p>
            <p className="text-[10px] font-mono text-[var(--outline)] break-all nm-inset rounded-lg px-2.5 py-1.5">
              {loadError}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                load()
                  .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setLoading(false));
              }}
              className="nm-btn px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--primary)] inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Спробувати ще раз
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!meta) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col nm-flat overflow-hidden">
      {header}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {meta.modules.map((m) => (
            <button
              key={m}
              onClick={() => {
                setActiveModule(m);
                setTestResult(null);
                setTestError(null);
                setCharGenResult(null);
                setCharGenError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                m === activeModule
                  ? 'nm-inset text-[var(--primary)]'
                  : 'nm-btn text-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
            >
              <span>{CORE_MODULE_LABELS[m]}</span>
            </button>
          ))}
        </div>

        <p className="text-[11px] text-[var(--outline)] mb-4 leading-snug">{CORE_MODULE_DESCRIPTIONS[activeModule]}</p>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {/* ---- Редактор шаблону ---- */}
          <div className="nm-outset rounded-2xl p-4 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                Системна інструкція
              </label>
              <textarea
                rows={6}
                value={draft.system}
                maxLength={meta.maxChars}
                onChange={(e) => setDraft({ system: e.target.value })}
                className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] outline-none resize-y font-mono leading-relaxed"
              />
              {hasSchema && schemaSuffix && (
                <div className="mt-2">
                  <p className="text-[10px] text-amber-500 mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Схема відповіді — жорстка, не редагується (видима для повної картини):
                  </p>
                  <pre className="text-[10px] leading-relaxed text-[var(--outline)] whitespace-pre-wrap font-mono nm-inset rounded-xl p-3 max-h-40 overflow-y-auto opacity-70 select-none">
                    {schemaSuffix}
                  </pre>
                </div>
              )}
            </div>

            {isChat ? (
              <div>
                <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                  Промпт користувача
                </label>
                <div className="w-full nm-inset rounded-xl px-3 py-2 text-[11px] text-[var(--outline)] italic">
                  {draft.user}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-[var(--on-surface)]">Промпт користувача</label>
                  <span
                    className={`text-[10px] font-mono ${
                      draft.user.length > meta.maxChars * 0.9 ? 'text-amber-500' : 'text-[var(--outline)]'
                    }`}
                  >
                    {draft.user.length} / {meta.maxChars}
                  </span>
                </div>
                <textarea
                  rows={10}
                  value={draft.user}
                  maxLength={meta.maxChars}
                  onChange={(e) => setDraft({ user: e.target.value })}
                  className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] outline-none resize-y font-mono leading-relaxed"
                />
              </div>
            )}

            {placeholders.length > 0 && (
              <div>
                <p className="text-[10px] text-[var(--outline)] mb-1.5">
                  Підстановки — клікніть, щоб дописати в кінець системної інструкції.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map((p) => {
                    const used = usedInSystem.includes(p) || usedInUser.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => insertPlaceholder(p, 'system')}
                        className={`px-2 py-1 rounded-md text-[10px] font-mono transition-all ${
                          used ? 'nm-inset text-[var(--primary)]' : 'nm-btn text-[var(--outline)]'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {noPlaceholders && (
              <div className="flex items-start gap-2 text-[11px] text-amber-500 nm-inset rounded-xl px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>У шаблоні немає жодної підстановки — контекст книги/персонажа в промпт НЕ потрапить.</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={() => void persist()}
                disabled={saving === 'saving'}
                className="nm-btn px-3 py-1.5 rounded-lg text-[11px] font-bold text-[var(--primary)] flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving === 'saved' ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saving === 'saved' ? 'Збережено' : 'Зберегти'}
              </button>
              <button
                onClick={() => void restoreFactory()}
                className="nm-btn px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--outline)] flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Відновити заводський шаблон
              </button>
            </div>
          </div>

          {/* ---- Тестовий виклик: РЕАЛЬНИЙ, не лише перегляд (Q11/Q14) ---- */}
          <div className="space-y-3">
            <div className="nm-outset rounded-2xl p-4 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Тестові вхідні дані
              </span>

              {isChat && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                      Тестова репліка автора
                    </label>
                    <textarea
                      rows={2}
                      value={fields.testMessage || ''}
                      onChange={(e) => setField('testMessage', e.target.value)}
                      placeholder="Як мені підсилити конфлікт у 3 главі?"
                      className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] placeholder:text-[var(--outline)] outline-none resize-y"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                      Попередня репліка асистента (опційно)
                    </label>
                    <textarea
                      rows={2}
                      value={fields.prevAssistantReply || ''}
                      onChange={(e) => setField('prevAssistantReply', e.target.value)}
                      className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] outline-none resize-y"
                    />
                  </div>
                </>
              )}

              {/* «Текст за фото» — vision-модуль: без самого фото тест перевіряє лише текстову половину промту. */}
              {activeModule === 'textFromImage' && (
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                    Фото для аналізу (з медіатеки книги)
                  </label>
                  {fields.imageUrl ? (
                    <div className="flex items-center gap-2 nm-inset rounded-xl p-2">
                      <img src={fields.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      <span className="text-[11px] text-[var(--outline)] truncate flex-1">
                        {bookMedia.find((m) => m.url === fields.imageUrl)?.title || 'Обране фото'}
                      </span>
                      <button
                        onClick={() => setField('imageUrl', '')}
                        className="nm-btn p-1.5 rounded-lg text-[var(--outline)] shrink-0"
                        title="Прибрати фото"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setMediaPickerOpen((v) => !v)}
                      className="w-full nm-btn rounded-xl px-3 py-2 text-[12px] text-[var(--outline)] flex items-center justify-center gap-1.5"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Обрати фото з медіатеки
                    </button>
                  )}

                  {mediaPickerOpen && !fields.imageUrl && (
                    <div className="mt-2 nm-inset rounded-xl p-2 max-h-52 overflow-y-auto grid grid-cols-4 gap-2">
                      {bookMedia.length === 0 ? (
                        <p className="col-span-4 text-[11px] text-[var(--outline)] text-center py-4">
                          У книзі ще немає жодного зображення — додайте ілюстрацію чи портрет персонажа.
                        </p>
                      ) : (
                        bookMedia.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setField('imageUrl', m.url);
                              setMediaPickerOpen(false);
                            }}
                            title={m.title}
                            className="aspect-square rounded-lg overflow-hidden nm-btn"
                          >
                            <img src={m.url} alt={m.title} className="w-full h-full object-cover" />
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {placeholders
                .filter((p) => CORE_FIELD_DEFS[p])
                .map((p) => {
                  const def = CORE_FIELD_DEFS[p];
                  return (
                    <div key={p}>
                      <label className="block text-[11px] font-semibold text-[var(--on-surface)] mb-1">
                        {def.label}
                      </label>
                      {def.textarea ? (
                        <textarea
                          rows={3}
                          value={fields[def.key] || ''}
                          onChange={(e) => setField(def.key, e.target.value)}
                          placeholder={def.placeholder}
                          className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] placeholder:text-[var(--outline)] outline-none resize-y"
                        />
                      ) : (
                        <input
                          type="text"
                          value={fields[def.key] || ''}
                          onChange={(e) => setField(def.key, e.target.value)}
                          placeholder={def.placeholder}
                          className="w-full nm-inset rounded-xl px-3 py-2 text-[12px] bg-transparent text-[var(--on-surface)] placeholder:text-[var(--outline)] outline-none"
                        />
                      )}
                    </div>
                  );
                })}

              {estimate && (
                <p className="text-[10px] text-[var(--outline)]">
                  Орієнтовна вартість: ~{estimate.estIn.toLocaleString('uk-UA')} вх + ~
                  {estimate.estOut.toLocaleString('uk-UA')} вих токенів ≈ ${estimate.cost.toFixed(4)}
                </p>
              )}

              <button
                onClick={() => void runTestCall()}
                disabled={testing}
                className="w-full px-3 py-2 rounded-lg text-[12px] font-bold bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Тестовий виклик (реальний, за гроші)
              </button>
            </div>

            {testError && (
              <div className="nm-outset rounded-2xl p-4 text-[11px] text-rose-400">{testError}</div>
            )}

            {testResult && (
              <div className="nm-outset rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] flex items-center gap-1.5">
                    <TerminalSquare className="w-3.5 h-3.5" /> Відповідь моделі
                  </span>
                  <span className="text-[10px] text-[var(--outline)]">
                    {testResult.inputTokens} вх + {testResult.outputTokens} вих токенів ≈ $
                    {testResult.costUsd.toFixed(4)}
                  </span>
                </div>
                <pre className="text-[11px] leading-relaxed text-[var(--on-surface)] whitespace-pre-wrap font-mono nm-inset rounded-xl p-3 max-h-72 overflow-y-auto">
                  {testResult.text}
                </pre>

                {/* «Промпт персонажа» дав готовий текстовий промпт портрета — доводимо цикл до реальної картинки, без повторного набору вручну. */}
                {craftedCharacterPrompt && (
                  <div className="pt-2 border-t border-[var(--outline)]/20 space-y-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-[var(--outline)] mb-1">
                        Рушій генерації картинки
                      </label>
                      <select
                        value={selectedImageEngine}
                        onChange={(e) => setSelectedImageEngine(e.target.value)}
                        className="w-full nm-inset rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[var(--on-surface)] bg-transparent outline-none cursor-pointer"
                      >
                        {imageEngines.map((eng) => (
                          <option key={eng.id} value={eng.id} disabled={!eng.available}>
                            {eng.label}
                            {eng.available ? '' : ' (без ключа)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => void runGenerateCharacterFromPrompt()}
                      disabled={charGenLoading}
                      className="w-full px-3 py-2 rounded-lg text-[12px] font-bold bg-[var(--primary)] text-[var(--on-primary)] flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {charGenLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="w-3.5 h-3.5" />
                      )}
                      Згенерувати персонажа за цим промптом
                    </button>

                    {charGenError && <p className="text-[11px] text-rose-400">{charGenError}</p>}

                    {charGenResult && (
                      <div className="flex items-center gap-3">
                        <img
                          src={charGenResult.imageUrl}
                          alt="Згенерований портрет"
                          className="w-24 h-24 rounded-xl object-cover border-2 border-[var(--primary)] shrink-0"
                        />
                        <span className="text-[11px] text-[var(--outline)]">
                          {charGenResult.modelUsed || 'Портрет згенеровано'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


export const QuickAiModal: React.FC<QuickAiModalProps> = ({
  isOpen,
  onClose,
  book,
  authUser,
  onSendTextToChapter,
  pendingAttachmentFile,
  onAttachmentConsumed,
  onUpdateBook,
  promptContext = null,
  onPromptSavedAndGenerate,
}) => {
  const { t, lang } = useLanguage();
  const isRegistered = !!authUser?.id && !authUser.isGuest;
  const isAdmin = !!authUser && !authUser.isGuest && authUser.role === 'admin';
  const [activePanel, setActivePanel] = useState<'chat' | 'prompts' | 'core'>('chat');
  // Щоразу, коли модалка відкривається, повертаємось на вкладку «Чат».
  useEffect(() => {
    if (isOpen) setActivePanel(promptContext ? 'prompts' : 'chat');
  }, [isOpen]);
  const welcomeMessage: ChatMessage = { sender: 'ai', text: t('quickAi.welcomeMessage', { title: book.title }) };

  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSessionSummary | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  // --- Вкладені файли (кнопка-скріпка): jpg/png йдуть у vision-запит, pdf/txt/md — текстом ---
  const [attachedFiles, setAttachedFiles] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Виділення тексту → «Передати текст у книгу» ---
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 'auto' (миттєво), а не 'smooth': анімований скрол залежить від
    // безперервного рендеру кадрів компоузером і не завершується на
    // фонових/неактивних вкладках чи при увімкненому «зменшити рух» —
    // миттєвий скрол спрацьовує завжди.
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages, isLoading]);

  // --- Гостьовий режим: історія в localStorage (як у Фазі 3.2) ---
  useEffect(() => {
    if (isRegistered || !isOpen) return;
    try {
      const saved = localStorage.getItem(guestHistoryKey);
      const parsed = saved ? JSON.parse(saved) : null;
      setMessages(Array.isArray(parsed) && parsed.length > 0 ? parsed : [welcomeMessage]);
    } catch {
      setMessages([welcomeMessage]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegistered, isOpen]);

  useEffect(() => {
    if (isRegistered) return;
    try {
      localStorage.setItem(guestHistoryKey, JSON.stringify(messages));
    } catch {
      /* приватний режим — асистент лишається робочим, просто без пам'яті */
    }
  }, [messages, isRegistered]);

  // --- Зареєстрований автор: сесії з бази ---
  const loadSessions = useCallback(async () => {
    if (!isRegistered) return;
    setIsLoadingSessions(true);
    try {
      const res = await fetch('/api/chat/sessions', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions || []);
      return data.sessions as ChatSessionSummary[];
    } catch {
      /* мережа впала — покажемо порожній список, кнопка «Нова розмова» лишається робочою */
    } finally {
      setIsLoadingSessions(false);
    }
  }, [isRegistered]);

  const openSession = useCallback(async (sessionId: string) => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setActiveSessionId(sessionId);
      setActiveSession(data.session);
      if (data.session?.modelId) setSelectedModel(data.session.modelId);
      const sessionModel = data.session?.modelId || '';
      const loaded: ChatMessage[] = (data.messages || []).map((m: any) => ({
        sender: m.role === 'user' ? 'user' : 'ai',
        text: m.content,
        model: sessionModel,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        costUsd: m.costUsd,
      }));
      setMessages(loaded.length > 0 ? loaded : [welcomeMessage]);
    } catch {
      /* лишаємо поточний стан */
    } finally {
      setIsLoadingSessions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSession = useCallback(async () => {
    if (!isRegistered) return null;
    try {
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bookId: book.id, modelId: selectedModel || undefined }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      setActiveSessionId(data.session.id);
      setActiveSession(data.session);
      setMessages([welcomeMessage]);
      await loadSessions();
      return data.session.id as string;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegistered, book.id, loadSessions]);

  // При відкритті модалки підтягуємо останню розмову або створюємо нову.
  useEffect(() => {
    if (!isOpen || !isRegistered || activeSessionId) return;
    (async () => {
      const list = await loadSessions();
      if (list && list.length > 0) {
        await openSession(list[0].id);
      } else {
        await createSession();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isRegistered]);

  // Список доступних моделей чату (тільки зареєстрований автор).
  useEffect(() => {
    if (!isOpen || !isRegistered) return;
    (async () => {
      try {
        const res = await fetch('/api/chat/models', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        setModels(data.models || []);
        setSelectedModel((prev) => prev || data.defaultModelId || data.models?.[0]?.id || '');
      } catch {
        /* мережа впала — селектор моделі просто лишиться на усталеній моделі сервера */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isRegistered]);

  // Закриває меню «Передати текст у книгу» при кліку/Esc поза ним.
  useEffect(() => {
    if (!selectionMenu) return;
    const close = () => setSelectionMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [selectionMenu]);

  // --- Знімок "сонечка" з DraggableSun, що чекає прикріплення (App.tsx) ---
  // Хук має бути ДО "if (!isOpen) return null" нижче — інакше React бачить
  // різну кількість викликаних хуків між закритою й відкритою модалкою
  // ("Rendered more hooks than during the previous render"). processFiles
  // визначається нижче за текстом, але це не проблема: сам виклик useEffect
  // тут лише РЕЄСТРУЄ колбек, а виконається він уже після рендеру, коли
  // processFiles (звичайний const у цій-таки функції) вже присвоєно.
  useEffect(() => {
    if (!isOpen || !pendingAttachmentFile) return;
    processFiles([pendingAttachmentFile]);
    setInputText((prev) => prev || 'Прінтскринь для АІ');
    onAttachmentConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingAttachmentFile]);

  if (!isOpen) return null;

  /** Зберігає обрану модель і на сесії (як і раніше), і як «рушій книги» — decode Q10/Q14 з grilling-сесії AI-тексту за фото. */
  const handleSelectModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (!onUpdateBook || !modelId || modelId === book.preferredAiModelId) return;
    const label = models.find((m) => m.id === modelId)?.label || modelId;
    onUpdateBook({ ...book, preferredAiModelId: modelId }, 'Рушій AI книги', `Рушій AI для книги змінено на «${label}».`);
  };

  const handleDeleteSession = async () => {
    if (!isRegistered) {
      setMessages([welcomeMessage]);
      try {
        localStorage.removeItem(guestHistoryKey);
      } catch {
        /* нічого критичного */
      }
      return;
    }
    if (!activeSessionId) return;
    try {
      await fetch(`/api/chat/sessions/${activeSessionId}`, { method: 'DELETE', credentials: 'same-origin' });
    } catch {
      /* навіть якщо не вдалося — почнемо нову розмову локально */
    }
    setActiveSessionId(null);
    setActiveSession(null);
    setMessages([welcomeMessage]);
    const list = await loadSessions();
    if (list && list.length > 0) await openSession(list[0].id);
    else await createSession();
  };

  /** Видалення довільної сесії з сайдбару (не обов'язково активної), як у Modul_token ChatHistoryView. */
  const handleDeleteSessionById = async (id: string) => {
    if (!isRegistered) return;
    try {
      await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    } catch {
      /* навіть якщо не вдалося — список все одно оновимо нижче */
    }
    if (id === activeSessionId) {
      setActiveSessionId(null);
      setActiveSession(null);
      setMessages([welcomeMessage]);
      const list = await loadSessions();
      if (list && list.length > 0) await openSession(list[0].id);
      else await createSession();
    } else {
      await loadSessions();
    }
  };

  // --- Вкладені файли ---
  const processFiles = async (files: FileList | File[]) => {
    setAttachmentError(null);
    const fileArray = Array.from(files);
    const room = MAX_ATTACHMENTS - attachedFiles.length;
    if (room <= 0) {
      setAttachmentError(t('quickAi.tooManyAttachments', { max: MAX_ATTACHMENTS }));
      return;
    }
    for (const file of fileArray.slice(0, room)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_ATTACHMENT_EXT.includes(ext)) {
        setAttachmentError(t('quickAi.unsupportedFormat', { ext: ext.toUpperCase() }));
        continue;
      }
      if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
        setAttachmentError(t('quickAi.fileTooLarge', { name: file.name, max: MAX_ATTACHMENT_MB }));
        continue;
      }
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isImage = ['jpg', 'jpeg', 'png'].includes(ext);
      setAttachedFiles((prev) => [
        ...prev,
        { id, name: file.name, size: file.size, extension: ext, kind: isImage ? 'image' : 'text', status: 'reading' },
      ]);
      try {
        if (isImage) {
          const base64 = await fileToBase64(file);
          setAttachedFiles((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: 'ready', base64, mimeType: file.type || `image/${ext}` } : a))
          );
        } else {
          const textContent = await extractChatFileText(file);
          setAttachedFiles((prev) => (prev.map((a) => (a.id === id ? { ...a, status: 'ready', textContent } : a))));
        }
      } catch {
        setAttachedFiles((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'error', error: t('quickAi.extractFailed') } : a))
        );
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachedFiles((prev) => prev.filter((a) => a.id !== id));
  };

  // --- «Передати текст у книгу» ---
  const handleMessagesContextMenu = (e: React.MouseEvent) => {
    if (!isRegistered) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (!text) {
      setSelectionMenu(null);
      return;
    }
    e.preventDefault();
    setSelectionMenu({ x: e.clientX, y: e.clientY, text });
  };

  const sortedChapters = [...book.chapters].sort((a, b) => a.order - b.order);

  /** Дописує виділений текст у кінець ОСТАННЬОЇ секції обраного розділу (server-side аналог: EditorView.tsx handleContentChange). */
  /**
   * Делегує вставку тексту App.tsx (єдиний власник book/навігації) і одразу
   * закриває чат — редактор сам відкриється на потрібній секції з виділеним
   * фрагментом (App.tsx → handleSendChatTextToChapter → pendingChatHighlight),
   * тож автор бачить результат без додаткового підтвердження тут.
   */
  const sendSelectionToChapter = (chapter: Chapter) => {
    if (!selectionMenu || !onSendTextToChapter) return;
    onSendTextToChapter(chapter.id, selectionMenu.text);
    setChapterPickerOpen(false);
    setSelectionMenu(null);
    onClose();
  };

  const handleSendMessage = async () => {
    const readyAttachments = attachedFiles.filter((a) => a.status === 'ready');
    const hasPendingAttachment = attachedFiles.some((a) => a.status === 'reading');
    if ((!inputText.trim() && readyAttachments.length === 0) || isLoading || hasPendingAttachment) return;
    const userMsg = inputText.trim() || t('quickAi.analyzeAttachmentsDefault');
    setInputText('');
    setAttachedFiles([]);
    setAttachmentError(null);
    setIsLoading(true);

    // Гість — старий шлях через /api/ai/assistant-chat (без БД).
    if (!isRegistered) {
      const nextMessages = [...messages, { sender: 'user' as const, text: userMsg, inputTokens: estimateTokens(userMsg), estimated: true }];
      setMessages(nextMessages);
      try {
        const res = await fetch('/api/ai/assistant-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: nextMessages.map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
            bookContext: { title: book.title, genre: book.genre, synopsis: book.synopsis },
          }),
        });
        const data = await res.json();
        setMessages((prev) => [...prev, { sender: 'ai', text: res.ok && data.reply ? data.reply : t('quickAi.fallbackReply') }]);
      } catch {
        setMessages((prev) => [...prev, { sender: 'ai', text: t('quickAi.connectionError') }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Зареєстрований автор — сесія в БД.
    let sessionId = activeSessionId;
    if (!sessionId) sessionId = await createSession();
    if (!sessionId) {
      setMessages((prev) => [...prev, { sender: 'ai', text: t('quickAi.connectionError') }]);
      setIsLoading(false);
      return;
    }

    // Оціночні токени повідомлення автора (як у Modul_token: показуємо одразу,
    // а реальну вартість приносить репліка асистента зі сервера).
    const userMsgTokens = estimateTokens(userMsg);
    setMessages((prev) => [...prev, { sender: 'user', text: userMsg, inputTokens: userMsgTokens, outputTokens: 0, estimated: true }]);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          content: userMsg,
          modelId: selectedModel || undefined,
          // Повний потік розмови — та сама логіка, що в Modul_token: модель
          // отримує саме той контекст, який користувач бачить у вікні чату.
          messages: messages.map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })),
          bookContext: { title: book.title, genre: book.genre, synopsis: book.synopsis },
          attachments: readyAttachments.length > 0
            ? {
                images: readyAttachments
                  .filter((a) => a.kind === 'image')
                  .map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.base64 })),
                textFiles: readyAttachments
                  .filter((a) => a.kind === 'text')
                  .map((a) => ({ name: a.name, content: a.textContent })),
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.assistantMessage) {
        setMessages((prev) => [
          ...prev,
          {
            sender: 'ai',
            text: data.assistantMessage.content,
            model: data.assistantMessage.model || data.session?.modelId || selectedModel,
            inputTokens: data.assistantMessage.inputTokens,
            outputTokens: data.assistantMessage.outputTokens,
            costUsd: data.assistantMessage.costUsd,
          },
        ]);
        setActiveSession(data.session);
        setSessions((prev) => prev.map((s) => (s.id === data.session.id ? data.session : s)));
      } else {
        setMessages((prev) => [...prev, { sender: 'ai', text: data?.error || t('quickAi.fallbackReply') }]);
      }
    } catch {
      setMessages((prev) => [...prev, { sender: 'ai', text: t('quickAi.connectionError') }]);
    } finally {
      setIsLoading(false);
    }
  };

  const totalTokens = activeSession ? activeSession.totalInputTokens + activeSession.totalOutputTokens : 0;
  const filteredSessions = sessions.filter((s) => s.title.toLowerCase().includes(sessionSearch.trim().toLowerCase()));

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="token-module-scope rounded-2xl max-w-7xl w-full h-[720px] max-h-[88vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Вкладенки: Чат · Конструктор промтів (гість не бачить; Free бачить заглушку) */}
        {isRegistered && (
          <div className="px-4 pt-3 pb-0 shrink-0 flex items-center gap-1">
            <button
              onClick={() => setActivePanel('chat')}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                activePanel === 'chat'
                  ? 'nm-inset text-[var(--primary)] border-b-2 border-[var(--primary)]'
                  : 'nm-btn text-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
            >
              {t('quickAi.chatTab')}
            </button>
            <button
              onClick={() => setActivePanel('prompts')}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                activePanel === 'prompts'
                  ? 'nm-inset text-[var(--primary)] border-b-2 border-[var(--primary)]'
                  : 'nm-btn text-[var(--outline)] hover:text-[var(--on-surface)]'
              }`}
            >
              {t('quickAi.promptConstructor.tab')}
            </button>
            {/* Третя вкладка — виключно для адміна (Q16 grilling-сесії), не видима нікому іншому. */}
            {isAdmin && (
              <button
                onClick={() => setActivePanel('core')}
                className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                  activePanel === 'core'
                    ? 'nm-inset text-[var(--primary)] border-b-2 border-[var(--primary)]'
                    : 'nm-btn text-[var(--outline)] hover:text-[var(--on-surface)]'
                }`}
              >
                Ядро AI (адмін)
              </button>
            )}
          </div>
        )}

        {isRegistered && activePanel === 'prompts' ? (
          <PromptConstructorPanel
            book={book}
            onClose={onClose}
            models={models}
            selectedModel={selectedModel}
            onSelectModel={handleSelectModel}
            isRegistered={isRegistered}
            photoContext={promptContext}
            onSaveAndGenerate={onPromptSavedAndGenerate}
          />
        ) : isAdmin && activePanel === 'core' ? (
          <CoreAiPanel book={book} onClose={onClose} models={models} selectedModel={selectedModel} onSelectModel={handleSelectModel} />
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Ліва панель — сесії (сайдбар за принципом Modul_token ChatHistoryView) */}
        {isRegistered && (
          <div className="w-72 shrink-0 nm-sidebar flex flex-col">
            <div className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <span className="text-[13px] font-bold text-[var(--on-surface)] truncate">{t('quickAi.sessionsTitle')}</span>
                </div>
                <button
                  onClick={createSession}
                  title={t('quickAi.newSessionTitle')}
                  className="nm-btn p-1.5 rounded-lg text-[var(--primary)] shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--outline)]" />
                <input
                  type="text"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  placeholder={t('quickAi.searchSessionsPlaceholder')}
                  className="w-full nm-inset rounded-xl py-2 pl-9 pr-3 text-[12px] text-[var(--on-surface)] placeholder:text-[var(--outline)] outline-none bg-transparent"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
              {isLoadingSessions ? (
                <div className="p-3 text-[11px] text-[var(--outline)] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('quickAi.loadingSessions')}
                </div>
              ) : filteredSessions.length === 0 ? (
                <p className="p-3 text-[11px] text-[var(--outline)]">{t('quickAi.noSessions')}</p>
              ) : (
                filteredSessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  return (
                    <div
                      key={s.id}
                      onClick={() => openSession(s.id)}
                      className={`relative group cursor-pointer rounded-xl p-3 transition-all ${
                        isActive ? 'nm-inset text-[var(--primary)] border-l-2 border-[var(--primary)]' : 'nm-btn text-[var(--on-surface-variant)]'
                      }`}
                    >
                      <div className="pr-6">
                        <p className="text-[12.5px] font-bold truncate">{s.title}</p>
                        <div className="flex items-center justify-between text-[10px] font-mono text-[var(--outline)] mt-1">
                          <span>{new Date(s.updatedAt).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US')}</span>
                          <span>${s.totalCostUsd.toFixed(4)}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSessionById(s.id);
                        }}
                        title={t('quickAi.deleteSessionRowTooltip')}
                        className="absolute right-1.5 top-1.5 p-1.5 rounded-lg nm-btn text-[var(--outline)] hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Права частина — активний чат */}
        <div className="flex-1 flex flex-col min-w-0 nm-flat">
          {/* Header */}
          <div className="p-4 nm-outset-sm flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold text-[var(--on-surface)] truncate">
                {activeSession?.title && activeSession.messageCount > 0 ? activeSession.title : t('quickAi.heading')}
              </h3>
              <p className="text-[11px] text-[var(--outline)] truncate">{t('quickAi.subheading', { title: book.title })}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isRegistered && (
                <select
                  value={selectedModel || models[0]?.id || ''}
                  onChange={(e) => handleSelectModel(e.target.value)}
                  title={t('quickAi.modelSelectTitle')}
                  className="min-w-[200px] max-w-[300px] nm-outset-xs rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[var(--on-surface)] bg-transparent outline-none cursor-pointer"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.available}>
                      {m.label}
                      {formatModelPrice(m) ? ` · ${formatModelPrice(m)}` : ''}
                      {m.available ? '' : ` (${t('quickAi.modelWithoutKey')})`}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={handleDeleteSession}
                title={t('quickAi.clearHistoryTitle')}
                className="nm-btn p-2 rounded-lg text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={onClose} className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Chat Messages */}
          <div
            ref={messagesContainerRef}
            onContextMenu={handleMessagesContextMenu}
            className="flex-1 p-5 overflow-y-auto space-y-4"
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex gap-3 text-xs leading-relaxed ${
                  m.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {m.sender === 'ai' && (
                  <div className="w-7 h-7 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] p-3.5 text-[var(--on-surface)] ${
                    m.sender === 'user' ? 'msg-user' : 'msg-assistant whitespace-pre-wrap'
                  }`}
                >
                  {m.text}
                  {m.sender === 'ai' && (m.inputTokens != null || m.costUsd != null || m.model) && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--outline)] font-mono">
                      {m.model && <span>{m.model}</span>}
                      {m.inputTokens != null && <span>↑{m.inputTokens.toLocaleString()}</span>}
                      {m.outputTokens != null && <span>↓{m.outputTokens.toLocaleString()}</span>}
                      {m.costUsd != null && <span>${m.costUsd.toFixed(6)}</span>}
                    </div>
                  )}
                  {m.sender === 'user' && m.inputTokens != null && (
                    <div className="mt-1 text-right text-[10px] text-[var(--outline)] font-mono">
                      ≈{m.inputTokens.toLocaleString()} {t('quickAi.tokensUnit')}
                      {m.estimated ? ` (${t('quickAi.estimatedSuffix')})` : ''}
                    </div>
                  )}
                </div>
                {m.sender === 'user' && (
                  <div className="w-7 h-7 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3 text-xs text-[var(--outline)] items-center">
                <div className="w-7 h-7 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="msg-assistant p-3 text-[var(--on-surface)] animate-pulse">
                  {t('quickAi.generatingReply')}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Лічильник вартості сесії */}
          {isRegistered && activeSession && activeSession.messageCount > 0 && (
            <div
              id="chat-session-cost"
              className="px-4 py-1.5 nm-inset flex items-center gap-2 text-[10px] text-[var(--outline)] font-mono shrink-0"
            >
              <Coins className="w-3 h-3 shrink-0 text-[var(--primary)]" />
              <span>
                {t('quickAi.sessionUsage', {
                  tokens: totalTokens.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US'),
                  cost: activeSession.totalCostUsd.toFixed(4),
                })}
              </span>
            </div>
          )}

          {/* Input Bar */}
          <div className="p-4 nm-outset-sm flex flex-col gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.txt,.md,image/jpeg,image/png,application/pdf,text/plain,text/markdown"
              multiple
              onChange={handleFileInputChange}
              className="hidden"
            />

            {attachmentError && (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl nm-inset text-[11px] text-rose-400">
                <span>{attachmentError}</span>
                <button onClick={() => setAttachmentError(null)} className="p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl nm-inset text-[11px]"
                    title={a.error || a.name}
                  >
                    {a.kind === 'image' ? (
                      <ImageIcon className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                    )}
                    <span className={`max-w-[120px] truncate ${a.status === 'error' ? 'text-rose-400' : 'text-[var(--on-surface)]'}`}>
                      {a.name}
                    </span>
                    {a.status === 'reading' && <Loader2 className="w-3 h-3 animate-spin text-[var(--outline)]" />}
                    <button onClick={() => removeAttachment(a.id)} className="text-[var(--outline)] hover:text-rose-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              {isRegistered && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachedFiles.length >= MAX_ATTACHMENTS}
                  title={t('quickAi.attachFilesTooltip')}
                  className="nm-btn p-2.5 rounded-xl text-[var(--primary)] shrink-0 disabled:opacity-40"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              )}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={t('quickAi.inputPlaceholder')}
                className="flex-1 nm-inset rounded-xl p-2.5 text-xs text-[var(--on-surface)] placeholder:text-[var(--outline)] outline-none bg-transparent"
              />
              <button
                onClick={handleSendMessage}
                disabled={isLoading || (!inputText.trim() && attachedFiles.every((a) => a.status !== 'ready')) || attachedFiles.some((a) => a.status === 'reading')}
                className="nm-btn-primary p-2.5 rounded-xl disabled:opacity-40 transition-all shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
          </div>
        )}

        {/* Меню виділення тексту — «Передати текст у книгу» */}
        {selectionMenu && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: selectionMenu.x, top: selectionMenu.y, zIndex: 70 }}
            className="nm-outset rounded-xl p-1.5 min-w-[220px]"
          >
            <button
              onClick={() => setChapterPickerOpen(true)}
              disabled={sortedChapters.length === 0}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-[var(--on-surface)] nm-btn disabled:opacity-40"
            >
              <BookPlus className="w-3.5 h-3.5 text-[var(--primary)]" />
              {t('quickAi.sendToBook')}
            </button>
          </div>
        )}

        {/* Пікер розділу книги */}
        {chapterPickerOpen && selectionMenu && (
          <div
            onClick={() => setChapterPickerOpen(false)}
            className="fixed inset-0 z-[71] bg-black/60 flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="token-module-scope nm-outset rounded-2xl w-full max-w-sm max-h-[70vh] flex flex-col overflow-hidden"
            >
              <div className="p-4 border-b border-[var(--border-subtle)]">
                <h4 className="text-[13px] font-bold text-[var(--on-surface)]">{t('quickAi.pickChapterTitle')}</h4>
                <p className="text-[11px] text-[var(--outline)] mt-1">{t('quickAi.pickChapterHint')}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sortedChapters.map((chap) => (
                  <button
                    key={chap.id}
                    onClick={() => sendSelectionToChapter(chap)}
                    className="w-full text-left px-3 py-2.5 rounded-xl nm-btn text-[12.5px] text-[var(--on-surface)] truncate"
                  >
                    {chap.title}
                  </button>
                ))}
              </div>
              <div className="p-3 border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => setChapterPickerOpen(false)}
                  className="w-full px-3 py-2 rounded-xl nm-btn text-[12px] text-[var(--outline)]"
                >
                  {t('quickAi.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
