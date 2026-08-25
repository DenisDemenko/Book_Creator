import React, { useState, useRef } from 'react';
import { 
  Palette, 
  Sparkles, 
  Image as ImageIcon, 
  Plus, 
  Trash2, 
  Layers, 
  Wand2, 
  Check, 
  Copy, 
  Download, 
  Sun, 
  Eye, 
  Sliders, 
  Upload, 
  CheckCircle2, 
  Cpu, 
  Film, 
  Terminal,
  ExternalLink,
  BookOpen,
  PenLine
} from 'lucide-react';
import { Book, VisualBible, BookIllustration } from '../types';
import { downloadImageAs } from '../utils/helpers';
import { placeholderImage, isGuestRestriction } from '../utils/placeholders';
import { GenerateIllustrationModal } from './GenerateIllustrationModal';
import { GenerateTextFromImageModal } from './GenerateTextFromImageModal';
import { useLanguage } from '../i18n/LanguageContext';

interface IllustrationsViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
}

export type IllustrationEngine = 'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro';

export const IllustrationsView: React.FC<IllustrationsViewProps> = ({ book, onUpdateBook }) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'generator' | 'upload' | 'bible' | 'gallery'>('generator');
  
  // Model engine & style
  const [selectedEngine, setSelectedEngine] = useState<IllustrationEngine>('nano-banana-2');
  const [selectedStyle, setSelectedStyle] = useState(book.visualBible.artStyle);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  
  // Prompt states
  const [promptSubject, setPromptSubject] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState(book.chapters[0]?.id || '');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, distorted anatomy, extra limbs, bad eyes, text, watermark');
  
  // Preview
  const [previewResult, setPreviewResult] = useState<{
    imageUrl: string;
    promptUsed: string;
    modelUsed: string;
    aspectRatio: string;
    caption: string;
  } | null>(null);

  // Upload local file state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadCaption, setUploadCaption] = useState<string>('');
  const [uploadChapterId, setUploadChapterId] = useState<string>(book.chapters[0]?.id || '');
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  // Quick Modal State
  const [showFullModal, setShowFullModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // ШІ-текст «за мотивами» зображення: модалка відкривається або для ще
  // незбереженого прев'ю (тоді текст осідає в previewGeneratedText і
  // потрапляє в книгу разом зі збереженням ілюстрації), або для вже
  // збереженої ілюстрації з галереї (тоді пишемо просто в book.illustrations).
  const [textModalTarget, setTextModalTarget] = useState<{
    imageUrl: string;
    caption: string;
    illustrationId?: string;
    initialText?: string;
    initialEngine?: string;
  } | null>(null);
  const [previewGeneratedText, setPreviewGeneratedText] = useState<string>('');
  const [previewGeneratedTextEngine, setPreviewGeneratedTextEngine] = useState<string>('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const stylePresets = [
    'Кінематографічний кіберпанк / Нео-нуар',
    'Концепт-арт до фільму',
    'Олійний живопис / Класика',
    'Акварельна ілюстрація',
    'Графічний роман / Комікс',
    'Аніме / Манґа стиль',
    'Вінтажне темне фентезі',
    'Мінімалістична гравюра',
  ];

  const engineOptions: { id: IllustrationEngine; name: string; tag: string; badgeColor: string }[] = [
    { id: 'nano-banana-2-lite', name: 'Nano Banana 2 Lite', tag: t('illustrationsView.engineTagLite'), badgeColor: 'bg-slate-500/10 text-slate-300 border-slate-500/40' },
    { id: 'nano-banana-2', name: 'Nano Banana 2', tag: t('illustrationsView.engineTagStandard'), badgeColor: 'bg-amber-500/10 text-amber-300 border-amber-500/40' },
    { id: 'nano-banana-pro', name: 'Nano Banana Pro', tag: t('illustrationsView.engineTagPro'), badgeColor: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/40' },
  ];

  // Update Visual Bible
  const handleUpdateBible = (updated: VisualBible) => {
    onUpdateBook({ ...book, visualBible: updated }, 'Оновлення Visual Bible', `Змінено візуальний канон роману: ${updated.artStyle}`);
    showToast(t('illustrationsView.toastVisualBibleUpdated'));
  };

  // Generate structured prompt via AI from scene/chapter
  const handleAutoGeneratePrompt = async () => {
    setIsGeneratingPrompt(true);
    try {
      const chap = book.chapters.find((c) => c.id === selectedChapterId);
      const textToAnalyze = promptSubject || (chap ? `${chap.title}: ${chap.description || 'Ключова сцена'}` : 'Сцена роману');
      
      const res = await fetch('/api/ai/craft-illustration-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: textToAnalyze,
          model: selectedEngine,
          stylePreset: selectedStyle,
          aspectRatio: aspectRatio,
          genre: book.genre,
          bookTitle: book.title,
          chapterTitle: chap?.title,
          visualBible: book.visualBible,
          // Рушій ТЕКСТУ для складання промту — той самий, що письменник
          // обрав у чаті («рушій книги»), а не жорстко Gemini.
          modelId: book.preferredAiModelId,
          bookId: book.id,
        }),
      });

      const data = await res.json();
      if (data.prompt) {
        setGeneratedPrompt(data.prompt);
        if (data.negativePrompt) setNegativePrompt(data.negativePrompt);
        if (!promptSubject && data.sceneSummaryUa) {
          setPromptSubject(data.sceneSummaryUa);
        }
        showToast(t('illustrationsView.toastAiPromptCrafted'));
      }
    } catch (err) {
      console.error('Error generating prompt:', err);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // Generate image
  const handleGenerateArtwork = async () => {
    setIsGeneratingImage(true);
    setPreviewResult(null);
    try {
      const chap = book.chapters.find((c) => c.id === selectedChapterId);
      const res = await fetch('/api/ai/generate-illustration-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: promptSubject || chap?.description || 'Сцена книги',
          prompt: generatedPrompt || undefined,
          model: selectedEngine,
          stylePreset: selectedStyle,
          aspectRatio: aspectRatio,
          genre: book.genre,
          bookTitle: book.title,
          chapterTitle: chap?.title,
          visualBible: book.visualBible,
          // Рушій ТЕКСТУ для авто-складання промту зі сцени (коли `prompt`
          // не задано вручну) — «рушій книги», не жорстко Gemini.
          textModelId: book.preferredAiModelId,
          bookId: book.id,
        }),
      });

      const data = await res.json();

      // Гість не витрачає платні генерації — показуємо демонстраційну заглушку.
      if (isGuestRestriction(res.status, data)) {
        const caption = promptSubject || chap?.title || 'Ілюстрація розділу';
        setPreviewResult({
          imageUrl: placeholderImage({ caption, aspectRatio, kind: 'scene' }),
          promptUsed: generatedPrompt || t('illustrationsView.guestPromptFallback'),
          modelUsed: t('illustrationsView.guestModelUsedFallback'),
          aspectRatio,
          caption,
        });
        showToast(data.error || t('illustrationsView.toastGuestRestricted'));
        return;
      }
      if (!res.ok) {
        showToast(data.error || t('illustrationsView.toastGenFailed'));
        return;
      }

      if (data.imageUrl) {
        setPreviewResult({
          imageUrl: data.imageUrl,
          promptUsed: data.promptUsed,
          modelUsed: data.modelUsed,
          aspectRatio: data.aspectRatio || aspectRatio,
          caption: promptSubject || data.sceneSummaryUa || 'Ілюстрація розділу',
        });
        showToast(t('illustrationsView.toastIllustrationGenerated', { model: data.modelUsed }));
      }
    } catch (err) {
      console.error('Error generating image:', err);
      showToast(t('illustrationsView.toastServerUnavailable'));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Save image to book illustrations
  const handleSaveToBook = () => {
    if (!previewResult) return;
    const newIll: BookIllustration = {
      id: `ill-${Date.now()}`,
      chapterId: selectedChapterId,
      url: previewResult.imageUrl,
      caption: previewResult.caption || 'Ілюстрація до глави',
      promptUsed: previewResult.promptUsed,
      negativePrompt: negativePrompt,
      aspectRatio: previewResult.aspectRatio,
      style: selectedStyle,
      modelUsed: previewResult.modelUsed,
      modelKey: selectedEngine,
      source: 'ai',
      createdAt: new Date().toISOString(),
      generatedText: previewGeneratedText || undefined,
      generatedTextEngine: previewGeneratedText ? previewGeneratedTextEngine : undefined,
    };

    onUpdateBook(
      {
        ...book,
        illustrations: [...(book.illustrations || []), newIll],
      },
      'Додано нову ілюстрацію',
      `Ілюстрація «${newIll.caption}» (${newIll.modelUsed}) додана до глави`
    );

    showToast(t('illustrationsView.toastSavedToBook'));
    setPreviewGeneratedText('');
    setPreviewGeneratedTextEngine('');
    setActiveTab('gallery');
  };

  // Зберегти ШІ-текст сцени у вже існуючу ілюстрацію галереї.
  const handleSaveTextToIllustration = (illustrationId: string, text: string, engine: string) => {
    const updated = (book.illustrations || []).map((ill) =>
      ill.id === illustrationId ? { ...ill, generatedText: text, generatedTextEngine: engine } : ill
    );
    onUpdateBook(
      { ...book, illustrations: updated },
      'ШІ-текст за зображенням',
      `Додано/оновлено чернетку тексту сцени для ілюстрації (${engine === 'gpt' ? 'GPT' : 'Gemini'}).`
    );
    showToast(t('illustrationsView.toastTextSaved'));
  };

  // Download artwork in PNG or JPG
  const handleDownload = async (imageUrl: string, title: string, format: 'png' | 'jpg') => {
    setIsDownloading(true);
    try {
      await downloadImageAs(imageUrl, title || 'illustration', format);
      showToast(t('illustrationsView.toastDownloaded', { format: format.toUpperCase() }));
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Delete illustration
  const handleDeleteIllustration = (id: string, caption: string) => {
    const updated = (book.illustrations || []).filter((i) => i.id !== id);
    onUpdateBook(
      { ...book, illustrations: updated },
      'Видалення ілюстрації',
      `Вилучено ілюстрацію «${caption}»`
    );
    showToast(t('illustrationsView.toastDeleted'));
  };

  // Handle local image file upload
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setUploadCaption(file.name.replace(/\.[^/.]+$/, ''));
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadPreviewUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveUploadedArtwork = () => {
    if (!uploadPreviewUrl) return;
    const newIll: BookIllustration = {
      id: `ill-upload-${Date.now()}`,
      chapterId: uploadChapterId,
      url: uploadPreviewUrl,
      caption: uploadCaption.trim() || 'Завантажена ілюстрація',
      aspectRatio: '16:9',
      style: 'Власна графіка',
      source: 'upload',
      createdAt: new Date().toISOString(),
      fileSize: uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB` : undefined,
    };

    onUpdateBook(
      {
        ...book,
        illustrations: [...(book.illustrations || []), newIll],
      },
      'Завантажено власну ілюстрацію',
      `Файл «${newIll.caption}» додано до галереї книги`
    );

    setUploadFile(null);
    setUploadPreviewUrl(null);
    setUploadCaption('');
    showToast(t('illustrationsView.toastUploadAdded'));
    setActiveTab('gallery');
  };

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-6 relative">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-amber-400 text-xs animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Banner */}
      <div className="nova-glass-dark rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {t('illustrationsView.headerBadge')}
            </span>
            <span className="text-xs text-slate-400">
              {t('illustrationsView.headerSubBadge', { n: String(engineOptions.length) })}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-heading">
            {t('illustrationsView.headerTitle')}
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab('generator')}
            data-tour="illustrations__1"
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'generator'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t('illustrationsView.tabGeneratorBtn')}
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'upload'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t('illustrationsView.tabUploadBtn')}
          </button>
          <button
            onClick={() => setActiveTab('bible')}
            data-tour="illustrations__5"
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'bible'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t('illustrationsView.tabBibleBtn')}
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'gallery'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t('illustrationsView.tabGalleryBtn', { n: String(book.illustrations?.length || 0) })}
          </button>
        </div>
      </div>

      {/* TAB 1: STUDIO GENERATOR */}
      {activeTab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Controls (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  {t('illustrationsView.genParamsHeading')}
                </h3>
                <span className="text-[10px] text-slate-400">{t('illustrationsView.aiServicesCountLabel', { n: String(engineOptions.length) })}</span>
              </div>

              {/* Model Selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-medium block">{t('illustrationsView.modelSelectorLabel')}</label>
                <div className="grid grid-cols-2 gap-2" data-tour="illustrations__2">
                  {engineOptions.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelectedEngine(e.id)}
                      className={`p-2 rounded-xl border text-left text-xs transition-all ${
                        selectedEngine === e.id
                          ? 'bg-slate-900 border-amber-500 shadow-md ring-1 ring-amber-500/50'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-white text-[11px] truncate">{e.name}</div>
                      <div className="text-[9px] text-slate-400 truncate">{e.tag}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chapter connection */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('illustrationsView.chapterLinkLabel')}</label>
                <select
                  value={selectedChapterId}
                  onChange={(e) => setSelectedChapterId(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {book.chapters.map((chap) => (
                    <option key={chap.id} value={chap.id}>
                      {chap.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Style preset */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('illustrationsView.styleLabel')}</label>
                <select
                  value={selectedStyle}
                  onChange={(e) => setSelectedStyle(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {stylePresets.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Text Description / Selected Excerpt */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {t('illustrationsView.sceneDescLabel')}
                </label>
                <textarea
                  rows={3}
                  value={promptSubject}
                  onChange={(e) => setPromptSubject(e.target.value)}
                  placeholder={t('illustrationsView.sceneDescPlaceholder')}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleAutoGeneratePrompt}
                  disabled={isGeneratingPrompt}
                  data-tour="illustrations__3"
                  className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-bold"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isGeneratingPrompt ? t('illustrationsView.generatingPromptBtn') : t('illustrationsView.craftPromptBtn')}</span>
                </button>
              </div>

              {/* Generated Prompt display */}
              {generatedPrompt && (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-slate-500">
                      {t('illustrationsView.generatedPromptLabel')}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedPrompt);
                        showToast(t('illustrationsView.toastPromptCopied'));
                      }}
                      className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> {t('illustrationsView.copyBtn')}
                    </button>
                  </div>
                  <p className="text-xs text-slate-300 font-mono leading-relaxed">
                    {generatedPrompt}
                  </p>
                </div>
              )}

              <button
                onClick={handleGenerateArtwork}
                disabled={isGeneratingImage}
                data-tour="illustrations__4"
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 via-purple-600 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 text-slate-950 font-bold text-xs shadow-lg transition-all flex items-center justify-center gap-2 active:scale-98"
              >
                {isGeneratingImage ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin text-slate-950" />
                    <span>{t('illustrationsView.generatingInEngineBtn', { engine: engineOptions.find((e) => e.id === selectedEngine)?.name || '' })}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                    <span>{t('illustrationsView.generateArtBtn')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Live Art Preview (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4 flex flex-col items-center justify-center min-h-[460px]">
              {previewResult ? (
                <div className="w-full space-y-4">
                  <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-2xl group max-h-[380px] flex items-center justify-center bg-black">
                    <img
                      src={previewResult.imageUrl}
                      alt="Generated illustration"
                      referrerPolicy="no-referrer"
                      className="w-full h-auto object-cover max-h-[380px]"
                    />
                    <div className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-black/70 backdrop-blur-md text-amber-300 border border-amber-500/30">
                      {previewResult.modelUsed}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-400">
                      {t('illustrationsView.captionLabel')}<b className="text-slate-200">{previewResult.caption}</b>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Download Buttons PNG / JPG */}
                      <button
                        onClick={() => handleDownload(previewResult.imageUrl, previewResult.caption, 'png')}
                        disabled={isDownloading}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs border border-slate-700 transition-all shadow-sm"
                        title={t('illustrationsView.downloadPngTooltip')}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{t('illustrationsView.pngLabel')}</span>
                      </button>

                      <button
                        onClick={() => handleDownload(previewResult.imageUrl, previewResult.caption, 'jpg')}
                        disabled={isDownloading}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs border border-slate-700 transition-all shadow-sm"
                        title={t('illustrationsView.downloadJpgTooltip')}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{t('illustrationsView.jpgLabel')}</span>
                      </button>

                      <button
                        onClick={() =>
                          setTextModalTarget({
                            imageUrl: previewResult.imageUrl,
                            caption: previewResult.caption,
                            initialText: previewGeneratedText,
                            initialEngine: previewGeneratedTextEngine,
                          })
                        }
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs border transition-all shadow-sm ${
                          previewGeneratedText
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-violet-300'
                        }`}
                        title={t('illustrationsView.aiTextForSceneTooltip')}
                      >
                        <PenLine className="w-3.5 h-3.5" />
                        <span>{previewGeneratedText ? t('illustrationsView.textReadyBtn') : t('illustrationsView.aiTextSceneBtn')}</span>
                      </button>

                      <button
                        onClick={handleSaveToBook}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all"
                      >
                        <Check className="w-4 h-4" />
                        <span>{t('illustrationsView.addToBookBtn')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-3 text-slate-500">
                  <ImageIcon className="w-16 h-16 mx-auto text-slate-700" />
                  <h3 className="text-sm font-bold text-slate-400">
                    {t('illustrationsView.readyToVisualizeHeading')}
                  </h3>
                  <p className="text-xs max-w-sm">
                    {t('illustrationsView.readyToVisualizeDesc')}
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* TAB 2: UPLOAD LOCAL ARTWORK */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div
              onClick={() => uploadFileInputRef.current?.click()}
              className="p-10 rounded-3xl border-2 border-dashed border-slate-700 hover:border-amber-500 bg-slate-950/80 hover:bg-slate-950 transition-all cursor-pointer text-center space-y-3 group"
            >
              <input
                ref={uploadFileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp"
                className="hidden"
                onChange={handleLocalFileChange}
              />
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  {t('illustrationsView.dropzoneHeading')}
                </h3>
                <p className="text-xs text-slate-400">
                  {t('illustrationsView.formatsPrefixLabel')}<b className="text-slate-200">PNG, JPG, WEBP</b>
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">{t('illustrationsView.captionFieldLabel')}</label>
                <input
                  type="text"
                  value={uploadCaption}
                  onChange={(e) => setUploadCaption(e.target.value)}
                  placeholder={t('illustrationsView.captionPlaceholder')}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">{t('illustrationsView.chapterLinkLabel')}</label>
                <select
                  value={uploadChapterId}
                  onChange={(e) => setUploadChapterId(e.target.value)}
                  className="w-full p-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                >
                  {book.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col items-center justify-center min-h-[380px]">
              {uploadPreviewUrl ? (
                <div className="w-full space-y-4">
                  <div className="rounded-2xl overflow-hidden border border-slate-700 bg-black max-h-[300px] flex items-center justify-center">
                    <img
                      src={uploadPreviewUrl}
                      alt="Upload preview"
                      className="w-full h-auto object-cover max-h-[300px]"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-400 truncate max-w-[200px]">
                      {uploadCaption || 'Власна графіка'}
                    </div>

                    <button
                      onClick={handleSaveUploadedArtwork}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all"
                    >
                      <Check className="w-4 h-4" />
                      <span>{t('illustrationsView.saveToBookBtn')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 space-y-2">
                  <ImageIcon className="w-12 h-12 mx-auto text-slate-700" />
                  <p className="text-xs">{t('illustrationsView.uploadPromptText')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: VISUAL BIBLE CANON */}
      {activeTab === 'bible' && (
        <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-6">
          <div className="border-b border-slate-800 pb-4">
            <h3 className="text-base font-bold text-white font-heading">
              {t('illustrationsView.visualCanonHeading')}
            </h3>
            <p className="text-xs text-slate-400">
              {t('illustrationsView.visualCanonDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Style Selector */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-amber-400 uppercase tracking-wider block">
                {t('illustrationsView.mainStyleLabel')}
              </label>
              <div className="grid grid-cols-1 gap-2">
                {stylePresets.map((st) => (
                  <button
                    key={st}
                    onClick={() => handleUpdateBible({ ...book.visualBible, artStyle: st })}
                    className={`p-2.5 rounded-xl border text-xs text-left transition-all ${
                      book.visualBible.artStyle === st
                        ? 'bg-amber-500/20 border-amber-500 text-amber-200 font-bold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Palette Swatches & Lighting */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-amber-400 uppercase tracking-wider block mb-2">
                  {t('illustrationsView.colorPaletteLabel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {book.visualBible.colorPalette.map((color, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 p-2 rounded-xl bg-slate-900 border border-slate-800"
                    >
                      <div
                        className="w-6 h-6 rounded-lg border border-white/20 shadow-xs"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-mono text-slate-300">{color}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  {t('illustrationsView.lightingLabel')}
                </label>
                <input
                  type="text"
                  value={book.visualBible.lighting}
                  onChange={(e) => handleUpdateBible({ ...book.visualBible, lighting: e.target.value })}
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  {t('illustrationsView.keyMotifsLabel')}
                </label>
                <textarea
                  rows={3}
                  value={book.visualBible.keyMotifs.join(', ')}
                  onChange={(e) =>
                    handleUpdateBible({
                      ...book.visualBible,
                      keyMotifs: e.target.value.split(',').map((s) => s.trim()),
                    })
                  }
                  className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200"
                />
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 4: GALLERY */}
      {activeTab === 'gallery' && (
        <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              {t('illustrationsView.savedIllustrationsHeading', { n: String(book.illustrations?.length || 0) })}
            </h3>
            <span className="text-xs text-slate-400">
              {t('illustrationsView.supportsDownloadNote')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {(book.illustrations || []).map((ill) => (
              <div
                key={ill.id}
                className="rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 group shadow-lg flex flex-col justify-between"
              >
                <div className="h-48 overflow-hidden bg-black flex items-center justify-center relative">
                  <img
                    src={ill.url}
                    alt={ill.caption}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300"
                  />
                  {ill.modelUsed && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-bold bg-black/70 backdrop-blur-md text-amber-300 border border-amber-500/30">
                      {ill.modelUsed}
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-white">{ill.caption}</h4>
                    <p className="text-[11px] text-slate-400 truncate">{ill.style}</p>
                    {ill.promptUsed && (
                      <p className="text-[10px] text-slate-500 font-mono truncate">
                        {ill.promptUsed}
                      </p>
                    )}
                  </div>

                  {/* ШІ-текст сцени */}
                  <button
                    onClick={() =>
                      setTextModalTarget({
                        imageUrl: ill.url,
                        caption: ill.caption,
                        illustrationId: ill.id,
                        initialText: ill.generatedText,
                        initialEngine: ill.generatedTextEngine,
                      })
                    }
                    className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-bold border flex items-center justify-center gap-1.5 transition-all ${
                      ill.generatedText
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                        : 'bg-slate-800/60 border-slate-700 text-violet-300 hover:bg-slate-800'
                    }`}
                    title={t('illustrationsView.writeOrEditTextTooltip')}
                  >
                    <PenLine className="w-3 h-3" />
                    <span>{ill.generatedText ? t('illustrationsView.textSceneExistsBtn') : t('illustrationsView.writeTextSceneBtn')}</span>
                  </button>

                  {/* Export and Delete buttons */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleDownload(ill.url, ill.caption, 'png')}
                        disabled={isDownloading}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-bold border border-slate-700 flex items-center gap-1 transition-all"
                        title={t('illustrationsView.downloadPngTooltip')}
                      >
                        <Download className="w-3 h-3" />
                        <span>{t('illustrationsView.pngLabel')}</span>
                      </button>

                      <button
                        onClick={() => handleDownload(ill.url, ill.caption, 'jpg')}
                        disabled={isDownloading}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-bold border border-slate-700 flex items-center gap-1 transition-all"
                        title={t('illustrationsView.downloadJpgTooltip')}
                      >
                        <Download className="w-3 h-3" />
                        <span>{t('illustrationsView.jpgLabel')}</span>
                      </button>
                    </div>

                    <button
                      onClick={() => handleDeleteIllustration(ill.id, ill.caption)}
                      className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/20 transition-colors"
                      title={t('illustrationsView.deleteIllustrationTooltip')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ШІ-текст сцени за зображенням */}
      <GenerateTextFromImageModal
        isOpen={!!textModalTarget}
        onClose={() => setTextModalTarget(null)}
        imageUrl={textModalTarget?.imageUrl || ''}
        caption={textModalTarget?.caption || ''}
        bookTitle={book.title}
        genre={book.genre}
        initialText={textModalTarget?.initialText}
        initialEngine={textModalTarget?.initialEngine}
        onSave={(text, engine) => {
          if (textModalTarget?.illustrationId) {
            handleSaveTextToIllustration(textModalTarget.illustrationId, text, engine);
          } else {
            setPreviewGeneratedText(text);
            setPreviewGeneratedTextEngine(engine);
            showToast(t('illustrationsView.toastTextReadySaveWithIllustration'));
          }
        }}
      />

    </div>
  );
};
