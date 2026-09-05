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
} from 'lucide-react';
import { NavigationTab, Book, UserRole, CollaboratorPresence, RealtimeSyncStatus, AuthUser } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';
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
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState<boolean>(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
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

  // Постійний індикатор стану збереження замість зникомого тоста.
  const savedTimeLabel = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : null;

  const saveIndicator = (() => {
    if (saveState === 'saving') {
      return {
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
        text: t('header.indicatorSaving'),
        cls: 'text-slate-300',
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
        icon: <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />,
        text: t('header.indicatorUnsaved'),
        cls: 'text-amber-300',
        title: t('header.indicatorUnsavedTitle'),
      };
    }
    if (savedTimeLabel) {
      return {
        icon: <Cloud className="w-3 h-3" />,
        text: t('header.indicatorSaved', { time: savedTimeLabel }),
        cls: 'text-emerald-300',
        title: t('header.indicatorSavedTitle'),
      };
    }
    return null;
  })();

  return (
    <header className="sticky top-0 z-40 w-full min-h-[var(--app-header-h)] bg-slate-950/75 border-b border-white/[0.06] backdrop-blur-2xl">
      {/* Top Meta Bar */}
      <div className="max-w-[1780px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-4">
        {/* Brand & Book Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('start')}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/[0.06] transition-all focus:outline-hidden"
            title={t('header.goToStart')}
          >
            {/* Монограма FL Fusion Lab Studio (src/assets/fusion-lab-studio-logo.png) —
                замінює колишню амброву плашку з іконкою пера. */}
            <img src={fusionLabLogo} alt="" className="w-8 h-8 object-contain" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest text-aurora-brand uppercase font-mono">
                FUSION LAB STUDIO
              </span>
              <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-700" />
              <span className="hidden sm:inline text-[11px] font-medium text-slate-400">
                {t('header.brandSubtitle')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100 truncate max-w-[180px] sm:max-w-[260px]">
                {book.title || t('header.untitledBook')}
              </h1>
              <span className="text-xs text-slate-600">/</span>
              <span className="text-xs text-slate-400 truncate max-w-[120px]">
                {book.author}
              </span>
            </div>
          </div>
        </div>

        {/* Center Stats Chips & Book Version Badge */}
        <div className="hidden lg:flex items-center gap-2">
          {/* Блок збереження: індикатор стану зверху, кнопка «Зберегти» — під ним */}
          <div className="flex flex-col items-stretch gap-1.5">
            {/* Індикатор стану збереження */}
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

            {/* Primary Save Button — під інформацією про збереження проекту книги */}
            {currentRole !== 'reader' ? (
              <button
                id="save-book-btn"
                onClick={onSave}
                disabled={isSaving}
                className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                  hasUnsavedChanges
                    ? 'aurora-glow-amber bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950'
                    : 'badge-glass text-slate-200'
                }`}
                title={t('header.saveTitle')}
              >
                <Save className={`w-3.5 h-3.5 ${hasUnsavedChanges ? 'text-slate-950' : 'text-slate-400'}`} />
                <span>{isSaving ? t('header.saving') : hasUnsavedChanges ? t('header.saveWithChanges') : t('header.save')}</span>
              </button>
            ) : (
              <div className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center justify-center gap-1.5 font-medium">
                <Eye className="w-3.5 h-3.5" />
                <span>{t('header.readOnly')}</span>
              </div>
            )}
          </div>

          {/* Book ID Pill */}
          <div className="px-2 py-1 rounded-lg badge-glass text-xs flex items-center gap-1.5 font-mono">
            <Fingerprint className="w-3 h-3 text-cyan-400" />
            <span className="text-cyan-300 font-bold">{book.id || 'BK-2084-CYBER'}</span>
            <button
              onClick={handleCopyId}
              className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title={t('header.copyBookId')}
            >
              {copiedId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>

          {/* Version Snapshot Pill Button */}
          {onOpenVersionModal && (
            <button
              onClick={onOpenVersionModal}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold font-mono flex items-center gap-1.5 transition-all"
              title={t('header.openVersionModal')}
            >
              <GitCommit className="w-3.5 h-3.5" />
              <span>{book.version || 'v1.0.0'}</span>
              <span className="text-[10px] text-amber-400/70 font-normal">rev #{book.revisionNumber || 1}</span>
            </button>
          )}

          <div className="hidden xl:flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-lg badge-glass text-xs flex items-center gap-1.5">
              <span className="text-slate-400">{t('header.wordsLabel')}</span>
              <span className="font-semibold text-slate-100 font-mono">{totalWords.toLocaleString(locale)}</span>
            </div>

            <div className="px-2.5 py-1 rounded-lg badge-glass text-xs flex items-center gap-1.5">
              <span className="text-slate-400">{t('header.formatLabel')}</span>
              <span className="font-semibold text-amber-400">{book.layoutConfig.formatPreset}</span>
              <span className="text-slate-500">{t('header.pagesShort', { n: totalPages })}</span>
            </div>
          </div>
        </div>

        {/* Right Controls: Role Switcher & Action Buttons */}
        <div className="flex items-center gap-2 sm:gap-2.5">

          {/* Live Collaboration Button & Active Team Stack */}
          {onOpenCollab && (
            <button
              id="collab-team-drawer-btn"
              onClick={onOpenCollab}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all active:scale-95 ${
                syncStatus === 'connected'
                  ? 'badge-glass hover:border-emerald-400/40 text-slate-200'
                  : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-300'
              }`}
              title={t('header.collabTitle')}
            >
              <div className="relative flex items-center">
                <Radio className={`w-3.5 h-3.5 ${syncStatus === 'connected' ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
                <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${
                  syncStatus === 'connected' ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'
                }`} />
              </div>

              {/* Online Users Avatars Stack */}
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
                <span className="hidden xl:inline text-[11px] text-slate-400">{t('header.live')}</span>
              )}

              <span className="hidden md:inline text-[11px] font-bold text-emerald-400 font-mono">
                {collaborators.length > 0 ? t('header.online', { n: collaborators.length }) : t('header.live')}
              </span>

              <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}

          {/* Перемикач мови інтерфейсу: UA / EN */}
          <button
            id="language-toggle-btn"
            onClick={toggleLang}
            className="flex items-center justify-center gap-1 px-2 h-8 rounded-xl badge-glass hover:border-cyan-400/40 text-slate-300 hover:text-cyan-300 transition-all shrink-0 text-[11px] font-bold font-mono"
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
              className="flex items-center justify-center w-8 h-8 rounded-xl badge-glass hover:border-amber-400/40 text-slate-300 hover:text-amber-300 transition-all shrink-0"
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
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl badge-glass hover:border-slate-400/40 text-xs font-semibold text-slate-200 transition-all"
              title={authUser?.isGuest ? t('header.guestModeTitle') : authUser?.email || ''}
            >
              {authUser?.avatarUrl ? (
                <img src={authUser.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <UserCircle2 className={`w-4 h-4 ${authUser?.isGuest ? 'text-slate-400' : 'text-emerald-400'}`} />
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
                            ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
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
                        {isCurrent && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
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
                    className="w-full py-2 px-3 rounded-xl badge-glass hover:border-cyan-400/40 text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{t('header.rolesMatrixBtn')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Primary Save Button — на екранах < lg (у центрі він стоїть під індикатором) */}
          <div className="lg:hidden">
            {currentRole !== 'reader' ? (
              <button
                id="save-book-btn-mobile"
                onClick={onSave}
                disabled={isSaving}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                  hasUnsavedChanges
                    ? 'aurora-glow-amber bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950'
                    : 'badge-glass text-slate-200'
                }`}
                title={t('header.saveTitle')}
              >
                <Save className={`w-3.5 h-3.5 ${hasUnsavedChanges ? 'text-slate-950' : 'text-slate-400'}`} />
                <span className="hidden sm:inline">{isSaving ? t('header.saving') : hasUnsavedChanges ? t('header.saveWithChanges') : t('header.save')}</span>
              </button>
            ) : (
              <div className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-1.5 font-medium">
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('header.readOnly')}</span>
              </div>
            )}
          </div>

          {/* Settings Modal Toggle */}
          <button
            id="book-settings-btn"
            onClick={onOpenSettings}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 badge-glass hover:border-slate-400/30 rounded-lg transition-all"
            title={t('header.settingsTitle')}
          >
            <Sliders className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
