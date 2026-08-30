import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Rocket,
  BookOpen,
  GraduationCap,
  ListOrdered,
  QrCode,
  Clapperboard,
  Users,
  Network,
  Sparkles,
  Palette,
  LayoutTemplate,
  Eye,
  Image as ImageIcon,
  History,
  FileDown,
  FolderArchive,
  Wand2,
  MonitorPlay,
  LayoutPanelTop,
  Library,
  Dumbbell,
  Blocks,
  Briefcase,
  ShoppingBag,
  CreditCard,
  KeyRound,
  ShieldCheck,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
} from 'lucide-react';
import { NavigationTab, Book, UserRole } from '../types';
import { canAccessTab } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';
import { GlowIntensityControl } from './GlowIntensityControl';

interface SidebarNavProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  book: Book;
  logCount?: number;
  currentRole: UserRole;
  /** Відкриває модалку AI-асистента (QuickAiModal) — кнопка живе тут, одразу під «Книга & Текст». */
  onQuickAi: () => void;
}

/** Ключ localStorage для персистентності стану згорнутого/розгорнутого сайдбара. */
const SIDEBAR_COLLAPSED_KEY = 'nova_sidebar_collapsed';
/** Ключ localStorage для стану розкритих/згорнутих груп навігації. */
const SIDEBAR_GROUPS_KEY = 'nova_sidebar_groups';

type NavItem = { id: NavigationTab; icon: React.ComponentType<{ className?: string }>; badge?: string | number };
type NavGroup = { id: string; numeral: string; labelKey: string; tabs: NavigationTab[] };

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    /* localStorage недоступний (приватний режим тощо) — використовуємо типове значення */
    return false;
  }
}

function readInitialGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    /* не критично */
  }
  return {};
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  express: Wand2,
  dashboard: LayoutDashboard,
  start: Rocket,
  editor: BookOpen,
  mastery: GraduationCap,
  toc: ListOrdered,
  'qr-footnotes': QrCode,
  scenario: Clapperboard,
  characters: Users,
  mindboard: Network,
  'ai-studio': Sparkles,
  illustrations: Palette,
  layout: LayoutTemplate,
  preview: Eye,
  cover: ImageIcon,
  changelog: History,
  export: FileDown,
  media: FolderArchive,
  'kdp-format': Wand2,
  courses: MonitorPlay,
  'pdf-editor': LayoutPanelTop,
  knowledge: Library,
  trainers: Dumbbell,
  structure: Blocks,
  portfolio: Briefcase,
  publishing: ShoppingBag,
  subscription: CreditCard,
  'api-keys': KeyRound,
  admin: ShieldCheck,
};

/**
 * Групи бічної навігації (дерево з розкриттям). «Верстка PDF» перенесена
 * до блоку «Дизайн». Блоки підписані римськими цифрами I–V.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'start',
    numeral: 'I',
    labelKey: 'groupStart',
    tabs: ['express', 'dashboard', 'start', 'editor', 'toc', 'qr-footnotes', 'scenario', 'characters', 'mindboard', 'ai-studio'],
  },
  {
    id: 'design',
    numeral: 'II',
    labelKey: 'groupDesign',
    tabs: ['illustrations', 'layout', 'pdf-editor', 'preview', 'cover', 'changelog'],
  },
  {
    id: 'export',
    numeral: 'III',
    labelKey: 'groupExport',
    tabs: ['export', 'media', 'kdp-format', 'publishing'],
  },
  {
    id: 'courses',
    numeral: 'IV',
    labelKey: 'groupCourses',
    tabs: ['courses'],
  },
  {
    id: 'training',
    numeral: 'V',
    labelKey: 'groupTraining',
    tabs: ['mastery', 'knowledge', 'trainers', 'structure', 'portfolio'],
  },
];

/** Службові вкладки поза групами (підписка, ключі API, адмінпанель). */
const OTHER_TABS: NavigationTab[] = ['subscription', 'api-keys', 'admin'];

