import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Library,
  Upload,
  FileText,
  FileImage,
  Trash2,
  Loader2,
  Quote,
  ScanText,
  MessageSquare,
  X,
  BookmarkPlus,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import type { Book, AuthUser, KnowledgeFile } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { calculateWordCount } from '../utils/helpers';

interface KnowledgeViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  authUser?: AuthUser | null;
  /** Поточний розділ книги — куди «Зберегти текст в книгу» дописує текст. */
  activeChapterId?: string;
  activeSectionId?: string;
  /** «Передати в чат АІ» — текст лягає першим повідомленням обговорення (власник відкриває чат). */
  onSendToChat?: (text: string, where: string) => void;
}

interface StorageInfo {
  usedBytes: number;
  quotaBytes: number | null;
  remainingBytes: number | null;
}

type QuoteMode = 'direct' | 'paraphrase' | 'analytical';

const MB = 1024 * 1024;

/** Той самий прийом, що і в ManuscriptFormatterView.tsx: .txt читаємо напряму, .docx — через mammoth (динамічний імпорт, лише в браузері). */
async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type === 'text/plain' || file.type === 'text/markdown') {
    return await file.text();
  }
  if (name.endsWith('.docx')) {
    const mod: any = await import('mammoth');
    const mammoth = mod.default || mod;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value as string;
  }
  throw new Error('unsupported');
}

/** Растрові формати, які розуміє Tesseract (tesseract.js → leptonica). PDF свідомо немає — tesseract.js його не підтримує. */
const OCR_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif', 'tif', 'tiff', 'pbm', 'pgm', 'ppm'];

