import React, { useState } from 'react';
import {
  Sparkles,
  BookOpen,
  Save,
  ArrowRight,
  Wand2,
  Palette,
  LayoutTemplate,
  Library,
  CheckCircle2,
  ShieldCheck,
  Crown,
  Feather,
  Globe,
  Building2,
  Users,
  Eye,
  Check,
  GitCommit,
  Fingerprint,
  Tag,
  Copy,
  BookPlus,
  History,
  FolderOpen,
  DownloadCloud
} from 'lucide-react';
import { Book, NavigationTab, PageFormatPreset, UserRole } from '../types';
import { ALL_ROLES, getRoleInfo, hasPermission } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';
import { LandingFunnelSection } from './LandingFunnelSection';

interface StartPageViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book) => void;
  onSaveBook: () => void;
  onStartWriting: () => void;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
  currentRole?: UserRole;
  onOpenRoleModal?: () => void;
  onSelectRole?: (role: UserRole) => void;
  onOpenVersionModal?: () => void;
  onOpenCreateBookModal?: () => void;
  onOpenImportBookModal?: () => void;
  onExportBackup?: () => void;
  onNavigateToTab?: (tab: NavigationTab) => void;
  onOpenImportWizardModal?: () => void;
}

export const StartPageView: React.FC<StartPageViewProps> = ({
  book,
  onUpdateBook,
  onSaveBook,
  onStartWriting,
  isSaving = false,
  hasUnsavedChanges = false,
  currentRole = 'admin',
  onOpenRoleModal,
  onSelectRole,
  onOpenVersionModal,
  onOpenCreateBookModal,
  onOpenImportBookModal,
  onExportBackup,
  onNavigateToTab,
  onOpenImportWizardModal,
}) => {
  const { lang, t } = useLanguage();
  const canImportBook = hasPermission(currentRole, 'canImportBook');
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';
  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);
  const [isGeneratingSynopsis, setIsGeneratingSynopsis] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [synopsisError, setSynopsisError] = useState<string | null>(null);

  const handleCopyBookId = () => {
    navigator.clipboard.writeText(book.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const genreOptions = [
    'Кіберпанк / Наукова фантастика',
    'Міське фентезі / Urban Fantasy',
    'Детективний нуар / Трилер',
    'Космічна опера / Sci-Fi',
    'Історичний роман',
    'Психологічна драма',
    'Антиутопія / Постапокаліпсис',
    'Містичний горор',
  ];

  const formatOptions: { id: PageFormatPreset; label: string; desc: string }[] = [
    { id: 'A5', label: 'A5 (148 × 210 мм)', desc: t('startPage.formatA5Desc') },
    { id: '6x9', label: 'Trade 6×9" (152 × 229 мм)', desc: t('startPage.format6x9Desc') },
    { id: '5.5x8.5', label: 'Digest 5.5×8.5" (140 × 216 мм)', desc: t('startPage.format55x85Desc') },
    { id: '5x8', label: 'Pocket 5×8" (127 × 203 мм)', desc: t('startPage.format5x8Desc') },
    { id: 'B5', label: 'B5 (176 × 250 мм)', desc: t('startPage.formatB5Desc') },
  ];

  // Quick Book Templates
  const applyPreset = (presetKey: string) => {
    setSelectedPreset(presetKey);
    if (presetKey === 'cyberpunk') {
      onUpdateBook({
        ...book,
        title: 'Нео-Київ 2084: Скляний світанок',
        subtitle: 'Хроніки синаптичного розлому',
        genre: 'Кіберпанк / Наукова фантастика',
        targetAudience: 'Дорослі шанувальники твердої наукової фантастики та кіберпанку',
        logline: 'Коли в Нео-Києві зникає творець першого автономного ШІ, аугментований детектив мусить розплутати змову олігархічних синдикатів перш ніж місто поглине цифровий колапс.',
        synopsis: 'Події розгортаються у 2084 році в Нео-Києві. Місто розділене на стратосферні вежі Верхнього Печерська та залиті кислотними дощами нетрі Нижні Позняки. Головний герой, Ярослав «Спектр» Коваль — колишній кібер-офіцер безпеки, наймається знайти зниклу професорку Оксану Мороз, яка відкрила протокол передачі свідомості.',
        theme: 'Межа між людиною та машиною, збереження ідентичності та свободи волі в еру тотального цифрового контролю.',
        visualBible: {
          ...book.visualBible,
          styleName: 'Cyberpunk Neon Noir',
          artStyle: 'Кинематографічний кіберпанк із неоновим освітленням (cyan & ultraviolet)',
          lighting: 'Контрастні неонові відблиски на мокрому асфальті, холодні тіні, світлодіоди',
          mood: 'Нуарний, напружений, високотехнологічний та меланхолійний',
        },
      });
    } else if (presetKey === 'fantasy') {
      onUpdateBook({
        ...book,
        title: 'Шепіт Древнього Лісу',
        subtitle: 'Книга Перша: Пробудження Рун',
        genre: 'Міське фентезі / Urban Fantasy',
        targetAudience: 'Шанувальники темного фентезі, міфології та магічного реалізму',
        logline: 'Спадкова хранителька давніх українських містичних оберегів дізнається, що під сучасним містом пробуджуються прадавні духи, які вимагають сплати забутого боргу.',
        synopsis: 'У центрі сюжету — молода етнографиня Соломія, яка знаходить у родинному маєтку на Поліссі запечатаний срібний ключ. Відкривши потаємні двері, вона вступає у контакт із духами-берегинями та магічними силами, що змагаються з таємним орденом сучасних техно-магів.',
        theme: 'Звʼязок поколінь, ціна забуття культурного коріння та пошук внутрішньої сили.',
        visualBible: {
          ...book.visualBible,
          styleName: 'Dark Cinematic Fantasy',
          artStyle: 'Атмосферний живопис олією з містичним золотим сяйвом та лісовим туманом',
          lighting: 'Тепле світло вогнищ, містичне біолюмінесцентне сяйво рун, вечірній туман',
          mood: 'Таємничий, епічний, магічний та глибоко емоційний',
        },
      });
    } else if (presetKey === 'thriller') {
      onUpdateBook({
        ...book,
        title: 'Останній Протокол',
        subtitle: 'Холодний розрахунок',
        genre: 'Детективний нуар / Трилер',
        targetAudience: 'Любителі інтелектуальних детективів та психологічних трилерів',
        logline: 'Судовий аналітик отримує зашифровані аудіозаписи з місць нерозкритих злочинів, де голос убивці повторює його власні невисловлені думки.',
        synopsis: 'Напружений детективний трилер про протистояння аналітика та загадкового серійного маніпулятора. Кожен крок розслідування веде до викриття таємниць минулого головного героя та вимагає від нього морального вибору між законом і справедливістю.',
        theme: 'Природа вини, моральний релятивізм та крихкість людської психіки під тиском травми.',
        visualBible: {
          ...book.visualBible,
          styleName: 'Nordic Clean & Monochrome',
          artStyle: 'Контрастний нуар, монохром із вибірковими червоними акцентами',
          lighting: 'Різкі тіні від жалюзі, холодне світло вуличних ліхтарів, туман',
          mood: 'Клаустрофобічний, напружений, інтелектуальний',
        },
      });
    }
  };

  // AI-Assisted Synopsis Generator / Expander
  const handleGenerateAiSynopsis = async () => {
    if (!book.title.trim()) return;
    setIsGeneratingSynopsis(true);
    setSynopsisError(null);
    try {
      const response = await fetch('/api/ai/generate-synopsis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: book.title,
          subtitle: book.subtitle,
          genre: book.genre,
          author: book.author,
          logline: book.logline,
          theme: book.theme,
          existingSynopsis: book.synopsis,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSynopsisError(data?.error || t('startPage.synopsisGenError'));
        return;
      }
      if (data.synopsis) {
        onUpdateBook({
          ...book,
          synopsis: data.synopsis,
          logline: data.logline || book.logline,
          theme: data.theme || book.theme,
        });
      }
    } catch (err) {
      console.error('Error generating synopsis:', err);
      setSynopsisError(t('startPage.serverUnavailable'));
    } finally {
      setIsGeneratingSynopsis(false);
    }
  };

  const presetCards: {
    key: 'cyberpunk' | 'fantasy' | 'thriller';
    idx: string;
    tone: string;
    category: string;
    title: string;
    desc: string;
  }[] = [
    { key: 'cyberpunk', idx: '01', tone: 'from-cyan-500/15 via-cyan-500/5 to-transparent', category: t('startPage.presetCategoryCyberpunk'), title: 'Нео-Київ 2084', desc: t('startPage.presetDescCyberpunk') },
    { key: 'fantasy', idx: '02', tone: 'from-violet-500/15 via-fuchsia-500/5 to-transparent', category: t('startPage.presetCategoryFantasy'), title: 'Шепіт Лісу', desc: t('startPage.presetDescFantasy') },
    { key: 'thriller', idx: '03', tone: 'from-rose-500/15 via-slate-500/5 to-transparent', category: t('startPage.presetCategoryThriller'), title: 'Останній Протокол', desc: t('startPage.presetDescThriller') },
  ];

  return (
    <div className="relative flex-1 overflow-y-auto bg-slate-950 text-slate-100">
      {/* Ambient glass background */}
      <div className="orb-field">
        <div className="orb orb-cyan orb-float w-[420px] h-[420px] -top-40 -left-24" />
        <div className="orb orb-violet orb-float-slow w-[380px] h-[380px] top-24 -right-32" />
        <div className="orb orb-amber orb-float-slow w-[280px] h-[280px] top-[560px] left-1/3" />
      </div>
      <div className="absolute inset-x-0 top-0 h-[560px] bg-grid-faint" />

      <div className="relative z-10 p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">

        {/* Marketing lead-funnel: capability overview, benefits, export showcase, migration wizard teaser */}
        {onNavigateToTab && (
          <LandingFunnelSection
            currentRole={currentRole}
            canImportBook={canImportBook}
            onNavigateToTab={onNavigateToTab}
            onOpenImportWizard={() => onOpenImportWizardModal?.()}
          />
        )}

        {/* Hero: Top Banner & Fast Actions */}
        <div className="relative overflow-hidden p-6 lg:p-9 rounded-3xl glass-panel-elevated">
          <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-cyan-500/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-8">
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-glass px-3 py-1.5 rounded-full text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('startPage.badgeStudio')}
                </span>
                {hasUnsavedChanges && (
                  <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    {t('startPage.badgeUnsaved')}
                  </span>
                )}
                <span className="badge-glass px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t('startPage.badgeSynced')}
                </span>
              </div>

              <h1 className="text-2xl lg:text-4xl font-bold font-heading tracking-tight text-slate-100">
                {t('startPage.headingPrefix')}<span className="text-aurora">{t('startPage.headingAurora')}</span>
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                {t('startPage.heroDesc')}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto shrink-0">
              <button
                id="save-start-page-btn"
                onClick={onSaveBook}
                disabled={isSaving}
                className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-semibold text-xs transition-all whitespace-nowrap"
              >
                <Save className="w-4 h-4 text-slate-400" />
                <span>{isSaving ? t('startPage.saving') : t('startPage.saveChanges')}</span>
              </button>

              <button
                id="start-writing-btn"
                data-tour="start__1"
                onClick={onStartWriting}
                className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs shadow-[0_0_28px_-8px_rgba(245,158,11,0.65)] transition-all whitespace-nowrap"
              >
                <span>{t('startPage.startWriting')}</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>

          {/* Stat strip */}
          <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 pt-6 border-t border-white/[0.06]">
            {[
              { icon: GitCommit, value: book.version || 'v1.0.0', label: t('startPage.statVersion') },
              { icon: History, value: String((book.versionHistory || []).length), label: t('startPage.statSnapshots') },
              { icon: Fingerprint, value: `#${book.revisionNumber || 1}`, label: t('startPage.statRevision') },
              { icon: Users, value: String(ALL_ROLES.length), label: t('startPage.statRoles') },
            ].map((stat, i) => {
              const StatIcon = stat.icon;
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg badge-glass text-cyan-300 shrink-0">
                    <StatIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-white font-mono truncate">{stat.value}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{stat.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Featured Templates — case-study style cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Library className="w-4 h-4 text-amber-400" />
              {t('startPage.templatesHeading')}
            </span>
            <span className="text-xs text-slate-500">{t('startPage.templatesHint')}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {presetCards.map((preset) => {
              const isSel = selectedPreset === preset.key;
              return (
                <button
                  key={preset.key}
                  data-tour={preset.key === 'cyberpunk' ? 'start__2' : undefined}
                  onClick={() => applyPreset(preset.key)}
                  className={`group relative text-left p-5 rounded-2xl overflow-hidden glass-panel glass-panel-hover transition-all ${
                    isSel ? 'border-amber-400/60 ring-1 ring-amber-400/30' : ''
                  }`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${preset.tone} pointer-events-none`} />
                  <div className="relative flex items-center justify-between mb-7">
                    <span className="corner-tag text-[11px] text-slate-500">{preset.idx}</span>
                    {isSel ? (
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                    ) : (
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all" />
                    )}
                  </div>
                  <div className="relative">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300/80 mb-1.5">{preset.category}</div>
                    <div className="font-bold text-sm text-white mb-1.5">{preset.title}</div>
                    <div className="text-xs text-slate-400 leading-relaxed">{preset.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Team Roles & RBAC System Overview Card */}
        <div className="relative p-5 lg:p-6 rounded-2xl glass-panel space-y-4 overflow-hidden">
          <div className="absolute -top-20 -left-20 w-56 h-56 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl badge-glass text-amber-300">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white">{t('startPage.rolesHeading')}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {t('startPage.activeRole', { role: roleName(getRoleInfo(currentRole)) })}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {t('startPage.rolesDesc')}
                </p>
              </div>
            </div>

            {onOpenRoleModal && (
              <button
                data-tour="start__3"
                onClick={onOpenRoleModal}
                className="px-3.5 py-1.5 rounded-xl badge-glass hover:border-cyan-400/40 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t('startPage.rolesMatrixBtn')}</span>
              </button>
            )}
          </div>

          {/* 6 Role Fast Selector Grid */}
          <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
            {ALL_ROLES.map((role) => {
              const isCurrent = currentRole === role.id;
              return (
                <div
                  key={role.id}
                  onClick={() => onSelectRole && onSelectRole(role.id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isCurrent
                      ? 'bg-amber-500/15 border-amber-500/50 shadow-[0_0_20px_-8px_rgba(245,158,11,0.55)]'
                      : 'bg-slate-950/40 border-white/[0.06] hover:border-white/[0.14] hover:bg-slate-900/50'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xl">{role.badgeEmoji}</span>
                      {isCurrent ? (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-xs" />
                      ) : null}
                    </div>
                    <div className="font-bold text-xs text-white leading-tight">{roleName(role)}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5 line-clamp-1">{lang === 'en' ? role.nameUk : role.nameEn}</div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-white/[0.06] text-[10px] text-slate-400">
                    {t('startPage.modulesCount', { n: role.permissions.allowedTabs.length })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Book ID, Versioning & Collaboration Snapshot Section */}
        <div className="relative p-5 lg:p-6 rounded-2xl glass-panel space-y-4 overflow-hidden">
          <div className="absolute -bottom-24 -right-16 w-60 h-60 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl badge-glass text-cyan-300">
                <GitCommit className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white">{t('startPage.versioningHeading')}</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500 text-slate-950 shadow-sm">
                    {book.version || 'v1.0.0'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono badge-glass text-slate-300">
                    {t('startPage.revisionBadge', { n: book.revisionNumber || 1 })}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('startPage.versioningDesc')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {onOpenVersionModal && (
                <button
                  id="commit-version-start-btn"
                  onClick={onOpenVersionModal}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_-8px_rgba(245,158,11,0.6)]"
                >
                  <GitCommit className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>{t('startPage.commitVersion')}</span>
                </button>
              )}

              {onOpenCreateBookModal && (
                <button
                  id="create-new-book-start-btn"
                  data-tour="start__4"
                  onClick={onOpenCreateBookModal}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                  title={t('startPage.newBookTitle')}
                >
                  <BookPlus className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('startPage.newBook')}</span>
                </button>
              )}

              {onOpenImportBookModal && canImportBook && (
                <button
                  id="import-book-zip-start-btn"
                  onClick={onOpenImportBookModal}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                  title={t('startPage.importZipTitle')}
                >
                  <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t('startPage.importZip')}</span>
                </button>
              )}

              {onExportBackup && canImportBook && (
                <button
                  id="export-book-backup-start-btn"
                  onClick={onExportBackup}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                  title={t('startPage.backupZipTitle')}
                >
                  <DownloadCloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('startPage.backupZip')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Book ID & Collaboration Details Strip */}
          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-white/[0.06] text-xs">

            {/* Unique Book ID Card */}
            <div className="p-3 rounded-xl bg-slate-950/50 border border-white/[0.06] flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider flex items-center gap-1">
                  <Fingerprint className="w-3 h-3 text-cyan-400" />
                  {t('startPage.bookIdLabel')}
                </div>
                <div className="font-mono font-bold text-cyan-300 text-xs mt-0.5 truncate">
                  {book.id || 'BK-2084-CYBER'}
                </div>
              </div>
              <button
                onClick={handleCopyBookId}
                className="p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-white/[0.06] transition-colors shrink-0 ml-2"
                title={t('startPage.copyBookId')}
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Version History Summary */}
            <div className="p-3 rounded-xl bg-slate-950/50 border border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider flex items-center gap-1">
                  <History className="w-3 h-3 text-amber-400" />
                  {t('startPage.snapshotsLabel')}
                </div>
                <div className="font-bold text-slate-100 text-xs mt-0.5">
                  {t('startPage.snapshotsCount', { n: (book.versionHistory || []).length })}
                </div>
              </div>
              {onOpenVersionModal && (
                <button
                  onClick={onOpenVersionModal}
                  className="text-[10px] text-amber-400 hover:underline font-semibold"
                >
                  {t('startPage.viewAll')}
                </button>
              )}
            </div>

            {/* Active Book Created Stamp */}
            <div className="p-3 rounded-xl bg-slate-950/50 border border-white/[0.06] flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">
                  {t('startPage.createdInSystem')}
                </div>
                <div className="font-mono text-slate-300 text-xs mt-0.5">
                  {book.createdAt ? new Date(book.createdAt).toLocaleDateString(locale) : '16.08.2026'}
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                {t('startPage.badgeSynced')}
              </span>
            </div>

          </div>

          {/* Latest 2 Version Snapshots List */}
          {book.versionHistory && book.versionHistory.length > 0 && (
            <div className="relative pt-2 space-y-2">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {t('startPage.latestSnapshots')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {book.versionHistory.slice(-2).reverse().map((snap) => {
                  const snapRole = getRoleInfo(snap.authorRole);
                  return (
                    <div
                      key={snap.id}
                      className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06] text-xs flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-amber-400 text-[11px]">{snap.versionNumber}</span>
                          <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold border ${snapRole.badgeColor}`}>
                            {snapRole.badgeEmoji} {roleName(snapRole)}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(snap.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="font-medium text-slate-200 text-xs truncate mt-0.5">{snap.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Main Two-Column Configuration Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* LEFT COLUMN: Metadata, Synopsis for AI, Logline (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">

            {/* Card 1: Core Title & Identity */}
            <div data-tour="start__5" className="p-6 rounded-2xl glass-panel space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-amber-400" />
                  {t('startPage.coreAttributes')}
                </h2>
                <button
                  onClick={onSaveBook}
                  className="px-3 py-1.5 rounded-lg badge-glass hover:border-slate-400/40 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <Save className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t('common.save')}</span>
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1.5">
                    {t('startPage.titleLabel')} <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={book.title}
                    onChange={(e) => onUpdateBook({ ...book, title: e.target.value })}
                    placeholder={t('startPage.titlePlaceholder')}
                    className="field-glow w-full p-3 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-100 font-semibold text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 font-medium block mb-1.5">{t('startPage.subtitleLabel')}</label>
                    <input
                      type="text"
                      value={book.subtitle || ''}
                      onChange={(e) => onUpdateBook({ ...book, subtitle: e.target.value })}
                      placeholder={t('startPage.subtitlePlaceholder')}
                      className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 font-medium block mb-1.5">{t('startPage.authorLabel')}</label>
                    <input
                      type="text"
                      value={book.author}
                      onChange={(e) => onUpdateBook({ ...book, author: e.target.value })}
                      placeholder={t('startPage.authorPlaceholder')}
                      className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 font-medium block mb-1.5">{t('startPage.genreLabel')}</label>
                    <select
                      value={book.genre}
                      onChange={(e) => onUpdateBook({ ...book, genre: e.target.value })}
                      className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                    >
                      {genreOptions.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 font-medium block mb-1.5">{t('startPage.audienceLabel')}</label>
                    <input
                      type="text"
                      value={book.targetAudience || ''}
                      onChange={(e) => onUpdateBook({ ...book, targetAudience: e.target.value })}
                      placeholder={t('startPage.audiencePlaceholder')}
                      className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: AI Master Synopsis */}
            <div className="p-6 rounded-2xl glass-panel space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    {t('startPage.synopsisHeading')}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t('startPage.synopsisDesc')}
                  </p>
                </div>

                <button
                  onClick={handleGenerateAiSynopsis}
                  disabled={isGeneratingSynopsis}
                  className="px-3 py-1.5 rounded-lg badge-glass hover:border-cyan-400/40 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>{isGeneratingSynopsis ? t('startPage.aiGenerating') : t('startPage.aiExpand')}</span>
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* Logline */}
                <div>
                  <label className="text-slate-300 font-semibold block mb-1.5">
                    {t('startPage.loglineLabel')}
                  </label>
                  <input
                    type="text"
                    value={book.logline}
                    onChange={(e) => onUpdateBook({ ...book, logline: e.target.value })}
                    placeholder={t('startPage.loglinePlaceholder')}
                    className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                  />
                </div>

                {/* Synopsis Textarea */}
                <div>
                  <label className="text-slate-300 font-semibold block mb-1.5">
                    {t('startPage.synopsisLabel')}
                  </label>
                  <textarea
                    rows={6}
                    value={book.synopsis}
                    onChange={(e) => onUpdateBook({ ...book, synopsis: e.target.value })}
                    placeholder={t('startPage.synopsisPlaceholder')}
                    className="field-glow w-full p-3 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200 leading-relaxed text-xs"
                  />
                </div>

                {/* Core Theme */}
                <div>
                  <label className="text-slate-300 font-semibold block mb-1.5">
                    {t('startPage.themeLabel')}
                  </label>
                  <input
                    type="text"
                    value={book.theme}
                    onChange={(e) => onUpdateBook({ ...book, theme: e.target.value })}
                    placeholder={t('startPage.themePlaceholder')}
                    className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Layout Format & Visual Bible Configuration (5 Cols) */}
          <div className="lg:col-span-5 space-y-6">

            {/* Card 3: Layout & Physical Format */}
            <div className="p-6 rounded-2xl glass-panel space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-amber-400" />
                  {t('startPage.formatHeading')}
                </h2>
                <button
                  onClick={onSaveBook}
                  className="px-3 py-1.5 rounded-lg badge-glass hover:border-slate-400/40 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <Save className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t('common.save')}</span>
                </button>
              </div>

              <div className="space-y-2 text-xs">
                {formatOptions.map((fmt) => {
                  const isSel = book.layoutConfig.formatPreset === fmt.id;
                  return (
                    <div
                      key={fmt.id}
                      onClick={() => {
                        onUpdateBook({
                          ...book,
                          layoutConfig: {
                            ...book.layoutConfig,
                            formatPreset: fmt.id,
                          },
                        });
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                        isSel
                          ? 'bg-amber-500/15 border-amber-500/50 text-white'
                          : 'bg-slate-950/40 border-white/[0.06] text-slate-300 hover:border-white/[0.16]'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-xs text-slate-200">{fmt.label}</div>
                        <div className="text-xs text-slate-400">{fmt.desc}</div>
                      </div>
                      {isSel && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Card 4: Visual Bible & Art Style */}
            <div className="p-6 rounded-2xl glass-panel space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-amber-400" />
                  {t('startPage.visualBibleHeading')}
                </h2>
                <button
                  onClick={onSaveBook}
                  className="px-3 py-1.5 rounded-lg badge-glass hover:border-slate-400/40 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <Save className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t('common.save')}</span>
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1.5">{t('startPage.artStyleLabel')}</label>
                  <input
                    type="text"
                    value={book.visualBible.artStyle}
                    onChange={(e) =>
                      onUpdateBook({
                        ...book,
                        visualBible: { ...book.visualBible, artStyle: e.target.value },
                      })
                    }
                    placeholder={t('startPage.artStylePlaceholder')}
                    className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1.5">{t('startPage.lightingLabel')}</label>
                  <input
                    type="text"
                    value={book.visualBible.lighting}
                    onChange={(e) =>
                      onUpdateBook({
                        ...book,
                        visualBible: { ...book.visualBible, lighting: e.target.value },
                      })
                    }
                    placeholder={t('startPage.lightingPlaceholder')}
                    className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1.5">{t('startPage.moodLabel')}</label>
                  <input
                    type="text"
                    value={book.visualBible.mood}
                    onChange={(e) =>
                      onUpdateBook({
                        ...book,
                        visualBible: { ...book.visualBible, mood: e.target.value },
                      })
                    }
                    placeholder={t('startPage.moodPlaceholder')}
                    className="field-glow w-full p-2.5 rounded-lg bg-slate-950/50 border border-white/[0.08] text-slate-200"
                  />
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Bottom Sticky Save Bar for Quick Accessibility */}
        <div className="sticky bottom-4 z-20 p-4 rounded-2xl glass-panel-elevated shadow-2xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_2px_rgba(245,158,11,0.6)]" />
            <span className="text-xs text-slate-300 font-medium">
              {t('startPage.stickyBookLabel')} <strong className="text-slate-100">{book.title}</strong> • {t('startPage.stickyAuthorLabel')} <strong className="text-slate-100">{book.author}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onSaveBook}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl badge-glass hover:border-slate-400/40 text-slate-200 font-semibold text-xs transition-all"
            >
              <Save className="w-4 h-4 text-slate-400" />
              <span>{isSaving ? t('startPage.saving') : t('startPage.saveChanges')}</span>
            </button>

            <button
              onClick={onStartWriting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs shadow-[0_0_24px_-8px_rgba(245,158,11,0.65)] transition-all"
            >
              <span>{t('startPage.startWritingBottom')}</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
