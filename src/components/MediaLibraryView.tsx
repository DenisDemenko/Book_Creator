import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FolderArchive,
  Image as ImageIcon,
  Upload,
  Trash2,
  Download,
  Eye,
  Tag,
  Sparkles,
  Plus,
  CheckCircle2,
  ExternalLink,
  Layers,
  HardDrive
} from 'lucide-react';
import { Book, BookIllustration, AuthUser } from '../types';
import { downloadImageAs } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';
import { compareByImageFormat, detectImageFormat, IMAGE_FORMAT_LABEL } from '../utils/imageFormat';

interface MediaLibraryViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  authUser?: AuthUser | null;
}

interface StorageInfo {
  usedBytes: number;
  quotaBytes: number | null;
  remainingBytes: number | null;
}

const MB = 1024 * 1024;

export const MediaLibraryView: React.FC<MediaLibraryViewProps> = ({ book, onUpdateBook, authUser }) => {
  const [filter, setFilter] = useState<'all' | 'portraits' | 'illustrations' | 'covers'>('all');
  const [selectedMedia, setSelectedMedia] = useState<{ id: string; url: string; title: string; type: string; prompt?: string; source?: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const isRegistered = !!authUser && !authUser.isGuest;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

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
          setStorageInfo({
            usedBytes: data.storage.usedBytes,
            quotaBytes: data.storage.quotaBytes,
            remainingBytes: data.storage.remainingBytes,
          });
        }
      }
    } catch {
      /* тихо — індикатор просто не покажеться */
    }
  }, [isRegistered]);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  // Collect all media items from book
  const allMedia: { id: string; url: string; title: string; type: 'portraits' | 'illustrations' | 'covers'; prompt?: string; source?: string }[] = [];

  // 1. Cover
  if (book.coverConfig.frontArtUrl) {
    allMedia.push({
      id: 'media-cover',
      url: book.coverConfig.frontArtUrl,
      title: t('mediaLibraryView.coverArtTitle'),
      type: 'covers',
    });
  }

  // 2. Character portraits
  book.characters.forEach((char) => {
    if (char.avatarUrl) {
      allMedia.push({
        id: `char-media-${char.id}`,
        url: char.avatarUrl,
        title: t('mediaLibraryView.portraitTitle', { name: `${char.name} ${char.surname || ''}` }),
        type: 'portraits',
      });
    }
  });

  // 3. Chapter illustrations
  (book.illustrations || []).forEach((ill) => {
    allMedia.push({
      id: ill.id,
      url: ill.url,
      title: ill.caption,
      type: 'illustrations',
      prompt: ill.promptUsed,
      source: ill.source,
    });
  });

  // Сортуємо за форматом файлу (JPG → PNG → WEBP → …), як просив автор.
  // Той самий компаратор використовує вікно вставки зображення в текст,
  // тож порядок у галереї та у вставці однаковий.
  const filteredMedia = allMedia
    .filter((m) => filter === 'all' || m.type === filter)
    .sort(compareByImageFormat);

  // Download handler
  const handleDownload = async (url: string, title: string, format: 'png' | 'jpg') => {
    setIsDownloading(true);
    try {
      await downloadImageAs(url, title || 'book-asset', format);
      showToast(t('mediaLibraryView.downloadedToast', { format: format.toUpperCase() }));
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Direct Upload (jpg/png/svg) — з перевіркою ліміту сховища на сервері
  const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!isRegistered) {
      showToast(t('mediaLibraryView.guestUploadBlocked'));
      return;
    }

    setIsUploading(true);
    try {
      const res = await fetch('/api/media/check-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ bytes: file.size, bookId: book.id, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data?.error || t('mediaLibraryView.quotaCheckFailed'));
        if (typeof data?.usedBytes === 'number') {
          setStorageInfo({
            usedBytes: data.usedBytes,
            quotaBytes: data.quotaBytes ?? null,
            remainingBytes: data.remainingBytes ?? null,
          });
        }
        return;
      }
      if (typeof data.usedBytes === 'number') {
        setStorageInfo({
          usedBytes: data.usedBytes,
          quotaBytes: data.quotaBytes ?? null,
          remainingBytes: data.remainingBytes ?? null,
        });
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const newIll: BookIllustration = {
          id: `ill-upload-${Date.now()}`,
          chapterId: book.chapters[0]?.id,
          url: dataUrl,
          caption: file.name.replace(/\.[^/.]+$/, ''),
          aspectRatio: '16:9',
          style: 'Медіатека',
          source: 'upload',
          createdAt: new Date().toISOString(),
          fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        };

        onUpdateBook(
          {
            ...book,
            illustrations: [...(book.illustrations || []), newIll],
          },
          'Завантажено файл у медіатеку',
          `Додано файл «${newIll.caption}»`
        );
        showToast(t('mediaLibraryView.uploadedToast'));
      };
      reader.readAsDataURL(file);
    } catch {
      showToast(t('mediaLibraryView.quotaCheckFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-cyan-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-cyan-400 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
        className="hidden"
        onChange={handleDirectUpload}
      />

      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {t('mediaLibraryView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('mediaLibraryView.subBadge', { n: String(allMedia.length) })}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('mediaLibraryView.pageTitle')}
          </h1>

          {/* Storage usage indicator */}
          {isRegistered && storageInfo && storageInfo.quotaBytes !== null && (
            <div className="mt-2 max-w-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {t('mediaLibraryView.storageUsageLabel')}
                </span>
                <span className={storageInfo.usedBytes >= storageInfo.quotaBytes ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                  {(storageInfo.usedBytes / MB).toFixed(1)} / {(storageInfo.quotaBytes / MB).toFixed(0)} MB
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/50">
                <div
                  className={`h-full rounded-full transition-all ${
                    storageInfo.usedBytes >= storageInfo.quotaBytes ? 'bg-rose-500' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${Math.min(100, (storageInfo.usedBytes / storageInfo.quotaBytes) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Upload Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            data-tour="media__1"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-wait text-white font-bold text-xs shadow-md transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isUploading ? t('mediaLibraryView.uploadingBtn') : t('mediaLibraryView.uploadBtn')}</span>
          </button>

          {/* Filter buttons */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800" data-tour="media__2">
            {(['all', 'illustrations', 'portraits', 'covers'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  filter === f
                    ? 'bg-slate-800 text-cyan-300 shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f === 'all' ? t('mediaLibraryView.filterAll') : f === 'illustrations' ? t('mediaLibraryView.filterIllustrations') : f === 'portraits' ? t('mediaLibraryView.filterPortraits') : t('mediaLibraryView.filterCovers')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Media Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-tour="media__3">
        {filteredMedia.map((item) => (
          <div
            key={item.id}
            className="group rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 hover:border-cyan-500/50 shadow-lg transition-all flex flex-col justify-between"
          >
            <div 
              onClick={() => setSelectedMedia(item)}
              className="h-48 overflow-hidden bg-black flex items-center justify-center relative cursor-pointer"
            >
              <img
                src={item.url}
                alt={item.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300"
              />
              {/* Формат файлу — за ним і відсортовано перелік */}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/60 backdrop-blur-md text-amber-300">
                {IMAGE_FORMAT_LABEL[detectImageFormat(item.url)]}
              </div>
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 backdrop-blur-md text-cyan-300">
                {item.type}
              </div>
            </div>

            <div className="p-3.5 space-y-2">
              <h3 className="text-xs font-bold text-white truncate">{item.title}</h3>
              
              {/* Quick Download Buttons */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase font-mono">
                  {t('mediaLibraryView.exportLabel')}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleDownload(item.url, item.title, 'png')}
                    disabled={isDownloading}
                    className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] font-bold border border-slate-700 flex items-center gap-1 transition-all"
                    title={t('mediaLibraryView.downloadPngLabel')}
                  >
                    <Download className="w-2.5 h-2.5" />
                    <span>PNG</span>
                  </button>
                  <button
                    onClick={() => handleDownload(item.url, item.title, 'jpg')}
                    disabled={isDownloading}
                    className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-bold border border-slate-700 flex items-center gap-1 transition-all"
                    title={t('mediaLibraryView.downloadJpgLabel')}
                  >
                    <Download className="w-2.5 h-2.5" />
                    <span>JPG</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        ))}
      </div>

      {/* High-res Modal */}
      {selectedMedia && (
        <div
          onClick={() => setSelectedMedia(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-slate-800 rounded-3xl max-w-3xl w-full overflow-hidden shadow-2xl space-y-4 p-6 text-white"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-cyan-300">{selectedMedia.title}</h3>
              <button
                onClick={() => setSelectedMedia(null)}
                className="text-slate-400 hover:text-white font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[55vh] overflow-hidden rounded-2xl bg-black flex items-center justify-center border border-slate-800">
              <img
                src={selectedMedia.url}
                alt={selectedMedia.title}
                referrerPolicy="no-referrer"
                className="max-h-[55vh] w-auto object-contain"
              />
            </div>

            {selectedMedia.prompt && (
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
                <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                  {t('mediaLibraryView.promptLabel')}
                </span>
                {selectedMedia.prompt}
              </div>
            )}

            {/* Modal Download bar */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <span className="text-xs text-slate-400">
                {t('mediaLibraryView.saveToComputerLabel')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(selectedMedia.url, selectedMedia.title, 'png')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('mediaLibraryView.downloadPngLabel')}</span>
                </button>
                <button
                  onClick={() => handleDownload(selectedMedia.url, selectedMedia.title, 'jpg')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('mediaLibraryView.downloadJpgLabel')}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