function detectFileType(file: File): KnowledgeFile['fileType'] | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return 'image';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'txt';
  if (OCR_IMAGE_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`))) return 'image';
  return null;
}

export const KnowledgeView: React.FC<KnowledgeViewProps> = ({
  book,
  onUpdateBook,
  authUser,
  activeChapterId,
  activeSectionId,
  onSendToChat,
}) => {
  const { t } = useLanguage();
  const files = book.knowledgeFiles || [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const isRegistered = !!authUser && !authUser.isGuest;

  const [selectedFileId, setSelectedFileId] = useState<string | null>(files[0]?.id || null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [selectedQuoteText, setSelectedQuoteText] = useState('');
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quoteMode, setQuoteMode] = useState<QuoteMode | null>(null);
  const [quoteResult, setQuoteResult] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [insertChapterId, setInsertChapterId] = useState<string>(book.chapters[0]?.id || '');
  const [insertSectionId, setInsertSectionId] = useState<string>(book.chapters[0]?.sections[0]?.id || '');
  const [insertToast, setInsertToast] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const selectedFile = files.find((f) => f.id === selectedFileId) || null;
  const insertChapter = book.chapters.find((c) => c.id === insertChapterId) || book.chapters[0];

  const loadStorageInfo = useCallback(async () => {
    if (!isRegistered) {
      setStorageInfo(null);
      return;
    }
    try {
      const res = await fetch('/api/subscription/me', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (data.storage) {
          setStorageInfo({ usedBytes: data.storage.usedBytes, quotaBytes: data.storage.quotaBytes, remainingBytes: data.storage.remainingBytes });
        }
      }
    } catch {
      /* тихо — індикатор просто не покажеться */
    }
  }, [isRegistered]);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);

    if (!isRegistered) {
      setUploadError(t('knowledgeView.guestUploadBlocked'));
      return;
    }

    const fileType = detectFileType(file);
    if (!fileType) {
      setUploadError(t('knowledgeView.unsupportedType'));
      return;
    }

    setIsUploading(true);
    try {
      const quotaRes = await fetch('/api/media/check-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bytes: file.size, bookId: book.id, fileName: file.name }),
      });
      const quotaData = await quotaRes.json();
      if (!quotaRes.ok) {
        setUploadError(quotaData?.error || t('knowledgeView.quotaError'));
        return;
      }
      if (typeof quotaData.usedBytes === 'number') {
        setStorageInfo({ usedBytes: quotaData.usedBytes, quotaBytes: quotaData.quotaBytes ?? null, remainingBytes: quotaData.remainingBytes ?? null });
      }

      const newFile: KnowledgeFile = {
        id: `kf-${Date.now()}`,
        fileName: file.name,
        fileType,
        fileSizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
        createdAt: new Date().toISOString(),
      };

      if (fileType === 'image') {
        newFile.previewImageUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      } else {
        newFile.contentText = await extractTextFromFile(file);
      }

      onUpdateBook(
        { ...book, knowledgeFiles: [...files, newFile] },
        'Додано файл у Базу знань',
        `Завантажено «${newFile.fileName}»`
      );
      setSelectedFileId(newFile.id);
    } catch {
      setUploadError(t('knowledgeView.processError'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteFile = (id: string) => {
    onUpdateBook(
      { ...book, knowledgeFiles: files.filter((f) => f.id !== id) },
      'Видалено файл із Бази знань',
      files.find((f) => f.id === id)?.fileName || ''
    );
    if (selectedFileId === id) setSelectedFileId(null);
  };

  const handlePreviewMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (text && previewRef.current && sel && previewRef.current.contains(sel.anchorNode)) {
      setSelectedQuoteText(text);
    }
  };

  const openQuoteModal = () => {
    if (!selectedQuoteText) return;
    setQuoteResult(null);
    setQuoteMode(null);
    setQuoteModalOpen(true);
  };

  const handlePickMode = async (mode: QuoteMode) => {
    setQuoteMode(mode);
    if (mode === 'direct') {
      setQuoteResult(`«${selectedQuoteText}» — [${selectedFile?.fileName || t('knowledgeView.unknownSource')}]`);
      return;
    }
    setQuoteLoading(true);
    setQuoteResult(null);
    try {
      const res = await fetch('/api/ai/knowledge-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selectedQuoteText, mode, sourceName: selectedFile?.fileName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setQuoteResult(data.result);
    } catch {
      setQuoteResult(null);
      setUploadError(t('knowledgeView.quoteError'));
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleInsertIntoSection = () => {
    if (!quoteResult || !insertChapterId || !insertSectionId) return;
    const updatedChapters = book.chapters.map((chap) => {
      if (chap.id !== insertChapterId) return chap;
      return {
        ...chap,
        sections: chap.sections.map((sec) => {
          if (sec.id !== insertSectionId) return sec;
          const nextContent = sec.content ? `${sec.content}\n\n${quoteResult}` : quoteResult;
          return { ...sec, content: nextContent, wordCount: calculateWordCount(nextContent), lastModified: new Date().toISOString() };
        }),
      };
    });
    onUpdateBook(
      { ...book, chapters: updatedChapters },
      'Вставлено цитату з Бази знань у розділ',
      `Джерело: «${selectedFile?.fileName || ''}»`
    );
    setQuoteModalOpen(false);
    setSelectedQuoteText('');
    setInsertToast(t('knowledgeView.insertedToast'));
    setTimeout(() => setInsertToast(null), 3000);
  };

  /** «Проаналізувати текст»: OCR зображення через Tesseract (server/knowledgeRoutes.ts). */
  const handleAnalyzeText = async () => {
    if (!selectedFile || isAnalyzing) return;
    if (selectedFile.fileType !== 'image') {
      setUploadError(t('knowledgeView.ocrImageOnly'));
      return;
    }
    if (!selectedFile.previewImageUrl) {
      setUploadError(t('knowledgeView.processError'));
      return;
    }
    setIsAnalyzing(true);
    setUploadError(null);
    try {
      const res = await fetch('/api/knowledge/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ image: selectedFile.previewImageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'ocr failed');
      const text = (data?.text || '').trim();
      if (!text) throw new Error(t('knowledgeView.ocrEmpty'));
      const updatedFiles = files.map((f) =>
        f.id === selectedFile.id ? { ...f, contentText: text } : f
      );
      onUpdateBook(
        { ...book, knowledgeFiles: updatedFiles },
        'Розпізнано текст у Базі знань (OCR)',
        `«${selectedFile.fileName}» → ${text.length} символів`
      );
    } catch (err) {
      setUploadError((err as Error)?.message || t('knowledgeView.ocrError'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  /** «Зберегти текст в книгу»: дописує розпізнаний текст у поточний розділ книги. */
  const handleSaveTextToBook = () => {
    const text = selectedFile?.contentText?.trim();
    const chapterId = activeChapterId || book.chapters[0]?.id;
    const sectionId = activeSectionId || book.chapters[0]?.sections[0]?.id || '';
    if (!text || !chapterId) return;
    const updatedChapters = book.chapters.map((chap) => {
      if (chap.id !== chapterId) return chap;
      return {
        ...chap,
        sections: chap.sections.map((sec) => {
          if (sec.id !== sectionId) return sec;
          const nextContent = sec.content ? `${sec.content}\n\n${text}` : text;
          return {
            ...sec,
            content: nextContent,
            wordCount: calculateWordCount(nextContent),
            lastModified: new Date().toISOString(),
          };
        }),
      };
    });
    onUpdateBook(
      { ...book, chapters: updatedChapters },
      'Текст із Бази знань збережено в поточний розділ',
      `Джерело: «${selectedFile?.fileName || ''}»`
    );
    setInsertToast(t('knowledgeView.savedToBookToast'));
    setTimeout(() => setInsertToast(null), 3000);
  };

  /** «Передати в чат АІ»: розпізнаний текст іде першим повідомленням обговорення в чаті. */
  const handleSendToChat = () => {
    const text = selectedFile?.contentText?.trim();
    if (!text || !onSendToChat) return;
    onSendToChat(text, `${t('knowledgeView.chatSourceLabel')}: ${selectedFile?.fileName || ''}`);
  };

  const iconFor = (type: KnowledgeFile['fileType']) => (type === 'image' ? FileImage : FileText);

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-5">
      <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
            <Library className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100">{t('knowledgeView.title')}</h1>
            <p className="text-xs text-slate-500">{t('knowledgeView.subtitle', { n: String(files.length) })}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isRegistered && storageInfo && storageInfo.quotaBytes !== null && (
            <div className="text-[11px] text-slate-400 flex items-center gap-2">
              <span className={storageInfo.usedBytes >= storageInfo.quotaBytes ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                {(storageInfo.usedBytes / MB).toFixed(1)} / {(storageInfo.quotaBytes / MB).toFixed(0)} MB
              </span>
              <div className="w-20 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full ${storageInfo.usedBytes >= storageInfo.quotaBytes ? 'bg-rose-500' : 'bg-cyan-500'}`}
                  style={{ width: `${Math.min(100, (storageInfo.usedBytes / storageInfo.quotaBytes) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept=".txt,.md,.docx,image/*,.png,.jpg,.jpeg,.bmp,.webp,.gif,.tif,.tiff,.pbm,.pgm,.ppm" onChange={handleUpload} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50"
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            <span>{isUploading ? t('knowledgeView.uploading') : t('knowledgeView.uploadBtn')}</span>
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
      {insertToast && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
          <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
          <span>{insertToast}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 min-h-[500px]">
        {/* Ліва панель — список файлів */}
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-3 space-y-1.5 h-fit">
          {files.length === 0 ? (
            <p className="text-xs text-slate-500 p-3 text-center">{t('knowledgeView.emptyList')}</p>
          ) : (
            files.map((file) => {
              const Icon = iconFor(file.fileType);
              const isActive = file.id === selectedFileId;
              return (
                <button
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs transition-colors ${
                    isActive ? 'bg-cyan-600/20 border border-cyan-500/40 text-cyan-200' : 'hover:bg-slate-800/80 text-slate-300 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1 font-semibold">{file.fileName}</span>
                  <Trash2
                    className="w-3.5 h-3.5 text-slate-500 hover:text-rose-400 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFile(file.id);
                    }}
                  />
                </button>
              );
            })
          )}
        </div>

        {/* Права панель — прев'ю */}
        <div className="nova-glass-dark rounded-2xl border border-slate-800 p-5 flex flex-col">
          {!selectedFile ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500">{t('knowledgeView.noFileSelected')}</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h3 className="text-sm font-bold text-slate-100">{selectedFile.fileName}</h3>
                {selectedQuoteText && (
                  <button
                    onClick={openQuoteModal}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors"
                  >
                    <Quote className="w-3.5 h-3.5" />
                    <span>{t('knowledgeView.extractQuoteBtn')}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {selectedFile.fileType === 'image' && !selectedFile.contentText && (
                  <button
                    onClick={handleAnalyzeText}
                    disabled={isAnalyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
                    <span>{isAnalyzing ? t('knowledgeView.analyzingBtn') : t('knowledgeView.analyzeBtn')}</span>
                  </button>
                )}
                {selectedFile.contentText && (
                  <>
                    <button
                      onClick={handleSaveTextToBook}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-colors"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>{t('knowledgeView.saveToBookBtn')}</span>
                    </button>
                    <button
                      onClick={handleSendToChat}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{t('knowledgeView.sendToChatBtn')}</span>
                    </button>
                  </>
                )}
              </div>
              {selectedFile.contentText ? (
                <div
                  ref={previewRef}
                  onMouseUp={handlePreviewMouseUp}
                  className="whitespace-pre-wrap text-sm text-slate-300 leading-relaxed select-text max-h-[600px] overflow-y-auto"
                >
                  {selectedFile.contentText}
                </div>
              ) : selectedFile.fileType === 'image' ? (
                <img src={selectedFile.previewImageUrl} alt={selectedFile.fileName} className="max-h-[500px] object-contain rounded-xl mx-auto" />
              ) : (
                <div className="text-sm text-slate-500">{t('knowledgeView.emptyContent')}</div>
              )}
              {selectedFile.contentText && (
                <p className="text-[10px] text-slate-600 mt-3 pt-3 border-t border-slate-800">{t('knowledgeView.selectHint')}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Модалка «AI-цитата» */}
      {quoteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Quote className="w-4 h-4 text-amber-400" />
                {t('knowledgeView.quoteModalTitle')}
              </h3>
              <button onClick={() => setQuoteModalOpen(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 italic line-clamp-3">«{selectedQuoteText}»</p>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handlePickMode('direct')}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${quoteMode === 'direct' ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
              >
                {t('knowledgeView.modeDirect')}
              </button>
              <button
                onClick={() => handlePickMode('paraphrase')}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${quoteMode === 'paraphrase' ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
              >
                {t('knowledgeView.modeParaphrase')}
              </button>
              <button
                onClick={() => handlePickMode('analytical')}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${quoteMode === 'analytical' ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
              >
                {t('knowledgeView.modeAnalytical')}
              </button>
            </div>

            {quoteLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t('knowledgeView.quoteGenerating')}</span>
              </div>
            ) : quoteResult ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200">{quoteResult}</div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={insertChapterId}
                    onChange={(e) => {
                      setInsertChapterId(e.target.value);
                      const chap = book.chapters.find((c) => c.id === e.target.value);
                      setInsertSectionId(chap?.sections[0]?.id || '');
                    }}
                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                  >
                    {book.chapters.map((chap) => (
                      <option key={chap.id} value={chap.id}>
                        {chap.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={insertSectionId}
                    onChange={(e) => setInsertSectionId(e.target.value)}
                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                  >
                    {insertChapter?.sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.title}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleInsertIntoSection}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all active:scale-95"
                >
                  <BookmarkPlus className="w-4 h-4" />
                  <span>{t('knowledgeView.insertBtn')}</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500 text-center py-4 flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                {t('knowledgeView.chooseModeHint')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
