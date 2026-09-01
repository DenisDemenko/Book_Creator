import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { buildManuscriptExtensions } from './manuscriptEditor/extensions';
import { PaginationPlugin } from './manuscriptEditor/PaginationPlugin';
import { PAGE_FORMAT_QUICK_OPTIONS } from '../utils/pageFormats';
import { PageColumn } from './manuscriptEditor/PageColumn';
import { PageRuler } from './manuscriptEditor/PageRuler';
import { useRealBookPages } from '../utils/useRealBookPages';
import { computeContourPolygon } from '../utils/imageContour';
import {
  markerStringToTiptapDoc,
  tiptapDocToMarkerString,
  markerSnippetToNodes,
  markerOffsetToDocPos,
  JSONContent,
} from '../utils/manuscriptDoc';
import { 
  Plus, 
  Trash2, 
  Copy, 
  ChevronDown, 
  ChevronUp,
  ChevronRight, 
  Sparkles, 
  Check, 
  X, 
  RotateCcw, 
  Wand2, 
  CheckCheck, 
  AlertCircle, 
  Film, 
  User, 
  MapPin, 
  Clock, 
  Flame, 
  ArrowUp, 
  ArrowDown, 
  SlidersHorizontal,
  Bold,
  Italic,
  SpellCheck2,
  ImagePlus,
  Minimize2,
  Maximize2,
  GripVertical,
  Heading1,
  Heading2,
  Quote,
  List,
  ListOrdered,
  FileCode,
  Image as ImageIcon,
  BookMarked,
  BookOpen,
  History,
  FileText,
  HelpCircle,
  QrCode,
  PanelLeft,
  ExternalLink,
  MessageSquare,
  MessagesSquare,
  Save,
  Languages,
  Globe,
  Edit3,
  Users,
  UserPlus,
  SplitSquareVertical,
  Columns,
  Eye,
  CheckCircle2,
  GraduationCap,
  Tag,
  Pin,
  PinOff,
  MousePointerClick,
  Volume2,
  AlignLeft,
  AlignRight,
  AlignCenter,
  Spline,
  Timer
} from 'lucide-react';
import { 
  Book, 
  Chapter, 
  Section, 
  Character, 
  CharacterInScene, 
  AIProposal, 
  SpellCheckIssue, 
  Footnote,
  QRTag,
  BookIllustration,
  UserRole,
  CourseTag,
  CustomFont,
  AuthUser
} from '../types';
import { 
  calculateWordCount, 
  estimateReadingTimeMinutes, 
  computeWordDiff, 
  DiffPart, 
  generateQrDataUrl 
} from '../utils/helpers';
import { getRoleInfo } from '../utils/rbac';
import { usePersistentState } from '../hooks/usePersistentState';
import { usePlanAccess } from '../hooks/usePlanAccess';
import { synthesizeNarration, NarrationClientError, type NarrationLang } from '../utils/narrationClient';
import { CharacterEditModal } from './CharacterEditModal';
import { AddParticipantsModal } from './AddParticipantsModal';
import { GenerateCharacterModal } from './GenerateCharacterModal';
import { GenerateIllustrationModal } from './GenerateIllustrationModal';
import { DraggablePanel } from './DraggablePanel';
import { DockedEditorPanel } from './DockedEditorPanel';
import { AiReadabilityPanel } from './AiReadabilityPanel';
import { FontInstallModal } from './FontInstallModal';
import { ProofingLanguageModal } from './ProofingLanguageModal';
import { InsertImageModal } from './InsertImageModal';
import { HeroArcPanel } from './HeroArcPanel';
import type { HeroArcState } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * Шрифти, доступні для основного тексту книги. Список навмисно збігається
 * зі списком у «Верстка & Поля» (LayoutView) — це одне й те саме поле
 * layoutConfig.typography.bodyFont, тож і переклади назв спільні.
 */
/** Службове значення останньої позиції списку шрифтів — не гарнітура,
 *  а команда відкрити вікно підключення нового шрифту. */
const ADD_FONT_OPTION = '__nova_add_font__';

const BODY_FONT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'Literata', labelKey: 'layoutView.fontLiterataOpt' },
  { value: 'Cormorant Garamond', labelKey: 'layoutView.fontCormorantOpt' },
  { value: 'Outfit', labelKey: 'layoutView.fontOutfitOpt' },
  { value: 'Plus Jakarta Sans', labelKey: 'layoutView.fontPlusJakartaOpt' },
];

/** Назва шрифту з налаштувань книги → повний CSS-стек із запасними. */
function bodyFontStack(bodyFont: string): string {
  switch (bodyFont) {
    case 'Cormorant Garamond':
      return "'Cormorant Garamond', Georgia, serif";
    case 'Outfit':
      return "Outfit, 'Plus Jakarta Sans', sans-serif";
    case 'Plus Jakarta Sans':
      return "'Plus Jakarta Sans', -apple-system, sans-serif";
    case 'Literata':
    default:
      return "Literata, 'Cormorant Garamond', Georgia, serif";
  }
}

interface EditorViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  activeChapterId: string;
  activeSectionId: string;
  onSelectSection: (chapterId: string, sectionId: string) => void;
  onSaveBook?: () => void;
  currentRole?: UserRole;
  authUserId?: string | null;
  /**
   * Діапазон символів для виділення й прокрутки після зовнішньої вставки
   * тексту в секцію (напр. «Передати текст у книгу» з AI-чату,
   * QuickAiModal.tsx). Застосовується один раз, коли activeSectionId
   * збігається з pendingHighlight.sectionId, потім знімається через
   * onHighlightApplied.
   */
  pendingHighlight?: { sectionId: string; start: number; end: number } | null;
  onHighlightApplied?: () => void;
  /**
   * «Редагувати промт →» з меню правого кліку по фото: відкриває
   * «Конструктор промтів» в AI-асистенті вже з потрібною кількістю
   * абзаців і живим контекстом саме цього зображення.
   */
  onOpenPromptConstructor?: (request: PromptConstructorRequest) => void;
  /**
   * «Обговорити фрагмент у чаті»: передає виділений текст у AI-чат разом
   * із підписом, звідки він узятий. Редактор не відкриває чат сам —
   * власником обох (чату й книги) є App.tsx.
   */
  onDiscussInChat?: (text: string, where: string) => void;
  /**
   * Лічильник, який App збільшує після «Зберегти й згенерувати» в
   * конструкторі. Редактор пам'ятає, за яким фото його викликали, і
   * запускає генерацію одразу — інакше автор мусив би закрити вікно й
   * повторити правий клік, загубивши контекст на півдорозі.
   */
  promptGenerateTick?: number;
  /**
   * Повний обліковий запис (роль + тариф) — потрібен «Озвучити фрагмент»,
   * щоб перевірити доступ Pro/Ultra ще ДО запиту на сервер, а не після
   * 403. authUserId вище цього не дає — це лише id, без ролі й плану.
   */
  authUser?: AuthUser | null;
  /** Перехід на сторінку «Підписка» — для тосту «озвучення доступне з Pro». */
  onGoToSubscription?: () => void;
}

/** Контекст фото, з яким відкривається конструктор промтів. */
export interface PromptConstructorRequest {
  paragraphCount: 1 | 2 | 3;
  bookTitle?: string;
  genre?: string;
  chapterTitle?: string;
  imageCaption?: string;
  contextBefore?: string;
  contextAfter?: string;
}