function isGroupOpen(state: Record<string, boolean>, groupId: string): boolean {
  // За замовчуванням групи розкриті, поки користувач явно не згорнув.
  return state[groupId] !== false;
}

/**
 * Вертикальна бічна навігація (замінює горизонтальний рядок вкладок у
 * HeaderNav). Список вкладок фільтрується правами поточної ролі та може
 * згортатись до вузької панелі лише з іконками — стан зберігається в
 * localStorage, як і тема (useTheme.ts).
 */
export const SidebarNav: React.FC<SidebarNavProps> = ({
  currentTab,
  onSelectTab,
  book,
  logCount = 0,
  currentRole,
  onQuickAi,
}) => {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(readInitialGroups);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* не критично */
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [groupId]: !isGroupOpen(prev, groupId) };
      try {
        localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* не критично */
      }
      return next;
    });
  }, []);

  // При зміні вкладки автоматично розкриваємо групу активної вкладки,
  // щоб активний пункт завжди був видимим.
  useEffect(() => {
    setOpenGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const group of NAV_GROUPS) {
        if (group.tabs.includes(currentTab) && !isGroupOpen(prev, group.id)) {
          next[group.id] = true;
          changed = true;
        }
      }
      if (!changed) return prev;
      try {
        localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* не критично */
      }
      return next;
    });
  }, [currentTab]);

  const visibleBadges: Partial<Record<NavigationTab, number>> = {
    characters: book.characters.length,
    changelog: logCount,
  };

  const toNavItem = (tab: NavigationTab): NavItem => ({
    id: tab,
    icon: ICONS[tab] || Sparkles,
    badge: visibleBadges[tab],
  });

  const renderTab = (tab: NavigationTab, item: NavItem) => {
    const Icon = item.icon;
    const isActive = currentTab === tab;
    return (
      <button
        key={tab}
        id={`nav-tab-${tab}`}
        onClick={() => onSelectTab(tab)}
        title={t(`header.nav.${tab}`)}
        className={`w-full flex items-center gap-2.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-all px-3 ${
          isActive
            ? 'badge-glass text-amber-400 font-bold shadow-[0_0_14px_-6px_rgba(245,158,11,0.5)]'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
        <span className="flex-1 min-w-0 text-left truncate">{t(`header.nav.${tab}`)}</span>
        {item.badge !== undefined && item.badge !== null && (
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none shrink-0 ${
              isActive ? 'bg-amber-400/20 text-amber-300' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const renderTabCollapsed = (tab: NavigationTab, item: NavItem) => {
    const Icon = item.icon;
    const isActive = currentTab === tab;
    return (
      <button
        key={tab}
        id={`nav-tab-${tab}`}
        onClick={() => onSelectTab(tab)}
        title={t(`header.nav.${tab}`)}
        className={`w-full flex items-center justify-center py-2 rounded-lg transition-all ${
          isActive
            ? 'badge-glass text-amber-400 shadow-[0_0_14px_-6px_rgba(245,158,11,0.5)]'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
        }`}
      >
        <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
      </button>
    );
  };

  /**
   * Кнопка AI-асистента (QuickAiModal) — не вкладка, а модалка, тож не входить
   * у NAV_GROUPS/OTHER_TABS і рендериться окремо одразу під «Книга & Текст».
   */
  const renderQuickAi = () => (
    <button
      key="quick-ai"
      id="quick-ai-btn"
      onClick={onQuickAi}
      title={t('header.quickAiTitle')}
      className="w-full flex items-center gap-2.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-all px-3 text-slate-400 hover:text-amber-300 hover:bg-white/[0.04]"
    >
      <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
      <span className="flex-1 min-w-0 text-left truncate">{t('header.quickAi')}</span>
    </button>
  );

  const renderQuickAiCollapsed = () => (
    <button
      key="quick-ai"
      id="quick-ai-btn"
      onClick={onQuickAi}
      title={t('header.quickAiTitle')}
      className="w-full flex items-center justify-center py-2 rounded-lg transition-all text-slate-400 hover:text-amber-300 hover:bg-white/[0.04]"
    >
      <Sparkles className="w-4 h-4 text-amber-400" />
    </button>
  );

  return (
    <aside
      className={`sticky top-[var(--app-header-h)] shrink-0 flex flex-col h-[var(--app-sidebar-h)] bg-slate-950/75 border-r border-white/[0.06] backdrop-blur-2xl transition-[width] duration-200 ease-out ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <nav className="flex-1 overflow-y-auto no-scrollbar py-2 px-2 space-y-1">
        {NAV_GROUPS.map((group) => {
          const allowed = group.tabs.filter((tab) => canAccessTab(currentRole, tab));
          if (allowed.length === 0) return null;
          const isOpen = isGroupOpen(openGroups, group.id);

          return (
            <div key={group.id} className="space-y-0.5">
              {/* Заголовок групи — римська цифра + назва + стрілка розкриття */}
              <button
                onClick={() => toggleGroup(group.id)}
                title={t(`header.group.${group.id}`)}
                className={`w-full flex items-center gap-1.5 rounded-lg transition-all ${
                  collapsed ? 'justify-center py-1.5' : 'px-2 py-1.5 hover:bg-white/[0.04]'
                }`}
              >
                {!collapsed && (
                  <ChevronDown
                    className={`w-3 h-3 text-slate-500 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  />
                )}
                <span className="text-[9px] font-bold font-mono text-amber-400/70 leading-none">{group.numeral}</span>
                {!collapsed && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">
                    {t(`header.group.${group.id}`)}
                  </span>
                )}
              </button>

              {isOpen &&
                allowed.map((tab) => (
                  <React.Fragment key={tab}>
                    {collapsed ? renderTabCollapsed(tab, toNavItem(tab)) : renderTab(tab, toNavItem(tab))}
                    {group.id === 'start' && tab === 'editor' && currentRole !== 'reader' && (
                      collapsed ? renderQuickAiCollapsed() : renderQuickAi()
                    )}
                  </React.Fragment>
                ))}
            </div>
          );
        })}

        {/* Службові вкладки поза групами */}
        {OTHER_TABS.some((tab) => canAccessTab(currentRole, tab)) && (
          <div className="pt-1 mt-1 border-t border-white/[0.06] space-y-0.5">
            {OTHER_TABS.filter((tab) => canAccessTab(currentRole, tab)).map((tab) =>
              collapsed ? renderTabCollapsed(tab, toNavItem(tab)) : renderTab(tab, toNavItem(tab))
            )}
          </div>
        )}
      </nav>

      {/* Керування сяйвом і аурою сонця.
          Стоїть у сайдбарі, а не в шапці й не плаваючою панеллю в кутку:
          у шапці воно тіснилось між кнопками, з якими не має спільного, а
          в кутку перекривало контент. Тут воно частина навігації, у її
          ширині, і доступне з будь-якої вкладки.
          У згорнутому стані (64px) ховаємо цілком — три повзунки в таку
          ширину не поміщаються, а обрізані виглядали б поламаними. */}
      {!collapsed && (
        <div className="border-t border-white/[0.06] px-2 pt-2">
          <GlowIntensityControl />
        </div>
      )}

      {/* Перемикач згортання/розгортання сайдбара */}
      <div className="border-t border-white/[0.06] p-2">
        <button
          id="sidebar-collapse-toggle"
          onClick={toggleCollapsed}
          className={`w-full flex items-center gap-2 py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] text-xs font-semibold transition-all ${
            collapsed ? 'justify-center px-0' : 'px-3'
          }`}
          title={collapsed ? t('header.sidebarExpand') : t('header.sidebarCollapse')}
          aria-label={collapsed ? t('header.sidebarExpand') : t('header.sidebarCollapse')}
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          {!collapsed && <span>{t('header.sidebarCollapse')}</span>}
        </button>
      </div>
    </aside>
  );
};
