import React, { useState } from 'react';
import { 
  GitCommit, 
  History, 
  Tag, 
  Copy, 
  Check, 
  RotateCcw, 
  Download, 
  Plus, 
  X, 
  ShieldCheck, 
  Calendar, 
  FileText, 
  Sparkles,
  Layers,
  ArrowUpRight,
  Fingerprint,
  Info
} from 'lucide-react';
import { Book, BookVersionSnapshot, UserRole } from '../types';
import { ALL_ROLES, getRoleInfo } from '../utils/rbac';
import { useLanguage } from '../i18n/LanguageContext';

interface VersionSnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  currentRole: UserRole;
  totalWords: number;
  totalPages: number;
  onCommitVersion: (versionNumber: string, label: string, note?: string, tags?: string[]) => void;
  onRestoreVersion?: (snapshot: BookVersionSnapshot) => void;
  onUpdateBookId?: (newBookId: string) => void;
}

export const VersionSnapshotModal: React.FC<VersionSnapshotModalProps> = ({
  isOpen,
  onClose,
  book,
  currentRole,
  totalWords,
  totalPages,
  onCommitVersion,
  onRestoreVersion,
  onUpdateBookId,
}) => {
  const [activeTab, setActiveTab] = useState<'history' | 'create'>('create');
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [isEditingId, setIsEditingId] = useState<boolean>(false);
  const [customIdInput, setCustomIdInput] = useState<string>(book.id || 'BK-2084-CYBER');

  // New Version Form state
  const [bumpType, setBumpType] = useState<'patch' | 'minor' | 'major' | 'custom'>('minor');
  const [customVersionStr, setCustomVersionStr] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>(['Колаборація']);
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const { t, lang } = useLanguage();

  if (!isOpen) return null;

  const roleName = (info: ReturnType<typeof getRoleInfo>) => (lang === 'en' ? info.nameEn : info.nameUk);
  const locale = lang === 'en' ? 'en-US' : 'uk-UA';
  const currentRoleInfo = getRoleInfo(currentRole);
  const currentVersion = book.version || 'v1.0.0';
  const historyList = book.versionHistory || [];

  // Calculate next semantic version
  const computeNextVersion = (type: 'patch' | 'minor' | 'major') => {
    const clean = currentVersion.replace(/^v/, '');
    const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);

    if (type === 'major') {
      return `v${parts[0] + 1}.0.0`;
    } else if (type === 'minor') {
      return `v${parts[0]}.${parts[1] + 1}.0`;
    } else {
      return `v${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    }
  };

  const getTargetVersionNumber = () => {
    if (bumpType === 'custom') return customVersionStr.trim() || `v${currentVersion}-custom`;
    return computeNextVersion(bumpType);
  };

  const handleCopyBookId = () => {
    navigator.clipboard.writeText(book.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSaveBookId = () => {
    if (customIdInput.trim() && onUpdateBookId) {
      onUpdateBookId(customIdInput.trim());
      setIsEditingId(false);
    }
  };

  const handleToggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleAddCustomTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagInput.trim() && !selectedTags.includes(newTagInput.trim())) {
      setSelectedTags([...selectedTags, newTagInput.trim()]);
      setNewTagInput('');
    }
  };

  const handleSubmitCommit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const finalVersion = getTargetVersionNumber();
    onCommitVersion(finalVersion, label.trim(), note.trim(), selectedTags);
    setLabel('');
    setNote('');
    setActiveTab('history');
  };

  const handleExportSnapshotJson = (snapshot: BookVersionSnapshot) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snapshot, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `snapshot-${book.id}-${snapshot.versionNumber}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div 
        className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 bg-slate-950/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <GitCommit className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-white">{t('versionSnapshotModal.modalTitle')}</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-500 text-slate-950 shadow-sm">
                  {currentVersion}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  {t('versionSnapshotModal.revisionLabel', { n: String(book.revisionNumber || 1) })}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('versionSnapshotModal.modalSubtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title={t('versionSnapshotModal.closeTooltip')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unique Book ID & Role Identity Strip */}
        <div className="px-6 py-3 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Book ID */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono flex items-center gap-1">
              <Fingerprint className="w-3.5 h-3.5 text-cyan-400" />
              {t('versionSnapshotModal.bookIdLabel')}
            </span>
            {isEditingId ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customIdInput}
                  onChange={(e) => setCustomIdInput(e.target.value.toUpperCase())}
                  className="px-2 py-1 rounded bg-slate-900 border border-amber-400 text-white font-mono text-xs focus:outline-hidden"
                />
                <button
                  onClick={handleSaveBookId}
                  className="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs"
                >
                  OK
                </button>
                <button
                  onClick={() => setIsEditingId(false)}
                  className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-xs"
                >
                  {t('versionSnapshotModal.cancelBtn')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 font-mono font-bold text-cyan-300">
                  {book.id || 'BK-2084-CYBER'}
                </span>
                <button
                  onClick={handleCopyBookId}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                  title={t('versionSnapshotModal.copyIdTooltip')}
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {currentRole === 'admin' && (
                  <button
                    onClick={() => setIsEditingId(true)}
                    className="text-[10px] text-slate-400 hover:text-amber-400 underline ml-1"
                  >
                    {t('versionSnapshotModal.changeIdBtn')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Current Role Indicator */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400">{t('versionSnapshotModal.snapshotAuthorLabel')}</span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${currentRoleInfo.badgeColor}`}>
              <span>{currentRoleInfo.badgeEmoji}</span>
              <span>{roleName(currentRoleInfo)}</span>
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-800 flex items-center gap-4 bg-slate-900">
          <button
            onClick={() => setActiveTab('create')}
            className={`py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'create'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('versionSnapshotModal.createTabBtn')}</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'history'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{t('versionSnapshotModal.historyTabBtn', { n: String(historyList.length) })}</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* TAB 1: CREATE NEW VERSION COMMIT */}
          {activeTab === 'create' && (
            <form onSubmit={handleSubmitCommit} className="space-y-6 max-w-2xl mx-auto">
              
              {/* Version Bump Type Selector */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  {t('versionSnapshotModal.bumpTypeLabel')}
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setBumpType('patch')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      bumpType === 'patch'
                        ? 'bg-amber-500/20 border-amber-500/80 text-white ring-1 ring-amber-400/40'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-mono font-bold text-emerald-400">{computeNextVersion('patch')}</div>
                    <div className="font-bold text-xs mt-1">{t('versionSnapshotModal.patchLabel')}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{t('versionSnapshotModal.patchDesc')}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBumpType('minor')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      bumpType === 'minor'
                        ? 'bg-amber-500/20 border-amber-500/80 text-white ring-1 ring-amber-400/40'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-mono font-bold text-cyan-400">{computeNextVersion('minor')}</div>
                    <div className="font-bold text-xs mt-1">{t('versionSnapshotModal.minorLabel')}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{t('versionSnapshotModal.minorDesc')}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBumpType('major')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      bumpType === 'major'
                        ? 'bg-amber-500/20 border-amber-500/80 text-white ring-1 ring-amber-400/40'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-mono font-bold text-purple-400">{computeNextVersion('major')}</div>
                    <div className="font-bold text-xs mt-1">{t('versionSnapshotModal.majorLabel')}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{t('versionSnapshotModal.majorDesc')}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBumpType('custom')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      bumpType === 'custom'
                        ? 'bg-amber-500/20 border-amber-500/80 text-white ring-1 ring-amber-400/40'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-mono font-bold text-amber-400">Custom</div>
                    <div className="font-bold text-xs mt-1">{t('versionSnapshotModal.customLabel')}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">e.g. v2.0.0-rc1, draft-2</div>
                  </button>
                </div>

                {bumpType === 'custom' && (
                  <div className="pt-2">
                    <input
                      type="text"
                      value={customVersionStr}
                      onChange={(e) => setCustomVersionStr(e.target.value)}
                      placeholder={t('versionSnapshotModal.customVersionPlaceholder')}
                      className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-hidden"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Form Inputs */}
              <div className="space-y-4 text-xs">
                <div>
                  <label className="text-slate-300 font-bold block mb-1.5">
                    {t('versionSnapshotModal.labelFieldLabel')} <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('versionSnapshotModal.labelFieldPlaceholder')}
                    className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-slate-100 font-semibold text-xs focus:outline-hidden"
                    required
                  />
                </div>

                <div>
                  <label className="text-slate-400 font-medium block mb-1.5">
                    {t('versionSnapshotModal.noteFieldLabel')}
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder={t('versionSnapshotModal.notePlaceholder')}
                    className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 focus:border-amber-400 text-slate-200 text-xs focus:outline-hidden resize-none"
                  />
                </div>

                {/* Preset & Custom Tags */}
                <div>
                  <label className="text-slate-400 font-medium block mb-1.5">
                    {t('versionSnapshotModal.tagsLabel')}
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {['Рукопис', 'Редагування', 'Переклад (EN)', 'Ілюстрації', 'Обкладинка', 'Amazon KDP', 'Верстка', 'Вичитка'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleToggleTag(tag)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                          selectedTags.includes(tag)
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      placeholder={t('versionSnapshotModal.addTagPlaceholder')}
                      className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomTag}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg"
                    >
                      {t('versionSnapshotModal.addTagBtn')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Commit Action Footer */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-400">
                  {t('versionSnapshotModal.commitSummaryPrefix')} <b className="text-amber-300 font-mono font-bold">{getTargetVersionNumber()}</b> {t('versionSnapshotModal.commitSummarySuffix', { words: String(totalWords), chapters: String(book.chapters.length) })}
                </div>

                <button
                  type="submit"
                  disabled={!label.trim()}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md"
                >
                  <GitCommit className="w-4 h-4 stroke-[2.5]" />
                  <span>{t('versionSnapshotModal.commitBtn', { v: getTargetVersionNumber() })}</span>
                </button>
              </div>

            </form>
          )}

          {/* TAB 2: VERSION HISTORY TIMELINE */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {historyList.length === 0 ? (
                <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 text-slate-400 text-xs space-y-3">
                  <History className="w-8 h-8 mx-auto text-slate-600" />
                  <p>{t('versionSnapshotModal.emptyHistoryText')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyList.slice().reverse().map((snapshot, index) => {
                    const snapRoleInfo = getRoleInfo(snapshot.authorRole);
                    const isLatest = index === 0;
                    return (
                      <div
                        key={snapshot.id || index}
                        className={`p-4 rounded-xl border transition-all ${
                          isLatest
                            ? 'bg-slate-950 border-amber-500/50 shadow-lg ring-1 ring-amber-500/20'
                            : 'bg-slate-950/70 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2.5 py-1 rounded-md bg-amber-500 text-slate-950 font-mono font-bold text-xs shadow-xs">
                              {snapshot.versionNumber}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                              Rev #{snapshot.revisionNumber || historyList.length - index}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${snapRoleInfo.badgeColor}`}>
                              <span>{snapRoleInfo.badgeEmoji}</span>
                              <span>{roleName(snapRoleInfo)}</span>
                            </span>
                            {isLatest && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                {t('versionSnapshotModal.currentVersionBadge')}
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            <span>{new Date(snapshot.timestamp).toLocaleString(locale)}</span>
                          </div>
                        </div>

                        {/* Title & Notes */}
                        <div className="py-3 space-y-1.5">
                          <div className="font-bold text-sm text-slate-100">{snapshot.label}</div>
                          {snapshot.note && (
                            <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                              {snapshot.note}
                            </p>
                          )}
                        </div>

                        {/* Metadata Tags & Stats Footer */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[11px] text-slate-400 border-t border-slate-800/60">
                          <div className="flex items-center gap-3">
                            <span>{t('versionSnapshotModal.authorLabel')} <b className="text-slate-200">{snapshot.authorName}</b></span>
                            <span>{t('versionSnapshotModal.wordsLabel')} <b className="text-slate-200">{snapshot.wordCount?.toLocaleString(locale) || 0}</b></span>
                            <span>{t('versionSnapshotModal.chaptersLabel')} <b className="text-slate-200">{snapshot.chapterCount || 0}</b></span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleExportSnapshotJson(snapshot)}
                              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:text-white flex items-center gap-1 transition-colors"
                              title={t('versionSnapshotModal.downloadJsonTooltip')}
                            >
                              <Download className="w-3 h-3" />
                              <span>JSON</span>
                            </button>

                            {onRestoreVersion && !isLatest && (
                              <div>
                                {restoreConfirmId === snapshot.id ? (
                                  <div className="flex items-center gap-1.5 bg-rose-500/20 p-1 rounded-lg border border-rose-500/40">
                                    <span className="text-[10px] text-rose-300 font-bold">{t('versionSnapshotModal.confirmRestoreLabel')}</span>
                                    <button
                                      onClick={() => {
                                        onRestoreVersion(snapshot);
                                        setRestoreConfirmId(null);
                                        onClose();
                                      }}
                                      className="px-2 py-0.5 bg-rose-500 hover:bg-rose-400 text-white font-bold rounded text-[10px]"
                                    >
                                      {t('versionSnapshotModal.yesBtn')}
                                    </button>
                                    <button
                                      onClick={() => setRestoreConfirmId(null)}
                                      className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px]"
                                    >
                                      {t('versionSnapshotModal.noBtn')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setRestoreConfirmId(snapshot.id)}
                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-1 transition-colors"
                                    title={t('versionSnapshotModal.restoreTooltip')}
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>{t('versionSnapshotModal.restoreBtn')}</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