export const EditorView: React.FC<EditorViewProps> = ({
  book,
  onUpdateBook,
  activeChapterId,
  activeSectionId,
  onSelectSection,
  onSaveBook,
  currentRole = 'admin',
  authUserId = null,
  authUser = null,
  onGoToSubscription,
  pendingHighlight,
  onHighlightApplied,
  onOpenPromptConstructor,
  onDiscussInChat,
  promptGenerateTick = 0,
}) => {
  const { t } = useLanguage();
  const isReader = currentRole === 'reader';
  const isTranslator = currentRole === 'translator';
  const roleInfo = getRoleInfo(currentRole);

  const activeChapter = book.chapters.find((c) => c.id === activeChapterId) || book.chapters[0];
  const activeSection = activeChapter?.sections.find((s) => s.id === activeSectionId) || activeChapter?.sections[0];

  // Panel toggles for responsive / landscape layout
  const [showLeftTree, setShowLeftTree] = usePersistentState<boolean>('nova_editor_showLeftTree', false);
  const [showRightPanel, setShowRightPanel] = usePersistentState<boolean>('nova_editor_showRightPanel', true);

  // Вільні панелі: учасники сцени та англійський переклад можуть бути
  // відкріплені від правої колонки і перетягуватися по полю (DraggablePanel).
  // Усі ці стани «змінних блоків» зберігаються в localStorage, тож перехід
  // між розділами або перезавантаження сторінки не скидає позиції/режими.
  const [participantsUnpinned, setParticipantsUnpinned] = usePersistentState<boolean>('nova_editor_participantsUnpinned', false);
  const [translationDetached, setTranslationDetached] = usePersistentState<boolean>('nova_editor_translationDetached', false);
  const [rightPanelWidth, setRightPanelWidth] = usePersistentState<number>('nova_editor_rightPanelWidth', 420);

  // Додаткові AI-поля, які викликаються правим кліком по задньому полю
  // редактора (дублюють функції розділу «AI Редактор»).
  const [showReadabilityWidget, setShowReadabilityWidget] = usePersistentState<boolean>('nova_editor_showReadabilityWidget', false);
  const [showAiIssuesWidget, setShowAiIssuesWidget] = usePersistentState<boolean>('nova_editor_showAiIssuesWidget', false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  /** Скоригована позиція контекстного меню — щоб воно завжди вміщувалося у вікно. */
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // Інлайновий редактор перекладу в правій панелі (можна закрити хрестиком).
  const [translationPanelCollapsed, setTranslationPanelCollapsed] = usePersistentState<boolean>('nova_editor_translationPanelCollapsed', false);

  // Закриваємо контекстне меню по кліку поза ним або по Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      cancelBehaviorPopoverClose();
      setBehaviorPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // 1.3: якщо автор увімкнув «Автоматично використовувати стиль» у модулі
  // стилю (StyleView, вкладка «Майстерність»), підвантажуємо ім'я_автора.md
  // разово при вході в редактор і додаємо його вміст до кожного виклику
  // AI Continue / Write with AI нижче. Якщо стиль не сформовано або
  // чекбокс вимкнено — activeStyleGuide лишається null, і сервер сам
  // фолбекає на нейтральний тон (styleGuide просто не надсилається).
  const [activeStyleGuide, setActiveStyleGuide] = useState<string | null>(null);
  useEffect(() => {
    if (!authUserId) {
      setActiveStyleGuide(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/style/${authUserId}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setActiveStyleGuide(data?.autoUseStyle && data?.contentMd ? data.contentMd : null);
      })
      .catch(() => {
        if (!cancelled) setActiveStyleGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // Кореневі вкладки правої панелі: «Персонажі і сцена», «Робота над текстом», «Робота з AI».
  const [rightPanelTab, setRightPanelTab] = usePersistentState<'scene' | 'workText' | 'workAi'>(
    'nova_editor_rightPanelTab',
    isTranslator ? 'workText' : 'scene'
  );
  // Підвкладки всередині «Робота над текстом» / «Робота з AI».
  const [rightPanelSubTab, setRightPanelSubTab] = usePersistentState<'translation' | 'footnotes_qr' | 'course_tags' | 'ai' | 'spellcheck' | 'diff'>(
    'nova_editor_rightPanelSubTab',
    'translation'
  );

  // Text editor view mode: Ukrainian only, English only, or Parallel bilingual (UA | EN)
  const [editorLanguageMode, setEditorLanguageMode] = usePersistentState<'ua' | 'en' | 'parallel'>(
    'nova_editor_editorLanguageMode',
    isTranslator ? 'parallel' : 'ua'
  );

  // Selection & AI state
  const [selectedText, setSelectedText] = useState<string>('');
  const [customAiPrompt, setCustomAiPrompt] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [isCheckingGrammar, setIsCheckingGrammar] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [translationSuccessToast, setTranslationSuccessToast] = useState<string | null>(null);
  const [fontSelectHintText, setFontSelectHintText] = useState<string | null>(null);
  const setFontSelectHint = (msg: string) => {
    setFontSelectHintText(msg);
    setTimeout(() => setFontSelectHintText(null), 2500);
  };

  // Character editing, generation & participant adding modals
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [showAddParticipantsModal, setShowAddParticipantsModal] = useState<boolean>(false);
  const [showGenerateHeroModal, setShowGenerateHeroModal] = useState<boolean>(false);
  const [heroToEnhance, setHeroToEnhance] = useState<Character | null>(null);

  // Quick Footnote / QR dialog state
  const [showFootnoteModal, setShowFootnoteModal] = useState<boolean>(false);
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const [showFontModal, setShowFontModal] = useState<boolean>(false);
  const [showProofingModal, setShowProofingModal] = useState<boolean>(false);
  const [showInsertImageModal, setShowInsertImageModal] = useState<boolean>(false);
  /** Герой, чию репліку щойно вставили: його панель горить яскравіше,
   *  решта — під маскою затемнення (див. renderSceneParticipants). */
  const [highlightedCharacterId, setHighlightedCharacterId] = useState<string | null>(null);
  /** Компактний режим карток героїв: лише фото та ім'я. */
  const [participantsCompact, setParticipantsCompact] = usePersistentState<boolean>('nova_editor_participantsCompact', false);
  /** Індекс картки, яку зараз перетягують у компактному режимі. */
  const [draggedParticipantIdx, setDraggedParticipantIdx] = useState<number | null>(null);
  /** Підменю «Вставити репліку героя» у контекстному меню. */
  const [showReplicaSubmenu, setShowReplicaSubmenu] = useState<boolean>(false);
  /** Поповер з поведінковими шаблонами героя при наведенні на картку учасника сцени. */
  const [behaviorPopover, setBehaviorPopover] = useState<{ charId: string; x: number; y: number } | null>(null);
  /** Таймер відкладеного закриття поповера — щоб курсор встиг перейти з картки героя на сам поповер. */
  const behaviorPopoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Відкладає закриття поповера (викликається при виході курсора з тригера). */
  const scheduleBehaviorPopoverClose = () => {
    if (behaviorPopoverCloseTimer.current) clearTimeout(behaviorPopoverCloseTimer.current);
    behaviorPopoverCloseTimer.current = setTimeout(() => {
      behaviorPopoverCloseTimer.current = null;
      setBehaviorPopover(null);
    }, 160);
  };

  /** Скасовує відкладене закриття (курсор увійшов на сам поповер). */
  const cancelBehaviorPopoverClose = () => {
    if (behaviorPopoverCloseTimer.current) {
      clearTimeout(behaviorPopoverCloseTimer.current);
      behaviorPopoverCloseTimer.current = null;
    }
  };

  // Розташування контекстного меню. За замовчуванням воно відкривається вниз
  // від курсора, але якщо знизу недостатньо місця (курсор біля нижнього краю
  // вікна, а список героїв розгорнуто) — меню перевертається ВГОРУ від
  // курсора, щоб завжди вміщуватися в діалогове вікно вводу тексту.
  useLayoutEffect(() => {
    if (!contextMenu) {
      setContextMenuPos(null);
      return;
    }
    const el = contextMenuRef.current;
    if (!el) return;
    const menuW = el.offsetWidth;
    const menuH = el.offsetHeight;
    const margin = 8;
    let left = contextMenu.x;
    let top = contextMenu.y;

    // Не виходимо за праву межу вікна
    if (left + menuW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - menuW - margin);
    }
    if (left < margin) left = margin;

    // Якщо знизу від курсора немає місця — відкриваємо ВГОРУ від курсора
    if (top + menuH > window.innerHeight - margin) {
      top = Math.max(margin, contextMenu.y - menuH);
    }
    if (top < margin) top = margin;

    setContextMenuPos((prev) =>
      prev && prev.x === left && prev.y === top ? prev : { x: left, y: top }
    );
  }, [contextMenu, showReplicaSubmenu]);

  // Мова перевірки орфографії та вмикач — налаштування робочого місця,
  // тому живуть у localStorage, а не в книзі.
  const [proofingLanguage, setProofingLanguage] = usePersistentState<string>('nova_editor_proofingLanguage', 'uk');
  const [spellcheckEnabled, setSpellcheckEnabled] = usePersistentState<boolean>('nova_editor_spellcheckEnabled', true);
  const [modalFnText, setModalFnText] = useState<string>('');
  const [modalFnTerm, setModalFnTerm] = useState<string>('');
  const [modalQrTitle, setModalQrTitle] = useState<string>('');
  const [modalQrPayload, setModalQrPayload] = useState<string>('');
  const [modalQrType, setModalQrType] = useState<QRTag['actionType']>('url');

  // Course tag creation modal (tag a selected text excerpt for the "Courses" page)
  const [showCourseTagModal, setShowCourseTagModal] = useState<boolean>(false);
  const [modalCourseTagLabel, setModalCourseTagLabel] = useState<string>('');

  // AI Proposals & Spellcheck state
  const [currentProposal, setCurrentProposal] = useState<AIProposal | null>(null);
  const [proposalHistory, setProposalHistory] = useState<AIProposal[]>([]);
  const [spellIssues, setSpellIssues] = useState<SpellCheckIssue[]>([]);
  const [ignoredIssueIds, setIgnoredIssueIds] = useState<Set<string>>(new Set());
  const [userDictionary, setUserDictionary] = useState<string[]>([
    'Нео-Київ', 'Печерськ', 'Сварог', 'синаптичний', 'нейролінк', 'Прометій', 'квантовий'
  ]);
  const [showIllustrationModal, setShowIllustrationModal] = useState<boolean>(false);

  // Завжди свіжі версії книги/колбеків усередині довгоживучих TipTap-колбеків
  // (useEditor створює редактор один раз — без цих ref'ів onUpdate/картинки
  // бачили б значення book/activeSection з першого рендеру назавжди).
  const bookRef = useRef(book);
  bookRef.current = book;
  const handleContentChangeRef = useRef<(v: string) => void>(() => {});
  const handleContentEnChangeRef = useRef<(v: string) => void>(() => {});

  const resolveImageUrl = useCallback((id: string): string | undefined => {
    const b = bookRef.current;
    if (id === 'cover-front') return b.coverConfig?.frontArtUrl;
    if (id.startsWith('char-')) return b.characters.find((c) => c.id === id.slice('char-'.length))?.avatarUrl;
    return (b.illustrations || []).find((i) => i.id === id)?.url;
  }, []);

  /** Ширина текстового блоку сторінки (мм) — формат мінус внутрішнє/зовнішнє поле. Основа для дефолтної половини ширини картинки та межі її масштабування. */
  const getPageContentWidthMm = useCallback((): number => {
    const layout = bookRef.current.layoutConfig;
    const margins = layout?.margins;
    const pageWidthMm = layout?.pageWidthMm || 152;
    return pageWidthMm - (margins?.insideMm || 0) - (margins?.outsideMm || 0);
  }, []);

  /** Висота текстового блоку сторінки (мм) — формат мінус верхнє/нижнє поле. Бюджет висоти для живих розривів сторінок (PaginationPlugin). */
  const getPageContentHeightMm = useCallback((): number => {
    const layout = bookRef.current.layoutConfig;
    const margins = layout?.margins;
    const pageHeightMm = layout?.pageHeightMm || 229;
    return pageHeightMm - (margins?.topMm || 0) - (margins?.bottomMm || 0);
  }, []);

  /**
   * Підпис, що повторюється зверху кожного аркуша: номер глави та її назва.
   * Номер — порядковий у книзі, а не `order` глави: `order` може мати
   * діри після видалень, і тоді в колонтитулі стояло б «Розділ 7» там, де
   * глава насправді четверта.
   */
  const getRunningHeaderText = useCallback((): string => {
    const b = bookRef.current;
    const idx = b.chapters.findIndex((c) => c.id === activeChapterIdRef.current);
    const chapter = idx === -1 ? undefined : b.chapters[idx];
    if (!chapter) return '';
    return `Розділ ${idx + 1}: ${chapter.title}`;
  }, []);

  const getVerticalMarginsMm = useCallback(() => {
    const margins = bookRef.current.layoutConfig?.margins;
    return { topMm: margins?.topMm || 0, bottomMm: margins?.bottomMm || 0 };
  }, []);

  // --- «Проаналізувати фото і згенерувати AI текст книги» (правий клік на зображенні) ---
  /** Меню вибору кількості абзаців (1/2/3), відкрите правим кліком по фото. `getPos` — жива функція позиції вузла зображення (WrappedImageNode.tsx). */
  const [aiImageMenu, setAiImageMenu] = useState<{
    imageId: string; x: number; y: number; editorKind: 'ua' | 'en'; getPos: () => number;
  } | null>(null);
  /** Список рушіїв AI-ядра книги (для вибору робочого модуля, якщо рушій книги не аналізує фото) — вантажиться лениво, лише коли справді знадобиться. */
  const [aiCoreModels, setAiCoreModels] = useState<
    { id: string; label: string; engine: string; available: boolean }[]
  >([]);
  /** Запит на вибір робочого модуля (рушій книги не вміє аналізувати фото) — той самий контекст, що й aiImageMenu, лишається до завершення вибору. */
  const [aiEnginePicker, setAiEnginePicker] = useState<{
    imageId: string; x: number; y: number; editorKind: 'ua' | 'en'; getPos: () => number; paragraphCount: 1 | 2 | 3;
  } | null>(null);
  const [generatingImageId, setGeneratingImageId] = useState<string | null>(null);
  const generatingImageIdRef = useRef<string | null>(null);
  generatingImageIdRef.current = generatingImageId;
  const [aiEngineToast, setAiEngineToast] = useState<string | null>(null);
  /** Коротке повідомлення про режим обтікання (наприклад, коли контур силуету не вдалося розпізнати). */
  const [wrapToast, setWrapToast] = useState<string | null>(null);

  const isGeneratingAiText = useCallback((imageId: string) => generatingImageIdRef.current === imageId, []);
  const onRequestAiTextUa = useCallback((imageId: string, x: number, y: number, getPos: () => number) => {
    setAiImageMenu({ imageId, x, y, editorKind: 'ua', getPos });
  }, []);
  const onRequestAiTextEn = useCallback((imageId: string, x: number, y: number, getPos: () => number) => {
    setAiImageMenu({ imageId, x, y, editorKind: 'en', getPos });
  }, []);

  // Реальна (виміряна) пагінація всієї книги — та сама, що й «Розворот
  // книги» (utils/useRealBookPages.ts) — потрібна лише для того, щоб
  // редактор знав, з якої РЕАЛЬНОЇ сторінки книги починається розділ, що
  // зараз редагується (а не показував умовну нумерацію «сторінка 1» від
  // початку розділу).
  const realBookPages = useRealBookPages(book);
  const realBookPagesRef = useRef(realBookPages);
  realBookPagesRef.current = realBookPages;
  const activeSectionIdRef = useRef(activeSection?.id);
  activeSectionIdRef.current = activeSection?.id;
  const activeChapterIdRef = useRef(activeChapter?.id);
  activeChapterIdRef.current = activeChapter?.id;

  const getStartPageNumber = useCallback((): number => {
    const idx = realBookPagesRef.current.findIndex((p) => p.sectionId === activeSectionIdRef.current);
    return idx === -1 ? 1 : idx + 1;
  }, []);

  const uaManuscriptExtensions = useRef([
    ...buildManuscriptExtensions(resolveImageUrl, getPageContentWidthMm, t('editor.writePlaceholder'), {
      onRequestAiText: onRequestAiTextUa,
      isGeneratingAiText,
      aiDraftLabel: t('editor.aiDraftLabel'),
      aiDraftReviewLabel: t('editor.aiDraftReviewLabel'),
      aiDraftRejectLabel: t('editor.aiDraftRejectLabel'),
    }),
    PaginationPlugin.configure({
      getPageContentHeightMm,
      getVerticalMarginsMm,
      getStartPageNumber,
      getRunningHeaderText,
    }),
  ]).current;
  const enManuscriptExtensions = useRef([
    ...buildManuscriptExtensions(
      resolveImageUrl,
      getPageContentWidthMm,
      'Write or edit the English manuscript text for this section...',
      {
        onRequestAiText: onRequestAiTextEn,
        isGeneratingAiText,
        aiDraftLabel: 'AI draft',
        aiDraftReviewLabel: '✓ Mark as reviewed',
        aiDraftRejectLabel: 'Reject AI addition',
      }
    ),
    PaginationPlugin.configure({ getPageContentHeightMm, getVerticalMarginsMm }),
  ]).current;

  const uaEditor = useEditor(
    {
      extensions: uaManuscriptExtensions,
      content: markerStringToTiptapDoc(activeSection?.content || ''),
      editorProps: {
        attributes: { class: 'nova-manuscript-editor', spellcheck: String(spellcheckEnabled), lang: proofingLanguage },
      },
      onUpdate: ({ editor }) => {
        handleContentChangeRef.current(tiptapDocToMarkerString(editor.getJSON() as JSONContent));
      },
      onSelectionUpdate: ({ editor }) => {
        const { from, to, empty } = editor.state.selection;
        setSelectedText(empty ? '' : editor.state.doc.textBetween(from, to, '\n'));
      },
    },
    []
  );
  const enEditor = useEditor(
    {
      extensions: enManuscriptExtensions,
      content: markerStringToTiptapDoc(activeSection?.contentEn || ''),
      editorProps: {
        attributes: { class: 'nova-manuscript-editor', spellcheck: String(spellcheckEnabled), lang: 'en' },
      },
      onUpdate: ({ editor }) => {
        handleContentEnChangeRef.current(tiptapDocToMarkerString(editor.getJSON() as JSONContent));
      },
    },
    []
  );

  /** Режим обтікання вибраного зображення (null, якщо виділено не картинку) — керує кнопками обтікання в renderFormatToolbar. */
  const uaSelectedImageWrap = useEditorState({
    editor: uaEditor,
    selector: ({ editor }) => {
      const sel = editor?.state.selection as any;
      return sel?.node?.type?.name === 'wrappedImage' ? (sel.node.attrs.wrap as string) : null;
    },
  });
  const enSelectedImageWrap = useEditorState({
    editor: enEditor,
    selector: ({ editor }) => {
      const sel = editor?.state.selection as any;
      return sel?.node?.type?.name === 'wrappedImage' ? (sel.node.attrs.wrap as string) : null;
    },
  });

  // Синхронізуємо редактор із activeSection ЛИШЕ коли контент змінився ЗЗОВНІ
  // (перемкнули розділ, AI переписав текст, відновили версію) — а не як
  // відлуння власного onUpdate редактора (порівнюємо серіалізовану строку,
  // щоб не ловити фантомний диф і не смикати курсор під час набору).
  useEffect(() => {
    if (!uaEditor || !activeSection) return;
    const current = tiptapDocToMarkerString(uaEditor.getJSON() as JSONContent);
    if (current === (activeSection.content || '')) return;
    uaEditor.commands.setContent(markerStringToTiptapDoc(activeSection.content || ''), { emitUpdate: false });
  }, [uaEditor, activeSection?.id, activeSection?.content]);

  useEffect(() => {
    if (!enEditor || !activeSection) return;
    const current = tiptapDocToMarkerString(enEditor.getJSON() as JSONContent);
    if (current === (activeSection.contentEn || '')) return;
    enEditor.commands.setContent(markerStringToTiptapDoc(activeSection.contentEn || ''), { emitUpdate: false });
  }, [enEditor, activeSection?.id, activeSection?.contentEn]);

  // Редагованість і атрибути spellcheck/мови теж не в deps useEditor — оновлюємо їх окремо.
  useEffect(() => {
    uaEditor?.setEditable(!isReader);
    enEditor?.setEditable(!isReader);
  }, [uaEditor, enEditor, isReader]);

  useEffect(() => {
    uaEditor?.setOptions({
      editorProps: {
        attributes: { class: 'nova-manuscript-editor', spellcheck: String(spellcheckEnabled), lang: proofingLanguage },
      },
    });
  }, [uaEditor, spellcheckEnabled, proofingLanguage]);

  useEffect(() => {
    enEditor?.setOptions({
      editorProps: {
        attributes: { class: 'nova-manuscript-editor', spellcheck: String(spellcheckEnabled), lang: 'en' },
      },
    });
  }, [enEditor, spellcheckEnabled]);

  // Виділяє й прокручує до щойно вставленого з AI-чату тексту (App.tsx →
  // handleSendChatTextToChapter уже перемкнув сюди activeChapterId/activeSectionId
  // разом із pendingHighlight — застосовуємо один раз і знімаємо прапорець).
  // Навмисно БЕЗ requestAnimationFrame: rAF не спрацьовує (або сильно
  // затримується) на неактивній/невидимій вкладці, а ефект і так виконується
  // вже ПІСЛЯ коміту нового value в textarea, тож відкладати нема потреби.
  useEffect(() => {
    if (!pendingHighlight || !activeSection || pendingHighlight.sectionId !== activeSection.id) return;
    const { start, end } = pendingHighlight;
    const applyHighlight = () => {
      if (!uaEditor) return false;
      const doc = uaEditor.state.doc;
      const from = markerOffsetToDocPos(doc, start);
      const to = markerOffsetToDocPos(doc, end);
      if (from === null || to === null) return false;
      uaEditor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
      return true;
    };
    // Пряма спроба (звичайний випадок — контент уже завантажено в редактор) +
    // setTimeout-резерв на випадок, якщо редактор для цієї секції ще не встиг змонтуватись.
    if (!applyHighlight()) {
      const timeout = setTimeout(applyHighlight, 50);
      onHighlightApplied?.();
      return () => clearTimeout(timeout);
    }
    onHighlightApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHighlight, activeSection?.id, uaEditor]);

  // Ukrainian Content change handler
  const handleContentChange = (newContent: string) => {
    if (!activeChapter || !activeSection) return;
    const words = calculateWordCount(newContent);
    const updatedChapters = book.chapters.map((chap) => {
      if (chap.id !== activeChapter.id) return chap;
      return {
        ...chap,
        sections: chap.sections.map((sec) => {
          if (sec.id !== activeSection.id) return sec;
          return {
            ...sec,
            content: newContent,
            wordCount: words,
            lastModified: new Date().toISOString(),
          };
        }),
      };
    });

    onUpdateBook({
      ...book,
      chapters: updatedChapters,
      updatedAt: new Date().toISOString(),
    });
  };
  handleContentChangeRef.current = handleContentChange;

  // English Content change handler
  const handleContentEnChange = (newContentEn: string) => {
    if (!activeChapter || !activeSection) return;
    const updatedChapters = book.chapters.map((chap) => {
      if (chap.id !== activeChapter.id) return chap;
      return {
        ...chap,
        sections: chap.sections.map((sec) => {
          if (sec.id !== activeSection.id) return sec;
          return {
            ...sec,
            contentEn: newContentEn,
            lastModified: new Date().toISOString(),
          };
        }),
      };
    });

    onUpdateBook({
      ...book,
      chapters: updatedChapters,
      updatedAt: new Date().toISOString(),
    });
  };
  handleContentEnChangeRef.current = handleContentEnChange;

  /**
   * Вставляє фрагмент-маркер (наприклад `[^5]`, `[QR: ... "..."]`, репліку
   * героя) у позицію курсора активного редактора. Фрагмент проходить через
   * той самий парсер, що й повний документ (markerSnippetToNodes), тож
   * вставлені елементи читаються так само, як і збережений текст.
   */
  const insertTextAtCursor = (inserted: string, isEn = false) => {
    const editor = isEn ? enEditor : uaEditor;
    if (!editor || !activeSection) return;
    editor.chain().focus().insertContent(markerSnippetToNodes(inserted)).run();
  };

  /**
   * Перемикає жирність/курсив виділеного фрагмента — тепер напряму через
   * вбудовані команди TipTap (bold/italic marks StarterKit'у), тож
   * форматування видно одразу під час набору, а не лише в експорті.
   */
  const wrapSelection = (marker: '**' | '*', _placeholder: string, isEn = false) => {
    const editor = isEn ? enEditor : uaEditor;
    if (!editor) return;
    if (marker === '**') editor.chain().focus().toggleBold().run();
    else editor.chain().focus().toggleItalic().run();
  };

  /**
   * Застосовує гарнітуру лише до виділеного мишкою фрагмента тексту,
   * обгортаючи його маркером `[FONT="Назва"]…[/FONT]` (renderFontMarkers у
   * utils/helpers.ts розгортає його в `<span>` при експорті). На відміну
   * від `typography.bodyFont`, яка задає шрифт усієї книги, тут міняється
   * гарнітура лише позначеного фрагмента — решта тексту лишається як є.
   * Якщо нічого не виділено — робити нічого, бо застосовувати нема до чого.
   */
  const applyFontToSelection = (family: string, isEn = false): boolean => {
    const editor = isEn ? enEditor : uaEditor;
    if (!editor || editor.state.selection.empty) return false;
    editor.chain().focus().setMark('fontSpan', { family }).run();
    return true;
  };

  /**
   * Застосовує кегль (розмір шрифту, пт) лише до виділеного мишкою
   * фрагмента тексту — точна копія applyFontToSelection, лише замість
   * гарнітури керує позначкою fontSize (маркер `[SIZE=N]…[/SIZE]`).
   */
  const applyFontSizeToSelection = (size: number, isEn = false): boolean => {
    const editor = isEn ? enEditor : uaEditor;
    if (!editor || editor.state.selection.empty) return false;
    editor.chain().focus().setMark('fontSize', { size }).run();
    return true;
  };

  /**
   * Вставляє в текст маркер зображення з галереї.
   *
   * У текст іде саме маркер `[IMG: id "підпис"]`, а не сам URL: зображення
   * часто зберігаються як `data:`-URI на сотні кілобайт, і вставляння їх у
   * рукопис роздуло б і текст, і лічильник слів. Конвенція та сама, що вже
   * діє для QR-тегів (`[QR: код "назва"]`) і виносок (`[^1]`), а розгортає
   * маркер в експорті `renderImageMarkers` в utils/helpers.ts.
   */
  const handleInsertGalleryImage = (imageId: string, caption: string) => {
    if (!uaEditor) return;
    const widthMm = getPageContentWidthMm() / 2;
    uaEditor.chain().focus().insertWrappedImage({ imageId, caption, wrap: 'left', widthMm }).run();
  };

  /**
   * Кнопка «По контуру»: рахує силует фото й записує його в атрибут `shape`
   * вузла (звідти він потрапляє в маркер книги й далі в експорт).
   *
   * Рахуємо ЛІНИВО — саме тут, на натискання кнопки, а не при відкритті
   * розділу: інакше глава з трьома десятками фотографій гризла б канвас на
   * кожному завантаженні. Якщо силует уже порахований, нічого не робимо.
   *
   * `null` від computeContourPolygon означає одне з трьох: у файлі вже є
   * справжня прозорість (тоді контур зробить сам браузер із альфа-каналу),
   * тло не розпізналось, або картинку не вдалось прочитати. Перший випадок
   * штатний і мовчазний, решта — чесне повідомлення авторові, бо візуально
   * він отримає звичайне пряме обтікання замість обіцяного контуру.
   */
  const ensureContourShape = async (editor: Editor, imageId: string) => {
    const url = resolveImageUrl(imageId);
    if (!url) return;

    const result = await computeContourPolygon(url);
    if (!result) {
      setWrapToast(t('editor.imgContourNotDetected'));
      setTimeout(() => setWrapToast(null), 4000);
      return;
    }

    // Пишемо за ID картинки, а НЕ за поточним виділенням: між натисканням
    // кнопки й кінцем обчислення силуету автор міг клацнути деінде, і
    // updateAttributes пішов би не в той вузол (або нікуди). Позицію
    // шукаємо заново — документ за цей час теж міг змінитись.
    editor.commands.command(({ tr, state, dispatch }) => {
      let found = false;
      state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.type.name === 'wrappedImage' && node.attrs.imageId === imageId && !node.attrs.shape) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, shape: result.polygon });
          found = true;
          return false;
        }
        return true;
      });
      if (found && dispatch) dispatch(tr);
      return found;
    });
  };

  /**
   * Шаблони промтів автора («Конструктор промтів»), завантажені з сервера.
   * Клієнт шле шаблон разом із запитом на генерацію — сервер підставляє в
   * нього те, чого клієнт не бачить (файл стилю з user_styles).
   *
   * Вантажимо ліниво й один раз на відкритий редактор: більшості сеансів
   * генерація за фото взагалі не знадобиться.
   */
  const promptTemplatesRef = useRef<Record<'1' | '2' | '3', { system: string; user: string }> | null>(null);
  const ensurePromptTemplates = async () => {
    if (promptTemplatesRef.current) return promptTemplatesRef.current;
    try {
      const res = await fetch('/api/ai/prompt-templates', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      promptTemplatesRef.current = data?.effective || null;
      return promptTemplatesRef.current;
    } catch {
      // Сервер недоступний — генерація все одно спрацює на серверному
      // дефолті, просто без авторського шаблону.
      return null;
    }
  };

  /** Рушії AI-ядра, що вміють аналізувати фото (server/chatProviders.ts::VISION_ENGINES) — дзеркало на фронтенді, лише для фільтрації списку в пікері робочого модуля. */
  const VISION_ENGINES_FRONT = new Set(['gemini', 'gpt', 'claude']);

  /** Ліниво вантажить список моделей AI-ядра (раз на відкритий редактор) — потрібен лише для перевірки, чи рушій книги вміє аналізувати фото, і для списку в пікері робочого модуля. */
  const ensureAiCoreModels = async (): Promise<{ id: string; label: string; engine: string; available: boolean }[]> => {
    if (aiCoreModels.length) return aiCoreModels;
    try {
      const res = await fetch('/api/chat/models', { credentials: 'same-origin' });
      if (!res.ok) return [];
      const data = await res.json();
      const list = (data.models || []) as { id: string; label: string; engine: string; available: boolean }[];
      setAiCoreModels(list);
      return list;
    } catch {
      return [];
    }
  };

  /**
   * Викликає бекенд аналізу фото й вставляє результат у позначений блок
   * «AI-чернетка» одразу ЗА зображенням (getPos() — жива позиція вузла;
   * зображення — атомарний вузол, тож +1 — це вже позиція одразу за ним).
   */
  /**
   * Абзаци-сусіди зображення в документі (перший текстовий вузол ПЕРЕД і
   * ПІСЛЯ) — щоб AI продовжував саме те, що вже написано навколо картинки,
   * а не вигадував відірвану вставку. `node.textContent` — це вже чистий
   * текст без bold/italic/font-маркерів (ProseMirror сам їх не серіалізує
   * туди), тож додаткового очищення не треба. Найближчий сусід, що не сам
   * [IMG]/AI-чернетка — якщо сусід теж не текстовий вузол, повертає ''.
   */
  const getSurroundingParagraphs = (editor: Editor, imagePos: number): { before: string; after: string } => {
    const nodes: { node: PMNode; offset: number }[] = [];
    editor.state.doc.forEach((node, offset) => nodes.push({ node, offset }));
    const index = nodes.findIndex((n) => n.offset === imagePos);
    if (index === -1) return { before: '', after: '' };
    const extractText = (n: { node: PMNode; offset: number } | undefined): string => {
      if (!n || n.node.type.name === 'wrappedImage') return '';
      return (n.node.textContent || '').trim();
    };
    return { before: extractText(nodes[index - 1]), after: extractText(nodes[index + 1]) };
  };

  const runAiParagraphsRequest = async (
    imageId: string,
    modelId: string,
    paragraphCount: 1 | 2 | 3,
    editorKind: 'ua' | 'en',
    getPos: () => number
  ): Promise<'ok' | 'vision_unsupported' | 'error'> => {
    const imageUrl = resolveImageUrl(imageId);
    if (!imageUrl) return 'error';
    const editor = editorKind === 'en' ? enEditor : uaEditor;
    if (!editor) return 'error';
    const { before: contextBefore, after: contextAfter } = getSurroundingParagraphs(editor, getPos());
    const imageCaption = getImageCaption(editor, getPos());
    const templates = await ensurePromptTemplates();
    const promptTemplate = templates?.[String(paragraphCount) as '1' | '2' | '3'];
    setGeneratingImageId(imageId);
    try {
      const res = await fetch('/api/ai/generate-manuscript-paragraphs-from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          imageUrl,
          modelId,
          paragraphCount,
          language: editorKind === 'en' ? 'en' : 'uk',
          bookTitle: book.title,
          genre: book.genre,
          chapterTitle: activeChapter?.title,
          bookId: book.id,
          contextBefore,
          contextAfter,
          imageCaption,
          promptTemplate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return data?.kind === 'vision_unsupported' ? 'vision_unsupported' : 'error';
      }
      const editor = editorKind === 'en' ? enEditor : uaEditor;
      if (!editor) return 'error';
      const text = String(data.text || '').trim();
      if (!text) return 'error';
      const snippet = `[AI-DRAFT]\n\n${text}\n\n[/AI-DRAFT]`;
      editor.chain().focus().insertContentAt(getPos() + 1, markerSnippetToNodes(snippet)).run();
      return 'ok';
    } catch {
      return 'error';
    } finally {
      setGeneratingImageId(null);
    }
  };

  /** Підпис, який автор написав під цим фото — окремий плейсхолдер {ПІДПИС_ФОТО} у шаблоні промту. */
  const getImageCaption = (editor: Editor, imagePos: number): string => {
    const node = editor.state.doc.nodeAt(imagePos);
    return node?.type.name === 'wrappedImage' ? String(node.attrs.caption || '').trim() : '';
  };

  /**
   * Запит, з яким відкрили конструктор промтів, — щоб після «Зберегти й
   * згенерувати» повернутись рівно до того фото, а не просити автора
   * повторити правий клік.
   */
  const promptEditRequestRef = useRef<{
    imageId: string; editorKind: 'ua' | 'en'; getPos: () => number; paragraphCount: 1 | 2 | 3;
  } | null>(null);

  /** «Редагувати промт → N абзаци» в меню фото. */
  const handleEditPromptForCount = (paragraphCount: 1 | 2 | 3) => {
    if (!aiImageMenu) return;
    const { imageId, editorKind, getPos } = aiImageMenu;
    setAiImageMenu(null);

    const editor = editorKind === 'en' ? enEditor : uaEditor;
    if (!editor) return;
    const { before, after } = getSurroundingParagraphs(editor, getPos());

    promptEditRequestRef.current = { imageId, editorKind, getPos, paragraphCount };
    onOpenPromptConstructor?.({
      paragraphCount,
      bookTitle: book.title,
      genre: book.genre,
      chapterTitle: activeChapter?.title,
      imageCaption: getImageCaption(editor, getPos()),
      contextBefore: before,
      contextAfter: after,
    });
  };

  // «Зберегти й згенерувати» в конструкторі — App збільшує лічильник, і
  // редактор доганяє генерацію для того самого фото.
  const lastPromptTickRef = useRef(promptGenerateTick);
  useEffect(() => {
    if (promptGenerateTick === lastPromptTickRef.current) return;
    lastPromptTickRef.current = promptGenerateTick;
    // Автор щойно зберіг шаблон у конструкторі — кеш редактора застарів.
    promptTemplatesRef.current = null;
    const request = promptEditRequestRef.current;
    if (!request) return;
    promptEditRequestRef.current = null;
    void handleChooseParagraphCountFor(request.imageId, request.editorKind, request.getPos, request.paragraphCount);
  }, [promptGenerateTick]);

  /** Клік на «1/2/3 абзаци» в меню фото — якщо рушій книги не вміє аналізувати фото, спершу пропонує обрати робочий модуль (Q8/Q14 grilling-сесії). */
  const handleChooseParagraphCount = async (paragraphCount: 1 | 2 | 3) => {
    if (!aiImageMenu) return;
    const { imageId, x, y, editorKind, getPos } = aiImageMenu;
    setAiImageMenu(null);
    await handleChooseParagraphCountFor(imageId, editorKind, getPos, paragraphCount, x, y);
  };

  /**
   * Спільне тіло генерації за фото: викликається і з меню правого кліку, і
   * після «Зберегти й згенерувати» в конструкторі промтів (там координат
   * меню вже немає, тому пікер робочого модуля стає по центру).
   */
  const handleChooseParagraphCountFor = async (
    imageId: string,
    editorKind: 'ua' | 'en',
    getPos: () => number,
    paragraphCount: 1 | 2 | 3,
    x = window.innerWidth / 2,
    y = window.innerHeight / 3
  ) => {
    const models = await ensureAiCoreModels();
    let modelId = book.preferredAiModelId || '';
    let engine = modelId ? models.find((m) => m.id === modelId)?.engine : 'gemini';
    if (!modelId) {
      modelId = models.find((m) => m.engine === 'gemini')?.id || 'gemini-3.7-flash';
      engine = 'gemini';
    }

    if (engine && !VISION_ENGINES_FRONT.has(engine)) {
      setAiEnginePicker({ imageId, x, y, editorKind, getPos, paragraphCount });
      return;
    }

    const result = await runAiParagraphsRequest(imageId, modelId, paragraphCount, editorKind, getPos);
    if (result === 'vision_unsupported') {
      setAiEnginePicker({ imageId, x, y, editorKind, getPos, paragraphCount });
    }
  };

  /** Вибір робочого модуля в піксері (рушій книги не вмів аналізувати фото) — одразу стає новим рушієм книги + повідомлення про зміну (Q14). */
  const handlePickWorkingAiEngine = async (modelId: string, label: string) => {
    if (!aiEnginePicker) return;
    const { imageId, editorKind, getPos, paragraphCount } = aiEnginePicker;
    setAiEnginePicker(null);
    onUpdateBook(
      { ...book, preferredAiModelId: modelId },
      'Рушій AI книги',
      `Рушій AI для книги змінено на «${label}» (потрібна підтримка аналізу фото).`
    );
    setAiEngineToast(t('editor.aiEngineChangedToast', { label }));
    setTimeout(() => setAiEngineToast(null), 4000);
    await runAiParagraphsRequest(imageId, modelId, paragraphCount, editorKind, getPos);
  };

  // -------------------------------------------------------------------------
  // «Вставити абзац згенерованого ШІ тексту на основі виділеного фрагмента»
  // (завдання 3б). Дзеркало генерації за фото, але джерело — виділення
  // письменника, а не картинка.
  // -------------------------------------------------------------------------

  /**
   * Редактор, у якому зараз лежить непорожнє виділення. Редакторів два (UA і
   * EN), а контекстне меню одне на всю робочу область — тож перед запитом
   * треба з'ясувати, ЗВІДКИ брати текст. Сфокусований має пріоритет: якщо
   * автор перемикався між колонками, виділення могло лишитись у кожній, і
   * правильна відповідь — та, де курсор.
   */
  const getSelectionSource = (): { editor: Editor; kind: 'ua' | 'en'; text: string; to: number } | null => {
    const candidates: { editor: Editor | null; kind: 'ua' | 'en' }[] = [
      { editor: uaEditor, kind: 'ua' },
      { editor: enEditor, kind: 'en' },
    ];
    const ordered = [...candidates].sort(
      (a, b) => Number(Boolean(b.editor?.isFocused)) - Number(Boolean(a.editor?.isFocused))
    );
    for (const candidate of ordered) {
      const editor = candidate.editor;
      if (!editor) continue;
      const { from, to } = editor.state.selection;
      if (to <= from) continue;
      // Роздільник '\n\n' між блоками — щоб модель бачила межі абзаців так
      // само, як їх бачить читач, а не суцільним рядком.
      const text = editor.state.doc.textBetween(from, to, '\n\n', ' ').trim();
      if (text) return { editor, kind: candidate.kind, text, to };
    }
    return null;
  };

  /** Чи є що передавати моделі — вмикає/вимикає пункт меню без запиту на сервер. */
  const hasUsableSelection = (): boolean => {
    const source = getSelectionSource();
    return Boolean(source && source.text.length >= 40);
  };

  /**
   * Для обговорення межа інша, ніж для генерації.
   *
   * Дописати абзац за трьома словами не можна — моделі нема від чого
   * відштовхнутись, тому там мінімум 40 знаків. А от спитати «чи не надто
   * різкий цей перехід?» можна й про півречення: у розмові автор сам
   * пояснює, що його турбує. Спільна межа зробила б одну з двох функцій
   * гіршою без причини.
   */
  const hasFragmentToDiscuss = (): boolean => {
    const source = getSelectionSource();
    return Boolean(source && source.text.length > 0);
  };

  /**
   * Передає виділене в чат. Підпис «звідки» збирається тут, а не в чаті:
   * саме редактор знає, яка глава й розділ зараз відкриті, і саме цього
   * контексту бракує в розмові, коли автор через десять реплік уже не
   * пам'ятає, про який шматок ішлося.
   */
  const discussSelectionInChat = () => {
    const source = getSelectionSource();
    if (!source || !onDiscussInChat) return;
    const chapter = book.chapters.find((c) => c.id === activeChapterId);
    const section = chapter?.sections.find((sc) => sc.id === activeSectionId);
    const where = [chapter?.title, section?.title].filter(Boolean).join(' → ');
    onDiscussInChat(source.text, where);
  };

  const [selectionAiBusy, setSelectionAiBusy] = useState<1 | 2 | 3 | null>(null);
  const [showSelectionSubmenu, setShowSelectionSubmenu] = useState(false);

  // «Озвучити фрагмент» — Pro/Ultra (server/subscriptions.ts requirePlanAtLeast),
  // адмін завжди проходить (usePlanAccess сама це враховує).
  const narrationAccess = usePlanAccess(authUser, ['pro', 'ultra']);
  const [showNarrationSubmenu, setShowNarrationSubmenu] = useState(false);
  const [narrationBusy, setNarrationBusy] = useState<NarrationLang | null>(null);
  const [narrationPlayer, setNarrationPlayer] = useState<{ audioUrl: string; label: string } | null>(null);

  /**
   * Повноекранний («фокус») режим редагування тексту — F12 або значок у
   * шапці панелі тексту. У Chrome/Firefox F12 системно зарезервований під
   * DevTools, і сторінка НЕ може заблокувати це на рівні браузера —
   * preventDefault() нижче лише ловить випадки, коли браузер таки віддає
   * подію сторінці (звичний десктопний Chrome з відкритим фокусом на
   * сторінці зазвичай віддає). Кнопка — надійний шлях у будь-якому разі.
   *
   * Технічно це НЕ Fullscreen API (document.requestFullscreen): той вимагає
   * жесту користувача під кожен виклик і виходить по Escape, що суперечило
   * б «вихід теж за F12». Натомість — CSS-оверлей на весь viewport
   * (position: fixed, inset: 0), той самий підхід, що «режим без
   * відволікань» у Notion/Google Docs.
   */
  // usePersistentState, а не useState: письменник, який щоразу відкриває
  // книгу у фулскріні, не повинен щоразу тиснути F12 наново — той самий
  // принцип, що вже діє для showLeftTree/showRightPanel вище.
  const [isFullscreenMode, setIsFullscreenMode] = usePersistentState<boolean>('nova_editor_fullscreenMode', false);
  const fullscreenRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setIsFullscreenMode((v) => !v);
        return;
      }
      // Escape — ДОДАТКОВИЙ вихід, лише вихід (не тогл і не вхід). F12 у
      // Chrome/Firefox зарезервований під DevTools і не завжди доходить до
      // сторінки (застереження із запису #39) — Escape лишається робочим
      // запасним шляхом навіть тоді, коли браузер забрав F12 собі.
      if (e.key === 'Escape' && isFullscreenMode) {
        setIsFullscreenMode(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreenMode]);

  /**
   * Перехід між «розривами сторінок» (PaginationPlugin.ts малює їх як
   * `[data-nova-pagebreak]` прямо в тексті) — маленькі стрілочки збоку в
   * повноекранному режимі. getBoundingClientRect().top — навмисно
   * відносно viewport, а не якогось конкретного контейнера прокрутки:
   * scrollIntoView() сам знайде правильний скрол-контекст, навіть
   * вкладений, тож не треба здогадуватись, який саме елемент прокручується.
   */
  const jumpToPageBreak = (direction: 1 | -1) => {
    const root = fullscreenRootRef.current;
    if (!root) return;
    const breaks = Array.from(root.querySelectorAll<HTMLElement>('[data-nova-pagebreak]'));
    if (breaks.length === 0) return;
    const threshold = 60; // px — щоб клік не «застрягав» на розриві, який уже майже у видимій зоні
    const target =
      direction === 1
        ? breaks.find((el) => el.getBoundingClientRect().top > threshold)
        : [...breaks].reverse().find((el) => el.getBoundingClientRect().top < -threshold);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /**
   * Індикатор прогресу сторінки в повноекранному режимі: «Сторінка N з M»
   * — та сама техніка, що й jumpToPageBreak (getBoundingClientRect().top
   * відносно viewport), тільки тепер рахуємо, скільки розривів вже
   * «проскрольовано» повз верх екрана. Слухач на document у
   * capture-фазі, бо не важливо, який саме вкладений контейнер насправді скролиться.
   */
  const [pageProgress, setPageProgress] = useState<{ current: number; total: number }>({ current: 1, total: 1 });

  useEffect(() => {
    if (!isFullscreenMode) return;
    const root = fullscreenRootRef.current;
    if (!root) return;

    const recomputePageProgress = () => {
      const breaks = Array.from(root.querySelectorAll<HTMLElement>('[data-nova-pagebreak]'));
      const total = breaks.length + 1;
      const passed = breaks.filter((el) => el.getBoundingClientRect().top < 120).length;
      setPageProgress({ current: Math.min(passed + 1, total), total });
    };

    recomputePageProgress();
    window.addEventListener('scroll', recomputePageProgress, true);
    window.addEventListener('resize', recomputePageProgress);
    return () => {
      window.removeEventListener('scroll', recomputePageProgress, true);
      window.removeEventListener('resize', recomputePageProgress);
    };
  }, [isFullscreenMode]);

  /**
   * Таймер спринту письма — не блокує редагування, лише рахує час і
   * скільки слів написано за сесію (activeSection.wordCount на старті
   * проти зараз — той самий лічильник, що вже показаний у статус-барі
   * редактора, тож не потрібен окремий підрахунок символів).
   */
  const [sprintDurationMin, setSprintDurationMin] = useState(25);
  const [sprintEndAt, setSprintEndAt] = useState<number | null>(null);
  const [sprintStartWords, setSprintStartWords] = useState(0);
  const [sprintNow, setSprintNow] = useState(() => Date.now());
  const [showSprintMenu, setShowSprintMenu] = useState(false);
  const [sprintToast, setSprintToast] = useState<string | null>(null);

  useEffect(() => {
    if (!sprintEndAt) return;
    const interval = window.setInterval(() => setSprintNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [sprintEndAt]);

  useEffect(() => {
    if (!sprintEndAt || sprintNow < sprintEndAt) return;
    const wordsWritten = Math.max(0, (activeSection?.wordCount || 0) - sprintStartWords);
    setSprintToast(t('editor.sprintDoneToast', { n: wordsWritten }));
    setTimeout(() => setSprintToast(null), 6000);
    setSprintEndAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintNow, sprintEndAt]);

  const formatSprintTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const sprintRemainingSec = sprintEndAt ? Math.max(0, Math.round((sprintEndAt - sprintNow) / 1000)) : 0;
  const sprintWordsWritten = sprintEndAt ? Math.max(0, (activeSection?.wordCount || 0) - sprintStartWords) : 0;

  const startSprint = (minutes: number) => {
    setSprintDurationMin(minutes);
    setSprintStartWords(activeSection?.wordCount || 0);
    setSprintEndAt(Date.now() + minutes * 60 * 1000);
    setSprintNow(Date.now());
    setShowSprintMenu(false);
  };

  const stopSprint = () => {
    setSprintEndAt(null);
    setShowSprintMenu(false);
  };

  // Кнопка озвучення прямо на панелі — та сама функція, що раніше жила
  // лише в контекстному меню (правий клік → «Озвучити»). Live-редагування
  // не мало жодного способу почути виділений фрагмент одним кліком, не
  // відриваючись від клавіатури під праву кнопку миші.
  const [showNarrationToolbarMenu, setShowNarrationToolbarMenu] = useState(false);

  /**
   * Озвучує виділений фрагмент (абзац або навіть одне слово — та сама межа
   * «будь-яке непорожнє виділення», що й для обговорення в чаті, а не 40
   * символів генерації абзаців: людина хоче почути слово так само, як
   * спитати про нього).
   */
  const narrateSelection = async (lang: NarrationLang) => {
    const source = getSelectionSource();
    if (!source) {
      // Раніше — тихий no-op: у контекстному меню кнопка й так недоступна
      // без виділення. Тепер ця сама функція викликається і з кнопки на
      // панелі інструментів, де такого запобіжника нема, тож людині
      // потрібно бачити, чому нічого не відбулось.
      setAiEngineToast(t('editor.narrationNoSelection'));
      setTimeout(() => setAiEngineToast(null), 4000);
      return;
    }
    if (!narrationAccess.hasAccess) {
      setAiEngineToast(t('editor.narrationPlanRequired'));
      setTimeout(() => setAiEngineToast(null), 5000);
      return;
    }
    const chapter = book.chapters.find((c) => c.id === activeChapterId);
    const section = chapter?.sections.find((sc) => sc.id === activeSectionId);
    const where = [chapter?.title, section?.title].filter(Boolean).join(' → ');

    setNarrationBusy(lang);
    try {
      const result = await synthesizeNarration({
        text: source.text,
        lang,
        scope: 'selection',
        bookId: book.id,
        chapterId: chapter?.id,
        sectionId: section?.id,
      });
      setNarrationPlayer({ audioUrl: result.audioUrl, label: where || t('editor.narrationFragmentLabel') });
    } catch (err) {
      const message = err instanceof NarrationClientError ? err.message : t('editor.narrationFailed');
      setAiEngineToast(message);
      setTimeout(() => setAiEngineToast(null), 6000);
    } finally {
      setNarrationBusy(null);
    }
  };

  // Список моделей потрібен уже на першому рендері панелі (випадаючий вибір
  // LLM), а не лише в мить генерації — тож тягнемо його одразу при відкритті
  // розділу. ensureAiCoreModels сам кешує: другий виклик мережу не чіпає.
  useEffect(() => {
    void ensureAiCoreModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Порожнє значення — це не «нічого не обрано», а окремий робочий стан:
   * «хай вирішує адміністратор». Саме його сервер трактує як дозвіл узяти
   * модель із прив'язки модуля (server/coreModuleModels.ts), тож підставляти
   * сюди першу-ліпшу доступну модель не можна — це мовчки відібрало б у
   * адміна керування.
   */
  const effectiveAiModelId = book.preferredAiModelId || '';

  /**
   * Текст, що йде ОДРАЗУ ПІСЛЯ виділення, — той самий контекст, який промпт
   * за фото бере з абзацу-сусіда: без нього вставка ризикує суперечити
   * наступному абзацу або дослівно його повторити.
   */
  const getTextAfterSelection = (editor: Editor, to: number): string => {
    const $to = editor.state.doc.resolve(to);
    const blockEnd = $to.depth > 0 ? $to.after(1) : to;
    const tail = editor.state.doc.textBetween(blockEnd, Math.min(blockEnd + 900, editor.state.doc.content.size), '\n\n', ' ');
    return tail.trim();
  };

  const runSelectionParagraphs = async (paragraphCount: 1 | 2 | 3) => {
    const source = getSelectionSource();
    if (!source) {
      setAiEngineToast(t('editor.selectionAiNoSelection'));
      setTimeout(() => setAiEngineToast(null), 4000);
      return;
    }

    const models = await ensureAiCoreModels();
    const modelId =
      book.preferredAiModelId || models.find((m) => m.engine === 'gemini')?.id || 'gemini-3.7-flash';

    setSelectionAiBusy(paragraphCount);
    try {
      const res = await fetch('/api/ai/generate-paragraphs-from-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          selection: source.text,
          modelId,
          paragraphCount,
          language: source.kind === 'en' ? 'en' : 'uk',
          bookTitle: book.title,
          genre: book.genre,
          chapterTitle: activeChapter?.title,
          bookId: book.id,
          contextAfter: getTextAfterSelection(source.editor, source.to),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiEngineToast(String(data?.error || t('editor.selectionAiFailed')));
        setTimeout(() => setAiEngineToast(null), 6000);
        return;
      }
      const text = String(data.text || '').trim();
      if (!text) {
        setAiEngineToast(t('editor.selectionAiFailed'));
        setTimeout(() => setAiEngineToast(null), 4000);
        return;
      }

      // Вставляємо ПІСЛЯ блоку, у якому закінчується виділення: «AI-чернетка»
      // — вузол рівня документа, і вставка всередину абзацу розірвала б його
      // навпіл замість того, щоб лягти окремим блоком під виділеним місцем.
      const $to = source.editor.state.doc.resolve(source.to);
      const insertAt = $to.depth > 0 ? $to.after(1) : source.to;
      const snippet = `[AI-DRAFT]\n\n${text}\n\n[/AI-DRAFT]`;
      source.editor.chain().focus().insertContentAt(insertAt, markerSnippetToNodes(snippet)).run();
    } catch {
      setAiEngineToast(t('editor.selectionAiFailed'));
      setTimeout(() => setAiEngineToast(null), 4000);
    } finally {
      setSelectionAiBusy(null);
    }
  };

  // Закриває меню/пікер AI-тексту за фото при кліку/Esc поза ним.
  useEffect(() => {
    if (!aiImageMenu && !aiEnginePicker) return;
    const close = () => {
      setAiImageMenu(null);
      setAiEnginePicker(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [aiImageMenu, aiEnginePicker]);

  /** Пише зміну поля (від перетягування лінійки PageRuler.tsx) напряму в те саме поле, що редагує «Верстка & Поля». */
  const handleChangeMargins = (patch: { insideMm?: number; outsideMm?: number }) => {
    onUpdateBook({
      ...book,
      layoutConfig: {
        ...book.layoutConfig,
        margins: { ...book.layoutConfig.margins, ...patch },
      },
    });
  };

  /**
   * Змінює формат аркуша просто з редактора — те саме поле, що редагує
   * «Верстка & Поля», тож обидва місця лишаються синхронними без окремого
   * стану (той самий підхід, що й у handleChangeMargins вище).
   */
  const handleChangePageFormat = (presetId: string) => {
    const preset = PAGE_FORMAT_QUICK_OPTIONS.find((p) => p.id === presetId);
    if (!preset) return;
    onUpdateBook(
      {
        ...book,
        layoutConfig: {
          ...book.layoutConfig,
          formatPreset: preset.id,
          pageWidthMm: preset.widthMm,
          pageHeightMm: preset.heightMm,
        },
      },
      'Зміна формату верстки',
      `Формат аркуша змінено на ${t(preset.labelKey)} (з редактора)`
    );
  };

  /**
   * Крива головного героя (HeroArcPanel) — правки прилітають на кожен
   * штрих повзунка чи символ у textarea, тож без логу, як і решта
   * дрібних правок сцени вище (title/location/conflict): один запис в
   * журнал змін на слово геть засмітив би його.
   */
  const handleUpdateHeroArc = (next: HeroArcState) => {
    onUpdateBook({ ...book, heroArc: next });
  };

  /** Відкриває вікно англійського тексту поруч з українським. */
  const openEnglishWindow = () => {
    setEditorLanguageMode('parallel');
  };

  /** Шрифти, які користувач довантажив з Google Fonts (живуть у книзі). */
  const customFonts = book.layoutConfig.customFonts ?? [];

  /**
   * Підключаємо таблиці стилів довантажених шрифтів при кожному відкритті
   * книги — інакше після перезавантаження сторінки збережений вибір шрифту
   * вказував би на гарнітуру, якої в документі немає.
   */
  useEffect(() => {
    customFonts.forEach((f) => {
      if (document.querySelector(`link[data-nova-font="${f.family}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = f.href;
      link.dataset.novaFont = f.family;
      document.head.appendChild(link);
    });
  }, [customFonts]);

  /** Поточний CSS-стек шрифту основного тексту — спільний для UA та EN,
   *  тому англійське вікно завжди повторює вибір, зроблений в українському. */
  const manuscriptFontStack = customFonts.some((f) => f.family === book.layoutConfig.typography.bodyFont)
    ? `"${book.layoutConfig.typography.bodyFont}", Georgia, serif`
    : bodyFontStack(book.layoutConfig.typography.bodyFont);

  const handleInstallFont = (font: CustomFont) => {
    onUpdateBook(
      {
        ...book,
        layoutConfig: {
          ...book.layoutConfig,
          customFonts: [...customFonts, font],
          typography: { ...book.layoutConfig.typography, bodyFont: font.family },
        },
      },
      'Підключено новий шрифт',
      `${font.family} (Google Fonts)`
    );
  };

  const handleRemoveFont = (family: string) => {
    const rest = customFonts.filter((f) => f.family !== family);
    onUpdateBook({
      ...book,
      layoutConfig: {
        ...book.layoutConfig,
        customFonts: rest,
        // Якщо видаляють саме той шрифт, яким набрано книгу — повертаємось
        // до вбудованого, щоб текст не лишився без гарнітури.
        typography: {
          ...book.layoutConfig.typography,
          bodyFont:
            book.layoutConfig.typography.bodyFont === family
              ? 'Literata'
              : book.layoutConfig.typography.bodyFont,
        },
      },
    });
  };

  /**
   * Панель форматування всередині вікна тексту.
   *
   * Вибір шрифту в списку застосовується лише до виділеного мишкою
   * фрагмента тексту (обгортає його маркером `[FONT="…"]`, який
   * renderFontMarkers у utils/helpers.ts розгортає при експорті) — а не
   * до всієї глави чи книги. Базовий шрифт книги (`typography.bodyFont`)
   * і надалі можна поміняти в LayoutView («Верстка & Поля»).
   *
   * Жирність і нахил діють на виділений фрагмент і кладуть у текст
   * markdown-маркери, бо контент розділу зберігається як простий рядок.
   */
  const renderFormatToolbar = (isEn: boolean) => (
    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
      <select
        value={book.layoutConfig.typography.bodyFont}
        onChange={(e) => {
          const value = e.target.value;
          // Остання позиція списку — не шрифт, а команда «додати шрифт».
          if (value === ADD_FONT_OPTION) {
            setShowFontModal(true);
            return;
          }
          // Гарнітура застосовується лише до виділеного мишкою фрагмента,
          // а не до всієї глави. Якщо нічого не виділено — підказуємо чому
          // нічого не відбулось замість мовчазного застосування до всього.
          const applied = applyFontToSelection(value, isEn);
          if (!applied) setFontSelectHint(t('editor.bodyFontNoSelection'));
        }}
        disabled={isReader}
        className="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px]"
        style={{ fontFamily: manuscriptFontStack }}
        title={t('editor.bodyFontTitle')}
        aria-label={t('editor.bodyFontTitle')}
      >
        {BODY_FONT_OPTIONS.map((f) => (
          <option
            key={f.value}
            value={f.value}
            className="bg-slate-900 text-slate-100 text-base"
            style={{ fontFamily: bodyFontStack(f.value) }}
          >
            {t(f.labelKey)}
          </option>
        ))}
        {customFonts.length > 0 && (
          <optgroup label={t('editor.fontGroupCustom')}>
            {customFonts.map((f) => (
              <option
                key={f.family}
                value={f.family}
                className="bg-slate-900 text-slate-100 text-base"
                style={{ fontFamily: `"${f.family}", Georgia, serif` }}
              >
                {f.family}
              </option>
            ))}
          </optgroup>
        )}
        <option value={ADD_FONT_OPTION} className="bg-slate-900 text-amber-300 text-base">
          ⬇ {t('editor.fontAddOption')}
        </option>
      </select>

      <input
        type="number"
        list="nova-font-size-presets"
        placeholder={t('editor.fontSizePlaceholder')}
        disabled={isReader}
        onChange={(e) => {
          const value = Number(e.target.value);
          if (!value) return;
          const applied = applyFontSizeToSelection(value, isEn);
          if (!applied) setFontSelectHint(t('editor.fontSizeNoSelection'));
        }}
        className="w-16 px-1.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        title={t('editor.fontSizeTitle')}
        aria-label={t('editor.fontSizeTitle')}
      />
      <datalist id="nova-font-size-presets">
        {[8, 9, 10, 12, 14, 16, 18, 20, 22, 26, 28, 32, 40, 48, 52, 64].map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => wrapSelection('**', t('editor.boldPlaceholder'), isEn)}
        disabled={isReader}
        className="p-1 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={t('editor.boldTitle')}
        aria-label={t('editor.boldTitle')}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => wrapSelection('*', t('editor.italicPlaceholder'), isEn)}
        disabled={isReader}
        className="p-1 rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={t('editor.italicTitle')}
        aria-label={t('editor.italicTitle')}
      >
        <Italic className="w-3.5 h-3.5" />
      </button>

      {/* Повноекранний режим: примусовий перенос рядка в flex-wrap
          контейнері (flex-basis: 100% розтягує невидимий елемент на
          всю ширину і зіштовхує наступні елементи на новий рядок) —
          шрифт, розмір, жирний/курсив лишаються окремим верхнім рядком
          панелі, решта (рушій AI, обтікання картинки, сам перемикач
          фулскріну) переходить нижче. У звичайному режимі елемент не
          рендериться — панель лишається як була, одним рядком. */}
      {isFullscreenMode && <div className="basis-full h-0" aria-hidden="true" />}

      {/* Вибір LLM для генерації тексту книги (завдання 3). Значення живе в
          самій книзі (`preferredAiModelId`) — те саме поле, яким уже
          користується генерація за фото, тож вибір діє на всі ШІ-дії
          розділу «Книга і текст», а не лише на одну кнопку. Моделі без
          ключа показані, але недоступні: письменник має бачити, ЩО саме
          можна підключити, а не порожній список. */}
      <select
        value={effectiveAiModelId}
        onChange={(e) => {
          const value = e.target.value;
          const label = aiCoreModels.find((m) => m.id === value)?.label || value;
          onUpdateBook(
            { ...book, preferredAiModelId: value },
            'Рушій AI книги',
            `Рушій AI для книги змінено на «${label}».`
          );
        }}
        disabled={isReader || aiCoreModels.length === 0}
        className="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-sm text-slate-200 outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-w-[150px]"
        title={t('editor.aiModelSelectTitle')}
        aria-label={t('editor.aiModelSelectTitle')}
      >
        <option value="" className="bg-slate-900 text-slate-100">
          {aiCoreModels.length === 0 ? t('editor.aiModelSelectEmpty') : t('editor.aiModelSelectAuto')}
        </option>
        {aiCoreModels.map((m) => (
          <option
            key={m.id}
            value={m.id}
            disabled={!m.available}
            className="bg-slate-900 text-slate-100"
          >
            {m.available ? m.label : `${m.label} — ${t('editor.aiModelNoKey')}`}
          </option>
        ))}
      </select>

      {(() => {
        const selectedWrap = isEn ? enSelectedImageWrap : uaSelectedImageWrap;
        const editor = isEn ? enEditor : uaEditor;
        if (!selectedWrap) return null;
        const setWrap = (wrap: 'left' | 'right' | 'none' | 'contour') => {
          // Вузол читаємо ДО команди: setImageWrap перебудовує вузол, і
          // виділення після нього вже не обов'язково лишається на картинці.
          const selectedNode = (editor?.state.selection as any)?.node;
          editor?.chain().focus().setImageWrap(wrap).run();
          if (wrap === 'contour' && editor && selectedNode?.type?.name === 'wrappedImage' && !selectedNode.attrs.shape) {
            void ensureContourShape(editor, selectedNode.attrs.imageId as string);
          }
        };
        const wrapBtnClass = (mode: string) =>
          `p-1 rounded-md transition-colors ${
            selectedWrap === mode
              ? 'bg-amber-500 text-slate-950'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`;
        return (
          <div className="flex items-center gap-1 pl-1.5 ml-1 border-l border-slate-800">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => setWrap('left')} className={wrapBtnClass('left')} title={t('editor.imgWrapLeft')} aria-label={t('editor.imgWrapLeft')}>
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => setWrap('right')} className={wrapBtnClass('right')} title={t('editor.imgWrapRight')} aria-label={t('editor.imgWrapRight')}>
              <AlignRight className="w-3.5 h-3.5" />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => setWrap('none')} className={wrapBtnClass('none')} title={t('editor.imgWrapNone')} aria-label={t('editor.imgWrapNone')}>
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => setWrap('contour')} className={wrapBtnClass('contour')} title={t('editor.imgWrapContour')} aria-label={t('editor.imgWrapContour')}>
              <Spline className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })()}

      {/* Озвучення виділеного фрагмента прямо з панелі — раніше та сама
          дія жила лише в контекстному меню (правий клік). */}
      <div className="relative">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowNarrationToolbarMenu((v) => !v)}
          disabled={narrationBusy !== null}
          className="p-1 rounded-md ml-1 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
          title={t('editor.narrateToolbarTitle')}
          aria-label={t('editor.narrateToolbarTitle')}
        >
          {narrationBusy ? <RotateCcw className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        {showNarrationToolbarMenu && (
          <div className="absolute top-full right-0 mt-1 z-50 p-1.5 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col gap-0.5 min-w-[110px]">
            {(['uk', 'en'] as const).map((lang) => (
              <button
                key={lang}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowNarrationToolbarMenu(false);
                  void narrateSelection(lang);
                }}
                disabled={narrationBusy !== null}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                <Volume2 className="w-3 h-3 text-sky-400/70" />
                {lang === 'uk' ? t('editor.narrationLangUk') : t('editor.narrationLangEn')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Таймер спринту письма — довільна тривалість, лічить слова,
          написані за сесію (activeSection.wordCount на старті проти
          зараз), не блокує редагування. Той самий перемикач у кожному
          вигляді панелі, бо ця функція рендериться в усіх розкладках. */}
      <div className="relative">
        {sprintEndAt ? (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={stopSprint}
            className="flex items-center gap-1 px-2 py-1 rounded-md ml-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-mono text-[11px] transition-colors"
            title={t('editor.sprintStopTitle', { n: sprintDurationMin })}
          >
            <Timer className="w-3.5 h-3.5" />
            <span>{formatSprintTime(sprintRemainingSec)}</span>
            {sprintWordsWritten > 0 && <span className="text-rose-400">+{sprintWordsWritten}</span>}
          </button>
        ) : (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowSprintMenu((v) => !v)}
            className="p-1 rounded-md ml-1 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title={t('editor.sprintStartTitle')}
            aria-label={t('editor.sprintStartTitle')}
          >
            <Timer className="w-3.5 h-3.5" />
          </button>
        )}

        {showSprintMenu && !sprintEndAt && (
          <div className="absolute top-full right-0 mt-1 z-50 p-2 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col gap-1 min-w-[140px]">
            <p className="text-[10px] text-slate-500 px-1 pb-1">{t('editor.sprintPickHint')}</p>
            {[10, 15, 25, 45].map((min) => (
              <button
                key={min}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => startSprint(min)}
                className="text-left px-2 py-1 rounded-md text-xs text-slate-200 hover:bg-slate-800"
              >
                {t('editor.sprintMinutes', { n: min })}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Повноекранний режим — лише значок, без підпису (так попросили),
          і той самий перемикач у кожному вигляді панелі, бо ця функція
          рендериться в усіх розкладках (одна мова / розворот укр|англ). */}
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setIsFullscreenMode((v) => !v)}
        className={`p-1 rounded-md ml-1 transition-colors ${
          isFullscreenMode ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
        title={isFullscreenMode ? t('editor.fullscreenExitTitle') : t('editor.fullscreenEnterTitle')}
        aria-label={isFullscreenMode ? t('editor.fullscreenExitTitle') : t('editor.fullscreenEnterTitle')}
      >
        {isFullscreenMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  // Add Chapter
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
          title: `Розділ 1: Початок`,
          titleEn: `Section 1: The Beginning`,
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
    onSelectSection(newChapterId, newSectionId);
  };

  // Add Section to Chapter
  const handleAddSection = (chapterId: string) => {
    const chap = book.chapters.find((c) => c.id === chapterId);
    if (!chap) return;
    const nextOrder = chap.sections.length + 1;
    const newSectionId = `sec-${Date.now()}`;
    const newSection: Section = {
      id: newSectionId,
      chapterId: chapterId,
      title: `Розділ ${nextOrder}: Новий розділ`,
      titleEn: `Section ${nextOrder}: New Section`,
      order: nextOrder,
      content: '',
      contentEn: '',
      wordCount: 0,
      lastModified: new Date().toISOString(),
      scene: {
        id: `scene-${Date.now()}`,
        sectionId: newSectionId,
        title: `Сцена розділу ${nextOrder}`,
        act: 1,
        summary: '',
        location: '',
        timeOfDay: 'День',
        timelineOrder: nextOrder,
        intensityScore: 5,
        conflict: '',
        resolution: '',
        characters: [],
      },
    };

    const updatedChapters = book.chapters.map((c) => {
      if (c.id !== chapterId) return c;
      return {
        ...c,
        sections: [...c.sections, newSection],
      };
    });

    onUpdateBook(
      {
        ...book,
        chapters: updatedChapters,
        updatedAt: new Date().toISOString(),
      },
      'Створення розділу',
      `Додано розділ «${newSection.title}» до глави «${chap.title}»`
    );
    onSelectSection(chapterId, newSectionId);
  };

  // Update Character dossier
  const handleSaveCharacterDossier = (updatedChar: Character) => {
    const updatedChars = book.characters.map((c) => (c.id === updatedChar.id ? updatedChar : c));
    onUpdateBook(
      { ...book, characters: updatedChars },
      'Редагування персонажа',
      `Оновлено досьє персонажа «${updatedChar.name} ${updatedChar.surname || ''}» (${updatedChar.role})`
    );
  };

  // Add / update participants in current scene with Audit Log recording
  const handleConfirmParticipants = (
    updatedParticipants: CharacterInScene[],
    logInfo: { chapterTitle: string; sectionTitle: string; addedCharacterNames: string[] }
  ) => {
    if (!activeChapter || !activeSection) return;

    const currentScene = activeSection.scene || {
      id: `scene-${Date.now()}`,
      sectionId: activeSection.id,
      title: `Сцена ${activeSection.title}`,
      act: 1,
      summary: '',
      location: '',
      timeOfDay: 'День',
      timelineOrder: 1,
      intensityScore: 5,
      conflict: '',
      resolution: '',
      characters: [],
    };

    const updatedScene = {
      ...currentScene,
      characters: updatedParticipants,
    };

    const updatedChapters = book.chapters.map((c) => {
      if (c.id !== activeChapter.id) return c;
      return {
        ...c,
        sections: c.sections.map((s) => (s.id === activeSection.id ? { ...s, scene: updatedScene } : s)),
      };
    });

    // Write exact audit log as requested:
    // "щоб в лого файл було записано: розділ, назва глави книги та персонажі, які добавлені в сцену"
    const logDetails = `Розділ: «${logInfo.sectionTitle}», Глава: «${logInfo.chapterTitle}», Персонажі: [${
      logInfo.addedCharacterNames.length > 0 ? logInfo.addedCharacterNames.join(', ') : 'Немає'
    }]`;

    // Правило узгодження зі складом глави: усі, кого додали в сцену,
    // мають бути й у `Chapter.cast` — інакше склад глави відстає від сцен.
    const withCast = updatedChapters.map((c) => {
      if (c.id !== activeChapter.id) return c;
      const cast = c.cast ?? [];
      const missing = updatedParticipants
        .map((p) => p.characterId)
        .filter((id) => !cast.includes(id));
      return missing.length > 0 ? { ...c, cast: [...cast, ...missing] } : c;
    });

    onUpdateBook(
      { ...book, chapters: withCast },
      'Додано учасників до сцени',
      logDetails
    );

    setTranslationSuccessToast(`Учасників сцени оновлено та записано в аудит-лог!`);
    setTimeout(() => setTranslationSuccessToast(null), 3000);
  };

  /**
   * Змінює порядок учасників сцени (перетягування карток у компактному
   * режимі). Порядок — це дані книги, тож зберігаємо його в сцені.
   */
  const handleReorderParticipants = (fromIdx: number, toIdx: number) => {
    if (!activeChapter || !activeSection?.scene || fromIdx === toIdx) return;
    const list = [...activeSection.scene.characters];
    const [moved] = list.splice(fromIdx, 1);
    if (!moved) return;
    list.splice(toIdx, 0, moved);

    const updatedChapters = book.chapters.map((c) => {
      if (c.id !== activeChapter.id) return c;
      return {
        ...c,
        sections: c.sections.map((s) =>
          s.id === activeSection.id && s.scene ? { ...s, scene: { ...s.scene, characters: list } } : s
        ),
      };
    });
    onUpdateBook({ ...book, chapters: updatedChapters });
  };

  /**
   * Вставляє в текст заготовку репліки обраного героя і підсвічує його
   * панель праворуч (решта героїв притемнюються — див. renderSceneParticipants).
   * Виділеним лишається саме текст репліки, щоб одразу друкувати поверх.
   */
  const handleInsertCharacterLine = (characterId: string) => {
    const char = book.characters.find((c) => c.id === characterId);
    if (!char || !activeSection || !uaEditor) return;

    const name = `${char.name}${char.surname ? ` ${char.surname}` : ''}`;
    const placeholder = t('editor.replicaPlaceholder');
    const template = `\n— ${placeholder}, — ${name}.\n`;

    // Вставляємо як звичайний текстовий шаблон (лише \n, без маркерів) — тож
    // зміщення символу в template 1:1 збігається з позицією ProseMirror.
    const insertStart = uaEditor.state.selection.from;
    uaEditor.chain().focus().insertContent(markerSnippetToNodes(template)).run();

    setHighlightedCharacterId(characterId);
    cancelBehaviorPopoverClose();
    setBehaviorPopover(null);
    setContextMenu(null);

    // Виділяємо саме підказковий текст усередині вставленого шаблону.
    const from = insertStart + template.indexOf(placeholder);
    const to = from + placeholder.length;
    uaEditor.chain().focus().setTextSelection({ from, to }).run();
  };

  /**
   * Вставляє в текст сцени вибраний поведінковий шаблон героя (опис дії /
   * поведінки в діалозі) у позицію курсора — для швидкого вводу в сюжет.
   */
  const handleInsertBehaviorPattern = (pattern: string) => {
    if (!activeSection || !pattern.trim() || !uaEditor) return;
    const template = `\n${pattern.trim()}\n`;
    uaEditor.chain().focus().insertContent(markerSnippetToNodes(template)).run();

    cancelBehaviorPopoverClose();
    setBehaviorPopover(null);
    setContextMenu(null);
  };

  // Remove individual participant from scene
  const handleRemoveParticipant = (characterId: string) => {
    if (!activeChapter || !activeSection || !activeSection.scene) return;
    const char = book.characters.find((c) => c.id === characterId);
    const updatedChars = activeSection.scene.characters.filter((c) => c.characterId !== characterId);
    
    const updatedChapters = book.chapters.map((c) => {
      if (c.id !== activeChapter.id) return c;
      return {
        ...c,
        sections: c.sections.map((s) =>
          s.id === activeSection.id && s.scene
            ? { ...s, scene: { ...s.scene, characters: updatedChars } }
            : s
        ),
      };
    });

    onUpdateBook(
      { ...book, chapters: updatedChapters },
      'Видалення учасника зі сцени',
      `Розділ: «${activeSection.title}», Глава: «${activeChapter.title}», Вилучено персонажа: «${char?.name || 'Герой'}»`
    );
  };

  // Apply AI Generated Avatar Art to Character
  const handleApplyAvatarToCharacter = (characterId: string, avatarUrl: string, modelName: string) => {
    const targetChar = book.characters.find((c) => c.id === characterId);
    const updatedChars = book.characters.map((c) =>
      c.id === characterId ? { ...c, avatarUrl } : c
    );

    const logDetails = `Герой: «${targetChar?.name || 'Персонаж'} ${targetChar?.surname || ''}», Модель: ${modelName}, Розділ: «${activeSection?.title || ''}», Глава: «${activeChapter?.title || ''}»`;

    onUpdateBook(
      { ...book, characters: updatedChars },
      'Згенеровано арт персонажа',
      logDetails
    );

    setTranslationSuccessToast(`Портрет героя «${targetChar?.name}» оновлено (${modelName})!`);
    setTimeout(() => setTranslationSuccessToast(null), 3500);
  };

  // Add new Character created by AI (Dossier + Art)
  const handleAddNewCharacterWithArt = (newChar: Character, addToCurrentScene = true) => {
    const updatedCharacters = [...book.characters, newChar];
    let updatedChapters = book.chapters;

    if (addToCurrentScene && activeChapter && activeSection && activeSection.scene) {
      const newParticipant: CharacterInScene = {
        characterId: newChar.id,
        goal: newChar.personality?.goals?.[0] || 'Участь у розвитку подій сцени',
        emotionalState: 'Зосереджений',
        action: 'Активна дія у сцені',
        conflict: newChar.personality?.internalConflict || 'Локальна напруга',
      };

      const updatedScene = {
        ...activeSection.scene,
        characters: [...activeSection.scene.characters, newParticipant],
      };

      updatedChapters = book.chapters.map((c) => {
        if (c.id !== activeChapter.id) return c;
        return {
          ...c,
          sections: c.sections.map((s) => (s.id === activeSection.id ? { ...s, scene: updatedScene } : s)),
        };
      });
    }

    const logDetails = `Розділ: «${activeSection?.title || ''}», Глава: «${activeChapter?.title || ''}», Новий герой: «${newChar.name} ${newChar.surname || ''}» (${newChar.role}), додано до сцени: ${addToCurrentScene ? 'Так' : 'Ні'}`;

    onUpdateBook(
      { ...book, characters: updatedCharacters, chapters: updatedChapters },
      'Створено нового героя з AI артом',
      logDetails
    );

    setTranslationSuccessToast(`Нового героя «${newChar.name}» створено та збережено в книгу!`);
    setTimeout(() => setTranslationSuccessToast(null), 3500);
  };

  // Translate Ukrainian section content, titles & scene into English for publication
  const handleTranslateToEnglish = async () => {
    if (!activeSection) return;
    setIsTranslating(true);

    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: activeSection.content,
          title: activeSection.title,
          chapterTitle: activeChapter?.title,
          scene: activeSection.scene ? {
            title: activeSection.scene.title,
            conflict: activeSection.scene.conflict,
            resolution: activeSection.scene.resolution,
            summary: activeSection.scene.summary,
          } : undefined,
          genre: book.genre,
          bookTitle: book.title,
        }),
      });

      const data = await res.json();
      if (data.translatedText || data.translatedTitle) {
        const updatedChapters = book.chapters.map((chap) => {
          if (chap.id !== activeChapter?.id) return chap;
          return {
            ...chap,
            titleEn: data.translatedChapterTitle || chap.titleEn || chap.title,
            sections: chap.sections.map((sec) => {
              if (sec.id !== activeSection.id) return sec;
              return {
                ...sec,
                titleEn: data.translatedTitle || sec.titleEn || sec.title,
                contentEn: data.translatedText || sec.contentEn || '',
                lastModified: new Date().toISOString(),
                scene: sec.scene && data.translatedScene ? {
                  ...sec.scene,
                  title: sec.scene.title, // keep UA, can store notes if needed
                } : sec.scene,
              };
            }),
          };
        });

        // Switch to parallel view to immediately review translation
        setEditorLanguageMode('parallel');

        onUpdateBook(
          {
            ...book,
            titleEn: book.titleEn || 'Shadows of Neo-Kyiv 2084',
            chapters: updatedChapters,
          },
          'Літературний переклад на англійську',
          `Розділ: «${activeSection.title}» -> «${data.translatedTitle || 'English Section'}» (Слів перекладу: ${
            data.translatedText ? data.translatedText.split(/\s+/).length : 0
          })`
        );

        setTranslationSuccessToast('Переклад успішно згенеровано та збережено в англійську версію книги!');
        setTimeout(() => setTranslationSuccessToast(null), 4000);
      }
    } catch (err) {
      console.error('Error during translation:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  // Trigger AI Text transformation
  const handleTriggerAiEdit = async (actionCategory: string) => {
    if (!activeSection) return;
    const textToProcess = selectedText || activeSection.content;
    if (!textToProcess.trim()) return;

    setIsGeneratingAi(true);
    setRightPanelTab('workAi');
    setRightPanelSubTab('diff');

    try {
      const response = await fetch('/api/ai/edit-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToProcess,
          instruction: customAiPrompt || `Застосуй художній режим: ${actionCategory}`,
          category: actionCategory,
          bookContext: `${book.title}, жанр: ${book.genre}`,
          sceneContext: activeSection.scene ? `${activeSection.scene.title}: ${activeSection.scene.conflict}` : '',
          styleGuide: activeStyleGuide || undefined,
        }),
      });

      const data = await response.json();
      if (data.proposedText) {
        const diffs = computeWordDiff(textToProcess, data.proposedText);
        const newProp: AIProposal = {
          id: `prop-${Date.now()}`,
          sectionId: activeSection.id,
          originalText: textToProcess,
          proposedText: data.proposedText,
          instruction: customAiPrompt || actionCategory,
          category: actionCategory as any,
          status: 'pending',
          diffSegments: diffs,
          createdAt: new Date().toISOString(),
        };
        setCurrentProposal(newProp);
      }
    } catch (err) {
      console.error('Error in AI editing:', err);
    } finally {
      setIsGeneratingAi(false);
      setCustomAiPrompt('');
    }
  };

  // Accept Proposal
  const handleAcceptProposal = () => {
    if (!currentProposal || !activeSection) return;

    let updatedContent = activeSection.content;
    if (selectedText) {
      updatedContent = updatedContent.replace(currentProposal.originalText, currentProposal.proposedText);
    } else {
      updatedContent = currentProposal.proposedText;
    }

    handleContentChange(updatedContent);
    setProposalHistory([{ ...currentProposal, status: 'accepted' }, ...proposalHistory]);
    setCurrentProposal(null);
    setSelectedText('');
  };

  // Reject Proposal
  const handleRejectProposal = () => {
    if (!currentProposal) return;
    setProposalHistory([{ ...currentProposal, status: 'rejected' }, ...proposalHistory]);
    setCurrentProposal(null);
  };

  // Run Ukrainian Spellcheck
  const handleRunSpellcheck = async () => {
    if (!activeSection?.content) return;
    setIsCheckingGrammar(true);
    setRightPanelTab('workAi');
    setRightPanelSubTab('spellcheck');
    try {
      const res = await fetch('/api/ai/check-grammar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: activeSection.content,
          language: proofingLanguage,
        }),
      });
      const data = await res.json();
      if (data.issues) {
        // Слова з власного словника книги (вигадані імена, терміни)
        // не мають потрапляти в зауваження.
        const dict = new Set((book.customDictionary ?? []).map((w) => w.toLowerCase()));
        setSpellIssues(
          data.issues.filter(
            (iss: SpellCheckIssue) =>
              !ignoredIssueIds.has(iss.id) && !dict.has((iss.word || '').toLowerCase())
          )
        );
      }
    } catch (err) {
      console.error('Error running spellcheck:', err);
    } finally {
      setIsCheckingGrammar(false);
    }
  };

  const handleReplaceSpellIssue = (issue: SpellCheckIssue, suggestion: string) => {
    if (!activeSection) return;
    const newContent = activeSection.content.replace(issue.word, suggestion);
    handleContentChange(newContent);
    setSpellIssues(spellIssues.filter((i) => i.id !== issue.id));
  };

  const handleIgnoreIssue = (issueId: string) => {
    setIgnoredIssueIds(new Set([...ignoredIssueIds, issueId]));
    setSpellIssues(spellIssues.filter((i) => i.id !== issueId));
  };

  // Quick Footnote insertion
  const handleInsertFootnote = () => {
    if (!modalFnText.trim() || !activeSection) return;
    const nextNum = (book.footnotes || []).length + 1;
    const newFootnote: Footnote = {
      id: `fn-${Date.now()}`,
      number: nextNum,
      marker: `${nextNum}`,
      term: modalFnTerm.trim() || undefined,
      text: modalFnText.trim(),
      sectionId: activeSection.id,
      chapterId: activeChapter?.id,
    };

    onUpdateBook({
      ...book,
      footnotes: [...(book.footnotes || []), newFootnote],
    });

    insertTextAtCursor(`[^${nextNum}]`);
    setModalFnText('');
    setModalFnTerm('');
    setShowFootnoteModal(false);
  };

  // Quick QR creation & in-text insertion
  const handleInsertQR = async () => {
    if (!modalQrTitle.trim() || !modalQrPayload.trim() || !activeSection) return;
    const nextNum = ((book.qrTags || []).length + 1).toString().padStart(2, '0');
    const qrCodeTag = `QR-${nextNum}`;
    const qrDataUrl = await generateQrDataUrl(modalQrPayload.trim());

    const newTag: QRTag = {
      id: `qr-${Date.now()}`,
      code: qrCodeTag,
      title: modalQrTitle.trim(),
      actionType: modalQrType,
      payload: modalQrPayload.trim(),
      sectionId: activeSection.id,
      chapterId: activeChapter?.id,
      svgData: qrDataUrl,
      createdAt: new Date().toISOString(),
    };

    onUpdateBook({
      ...book,
      qrTags: [...(book.qrTags || []), newTag],
    });

    insertTextAtCursor(`\n\n[QR: ${qrCodeTag} "${modalQrTitle.trim()}"]\n\n`);
    setModalQrTitle('');
    setModalQrPayload('');
    setShowQrModal(false);
  };

  // Course tag creation: turns a selected text excerpt into a CourseTag,
  // used later on the "Courses" page to attach video/photo/homework/3D materials.
  const handleAddCourseTag = () => {
    if (!modalCourseTagLabel.trim() || !selectedText.trim() || !activeSection || !activeChapter) return;
    const newTag: CourseTag = {
      id: `course-tag-${Date.now()}`,
      bookId: book.id,
      chapterId: activeChapter.id,
      sectionId: activeSection.id,
      label: modalCourseTagLabel.trim(),
      textSnippet: selectedText,
      createdAt: new Date().toISOString(),
    };

    onUpdateBook({
      ...book,
      course: {
        ...(book.course || { enabled: true, title: book.title, tags: [], materials: [] }),
        tags: [...(book.course?.tags || []), newTag],
      },
    });

    setModalCourseTagLabel('');
    setShowCourseTagModal(false);
  };

  // AI Presets list
  const aiPresets = [
    { id: 'improve', label: t('editor.aiPresetImprove'), icon: Wand2 },
    { id: 'artistic', label: t('editor.aiPresetArtistic'), icon: Sparkles },
    { id: 'cinematic', label: t('editor.aiPresetCinematic'), icon: Film },
    { id: 'dialogue', label: t('editor.aiPresetDialogue'), icon: Quote },
    { id: 'rewrite', label: t('editor.aiPresetRewrite'), icon: RotateCcw },
    { id: 'shorten', label: t('editor.aiPresetShorten'), icon: SlidersHorizontal },
    { id: 'expand', label: t('editor.aiPresetExpand'), icon: Plus },
    { id: 'simple', label: t('editor.aiPresetSimple'), icon: FileText },
    { id: 'emotional', label: t('editor.aiPresetEmotional'), icon: Flame },
    { id: 'description', label: t('editor.aiPresetDescription'), icon: BookMarked },
    { id: 'grammar', label: t('editor.aiPresetGrammar'), icon: CheckCheck },
    { id: 'syntax', label: t('editor.aiPresetSyntax'), icon: SlidersHorizontal },
    { id: 'repetitions', label: t('editor.aiPresetRepetitions'), icon: History },
    { id: 'tone', label: t('editor.aiPresetTone'), icon: AlertCircle },
  ];

  // Active section footnotes & QR codes
  const sectionFootnotes = (book.footnotes || []).filter((f) => f.sectionId === activeSection?.id);
  const sectionQrTags = (book.qrTags || []).filter((q) => q.sectionId === activeSection?.id);
  const sectionCourseTags = (book.course?.tags || []).filter((tag) => tag.sectionId === activeSection?.id);

  // Role badges helper
  const roleBadges: Record<Character['role'], { label: string; color: string }> = {
    protagonist: { label: t('editor.roleProtagonist'), color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
    antagonist: { label: t('editor.roleAntagonist'), color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
    deuteragonist: { label: t('editor.roleDeuteragonist'), color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
    mentor: { label: t('editor.roleMentor'), color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
    ally: { label: t('editor.roleAlly'), color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    rival: { label: t('editor.roleRival'), color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
    minor: { label: t('editor.roleMinor'), color: 'bg-slate-700/50 text-slate-300 border-slate-600' },
  };

  const sceneCharacters = activeSection?.scene?.characters || [];

  /**
   * Герої, які беруть участь у ПОТОЧНІЙ сцені. Саме їх письменник може
   * вставити в текст реплікою з контекстного меню («Вставити репліку героя»)
   * — а не всіх героїв книги. Джерело — учасники сцени сцени, а не Chapter.cast.
   */
  const sceneCharacterList = book.characters.filter((c) =>
    sceneCharacters.some((sc) => sc.characterId === c.id)
  );

  // Учасники сцени — єдиний блок. Показується або в правій колонці,
  // або у вільному вікні (після «Відкріпити»).
  // ---- Склад глави (Chapter.cast) -------------------------------------------

  /** Герої, приписані до поточної глави. Джерело — `Chapter.cast`. */
  const chapterCast = activeChapter?.cast ?? [];

  /**
   * Учасники сцен цієї глави, яких немає у складі глави. Саме вони
   * показуються з позначкою розбіжності та кнопкою «підтягнути» —
   * правило узгодження зі сценами.
   */
  const castMismatch = Array.from(
    new Set(
      (activeChapter?.sections ?? [])
        .flatMap((sec) => sec.scene?.characters.map((c) => c.characterId) ?? [])
        .filter((id) => !chapterCast.includes(id))
    )
  );

  const writeChapterCast = (nextCast: string[], action?: string, details?: string) => {
    if (!activeChapter) return;
    const updatedChapters = book.chapters.map((c) =>
      c.id === activeChapter.id ? { ...c, cast: nextCast } : c
    );
    onUpdateBook({ ...book, chapters: updatedChapters }, action, details);
  };

  const addToChapterCast = (characterId: string) => {
    if (chapterCast.includes(characterId)) return;
    const char = book.characters.find((c) => c.id === characterId);
    writeChapterCast(
      [...chapterCast, characterId],
      'Додано героя до складу глави',
      `Глава: «${activeChapter?.title}», Герой: ${char?.name || characterId}`
    );
  };

  /** Прибирає героя лише зі складу глави — сцени навмисно не чіпаємо. */
  const removeFromChapterCast = (characterId: string) => {
    const char = book.characters.find((c) => c.id === characterId);
    writeChapterCast(
      chapterCast.filter((id) => id !== characterId),
      'Прибрано героя зі складу глави',
      `Глава: «${activeChapter?.title}», Герой: ${char?.name || characterId}`
    );
  };

  /** Додає у склад глави всіх учасників її сцен, яких там бракує. */
  const syncCastFromScenes = () => {
    if (castMismatch.length === 0) return;
    writeChapterCast(
      [...chapterCast, ...castMismatch],
      'Склад глави узгоджено зі сценами',
      `Глава: «${activeChapter?.title}», додано: ${castMismatch.length}`
    );
  };

  /**
   * Панель складу глави: додавання й прибирання героїв поточної глави
   * без впливу на сцени (затверджений варіант 2).
   */
  const renderChapterCast = () => (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5 shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-bold text-slate-100 text-sm truncate">
            {t('editor.chapterCastTitle', { n: chapterCast.length })}
          </span>
        </div>
        {castMismatch.length > 0 && !isReader && (
          <button
            onClick={syncCastFromScenes}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold hover:bg-amber-500/30 transition-all"
            title={t('editor.chapterCastSyncTitle')}
          >
            <AlertCircle className="w-3 h-3" />
            <span>{t('editor.chapterCastSync', { n: castMismatch.length })}</span>
          </button>
        )}
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">{t('editor.chapterCastHint')}</p>

      {chapterCast.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">{t('editor.chapterCastEmpty')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chapterCast.map((id) => {
            const char = book.characters.find((c) => c.id === id);
            if (!char) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-200"
              >
                {char.avatarUrl ? (
                  <img src={char.avatarUrl} alt="" className="w-5 h-5 rounded-lg object-cover" />
                ) : (
                  <span className="w-5 h-5 rounded-lg bg-slate-800 flex items-center justify-center text-[9px] font-bold text-amber-400">
                    {char.name?.charAt(0)}
                  </span>
                )}
                <span className="truncate max-w-[110px]">{char.name}</span>
                {!isReader && (
                  <button
                    onClick={() => removeFromChapterCast(id)}
                    className="text-slate-500 hover:text-rose-300 transition-colors"
                    title={t('editor.chapterCastRemoveTitle')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {!isReader && (
        <select
          value=""
          onChange={(e) => e.target.value && addToChapterCast(e.target.value)}
          className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-200 cursor-pointer"
        >
          <option value="">{t('editor.chapterCastAdd')}</option>
          {book.characters
            .filter((c) => !chapterCast.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id} className="bg-slate-900">
                {c.name} {c.surname || ''}
              </option>
            ))}
        </select>
      )}
    </div>
  );

  const renderSceneParticipants = () => (
    <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3 shadow-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <span className="font-bold text-slate-100 text-sm">
            {t('editor.sceneParticipants', { n: sceneCharacters.length })}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {highlightedCharacterId && (
            <button
              onClick={() => setHighlightedCharacterId(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-[11px] transition-all active:scale-95"
              title={t('editor.clearHighlightTitle')}
            >
              <X className="w-3 h-3" />
              <span>{t('editor.clearHighlightBtn')}</span>
            </button>
          )}

          {/* Компактний режим: коли героїв більше, ніж вміщує панель */}
          <button
            onClick={() => setParticipantsCompact(!participantsCompact)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border font-bold text-[11px] transition-all shadow-sm active:scale-95 ${
              participantsCompact
                ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={participantsCompact ? t('editor.participantsExpandTitle') : t('editor.participantsCompactTitle')}
          >
            {participantsCompact ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            <span>{participantsCompact ? t('editor.participantsExpandBtn') : t('editor.participantsCompactBtn')}</span>
          </button>

          <button
            onClick={() => setParticipantsUnpinned(!participantsUnpinned)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border font-bold text-[11px] transition-all shadow-sm active:scale-95 ${
              participantsUnpinned
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title={participantsUnpinned ? t('editor.pinTitle') : t('editor.unpinTitle')}
          >
            {participantsUnpinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
            <span>{participantsUnpinned ? t('editor.pinBtn') : t('editor.unpinBtn')}</span>
          </button>

          <button
            onClick={() => {
              setHeroToEnhance(null);
              setShowGenerateHeroModal(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-[11px] transition-all shadow-sm active:scale-95"
            title={t('editor.generateHeroTitle')}
          >
            <Sparkles className="w-3 h-3 text-slate-950" />
            <span>{t('editor.generateHero')}</span>
          </button>

          <button
            onClick={() => setShowAddParticipantsModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-[11px] transition-all shadow-sm active:scale-95"
          >
            <UserPlus className="w-3 h-3" />
            <span>{t('editor.addParticipant')}</span>
          </button>
        </div>
      </div>

      {sceneCharacters.length === 0 ? (
        <div className="p-5 text-center text-slate-500 space-y-2 border border-dashed border-slate-800 rounded-xl">
          <Users className="w-6 h-6 mx-auto text-slate-600" />
          <p>{t('editor.noHeroesInScene')}</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={() => {
                setHeroToEnhance(null);
                setShowGenerateHeroModal(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" />
              <span>{t('editor.generateHeroAi')}</span>
            </button>
            <button
              onClick={() => setShowAddParticipantsModal(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-all"
            >
              {t('editor.chooseFromRegistry')}
            </button>
          </div>
        </div>
      ) : (
        <div className={participantsCompact ? 'flex flex-wrap gap-2' : 'space-y-3'}>
          {sceneCharacters.map((charInScene, idx) => {
            const char = book.characters.find((c) => c.id === charInScene.characterId);
            const badge = char ? (roleBadges[char.role] || roleBadges.minor) : roleBadges.minor;

            // Підсвічування після вставки репліки: обраний герой горить
            // яскравіше, решта — під 50-відсотковою маскою затемнення.
            const isHighlighted = highlightedCharacterId === charInScene.characterId;
            const isDimmed = highlightedCharacterId !== null && !isHighlighted;
            const highlightCls = isHighlighted
              ? 'border-amber-400/70 ring-1 ring-amber-400/40 aurora-glow-amber'
              : 'border-slate-800 hover:border-slate-700/80';
            const dimCls = isDimmed ? 'opacity-50 saturate-50' : '';

            /* Компактний режим: лише фото та ім'я. Картки перетягуються
               мишею для зміни порядку — перетягування обмежене самим
               списком, тобто межами правої панелі. */
            if (participantsCompact) {
              return (
                <div
                  key={idx}
                  draggable
                  onDragStart={() => setDraggedParticipantIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedParticipantIdx !== null) handleReorderParticipants(draggedParticipantIdx, idx);
                    setDraggedParticipantIdx(null);
                  }}
                  onDragEnd={() => setDraggedParticipantIdx(null)}
                  onClick={() => setHighlightedCharacterId(isHighlighted ? null : charInScene.characterId)}
                  onMouseEnter={(e) => {
                    cancelBehaviorPopoverClose();
                    if (char) setBehaviorPopover({ charId: char.id, x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={scheduleBehaviorPopoverClose}
                  title={char ? `${char.name} ${char.surname || ''}` : t('editor.heroFallback')}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-xl bg-slate-950 border cursor-grab active:cursor-grabbing transition-all select-none ${highlightCls} ${dimCls} ${
                    draggedParticipantIdx === idx ? 'opacity-40' : ''
                  }`}
                >
                  <GripVertical className="w-3 h-3 text-slate-600 shrink-0" />
                  {char?.avatarUrl ? (
                    <img src={char.avatarUrl} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-bold text-amber-400 shrink-0">
                      {char?.name?.charAt(0) || '?'}
                    </div>
                  )}
                  <span className="text-[11px] font-semibold text-slate-200 truncate max-w-[110px]">
                    {char?.name || t('editor.heroFallback')}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={idx}
                onMouseEnter={(e) => {
                  cancelBehaviorPopoverClose();
                  if (char) setBehaviorPopover({ charId: char.id, x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={scheduleBehaviorPopoverClose}
                className={`p-3 rounded-xl bg-slate-950 border space-y-2.5 shadow-sm transition-all ${highlightCls} ${dimCls}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div 
                      className="relative group/avatar cursor-pointer"
                      onClick={() => {
                        if (char) {
                          setHeroToEnhance(char);
                          setShowGenerateHeroModal(true);
                        }
                      }}
                      title={t('editor.avatarGenTitle')}
                    >
                      {char?.avatarUrl ? (
                        <img
                          src={char.avatarUrl}
                          alt={char.name}
                          className="w-11 h-11 rounded-xl object-cover border border-amber-500/40 shrink-0 shadow-sm group-hover/avatar:border-amber-400 transition-all"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 font-bold shrink-0">
                          {char?.name?.charAt(0) || t('editor.heroFallback').charAt(0)}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 rounded-xl opacity-0 group-hover/avatar:opacity-100 flex items-center justify-center transition-all">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-white text-xs truncate">
                          {char ? `${char.name} ${char.surname || ''}` : t('editor.heroFallback')}
                        </span>
                        {char?.alias && (
                          <span className="text-[10px] text-slate-400 italic">
                            («{char.alias}»)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-bold border ${badge.color}`}>
                          {badge.label}
                        </span>
                        {char?.profession && (
                          <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                            • {char.profession}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {char && (
                      <>
                        <button
                          onClick={() => {
                            setHeroToEnhance(char);
                            setShowGenerateHeroModal(true);
                          }}
                          className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/30 rounded-lg text-[11px] font-semibold transition-colors"
                          title={t('editor.artBtnTitle')}
                        >
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          <span>{t('editor.artBtn')}</span>
                        </button>

                        <button
                          onClick={() => setEditingCharacter(char)}
                          className="flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-lg text-[11px] font-semibold transition-colors"
                          title={t('editor.dossierBtnTitle')}
                        >
                          <Edit3 className="w-3 h-3 text-slate-400" />
                          <span>{t('editor.dossierBtn')}</span>
                        </button>
                      </>
                    )}

                    <button
                      onClick={() => handleRemoveParticipant(charInScene.characterId)}
                      className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition-colors"
                      title={t('editor.removeParticipantTitle')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1 border-t border-slate-900">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-0.5">{t('editor.charGoalLabel')}</label>
                    <input
                      type="text"
                      value={charInScene.goal}
                      placeholder={t('editor.charGoalPlaceholder')}
                      onChange={(e) => {
                        const updatedChars = [...sceneCharacters];
                        updatedChars[idx] = { ...updatedChars[idx], goal: e.target.value };
                        const updatedChapters = book.chapters.map((c) => {
                          if (c.id !== activeChapter?.id) return c;
                          return {
                            ...c,
                            sections: c.sections.map((s) =>
                              s.id === activeSection?.id && s.scene
                                ? { ...s, scene: { ...s.scene, characters: updatedChars } }
                                : s
                            ),
                          };
                        });
                        onUpdateBook({ ...book, chapters: updatedChapters });
                      }}
                      className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-200 focus:border-amber-400 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-0.5">{t('editor.charEmotionLabel')}</label>
                    <input
                      type="text"
                      value={charInScene.emotionalState || ''}
                      placeholder={t('editor.charEmotionPlaceholder')}
                      onChange={(e) => {
                        const updatedChars = [...sceneCharacters];
                        updatedChars[idx] = { ...updatedChars[idx], emotionalState: e.target.value };
                        const updatedChapters = book.chapters.map((c) => {
                          if (c.id !== activeChapter?.id) return c;
                          return {
                            ...c,
                            sections: c.sections.map((s) =>
                              s.id === activeSection?.id && s.scene
                                ? { ...s, scene: { ...s.scene, characters: updatedChars } }
                                : s
                            ),
                          };
                        });
                        onUpdateBook({ ...book, chapters: updatedChapters });
                      }}
                      className="w-full p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-200 focus:border-amber-400 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={fullscreenRootRef}
      className={`flex flex-col lg:flex-row overflow-hidden bg-slate-900 text-slate-100 relative ${
        isFullscreenMode
          ? 'nova-fullscreen-editor fixed inset-0 z-[200] w-screen h-screen'
          : 'flex-1 min-h-0'
      }`}
      style={isFullscreenMode ? undefined : { height: 'calc(100vh - 105px)', maxHeight: 'calc(100vh - 105px)' }}
    >
      {/* Повноекранний режим: маленькі стрілочки збоку для переходу між
          розривами сторінок (не системний Fullscreen API — просто
          оверлей на весь viewport, тож ці кнопки лишаються звичайним
          fixed-елементом усередині нього). */}
      {isFullscreenMode && (
        <div className="fixed right-3 top-1/2 -translate-y-1/2 z-[210] flex flex-col gap-1.5">
          <button
            onClick={() => jumpToPageBreak(-1)}
            className="p-1 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 shadow-lg"
            title={t('editor.fullscreenPrevPage')}
            aria-label={t('editor.fullscreenPrevPage')}
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            onClick={() => jumpToPageBreak(1)}
            className="p-1 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 shadow-lg"
            title={t('editor.fullscreenNextPage')}
            aria-label={t('editor.fullscreenNextPage')}
          >
            <ChevronDown className="w-3 h-3" />
          </button>
          <div
            className="mt-0.5 text-[10px] leading-none text-center text-slate-400 bg-slate-800/90 border border-slate-700 rounded-full px-1.5 py-1 shadow-lg select-none tabular-nums"
            title={t('editor.fullscreenPageProgress', { current: pageProgress.current, total: pageProgress.total })}
            aria-label={t('editor.fullscreenPageProgress', { current: pageProgress.current, total: pageProgress.total })}
          >
            {pageProgress.current}/{pageProgress.total}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {translationSuccessToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-500/90 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-emerald-400 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{translationSuccessToast}</span>
        </div>
      )}

      {fontSelectHintText && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500/90 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-amber-400 text-xs">
          <AlertCircle className="w-4 h-4" />
          <span>{fontSelectHintText}</span>
        </div>
      )}

      {aiEngineToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500/90 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-amber-400 text-xs">
          <Sparkles className="w-4 h-4" />
          <span>{aiEngineToast}</span>
        </div>
      )}

      {wrapToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-amber-200 font-semibold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-amber-500/40 text-xs">
          <Spline className="w-4 h-4" />
          <span>{wrapToast}</span>
        </div>
      )}

      {sprintToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-rose-500/90 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-rose-400 text-xs">
          <Timer className="w-4 h-4" />
          <span>{sprintToast}</span>
        </div>
      )}

      {/* Плеєр озвученого фрагмента — закритий хрестиком, а не таймером:
          автор може слухати довше, ніж живе звичайний тост. */}
      {narrationPlayer && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-slate-200 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-3 border border-sky-500/40 text-xs max-w-[92vw]">
          <Volume2 className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="truncate max-w-[160px] text-slate-400">{narrationPlayer.label}</span>
          <audio src={narrationPlayer.audioUrl} controls autoPlay className="h-8" style={{ maxWidth: 260 }} />
          <button
            onClick={() => setNarrationPlayer(null)}
            className="p-1 text-slate-400 hover:text-white rounded-md shrink-0"
            title={t('editor.narrationClosePlayer')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Mobile Top Navigation Bar */}
      <div className="lg:hidden flex items-center justify-between p-2.5 bg-slate-950 border-b border-slate-800 text-xs shrink-0">
        <button
          onClick={() => setShowLeftTree(!showLeftTree)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold transition-all ${
            showLeftTree ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-300'
          }`}
        >
          <PanelLeft className="w-3.5 h-3.5" />
          <span>{t('editor.tocMobile', { n: book.chapters.length })}</span>
        </button>

        <div className="font-bold text-slate-200 truncate max-w-[140px] text-[11px]">
          {activeSection?.title}
        </div>

        <button
          onClick={() => setShowRightPanel(!showRightPanel)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold transition-all ${
            showRightPanel ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-800 text-slate-300'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>{t('editor.charactersSceneMobile')}</span>
        </button>
      </div>

      {/* LEFT DRAWER: Book Structure Tree (Can be collapsed or opened) */}
      {showLeftTree && (
        <aside className="w-full lg:w-72 bg-slate-950/95 backdrop-blur-xl border-r border-slate-800 shadow-2xl shadow-black/60 flex flex-col shrink-0 absolute z-40 h-full max-h-full">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-amber-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                {t('editor.tocHeading')}
              </h2>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleAddChapter}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 transition-all"
                title={t('editor.addChapterTitle')}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('editor.addChapterBtn')}</span>
              </button>
              
              <button
                onClick={() => setShowLeftTree(false)}
                className="p-1 text-slate-400 hover:text-white rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tree Item List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {book.chapters.map((chapter, chapIndex) => {
              const isChapActive = chapter.id === activeChapter?.id;
              const chapWords = chapter.sections.reduce((acc, s) => acc + s.wordCount, 0);

              return (
                <div
                  key={chapter.id}
                  className={`rounded-xl border transition-all ${
                    isChapActive
                      ? 'bg-slate-900/90 border-amber-500/40 shadow-sm'
                      : 'bg-slate-900/40 border-slate-800/70 hover:border-slate-700'
                  }`}
                >
                  {/* Chapter Header */}
                  <div className="p-2.5 flex items-center justify-between group">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <input
                        type="text"
                        value={chapter.title}
                        onChange={(e) => {
                          const updated = book.chapters.map((c) =>
                            c.id === chapter.id ? { ...c, title: e.target.value } : c
                          );
                          onUpdateBook({ ...book, chapters: updated });
                        }}
                        className="text-xs font-bold text-slate-200 bg-transparent border-b border-transparent focus:border-amber-400 focus:outline-hidden truncate w-full"
                        placeholder={t('editor.chapterTitlePlaceholder')}
                      />
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <span className="text-[10px] font-mono text-slate-400 mr-1">
                        {t('editor.wordsShort', { n: chapWords })}
                      </span>
                      <button
                        onClick={() => handleAddSection(chapter.id)}
                        className="p-1 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-md"
                        title={t('editor.addSectionTitle')}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Sections List */}
                  <div className="px-2 pb-2 space-y-1">
                    {chapter.sections.map((section) => {
                      const isSecActive = section.id === activeSection?.id;
                      return (
                        <div
                          key={section.id}
                          onClick={() => {
                            onSelectSection(chapter.id, section.id);
                            if (window.innerWidth < 1024) setShowLeftTree(false);
                          }}
                          className={`group/sec flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-all ${
                            isSecActive
                              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/40 font-medium'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                          }`}
                        >
                          <span className="truncate flex-1">{section.title}</span>
                          <span className="text-[10px] font-mono text-slate-500 group-hover/sec:text-slate-300">
                            {t('editor.wordsShort', { n: section.wordCount })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* LEFT / CENTER: MAIN WRITING AREA ("велике поле для тексту книги зліва") */}
      <main
        className="flex-1 min-h-0 flex flex-col h-full bg-slate-950 overflow-hidden border-r border-slate-800"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        
        {/* Editor Top Title Bar */}
        <div className="p-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {!showLeftTree && (
              <button
                onClick={() => setShowLeftTree(true)}
                data-tour="editor__1"
                className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-lg text-xs transition-colors shrink-0"
                title={t('editor.openTocTitle')}
              >
                <PanelLeft className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('editor.tocBtn')}</span>
              </button>
            )}

            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={activeSection?.title || ''}
                onChange={(e) => {
                  if (!activeChapter || !activeSection) return;
                  const updated = book.chapters.map((c) => {
                    if (c.id !== activeChapter.id) return c;
                    return {
                      ...c,
                      sections: c.sections.map((s) =>
                        s.id === activeSection.id ? { ...s, title: e.target.value } : s
                      ),
                    };
                  });
                  onUpdateBook({ ...book, chapters: updated });
                }}
                className="text-sm sm:text-base font-bold text-white bg-transparent border-b border-slate-700/60 focus:border-amber-400 focus:outline-hidden px-1 w-full max-w-sm truncate"
                placeholder={t('editor.sectionTitlePlaceholder')}
              />
              <span className="text-[11px] text-slate-400 block truncate">
                {activeChapter?.title} {activeSection?.titleEn ? `• EN: ${activeSection.titleEn}` : ''}
              </span>
            </div>
          </div>

          {/* Bilingual View Mode Switcher + Fast Actions */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            
            {/* Language Mode Selector */}
            <div data-tour="editor__3" className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setEditorLanguageMode('ua')}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all ${
                  editorLanguageMode === 'ua'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={t('editor.modeUaTitle')}
              >
                🇺🇦 UA
              </button>

              <button
                onClick={() => setEditorLanguageMode('parallel')}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all flex items-center gap-1 ${
                  editorLanguageMode === 'parallel'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={t('editor.modeParallelTitle')}
              >
                <Columns className="w-3 h-3" />
                <span>UA | EN</span>
              </button>

              <button
                onClick={() => setEditorLanguageMode('en')}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all ${
                  editorLanguageMode === 'en'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={t('editor.modeEnTitle')}
              >
                🇬🇧 EN
              </button>
            </div>

            {/* Translate Button */}
            <button
              onClick={handleTranslateToEnglish}
              disabled={isTranslating || !activeSection?.content}
              data-tour="editor__4"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-lg transition-all shadow-sm active:scale-95 disabled:opacity-50"
              title={t('editor.translateTitle')}
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{isTranslating ? t('editor.translating') : t('editor.translate')}</span>
            </button>

            {onSaveBook && (
              <button
                onClick={onSaveBook}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 font-bold border border-amber-500/30 rounded-lg transition-colors whitespace-nowrap"
                title={t('editor.saveTitle')}
              >
                <Save className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('editor.save')}</span>
              </button>
            )}

            {!showRightPanel && (
              <button
                onClick={() => setShowRightPanel(true)}
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-lg transition-colors"
                title={t('editor.openCharPanelTitle')}
              >
                <Users className="w-3.5 h-3.5" />
                <span>{t('editor.charactersBtn')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Formatting & Insert Toolbar */}
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-2 text-slate-300 text-xs overflow-x-auto no-scrollbar shrink-0">
          <div className="flex items-center gap-2">
            {/* Quick Typography Insets */}
            <button
              onClick={() => insertTextAtCursor('— ')}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-md font-semibold text-xs font-mono"
              title={t('editor.dashTitle')}
            >
              {t('editor.dashBtn')}
            </button>
            <button
              onClick={() => insertTextAtCursor('«»')}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-md font-semibold text-xs"
              title={t('editor.quotesTitle')}
            >
              {t('editor.quotesBtn')}
            </button>
            <button
              onClick={() => insertTextAtCursor('…')}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-md font-semibold text-xs"
              title={t('editor.ellipsisTitle')}
            >
              …
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            <button
              onClick={() => setShowFootnoteModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-md font-medium"
              title={t('editor.insertFootnoteTitle')}
            >
              <BookMarked className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('editor.insertFootnoteBtn')}</span>
            </button>

            <button
              onClick={() => setShowQrModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-md font-medium"
              title={t('editor.insertQrTitle')}
            >
              <QrCode className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('editor.insertQrBtn')}</span>
            </button>

            <button
              onClick={() => setShowInsertImageModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-md font-medium"
              title={t('editor.imgFromGalleryTitle')}
            >
              <ImagePlus className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('editor.imgFromGalleryBtn')}</span>
            </button>

            <button
              onClick={() => setShowIllustrationModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-md font-bold shadow-xs transition-all"
              title={t('editor.insertIllustrationTitle')}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('editor.insertIllustrationBtn')}</span>
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            <button
              onClick={() => wrapSelection('**', t('editor.boldPlaceholder'))}
              className="p-1.5 hover:bg-slate-800 hover:text-white rounded-md transition-colors"
              title={t('editor.boldTitle')}
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => wrapSelection('*', t('editor.italicPlaceholder'))}
              className="p-1.5 hover:bg-slate-800 hover:text-white rounded-md transition-colors"
              title={t('editor.italicTitle')}
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertTextAtCursor('\n\n> Цитата...\n\n')}
              className="p-1.5 hover:bg-slate-800 hover:text-white rounded-md transition-colors"
              title={t('editor.quoteTitle')}
            >
              <Quote className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
            <span>{t('editor.wordsUaLabel')} <b className="text-slate-100">{activeSection?.wordCount || 0}</b></span>
            {activeSection?.contentEn && (
              <span>• EN: <b className="text-amber-400">{calculateWordCount(activeSection.contentEn)}</b></span>
            )}
            <span>{t('editor.readingTime', { n: estimateReadingTimeMinutes(activeSection?.wordCount || 0) })}</span>
          </div>
        </div>

        {/* Text Area Canvas Body */}
        <div className="flex-1 min-h-0 p-4 lg:p-6 bg-slate-950 flex flex-col overflow-hidden">
          
          {/* Role Status Banners */}
          {isReader && (
            <div className="w-full max-w-3xl mb-4 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 shrink-0" />
                <span><b>{t('editor.readerBannerTitle')}</b> {t('editor.readerBannerText')}</span>
              </div>
            </div>
          )}

          {isTranslator && (
            <div className="w-full max-w-5xl mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 shrink-0" />
                <span><b>{t('editor.translatorBannerTitle')}</b> {t('editor.translatorBannerText')}</span>
              </div>
            </div>
          )}

          {/* 1. SINGLE UA MODE — заякорена панель тексту на всю доступну висоту/ширину */}
          {editorLanguageMode === 'ua' && (
            <DockedEditorPanel
              title={<span className="flex items-center gap-2">✍️ <span className="text-slate-100">{activeSection?.title || t('editor.defaultSectionFallback')}</span></span>}
              headerExtra={
                <>
                <button
                  onClick={() => setEditorLanguageMode('en')}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 transition-colors"
                  title={t('editor.quickSwitchToEnTitle')}
                >
                  🇬🇧 EN
                </button>
                <select
                  value={`${activeChapter?.id}::${activeSection?.id}`}
                  onChange={(e) => {
                    const [cId, sId] = e.target.value.split('::');
                    if (cId && sId) onSelectSection(cId, sId);
                  }}
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold rounded-lg px-2 py-1 max-w-[190px] cursor-pointer focus:outline-none focus:border-amber-400"
                  title={t('editor.sectionSwitcherTitle')}
                >
                  {book.chapters.map((c) => (
                    <optgroup key={c.id} label={c.title}>
                      {c.sections.map((s) => (
                        <option key={s.id} value={`${c.id}::${s.id}`}>
                          {s.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                </>
              }
              bodyClassName="p-6 flex flex-col overflow-hidden"
            >
              <div className="relative flex flex-col h-full min-h-0">
              {/* Форматування тексту + швидкий доступ до англійської версії */}
              <div className="flex items-center justify-between gap-2 mb-3 shrink-0 flex-wrap">
                {renderFormatToolbar(false)}
                <button
                  onClick={openEnglishWindow}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-semibold transition-colors"
                  title={t('editor.openEnWindowTitle')}
                >
                  <Languages className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('editor.openEnWindowBtn')}</span>
                </button>
              </div>

              {/* Панель дій над виділенням.
                  Раніше була absolute поверх тексту й закривала саме той
                  фрагмент, який редагують. Тепер це звичайний рядок у потоці
                  під шапкою вікна: з'являється над текстом, зсуваючи його,
                  а не перекриваючи. */}
              {selectedText.length > 0 && !isReader && (
                <div className="flex items-center flex-wrap gap-2 mb-3 shrink-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 shadow-lg text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-slate-300 font-medium">
                    {t('editor.selectedWords', { n: selectedText.split(/\s+/).filter(Boolean).length })}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleTriggerAiEdit('improve')}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors"
                  >
                    {t('editor.improveAi')}
                  </button>
                  <button
                    onClick={() => setShowIllustrationModal(true)}
                    className="px-2.5 py-1 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold rounded-lg shadow-xs flex items-center gap-1 transition-all"
                  >
                    <ImageIcon className="w-3 h-3" />
                    <span>{t('editor.illustrationFromText')}</span>
                  </button>
                </div>
              )}

              {/* Підпис аркуша: у якій главі зараз автор, і якого розміру
                  сторінка. Обидва — те, що постійно потрібно бачити під час
                  письма, але чого раніше не було видно, щойно текст
                  прогортали нижче шапки модуля. */}
              <div className="flex items-center gap-2 mb-1.5 shrink-0 px-0.5">
                <span className="text-[11px] font-semibold tracking-wide text-[#c07784] truncate">
                  {getRunningHeaderText()}
                </span>
                <div className="flex-1" />
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="hidden sm:inline">{t('editor.pageFormatLabel')}</span>
                  <select
                    value={book.layoutConfig.formatPreset}
                    onChange={(e) => handleChangePageFormat(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 outline-none hover:border-slate-500 focus:border-emerald-500/60 cursor-pointer"
                    title={t('editor.pageFormatTitle')}
                  >
                    {PAGE_FORMAT_QUICK_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-slate-900">
                        {t(p.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <PageRuler
                widthMm={getPageContentWidthMm()}
                insideMm={book.layoutConfig.margins?.insideMm || 0}
                outsideMm={book.layoutConfig.margins?.outsideMm || 0}
                onChangeMargins={handleChangeMargins}
              />
              <PageColumn widthMm={getPageContentWidthMm()} className="flex-1 min-h-0">
                {/* Колонтитул першого аркуша. Плагін пагінації малює його на
                    кожному РОЗРИВІ, тобто зверху сторінок 2, 3, … — у першої
                    розриву перед нею немає, тож він рендериться тут. */}
                <div
                  className="select-none"
                  style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    fontWeight: 600,
                    color: '#7a1f2b',
                    padding: '10px 16px 0',
                  }}
                >
                  {getRunningHeaderText()}
                </div>
                <EditorContent
                  editor={uaEditor}
                  id="book-content-editor-ua"
                  data-tour="editor__2"
                  className={`text-slate-900 text-base sm:text-lg leading-relaxed p-4 ${
                    isReader ? 'cursor-default select-text' : ''
                  }`}
                  style={{
                    fontFamily: manuscriptFontStack,
                    fontSize: `${book.layoutConfig.typography.fontSizePt * 1.3}px`,
                    lineHeight: book.layoutConfig.typography.lineHeight,
                  }}
                />
              </PageColumn>

              {/* Підвал блока тексту: мова та словник перевірки */}
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/60 shrink-0 flex-wrap">
                <button
                  onClick={() => setShowProofingModal(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-semibold transition-colors"
                  title={t('editor.proofingBtnTitle')}
                >
                  <SpellCheck2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t('editor.proofingBtn')}</span>
                </button>
                <span className="text-[10px] font-mono text-slate-500">
                  {spellcheckEnabled
                    ? t('editor.proofingStatusOn', { lang: proofingLanguage.toUpperCase() })
                    : t('editor.proofingStatusOff')}
                </span>
              </div>

              {/* In-text Footnotes & QR tags visual footer */}
              {(sectionFootnotes.length > 0 || sectionQrTags.length > 0) && (
                <div className="mt-6 pt-4 border-t border-slate-800/80 space-y-3">
                  {sectionQrTags.length > 0 && (
                    <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 space-y-2">
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                        <QrCode className="w-3.5 h-3.5" /> {t('editor.qrTagsInScene')}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {sectionQrTags.map((q) => (
                          <div key={q.id} className="flex items-center gap-2 p-2 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                            {q.svgData && <img src={q.svgData} alt={q.title} className="w-7 h-7" />}
                            <div>
                              <div className="font-bold text-white text-[11px]">{q.title}</div>
                              <div className="text-[9px] font-mono text-slate-400 truncate max-w-[140px]">{q.payload}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {sectionFootnotes.length > 0 && (
                    <div className="space-y-1 text-xs text-slate-400">
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
                        {t('editor.sectionNotes')}
                      </span>
                      {sectionFootnotes.map((fn) => (
                        <div key={fn.id} className="flex items-baseline gap-2">
                          <span className="font-bold text-amber-400 font-mono">[{fn.marker}]</span>
                          {fn.term && <span className="text-white font-medium">{fn.term}:</span>}
                          <span>{fn.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </div>
            </DockedEditorPanel>
          )}

          {/* 2. PARALLEL BILINGUAL (UA | EN) — два заякорені блоки поруч, порівну ділять ширину */}
          {editorLanguageMode === 'parallel' && (
            <div className="flex-1 min-h-0 w-full flex flex-col lg:flex-row gap-4">
              <DockedEditorPanel
                  title={<span className="flex items-center gap-2">🇺🇦 <span className="text-slate-100">{t('editor.ukOriginal')} — {activeSection?.title || ''}</span></span>}
                  className="min-w-0"
                  bodyClassName="p-4 flex flex-col overflow-hidden"
                >
                  <div className="flex flex-col h-full min-h-0 gap-2">
                    <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
                      <span className="text-[11px] font-mono text-slate-400">
                        {t('editor.wordsCount', { n: activeSection?.wordCount || 0 })}
                      </span>
                      {renderFormatToolbar(false)}
                    </div>
                    <input
                      type="text"
                      value={activeSection?.title || ''}
                      onChange={(e) => {
                        const updated = book.chapters.map((c) =>
                          c.id === activeChapter?.id
                            ? { ...c, sections: c.sections.map((s) => (s.id === activeSection?.id ? { ...s, title: e.target.value } : s)) }
                            : c
                        );
                        onUpdateBook({ ...book, chapters: updated });
                      }}
                      placeholder={t('editor.sectionTitleUaLabel')}
                      className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-bold shrink-0"
                    />
                    <PageRuler
                      widthMm={getPageContentWidthMm()}
                      insideMm={book.layoutConfig.margins?.insideMm || 0}
                      outsideMm={book.layoutConfig.margins?.outsideMm || 0}
                      onChangeMargins={handleChangeMargins}
                    />
                    <PageColumn widthMm={getPageContentWidthMm()} className="flex-1 min-h-0 rounded-xl border border-slate-800/80">
                      <EditorContent
                        editor={uaEditor}
                        style={{ fontFamily: manuscriptFontStack }}
                        className="text-slate-900 text-sm leading-relaxed p-3"
                      />
                    </PageColumn>
                  </div>
              </DockedEditorPanel>

              <DockedEditorPanel
                  title={<span className="flex items-center gap-2">🇬🇧 <span className="text-slate-100">English Edition — {activeSection?.titleEn || activeSection?.title || ''}</span></span>}
                  className="min-w-0"
                  bodyClassName="p-4 flex flex-col overflow-hidden"
                >
                  <div className="flex flex-col h-full min-h-0 gap-2">
                    <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
                      <span className="text-[11px] font-mono text-amber-400/90">
                        {calculateWordCount(activeSection?.contentEn || '')} words
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {renderFormatToolbar(true)}
                        <button
                          onClick={handleTranslateToEnglish}
                          disabled={isTranslating}
                          className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold rounded-md transition-colors"
                          title={t('editor.updateTranslationTitle')}
                        >
                          {isTranslating ? '...' : t('editor.update')}
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={activeSection?.titleEn || ''}
                      onChange={(e) => {
                        const updated = book.chapters.map((c) =>
                          c.id === activeChapter?.id
                            ? { ...c, sections: c.sections.map((s) => (s.id === activeSection?.id ? { ...s, titleEn: e.target.value } : s)) }
                            : c
                        );
                        onUpdateBook({ ...book, chapters: updated });
                      }}
                      placeholder="Section Title (EN)"
                      className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-bold shrink-0"
                    />
                    <PageRuler
                      widthMm={getPageContentWidthMm()}
                      insideMm={book.layoutConfig.margins?.insideMm || 0}
                      outsideMm={book.layoutConfig.margins?.outsideMm || 0}
                      onChangeMargins={handleChangeMargins}
                    />
                    <PageColumn widthMm={getPageContentWidthMm()} className="flex-1 min-h-0 rounded-xl border border-slate-800/80">
                      <EditorContent
                        editor={enEditor}
                        style={{ fontFamily: manuscriptFontStack }}
                        className="text-slate-900 text-sm leading-relaxed p-3"
                      />
                    </PageColumn>
                  </div>
              </DockedEditorPanel>
            </div>
          )}

          {/* 3. SINGLE EN MODE — заякорена панель англійського тексту на всю доступну висоту/ширину */}
          {editorLanguageMode === 'en' && (
            <DockedEditorPanel
              title={<span className="flex items-center gap-2">🇬🇧 <span className="text-slate-100">English Edition — {activeSection?.titleEn || activeSection?.title || ''}</span></span>}
              headerExtra={
                <button
                  onClick={() => setEditorLanguageMode('ua')}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 transition-colors"
                  title={t('editor.quickSwitchToUaTitle')}
                >
                  🇺🇦 UA
                </button>
              }
              bodyClassName="p-4 flex flex-col overflow-hidden"
            >
              <div className="flex flex-col h-full min-h-0 gap-2">
                <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
                  <span className="text-xs font-bold text-slate-300">English Publication Edition</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {renderFormatToolbar(true)}
                    <button
                      onClick={handleTranslateToEnglish}
                      disabled={isTranslating}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition-colors"
                    >
                      <Languages className="w-3.5 h-3.5" />
                      <span>{isTranslating ? t('editor.translating') : t('editor.translateFromUa')}</span>
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={activeSection?.titleEn || ''}
                  onChange={(e) => {
                    const updated = book.chapters.map((c) =>
                      c.id === activeChapter?.id
                        ? { ...c, sections: c.sections.map((s) => (s.id === activeSection?.id ? { ...s, titleEn: e.target.value } : s)) }
                        : c
                    );
                    onUpdateBook({ ...book, chapters: updated });
                  }}
                  placeholder="Section Title (EN)"
                  className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-bold shrink-0"
                />
                <PageRuler
                  widthMm={getPageContentWidthMm()}
                  insideMm={book.layoutConfig.margins?.insideMm || 0}
                  outsideMm={book.layoutConfig.margins?.outsideMm || 0}
                  onChangeMargins={handleChangeMargins}
                />
                <PageColumn widthMm={getPageContentWidthMm()} className="flex-1 min-h-0 rounded-xl border border-slate-800">
                  <EditorContent
                    editor={enEditor}
                    style={{ fontFamily: manuscriptFontStack }}
                    className="text-slate-900 text-sm leading-relaxed p-3"
                  />
                </PageColumn>
              </div>
            </DockedEditorPanel>
          )}

        </div>
      </main>

      {/* RIGHT PANEL: CHARACTERS & SCENE WORKSPACE ("персонажі з права альбомного перегляду сайту") */}
      {showRightPanel && (
        <aside
          style={{ '--panel-w': `${rightPanelWidth}px` } as React.CSSProperties}
          className="nova-char-panel w-full bg-slate-950/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shrink-0 absolute lg:relative right-0 z-30 lg:z-auto h-full max-h-full"
        >
          {/* Ручка зміни ширини панелі (тягнути вправо-вліво) */}
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = rightPanelWidth;
              const onMove = (ev: PointerEvent) => {
                const delta = startX - ev.clientX;
                setRightPanelWidth(Math.min(760, Math.max(280, startW + delta)));
              };
              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            }}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-amber-500/50 z-20 hidden lg:block"
            title="Змінити ширину панелі"
          />
          
          {/* Tab Headers: 3 кореневі вкладки */}
          <div data-tour="editor__5" className="flex border-b border-slate-800 bg-slate-950/80 p-2 gap-1 overflow-x-auto no-scrollbar shrink-0">
            <button
              onClick={() => setRightPanelTab('scene')}
              className={`flex-1 py-3 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                rightPanelTab === 'scene'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('editor.rootTabScene')}</span>
            </button>

            <button
              onClick={() => {
                setRightPanelTab('workText');
                setRightPanelSubTab('translation');
              }}
              className={`flex-1 py-3 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                rightPanelTab === 'workText'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('editor.rootTabWorkTextTitle')}
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('editor.rootTabWorkText')}</span>
            </button>

            <button
              onClick={() => {
                setRightPanelTab('workAi');
                setRightPanelSubTab('ai');
              }}
              className={`flex-1 py-3 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                rightPanelTab === 'workAi'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('editor.rootTabWorkAiTitle')}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('editor.rootTabWorkAi')}</span>
            </button>

            <button
              onClick={() => setShowRightPanel(false)}
              className="lg:hidden p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Content Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">

            {/* Підвкладки групи «Робота над текстом» */}
            {rightPanelTab === 'workText' && (
              <div className="flex gap-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800">
                <button
                  onClick={() => setRightPanelSubTab('translation')}
                  className={`flex-1 py-2 px-1 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                    rightPanelSubTab === 'translation'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Languages className="w-3 h-3" />
                  <span>{t('editor.tabTranslation')}</span>
                </button>
                <button
                  onClick={() => setRightPanelSubTab('footnotes_qr')}
                  className={`flex-1 py-2 px-1 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                    rightPanelSubTab === 'footnotes_qr'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <QrCode className="w-3 h-3" />
                  <span>{t('editor.tabFootnotesQr')}</span>
                </button>
                <button
                  onClick={() => setRightPanelSubTab('course_tags')}
                  className={`flex-1 py-2 px-1 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                    rightPanelSubTab === 'course_tags'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <GraduationCap className="w-3 h-3" />
                  <span>{t('editor.tabCourseTags')}</span>
                </button>
              </div>
            )}

            {/* Підвкладки групи «Робота з AI» */}
            {rightPanelTab === 'workAi' && (
              <div className="flex gap-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800">
                <button
                  onClick={() => setRightPanelSubTab('ai')}
                  className={`flex-1 py-2 px-1 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                    rightPanelSubTab === 'ai'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{t('editor.tabAi')}</span>
                </button>
                <button
                  onClick={() => setRightPanelSubTab('spellcheck')}
                  className={`flex-1 py-2 px-1 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                    rightPanelSubTab === 'spellcheck'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CheckCheck className="w-3 h-3" />
                  <span>{t('editor.tabSpellcheck')}</span>
                </button>
                <button
                  onClick={() => setRightPanelSubTab('diff')}
                  className={`flex-1 py-2 px-1 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                    rightPanelSubTab === 'diff'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Columns className="w-3 h-3" />
                  <span>{t('editor.tabDiff')}</span>
                </button>
              </div>
            )}

            {/* TAB 1: CHARACTERS & SCENE PARTICIPANTS ("Вивести фотографії невеликого розміру з зображенням персонажів...") */}
            {rightPanelTab === 'scene' && (
              <div className="space-y-4">
                
                {/* Scene Participants Section */}
                {renderChapterCast()}
                {!participantsUnpinned && renderSceneParticipants()}

                {/* Крива головного героя — книжкова, не посценна: показана
                    тут незалежно від того, яка глава/сцена зараз активна,
                    той самий стан, що й в експрес-майстрі (heroArc). */}
                <HeroArcPanel
                  value={book.heroArc}
                  onChange={handleUpdateHeroArc}
                  heroName={
                    book.characters.find((c) => c.role === 'protagonist')
                      ? `${book.characters.find((c) => c.role === 'protagonist')!.name} ${
                          book.characters.find((c) => c.role === 'protagonist')!.surname || ''
                        }`.trim()
                      : undefined
                  }
                  compact
                />

                {/* Scene Dramaturgy & Conflict Info */}
                {activeSection?.scene ? (
                  <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3 shadow-md">
                    <span className="font-bold text-slate-100 text-sm block border-b border-slate-800 pb-2">
                      {t('editor.sceneParams')}
                    </span>

                    {/* Scene Title */}
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">{t('editor.sceneTitleLabel')}</label>
                      <input
                        type="text"
                        value={activeSection.scene.title}
                        onChange={(e) => {
                          const updatedChapters = book.chapters.map((c) => {
                            if (c.id !== activeChapter?.id) return c;
                            return {
                              ...c,
                              sections: c.sections.map((s) =>
                                s.id === activeSection?.id && s.scene
                                  ? { ...s, scene: { ...s.scene, title: e.target.value } }
                                  : s
                              ),
                            };
                          });
                          onUpdateBook({ ...book, chapters: updatedChapters });
                        }}
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden"
                      />
                    </div>

                    {/* Location & Time */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">{t('editor.locationLabel')}</label>
                        <input
                          type="text"
                          value={activeSection.scene.location || ''}
                          onChange={(e) => {
                            const updatedChapters = book.chapters.map((c) => {
                              if (c.id !== activeChapter?.id) return c;
                              return {
                                ...c,
                                sections: c.sections.map((s) =>
                                  s.id === activeSection?.id && s.scene
                                    ? { ...s, scene: { ...s.scene, location: e.target.value } }
                                    : s
                                ),
                              };
                            });
                            onUpdateBook({ ...book, chapters: updatedChapters });
                          }}
                          placeholder="Лабораторія, Поділ..."
                          className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-slate-400 block mb-1">{t('editor.timeOfDayLabel')}</label>
                        <input
                          type="text"
                          value={activeSection.scene.timeOfDay || ''}
                          onChange={(e) => {
                            const updatedChapters = book.chapters.map((c) => {
                              if (c.id !== activeChapter?.id) return c;
                              return {
                                ...c,
                                sections: c.sections.map((s) =>
                                  s.id === activeSection?.id && s.scene
                                    ? { ...s, scene: { ...s.scene, timeOfDay: e.target.value } }
                                    : s
                                ),
                              };
                            });
                            onUpdateBook({ ...book, chapters: updatedChapters });
                          }}
                          placeholder="Світанок, 05:45..."
                          className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden"
                        />
                      </div>
                    </div>

                    {/* Conflict & Resolution */}
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">{t('editor.conflictLabel')}</label>
                      <textarea
                        rows={2}
                        value={activeSection.scene.conflict}
                        onChange={(e) => {
                          const updatedChapters = book.chapters.map((c) => {
                            if (c.id !== activeChapter?.id) return c;
                            return {
                              ...c,
                              sections: c.sections.map((s) =>
                                s.id === activeSection?.id && s.scene
                                  ? { ...s, scene: { ...s.scene, conflict: e.target.value } }
                                  : s
                              ),
                            };
                          });
                          onUpdateBook({ ...book, chapters: updatedChapters });
                        }}
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">{t('editor.resolutionLabel')}</label>
                      <textarea
                        rows={2}
                        value={activeSection.scene.resolution}
                        onChange={(e) => {
                          const updatedChapters = book.chapters.map((c) => {
                            if (c.id !== activeChapter?.id) return c;
                            return {
                              ...c,
                              sections: c.sections.map((s) =>
                                s.id === activeSection?.id && s.scene
                                  ? { ...s, scene: { ...s.scene, resolution: e.target.value } }
                                  : s
                              ),
                            };
                          });
                          onUpdateBook({ ...book, chapters: updatedChapters });
                        }}
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden"
                      />
                    </div>

                    {/* AI Dramaturgy Notes */}
                    {activeSection.scene.aiDramaturgyNotes && (
                      <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30 space-y-1">
                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5" /> {t('editor.sceneAiAnalysis')}
                        </span>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {activeSection.scene.aiDramaturgyNotes}
                        </p>
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="p-6 text-center text-slate-500 text-xs space-y-3">
                    <Film className="w-8 h-8 mx-auto text-slate-600" />
                    <p>{t('editor.noScenePlan')}</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: TRANSLATION & LOCALIZATION MANAGER */}
            {rightPanelTab === 'workText' && rightPanelSubTab === 'translation' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Globe className="w-4 h-4" /> {t('editor.englishEditionHeading')}
                    </span>
                  </div>

                  <p className="text-slate-300 text-xs leading-relaxed">
                    {t('editor.translationIntro')}
                  </p>

                  <button
                    onClick={handleTranslateToEnglish}
                    disabled={isTranslating || !activeSection?.content}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
                  >
                    <Languages className="w-4 h-4" />
                    <span>{isTranslating ? t('editor.translatingInProgress') : t('editor.translateSectionBtn')}</span>
                  </button>
                </div>

                {/* English Edition — текст перекладу відразу у правій панелі (можна закрити хрестиком) */}
                {translationPanelCollapsed ? (
                  <button
                    onClick={() => setTranslationPanelCollapsed(false)}
                    className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-amber-500/30 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Languages className="w-3.5 h-3.5" />
                    <span>{t('editor.showEnglishEditionBtn')}</span>
                  </button>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-900 border border-amber-500/30 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Languages className="w-4 h-4" /> {t('editor.enInlineEditorHeading')}
                      </span>
                      <button
                        onClick={() => setTranslationPanelCollapsed(true)}
                        className="p-1 text-slate-400 hover:text-white rounded-md"
                        title="Закрити"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={activeSection?.titleEn || ''}
                      onChange={(e) => {
                        const updated = book.chapters.map((c) =>
                          c.id === activeChapter?.id
                            ? { ...c, sections: c.sections.map((s) => (s.id === activeSection?.id ? { ...s, titleEn: e.target.value } : s)) }
                            : c
                        );
                        onUpdateBook({ ...book, chapters: updated });
                      }}
                      placeholder="Section Title (EN)"
                      className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-bold"
                    />

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-amber-400/80">
                        {calculateWordCount(activeSection?.contentEn || '')} words
                      </span>
                      <button
                        onClick={handleTranslateToEnglish}
                        disabled={isTranslating}
                        className="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold rounded-md transition-colors"
                        title={t('editor.updateTranslationTitle')}
                      >
                        {isTranslating ? '...' : t('editor.update')}
                      </button>
                    </div>

                    <textarea
                      value={activeSection?.contentEn || ''}
                      onChange={(e) => handleContentEnChange(e.target.value)}
                      placeholder="English translation text for the international edition..."
                      className="w-full min-h-[260px] bg-slate-950 p-3 rounded-xl border border-slate-800/80 text-slate-200 font-serif-book text-sm leading-relaxed focus:outline-hidden resize-y"
                    />
                  </div>
                )}

                {/* Chapter & Section Title Translations */}
                <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                  <span className="text-xs font-bold text-white block">
                    {t('editor.metadataTranslationHeading')}
                  </span>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">{t('editor.bookTitleEnLabel')}</label>
                    <input
                      type="text"
                      value={book.titleEn || ''}
                      onChange={(e) => onUpdateBook({ ...book, titleEn: e.target.value })}
                      placeholder="e.g. Shadows of Neo-Kyiv 2084"
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">{t('editor.chapterTitleEnLabel')}</label>
                    <input
                      type="text"
                      value={activeChapter?.titleEn || ''}
                      onChange={(e) => {
                        const updated = book.chapters.map((c) =>
                          c.id === activeChapter?.id ? { ...c, titleEn: e.target.value } : c
                        );
                        onUpdateBook({ ...book, chapters: updated });
                      }}
                      placeholder="e.g. Chapter 1: Glass Dawn Over the Dnipro"
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">{t('editor.sectionTitleEnLabel')}</label>
                    <input
                      type="text"
                      value={activeSection?.titleEn || ''}
                      onChange={(e) => {
                        const updated = book.chapters.map((c) =>
                          c.id === activeChapter?.id
                            ? { ...c, sections: c.sections.map((s) => (s.id === activeSection?.id ? { ...s, titleEn: e.target.value } : s)) }
                            : c
                        );
                        onUpdateBook({ ...book, chapters: updated });
                      }}
                      placeholder="e.g. Section 1: The Quantum Needle"
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setTranslationDetached(false);
                      setEditorLanguageMode('parallel');
                    }}
                    className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                    title={t('editor.freezeTranslationTitle')}
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span>{t('editor.freezeTranslationBtn')}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (!translationDetached) setEditorLanguageMode('ua');
                      setTranslationDetached(!translationDetached);
                    }}
                    className={`w-full py-2.5 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-colors ${
                      translationDetached
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
                    }`}
                    title={t('editor.detachTranslationTitle')}
                  >
                    <PinOff className="w-3.5 h-3.5" />
                    <span>{t('editor.detachTranslationBtn')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: INLINE FOOTNOTES & QR MANAGER */}
            {rightPanelTab === 'workText' && rightPanelSubTab === 'footnotes_qr' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    {t('editor.footnotesAndQrHeading')}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowFootnoteModal(true)}
                      className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/40"
                    >
                      {t('editor.addFootnoteBtn')}
                    </button>
                    <button
                      onClick={() => setShowQrModal(true)}
                      className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/40"
                    >
                      {t('editor.addQrBtn')}
                    </button>
                  </div>
                </div>

                {/* Section QR codes */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-300 block">{t('editor.sectionQrLabel')}</span>
                  {sectionQrTags.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">{t('editor.noQrInSection')}</p>
                  ) : (
                    sectionQrTags.map((q) => (
                      <div key={q.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-amber-300 font-bold">{q.code}</span>
                          <button
                            onClick={() => insertTextAtCursor(`[QR: ${q.code} - "${q.title}"]`)}
                            className="text-[10px] text-amber-400 hover:underline"
                          >
                            {t('editor.insertTagBtn')}
                          </button>
                        </div>
                        <div className="font-bold text-white">{q.title}</div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">{q.payload}</div>
                      </div>
                    ))
                  )}
                </div>

                {/* Section Footnotes */}
                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <span className="text-[11px] font-bold text-slate-300 block">{t('editor.sectionFootnotesLabel')}</span>
                  {sectionFootnotes.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">{t('editor.noFootnotesInSection')}</p>
                  ) : (
                    sectionFootnotes.map((fn) => (
                      <div key={fn.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-amber-400 font-bold">[^${fn.marker}]</span>
                          <button
                            onClick={() => insertTextAtCursor(`[^${fn.marker}]`)}
                            className="text-[10px] text-amber-400 hover:underline"
                          >
                            {t('editor.insertMarkerBtn')}
                          </button>
                        </div>
                        {fn.term && <div className="font-bold text-white text-[11px]">{fn.term}</div>}
                        <div className="text-slate-300 text-[11px]">{fn.text}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: COURSE TAGS ("додав автором тег під час написання книги") */}
            {rightPanelTab === 'workText' && rightPanelSubTab === 'course_tags' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    {t('editor.courseTagsHeading')}
                  </span>
                  <button
                    onClick={() => setShowCourseTagModal(true)}
                    disabled={!selectedText.trim()}
                    title={!selectedText.trim() ? t('editor.needSelectionForTag') : undefined}
                    className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('editor.addCourseTagBtn')}
                  </button>
                </div>

                {!selectedText.trim() && (
                  <p className="text-[11px] text-slate-500 italic">{t('editor.needSelectionForTag')}</p>
                )}

                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-300 block">{t('editor.sectionCourseTagsLabel')}</span>
                  {sectionCourseTags.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">{t('editor.noCourseTagsInSection')}</p>
                  ) : (
                    sectionCourseTags.map((tag) => (
                      <div key={tag.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1 font-bold text-white">
                            <Tag className="w-3 h-3 text-amber-400 shrink-0" />
                            {tag.label}
                          </span>
                          <button
                            onClick={() => {
                              onUpdateBook({
                                ...book,
                                course: {
                                  ...(book.course || { enabled: true, title: book.title, tags: [], materials: [] }),
                                  tags: (book.course?.tags || []).filter((x) => x.id !== tag.id),
                                },
                              });
                            }}
                            className="text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 italic truncate">"{tag.textSnippet}"</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: AI ASSISTANT */}
            {rightPanelTab === 'workAi' && rightPanelSubTab === 'ai' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> {t('editor.customAiRequest')}
                  </span>
                  <textarea
                    value={customAiPrompt}
                    onChange={(e) => setCustomAiPrompt(e.target.value)}
                    placeholder={t('editor.customAiPlaceholder')}
                    className="w-full h-16 p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-hidden focus:border-amber-400 resize-none"
                  />
                  <button
                    onClick={() => handleTriggerAiEdit('custom')}
                    disabled={isGeneratingAi || !customAiPrompt.trim()}
                    className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {isGeneratingAi ? t('editor.generatingProposal') : t('editor.applyAiRequest')}
                  </button>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {t('editor.quickEditModes')}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {aiPresets.map((preset) => {
                      const Icon = preset.icon;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => handleTriggerAiEdit(preset.id)}
                          disabled={isGeneratingAi}
                          className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 text-left text-xs text-slate-300 hover:text-white transition-all active:scale-95 disabled:opacity-40"
                        >
                          <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="truncate">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: SPELLCHECKER */}
            {rightPanelTab === 'workAi' && rightPanelSubTab === 'spellcheck' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-slate-300">
                    {t('editor.problemsFound', { n: String(spellIssues.length) })}
                  </span>
                  <button
                    onClick={handleRunSpellcheck}
                    disabled={isCheckingGrammar}
                    className="text-xs text-amber-400 hover:text-amber-300 underline"
                  >
                    {t('editor.retryBtn')}
                  </button>
                </div>

                {spellIssues.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs space-y-2">
                    <CheckCheck className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="font-bold text-slate-200">{t('editor.textClean')}</p>
                    <p>{t('editor.noIssuesFound')}</p>
                  </div>
                ) : (
                  spellIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          issue.type === 'spelling' ? 'bg-rose-500/20 text-rose-300' :
                          issue.type === 'grammar' ? 'bg-amber-500/20 text-amber-300' :
                          issue.type === 'style' ? 'bg-purple-500/20 text-purple-300' :
                          'bg-cyan-500/20 text-cyan-300'
                        }`}>
                          {issue.type}
                        </span>
                        <span className="font-mono text-rose-300 font-bold">
                          «{issue.word}»
                        </span>
                      </div>

                      <p className="text-slate-300">{issue.message}</p>

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {issue.suggestions.map((sug, sIdx) => (
                          <button
                            key={sIdx}
                            onClick={() => handleReplaceSpellIssue(issue, sug)}
                            className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-medium text-[11px] border border-emerald-500/40"
                          >
                            {t('editor.replaceWith')} <b>{sug}</b>
                          </button>
                        ))}
                        <button
                          onClick={() => handleIgnoreIssue(issue.id)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-[11px]"
                        >
                          {t('editor.ignoreBtn')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 6: DIFF PROPOSALS */}
            {rightPanelTab === 'workAi' && rightPanelSubTab === 'diff' && (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    {t('editor.aiProposesHeading')}
                  </span>
                </div>

                {currentProposal ? (
                  <div className="p-4 rounded-xl bg-slate-900/90 border-2 border-amber-500/50 space-y-3 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        {currentProposal.instruction}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-serif-book leading-relaxed max-h-60 overflow-y-auto">
                      {currentProposal.diffSegments.map((segment, idx) => {
                        if (segment.type === 'added') {
                          return (
                            <span key={idx} className="bg-emerald-500/30 text-emerald-200 px-0.5 rounded border-b border-emerald-400">
                              {segment.text}
                            </span>
                          );
                        }
                        if (segment.type === 'removed') {
                          return (
                            <span key={idx} className="bg-rose-500/30 text-rose-300 line-through px-0.5 rounded opacity-75">
                              {segment.text}
                            </span>
                          );
                        }
                        return <span key={idx} className="text-slate-300">{segment.text}</span>;
                      })}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        onClick={handleAcceptProposal}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                      >
                        <Check className="w-4 h-4" />
                        <span>{t('editor.acceptChanges')}</span>
                      </button>
                      <button
                        onClick={handleRejectProposal}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs"
                      >
                        <X className="w-4 h-4" />
                        <span>{t('editor.rejectChanges')}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center text-slate-500 text-xs space-y-2 border border-dashed border-slate-800 rounded-xl">
                    <Sparkles className="w-6 h-6 mx-auto text-slate-600" />
                    <p>{t('editor.noActiveProposals')}</p>
                  </div>
                )}
              </div>
            )}

          </div>
        </aside>
      )}

      {/* CHARACTER EDIT MODAL */}
      {editingCharacter && (
        <CharacterEditModal
          character={editingCharacter}
          isOpen={!!editingCharacter}
          onClose={() => setEditingCharacter(null)}
          onSave={handleSaveCharacterDossier}
        />
      )}

      {/* ADD PARTICIPANTS MODAL */}
      {showAddParticipantsModal && (
        <AddParticipantsModal
          allCharacters={book.characters}
          currentSceneCharacters={sceneCharacters}
          chapterTitle={activeChapter?.title || t('editor.defaultChapterFallback')}
          sectionTitle={activeSection?.title || t('editor.defaultSectionFallback')}
          isOpen={showAddParticipantsModal}
          onClose={() => setShowAddParticipantsModal(false)}
          onConfirm={handleConfirmParticipants}
          onCreateNewCharacter={() => {
            const newChar: Character = {
              id: `char-${Date.now()}`,
              bookId: book.id,
              name: 'Новий персонаж',
              role: 'ally',
              appearance: {},
              personality: {
                strengths: [],
                weaknesses: [],
                fears: [],
                desires: [],
                goals: [],
                motivation: '',
                internalConflict: '',
              },
              biography: '',
              relationships: [],
              tags: [],
            };
            onUpdateBook(
              { ...book, characters: [...book.characters, newChar] },
              'Створення персонажа',
              `Створено нового персонажа «${newChar.name}»`
            );
            setEditingCharacter(newChar);
          }}
        />
      )}

      {/* AI CHARACTER & ART GENERATION MODAL (Nano Banana, Leonardo.ai) */}
      {showGenerateHeroModal && (
        <GenerateCharacterModal
          isOpen={showGenerateHeroModal}
          onClose={() => {
            setShowGenerateHeroModal(false);
            setHeroToEnhance(null);
          }}
          characterToEnhance={heroToEnhance}
          allCharacters={book.characters}
          genre={book.genre}
          visualBible={book.visualBible}
          onApplyAvatarToCharacter={handleApplyAvatarToCharacter}
          onAddNewCharacterWithArt={handleAddNewCharacterWithArt}
        />
      )}

      {/* ВСТАВКА ЗОБРАЖЕННЯ З ГАЛЕРЕЇ */}
      {showInsertImageModal && (
        <InsertImageModal
          book={book}
          onInsert={handleInsertGalleryImage}
          onClose={() => setShowInsertImageModal(false)}
        />
      )}

      {/* МОВА ТА СЛОВНИК ПЕРЕВІРКИ */}
      {showProofingModal && (
        <ProofingLanguageModal
          language={proofingLanguage}
          spellcheckEnabled={spellcheckEnabled}
          customDictionary={book.customDictionary ?? []}
          onChangeLanguage={setProofingLanguage}
          onToggleSpellcheck={setSpellcheckEnabled}
          onChangeDictionary={(words) => onUpdateBook({ ...book, customDictionary: words })}
          onClose={() => setShowProofingModal(false)}
        />
      )}

      {/* ПІДКЛЮЧЕННЯ ШРИФТУ З GOOGLE FONTS */}
      {showFontModal && (
        <FontInstallModal
          installedFonts={customFonts}
          onInstall={handleInstallFont}
          onRemove={handleRemoveFont}
          onClose={() => setShowFontModal(false)}
        />
      )}

      {/* FOOTNOTE CREATION MODAL */}
      {showFootnoteModal && (
        <div
          onClick={() => setShowFootnoteModal(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <BookMarked className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">{t('editor.insertFootnoteHeading')}</h3>
              </div>
              <button onClick={() => setShowFootnoteModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.termLabel')}</label>
              <input
                type="text"
                placeholder="напр. Нейроінтерфейс Сварог"
                value={modalFnTerm}
                onChange={(e) => setModalFnTerm(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.footnoteTextLabel')}</label>
              <textarea
                rows={3}
                placeholder={t('editor.footnoteTextPlaceholder')}
                value={modalFnText}
                onChange={(e) => setModalFnText(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowFootnoteModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                {t('editor.cancel')}
              </button>
              <button
                onClick={handleInsertFootnote}
                disabled={!modalFnText.trim()}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs"
              >
                {t('editor.insertFootnoteBtnWithNum', { n: String((book.footnotes || []).length + 1) })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR CREATION MODAL */}
      {showQrModal && (
        <div
          onClick={() => setShowQrModal(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">{t('editor.insertQrHeading')}</h3>
              </div>
              <button onClick={() => setShowQrModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.qrActionType')}</label>
              <select
                value={modalQrType}
                onChange={(e) => setModalQrType(e.target.value as any)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              >
                <option value="url">{t('editor.qrTypeUrl')}</option>
                <option value="secret">{t('editor.qrTypeSecret')}</option>
                <option value="audio">{t('editor.qrTypeAudio')}</option>
                <option value="social">{t('editor.qrTypeSocial')}</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.tagNameLabel')}</label>
              <input
                type="text"
                placeholder="напр. Саундтрек сцени"
                value={modalQrTitle}
                onChange={(e) => setModalQrTitle(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {modalQrType === 'url' ? t('editor.urlLabel') : t('editor.textOrLinkLabel')}
              </label>
              <input
                type="text"
                placeholder="https://..."
                value={modalQrPayload}
                onChange={(e) => setModalQrPayload(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowQrModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                {t('editor.cancel')}
              </button>
              <button
                onClick={handleInsertQR}
                disabled={!modalQrTitle.trim() || !modalQrPayload.trim()}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs"
              >
                {t('editor.generateAndInsertQr')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COURSE TAG CREATION MODAL */}
      {showCourseTagModal && (
        <div
          onClick={() => setShowCourseTagModal(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">{t('editor.insertCourseTagHeading')}</h3>
              </div>
              <button onClick={() => setShowCourseTagModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.courseTagSelectedTextLabel')}</label>
              <div className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 italic max-h-24 overflow-y-auto">
                "{selectedText}"
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.courseTagLabelInput')}</label>
              <input
                type="text"
                placeholder={t('editor.courseTagLabelPlaceholder')}
                value={modalCourseTagLabel}
                onChange={(e) => setModalCourseTagLabel(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCourseTagModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                {t('editor.cancel')}
              </button>
              <button
                onClick={handleAddCourseTag}
                disabled={!modalCourseTagLabel.trim() || !selectedText.trim()}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs"
              >
                {t('editor.createCourseTagBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Вільне вікно учасників сцени (після «Відкріпити») */}
      {participantsUnpinned && (
        <DraggablePanel
          title={<span className="flex items-center gap-2"><Users className="w-3.5 h-3.5 text-amber-400" /> {t('editor.sceneParticipants', { n: sceneCharacters.length })}</span>}
          initialWidth={420}
          initialHeight={620}
          minWidth={320}
          minHeight={300}
          storageKey="nova_editor_participantsPanelRect"
          bodyClassName="p-3 overflow-auto"
          onClose={() => setParticipantsUnpinned(false)}
        >
          {renderSceneParticipants()}
        </DraggablePanel>
      )}

      {/* Вільне вікно англійського перекладу (після «Відкріпити переклад») */}
      {translationDetached && (
        <DraggablePanel
          title={<span className="flex items-center gap-2">🇬🇧 <span className="text-slate-100">English Edition — {activeSection?.titleEn || activeSection?.title || ''}</span></span>}
          initialWidth={620}
          initialHeight={560}
          minWidth={360}
          minHeight={300}
          storageKey="nova_editor_enPanelRect"
          bodyClassName="p-4 flex flex-col overflow-hidden"
          onClose={() => setTranslationDetached(false)}
        >
          <div className="flex flex-col h-full gap-2">
            <div className="flex items-center justify-end shrink-0">
              {renderFormatToolbar(true)}
            </div>
            <input
              type="text"
              value={activeSection?.titleEn || ''}
              placeholder="Section Title (EN)"
              onChange={(e) => {
                const updated = book.chapters.map((c) =>
                  c.id === activeChapter?.id
                    ? { ...c, sections: c.sections.map((s) => (s.id === activeSection?.id ? { ...s, titleEn: e.target.value } : s)) }
                    : c
                );
                onUpdateBook({ ...book, chapters: updated });
              }}
              className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-bold shrink-0"
            />
            <PageRuler
              widthMm={getPageContentWidthMm()}
              insideMm={book.layoutConfig.margins?.insideMm || 0}
              outsideMm={book.layoutConfig.margins?.outsideMm || 0}
              onChangeMargins={handleChangeMargins}
            />
            <PageColumn widthMm={getPageContentWidthMm()} className="flex-1 min-h-0 rounded-xl border border-slate-800">
              <EditorContent
                editor={enEditor}
                style={{ fontFamily: manuscriptFontStack }}
                className="text-slate-900 text-sm leading-relaxed p-3"
              />
            </PageColumn>
          </div>
        </DraggablePanel>
      )}

      {/* Вільне вікно AI Редактора (читабельність + зауваження) — викликається
          правим кліком по задньому полю редактора */}
      {(showReadabilityWidget || showAiIssuesWidget) && (
        <DraggablePanel
          title={<span className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-cyan-400" /> {t('editor.aiAssistantPanelTitle')}</span>}
          initialWidth={460}
          initialHeight={560}
          minWidth={340}
          minHeight={300}
          storageKey="nova_editor_aiAssistantPanelRect"
          bodyClassName="p-4 overflow-auto"
          onClose={() => {
            setShowReadabilityWidget(false);
            setShowAiIssuesWidget(false);
          }}
        >
          <AiReadabilityPanel
            text={activeSection?.content || ''}
            sectionId={activeSection?.id || ''}
            showReadability={showReadabilityWidget}
            showIssues={showAiIssuesWidget}
          />
        </DraggablePanel>
      )}

      {/* Поповер поведінкових шаблонів героя (наведення на картку учасника сцени
          або на героя в підменю «Вставити репліку героя»). Клік по шаблону
          вставляє його в текст сцени в позицію курсора. */}
      {behaviorPopover &&
        (() => {
          const char = book.characters.find((c) => c.id === behaviorPopover.charId);
          if (!char) return null;
          const patterns = char.behaviorPatterns || [];
          const popW = 360;
          const popH = Math.min(320, 96 + patterns.length * 30 + 12);
          const left = Math.max(8, Math.min(behaviorPopover.x + 16, window.innerWidth - popW - 8));
          const top = Math.max(8, Math.min(behaviorPopover.y + 16, window.innerHeight - popH - 8));
          return (
            <div
              className="fixed z-[90] rounded-xl bg-slate-950 border border-violet-500/40 shadow-2xl shadow-black/70 p-3 text-xs"
              style={{ left, top, width: popW }}
              onMouseDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
              onMouseEnter={cancelBehaviorPopoverClose}
              onMouseLeave={() => {
                cancelBehaviorPopoverClose();
                setBehaviorPopover(null);
              }}
            >
              <div className="flex items-center gap-1.5 pb-2 mb-2 border-b border-violet-500/20 min-w-0">
                {char.avatarUrl ? (
                  <img src={char.avatarUrl} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0 border border-violet-500/30" />
                ) : (
                  <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0">
                    {char.name?.charAt(0) || '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-100 text-[11px] truncate">
                    {char.name} {char.surname || ''}
                  </div>
                  <div className="text-[10px] text-violet-300/80 flex items-center gap-1">
                    <Wand2 className="w-2.5 h-2.5" />
                    {t('editor.behaviorPatternsTitle')}
                  </div>
                </div>
                <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 text-[10px] font-bold shrink-0">
                  {patterns.length}
                </span>
              </div>
              {patterns.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic leading-relaxed">
                  {t('editor.behaviorPatternsEmpty')}
                </p>
              ) : (
                <ul className="space-y-1 max-h-52 overflow-y-auto pr-1">
                  {patterns.map((p, i) => (
                    <li key={i}>
                      <button
                        onClick={() => handleInsertBehaviorPattern(p)}
                        className="w-full text-left text-[11px] text-slate-200 leading-snug flex gap-1.5 px-1.5 py-1 rounded-lg hover:bg-violet-500/15 hover:text-white transition-colors"
                        title={t('editor.behaviorPatternInsertTitle')}
                      >
                        <span className="text-violet-400 shrink-0 mt-0.5">•</span>
                        <span className="min-w-0">{p}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {patterns.length > 0 && (
                <p className="mt-2 pt-2 border-t border-violet-500/15 text-[10px] text-violet-300/60 flex items-center gap-1">
                  <MousePointerClick className="w-3 h-3" />
                  {t('editor.behaviorPatternInsertHint')}
                </p>
              )}
            </div>
          );
        })()}

      {/* Контекстне меню (правий клік по задньому полю редактора).
          Позиція скоригована в useLayoutEffect: якщо знизу від курсора мало
          місця — меню розкривається вгору від курсора. */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[70] w-64 rounded-2xl bg-slate-950 border border-slate-700 shadow-2xl shadow-black/60 p-1.5 text-xs"
          style={{
            left: contextMenuPos ? contextMenuPos.x : contextMenu.x,
            top: contextMenuPos ? contextMenuPos.y : contextMenu.y,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {t('editor.contextMenuHeading')}
          </div>

          <button
            onClick={() => {
              setShowReadabilityWidget((v) => !v);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="flex-1 text-slate-200">{t('editor.contextMenuReadability')}</span>
            {showReadabilityWidget && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
          </button>

          <button
            onClick={() => {
              setShowAiIssuesWidget((v) => !v);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="flex-1 text-slate-200">{t('editor.contextMenuIssues')}</span>
            {showAiIssuesWidget && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
          </button>

          {/* Вставити зображення з медіатеки книги в позицію курсора */}
          <button
            onClick={() => {
              setShowInsertImageModal(true);
              setContextMenu(null);
            }}
            disabled={isReader}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ImagePlus className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="flex-1 text-slate-200">{t('editor.contextMenuInsertImage')}</span>
          </button>

          {/* Обговорити фрагмент у чаті. Стоїть ПЕРЕД генерацією абзаців
              навмисно: спершу «поговорити про текст», потім «дописати
              текст» — це порядок від легшої дії до тієї, що змінює книгу. */}
          {onDiscussInChat && (
            <button
              onClick={() => {
                setContextMenu(null);
                discussSelectionInChat();
              }}
              disabled={!hasFragmentToDiscuss()}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasFragmentToDiscuss() ? undefined : t('editor.discussInChatNoSelection')}
            >
              <MessagesSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="flex-1 text-slate-200">{t('editor.contextMenuDiscussInChat')}</span>
            </button>
          )}

          {/* Озвучити фрагмент (ElevenLabs) — будь-яке непорожнє виділення,
              як і «Обговорити в чаті» вище: працює і на слово, і на абзац. */}
          <div>
            <button
              onClick={() => setShowNarrationSubmenu((v) => !v)}
              disabled={!hasFragmentToDiscuss() || narrationBusy !== null}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasFragmentToDiscuss() ? undefined : t('editor.discussInChatNoSelection')}
            >
              <Volume2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="flex-1 text-slate-200">{t('editor.contextMenuNarrate')}</span>
              {!narrationAccess.hasAccess && !narrationAccess.loading && (
                <span className="text-[9px] font-mono font-bold text-amber-400 uppercase">Pro</span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${showNarrationSubmenu ? 'rotate-180' : ''}`}
              />
            </button>

            {showNarrationSubmenu && (
              <div className="pl-6 pr-1 pb-1 flex flex-col gap-0.5">
                {(['uk', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => {
                      setContextMenu(null);
                      setShowNarrationSubmenu(false);
                      void narrateSelection(lang);
                    }}
                    disabled={narrationBusy !== null}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-left transition-colors text-[12px] text-slate-300 disabled:opacity-50"
                  >
                    {narrationBusy === lang ? (
                      <RotateCcw className="w-3 h-3 animate-spin shrink-0" />
                    ) : (
                      <Volume2 className="w-3 h-3 shrink-0 text-sky-400/70" />
                    )}
                    {lang === 'uk' ? t('editor.narrationLangUk') : t('editor.narrationLangEn')}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Абзац(и) за виділеним фрагментом — розгортається вибором кількості.
              Вимкнений, поки виділення немає: інакше пункт обіцяв би дію, яка
              одразу поверне помилку. */}
          <div>
            <button
              onClick={() => setShowSelectionSubmenu((v) => !v)}
              disabled={isReader || !hasUsableSelection() || selectionAiBusy !== null}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasUsableSelection() ? undefined : t('editor.selectionAiNoSelection')}
            >
              <Sparkles className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
              <span className="flex-1 text-slate-200">{t('editor.contextMenuSelectionParagraphs')}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${showSelectionSubmenu ? 'rotate-180' : ''}`}
              />
            </button>

            {showSelectionSubmenu && (
              <div className="pl-6 pr-1 pb-1 flex flex-col gap-0.5">
                {([1, 2, 3] as const).map((count) => (
                  <button
                    key={count}
                    onClick={() => {
                      setContextMenu(null);
                      setShowSelectionSubmenu(false);
                      void runSelectionParagraphs(count);
                    }}
                    disabled={selectionAiBusy !== null}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-slate-300 hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                  >
                    {t('editor.selectionAiCount', { count: String(count) })}
                  </button>
                ))}
                <div className="px-2.5 pt-1 text-[10px] leading-snug text-slate-500">
                  {t('editor.selectionAiPromptHint')}
                </div>
              </div>
            )}
          </div>

          {/* Вставити репліку героя — розгортається переліком героїв книги */}
          <div className="pt-1 mt-1 border-t border-white/[0.06]">
            <button
              onClick={() => setShowReplicaSubmenu((v) => !v)}
              disabled={isReader}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MessageSquare className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="flex-1 text-slate-200">{t('editor.contextMenuInsertReplica')}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
                  showReplicaSubmenu ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showReplicaSubmenu && (
              <div className="mt-1 max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
                {sceneCharacterList.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-slate-500 italic">
                    {book.characters.length === 0
                      ? t('editor.contextMenuNoCharacters')
                      : t('editor.contextMenuNoSceneCharacters')}
                  </div>
                ) : (
                  sceneCharacterList.map((c) => {
                    const hasPatterns = (c.behaviorPatterns || []).length > 0;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          handleInsertCharacterLine(c.id);
                          setShowReplicaSubmenu(false);
                        }}
                        onMouseEnter={(e) => {
                          cancelBehaviorPopoverClose();
                          setBehaviorPopover({ charId: c.id, x: e.clientX, y: e.clientY });
                        }}
                        onMouseLeave={scheduleBehaviorPopoverClose}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-left transition-colors"
                        title={hasPatterns ? t('editor.behaviorPatternHoverTitle') : undefined}
                      >
                        {c.avatarUrl ? (
                          <img src={c.avatarUrl} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0">
                            {c.name?.charAt(0) || '?'}
                          </div>
                        )}
                        <span className="flex-1 min-w-0 truncate text-slate-200 text-[11px]">
                          {c.name} {c.surname || ''}
                          {c.alias && <span className="text-slate-500 italic"> «{c.alias}»</span>}
                        </span>
                        {hasPatterns && (
                          <Wand2 className="w-3 h-3 text-violet-400/80 shrink-0" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Меню правого кліку по фото: «Проаналізувати фото і згенерувати AI текст книги» → 1/2/3 абзаци. */}
      {aiImageMenu && (
        <div
          className="fixed z-[80] w-60 rounded-2xl bg-slate-950 border border-amber-500/40 shadow-2xl shadow-black/60 p-1.5 text-xs"
          style={{ left: aiImageMenu.x, top: aiImageMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <Sparkles className="w-3 h-3 shrink-0" />
            {t('editor.aiImageMenuHeading')}
          </div>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => handleChooseParagraphCount(n as 1 | 2 | 3)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors"
            >
              <span className="flex-1 text-slate-200">{t(`editor.aiGenerateParagraphs${n}`)}</span>
            </button>
          ))}

          {/* Промпт кожної з трьох кнопок вище — окремий шаблон, який
              редагується в «Конструкторі промтів». Звідси в нього є
              прямий перехід, уже з контекстом саме цього фото. */}
          <div className="mt-1 pt-1 border-t border-slate-800">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {t('editor.aiEditPromptHeading')}
            </div>
            {[1, 2, 3].map((n) => (
              <button
                key={`edit-${n}`}
                onClick={() => handleEditPromptForCount(n as 1 | 2 | 3)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-left transition-colors"
              >
                <SlidersHorizontal className="w-3 h-3 shrink-0 text-slate-500" />
                <span className="flex-1 text-slate-400">{t(`editor.aiEditPrompt${n}`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Пікер робочого модуля — рушій книги не аналізує фото (Q8/Q14 grilling-сесії). */}
      {aiEnginePicker && (
        <div
          className="fixed z-[80] w-72 rounded-2xl bg-slate-950 border border-amber-500/40 shadow-2xl shadow-black/60 p-1.5 text-xs"
          style={{ left: aiEnginePicker.x, top: aiEnginePicker.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            {t('editor.aiEnginePickerHeading')}
          </div>
          {(() => {
            const options = aiCoreModels.filter((m) => VISION_ENGINES_FRONT.has(m.engine) && m.available);
            if (options.length === 0) {
              return <div className="px-2.5 py-2 text-[11px] text-slate-500 italic">{t('editor.aiEnginePickerEmpty')}</div>;
            }
            return options.map((m) => (
              <button
                key={m.id}
                onClick={() => handlePickWorkingAiEngine(m.id, m.label)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] text-left transition-colors"
              >
                <span className="flex-1 text-slate-200">{m.label}</span>
              </button>
            ));
          })()}
        </div>
      )}

    </div>
  );
};
