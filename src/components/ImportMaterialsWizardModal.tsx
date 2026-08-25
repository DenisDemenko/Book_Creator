import React, { useRef, useState } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Images,
  Boxes,
  Check,
  ArrowRight,
  ArrowLeft,
  Trash2,
  ShieldAlert,
  Sparkles,
  ClipboardList,
} from 'lucide-react';
import { Book, BookIllustration, Chapter, CourseMaterial, Model3DFormat, UserRole } from '../types';
import { hasPermission } from '../utils/rbac';
import { parseManuscriptText } from '../utils/manuscriptImport';
import { useLanguage } from '../i18n/LanguageContext';

interface ImportMaterialsWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRole: UserRole;
  onComplete: (result: {
    title: string;
    author: string;
    chapters: Chapter[];
    illustrations: BookIllustration[];
    courseMaterials: CourseMaterial[];
    hasCourse: boolean;
  }) => void;
}

type PendingImage = { id: string; fileName: string; dataUrl: string; sizeLabel: string };
type PendingModel = { id: string; fileName: string; dataUrl: string; format: Model3DFormat; sizeLabel: string };

const STEPS = ['text', 'images', 'models', 'review'] as const;
type StepKey = typeof STEPS[number];

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessModelFormat(fileName: string): Model3DFormat {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'obj' || ext === 'dxf' || ext === 'f3d' || ext === 'stl') return ext;
  return 'stl';
}

