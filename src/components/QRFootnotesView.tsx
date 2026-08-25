import React, { useState, useEffect } from 'react';
import { 
  QrCode, 
  BookMarked, 
  Plus, 
  Trash2, 
  Edit3, 
  ExternalLink, 
  Sparkles, 
  Download, 
  Copy, 
  Check, 
  FileText, 
  Globe, 
  Headphones, 
  Key, 
  Share2, 
  Eye, 
  MessageSquare,
  HelpCircle,
  Save
} from 'lucide-react';
import { Book, Footnote, QRTag } from '../types';
import { generateQrDataUrl } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';

interface QRFootnotesViewProps {
  book: Book;
  onUpdateBook: (updated: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToSection?: (chapterId: string, sectionId: string) => void;
  onSaveBook?: () => void;
}

export const QRFootnotesView: React.FC<QRFootnotesViewProps> = ({
  book,
  onUpdateBook,
  onNavigateToSection,
  onSaveBook,
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'qr' | 'footnotes'>('qr');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // QR creation state
  const [newQrTitle, setNewQrTitle] = useState('');
  const [newQrType, setNewQrType] = useState<QRTag['actionType']>('url');
  const [newQrPayload, setNewQrPayload] = useState('');
  const [newQrDesc, setNewQrDesc] = useState('');
  const [newQrSectionId, setNewQrSectionId] = useState(book.chapters[0]?.sections[0]?.id || '');
  const [previewQrDataUrl, setPreviewQrDataUrl] = useState('');

  // Footnote creation state
  const [newFnTerm, setNewFnTerm] = useState('');
  const [newFnText, setNewFnText] = useState('');
  const [newFnMarker, setNewFnMarker] = useState('1');
  const [newFnSectionId, setNewFnSectionId] = useState(book.chapters[0]?.sections[0]?.id || '');

  // Scanner modal preview state
  const [scanningQr, setScanningQr] = useState<QRTag | null>(null);

  // Generate live QR preview when typing
  useEffect(() => {
    if (newQrPayload) {
      generateQrDataUrl(newQrPayload).then(url => setPreviewQrDataUrl(url));
    } else {
      setPreviewQrDataUrl('');
    }
  }, [newQrPayload]);

  const handleCreateQR = async () => {
    if (!newQrTitle.trim() || !newQrPayload.trim()) return;

    const qrDataUrl = await generateQrDataUrl(newQrPayload);
    const newTag: QRTag = {
      id: `qr-${Date.now()}`,
      code: `QR-${((book.qrTags || []).length + 1).toString().padStart(2, '0')}`,
      title: newQrTitle.trim(),
      actionType: newQrType,
      payload: newQrPayload.trim(),
      description: newQrDesc.trim(),
      sectionId: newQrSectionId,
      svgData: qrDataUrl,
      createdAt: new Date().toISOString(),
    };

    onUpdateBook({
      ...book,
      qrTags: [...(book.qrTags || []), newTag],
    });

    setNewQrTitle('');
    setNewQrPayload('');
    setNewQrDesc('');
  };

  const handleDeleteQR = (id: string) => {
    onUpdateBook({
      ...book,
      qrTags: (book.qrTags || []).filter(q => q.id !== id),
    });
  };

  const handleCreateFootnote = () => {
    if (!newFnText.trim()) return;

    const newFootnote: Footnote = {
      id: `fn-${Date.now()}`,
      number: (book.footnotes || []).length + 1,
      marker: newFnMarker || `${(book.footnotes || []).length + 1}`,
      term: newFnTerm.trim(),
      text: newFnText.trim(),
      sectionId: newFnSectionId,
    };

    onUpdateBook({
      ...book,
      footnotes: [...(book.footnotes || []), newFootnote],
    });

    setNewFnTerm('');
    setNewFnText('');
    setNewFnMarker(`${(book.footnotes || []).length + 2}`);
  };

  const handleDeleteFootnote = (id: string) => {
    onUpdateBook({
      ...book,
      footnotes: (book.footnotes || []).filter(f => f.id !== id),
    });
  };

  const handleCopyTagCode = (tagCode: string, id: string) => {
    navigator.clipboard.writeText(tagCode);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      
      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {t('qrFootnotesView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('qrFootnotesView.headerSubBadge', { qr: String(book.qrTags?.length || 0), fn: String(book.footnotes?.length || 0) })}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('qrFootnotesView.headerTitle')}
          </h1>
        </div>

        {/* Tab switcher & Save Button */}
        <div className="flex items-center gap-2">
          {onSaveBook && (
            <button
              onClick={onSaveBook}
              data-tour="qr-footnotes__5"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95"
              title={t('qrFootnotesView.saveTooltip')}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('qrFootnotesView.saveChangesBtn')}</span>
            </button>
          )}

          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800" data-tour="qr-footnotes__1">
            <button
              onClick={() => setActiveTab('qr')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'qr'
                  ? 'bg-cyan-600 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>{t('qrFootnotesView.qrTabBtn')}</span>
            </button>

            <button
              onClick={() => setActiveTab('footnotes')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'footnotes'
                  ? 'bg-cyan-600 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BookMarked className="w-4 h-4" />
              <span>{t('qrFootnotesView.footnotesTabBtn')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: QR TAGS */}
      {activeTab === 'qr' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Create QR Form */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                {t('qrFootnotesView.createQrHeading')}
              </h3>

              {/* Action Type */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.actionTypeLabel')}</label>
                <div className="grid grid-cols-2 gap-2" data-tour="qr-footnotes__2">
                  {[
                    { id: 'url', label: t('qrFootnotesView.typeUrlLabel'), icon: Globe },
                    { id: 'secret', label: t('qrFootnotesView.typeSecretLabel'), icon: Key },
                    { id: 'audio', label: t('qrFootnotesView.typeAudioLabel'), icon: Headphones },
                    { id: 'social', label: t('qrFootnotesView.typeSocialLabel'), icon: Share2 },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setNewQrType(opt.id as QRTag['actionType'])}
                        className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium border transition-all ${
                          newQrType === opt.id
                            ? 'bg-cyan-500/20 border-cyan-500 text-white font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.tagTitleLabel')}</label>
                <input
                  type="text"
                  placeholder={t('qrFootnotesView.tagTitlePlaceholder')}
                  value={newQrTitle}
                  onChange={(e) => setNewQrTitle(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              {/* Payload */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {newQrType === 'url' ? t('qrFootnotesView.payloadUrlLabel') :
                   newQrType === 'secret' ? t('qrFootnotesView.payloadSecretLabel') :
                   newQrType === 'audio' ? t('qrFootnotesView.payloadAudioLabel') : t('qrFootnotesView.payloadSocialLabel')}
                </label>
                {newQrType === 'secret' ? (
                  <textarea
                    rows={3}
                    placeholder={t('qrFootnotesView.payloadSecretPlaceholder')}
                    value={newQrPayload}
                    onChange={(e) => setNewQrPayload(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                  />
                ) : (
                  <input
                    type="text"
                    placeholder={t('qrFootnotesView.payloadUrlPlaceholder')}
                    value={newQrPayload}
                    onChange={(e) => setNewQrPayload(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono"
                  />
                )}
              </div>

              {/* Chapter / Section assignment */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.sectionLinkLabel')}</label>
                <select
                  value={newQrSectionId}
                  onChange={(e) => setNewQrSectionId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {book.chapters.map((c) =>
                    c.sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {c.title} → {s.title}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.descLabel')}</label>
                <input
                  type="text"
                  placeholder={t('qrFootnotesView.descPlaceholder')}
                  value={newQrDesc}
                  onChange={(e) => setNewQrDesc(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              {/* Live Preview */}
              {previewQrDataUrl && (
                <div className="p-3 bg-white rounded-xl flex items-center justify-center gap-4">
                  <img src={previewQrDataUrl} alt="QR Preview" className="w-24 h-24" />
                  <div className="text-[11px] text-slate-800 space-y-1">
                    <p className="font-bold text-slate-950">{t('qrFootnotesView.previewLabel')}</p>
                    <p className="text-slate-500 truncate max-w-[160px] font-mono">{newQrPayload}</p>
                    <span className="inline-block px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded-md font-bold text-[9px]">
                      {t('qrFootnotesView.readyToInsertLabel')}
                    </span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleCreateQR}
                disabled={!newQrTitle.trim() || !newQrPayload.trim()}
                data-tour="qr-footnotes__3"
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 text-slate-950 font-bold text-xs shadow-lg transition-all"
              >
                {t('qrFootnotesView.createQrBtn')}
              </button>
            </div>
          </div>

          {/* Right Column: Existing QR Tags List */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4" data-tour="qr-footnotes__4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                  <QrCode className="w-4 h-4" />
                  {t('qrFootnotesView.existingQrHeading', { n: String(book.qrTags?.length || 0) })}
                </h3>
              </div>

              {(book.qrTags || []).length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-2xl text-slate-500 space-y-2">
                  <QrCode className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="text-xs">{t('qrFootnotesView.emptyQrTitle')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(book.qrTags || []).map((qr) => (
                    <div
                      key={qr.id}
                      className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3 hover:border-cyan-500/50 transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        {qr.svgData ? (
                          <div className="p-1.5 bg-white rounded-xl shadow-sm shrink-0">
                            <img src={qr.svgData} alt={qr.title} className="w-16 h-16" />
                          </div>
                        ) : (
                          <div className="w-16 h-16 bg-slate-800 rounded-xl flex items-center justify-center text-slate-500">
                            <QrCode className="w-6 h-6" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300">
                              {qr.code}
                            </span>
                            <button
                              onClick={() => handleDeleteQR(qr.id)}
                              className="text-slate-500 hover:text-rose-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              title={t('qrFootnotesView.deleteTooltip')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <h4 className="text-xs font-bold text-white truncate">{qr.title}</h4>
                          <p className="text-[10px] text-slate-400 truncate font-mono">{qr.payload}</p>
                          {qr.description && (
                            <p className="text-[10px] text-slate-500 truncate">{qr.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
                        <button
                          onClick={() => setScanningQr(qr)}
                          className="text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                        >
                          <Eye className="w-3 h-3" />
                          {t('qrFootnotesView.testScanBtn')}
                        </button>

                        <button
                          onClick={() => handleCopyTagCode(`[QR: ${qr.code} - "${qr.title}"]`, qr.id)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 font-mono text-[10px]"
                        >
                          {copiedId === qr.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedId === qr.id ? t('qrFootnotesView.copiedLabel') : t('qrFootnotesView.codeForTextBtn')}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* TAB 2: FOOTNOTES */}
      {activeTab === 'footnotes' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Create Footnote Form */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                {t('qrFootnotesView.addFootnoteHeading')}
              </h3>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.markerLabel')}</label>
                  <input
                    type="text"
                    value={newFnMarker}
                    onChange={(e) => setNewFnMarker(e.target.value)}
                    placeholder="1, *, a"
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 text-center font-bold"
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.termLabel')}</label>
                  <input
                    type="text"
                    placeholder={t('qrFootnotesView.termPlaceholder')}
                    value={newFnTerm}
                    onChange={(e) => setNewFnTerm(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.sceneLinkLabel')}</label>
                <select
                  value={newFnSectionId}
                  onChange={(e) => setNewFnSectionId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {book.chapters.map((c) =>
                    c.sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {c.title} → {s.title}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('qrFootnotesView.footnoteTextLabel')}</label>
                <textarea
                  rows={3}
                  placeholder={t('qrFootnotesView.footnoteTextPlaceholder')}
                  value={newFnText}
                  onChange={(e) => setNewFnText(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              <button
                type="button"
                onClick={handleCreateFootnote}
                disabled={!newFnText.trim()}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-40 text-slate-950 font-bold text-xs shadow-lg transition-all"
              >
                {t('qrFootnotesView.saveFootnoteBtn')}
              </button>
            </div>
          </div>

          {/* Footnotes List */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <BookMarked className="w-4 h-4" />
                {t('qrFootnotesView.footnotesListHeading', { n: String(book.footnotes?.length || 0) })}
              </h3>

              {(book.footnotes || []).length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-2xl text-slate-500 space-y-2">
                  <BookMarked className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="text-xs">{t('qrFootnotesView.emptyFootnotesTitle')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(book.footnotes || []).map((fn) => (
                    <div
                      key={fn.id}
                      className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-start justify-between gap-3 group hover:border-cyan-500/50 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <span className="w-7 h-7 rounded-xl bg-cyan-500/20 text-cyan-300 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                          {fn.marker}
                        </span>
                        <div className="space-y-1">
                          {fn.term && (
                            <h4 className="text-xs font-bold text-white">
                              {fn.term}
                            </h4>
                          )}
                          <p className="text-xs text-slate-300 leading-relaxed font-serif-book">
                            {fn.text}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleCopyTagCode(`[^${fn.marker}]`, fn.id)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono flex items-center gap-1"
                        >
                          {copiedId === fn.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>[^${fn.marker}]</span>
                        </button>
                        <button
                          onClick={() => handleDeleteFootnote(fn.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                          title={t('qrFootnotesView.deleteTooltip')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Simulator Modal for Scanning QR Code */}
      {scanningQr && (
        <div
          onClick={() => setScanningQr(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold">{scanningQr.title}</h3>
              </div>
              <button onClick={() => setScanningQr(null)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <div className="p-4 bg-white rounded-2xl flex items-center justify-center">
              <img src={scanningQr.svgData} alt={scanningQr.title} className="w-48 h-48" />
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[10px]">
                <span>{t('qrFootnotesView.typeLabel')}{scanningQr.actionType.toUpperCase()}</span>
                <span>{scanningQr.code}</span>
              </div>
              
              {scanningQr.actionType === 'url' ? (
                <a
                  href={scanningQr.payload}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-cyan-400 hover:underline font-mono text-xs break-all"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>{scanningQr.payload}</span>
                </a>
              ) : (
                <p className="text-slate-200 font-serif-book leading-relaxed whitespace-pre-wrap">
                  {scanningQr.payload}
                </p>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setScanningQr(null)}
                className="px-4 py-2 rounded-xl bg-cyan-600 text-slate-950 font-bold text-xs"
              >
                {t('qrFootnotesView.closeSimulatorBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
