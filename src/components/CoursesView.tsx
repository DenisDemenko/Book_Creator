import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GraduationCap,
  Search,
  Tag,
  Trash2,
  Plus,
  Youtube,
  Image as ImageIcon,
  FileText,
  Box,
  Save,
  Download,
  ArrowRight,
  X,
  HardDrive,
  CheckCircle2,
  Loader2,
  Package,
} from 'lucide-react';
import { Book, AuthUser, CourseMaterial, CourseMaterialKind, Model3DFormat } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { exportCourseToZip } from '../utils/courseExporter';
import { Model3DViewer } from './Model3DViewer';

interface CoursesViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToSection?: (chapterId: string, sectionId: string) => void;
  onSaveBook?: () => void;
  authUser?: AuthUser | null;
}

interface StorageInfo {
  usedBytes: number;
  quotaBytes: number | null;
  remainingBytes: number | null;
}

const MB = 1024 * 1024;

const MODEL_EXT_TO_FORMAT: Record<string, Model3DFormat> = {
  dxf: 'dxf',
  f3d: 'f3d',
  obj: 'obj',
  stl: 'stl',
};

export const CoursesView: React.FC<CoursesViewProps> = ({ book, onUpdateBook, onNavigateToSection, onSaveBook, authUser }) => {
  const { t } = useLanguage();
  const isRegistered = !!authUser && !authUser.isGuest;

  const course = book.course;
  const tags = course?.tags || [];
  const materials = course?.materials || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [addModalKind, setAddModalKind] = useState<CourseMaterialKind | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [previewMaterial, setPreviewMaterial] = useState<CourseMaterial | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add-material form fields (shared across all four kinds)
  const [formTitle, setFormTitle] = useState('');
  const [formYoutubeUrl, setFormYoutubeUrl] = useState('');
  const [formHomeworkFormat, setFormHomeworkFormat] = useState<'pdf' | 'docx'>('pdf');

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
      /* тихо */
    }
  }, [isRegistered]);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  const findLocation = (chapterId: string, sectionId: string) => {
    const chapter = book.chapters.find((c) => c.id === chapterId);
    const section = chapter?.sections.find((s) => s.id === sectionId);
    return { chapterTitle: chapter?.title || '', sectionTitle: section?.title || '' };
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredTags = q
    ? tags.filter((tag) => {
        const { chapterTitle, sectionTitle } = findLocation(tag.chapterId, tag.sectionId);
        return (
          tag.label.toLowerCase().includes(q) ||
          tag.textSnippet.toLowerCase().includes(q) ||
          chapterTitle.toLowerCase().includes(q) ||
          sectionTitle.toLowerCase().includes(q)
        );
      })
    : tags;

  const selectedTag = selectedTagId ? tags.find((tg) => tg.id === selectedTagId) || null : null;
  const contextMaterials = selectedTagId
    ? materials.filter((m) => m.tagId === selectedTagId)
    : materials.filter((m) => !m.tagId);

  const handleEnableCourse = () => {
    onUpdateBook({
      ...book,
      course: course || { enabled: true, title: book.title, tags: [], materials: [] },
    });
  };

  const handleUpdateCourseMeta = (patch: Partial<{ title: string; description: string }>) => {
    onUpdateBook({
      ...book,
      course: {
        ...(course || { enabled: true, title: book.title, tags: [], materials: [] }),
        ...patch,
      },
    });
  };

  const handleDeleteTag = (tagId: string) => {
    onUpdateBook({
      ...book,
      course: {
        ...(course || { enabled: true, title: book.title, tags: [], materials: [] }),
        tags: tags.filter((tg) => tg.id !== tagId),
        materials: materials.filter((m) => m.tagId !== tagId),
      },
    });
    if (selectedTagId === tagId) setSelectedTagId(null);
  };

  const handleDeleteMaterial = (materialId: string) => {
    onUpdateBook({
      ...book,
      course: {
        ...(course || { enabled: true, title: book.title, tags: [], materials: [] }),
        materials: materials.filter((m) => m.id !== materialId),
      },
    });
  };

  const appendMaterial = (material: CourseMaterial) => {
    onUpdateBook(
      {
        ...book,
        course: {
          ...(course || { enabled: true, title: book.title, tags: [], materials: [] }),
          materials: [...materials, material],
        },
      },
      'Додано матеріал курсу',
      `Додано «${material.title}» (${material.kind})`
    );
  };

  const closeAddModal = () => {
    setAddModalKind(null);
    setFormTitle('');
    setFormYoutubeUrl('');
    setFormHomeworkFormat('pdf');
  };

  const handleAddYoutube = () => {
    if (!formTitle.trim() || !formYoutubeUrl.trim()) return;
    appendMaterial({
      id: `course-mat-${Date.now()}`,
      bookId: book.id,
      tagId: selectedTagId || undefined,
      chapterId: selectedTag?.chapterId,
      sectionId: selectedTag?.sectionId,
      kind: 'youtube',
      title: formTitle.trim(),
      youtubeUrl: formYoutubeUrl.trim(),
      createdAt: new Date().toISOString(),
    });
    closeAddModal();
  };

  const handleFileMaterialUpload = async (e: React.ChangeEvent<HTMLInputElement>, kind: CourseMaterialKind) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !formTitle.trim()) return;

    if (!isRegistered) {
      showToast(t('coursesView.guestUploadBlocked'));
      return;
    }

    let model3DFormat: Model3DFormat | undefined;
    if (kind === 'model_3d') {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      model3DFormat = MODEL_EXT_TO_FORMAT[ext];
      if (!model3DFormat) {
        showToast(t('coursesView.unsupportedModelFormat'));
        return;
      }
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
        showToast(data?.error || t('coursesView.quotaCheckFailed'));
        if (typeof data?.usedBytes === 'number') {
          setStorageInfo({ usedBytes: data.usedBytes, quotaBytes: data.quotaBytes ?? null, remainingBytes: data.remainingBytes ?? null });
        }
        return;
      }
      if (typeof data.usedBytes === 'number') {
        setStorageInfo({ usedBytes: data.usedBytes, quotaBytes: data.quotaBytes ?? null, remainingBytes: data.remainingBytes ?? null });
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        appendMaterial({
          id: `course-mat-${Date.now()}`,
          bookId: book.id,
          tagId: selectedTagId || undefined,
          chapterId: selectedTag?.chapterId,
          sectionId: selectedTag?.sectionId,
          kind,
          title: formTitle.trim(),
          fileName: file.name,
          fileUrl: dataUrl,
          fileSize: `${(file.size / 1024).toFixed(1)} KB`,
          homeworkFormat: kind === 'homework' ? formHomeworkFormat : undefined,
          model3DFormat,
          createdAt: new Date().toISOString(),
        });
        showToast(t('coursesView.materialAddedToast'));
        closeAddModal();
      };
      reader.readAsDataURL(file);
    } catch {
      showToast(t('coursesView.quotaCheckFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportCourseToZip(book);
      showToast(t('coursesView.exportedToast'));
    } catch (err) {
      console.error('[CoursesView] export error:', err);
      showToast(t('coursesView.exportFailedToast'));
    } finally {
      setIsExporting(false);
    }
  };

  const materialKindMeta: Record<CourseMaterialKind, { label: string; icon: React.FC<any>; accept?: string }> = {
    youtube: { label: t('coursesView.kindYoutube'), icon: Youtube },
    photo: { label: t('coursesView.kindPhoto'), icon: ImageIcon, accept: 'image/png, image/jpeg, image/jpg, image/webp' },
    homework: { label: t('coursesView.kindHomework'), icon: FileText, accept: '.pdf,.doc,.docx' },
    model_3d: { label: t('coursesView.kindModel3D'), icon: Box, accept: '.dxf,.f3d,.obj,.stl' },
  };

  if (!course?.enabled) {
    return (
      <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100">
        <div className="max-w-lg mx-auto mt-16 text-center space-y-4 p-8 rounded-2xl bg-slate-950/90 border border-slate-800">
          <GraduationCap className="w-10 h-10 mx-auto text-amber-400" />
          <h1 className="text-lg font-bold text-white font-heading">{t('coursesView.introTitle')}</h1>
          <p className="text-xs text-slate-400 leading-relaxed">{t('coursesView.introText')}</p>
          <button
            onClick={handleEnableCourse}
            data-tour="courses__1"
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-lg transition-all"
          >
            {t('coursesView.enableCourseBtn')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6">

      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-amber-400 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {t('coursesView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('coursesView.headerSubBadge', { tags: String(tags.length), materials: String(materials.length) })}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">{t('coursesView.pageTitle')}</h1>

          {isRegistered && storageInfo && storageInfo.quotaBytes !== null && (
            <div className="mt-2 max-w-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {t('coursesView.storageUsageLabel')}
                </span>
                <span className={storageInfo.usedBytes >= storageInfo.quotaBytes ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                  {(storageInfo.usedBytes / MB).toFixed(1)} / {(storageInfo.quotaBytes / MB).toFixed(0)} MB
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/50">
                <div
                  className={`h-full rounded-full transition-all ${storageInfo.usedBytes >= storageInfo.quotaBytes ? 'bg-rose-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, (storageInfo.usedBytes / storageInfo.quotaBytes) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {onSaveBook && (
            <button
              onClick={onSaveBook}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs shadow-md transition-all active:scale-95"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('coursesView.saveBtn')}</span>
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={isExporting}
            data-tour="courses__4"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all active:scale-95"
            title={t('coursesView.exportTooltip')}
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
            <span>{isExporting ? t('coursesView.exportingBtn') : t('coursesView.exportBtn')}</span>
          </button>
        </div>
      </div>

      {/* Course title / description */}
      <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('coursesView.courseTitleLabel')}</label>
          <input
            type="text"
            value={course.title}
            onChange={(e) => handleUpdateCourseMeta({ title: e.target.value })}
            className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white font-bold"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('coursesView.courseDescriptionLabel')}</label>
          <input
            type="text"
            value={course.description || ''}
            onChange={(e) => handleUpdateCourseMeta({ description: e.target.value })}
            placeholder={t('coursesView.courseDescriptionPlaceholder')}
            className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left: Tags list with search */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4" data-tour="courses__2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('coursesView.searchPlaceholder')}
                className="w-full pl-8 pr-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              />
            </div>

            {/* "General materials" pseudo-tag */}
            <button
              onClick={() => setSelectedTagId(null)}
              className={`w-full text-left p-3 rounded-xl border transition-all text-xs ${
                selectedTagId === null ? 'bg-amber-500/20 border-amber-500/50' : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
                  {t('coursesView.generalMaterialsLabel')}
                </span>
                <span className="text-[10px] text-slate-400">
                  {materials.filter((m) => !m.tagId).length}
                </span>
              </div>
            </button>

            {filteredTags.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 space-y-2">
                <Tag className="w-6 h-6 mx-auto text-slate-600" />
                <p className="text-xs">{tags.length === 0 ? t('coursesView.noTagsYet') : t('coursesView.noTagsMatch')}</p>
                {tags.length === 0 && <p className="text-[10px] text-slate-600">{t('coursesView.noTagsHint')}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTags.map((tag) => {
                  const { chapterTitle, sectionTitle } = findLocation(tag.chapterId, tag.sectionId);
                  const tagMaterialCount = materials.filter((m) => m.tagId === tag.id).length;
                  return (
                    <div
                      key={tag.id}
                      onClick={() => setSelectedTagId(tag.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all group ${
                        selectedTagId === tag.id ? 'bg-amber-500/20 border-amber-500/50' : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Tag className="w-3 h-3 text-amber-400 shrink-0" />
                            <span className="font-bold text-white text-xs truncate">{tag.label}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">{chapterTitle} → {sectionTitle}</p>
                          <p className="text-[10px] text-slate-400 italic truncate mt-1">"{tag.textSnippet}"</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400">{tagMaterialCount}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id); }}
                            className="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {onNavigateToSection && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onNavigateToSection(tag.chapterId, tag.sectionId); }}
                          className="mt-2 flex items-center gap-1 text-[10px] text-amber-400 hover:underline"
                        >
                          {t('coursesView.goToEditorBtn')}
                          <ArrowRight className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Materials manager for selected context */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                {selectedTag ? <Tag className="w-4 h-4" /> : <GraduationCap className="w-4 h-4" />}
                {selectedTag ? selectedTag.label : t('coursesView.generalMaterialsLabel')}
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap" data-tour="courses__3">
                {(Object.keys(materialKindMeta) as CourseMaterialKind[]).map((kind) => {
                  const meta = materialKindMeta[kind];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={kind}
                      onClick={() => setAddModalKind(kind)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-[11px] transition-all"
                    >
                      <Icon className="w-3 h-3" />
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {contextMaterials.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-2xl text-slate-500 space-y-2">
                <Plus className="w-6 h-6 mx-auto text-slate-600" />
                <p className="text-xs">{t('coursesView.noMaterialsYet')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {contextMaterials.map((m) => {
                  const meta = materialKindMeta[m.kind];
                  const Icon = meta.icon;
                  return (
                    <div key={m.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 group">
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-white min-w-0">
                          <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="truncate">{m.title}</span>
                        </span>
                        <button
                          onClick={() => handleDeleteMaterial(m.id)}
                          className="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {m.kind === 'photo' && m.fileUrl && (
                        <img
                          src={m.fileUrl}
                          alt={m.title}
                          onClick={() => setPreviewMaterial(m)}
                          className="w-full h-28 object-cover rounded-lg cursor-pointer"
                        />
                      )}

                      {m.kind === 'youtube' && m.youtubeUrl && (
                        <a
                          href={m.youtubeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-rose-400 hover:underline truncate block font-mono"
                        >
                          {m.youtubeUrl}
                        </a>
                      )}

                      {m.kind === 'homework' && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 uppercase font-bold">{m.homeworkFormat}</span>
                          <span className="truncate">{m.fileName}</span>
                        </div>
                      )}

                      {m.kind === 'model_3d' && (
                        <button
                          onClick={() => setPreviewMaterial(m)}
                          className="w-full text-[10px] text-amber-400 hover:underline flex items-center gap-1"
                        >
                          <Box className="w-3 h-3" />
                          {t('coursesView.previewModelBtn')} ({m.model3DFormat})
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ADD MATERIAL MODAL */}
      {addModalKind && (
        <div onClick={closeAddModal} className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 text-white space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                {React.createElement(materialKindMeta[addModalKind].icon, { className: 'w-5 h-5 text-amber-400' })}
                <h3 className="text-sm font-bold">{materialKindMeta[addModalKind].label}</h3>
              </div>
              <button onClick={closeAddModal} className="text-slate-400 hover:text-white font-bold"><X className="w-4 h-4" /></button>
            </div>

            <p className="text-[11px] text-slate-500">
              {selectedTag ? t('coursesView.addingToTagLabel', { tag: selectedTag.label }) : t('coursesView.addingToGeneralLabel')}
            </p>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('coursesView.materialTitleLabel')}</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder={t('coursesView.materialTitlePlaceholder')}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
              />
            </div>

            {addModalKind === 'youtube' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('coursesView.youtubeUrlLabel')}</label>
                <input
                  type="text"
                  value={formYoutubeUrl}
                  onChange={(e) => setFormYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 font-mono"
                />
              </div>
            )}

            {addModalKind === 'homework' && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('coursesView.homeworkFormatLabel')}</label>
                <select
                  value={formHomeworkFormat}
                  onChange={(e) => setFormHomeworkFormat(e.target.value as 'pdf' | 'docx')}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  <option value="pdf">PDF</option>
                  <option value="docx">Word (docx)</option>
                </select>
              </div>
            )}

            {addModalKind !== 'youtube' && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={materialKindMeta[addModalKind].accept}
                  className="hidden"
                  onChange={(e) => handleFileMaterialUpload(e, addModalKind)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!formTitle.trim() || isUploading}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-2"
                >
                  {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{isUploading ? t('coursesView.uploadingBtn') : t('coursesView.chooseFileBtn')}</span>
                </button>
                {addModalKind === 'model_3d' && (
                  <p className="text-[10px] text-slate-500 mt-1.5">{t('coursesView.model3DFormatsHint')}</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closeAddModal} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs">
                {t('coursesView.cancel')}
              </button>
              {addModalKind === 'youtube' && (
                <button
                  onClick={handleAddYoutube}
                  disabled={!formTitle.trim() || !formYoutubeUrl.trim()}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs"
                >
                  {t('coursesView.addMaterialBtn')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PREVIEW MODAL (photo / 3D model) */}
      {previewMaterial && (
        <div onClick={() => setPreviewMaterial(null)} className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-slate-950 border border-slate-800 rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-4 p-6 text-white">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-amber-300">{previewMaterial.title}</h3>
              <button onClick={() => setPreviewMaterial(null)} className="text-slate-400 hover:text-white font-bold text-lg">✕</button>
            </div>
            {previewMaterial.kind === 'photo' && previewMaterial.fileUrl && (
              <img src={previewMaterial.fileUrl} alt={previewMaterial.title} className="max-h-[60vh] w-auto mx-auto object-contain rounded-xl" />
            )}
            {previewMaterial.kind === 'model_3d' && previewMaterial.fileUrl && previewMaterial.model3DFormat && (
              <Model3DViewer
                fileUrl={previewMaterial.fileUrl}
                format={previewMaterial.model3DFormat}
                fileName={previewMaterial.fileName}
                heightClassName="h-96"
              />
            )}
          </div>
        </div>
      )}

    </div>
  );
};
