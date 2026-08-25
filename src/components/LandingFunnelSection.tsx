import React from 'react';
import {
  Wand2,
  ImageIcon,
  LayoutTemplate,
  Users,
  GraduationCap,
  Languages,
  FileCheck2,
  FolderArchive,
  Lock,
  ArrowRight,
  Rocket,
  Feather,
  Palette,
  FileType2,
  FileArchive,
  Box,
  RefreshCcw,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { NavigationTab, UserRole } from '../types';
import { canAccessTab } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';
import Prism from './Prism';

interface LandingFunnelSectionProps {
  currentRole: UserRole;
  canImportBook: boolean;
  onNavigateToTab: (tab: NavigationTab) => void;
  onOpenImportWizard: () => void;
}

interface FeatureCardDef {
  icon: React.ElementType;
  tab: NavigationTab;
  titleKey: string;
  descKey: string;
  accent: string;
}

const FEATURE_CARDS: FeatureCardDef[] = [
  { icon: Wand2, tab: 'ai-studio', titleKey: 'aiStudio', descKey: 'aiStudioDesc', accent: 'from-indigo-500/20 to-blue-500/10 border-indigo-500/40 text-indigo-300' },
  { icon: ImageIcon, tab: 'illustrations', titleKey: 'illustrations', descKey: 'illustrationsDesc', accent: 'from-purple-500/20 to-pink-500/10 border-purple-500/40 text-purple-300' },
  { icon: LayoutTemplate, tab: 'pdf-editor', titleKey: 'pdfEditor', descKey: 'pdfEditorDesc', accent: 'from-amber-500/20 to-orange-500/10 border-amber-500/40 text-amber-300' },
  { icon: Users, tab: 'characters', titleKey: 'characters', descKey: 'charactersDesc', accent: 'from-rose-500/20 to-red-500/10 border-rose-500/40 text-rose-300' },
  { icon: GraduationCap, tab: 'courses', titleKey: 'courses', descKey: 'coursesDesc', accent: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300' },
  { icon: Languages, tab: 'editor', titleKey: 'translation', descKey: 'translationDesc', accent: 'from-cyan-500/20 to-sky-500/10 border-cyan-500/40 text-cyan-300' },
  { icon: FileCheck2, tab: 'kdp-format', titleKey: 'kdp', descKey: 'kdpDesc', accent: 'from-fuchsia-500/20 to-purple-500/10 border-fuchsia-500/40 text-fuchsia-300' },
  { icon: FolderArchive, tab: 'media', titleKey: 'media', descKey: 'mediaDesc', accent: 'from-slate-500/20 to-slate-700/10 border-slate-500/40 text-slate-300' },
];

const EXPORT_ITEMS: { icon: React.ElementType; labelKey: string }[] = [
  { icon: FileType2, labelKey: 'exportPdf' },
  { icon: FileType2, labelKey: 'exportDocx' },
  { icon: FileType2, labelKey: 'exportEpub' },
  { icon: Box, labelKey: 'exportCourseZip' },
  { icon: RefreshCcw, labelKey: 'exportBackupZip' },
  { icon: Box, labelKey: 'export3d' },
];

export const LandingFunnelSection: React.FC<LandingFunnelSectionProps> = ({
  currentRole,
  canImportBook,
  onNavigateToTab,
  onOpenImportWizard,
}) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-8 mb-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/60 via-slate-900 to-slate-950">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:flex-wrap items-stretch gap-4 sm:gap-8 p-6 sm:p-10">
          <div className="lg:flex-1 lg:min-w-[300px]">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-500/20 text-violet-200 border border-violet-500/40">
              <Sparkles className="w-3 h-3" />
              {t('landingFunnel.heroBadge')}
            </span>
            <h1 className="mt-4 text-2xl sm:text-4xl font-black text-white leading-tight max-w-2xl">
              {t('landingFunnel.heroTitle')}
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-xl">
              {t('landingFunnel.heroSubtitle')}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => onNavigateToTab('editor')}
                className="px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors flex items-center gap-2 shadow-lg shadow-violet-500/20"
              >
                <Rocket className="w-4 h-4" />
                {t('landingFunnel.heroCtaPrimary')}
              </button>
              {canImportBook && (
                <button
                  onClick={onOpenImportWizard}
                  className="px-5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-100 font-bold text-xs sm:text-sm transition-colors flex items-center gap-2 border border-slate-700"
                >
                  <UploadCloud className="w-4 h-4 text-cyan-300" />
                  {t('landingFunnel.heroCtaSecondary')}
                </button>
              )}
            </div>
          </div>
          <div className="relative w-full aspect-[4/3] lg:w-[700px] lg:h-[425px] xl:w-[860px] xl:h-[545px] 2xl:w-[1100px] 2xl:h-[725px] shrink-0">
            <Prism
              animationType="hover"
              timeScale={0.5}
              height={3.7}
              baseWidth={6.4}
              scale={1.6}
              hueShift={-0.4416}
              colorFrequency={0.75}
              noise={0}
              glow={1.2}
            />
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div>
        <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          {t('landingFunnel.featuresHeading')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURE_CARDS.map((card) => {
            const Icon = card.icon;
            const accessible = canAccessTab(currentRole, card.tab);
            return (
              <button
                key={card.tab}
                onClick={() => accessible && onNavigateToTab(card.tab)}
                disabled={!accessible}
                className={`text-left p-4 rounded-2xl border bg-gradient-to-br ${card.accent} transition-all hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed flex flex-col gap-2 h-full`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="w-5 h-5" />
                  {!accessible && <Lock className="w-3.5 h-3.5 text-slate-500" />}
                </div>
                <div className="font-bold text-slate-100 text-xs">{t(`landingFunnel.${card.titleKey}`)}</div>
                <p className="text-slate-400 text-[11px] leading-relaxed flex-1">{t(`landingFunnel.${card.descKey}`)}</p>
                {accessible && (
                  <span className="text-[10px] font-bold flex items-center gap-1 mt-1 opacity-80">
                    {t('landingFunnel.openCta')} <ArrowRight className="w-3 h-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Benefits: Writer / Designer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-indigo-500/[0.06] border border-indigo-500/25">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300">
              <Feather className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-100 text-sm">{t('landingFunnel.writerBenefitsHeading')}</h3>
          </div>
          <ul className="space-y-2 text-[11px] text-slate-300">
            {['writerBenefit1', 'writerBenefit2', 'writerBenefit3', 'writerBenefit4'].map((k) => (
              <li key={k} className="flex items-start gap-2">
                <span className="mt-1 w-1 h-1 rounded-full bg-indigo-400 shrink-0" />
                <span>{t(`landingFunnel.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-5 rounded-2xl bg-purple-500/[0.06] border border-purple-500/25">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-300">
              <Palette className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-100 text-sm">{t('landingFunnel.designerBenefitsHeading')}</h3>
          </div>
          <ul className="space-y-2 text-[11px] text-slate-300">
            {['designerBenefit1', 'designerBenefit2', 'designerBenefit3', 'designerBenefit4'].map((k) => (
              <li key={k} className="flex items-start gap-2">
                <span className="mt-1 w-1 h-1 rounded-full bg-purple-400 shrink-0" />
                <span>{t(`landingFunnel.${k}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Export results showcase */}
      <div className="p-5 rounded-2xl bg-slate-950/50 border border-white/[0.06]">
        <h3 className="font-bold text-slate-100 text-sm mb-1">{t('landingFunnel.exportHeading')}</h3>
        <p className="text-slate-500 text-[11px] mb-4">{t('landingFunnel.exportSubheading')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {EXPORT_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.labelKey}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-300"
              >
                <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-semibold">{t(`landingFunnel.${item.labelKey}`)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Migration wizard teaser */}
      {canImportBook && (
        <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-violet-500/10 border border-cyan-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shrink-0">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">{t('landingFunnel.wizardTeaserHeading')}</h3>
              <p className="text-slate-400 text-[11px] mt-1 max-w-md">{t('landingFunnel.wizardTeaserDesc')}</p>
            </div>
          </div>
          <button
            onClick={onOpenImportWizard}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors flex items-center gap-2 shadow-md"
          >
            <FileArchive className="w-3.5 h-3.5" />
            {t('landingFunnel.wizardTeaserCta')}
          </button>
        </div>
      )}
    </div>
  );
};
