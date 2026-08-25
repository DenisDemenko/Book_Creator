import React, { useState } from 'react';
import { 
  History, 
  Download, 
  Trash2, 
  Search, 
  FileText, 
  Clock, 
  Copy,
  Check,
  Fingerprint,
  Tag,
  GitCommit,
  ShieldCheck,
  Filter
} from 'lucide-react';
import { AuditLogEntry, UserRole } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';

interface ChangeLogViewProps {
  logEntries: AuditLogEntry[];
  onClearLogs: () => void;
  bookTitle: string;
  bookId?: string;
  currentVersion?: string;
}

export const ChangeLogView: React.FC<ChangeLogViewProps> = ({
  logEntries,
  onClearLogs,
  bookTitle,
  bookId = 'BK-2084-CYBER',
  currentVersion = 'v1.0.0',
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTabFilter, setSelectedTabFilter] = useState<string>('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { t, lang } = useLanguage();
  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';

  // Tabs for filtering
  const tabsList = [
    { id: 'all', label: t('changeLogView.tabAll') },
    { id: 'version', label: t('changeLogView.tabVersion') },
    { id: 'start', label: t('changeLogView.tabStart') },
    { id: 'editor', label: t('changeLogView.tabEditor') },
    { id: 'characters', label: t('changeLogView.tabCharacters') },
    { id: 'scenario', label: t('changeLogView.tabScenario') },
    { id: 'toc', label: t('changeLogView.tabToc') },
    { id: 'system', label: t('changeLogView.tabSystem') },
  ];

  const filteredLogs = logEntries.filter((log) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      log.action.toLowerCase().includes(query) ||
      log.details.toLowerCase().includes(query) ||
      (log.bookId && log.bookId.toLowerCase().includes(query)) ||
      (log.bookVersion && log.bookVersion.toLowerCase().includes(query)) ||
      (log.author && log.author.toLowerCase().includes(query)) ||
      (log.changedEntity && log.changedEntity.toLowerCase().includes(query));
    
    const matchesTab = 
      selectedTabFilter === 'all' || 
      log.tab === selectedTabFilter || 
      (selectedTabFilter === 'version' && log.category === 'version') ||
      (selectedTabFilter === 'system' && log.category === 'system');

    const matchesRole = 
      selectedRoleFilter === 'all' || 
      log.role === selectedRoleFilter;

    return matchesSearch && matchesTab && matchesRole;
  });

  // Download logs as formatted TXT file
  const handleDownloadTxt = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const header = `=======================================================\n` +
      `  NOVA STUDIO - ЖУРНАЛ АУДИТУ ТА ЗМІН КНИГИ\n` +
      `  Твір: ${bookTitle} (ID: ${bookId})\n` +
      `  Поточна версія: ${currentVersion}\n` +
      `  Згенеровано: ${new Date().toLocaleString('uk-UA')}\n` +
      `  Всього записів у лозі: ${logEntries.length}\n` +
      `=======================================================\n\n`;

    const body = logEntries.map((log, index) => {
      const roleNameForExport = log.role ? getRoleInfo(log.role).nameUk : 'Система';
      return `[#${logEntries.length - index}] ${new Date(log.timestamp).toLocaleString('uk-UA')}\n` +
        `  ID Книги: ${log.bookId || bookId} | Версія: ${log.bookVersion || 'v1.0.0'}\n` +
        `  Роль / Автор: [${roleNameForExport}] ${log.author || ''}\n` +
        `  Розділ: [${(log.tab || log.category || 'system').toUpperCase()}]\n` +
        `  Дія: ${log.action}\n` +
        `  Об'єкт: ${log.changedEntity || '—'}\n` +
        `  Деталі: ${log.details}\n` +
        `-------------------------------------------------------`;
    }).join('\n\n');

    const fullContent = header + body;
    const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-audit-log-${bookId}-${timestamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download logs as structured JSON file
  const handleDownloadJson = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const data = {
      project: bookTitle,
      bookId,
      currentVersion,
      exportedAt: new Date().toISOString(),
      totalEntries: logEntries.length,
      logs: logEntries,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-changelog-${bookId}-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyLogItem = (log: AuditLogEntry) => {
    const text = `[${new Date(log.timestamp).toLocaleTimeString('uk-UA')}] [${log.bookId || bookId}@${log.bookVersion || 'v1.0.0'}] [${log.role || 'system'}] ${log.action}: ${log.details}`;
    navigator.clipboard.writeText(text);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto bg-slate-950 text-slate-100 space-y-6">
      
      {/* Top Banner */}
      <div className="p-6 lg:p-8 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-amber-400 border border-slate-700 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              {t('changeLogView.headerBadge')}
            </span>
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-slate-950 text-cyan-300 border border-slate-800 flex items-center gap-1">
              <Fingerprint className="w-3 h-3 text-cyan-400" />
              ID: {bookId}
            </span>
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {currentVersion}
            </span>
            <span className="text-xs text-slate-400">
              {t('changeLogView.totalEventsLabel')} <b className="text-slate-100 font-mono">{logEntries.length}</b>
            </span>
          </div>

          <h1 className="text-2xl font-bold text-slate-100 font-heading">
            {t('changeLogView.pageTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
            {t('changeLogView.pageDesc', { title: bookTitle })}
          </p>
        </div>

        {/* Export & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <button
            onClick={handleDownloadTxt}
            data-tour="changelog__3"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors whitespace-nowrap"
            title={t('changeLogView.downloadTxtTooltip')}
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>{t('changeLogView.downloadTxtBtn')}</span>
          </button>

          <button
            onClick={handleDownloadJson}
            data-tour="changelog__4"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors whitespace-nowrap"
            title={t('changeLogView.downloadJsonTooltip')}
          >
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span>{t('changeLogView.downloadJsonBtn')}</span>
          </button>

          {logEntries.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(t('changeLogView.clearConfirm'))) {
                  onClearLogs();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 text-slate-400 border border-slate-700 text-xs font-semibold transition-colors"
              title={t('changeLogView.clearTooltip')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('changeLogView.clearBtn')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-4">
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('changeLogView.searchPlaceholder')}
              data-tour="changelog__1"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-amber-400 text-xs text-slate-200 focus:outline-hidden"
            />
          </div>

          {/* Role Filter Selector */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-xs text-slate-400 whitespace-nowrap">{t('changeLogView.roleFilterLabel')}</span>
            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value)}
              className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-hidden"
            >
              <option value="all">{t('changeLogView.allRolesOption')}</option>
              {ALL_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.badgeEmoji} {roleName(r)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 border-t border-slate-800" data-tour="changelog__2">
          {tabsList.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTabFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                selectedTabFilter === tab.id
                  ? 'bg-slate-800 text-amber-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-950'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      </div>

      {/* Log List View */}
      <div className="space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center rounded-xl bg-slate-900 border border-slate-800 text-slate-500 text-sm space-y-2">
            <Clock className="w-8 h-8 mx-auto text-slate-600 mb-2" />
            <p className="font-semibold text-slate-400">{t('changeLogView.emptyTitle')}</p>
            <p className="text-xs text-slate-500">{t('changeLogView.emptyDesc')}</p>
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const roleInfo = log.role ? getRoleInfo(log.role) : null;
            const isVersionCommit = log.category === 'version';
            const isSystemInit = log.category === 'system';

            return (
              <div
                key={log.id}
                className={`p-4 rounded-xl border flex items-start justify-between gap-4 transition-colors ${
                  isVersionCommit
                    ? 'bg-slate-900/90 border-amber-500/40 shadow-sm'
                    : isSystemInit
                    ? 'bg-slate-900/90 border-cyan-500/40'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="font-mono text-xs text-slate-500 mt-0.5 shrink-0">
                    #{filteredLogs.length - idx}
                  </span>

                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-100">
                        {log.action}
                      </span>

                      {/* Version Tag */}
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        {log.bookVersion || 'v1.0.0'}
                      </span>

                      {/* Book ID */}
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-950 text-cyan-300 border border-slate-800">
                        {log.bookId || bookId}
                      </span>

                      {/* Role Badge */}
                      {roleInfo && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${roleInfo.badgeColor}`}>
                          <span>{roleInfo.badgeEmoji}</span>
                          <span>{roleName(roleInfo)}</span>
                        </span>
                      )}

                      {log.changedEntity && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                          {log.changedEntity}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-sans">
                      {log.details}
                    </p>

                    <div className="text-[11px] text-slate-400 font-mono pt-0.5 flex items-center gap-2">
                      <span>{new Date(log.timestamp).toLocaleString(locale)}</span>
                      {log.author && <span>• {t('changeLogView.authorLabel')} <b className="text-slate-300">{log.author}</b></span>}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleCopyLogItem(log)}
                  className="p-2 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                  title={t('changeLogView.copyTooltip')}
                >
                  {copiedId === log.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
