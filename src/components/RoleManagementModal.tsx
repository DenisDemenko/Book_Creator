import React, { useState } from 'react';
import { 
  ShieldCheck, 
  X, 
  Check, 
  Lock, 
  UserCheck, 
  Sparkles, 
  Crown, 
  Feather, 
  Palette, 
  Globe, 
  Building2, 
  BookOpen,
  Info,
  Layers,
  ArrowRight,
  Eye
} from 'lucide-react';
import { UserRole, RoleInfo, RolePermission } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  /** Роль зафіксована прийнятим cowork-запрошенням для цієї книги — перемикання вимкнено. */
  roleLocked?: boolean;
}

export const RoleManagementModal: React.FC<RoleManagementModalProps> = ({
  isOpen,
  onClose,
  currentRole,
  onSelectRole,
  roleLocked = false,
}) => {
  const [selectedRoleTab, setSelectedRoleTab] = useState<UserRole>(currentRole);
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards');
  const { t, lang } = useLanguage();

  if (!isOpen) return null;

  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);
  const roleDesc = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.descriptionEn : info.descriptionUk);
  const roleResponsibilities = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.responsibilitiesEn : info.responsibilitiesUk);

  const activeRoleDetails = getRoleInfo(selectedRoleTab);

  const permissionMatrix: { label: string; key: keyof RolePermission; desc: string }[] = [
    { label: t('roleManagementModal.permEditContentLabel'), key: 'canEditContent', desc: t('roleManagementModal.permEditContentDesc') },
    { label: t('roleManagementModal.permEditTranslationLabel'), key: 'canEditTranslation', desc: t('roleManagementModal.permEditTranslationDesc') },
    { label: t('roleManagementModal.permEditVisualsLabel'), key: 'canEditVisuals', desc: t('roleManagementModal.permEditVisualsDesc') },
    { label: t('roleManagementModal.permEditLayoutLabel'), key: 'canEditLayout', desc: t('roleManagementModal.permEditLayoutDesc') },
    { label: t('roleManagementModal.permExportLabel'), key: 'canExport', desc: t('roleManagementModal.permExportDesc') },
    { label: t('roleManagementModal.permImportBookLabel'), key: 'canImportBook', desc: t('roleManagementModal.permImportBookDesc') },
    { label: t('roleManagementModal.permManageCharactersLabel'), key: 'canManageCharacters', desc: t('roleManagementModal.permManageCharactersDesc') },
    { label: t('roleManagementModal.permManagePlotLabel'), key: 'canManagePlot', desc: t('roleManagementModal.permManagePlotDesc') },
    { label: t('roleManagementModal.permUseAiLabel'), key: 'canUseAi', desc: t('roleManagementModal.permUseAiDesc') },
    { label: t('roleManagementModal.permManageSettingsLabel'), key: 'canManageSettings', desc: t('roleManagementModal.permManageSettingsDesc') },
    { label: t('roleManagementModal.permViewAuditLogLabel'), key: 'canViewAuditLog', desc: t('roleManagementModal.permViewAuditLogDesc') },
    { label: t('roleManagementModal.permManageRolesLabel'), key: 'canManageRoles', desc: t('roleManagementModal.permManageRolesDesc') },
  ];

  const getRoleIcon = (roleId: UserRole) => {
    switch (roleId) {
      case 'admin': return Crown;
      case 'writer': return Feather;
      case 'designer': return Palette;
      case 'translator': return Globe;
      case 'publisher': return Building2;
      case 'reader': return BookOpen;
      default: return UserCheck;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-5xl max-h-[92vh] rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{t('roleManagementModal.modalTitle')}</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  {t('roleManagementModal.rolesCountBadge')}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {t('roleManagementModal.subtitlePrefix')} {ALL_ROLES.filter((r) => r.id !== 'guest').map((r) => roleName(r)).join(', ')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="p-1 rounded-xl bg-slate-800 border border-slate-700 flex items-center gap-1 text-xs">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  viewMode === 'cards' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('roleManagementModal.viewCardsBtn')}
              </button>
              <button
                onClick={() => setViewMode('matrix')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  viewMode === 'matrix' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('roleManagementModal.viewMatrixBtn')}
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {roleLocked && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2.5">
              <Lock className="w-4 h-4 shrink-0" />
              <span>{t('roleManagementModal.coworkLockedNotice')}</span>
            </div>
          )}

          {/* Active Role Quick Switch Bar */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl">{getRoleInfo(currentRole).badgeEmoji}</div>
              <div>
                <span className="text-[11px] text-slate-400 block font-medium">{t('roleManagementModal.currentRoleLabel')}</span>
                <span className="text-sm font-bold text-amber-300">
                  {getRoleInfo(currentRole).nameUk} ({getRoleInfo(currentRole).nameEn})
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 mr-1">{t('roleManagementModal.quickSwitchLabel')}</span>
              {ALL_ROLES.map((role) => (
                <button
                  key={role.id}
                  onClick={() => !roleLocked && onSelectRole(role.id)}
                  disabled={roleLocked}
                  title={roleLocked ? t('roleManagementModal.coworkLockedNotice') : undefined}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    roleLocked ? 'opacity-50 cursor-not-allowed' : ''
                  } ${
                    currentRole === role.id
                      ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  <span>{role.badgeEmoji}</span>
                  <span>{roleName(role)}</span>
                  {currentRole === role.id && <Check className="w-3 h-3 stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          {viewMode === 'cards' ? (
            /* Cards View */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Role Selector List (5 cols) */}
              <div className="lg:col-span-5 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  {t('roleManagementModal.selectRoleLabel')}
                </h3>
                {ALL_ROLES.map((role) => {
                  const Icon = getRoleIcon(role.id);
                  const isSelected = selectedRoleTab === role.id;
                  const isCurrent = currentRole === role.id;
                  return (
                    <div
                      key={role.id}
                      onClick={() => setSelectedRoleTab(role.id)}
                      className={`p-4 rounded-2xl border text-left cursor-pointer transition-all ${
                        isSelected
                          ? `bg-gradient-to-r ${role.bgGradient} shadow-lg ring-1 ring-white/10`
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-xl ${role.badgeColor} border`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white">{roleName(role)}</span>
                              {isCurrent && (
                                <span className="px-2 py-0.2 rounded-full text-[9px] font-extrabold bg-emerald-500 text-slate-950">
                                  {t('roleManagementModal.activeBadge')}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">{lang === 'en' ? role.nameUk : role.nameEn}</span>
                          </div>
                        </div>
                        <span className="text-xl">{role.badgeEmoji}</span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2">
                        {roleDesc(role)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Right Role Detailed Dossier (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${activeRoleDetails.badgeColor}`}>
                          {activeRoleDetails.badgeEmoji} {roleName(activeRoleDetails)}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          ID: {activeRoleDetails.id}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-white">
                        {t('roleManagementModal.dossierHeading')}
                      </h3>
                      <p className="text-xs text-slate-300 mt-1">
                        {roleDesc(activeRoleDetails)}
                      </p>
                    </div>

                    <button
                      onClick={() => !roleLocked && onSelectRole(activeRoleDetails.id)}
                      disabled={roleLocked && currentRole !== activeRoleDetails.id}
                      title={roleLocked ? t('roleManagementModal.coworkLockedNotice') : undefined}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 ${
                        currentRole === activeRoleDetails.id
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default'
                          : roleLocked
                          ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg active:scale-95'
                      }`}
                    >
                      {currentRole === activeRoleDetails.id ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('roleManagementModal.currentRoleBtnLabel')}</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>{t('roleManagementModal.loginAsBtn', { role: roleName(activeRoleDetails) })}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Responsibilities list */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      {t('roleManagementModal.responsibilitiesLabel')}
                    </h4>
                    <ul className="space-y-1.5">
                      {roleResponsibilities(activeRoleDetails).map((resp, i) => (
                        <li key={i} className="text-xs text-slate-300 flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>{resp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Allowed Navigation Tabs */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      {t('roleManagementModal.allowedModulesLabel', { n: String(activeRoleDetails.permissions.allowedTabs.length) })}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {activeRoleDetails.permissions.allowedTabs.map((tab) => (
                        <span key={tab} className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-200 font-mono">
                          ✓ {tab}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Persona simulation */}
                  <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-base">
                        {activeRoleDetails.defaultPersona.avatar}
                      </div>
                      <div>
                        <div className="font-bold text-slate-100">{activeRoleDetails.defaultPersona.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{activeRoleDetails.defaultPersona.email}</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                      {t('roleManagementModal.demoProfileLabel')}
                    </span>
                  </div>

                </div>
              </div>

            </div>
          ) : (
            /* Matrix View */
            <div className="rounded-2xl bg-slate-950/90 border border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/60">
                    <th className="p-3.5 font-bold text-slate-300">{t('roleManagementModal.permissionColumnHeader')}</th>
                    {ALL_ROLES.map((role) => (
                      <th key={role.id} className="p-3.5 text-center font-bold">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-base">{role.badgeEmoji}</span>
                          <span className="text-xs text-white">{roleName(role)}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {permissionMatrix.map((item) => (
                    <tr key={item.key} className="hover:bg-slate-900/40 transition-colors">
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-200">{item.label}</div>
                        <div className="text-[10px] text-slate-400">{item.desc}</div>
                      </td>
                      {ALL_ROLES.map((role) => {
                        const isGranted = (role.permissions as any)[item.key];
                        return (
                          <td key={role.id} className="p-3.5 text-center">
                            {isGranted ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-slate-500">
                                <Lock className="w-3 h-3" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/90 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              {t('roleManagementModal.footerNote')}
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-colors"
          >
            {t('roleManagementModal.closeBtn')}
          </button>
        </div>

      </div>
    </div>
  );
};
