import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { initialBookData } from './data/initialBook';
import { Book, NavigationTab, AuditLogEntry, UserRole, BookVersionSnapshot, HeroArcState } from './types';
import { HeaderNav } from './components/HeaderNav';
import { SidebarNav } from './components/SidebarNav';
import { StartPageView } from './components/StartPageView';
import { ExpressWizardView } from './components/ExpressWizardView';
import { EditorView, type PromptConstructorRequest } from './components/EditorView';
import { MasteryFrameworkView } from './components/MasteryFrameworkView';
import { SunLightingProvider } from './context/SunLightingContext';
import { WriterBookProvider } from './context/WriterBookContext';
import { DraggableSun } from './components/mastery/DraggableSun';
import { SunAmbientOverlay } from './components/mastery/SunAmbientOverlay';
import { SunAuraManager } from './components/SunAuraManager';
import { DashboardView } from './components/DashboardView';
import { KnowledgeView } from './components/KnowledgeView';
import { TrainersView } from './components/TrainersView';
import { BookStructureBuilder } from './components/BookStructureBuilder';
import { PortfolioView } from './components/PortfolioView';
import { PublishingHubView } from './components/PublishingHubView';
import { TableOfContentsView } from './components/TableOfContentsView';
import { QRFootnotesView } from './components/QRFootnotesView';
import { ScenarioView } from './components/ScenarioView';
import { CharactersView } from './components/CharactersView';
import { MindBoardView } from './components/MindBoardView';
import { AIStudioView } from './components/AIStudioView';
import { IllustrationsView } from './components/IllustrationsView';
import { LayoutView } from './components/LayoutView';
import { BookPreviewView } from './components/BookPreviewView';
import { CoverDesignerView } from './components/CoverDesignerView';
import { ChangeLogView } from './components/ChangeLogView';
import { ExportView } from './components/ExportView';
import { MediaLibraryView } from './components/MediaLibraryView';
import { BookSettingsModal } from './components/BookSettingsModal';
import { QuickAiModal } from './components/QuickAiModal';
import { RoleManagementModal } from './components/RoleManagementModal';
import { VersionSnapshotModal } from './components/VersionSnapshotModal';
import { CreateBookModal } from './components/CreateBookModal';
import { ImportBookModal } from './components/ImportBookModal';
import { ImportMaterialsWizardModal } from './components/ImportMaterialsWizardModal';
import { CollaborationDrawer } from './components/CollaborationDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthScreen } from './components/AuthScreen';
import { AdminOsView } from './components/adminOs/AdminOsView';
import { SubscriptionView } from './components/SubscriptionView';
import { ApiKeysView } from './components/ApiKeysView';
import { ManuscriptFormatterView } from './components/ManuscriptFormatterView';
import { CoursesView } from './components/CoursesView';
import { PdfEditorView } from './components/PdfEditorView';
import { OnboardingTour } from './onboarding/OnboardingTour';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { estimatePageCount, calculateWordCount } from './utils/helpers';
import { appendTextToChapterEnd } from './utils/bookText';
import { canAccessTab, getDefaultTabForRole, getRoleInfo } from './utils/rbac';
import { diffSectionChange, applySectionPatch, type SectionPatch } from './utils/bookDiff';
import { exportBookToBackupZip, BookBackupManifest } from './utils/bookBackup';
import {
  installAiErrorReporter,
  endpointLabel,
  AI_ERROR_EVENT,
  type AiErrorDetail,
} from './utils/aiClient';
import { migrateImageWrapDefaults } from './utils/wrapMigration';
import {
  loadBook,
  saveBook,
  loadMeta,
  saveMeta,
  saveSnapshotData,
  loadSnapshotData,
  migrateFromLocalStorage,
  StorageError,
  META_CHANGELOG,
  META_ROLE,
  META_COWORK_LOCK,
} from './utils/storage';
import { stampBookRevision, isNewerBook, describeRevisionGap } from './utils/bookVersion';
import { otherSessionsOfSameUser } from './utils/deviceSession';
import { AlertTriangle, CheckCircle2, Radio, Loader2, HardDriveDownload, Mail, LogOut, UserCheck, XCircle } from 'lucide-react';
import { useLanguage } from './i18n/LanguageContext';

/** Пауза після останнього натискання клавіші перед автозбереженням. */
const AUTOSAVE_DEBOUNCE_MS = 2000;

/** Скільки записів журналу тримати в сховищі (старіші відкидаємо). */
const MAX_LOG_ENTRIES = 500;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const INITIAL_LOG_ENTRIES: AuditLogEntry[] = [
  {
    id: 'log-seed-1',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    action: 'Ініціалізація та створення проекту',
    category: 'system',
    bookId: 'BK-2084-CYBER',
    bookVersion: 'v1.0.0',
    role: 'admin',
    details: 'Створено проект книги «Хроніки Скляного Світу: Архітектор Нео-Києва» [ID: BK-2084-CYBER, Версія: v1.0.0]. Завантажено базові параметри друку та стилі.',
    author: 'Ярослав Вороний (Адміністратор)',
  },
  {
    id: 'log-seed-2',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
    action: 'Фіксація версії (Snapshot)',
    category: 'version',
    bookId: 'BK-2084-CYBER',
    bookVersion: 'v1.0.0',
    role: 'admin',
    details: 'Фіксація початкового релізу v1.0.0: початковий концепт кіберпанк-роману та перша глава.',
    author: 'Ярослав Вороний',
  },
  {
    id: 'log-seed-3',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    action: 'Створення персонажів',
    category: 'character',
    bookId: 'BK-2084-CYBER',
    bookVersion: 'v1.0.0',
    role: 'writer',
    details: 'Додано досьє персонажів: Марк Вербов (Головний герой), Сварог (AI-синтет), Доктор Олена Корнієнко.',
    author: 'Письменник',
  },
  {
    id: 'log-seed-4',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    action: 'Формування змісту та QR-тегів',
    category: 'structure',
    bookId: 'BK-2084-CYBER',
    bookVersion: 'v1.0.0',
    role: 'designer',
    details: 'Налаштовано автоматичний зміст з відліком сторінок та додано 2 інтерактивні сноски з QR-кодами.',
    author: 'Дизайнер верстки',
  }
];