export const ImportMaterialsWizardModal: React.FC<ImportMaterialsWizardModalProps> = ({
  isOpen,
  onClose,
  currentRole,
  onComplete,
}) => {
  const { t } = useLanguage();
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  const [stepIdx, setStepIdx] = useState(0);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [manuscriptText, setManuscriptText] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [hasCourse, setHasCourse] = useState(false);
  const [models, setModels] = useState<PendingModel[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const allowed = hasPermission(currentRole, 'canImportBook');
  const step: StepKey = STEPS[stepIdx];

  if (!isOpen) return null;

  const reset = () => {
    setStepIdx(0);
    setTitle('');
    setAuthor('');
    setManuscriptText('');
    setImages([]);
    setHasCourse(false);
    setModels([]);
    setIsBusy(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleTextFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    try {
      const text = await readFileAsText(file);
      setManuscriptText(text);
      if (!title.trim()) {
        setTitle(file.name.replace(/\.(txt|md)$/i, ''));
      }
    } finally {
      setIsBusy(false);
      if (textFileInputRef.current) textFileInputRef.current.value = '';
    }
  };

  const handleImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsBusy(true);
    try {
      const next: PendingImage[] = [];
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        next.push({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: file.name,
          dataUrl,
          sizeLabel: formatSize(file.size),
        });
      }
      setImages((prev) => [...prev, ...next]);
    } finally {
      setIsBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleModelsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsBusy(true);
    try {
      const next: PendingModel[] = [];
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        next.push({
          id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: file.name,
          dataUrl,
          format: guessModelFormat(file.name),
          sizeLabel: formatSize(file.size),
        });
      }
      setModels((prev) => [...prev, ...next]);
    } finally {
      setIsBusy(false);
      if (modelInputRef.current) modelInputRef.current.value = '';
    }
  };

  const preview = parseManuscriptText(manuscriptText, 'preview');
  const canGoNextFromText = title.trim().length > 0 && manuscriptText.trim().length > 0;

  const goNext = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => setStepIdx((i) => Math.max(i - 1, 0));

  const handleFinish = () => {
    const bookId = `BK-${Date.now().toString(36).toUpperCase()}`;
    const parsed = parseManuscriptText(manuscriptText, bookId);
    const now = new Date().toISOString();

    const illustrations: BookIllustration[] = images.map((img, idx) => ({
      id: `il-import-${Date.now()}-${idx}`,
      url: img.dataUrl,
      caption: img.fileName,
      aspectRatio: '1:1',
      style: 'imported',
      source: 'upload',
      createdAt: now,
      fileSize: img.sizeLabel,
    }));

    const courseMaterials: CourseMaterial[] = hasCourse
      ? models.map((m, idx) => ({
          id: `cm-import-${Date.now()}-${idx}`,
          bookId,
          kind: 'model_3d' as const,
          title: m.fileName,
          fileName: m.fileName,
          fileUrl: m.dataUrl,
          fileSize: m.sizeLabel,
          model3DFormat: m.format,
          createdAt: now,
        }))
      : [];

    onComplete({
      title: title.trim(),
      author: author.trim() || 'Невідомий автор',
      chapters: parsed.chapters,
      illustrations,
      courseMaterials,
      hasCourse,
    });
    reset();
    onClose();
  };

  const stepMeta: Record<StepKey, { icon: React.ElementType; label: string }> = {
    text: { icon: FileText, label: t('importWizard.stepText') },
    images: { icon: Images, label: t('importWizard.stepImages') },
    models: { icon: Boxes, label: t('importWizard.stepModels') },
    review: { icon: ClipboardList, label: t('importWizard.stepReview') },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/20 text-violet-300 border border-violet-500/30">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('importWizard.heading')}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t('importWizard.desc')}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!allowed ? (
          <div className="p-6">
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-300">{t('importBookModal.accessDeniedHeading')}</p>
                <p className="text-rose-200/80 mt-1 text-xs">{t('importBookModal.accessDeniedDesc')}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Stepper */}
            <div className="px-6 pt-4 flex items-center gap-2 text-xs">
              {STEPS.map((s, idx) => {
                const meta = stepMeta[s];
                const Icon = meta.icon;
                const isActive = idx === stepIdx;
                const isDone = idx < stepIdx;
                return (
                  <React.Fragment key={s}>
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold ${
                        isActive
                          ? 'bg-violet-500/20 text-violet-200 border border-violet-500/50'
                          : isDone
                            ? 'text-emerald-300'
                            : 'text-slate-500'
                      }`}
                    >
                      {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">{meta.label}</span>
                    </div>
                    {idx < STEPS.length - 1 && <div className="flex-1 h-px bg-slate-800" />}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[62vh]">
              {step === 'text' && (
                <div className="space-y-4">
                  <p className="text-slate-400">{t('importWizard.textStepIntro')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-300 font-bold block mb-1.5">
                        {t('importWizard.titleLabel')} <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('importWizard.titlePlaceholder')}
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white focus:border-violet-400 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-medium block mb-1.5">{t('importWizard.authorLabel')}</label>
                      <input
                        type="text"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        placeholder={t('importWizard.authorPlaceholder')}
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white focus:border-violet-400 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-slate-300 font-bold">
                        {t('importWizard.textLabel')} <span className="text-rose-400">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => textFileInputRef.current?.click()}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center gap-1.5"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        {t('importWizard.uploadTxtBtn')}
                      </button>
                      <input
                        ref={textFileInputRef}
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        className="hidden"
                        onChange={handleTextFileChange}
                      />
                    </div>
                    <textarea
                      value={manuscriptText}
                      onChange={(e) => setManuscriptText(e.target.value)}
                      rows={8}
                      placeholder={t('importWizard.textPlaceholder')}
                      className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:border-violet-400 focus:outline-hidden resize-none font-mono"
                    />
                    {manuscriptText.trim() && (
                      <p className="text-slate-500 mt-1.5">
                        {preview.headingsDetected
                          ? t('importWizard.previewWithHeadings', { n: preview.chapters.length, words: preview.totalWords })
                          : t('importWizard.previewNoHeadings', { words: preview.totalWords })}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {step === 'images' && (
                <div className="space-y-4">
                  <p className="text-slate-400">{t('importWizard.imagesStepIntro')}</p>
                  <div
                    onClick={() => imageInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-violet-400/60 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-slate-950/50"
                  >
                    <Images className="w-7 h-7 text-violet-400" />
                    <p className="text-slate-200 font-semibold">{t('importWizard.imagesDropHint')}</p>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImagesChange}
                    />
                  </div>
                  {images.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {images.map((img) => (
                        <div key={img.id} className="relative group rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                          <img src={img.dataUrl} alt={img.fileName} className="w-full h-20 object-cover" />
                          <button
                            type="button"
                            onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                            className="absolute top-1 right-1 p-1 rounded-md bg-slate-950/80 text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <div className="px-1 py-0.5 text-[9px] text-slate-400 truncate">{img.fileName}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-slate-500">{t('importWizard.imagesCount', { n: images.length })}</p>
                </div>
              )}

              {step === 'models' && (
                <div className="space-y-4">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasCourse}
                      onChange={(e) => setHasCourse(e.target.checked)}
                      className="w-4 h-4 accent-violet-500"
                    />
                    <span className="text-slate-200 font-semibold">{t('importWizard.hasCourseToggle')}</span>
                  </label>
                  <p className="text-slate-500">{t('importWizard.modelsStepIntro')}</p>

                  {hasCourse && (
                    <>
                      <div
                        onClick={() => modelInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-700 hover:border-violet-400/60 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-slate-950/50"
                      >
                        <Boxes className="w-7 h-7 text-violet-400" />
                        <p className="text-slate-200 font-semibold">{t('importWizard.modelsDropHint')}</p>
                        <p className="text-slate-500">{t('importWizard.modelsFormats')}</p>
                        <input
                          ref={modelInputRef}
                          type="file"
                          accept=".stl,.obj,.dxf,.f3d"
                          multiple
                          className="hidden"
                          onChange={handleModelsChange}
                        />
                      </div>
                      {models.length > 0 && (
                        <div className="space-y-1.5">
                          {models.map((m) => (
                            <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                              <div className="flex items-center gap-2 min-w-0">
                                <Boxes className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                                <span className="truncate">{m.fileName}</span>
                                <span className="text-slate-500 uppercase shrink-0">.{m.format}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setModels((prev) => prev.filter((x) => x.id !== m.id))}
                                className="p-1 rounded-md text-rose-300 hover:bg-rose-500/10"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'review' && (
                <div className="space-y-3">
                  <p className="text-slate-400">{t('importWizard.reviewIntro')}</p>
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="font-bold text-slate-100">{title || t('importWizard.untitled')}</div>
                    <div className="text-slate-500">{author || '—'}</div>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                      <div>
                        <div className="text-slate-500">{t('importWizard.reviewChapters')}</div>
                        <div className="text-slate-100 font-bold">{preview.chapters.length}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">{t('importWizard.reviewImages')}</div>
                        <div className="text-slate-100 font-bold">{images.length}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">{t('importWizard.reviewModels')}</div>
                        <div className="text-slate-100 font-bold">{hasCourse ? models.length : 0}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer nav */}
            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={stepIdx === 0 ? handleClose : goBack}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {stepIdx === 0 ? t('importWizard.cancel') : t('importWizard.back')}
              </button>

              {step !== 'review' ? (
                <button
                  type="button"
                  disabled={(step === 'text' && !canGoNextFromText) || isBusy}
                  onClick={goNext}
                  className="px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold transition-colors flex items-center gap-2 disabled:opacity-40 shadow-md"
                >
                  <span>{t('importWizard.next')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinish}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition-colors flex items-center gap-2 shadow-md"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>{t('importWizard.finish')}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
