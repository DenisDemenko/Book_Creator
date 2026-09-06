import React, { useState, useRef, useEffect } from 'react';
import {
  Eye,
  Save,
  ShieldCheck,
  ChevronDown,
  Lock,
  Check,
  Sliders,
  GitCommit,
  Copy,
  Fingerprint,
  MessageSquare,
  Radio,
  Loader2,
  CloudOff,
  Cloud,
  LogOut,
  LogIn,
  UserCircle2,
  Sun,
  Moon,
  CreditCard,
  Languages,
  Blocks,
  History,
} from 'lucide-react';
import { NavigationTab, Book, UserRole, CollaboratorPresence, RealtimeSyncStatus, AuthUser } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';
import { useSunLighting } from '../context/SunLightingContext';
import fusionLabLogo from '../assets/fusion-lab-studio-logo.png';

interface HeaderNavProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  book: Book;
  totalWords: number;
  totalPages: number;
  isSaving: boolean;
  hasUnsavedChanges?: boolean;
  currentRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  onOpenRoleModal: () => void;
  onOpenVersionModal?: () => void;
  onSave: () => void;
  onOpenSettings: () => void;
  collaborators?: CollaboratorPresence[];
  syncStatus?: RealtimeSyncStatus;
  onOpenCollab?: () => void;
  unreadChatCount?: number;
  /** Стан персистентності книги у сховищі браузера. */
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  /** ISO-час останнього успішного запису. */
  lastSavedAt?: string | null;
  /** Поточний користувач сесії (або гість). */
  authUser?: AuthUser | null;
  onLogout?: () => void;
  onShowLogin?: () => void;
  /** Поточна тема інтерфейсу та перемикач (useTheme). */
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  /** Роль зафіксована прийнятим cowork-запрошенням для цієї книги — перемикач ролей вимкнено. */
  roleLocked?: boolean;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({
  currentTab,
  onSelectTab,
  book,
  totalWords,
  totalPages,
  isSaving,
  hasUnsavedChanges = false,
  currentRole,
  onSelectRole,
  onOpenRoleModal,
  onOpenVersionModal,
  onSave,
  onOpenSettings,
  collaborators = [],
  syncStatus = 'connected',
  onOpenCollab,
  unreadChatCount = 0,
  saveState = 'idle',
  lastSavedAt = null,
  authUser = null,
  onLogout,
  onShowLogin,
  theme = 'dark',
  onToggleTheme,
  roleLocked = false,
}) => {
  const { lang, toggleLang, t } = useLanguage();
  const { selectedColor } = useSunLighting();
  // Акцент тулбара = колір «Сонечка», обраний у палітрі на канві (12 кольорів).
  // CSS-змінні використовуються для кнопок і надписів; працює і в темній, і в світлій темі.
  const sunVars = {
    '--sun-acc': selectedColor.secondary,
    '--sun-soft': selectedColor.highlight,
    '--sun-acc-10': `${selectedColor.secondary}1A`,
    '--sun-acc-15': `${selectedColor.secondary}26`,
    '--sun-acc-20': `${selectedColor.secondary}33`,
    '--sun-acc-25': `${selectedColor.secondary}40`,
    '--sun-acc-30': `${selectedColor.secondary}4D`,
    '--sun-acc-40': `${selectedColor.secondary}66`,
    '--sun-acc-70': `${selectedColor.secondary}B3`,
    '--sun-acc-80': `${selectedColor.secondary}CC`,
  } as React.CSSProperties;
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState<boolean>(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState<boolean>(false);
  const [isPluginsOpen, setIsPluginsOpen] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const pluginsRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';

  const activeRoleInfo = getRoleInfo(currentRole);
  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);

  const handleCopyId = () => {
    navigator.clipboard.writeText(book.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Close role dropdown when clicked outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsRoleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Те саме для меню користувача
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Те саме для меню плагінів
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (pluginsRef.current && !pluginsRef.current.contains(event.target as Node)) {
        setIsPluginsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Постійний індикатор стану збереження замість зникомого тоста.
  const savedTimeLabel = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : null;

  const saveIndicator = (() => {
    if (saveState === 'saving') {
      return {
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
        text: t('header.indicatorSaving'),
        cls: '[color:var(--sun-acc)]',
        title: t('header.indicatorSavingTitle'),
      };
    }
    if (saveState === 'error') {
      return {
        icon: <CloudOff className="w-3 h-3" />,
        text: t('header.indicatorError'),
        cls: 'text-rose-300',
        title: t('header.indicatorErrorTitle'),
      };
    }
    if (hasUnsavedChanges) {
      return {
        icon: <span className="w-1.5 h-1.5 rounded-full [background-color:var(--sun-acc)]" />,
        text: t('header.indicatorUnsaved'),
        cls: '[color:var(--sun-acc)]',
        title: t('header.indicatorUnsavedTitle'),
      };
    }
    if (savedTimeLabel) {
      return {
        icon: <Cloud className="w-3 h-3" />,
        text: t('header.indicatorSaved', { time: savedTimeLabel }),
        cls: '[color:var(--sun-acc)]',
        title: t('header.indicatorSavedTitle'),
      };
    }
    return null;
  })();

  return (
    <header
      className="sticky top-0 z-40 w-full min-h-[var(--app-header-h)] bg-slate-950/75 border-b border-white/[0.06] backdrop-blur-2xl"
      style={sunVars}
    >
      <div className="max-w-[1780px] mx-auto px-4 sm:px-6 py-2 flex flex-col gap-2">
        {/* Ряд 1 — інформаційні блоки (неклікабельні) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Brand & Book Title */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSelectTab('start')}
              className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/[0.06] transition-all focus:outline-hidden"
              title={t('header.goToStart')}
            >
              <img src={fusionLabLogo} alt="" className="w-8 h-8 object-contain" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest [color:var(--sun-acc)] uppercase font-mono">
                  FUSION LAB STUDIO
                </span>
                <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-700" />
                <span className="hidden sm:inline text-[11px] font-medium [color:var(--sun-acc-70)]">
                  {t('header.brandSubtitle')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold [color:var(--sun-soft)] truncate max-w-[180px] sm:max-w-[260px]">
                  {book.title || t('header.untitledBook')}
                </h1>
                <span className="text-xs text-slate-600">/</span>
                <span className="text-xs [color:var(--sun-acc-80)] truncate max-w-[120px]">
                  {book.author}
                </span>
              </div>
            </div>
          </div>

          {/* Info chips: збереження, ID, слова, формат/сторінки */}
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {saveIndicator && (
              <div
                id="save-state-indicator"
                className={`px-2.5 py-1 rounded-lg badge-glass text-[11px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${saveIndicator.cls}`}
                title={saveIndicator.title}
                aria-live="polite"
              >
                {saveIndicator.icon}
                <span>{saveIndicator.text}</span>
              </div>
            )}

            {/* Book ID Pill */}
            <div className="px-2 py-1 rounded-lg badge-glass text-xs flex items-center gap-1.5 font-mono">
              <Fingerprint className="w-3 h-3 [color:var(--sun-acc)]" />
              <span className="[color:var(--sun-acc)] font-bold">{book.id || 'BK-2084-CYBER'}</span>
              <button
                onClick={handleCopyId}
                className="p-0.5 rounded hover:bg-white/10 [color:var(--sun-acc-70)] hover:[color:var(--sun-soft)] transition-colors"
                title={t('header.copyBookId')}
              >
                {copiedId ? <Check className="w-3 h-3 [color:var(--sun-acc)]" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>

            <div className="px-2.5 py-1 rounded-lg badge-glass text-xs flex items-center gap-1.5">
              <span className="[color:var(--sun-acc-80)]">{t('header.wordsLabel')}</span>
              <span className="font-semibold [color:var(--sun-soft)] font-mono">{totalWords.toLocaleString(locale)}</span>
            </div>

            <div className="px-2.5 py-1 rounded-lg badge-glass text-xs flex items-center gap-1.5">
              <span className="[color:var(--sun-acc-80)]">{t('header.formatLabel')}</span>
              <span className="font-semibold [color:var(--sun-acc)]">{book.layoutConfig.formatPreset}</span>
              <span className="[color:var(--sun-acc-70)]">{t('header.pagesShort', { n: totalPages })}</span>
            </div>
          </div>
        </div>

        {/* Ряд 2 — клікабельні кнопки */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary Save Button */}
            {currentRole !== 'reader' ? (
              <button
                id="save-book-btn"
                onClick={onSave}
                disabled={isSaving}
                className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                  hasUnsavedChanges
                    ? '[background-color:var(--sun-acc-15)] hover:[background-color:var(--sun-acc-25)] border [border-color:var(--sun-acc-40)] [color:var(--sun-acc)]'
                    : 'badge-glass [color:var(--sun-soft)]'
                }`}
                title={t('header.saveTitle')}
              >
                <Save className={`w-3.5 h-3.5 ${hasUnsavedChanges ? '[color:var(--sun-acc)]' : '[color:var(--sun-acc-70)]'}`} />
                <span>{isSaving ? t('header.saving') : hasUnsavedChanges ? t('header.saveWithChanges') : t('header.save')}</span>
              </button>
            ) : (
              <div className="px-2.5 py-1 rounded-lg [background-color:var(--sun-acc-10)] border [border-color:var(--sun-acc-30)] [color:var(--sun-acc)] text-xs flex items-center justify-center gap-1.5 font-medium">
                <Eye className="w-3.5 h-3.5" />
                <span>{t('header.readOnly')}</span>
              </div>
            )}

            {/* Плагіни — розкривний список функцій із емблемами */}
            <div className="relative" ref={pluginsRef}>
              <button
                id="plugins-btn"
                onClick={() => setIsPluginsOpen(!isPluginsOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl badge-glass hover:[border-color:var(--sun-acc-40)] [color:var(--sun-acc)] text-xs font-bold transition-all"
                title={t('header.pluginsTitle')}
              >
                <Blocks className="w-3.5 h-3.5 [color:var(--sun-acc)]" />
                <span>{t('header.pluginsBtn')}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isPluginsOpen ? 'rotate-180' : ''}`} />
              </button>

              {isPluginsOpen && (
                <div className="absolute left-0 mt-2 w-80 rounded-2xl glass-panel-elevated shadow-2xl z-50 p-2 text-xs animate-in fade-in zoom-in-95">
                  <div className="px-3 py-2 border-b border-white/[0.06] mb-1.5">
                    <span className="text-[10px] font-bold [color:var(--sun-acc)] uppercase tracking-wider">
                      {t('header.pluginsTitle')}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <button
                      onClick={() => { setIsPluginsOpen(false); onOpenVersionModal?.(); }}
                      className="w-full p-2 rounded-xl text-left transition-all flex items-center gap-2.5 hover:bg-white/[0.06]"
                    >
                      <GitCommit className="w-4 h-4 [color:var(--sun-acc)] shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold [color:var(--sun-soft)] leading-tight">
                          {t('header.pluginVersionCtrl')}
                        </span>
                        <span className="block text-[10px] [color:var(--sun-acc-70)] font-mono">
                          {book.version || 'v1.0.0'} · rev #{book.revisionNumber || 1}
                        </span>
                      </span>
                    </button>

                    {onOpenCollab && (
                      <button
                        onClick={() => { setIsPluginsOpen(false); onOpenCollab(); }}
                        className="w-full p-2 rounded-xl text-left transition-all flex items-center gap-2.5 hover:bg-white/[0.06]"
                      >
                        <Radio className="w-4 h-4 [color:var(--sun-acc)] shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold [color:var(--sun-soft)] leading-tight">
                            {t('header.pluginCollab')}
                          </span>
                          <span className="block text-[10px] [color:var(--sun-acc-70)] font-mono">
                            {t('header.online', { n: collaborators.length })}
                          </span>
                        </span>
                      </button>
                    )}

                    <button
                      onClick={() => { setIsPluginsOpen(false); onSelectTab('changelog'); }}
                      className="w-full p-2 rounded-xl text-left transition-all flex items-center gap-2.5 hover:bg-white/[0.06]"
                    >
                      <History className="w-4 h-4 [color:var(--sun-acc)] shrink-0" />
                      <span className="block font-semibold [color:var(--sun-soft)] leading-tight">
                        {t('header.pluginChangelog')}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Live Collaboration Button */}
            {onOpenCollab && (
              <button
                id="collab-team-drawer-btn"
                onClick={onOpenCollab}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all active:scale-95 ${
                  syncStatus === 'connected'
                    ? 'badge-glass hover:[border-color:var(--sun-acc-40)] [color:var(--sun-soft)]'
                    : '[background-color:var(--sun-acc-10)] hover:[background-color:var(--sun-acc-20)] [border-color:var(--sun-acc-30)] [color:var(--sun-acc)]'
                }`}
                title={t('header.collabTitle')}
              >
                <div className="relative flex items-center">
                  <Radio className={`w-3.5 h-3.5 ${syncStatus === 'connected' ? '[color:var(--sun-acc)] animate-pulse' : '[color:var(--sun-acc)]'}`} />
                  <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${
                    syncStatus === 'connected' ? '[background-color:var(--sun-acc)] animate-ping' : '[background-color:var(--sun-acc)]'
                  }`} />
                </div>

                {collaborators.length > 0 ? (
                  <div className="flex items-center -space-x-1.5 overflow-hidden">
                    {collaborators.slice(0, 3).map((collab, i) => (
                      <div
                        key={collab.clientId || i}
                        className="w-5 h-5 rounded-full border border-slate-900 text-[9px] font-bold flex items-center justify-center text-white"
                        style={{ backgroundColor: collab.color || '#3b82f6' }}
                        title={`${collab.userName} (${roleName(getRoleInfo(collab.role))})`}
                      >
                        {collab.userName ? collab.userName.substring(0, 1).toUpperCase() : 'U'}
                      </div>
                    ))}
                    {collaborators.length > 3 && (
                      <div className="w-5 h-5 rounded-full border border-slate-900 bg-slate-800 text-slate-300 text-[9px] font-bold flex items-center justify-center">
                        +{collaborators.length - 3}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="hidden xl:inline text-[11px] [color:var(--sun-acc-80)]">{t('header.live')}</span>
                )}

                <span className="hidden md:inline text-[11px] font-bold [color:var(--sun-acc)] font-mono">
                  {collaborators.length > 0 ? t('header.online', { n: collaborators.length }) : t('header.live')}
                </span>

                <MessageSquare className="w-3.5 h-3.5 [color:var(--sun-acc-70)]" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Перемикач мови інтерфейсу: UA / EN */}
            <button
              id="language-toggle-btn"
              onClick={toggleLang}
              className="flex items-center justify-center gap-1 px-2 h-8 rounded-xl badge-glass hover:[border-color:var(--sun-acc-40)] [color:var(--sun-acc)] hover:[color:var(--sun-soft)] transition-all shrink-0 text-[11px] font-bold font-mono"
              title={t('header.languageSwitchTitle')}
              aria-label={t('header.languageSwitchTitle')}
            >
              <Languages className="w-4 h-4" />
              <span>{lang === 'uk' ? 'EN' : 'UA'}</span>
            </button>

            {/* Перемикач теми: темна / світла (Nova Glass) */}
            {onToggleTheme && (
              <button
                id="theme-toggle-btn"
                onClick={onToggleTheme}
                className="flex items-center justify-center w-8 h-8 rounded-xl badge-glass hover:[border-color:var(--sun-acc-40)] [color:var(--sun-acc)] hover:[color:var(--sun-soft)] transition-all shrink-0"
                title={theme === 'light' ? t('header.themeToDark') : t('header.themeToLight')}
                aria-label={t('header.toggleTheme')}
              >
                {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
            )}

            {/* Меню користувача */}
            <div className="relative" ref={userMenuRef}>
              <button
                id="user-menu-btn"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl badge-glass hover:[border-color:var(--sun-acc-40)] text-xs font-semibold [color:var(--sun-soft)] transition-all"
                title={authUser?.isGuest ? t('header.guestModeTitle') : authUser?.email || ''}
              >
                {authUser?.avatarUrl ? (
                  <img src={authUser.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <UserCircle2 className={`w-4 h-4 ${authUser?.isGuest ? 'text-slate-400' : '[color:var(--sun-acc)]'}`} />
                )}
                <span className="hidden lg:inline max-w-[110px] truncate">
                  {authUser?.name || t('header.guest')}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl glass-panel-elevated shadow-2xl z-50 p-3 text-xs animate-in fade-in zoom-in-95">
                  <div className="pb-3 border-b border-white/[0.06]">
                    <div className="font-bold text-slate-100 truncate">{authUser?.name || t('header.guest')}</div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {authUser?.isGuest ? t('header.guestNoAccount') : authUser?.email}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${activeRoleInfo.badgeColor}`}>
                        {activeRoleInfo.badgeEmoji} {roleName(activeRoleInfo)}
                      </span>
                    </div>
                  </div>

                  {authUser?.isGuest ? (
                    <>
                      <p className="py-2.5 text-[11px] text-slate-400 leading-relaxed">
                        {t('header.guestNote')}
                      </p>
                      <button
                        id="header-login-btn"
                        onClick={() => { setIsUserMenuOpen(false); onShowLogin?.(); }}
                        className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        {t('header.loginOrRegister')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        id="header-subscription-btn"
                        onClick={() => { setIsUserMenuOpen(false); onSelectTab('subscription'); }}
                        className="w-full mt-2.5 py-2 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        {t('header.subscriptionMenuItem')}
                      </button>
                      <button
                        id="header-logout-btn"
                        onClick={() => { setIsUserMenuOpen(false); onLogout?.(); }}
                        className="w-full mt-2 py-2 px-3 rounded-xl badge-glass hover:border-rose-400/40 text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        {t('header.logout')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Active Role Selector Widget */}
            <div className="relative" ref={dropdownRef}>
              <button
                id="role-switcher-btn"
                onClick={() => !roleLocked && setIsRoleDropdownOpen(!isRoleDropdownOpen)}
                disabled={roleLocked}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 shadow-sm ${
                  roleLocked ? 'opacity-70 cursor-not-allowed' : ''
                } ${activeRoleInfo.badgeColor}`}
                title={roleLocked ? t('header.roleLockedTitle') : t('header.roleSwitcherTitle')}
              >
                {roleLocked ? <Lock className="w-3.5 h-3.5" /> : <span className="text-sm">{activeRoleInfo.badgeEmoji}</span>}
                <span className="hidden md:inline">{roleName(activeRoleInfo)}</span>
                {!roleLocked && (
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isRoleDropdownOpen ? 'rotate-180' : ''}`} />
                )}
              </button>

              {/* Dropdown Menu */}
              {isRoleDropdownOpen && !roleLocked && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl glass-panel-elevated shadow-2xl z-50 p-2 text-xs animate-in fade-in zoom-in-95">
                  <div className="px-3 py-2 border-b border-white/[0.06] mb-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      {t('header.chooseRole')}
                    </span>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      {t('header.chooseRoleHint')}
                    </p>
                  </div>

                  <div className="space-y-1">
                    {ALL_ROLES.map((role) => {
                      const isCurrent = currentRole === role.id;
                      return (
                        <button
                          key={role.id}
                          onClick={() => {
                            onSelectRole(role.id);
                            setIsRoleDropdownOpen(false);
                          }}
                          className={`w-full p-2 rounded-xl text-left transition-all flex items-center justify-between ${
                            isCurrent
                              ? '[background-color:var(--sun-acc-20)] [color:var(--sun-acc)] font-bold border [border-color:var(--sun-acc-40)]'
                              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-base">{role.badgeEmoji}</span>
                            <div className="truncate">
                              <div className="font-semibold text-xs leading-tight">{roleName(role)}</div>
                              <div className="text-[10px] text-slate-400 font-mono truncate">{lang === 'en' ? role.nameUk : role.nameEn}</div>
                            </div>
                          </div>
                          {isCurrent && <Check className="w-4 h-4 [color:var(--sun-acc)] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 mt-1.5 border-t border-white/[0.06]">
                    <button
                      onClick={() => {
                        setIsRoleDropdownOpen(false);
                        onOpenRoleModal();
                      }}
                      className="w-full py-2 px-3 rounded-xl badge-glass hover:[border-color:var(--sun-acc-40)] [color:var(--sun-soft)] font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 [color:var(--sun-acc)]" />
                      <span>{t('header.rolesMatrixBtn')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Settings Modal Toggle */}
            <button
              id="book-settings-btn"
              onClick={onOpenSettings}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium [color:var(--sun-acc)] badge-glass hover:[border-color:var(--sun-acc-40)] rounded-lg transition-all"
              title={t('header.settingsTitle')}
            >
              <Sliders className="w-3.5 h-3.5 [color:var(--sun-acc)]" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