export default function App() {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();

  // Книга підвантажується з IndexedDB асинхронно — до завершення показуємо заставку.
  const [book, setBook] = useState<Book>(initialBookData);
  const [isHydrating, setIsHydrating] = useState<boolean>(true);

  // Audit changelog entries
  const [logEntries, setLogEntries] = useState<AuditLogEntry[]>(INITIAL_LOG_ENTRIES);

  // Роль визначає сервер за обліковим записом. Локально вона лише
  // віддзеркалюється, щоб інтерфейс не блимав до завантаження профілю.
  const [currentRole, setCurrentRole] = useState<UserRole>('guest');
  const [isRoleModalOpen, setIsRoleModalOpen] = useState<boolean>(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState<boolean>(false);
  const [isCreateBookModalOpen, setIsCreateBookModalOpen] = useState<boolean>(false);
  const [isImportBookModalOpen, setIsImportBookModalOpen] = useState<boolean>(false);
  const [isImportWizardModalOpen, setIsImportWizardModalOpen] = useState<boolean>(false);
  const [isCollabDrawerOpen, setIsCollabDrawerOpen] = useState<boolean>(false);

  // Cowork-режим: якщо роль зафіксована прийнятим запрошенням до конкретної
  // книги (bookId), перемикач ролей для цієї книги блокується — учасник
  // працює лише в межах ролі, яку йому надав письменник.
  const [coworkLock, setCoworkLock] = useState<{ bookId: string; role: UserRole } | null>(null);

  // Стан прийняття cowork-запрошення за посиланням `?invite=<token>`.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{
    bookId: string;
    bookTitle: string;
    role: UserRole;
    inviteeEmail: string;
    status: 'pending' | 'accepted' | 'revoked';
  } | null>(null);
  const [inviteScreenStatus, setInviteScreenStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'accepting' | 'done'>('idle');
  const [inviteScreenError, setInviteScreenError] = useState<string | null>(null);

  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');
  const [activeChapterId, setActiveChapterId] = useState<string>(book.chapters[0]?.id || '');
  const [activeSectionId, setActiveSectionId] = useState<string>(book.chapters[0]?.sections[0]?.id || '');
  /** Діапазон символів для виділення в EditorView одразу після «Передати текст у книгу» з AI-чату. */
  const [pendingChatHighlight, setPendingChatHighlight] = useState<{ sectionId: string; start: number; end: number } | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isQuickAiOpen, setIsQuickAiOpen] = useState<boolean>(false);
  /**
   * «Редагувати промт →» з меню правого кліку по фото (EditorView.tsx):
   * контекст того зображення, з яким треба відкрити конструктор промтів.
   */
  const [promptContext, setPromptContext] = useState<PromptConstructorRequest | null>(null);
  /** Збільшується після «Зберегти й згенерувати» — редактор ловить це й догенеровує текст за тим самим фото. */
  const [promptGenerateTick, setPromptGenerateTick] = useState(0);
  /** Знімок кільця сили сонця (DraggableSun) — чекає прикріплення в чат AI. */
  const [pendingSunScreenshot, setPendingSunScreenshot] = useState<File | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // Стан персистентності: показується в шапці замість зникомого тоста.
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  // Помилки AI-запитів: раніше вони просто писалися в консоль.
  const [aiError, setAiError] = useState<AiErrorDetail | null>(null);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Прапорець гідратації: перший запис книги в стан не має вмикати автозбереження.
  const hydratedRef = useRef<boolean>(false);

  // Append entry to changelog
  const addLogEntry = useCallback((
    action: string, 
    details: string, 
    category: AuditLogEntry['category'] = 'text',
    customBookId?: string,
    customVersion?: string,
    customRole?: UserRole
  ): AuditLogEntry => {
    const roleToUse = customRole || currentRole;
    const roleInfo = getRoleInfo(roleToUse);
    const newEntry: AuditLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      action,
      category,
      bookId: customBookId || book.id || 'BK-2084-CYBER',
      bookVersion: customVersion || book.version || 'v1.0.0',
      role: roleToUse,
      details,
      author: book.author ? `${book.author} (${roleInfo.nameUk})` : roleInfo.nameUk,
    };
    setLogEntries(prev => [newEntry, ...prev]);
    return newEntry;
  }, [book.id, book.version, book.author, currentRole]);

  // Real-time synchronization hook for WebSockets / Multi-User Collaboration
  const {
    syncStatus,
    collaborators,
    chatMessages,
    myClientId,
    sendChatMessage,
    broadcastBookUpdate,
    broadcastSectionPatch,
    broadcastSnapshot,
    reconnect: reconnectWebSockets
  } = useRealtimeSync({
    book,
    currentRole,
    currentTab,
    activeChapterId,
    activeSectionId,
    onRemoteBookUpdate: useCallback((remoteBook: Book, remoteLogEntry?: AuditLogEntry) => {
      // Друга лінія захисту від затирання. Перевірка є і в самому хуку, але
      // власником стану книги є саме App — а між надходженням повідомлення
      // й цим колбеком локальна копія могла піти вперед (автор саме набирав
      // текст). Функціональний setState бачить актуальний prev, тож рішення
      // ухвалюється на найсвіжіших даних.
      let applied = true;
      setBook((prev) => {
        if (!isNewerBook(remoteBook, prev)) {
          applied = false;
          return prev;
        }
        saveBook(remoteBook).catch((e) => console.warn('[storage] remote update', e));
        return remoteBook;
      });
      if (!applied) return;
      setHasUnsavedChanges(false);

      if (remoteLogEntry) {
        setLogEntries(prev => [remoteLogEntry, ...prev.filter(l => l.id !== remoteLogEntry.id)]);
      }

      setSyncToast(`Співавтор синхронізував зміни: «${remoteBook.title}»`);
      setTimeout(() => setSyncToast(null), 3000);
    }, []),
    // Точкова правка від співавтора: змінюємо лише потрібну секцію,
    // не підмінюючи все дерево книги.
    onRemoteSectionPatch: useCallback((patch: SectionPatch) => {
      setBook((prev) => {
        const next = applySectionPatch(prev, patch);
        if (next === prev) return prev;
        saveBook(next).catch((e) => console.warn('[storage] remote patch', e));
        return next;
      });
    }, []),
    /**
     * Прийшла старіша копія — ми лишились на своїй. Кажемо про це прямо:
     * мовчазне ігнорування виглядало б як «синхронізація не працює», а
     * мовчазне застосування (як було) з'їдало б текст.
     */
    onStaleRemoteRejected: useCallback((_staleBook: Book, gapLabel: string) => {
      setSyncToast(
        `Ця книга відкрита ще в одній сесії зі старішим станом (на ${gapLabel} позаду). ` +
          'Залишено вашу версію й надіслано її туди.'
      );
      setTimeout(() => setSyncToast(null), 7000);
    }, []),
    onRemoteVersionSnapshot: useCallback((snapshot: BookVersionSnapshot, remoteBook: Book) => {
      if (remoteBook) {
        setBook(remoteBook);
        saveBook(remoteBook).catch((e) => console.warn('[storage] remote snapshot', e));
      }
      setSyncToast(`Співавтор зафіксував нову версію: ${snapshot.versionNumber} («${snapshot.label}»)`);
      setTimeout(() => setSyncToast(null), 4000);
    }, [])
  });

  // Повернення з LiqPay/PayPal після оплати завжди веде на сторінку
  // «Підписка», де SubscriptionView сам розбере параметри запиту.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('subscription')) {
      setCurrentTab('subscription');
    }
  }, []);

  // Вхід із кнопки «Створити книгу» на головній маркетплейсу
  // (?create=book): студія відкривається одразу на створенні книги, а не на
  // панелі, звідки її ще треба знайти. Саме це відрізняє ту кнопку від
  // сусідньої «Відкрити студію» — інакше обидві вели б в одне місце.
  //
  // Намір зберігається окремо від адреси й чекає на автентифікацію. Прямо
  // на монтуванні відкривати вікно марно: людина, яка прийшла з
  // маркетплейсу, найчастіше ще не увійшла, і поверх екрана входу воно
  // просто згоріло б, а параметр із адреси вже зник.
  //
  // Коли зʼявиться експрес-майстер (Wisart Book Crealiry.md §3.4), тут
  // стане перемикач на вкладку `express`; поки що найближче до задуму —
  // наявне вікно створення книги.
  const [pendingCreateBook, setPendingCreateBook] = useState<boolean>(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('create') !== 'book') return;
    setPendingCreateBook(true);
    // Прибираємо з адреси одразу, як і `invite` нижче: інакше параметр
    // лишиться в історії, і кнопка «назад» відкриє вікно вдруге.
    url.searchParams.delete('create');
    window.history.replaceState({}, '', url.toString());
  }, []);

  useEffect(() => {
    if (!pendingCreateBook) return;
    if (auth.loading) return;
    // Гостю теж відкриваємо: за ТЗ §3.4.1 майстер проходять до реєстрації —
    // саме в цьому його сенс як точки входу з маркетплейсу.
    setCurrentTab('express');
    setPendingCreateBook(false);
  }, [pendingCreateBook, auth.loading]);

  // Перехід за посиланням cowork-запрошення (?invite=<token>) — токен читаємо
  // один раз і одразу прибираємо з адресного рядка, щоб він не залишався в
  // історії браузера й не перепрацьовувався повторно при кожному рендері.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (!token) return;
    setInviteToken(token);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.toString());
  }, []);

  // Публічний перегляд запрошення (без входу) — щоб знати, куди й у якій
  // ролі кличуть, ще до того, як людина авторизується.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    setInviteScreenStatus('loading');
    setInviteScreenError(null);
    (async () => {
      try {
        const res = await fetch(`/api/collaboration/invite/${encodeURIComponent(inviteToken)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setInviteScreenStatus('error');
          setInviteScreenError(data?.error || 'Запрошення не знайдено або воно недійсне.');
          return;
        }
        setInviteInfo({
          bookId: data.bookId,
          bookTitle: data.bookTitle,
          role: data.role as UserRole,
          inviteeEmail: data.inviteeEmail,
          status: data.status,
        });
        setInviteScreenStatus('ready');
      } catch {
        if (!cancelled) {
          setInviteScreenStatus('error');
          setInviteScreenError('Сервер недоступний. Спробуйте перейти за посиланням ще раз пізніше.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const handleAcceptInvite = async () => {
    if (!inviteToken || !inviteInfo) return;
    setInviteScreenStatus('accepting');
    setInviteScreenError(null);
    try {
      const res = await fetch(`/api/collaboration/invite/${encodeURIComponent(inviteToken)}/accept`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteScreenStatus('ready');
        setInviteScreenError(data?.error || 'Не вдалося прийняти запрошення.');
        return;
      }

      const lock = { bookId: data.bookId as string, role: data.role as UserRole };
      setCoworkLock(lock);
      saveMeta(META_COWORK_LOCK, lock).catch((e) => console.warn('[storage]', e));

      // Якщо ця книга ще не відкрита локально — створюємо мінімальну
      // заглушку з тим самим ID: реальний вміст прийде через WS-кімнату
      // спільної роботи (server.ts, room:sync), щойно письменник буде онлайн.
      if (book.id !== lock.bookId) {
        const stubBook: Book = {
          ...initialBookData,
          id: lock.bookId,
          title: data.bookTitle || inviteInfo.bookTitle,
          chapters: [],
        };
        setBook(stubBook);
        setActiveChapterId('');
        setActiveSectionId('');
        persistBook(stubBook);
      }

      handleSelectRole(lock.role);
      setInviteScreenStatus('done');
      setCurrentTab(getDefaultTabForRole(lock.role));
    } catch {
      setInviteScreenStatus('ready');
      setInviteScreenError('Сервер недоступний. Спробуйте ще раз.');
    }
  };

  // Жодна невдала відповідь /api/ai/* не має зникнути мовчки.
  useEffect(() => {
    installAiErrorReporter();
    const handler = (event: Event) => {
      setAiError((event as CustomEvent<AiErrorDetail>).detail);
    };
    window.addEventListener(AI_ERROR_EVENT, handler);
    return () => window.removeEventListener(AI_ERROR_EVENT, handler);
  }, []);

  // Гідратація: міграція зі старого localStorage + читання з IndexedDB.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await migrateFromLocalStorage();

        const [storedBook, storedLog, storedRole, storedCoworkLock] = await Promise.all([
          loadBook(),
          loadMeta<AuditLogEntry[]>(META_CHANGELOG),
          loadMeta<string>(META_ROLE),
          loadMeta<{ bookId: string; role: UserRole }>(META_COWORK_LOCK),
        ]);

        if (cancelled) return;

        if (storedBook) {
          setBook(storedBook);
          setActiveChapterId(storedBook.chapters[0]?.id || '');
          setActiveSectionId(storedBook.chapters[0]?.sections[0]?.id || '');
        }
        if (!storedBook) {
          // Перший запуск: одразу кладемо початковий проект у сховище,
          // щоб наступне завантаження читалося зі сховища, а не з коду.
          await saveBook(initialBookData).catch(() => undefined);
        }
        if (storedLog && storedLog.length) setLogEntries(storedLog);
        if (
          storedRole &&
          ['admin', 'writer', 'designer', 'translator', 'publisher', 'reader'].includes(storedRole)
        ) {
          setCurrentRole(storedRole as UserRole);
        }
        if (storedCoworkLock && storedCoworkLock.bookId) {
          setCoworkLock(storedCoworkLock);
        }
        if (storedBook) setLastSavedAt(new Date().toISOString());
      } catch (err) {
        if (!cancelled) {
          console.error('[storage] Не вдалося завантажити проект', err);
          setStorageError(
            err instanceof StorageError
              ? err.message
              : 'Не вдалося прочитати збережений проект. Показано початкові дані.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
          // Даємо React застосувати стан перед тим, як дозволити автозбереження.
          requestAnimationFrame(() => {
            hydratedRef.current = true;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Роль користувача приходить із сервера разом із профілем — окрім
  // випадку, коли роль для ЦІЄЇ книги зафіксована прийнятим cowork-
  // запрошенням (дизайнер/видавець/перекладач не можуть сам собі повернути
  // ширші права, просто перезайшовши в акаунт).
  useEffect(() => {
    if (auth.loading || !auth.user) return;
    if (coworkLock && coworkLock.bookId === book.id && auth.user.role !== 'admin') {
      setCurrentRole((prev) => (prev === coworkLock.role ? prev : coworkLock.role));
      return;
    }
    const serverRole = auth.user.role as UserRole;
    setCurrentRole((prev) => (prev === serverRole ? prev : serverRole));
    if (!canAccessTab(serverRole, currentTab)) {
      setCurrentTab(getDefaultTabForRole(serverRole));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.user?.role, coworkLock, book.id]);

  // Журнал змін: обрізаємо до MAX_LOG_ENTRIES, щоб він не ріс безмежно.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const trimmed = logEntries.slice(0, MAX_LOG_ENTRIES);
    saveMeta(META_CHANGELOG, trimmed).catch((e) =>
      console.warn('[storage] Не вдалося зберегти журнал змін', e)
    );
  }, [logEntries]);

  // Compute total words
  const totalWords = useMemo(() => {
    return book.chapters.reduce(
      (acc, c) => acc + c.sections.reduce((sAcc, s) => sAcc + (s.wordCount || calculateWordCount(s.content)), 0),
      0
    );
  }, [book]);

  // Compute total pages based on physical layout format
  const totalPages = useMemo(() => {
    return estimatePageCount(
      totalWords,
      book.layoutConfig.formatPreset,
      book.layoutConfig.typography.fontSizePt,
      book.layoutConfig.typography.lineHeight
    );
  }, [totalWords, book.layoutConfig]);

  /**
   * Єдина точка запису книги у сховище.
   * Помилки не проковтуються: при переповненні сховища стан переходить
   * у 'error', а hasUnsavedChanges НЕ скидається — інакше інтерфейс
   * рапортував би про збереження, якого не було.
   */
  const persistBook = useCallback(async (bookToSave: Book): Promise<boolean> => {
    setSaveState('saving');
    try {
      await saveBook(bookToSave);
      setHasUnsavedChanges(false);
      setLastSavedAt(new Date().toISOString());
      setStorageError(null);
      setSaveState('saved');
      return true;
    } catch (err) {
      const message =
        err instanceof StorageError
          ? err.message
          : 'Не вдалося зберегти зміни у сховище браузера.';
      console.error('[storage] Помилка збереження', err);
      setStorageError(message);
      setSaveState('error');
      return false;
    }
  }, []);

  // Автозбереження через AUTOSAVE_DEBOUNCE_MS після останньої зміни.
  useEffect(() => {
    if (!hydratedRef.current || !hasUnsavedChanges) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      persistBook(book);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [book, hasUnsavedChanges, persistBook]);

  // --- Одноразова міграція режиму обтікання зображень ---
  //
  // Книги, написані до появи режимів обтікання, зберігали маркер `[IMG: …]`
  // без `wrap=`, і такі фото відкривались блоком на всю ширину. За рішенням
  // автора вони мають стати обтічними ЗЛІВА, і режим фіксується в тексті
  // явно, а не лишається неявним дефолтом.
  //
  // Прохід переписує рукопис, тому перед ним кладемо ЗНІМОК ВЕРСІЇ — єдина
  // точка, у яку можна відкотитись, якщо нова верстка автора не влаштує.
  // У журнал змін іде ОДИН запис на всю міграцію, а не по одному на кожну
  // картинку, щоб не поховати під собою справжні авторські правки.
  const wrapMigrationDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (isHydrating || !hydratedRef.current) return;
    const bookId = book?.id;
    if (!bookId || wrapMigrationDoneRef.current === bookId) return;

    // Позначаємо ДО перевірки результату: інакше книга без старих маркерів
    // проганяла б міграцію на кожну свою зміну.
    wrapMigrationDoneRef.current = bookId;

    const { book: migrated, changed } = migrateImageWrapDefaults(book);
    if (!changed) return;

    // «1 зображення», «2 зображення», «5 зображень» — запис у журналі читає людина.
    const plural = (n: number) => {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'зображення';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'зображення';
      return 'зображень';
    };
    const countLabel = `${changed} ${plural(changed)}`;

    const roleInfo = getRoleInfo(currentRole);
    const authorName = book.author ? `${book.author} (${roleInfo.nameUk})` : roleInfo.nameUk;
    const snapshot: BookVersionSnapshot = {
      id: `snap-${Date.now()}-wrap`,
      bookId,
      versionNumber: book.version || '1.0.0',
      revisionNumber: book.revisionNumber || 1,
      timestamp: new Date().toISOString(),
      author: authorName,
      authorName,
      authorRole: currentRole,
      label: 'До переходу на обтікання зображень',
      note: `Автоматичний знімок перед тим, як ${countLabel} отримали режим обтікання «зліва».`,
      comment: '',
      tags: ['auto', 'migration'],
      wordCount: totalWords,
      chapterCount: book.chapters.length,
      pageCount: totalPages,
    };

    const withHistory: Book = {
      ...migrated,
      versionHistory: [...(book.versionHistory || []), snapshot],
    };

    saveSnapshotData(snapshot.id, bookId, {
      title: book.title,
      chapters: book.chapters,
      characters: book.characters,
      layoutConfig: book.layoutConfig,
    })
      .catch((err) => {
        // Знімок — страховка, а не умова. Якщо сховище його не взяло,
        // чесніше записати це в консоль і не робити міграцію взагалі,
        // ніж переписати рукопис без можливості відкоту.
        console.error('[wrap-migration] знімок версії не збережено, міграцію пропущено', err);
        throw err;
      })
      .then(() => {
        handleUpdateBook(
          withHistory,
          'Обтікання зображень',
          `${countLabel} зі старих розділів отримали режим обтікання «зліва». Знімок «${snapshot.label}» збережено для відкоту.`
        );
      })
      .catch(() => {
        /* повідомлення вже в консолі — книгу лишаємо недоторканою */
      });
  }, [book, isHydrating, currentRole, totalWords, totalPages]);

  // Нативне попередження браузера при спробі закрити вкладку з незбереженими змінами.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Central book update handler that tracks unsaved changes, records audit entries, and broadcasts over WebSockets
  /**
   * Переносить готовий план експрес-майстра (§3.4.5) у поточну книгу.
   *
   * Свідомо НЕ створює нову книгу, а наповнює наявну: у Nova книга — це
   * контейнер із версією, логом і налаштуваннями верстки, і плодити другий
   * означало б розірвати історію змін навпіл.
   *
   * Наявні глави й герої заміщуються, а не доповнюються: майстер дає цілісну
   * структуру, і змішування її з попереднім чернетковим вмістом дало б
   * книгу, де половина глав з одного задуму, а половина з іншого.
   */
  const applyExpressPlan = (plan: {
    seed?: string;
    genre?: string;
    synopsis?: string;
    cast?: Array<{
      firstName: string;
      lastName: string;
      psychotype?: string;
      poltiRoleName?: string;
      hook?: string;
    }>;
    heroArc?: HeroArcState;
    parts?: Array<{
      partTitle?: string;
      chapters?: Array<{
        chapterTitle?: string;
        summary?: string;
        turningPoint?: string;
        environmentalContext?: string | null;
      }>;
    }>;
  }) => {
    const stamp = Date.now();
    const now = new Date().toISOString();

    const characters = (plan.cast ?? []).map((c, i) => ({
      id: `char-express-${stamp}-${i}`,
      bookId: book.id,
      name: c.firstName,
      surname: c.lastName,
      // Перший у касті — протагоніст, другий — антагоніст: майстер віддає їх
      // у порядку ваги. Точні ролі письменник виставить на вкладці
      // «Персонажі», де для цього є повний набір.
      role: (i === 0 ? 'protagonist' : i === 1 ? 'antagonist' : 'ally') as
        | 'protagonist'
        | 'antagonist'
        | 'ally',
      description: [
        c.psychotype,
        c.poltiRoleName ? `Амплуа: ${c.poltiRoleName}` : '',
        c.hook,
      ]
        .filter(Boolean)
        .join('. '),
    }));

    // Частина майстра стає главою книги, а глава майстра — розділом
    // усередині неї: окремого рівня «частина» в Nova немає, і так
    // зберігаються обидві назви замість того, щоб втратити одну.
    const chapters = (plan.parts ?? []).map((part, pi) => ({
      id: `chap-express-${stamp}-${pi}`,
      bookId: book.id,
      title: part.partTitle || `Частина ${pi + 1}`,
      order: pi + 1,
      sections: (part.chapters ?? []).map((ch, ci) => ({
        id: `sec-express-${stamp}-${pi}-${ci}`,
        chapterId: `chap-express-${stamp}-${pi}`,
        title: ch.chapterTitle || `Глава ${ci + 1}`,
        order: ci + 1,
        // Синопсис сцени лягає в текст відправною точкою: порожня сторінка
        // тут звела б нанівець сенс майстра.
        //
        // Загорнуто в [AI-DRAFT]…[/AI-DRAFT] (utils/manuscriptDoc.ts): у
        // редакторі цей текст показується іншим шрифтом і з позначкою
        // «AI-чернетка», доки письменник не перепише його своїми словами
        // й не зніме позначку через контекстне меню блоку.
        content: [
          '[AI-DRAFT]\n\n',
          ch.summary ?? '',
          ch.turningPoint ? `\n\nПоворот: ${ch.turningPoint}` : '',
          ch.environmentalContext ? `\n\nСтихія: ${ch.environmentalContext}` : '',
          '\n\n[/AI-DRAFT]',
        ].join(''),
        wordCount: (ch.summary ?? '').trim().split(/\s+/).filter(Boolean).length,
        lastModified: now,
      })),
    }));

    handleUpdateBook(
      {
        ...book,
        genre: plan.genre || book.genre,
        logline: plan.seed || book.logline,
        synopsis: plan.synopsis || book.synopsis,
        characters: characters.length
          ? (characters as unknown as Book['characters'])
          : book.characters,
        chapters: chapters.length ? (chapters as unknown as Book['chapters']) : book.chapters,
        heroArc: plan.heroArc || book.heroArc,
      },
      'Експрес-майстер',
      `План перенесено в книгу: ${chapters.length} частин, ${characters.length} героїв`
    );
  };

  const handleUpdateBook = (incomingBook: Book, logAction?: string, logDetails?: string) => {
    const previousBook = book;
    // Позначка версії ставиться ТУТ, у єдиній точці входу будь-якої правки.
    // Доти `updatedAt` оновлювався лише у двох місцях із десятків, тож поле
    // фактично зберігало дату створення книги — і перевірка «чия копія
    // новіша» під час синхронізації між пристроями порівнювала дві однакові
    // застарілі дати, тобто не працювала взагалі.
    const updatedBook = stampBookRevision(incomingBook);
    setBook(updatedBook);
    setHasUnsavedChanges(true);
    let logEntry: AuditLogEntry | undefined;
    if (logAction) {
      logEntry = addLogEntry(
        logAction,
        logDetails || `Оновлено дані книги «${updatedBook.title}»`,
        'text'
      );
    }

    // Якщо змінився лише текст однієї секції (звичайний набір у редакторі) —
    // шлемо компактний патч. Структурні зміни, як і раніше, йдуть книгою повністю.
    const patch = logEntry ? null : diffSectionChange(previousBook, updatedBook);
    if (patch) {
      broadcastSectionPatch(patch, updatedBook.id);
    } else {
      broadcastBookUpdate(updatedBook, logEntry);
    }
  };

  // Commit version snapshot handler
  const handleCommitVersion = (
    versionNumber: string,
    label: string,
    note?: string,
    tags?: string[]
  ) => {
    const authorRole = currentRole;
    const roleInfo = getRoleInfo(authorRole);
    const authorName = book.author ? `${book.author} (${roleInfo.nameUk})` : roleInfo.nameUk;
    const nextRevision = (book.revisionNumber || 1) + 1;
    
    const newSnapshot: BookVersionSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      bookId: book.id || 'BK-2084-CYBER',
      versionNumber,
      revisionNumber: nextRevision,
      timestamp: new Date().toISOString(),
      author: authorName,
      authorName,
      authorRole,
      label,
      note: note || '',
      comment: note || '',
      tags: tags || [],
      wordCount: totalWords,
      chapterCount: book.chapters.length,
      pageCount: totalPages,
    };

    // Важкий зліпок кладемо в окреме сховище, а не всередину книги:
    // саме він раніше роздував запис і вичерпував квоту на 4-му коміті.
    const snapshotPayload = {
      title: book.title,
      chapters: book.chapters,
      characters: book.characters,
      layoutConfig: book.layoutConfig,
    };

    const updatedHistory = [...(book.versionHistory || []), newSnapshot];

    const updatedBook: Book = {
      ...book,
      version: versionNumber,
      revisionNumber: nextRevision,
      versionHistory: updatedHistory,
    };

    setBook(updatedBook);

    saveSnapshotData(newSnapshot.id, book.id || 'default', snapshotPayload)
      .then(() => persistBook(updatedBook))
      .catch((err) => {
        console.error('[storage] Не вдалося зберегти зліпок версії', err);
        setStorageError(
          err instanceof StorageError
            ? err.message
            : 'Версію зафіксовано, але зліпок не вдалося зберегти.'
        );
        setSaveState('error');
      });

    // Audit log entry
    const logEntry = addLogEntry(
      `Фіксація версії [${versionNumber}]`,
      `Успішно зафіксовано віху: «${label}» (Ревізія #${nextRevision}, Слів: ${totalWords}). Роль: ${roleInfo.nameUk}.${note ? ` Коментар: ${note}` : ''}`,
      'version',
      book.id,
      versionNumber,
      authorRole
    );

    // Broadcast version snapshot to real-time room
    broadcastSnapshot(newSnapshot, updatedBook);

    setSaveToast(`Версію ${versionNumber} успішно зафіксовано в системі!`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  // Restore previous snapshot handler
  const handleRestoreSnapshot = async (snapshot: BookVersionSnapshot) => {
    // Зліпок лежить в окремому сховищі; для старих записів лишається
    // підтримка вбудованого snapshotData.
    const payload = snapshot.snapshotData || (await loadSnapshotData(snapshot.id));

    if (!payload) {
      setStorageError(
        `Не знайдено дані зліпка ${snapshot.versionNumber}. Можливо, його було створено на іншому пристрої.`
      );
      return;
    }

    const updatedBook: Book = {
      ...book,
      title: payload.title || book.title,
      chapters: payload.chapters || book.chapters,
      characters: payload.characters || book.characters,
      layoutConfig: payload.layoutConfig || book.layoutConfig,
      version: snapshot.versionNumber,
    };
    setBook(updatedBook);
    await persistBook(updatedBook);

    const logEntry = addLogEntry(
      `Відновлення версії [${snapshot.versionNumber}]`,
      `Проект повернено до стану версії ${snapshot.versionNumber} («${snapshot.label}» від ${new Date(snapshot.timestamp).toLocaleString('uk-UA')}).`,
      'version',
      book.id,
      snapshot.versionNumber,
      currentRole
    );

    broadcastBookUpdate(updatedBook, logEntry);

    setSaveToast(`Проект успішно відновлено до версії ${snapshot.versionNumber}!`);
    setTimeout(() => setSaveToast(null), 3500);
  };

  // Create brand new book project
  const handleCreateNewBook = (
    title: string,
    author: string,
    genre: string,
    bookId: string,
    initialVersion: string,
    creatorRole: UserRole,
    initialNote?: string
  ) => {
    const roleInfo = getRoleInfo(creatorRole);
    const initialSnapshot: BookVersionSnapshot = {
      id: `snap-init-${Date.now()}`,
      bookId,
      versionNumber: initialVersion,
      revisionNumber: 1,
      timestamp: new Date().toISOString(),
      author,
      authorName: author,
      authorRole: creatorRole,
      label: 'Ініціалізація та старт проекту',
      comment: initialNote || 'Початкова фіксація новоствореного твору.',
      note: initialNote || 'Початкова фіксація новоствореного твору.',
      tags: ['Створення', 'Ініціалізація'],
      wordCount: 10,
      chapterCount: 1,
      pageCount: 1,
    };

    const newBook: Book = {
      ...initialBookData,
      id: bookId,
      title,
      author,
      genre,
      version: initialVersion,
      revisionNumber: 1,
      createdAt: new Date().toISOString(),
      versionHistory: [initialSnapshot],
      chapters: [
        {
          id: `chap-${Date.now()}-1`,
          bookId,
          title: 'Глава 1: Новий початок',
          order: 1,
          sections: [
            {
              id: `sec-${Date.now()}-1`,
              chapterId: `chap-${Date.now()}-1`,
              title: 'Пролог',
              order: 1,
              content: 'Почніть писати перший розділ вашої нової книги тут...',
              wordCount: 10,
              lastModified: new Date().toISOString(),
            }
          ]
        }
      ]
    };

    setBook(newBook);
    setActiveChapterId(newBook.chapters[0]?.id || '');
    setActiveSectionId(newBook.chapters[0]?.sections[0]?.id || '');
    persistBook(newBook);

    // Write primary creation audit log
    addLogEntry(
      'Створення нової книги',
      `Створено новий проект видання: «${title}» [ID: ${bookId}, Початкова версія: ${initialVersion}]. Автор: ${author}, Роль: ${roleInfo.nameUk}.${initialNote ? ` Нотатка: ${initialNote}` : ''}`,
      'system',
      bookId,
      initialVersion,
      creatorRole
    );

    setSaveToast(`Новий проект «${title}» [ID: ${bookId}] успішно створено!`);
    setTimeout(() => setSaveToast(null), 4000);
    setCurrentTab('start');
  };

  // Відкрити книгу з раніше збереженого ZIP («Резервна копія книги») —
  // доступно ролям з дозволом canImportBook (admin/writer/translator/
  // designer/publisher; читач і гість — ні, кнопка й модалка для них не
  // рендеряться, а ImportBookModal додатково перевіряє дозвіл сама).
  const handleImportBook = (importedBook: Book, manifest: BookBackupManifest | null) => {
    setBook(importedBook);
    const firstChapter = importedBook.chapters[0];
    setActiveChapterId(firstChapter?.id || '');
    setActiveSectionId(firstChapter?.sections[0]?.id || '');
    persistBook(importedBook);

    addLogEntry(
      'Імпорт книги з ZIP',
      `Книгу «${importedBook.title}» [ID: ${importedBook.id}] відкрито з резервної копії ZIP` +
        (manifest?.exportedAt ? ` (експортовано ${new Date(manifest.exportedAt).toLocaleString('uk-UA')})` : '') +
        `. Глав: ${importedBook.chapters.length}.`,
      'system',
      importedBook.id,
      importedBook.version
    );

    setSaveToast(`Книгу «${importedBook.title}» успішно відкрито з ZIP!`);
    setTimeout(() => setSaveToast(null), 4000);
    setCurrentTab(importedBook.chapters.length > 0 ? 'editor' : 'start');
  };

  // Зберегти повну резервну копію поточної книги (ZIP) — пара до
  // handleImportBook, та сама роль-перевірка canImportBook.
  const handleExportBackup = async () => {
    try {
      await exportBookToBackupZip(book);
      addLogEntry(
        'Експорт резервної копії',
        `Створено повну резервну копію книги «${book.title}» [ID: ${book.id}, ${book.version}] у форматі ZIP (book.json).`,
        'export'
      );
      setSaveToast('Резервну копію книги збережено (ZIP)!');
      setTimeout(() => setSaveToast(null), 3500);
    } catch (err) {
      console.error('[bookBackup] Не вдалося створити резервну копію', err);
      setSaveToast('Не вдалося створити резервну копію книги.');
      setTimeout(() => setSaveToast(null), 3500);
    }
  };

  // Онбординг-візард («Перенесення книги з іншого сервісу») зі стартової
  // сторінки: письменник, який уже писав книгу деінде, приносить сирий
  // текст, зображення для «Альбому письменника» та (опційно) 3D-моделі
  // курсу. На виході — новий проект книги, наповнений цими матеріалами;
  // текст можна далі розкласти на розділи вручну в редакторі.
  const handleImportMaterials = (result: {
    title: string;
    author: string;
    chapters: Book['chapters'];
    illustrations: Book['illustrations'];
    courseMaterials: NonNullable<Book['course']>['materials'];
    hasCourse: boolean;
  }) => {
    const bookId = result.chapters[0]?.bookId || `BK-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date().toISOString();

    const newBook: Book = {
      ...initialBookData,
      id: bookId,
      title: result.title,
      author: result.author,
      version: 'v1.0.0',
      revisionNumber: 1,
      createdAt: now,
      updatedAt: now,
      versionHistory: [],
      chapters: result.chapters.length > 0 ? result.chapters : initialBookData.chapters,
      illustrations: result.illustrations,
      course: result.hasCourse
        ? {
            enabled: true,
            title: `${result.title} — курс`,
            tags: [],
            materials: result.courseMaterials || [],
          }
        : undefined,
    };

    setBook(newBook);
    setActiveChapterId(newBook.chapters[0]?.id || '');
    setActiveSectionId(newBook.chapters[0]?.sections[0]?.id || '');
    persistBook(newBook);

    addLogEntry(
      'Перенесення матеріалів з іншого сервісу',
      `Створено новий проект «${result.title}» з майстра перенесення: ` +
        `глав — ${newBook.chapters.length}, зображень в альбомі — ${(result.illustrations || []).length}, ` +
        `3D-моделей курсу — ${result.hasCourse ? (result.courseMaterials || []).length : 0}.`,
      'system',
      bookId,
      'v1.0.0'
    );

    setSaveToast(`Книгу «${result.title}» успішно перенесено!`);
    setTimeout(() => setSaveToast(null), 4000);
    setCurrentTab('editor');
  };

  // Manual save trigger
  const handleManualSave = async () => {
    // Скасовуємо заплановане автозбереження — зараз збережемо примусово.
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    setIsSaving(true);
    const ok = await persistBook(book);
    setIsSaving(false);

    if (ok) {
      addLogEntry(
        'Збереження проекту',
        `Усі поточні зміни книги «${book.title}» [ID: ${book.id || 'BK-2084-CYBER'}, ${book.version || 'v1.0.0'}] успішно збережено в сховище (Слів: ${totalWords}, Глави: ${book.chapters.length}).`,
        'system'
      );
      setSaveToast('Всі зміни книги успішно збережено!');
      setTimeout(() => setSaveToast(null), 2500);
    }
  };

  // Перемикання вкладок. Окремого попередження більше не потрібно:
  // зміни зберігаються автоматично, а стан видно в шапці постійно.
  const handleSelectTab = (targetTab: NavigationTab) => {
    if (targetTab === currentTab) return;
    setCurrentTab(targetTab);
  };

  // Jump from Scenario/Dossier directly to section in Editor
  const handleNavigateToSection = (chapterId: string, sectionId: string) => {
    setActiveChapterId(chapterId);
    setActiveSectionId(sectionId);
    handleSelectTab('editor');
  };

  /**
   * «Передати текст у книгу» з AI-чату (QuickAiModal.tsx): дописує текст у
   * кінець ОСТАННЬОЇ секції обраного розділу, одразу відкриває редактор на
   * цій секції (handleNavigateToSection) і виділяє щойно вставлений
   * фрагмент (pendingChatHighlight → EditorView), щоб автор одразу бачив,
   * куди саме потрапив текст, і міг продовжити роботу над ним.
   */
  const handleSendChatTextToChapter = (chapterId: string, text: string) => {
    const chapter = book.chapters.find((c) => c.id === chapterId);
    const result = appendTextToChapterEnd(book.chapters, chapterId, text);
    if (!chapter || !result) return;

    handleUpdateBook(
      { ...book, chapters: result.chapters, updatedAt: new Date().toISOString() },
      'Текст з AI-чату додано до глави',
      chapter.title
    );
    handleNavigateToSection(chapter.id, result.sectionId);
    setPendingChatHighlight({ sectionId: result.sectionId, start: result.start, end: result.end });
  };

  const handleClearLog = () => {
    setLogEntries([]);
    saveMeta(META_CHANGELOG, []).catch((e) => console.warn('[storage]', e));
  };

  const handleSelectRole = (newRole: UserRole) => {
    // Роль для книги, приєднаної через прийняте cowork-запрошення, зафіксована
    // на сервері (server/collaborationRoutes.ts) — жодна кнопка перемикача
    // ролей у клієнті не повинна дозволяти її обійти для цієї самої книги.
    if (coworkLock && coworkLock.bookId === book.id && auth.user?.role !== 'admin' && newRole !== coworkLock.role) {
      setSaveToast('Роль для цієї книги зафіксована cowork-запрошенням — самостійна зміна недоступна.');
      setTimeout(() => setSaveToast(null), 3000);
      return;
    }
    setCurrentRole(newRole);
    saveMeta(META_ROLE, newRole).catch((e) => console.warn('[storage]', e));
    const roleInfo = getRoleInfo(newRole);
    if (!canAccessTab(newRole, currentTab)) {
      setCurrentTab(getDefaultTabForRole(newRole));
    }
    setSaveToast(`Активну роль перемкнуто на «${roleInfo.nameUk}» (${roleInfo.badgeEmoji})`);
    setTimeout(() => setSaveToast(null), 3000);
    addLogEntry('Зміна активної ролі', `Користувач перемкнувся на роль «${roleInfo.nameUk}» (${roleInfo.nameEn}).`, 'system');
  };

  // Перш ніж показувати робоче середовище — пропонуємо увійти.
  // Гостьовий режим доступний, але це має бути свідомий вибір.
  if (!auth.loading && auth.isGuest && !auth.dismissedLogin) {
    return (
      <AuthScreen
        onLogin={auth.login}
        onRegister={auth.register}
        onLoginWithGoogle={auth.loginWithGoogle}
        onContinueAsGuest={auth.continueAsGuest}
        onClearError={auth.clearError}
        error={auth.error}
        firebaseEnabled={auth.firebaseEnabled}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  // Поки книга читається зі сховища — показуємо заставку, щоб користувач
  // не встиг почати правити початкові дані, які потім будуть перезаписані.
  if (isHydrating || auth.loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <div className="text-center">
          <div className="text-sm font-bold font-heading">NOVA STUDIO</div>
          <div className="text-xs text-slate-400 mt-1">Завантаження проекту…</div>
        </div>
      </div>
    );
  }

  // Прийняття cowork-запрошення за посиланням — доки токен не оброблено
  // (прийнято або відхилено користувачем), робоче середовище не показуємо.
  if (inviteToken && inviteScreenStatus !== 'done') {
    const isGuestSession = !auth.user || auth.user.isGuest;
    const emailMismatch = !isGuestSession && inviteInfo && auth.user!.email && auth.user!.email.toLowerCase() !== inviteInfo.inviteeEmail.toLowerCase();
    const roleLabels: Record<string, string> = {
      designer: t('inviteAccept.roleDesigner'),
      publisher: t('inviteAccept.rolePublisher'),
      translator: t('inviteAccept.roleTranslator'),
    };

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-5 p-6">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl p-6 space-y-5 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">{t('inviteAccept.heading')}</h2>
            <p className="text-xs text-slate-400 mt-1">{t('inviteAccept.subheading')}</p>
          </div>

          {inviteScreenStatus === 'loading' && (
            <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('inviteAccept.loadingLabel')}</span>
            </div>
          )}

          {inviteScreenStatus === 'error' && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{inviteScreenError}</span>
            </div>
          )}

          {(inviteScreenStatus === 'ready' || inviteScreenStatus === 'accepting') && inviteInfo && (
            <>
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 text-left space-y-1.5">
                <div className="text-xs text-slate-400">{t('inviteAccept.bookLabel')}</div>
                <div className="text-sm font-bold text-slate-100">{inviteInfo.bookTitle}</div>
                <div className="text-xs text-slate-400 mt-2">{t('inviteAccept.roleLabel')}</div>
                <div className="text-sm font-bold text-amber-300">{roleLabels[inviteInfo.role] || inviteInfo.role}</div>
              </div>

              {inviteInfo.status !== 'pending' ? (
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-300 text-xs">
                  {inviteInfo.status === 'accepted' ? t('inviteAccept.alreadyAccepted') : t('inviteAccept.revoked')}
                </div>
              ) : isGuestSession ? (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-300">
                    {t('inviteAccept.guestPrompt', { email: inviteInfo.inviteeEmail })}
                  </p>
                  <button
                    onClick={() => {
                      auth.clearError();
                      localStorage.removeItem('nova_guest_dismissed_login');
                      window.location.reload();
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-all"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>{t('inviteAccept.loginBtn')}</span>
                  </button>
                </div>
              ) : emailMismatch ? (
                <div className="space-y-2.5">
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-200 text-xs">
                    {t('inviteAccept.emailMismatch', { invited: inviteInfo.inviteeEmail, current: auth.user?.email || '' })}
                  </div>
                  <button
                    onClick={() => auth.logout()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all border border-slate-700"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t('inviteAccept.logoutBtn')}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAcceptInvite}
                  disabled={inviteScreenStatus === 'accepting'}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-xs transition-all"
                >
                  {inviteScreenStatus === 'accepting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                  <span>{inviteScreenStatus === 'accepting' ? t('inviteAccept.accepting') : t('inviteAccept.acceptBtn')}</span>
                </button>
              )}

              {inviteScreenError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-200 text-[11px]">
                  {inviteScreenError}
                </div>
              )}
            </>
          )}

          <button
            onClick={() => { setInviteToken(null); setInviteScreenStatus('idle'); }}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            {t('inviteAccept.skipLink')}
          </button>
        </div>
      </div>
    );
  }

  // Роль для цієї книги зафіксована прийнятим cowork-запрошенням — перемикач
  // ролей вимикається в усьому інтерфейсі (адміністратор — виняток, він
  // завжди має власні права письменника незалежно від запрошень).
  const isRoleLocked = !!coworkLock && coworkLock.bookId === book.id && auth.user?.role !== 'admin';

  return (
    <SunLightingProvider theme={theme}>
      <WriterBookProvider book={book}>
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-400/20 selection:text-amber-200 relative">

      {/* Сонечко на сторінках студії: динамічне освітлення + перетягуване
          3D-сонце. У світлій темі дає тіні, у темній — сяйво
          (див. SunLightingContext).

          Ховається, поки відкритий майстер створення книги: там людина
          заповнює форму по кроках, і рухома підсвітка поверх полів — це
          відволікання рівно в той момент, коли потрібна зосередженість.
          Аура поверхонь (SunAuraManager) лишається — вона статична й
          нічого не перекриває. */}
      {!isCreateBookModalOpen && currentTab !== 'express' && (
        <>
          <SunAmbientOverlay />
          <DraggableSun
            onScreenshotForAi={(file) => {
              setPendingSunScreenshot(file);
              setIsQuickAiOpen(true);
            }}
          />
        </>
      )}
      <SunAuraManager />

      {/* Top Header Navigation */}
      <HeaderNav
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        authUser={auth.user}
        onLogout={auth.logout}
        onShowLogin={() => { auth.clearError(); localStorage.removeItem('nova_guest_dismissed_login'); window.location.reload(); }}
        theme={theme}
        onToggleTheme={toggleTheme}
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        book={book}
        totalWords={totalWords}
        totalPages={totalPages}
        isSaving={isSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        currentRole={currentRole}
        onSelectRole={handleSelectRole}
        onOpenRoleModal={() => setIsRoleModalOpen(true)}
        roleLocked={isRoleLocked}
        onOpenVersionModal={() => setIsVersionModalOpen(true)}
        onSave={handleManualSave}
        onOpenSettings={() => setIsSettingsOpen(true)}
        collaborators={collaborators}
        syncStatus={syncStatus}
        onOpenCollab={() => setIsCollabDrawerOpen(true)}
        unreadChatCount={chatMessages.length}
      />

      {/* Стійкий банер помилки сховища — не зникає сам, бо це втрата даних */}
      {storageError && (
        <div
          id="storage-error-banner"
          className="sticky top-0 z-50 w-full bg-rose-600 text-white px-4 py-2.5 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold shadow-lg"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 stroke-[2.5]" />
          <span>{storageError}</span>
          <button
            onClick={() => setCurrentTab('export')}
            className="px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 font-bold flex items-center gap-1.5 transition-colors"
          >
            <HardDriveDownload className="w-3.5 h-3.5" />
            Експортувати книгу у файл
          </button>
          <button
            onClick={() => handleManualSave()}
            className="px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 font-bold transition-colors"
          >
            Спробувати ще раз
          </button>
          <button
            onClick={() => setStorageError(null)}
            className="px-2 py-1 rounded-md hover:bg-white/20 transition-colors"
            aria-label="Приховати повідомлення"
          >
            ✕
          </button>
        </div>
      )}

      {/* Помилка AI-запиту — видима, а не в консолі */}
      {aiError && (
        <div
          id="ai-error-banner"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[calc(100%-3rem)] p-3.5 rounded-xl bg-rose-950/95 border border-rose-500/50 backdrop-blur-xl shadow-2xl flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-rose-200">
              {endpointLabel(aiError.endpoint)} — не вдалося
            </div>
            <div className="text-xs text-rose-100/90 mt-0.5 leading-relaxed">{aiError.message}</div>
            {aiError.kind === 'guest_restricted' && (
              <button
                onClick={() => {
                  try { localStorage.removeItem('nova_guest_dismissed_login'); } catch { /* ignore */ }
                  window.location.reload();
                }}
                className="mt-2 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold transition-colors"
              >
                Зареєструватися
              </button>
            )}
            {aiError.kind === 'quota' && !auth.isGuest && (
              <button
                onClick={() => { setAiError(null); handleSelectTab('subscription'); }}
                className="mt-2 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold transition-colors"
              >
                Переглянути тарифи
              </button>
            )}
          </div>
          <button
            onClick={() => setAiError(null)}
            className="px-1.5 rounded hover:bg-white/10 text-rose-200 shrink-0"
            aria-label="Приховати повідомлення"
          >
            ✕
          </button>
        </div>
      )}

      {/* Save Success Notification Toast */}
      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 font-semibold text-xs shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* Real-time Remote Sync Toast */}
      {/* Та сама книга відкрита автором ще десь. Показуємо це ПОСТІЙНО, поки
          друга сесія жива: саме розбіжність двох власних сесій і призводила
          до втрати тексту, і автор мав про неї знати до того, як почне
          писати, а не після. */}
      {(() => {
        const myUserId = auth.user?.id ?? '';
        const mine = otherSessionsOfSameUser(collaborators, myUserId, myClientId);
        if (mine.length === 0) return null;
        const where = mine.map((s) => s.deviceLabel || 'інший браузер').join(', ');
        return (
          <div className="fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl bg-slate-900 text-slate-100 border border-amber-500/60 shadow-xl text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Ця книга відкрита у вас ще в {mine.length === 1 ? 'одній сесії' : `${mine.length} сесіях`}: {where}.
              Правки синхронізуються, перемагає найсвіжіша версія — але надійніше працювати в одному місці.
            </span>
          </div>
        );
      })()}

      {syncToast && (
        <div className="fixed bottom-6 left-6 z-50 px-4 py-2 rounded-lg bg-slate-900 text-slate-100 border border-emerald-500/50 font-semibold text-xs shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>{syncToast}</span>
        </div>
      )}

      {/* Робоча область: бічна вертикальна навігація зліва (SidebarNav,
          зі згортанням) + контент вкладки справа. */}
      {/* Без overflow-hidden: він робив цей контейнер скрол-областю, тому
          липкий сайдбар прокручувався разом зі сторінкою. */}
      <div className="flex-1 flex">
      <SidebarNav
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        book={book}
        logCount={logEntries.length}
        currentRole={currentRole}
        onQuickAi={() => setIsQuickAiOpen(true)}
      />

      {/* Внутрішня межа помилок: падіння одного модуля не забирає з собою
          шапку й навігацію. key={currentTab} скидає межу при переході
          на іншу вкладку, тож застосунок відновлюється сам. */}
      <ErrorBoundary key={currentTab}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Експрес-майстер (Wisart Book Crealiry.md §3.4). Прокручується
            власним контейнером, бо п'ять кроків не влазять у висоту
            вкладки, а зовнішній контейнер тут із overflow-hidden. */}
        {currentTab === 'express' && (
          <div className="flex-1 overflow-y-auto">
            <ExpressWizardView
              onFinish={(payload) => {
                // Готовий план переносимо в книгу й ведемо в редактор —
                // саме це «перенесення заготовки до студії» з постановки.
                applyExpressPlan(payload);
                handleSelectTab('editor');
              }}
            />
          </div>
        )}

        {currentTab === 'start' && (
          <StartPageView
            book={book}
            onUpdateBook={handleUpdateBook}
            onStartWriting={() => handleSelectTab('editor')}
            onSaveBook={handleManualSave}
            currentRole={currentRole}
            onOpenRoleModal={() => setIsRoleModalOpen(true)}
            onSelectRole={handleSelectRole}
            onOpenVersionModal={() => setIsVersionModalOpen(true)}
            onOpenCreateBookModal={() => setIsCreateBookModalOpen(true)}
            onOpenImportBookModal={() => setIsImportBookModalOpen(true)}
            onExportBackup={handleExportBackup}
            onNavigateToTab={handleSelectTab}
            onOpenImportWizardModal={() => setIsImportWizardModalOpen(true)}
          />
        )}

        {currentTab === 'editor' && (
          <EditorView
            book={book}
            onUpdateBook={handleUpdateBook}
            activeChapterId={activeChapterId}
            activeSectionId={activeSectionId}
            onSelectSection={(cId, sId) => {
              setActiveChapterId(cId);
              setActiveSectionId(sId);
            }}
            onSaveBook={handleManualSave}
            currentRole={currentRole}
            authUserId={auth.user?.id ?? null}
            pendingHighlight={pendingChatHighlight}
            onHighlightApplied={() => setPendingChatHighlight(null)}
            onOpenPromptConstructor={(request) => {
              setPromptContext(request);
              setIsQuickAiOpen(true);
            }}
            promptGenerateTick={promptGenerateTick}
          />
        )}

        {currentTab === 'dashboard' && (
          <DashboardView
            book={book}
            authUser={auth.user}
            totalWords={totalWords}
            onNavigateToTab={handleSelectTab}
          />
        )}

        {currentTab === 'mastery' && (
          <MasteryFrameworkView
            book={book}
            onUpdateBook={handleUpdateBook}
            authUser={auth.user}
          />
        )}

        {currentTab === 'toc' && (
          <TableOfContentsView
            book={book}
            onUpdateBook={handleUpdateBook}
            onNavigateToSection={handleNavigateToSection}
            onSaveBook={handleManualSave}
          />
        )}

        {currentTab === 'qr-footnotes' && (
          <QRFootnotesView
            book={book}
            onUpdateBook={handleUpdateBook}
            onNavigateToSection={handleNavigateToSection}
            onSaveBook={handleManualSave}
          />
        )}

        {currentTab === 'scenario' && (
          <ScenarioView
            book={book}
            onUpdateBook={handleUpdateBook}
            onNavigateToSection={handleNavigateToSection}
            onSaveBook={handleManualSave}
          />
        )}

        {currentTab === 'characters' && (
          <CharactersView
            book={book}
            onUpdateBook={handleUpdateBook}
            onSaveBook={handleManualSave}
          />
        )}

        {currentTab === 'mindboard' && (
          <MindBoardView
            book={book}
            onUpdateBook={handleUpdateBook}
            currentRole={currentRole}
            onNavigateToTab={handleSelectTab}
          />
        )}

        {currentTab === 'ai-studio' && (
          <AIStudioView
            book={book}
            onUpdateBook={handleUpdateBook}
          />
        )}

        {currentTab === 'illustrations' && (
          <IllustrationsView
            book={book}
            onUpdateBook={handleUpdateBook}
          />
        )}

        {currentTab === 'layout' && (
          <LayoutView
            book={book}
            onUpdateBook={handleUpdateBook}
            totalWords={totalWords}
          />
        )}

        {currentTab === 'preview' && (
          <BookPreviewView
            book={book}
            totalWords={totalWords}
          />
        )}

        {currentTab === 'cover' && (
          <CoverDesignerView
            book={book}
            onUpdateBook={handleUpdateBook}
            totalWords={totalWords}
          />
        )}

        {currentTab === 'changelog' && (
          <ChangeLogView
            logEntries={logEntries}
            onClearLogs={handleClearLog}
            bookTitle={book.title}
            bookId={book.id}
            currentVersion={book.version}
          />
        )}

        {currentTab === 'export' && (
          <ExportView
            book={book}
            onUpdateBook={handleUpdateBook}
            totalWords={totalWords}
            authUser={auth.user}
            onGoToSubscription={() => handleSelectTab('subscription')}
          />
        )}

        {currentTab === 'media' && (
          <MediaLibraryView
            book={book}
            onUpdateBook={handleUpdateBook}
            authUser={auth.user}
          />
        )}

        {currentTab === 'admin' && auth.isAdmin && <AdminOsView authUser={auth.user} />}

        {currentTab === 'subscription' && <SubscriptionView authUser={auth.user} />}

        {currentTab === 'api-keys' && <ApiKeysView authUser={auth.user} />}

        {currentTab === 'kdp-format' && (
          <ManuscriptFormatterView authUser={auth.user} onGoToSubscription={() => handleSelectTab('subscription')} />
        )}

        {currentTab === 'courses' && (
          <CoursesView
            book={book}
            onUpdateBook={handleUpdateBook}
            onNavigateToSection={handleNavigateToSection}
            onSaveBook={handleManualSave}
            authUser={auth.user}
          />
        )}

        {currentTab === 'pdf-editor' && (
          <PdfEditorView
            book={book}
            onUpdateBook={handleUpdateBook}
            onSaveBook={handleManualSave}
          />
        )}

        {currentTab === 'knowledge' && (
          <KnowledgeView
            book={book}
            onUpdateBook={handleUpdateBook}
            authUser={auth.user}
          />
        )}

        {currentTab === 'trainers' && <TrainersView />}

        {currentTab === 'structure' && (
          <BookStructureBuilder
            book={book}
            onUpdateBook={handleUpdateBook}
            onNavigateToTab={handleSelectTab}
          />
        )}

        {currentTab === 'portfolio' && (
          <PortfolioView
            book={book}
            authUser={auth.user}
            totalWords={totalWords}
            onNavigateToTab={handleSelectTab}
          />
        )}

        {currentTab === 'publishing' && (
          <PublishingHubView
            book={book}
            authUser={auth.user}
            totalWords={totalWords}
            onNavigateToTab={handleSelectTab}
          />
        )}
      </div>
      </ErrorBoundary>
      </div>

      {/* Довідковий тур: спливаючі підказки біля ключових кнопок кожної
          вкладки для нових користувачів. Сам відстежує зміну currentTab
          і показує 3-5 підказок при першому відвідуванні вкладки. */}
      <OnboardingTour currentTab={currentTab} authUser={auth.user} />

      {/* Панель командної співпраці (чат, учасники, cowork-запрошення) */}
      <CollaborationDrawer
        isOpen={isCollabDrawerOpen}
        onClose={() => setIsCollabDrawerOpen(false)}
        book={book}
        currentRole={currentRole}
        currentTab={currentTab}
        syncStatus={syncStatus}
        collaborators={collaborators}
        chatMessages={chatMessages}
        myClientId={myClientId}
        onSendMessage={sendChatMessage}
        onReconnect={reconnectWebSockets}
        onJumpToTab={(tab) => { handleSelectTab(tab); setIsCollabDrawerOpen(false); }}
        authUser={auth.user}
      />

      {/* Version Control Snapshot & History Modal */}
      <VersionSnapshotModal
        isOpen={isVersionModalOpen}
        onClose={() => setIsVersionModalOpen(false)}
        book={book}
        currentRole={currentRole}
        totalWords={totalWords}
        totalPages={totalPages}
        onCommitVersion={handleCommitVersion}
        onRestoreVersion={handleRestoreSnapshot}
        onUpdateBookId={(newId) => handleUpdateBook({ ...book, id: newId }, 'Зміна ID книги', `Оновлено ідентифікатор книги на «${newId}».`)}
      />

      {/* Create New Book Project Modal */}
      <CreateBookModal
        isOpen={isCreateBookModalOpen}
        onClose={() => setIsCreateBookModalOpen(false)}
        currentRole={currentRole}
        onCreateBook={handleCreateNewBook}
      />

      {/* Open Book from Backup ZIP Modal */}
      <ImportBookModal
        isOpen={isImportBookModalOpen}
        onClose={() => setIsImportBookModalOpen(false)}
        currentRole={currentRole}
        onImportBook={handleImportBook}
      />

      {/* Migrate Materials from Another Service Wizard */}
      <ImportMaterialsWizardModal
        isOpen={isImportWizardModalOpen}
        onClose={() => setIsImportWizardModalOpen(false)}
        currentRole={currentRole}
        onComplete={handleImportMaterials}
      />

      {/* Book Settings Modal */}
      <BookSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        book={book}
        onUpdateBook={handleUpdateBook}
      />

      {/* Quick AI Consultant Chat Modal */}
      <QuickAiModal
        isOpen={isQuickAiOpen}
        onClose={() => {
          setIsQuickAiOpen(false);
          setPromptContext(null);
        }}
        book={book}
        authUser={auth.user}
        onSendTextToChapter={handleSendChatTextToChapter}
        pendingAttachmentFile={pendingSunScreenshot}
        onAttachmentConsumed={() => setPendingSunScreenshot(null)}
        onUpdateBook={handleUpdateBook}
        promptContext={promptContext}
        onPromptSavedAndGenerate={() => {
          setIsQuickAiOpen(false);
          setPromptContext(null);
          setPromptGenerateTick((n) => n + 1);
        }}
      />

      {/* Role Management & Access Control Modal */}
      <RoleManagementModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        currentRole={currentRole}
        onSelectRole={handleSelectRole}
        roleLocked={isRoleLocked}
      />

    </div>
      </WriterBookProvider>
    </SunLightingProvider>
  );
}
