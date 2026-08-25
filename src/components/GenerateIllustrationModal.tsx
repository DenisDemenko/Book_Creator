import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Sparkles, 
  Wand2, 
  Cpu, 
  Check, 
  Image as ImageIcon, 
  RefreshCw, 
  Layers, 
  Sliders, 
  Save, 
  Eye, 
  Zap, 
  Flame, 
  CheckCircle2, 
  Palette, 
  Terminal, 
  Bot, 
  Download, 
  Upload, 
  FileText, 
  Quote, 
  Maximize2, 
  Film, 
  Camera, 
  SunMedium, 
  HelpCircle,
  Copy
} from 'lucide-react';
import { Book, Chapter, Section, BookIllustration } from '../types';
import { downloadImageAs } from '../utils/helpers';
import { placeholderImage, isGuestRestriction } from '../utils/placeholders';
import { useLanguage } from '../i18n/LanguageContext';

export type IllustrationModel = 'nano-banana-2-lite' | 'nano-banana-2' | 'nano-banana-pro' | 'seedream';
export type IllustrationStylePreset = 
  | 'cyberpunk-photoreal' 
  | 'cinematic' 
  | 'graphic-novel' 
  | 'anime' 
  | 'oil-portrait' 
  | 'dark-noir' 
  | 'watercolor' 
  | 'dark-fantasy';

export type AspectRatioOption = '16:9' | '1:1' | '4:3' | '3:2' | '9:16' | '2:3';

interface GenerateIllustrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  selectedText?: string;
  activeChapterId?: string;
  activeSectionId?: string;
  onSaveIllustration: (illustration: BookIllustration, insertIntoText?: boolean) => void;
  onInsertTextAtCursor?: (text: string) => void;
}

export const GenerateIllustrationModal: React.FC<GenerateIllustrationModalProps> = ({
  isOpen,
  onClose,
  book,
  selectedText = '',
  activeChapterId,
  activeSectionId,
  onSaveIllustration,
  onInsertTextAtCursor,
}) => {
  const { t } = useLanguage();
  if (!isOpen) return null;

  // Active Tab: 'ai-generator' or 'upload'
  const [modalTab, setModalTab] = useState<'ai-generator' | 'upload'>('ai-generator');

  // Text excerpt to transform into illustration prompt
  const [sourceText, setSourceText] = useState<string>(selectedText || '');
  const [targetChapterId, setTargetChapterId] = useState<string>(activeChapterId || book.chapters[0]?.id || '');
  const [targetSectionId, setTargetSectionId] = useState<string>(activeSectionId || book.chapters[0]?.sections[0]?.id || '');

  // AI Model Engine (exact same as characters)
  const [selectedModel, setSelectedModel] = useState<IllustrationModel>('nano-banana-2');
  
  // Style Preset
  const [stylePreset, setStylePreset] = useState<IllustrationStylePreset>('cyberpunk-photoreal');
  
  // Aspect ratio
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('16:9');

  // Prompt states
  const [isCraftingPrompt, setIsCraftingPrompt] = useState<boolean>(false);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>(
    'blurry, low quality, distorted anatomy, extra limbs, bad eyes, disfigured, cartoonish, watermark, signature, text, out of frame'
  );
  const [sceneSummary, setSceneSummary] = useState<string>('');
  const [captionTitle, setCaptionTitle] = useState<string>('');

  // Generation status
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedArt, setGeneratedArt] = useState<{
    imageUrl: string;
    promptUsed: string;
    negativePrompt?: string;
    modelUsed: string;
    modelKey: string;
    stylePreset: string;
    aspectRatio: string;
    sceneSummaryUa?: string;
    timestamp?: string;
  } | null>(null);

  // Upload custom file states
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadCaption, setUploadCaption] = useState<string>('');
  const [uploadStyle, setUploadStyle] = useState<string>(book.visualBible?.artStyle || 'Власна графіка');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Success toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const modelOptions: { id: IllustrationModel; name: string; tag: string; badgeColor: string; description: string }[] = [
    {
      id: 'nano-banana-2-lite',
      name: 'Nano Banana 2 Lite',
      tag: t('generateIllustrationModal.engineTagLite'),
      badgeColor: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
      description: t('generateIllustrationModal.modelLiteDesc'),
    },
    {
      id: 'nano-banana-2',
      name: 'Nano Banana 2',
      tag: t('generateIllustrationModal.engineTagStandard'),
      badgeColor: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      description: t('generateIllustrationModal.modelStandardDesc'),
    },
    {
      id: 'nano-banana-pro',
      name: 'Nano Banana Pro',
      tag: t('generateIllustrationModal.engineTagPro'),
      badgeColor: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
      description: t('generateIllustrationModal.modelProDesc'),
    },
    {
      id: 'seedream',
      name: 'Seedream (ByteDance)',
      tag: t('generateIllustrationModal.engineTagSeedream'),
      badgeColor: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      description: t('generateIllustrationModal.modelSeedreamDesc'),
    },
  ];

  const styleOptions: { id: IllustrationStylePreset; name: string; desc: string }[] = [
    { id: 'cyberpunk-photoreal', name: t('generateIllustrationModal.styleCyberpunkName'), desc: t('generateIllustrationModal.styleCyberpunkDesc') },
    { id: 'cinematic', name: t('generateIllustrationModal.styleCinematicName'), desc: t('generateIllustrationModal.styleCinematicDesc') },
    { id: 'graphic-novel', name: t('generateIllustrationModal.styleGraphicNovelName'), desc: t('generateIllustrationModal.styleGraphicNovelDesc') },
    { id: 'anime', name: t('generateIllustrationModal.styleAnimeName'), desc: t('generateIllustrationModal.styleAnimeDesc') },
    { id: 'oil-portrait', name: t('generateIllustrationModal.styleOilPortraitName'), desc: t('generateIllustrationModal.styleOilPortraitDesc') },
    { id: 'dark-noir', name: t('generateIllustrationModal.styleDarkNoirName'), desc: t('generateIllustrationModal.styleDarkNoirDesc') },
    { id: 'watercolor', name: t('generateIllustrationModal.styleWatercolorName'), desc: t('generateIllustrationModal.styleWatercolorDesc') },
    { id: 'dark-fantasy', name: t('generateIllustrationModal.styleDarkFantasyName'), desc: t('generateIllustrationModal.styleDarkFantasyDesc') },
  ];

  const aspectRatios: { id: AspectRatioOption; label: string; iconDesc: string }[] = [
    { id: '16:9', label: t('generateIllustrationModal.aspect169'), iconDesc: t('generateIllustrationModal.aspect169Desc') },
    { id: '1:1', label: t('generateIllustrationModal.aspect11'), iconDesc: t('generateIllustrationModal.aspect11Desc') },
    { id: '4:3', label: t('generateIllustrationModal.aspect43'), iconDesc: t('generateIllustrationModal.aspect43Desc') },
    { id: '3:2', label: t('generateIllustrationModal.aspect32'), iconDesc: t('generateIllustrationModal.aspect32Desc') },
    { id: '9:16', label: t('generateIllustrationModal.aspect916'), iconDesc: t('generateIllustrationModal.aspect916Desc') },
    { id: '2:3', label: t('generateIllustrationModal.aspect23'), iconDesc: t('generateIllustrationModal.aspect23Desc') },
  ];

  // Auto-craft prompt if sourceText is provided on initial open
  const handleCraftPrompt = async () => {
    if (!sourceText.trim()) return;
    setIsCraftingPrompt(true);
    try {
      const activeChap = book.chapters.find((c) => c.id === targetChapterId);
      const res = await fetch('/api/ai/craft-illustration-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: sourceText,
          model: selectedModel,
          stylePreset: stylePreset,
          aspectRatio: aspectRatio,
          genre: book.genre,
          bookTitle: book.title,
          chapterTitle: activeChap?.title,
          visualBible: book.visualBible,
        }),
      });

      const data = await res.json();
      if (data.prompt) {
        setCustomPrompt(data.prompt);
        if (data.negativePrompt) setNegativePrompt(data.negativePrompt);
        if (data.sceneSummaryUa) {
          setSceneSummary(data.sceneSummaryUa);
          if (!captionTitle) setCaptionTitle(data.sceneSummaryUa);
        }
        showToast(t('generateIllustrationModal.toastPromptCrafted'));
      }
    } catch (err) {
      console.error('Error crafting illustration prompt:', err);
    } finally {
      setIsCraftingPrompt(false);
    }
  };

  useEffect(() => {
    if (selectedText && !customPrompt) {
      handleCraftPrompt();
    }
  }, [selectedText, selectedModel, stylePreset]);

  // Execute Illustration Generation
  const handleExecuteGeneration = async () => {
    setIsGenerating(true);
    setGeneratedArt(null);
    try {
      const activeChap = book.chapters.find((c) => c.id === targetChapterId);
      const res = await fetch('/api/ai/generate-illustration-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: sourceText,
          prompt: customPrompt || undefined,
          model: selectedModel,
          stylePreset: stylePreset,
          aspectRatio: aspectRatio,
          genre: book.genre,
          bookTitle: book.title,
          chapterTitle: activeChap?.title,
          visualBible: book.visualBible,
        }),
      });

      const data = await res.json();

      if (isGuestRestriction(res.status, data)) {
        const caption = captionTitle || activeChap?.title || 'Ілюстрація до сцени';
        setGeneratedArt({
          imageUrl: placeholderImage({ caption, aspectRatio, kind: 'scene' }),
          promptUsed: t('generateIllustrationModal.guestPromptFallback'),
          modelUsed: t('generateIllustrationModal.guestModelUsedFallback'),
          modelKey: 'placeholder',
          stylePreset,
          aspectRatio,
          sceneSummaryUa: caption,
        });
        showToast(data.error || t('generateIllustrationModal.toastGuestRestricted'));
        return;
      }
      if (!res.ok) {
        showToast(data.error || t('generateIllustrationModal.toastGenFailed'));
        return;
      }

      if (data.imageUrl) {
        setGeneratedArt(data);
        if (!captionTitle) {
          setCaptionTitle(data.sceneSummaryUa || 'Ілюстрація до сцени');
        }
        showToast(t('generateIllustrationModal.toastGenerated', { model: data.modelUsed }));
      }
    } catch (err) {
      console.error('Error generating illustration:', err);
      showToast(t('generateIllustrationModal.toastGenError'));
    } finally {
      setIsGenerating(false);
    }
  };

  // Save generated artwork to book illustrations
  const handleSaveToBook = (insertInManuscript = false) => {
    if (!generatedArt) return;

    const newIll: BookIllustration = {
      id: `ill-${Date.now()}`,
      chapterId: targetChapterId,
      sectionId: targetSectionId,
      url: generatedArt.imageUrl,
      caption: captionTitle || sceneSummary || 'Ілюстрація розділу',
      promptUsed: generatedArt.promptUsed,
      negativePrompt: generatedArt.negativePrompt,
      aspectRatio: generatedArt.aspectRatio || aspectRatio,
      style: generatedArt.stylePreset || stylePreset,
      modelUsed: generatedArt.modelUsed,
      modelKey: generatedArt.modelKey,
      selectedTextSnippet: sourceText ? sourceText.slice(0, 200) : undefined,
      source: 'ai',
      createdAt: new Date().toISOString(),
    };

    onSaveIllustration(newIll, insertInManuscript);

    if (insertInManuscript && onInsertTextAtCursor) {
      const markdownTag = `\n\n![Ілюстрація: ${newIll.caption}](${newIll.url})\n*Ілюстрація: ${newIll.caption} (${newIll.modelUsed || 'AI'})*\n\n`;
      onInsertTextAtCursor(markdownTag);
    }

    showToast(insertInManuscript ? t('generateIllustrationModal.toastSavedAndInserted') : t('generateIllustrationModal.toastSavedToGallery'));
    onClose();
  };

  // Download artwork in PNG or JPG
  const handleDownload = async (format: 'png' | 'jpg', targetUrl?: string, name?: string) => {
    const url = targetUrl || generatedArt?.imageUrl || uploadPreviewUrl;
    if (!url) return;

    setIsDownloading(true);
    const fileName = `${name || captionTitle || 'book-illustration'}-${Date.now()}`;
    try {
      await downloadImageAs(url, fileName, format);
      showToast(t('generateIllustrationModal.toastDownloaded', { format: format.toUpperCase() }));
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Handle local image file upload (PNG, JPG, WEBP)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleDropUpload = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/'))) {
      setUploadFile(file);
      setUploadCaption(file.name.replace(/\.[^/.]+$/, ''));
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadPreviewUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Save uploaded image to book
  const handleSaveUploadedImage = (insertInManuscript = false) => {
    if (!uploadPreviewUrl) return;

    const newIll: BookIllustration = {
      id: `ill-upload-${Date.now()}`,
      chapterId: targetChapterId,
      sectionId: targetSectionId,
      url: uploadPreviewUrl,
      caption: uploadCaption.trim() || 'Завантажена ілюстрація',
      aspectRatio: '16:9',
      style: uploadStyle,
      source: 'upload',
      createdAt: new Date().toISOString(),
      fileSize: uploadFile ? `${(uploadFile.size / 1024).toFixed(1)} KB` : undefined,
    };

    onSaveIllustration(newIll, insertInManuscript);

    if (insertInManuscript && onInsertTextAtCursor) {
      const markdownTag = `\n\n![Ілюстрація: ${newIll.caption}](${newIll.url})\n*Ілюстрація: ${newIll.caption}*\n\n`;
      onInsertTextAtCursor(markdownTag);
    }

    showToast(t('generateIllustrationModal.toastUploadSaved'));
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div 
        className="bg-slate-950 border border-slate-800 rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden relative text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toast Notification */}
        {toastMessage && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 border border-amber-400 text-xs animate-bounce">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 via-purple-500/20 to-cyan-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white font-heading">
                  {t('generateIllustrationModal.heading')}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  AI + Manual
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {t('generateIllustrationModal.subheading')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode Switcher */}
            <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setModalTab('ai-generator')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                  modalTab === 'ai-generator'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('generateIllustrationModal.tabAiGenerator')}</span>
              </button>

              <button
                onClick={() => setModalTab('upload')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                  modalTab === 'upload'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t('generateIllustrationModal.tabUpload')}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          
          {/* TAB 1: AI GENERATOR */}
          {modalTab === 'ai-generator' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Form Controls & Prompt Engineering (7 cols) */}
              <div className="lg:col-span-7 space-y-5">
                
                {/* 1. Source Text Excerpt Box */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Quote className="w-3.5 h-3.5" /> {t('generateIllustrationModal.sourceExcerptLabel')}
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {t('generateIllustrationModal.wordsCountSuffix', { n: String(sourceText.split(/\s+/).filter(Boolean).length) })}
                    </span>
                  </div>

                  <textarea
                    rows={3}
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    placeholder={t('generateIllustrationModal.sourceTextPlaceholder')}
                    className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden font-serif-book leading-relaxed resize-none"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <select
                        value={targetChapterId}
                        onChange={(e) => setTargetChapterId(e.target.value)}
                        className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-medium"
                      >
                        {book.chapters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={handleCraftPrompt}
                      disabled={isCraftingPrompt || !sourceText.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all disabled:opacity-50"
                    >
                      <Wand2 className={`w-3.5 h-3.5 ${isCraftingPrompt ? 'animate-spin' : ''}`} />
                      <span>{isCraftingPrompt ? t('generateIllustrationModal.craftingPromptBtn') : t('generateIllustrationModal.craftPromptBtn')}</span>
                    </button>
                  </div>
                </div>

                {/* 2. AI Engine Selector (Exact same 4 engines as characters) */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-amber-400" /> {t('generateIllustrationModal.modelEngineLabel')}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {modelOptions.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedModel(m.id)}
                        className={`p-3 rounded-2xl border text-left transition-all relative overflow-hidden ${
                          selectedModel === m.id
                            ? 'bg-slate-900 border-amber-500 shadow-md ring-1 ring-amber-500/50'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-white">{m.name}</span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${m.badgeColor}`}>
                            {m.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-tight">
                          {m.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Style Presets & Aspect Ratio */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Style Preset */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-amber-400" /> {t('generateIllustrationModal.styleLabel')}
                    </label>
                    <select
                      value={stylePreset}
                      onChange={(e) => setStylePreset(e.target.value as IllustrationStylePreset)}
                      className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white font-medium focus:border-amber-400 focus:outline-hidden"
                    >
                      {styleOptions.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.desc})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-amber-400" /> {t('generateIllustrationModal.aspectRatioLabel')}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {aspectRatios.map((ar) => (
                        <button
                          key={ar.id}
                          onClick={() => setAspectRatio(ar.id)}
                          className={`p-1.5 rounded-xl border text-center text-xs transition-all ${
                            aspectRatio === ar.id
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <div className="font-mono text-[11px]">{ar.id}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 4. Structured Prompt & Negative Prompt Editor */}
                <div className="space-y-3 p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5" /> {t('generateIllustrationModal.structuredPromptLabel')}
                    </label>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(customPrompt);
                        showToast(t('generateIllustrationModal.toastPromptCopied'));
                      }}
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> {t('generateIllustrationModal.copyBtn')}
                    </button>
                  </div>

                  <textarea
                    rows={3}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder={t('generateIllustrationModal.structuredPromptPlaceholder')}
                    className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 font-mono leading-relaxed focus:border-amber-400 focus:outline-hidden"
                  />

                  {/* Negative Prompt Collapsible */}
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1 font-medium">
                      {t('generateIllustrationModal.negativePromptLabel')}
                    </label>
                    <input
                      type="text"
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono focus:border-amber-400 focus:outline-hidden"
                    />
                  </div>

                  {/* Caption & Metadata */}
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1 font-medium">
                      {t('generateIllustrationModal.captionMetaLabel')}
                    </label>
                    <input
                      type="text"
                      value={captionTitle}
                      onChange={(e) => setCaptionTitle(e.target.value)}
                      placeholder={t('generateIllustrationModal.captionPlaceholder')}
                      className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-amber-400 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  onClick={handleExecuteGeneration}
                  disabled={isGenerating}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-purple-600 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 text-slate-950 font-bold text-sm shadow-xl transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                      <span>{t('generateIllustrationModal.generatingInModelBtn', { model: modelOptions.find((m) => m.id === selectedModel)?.name || '' })}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-slate-950" />
                      <span>{t('generateIllustrationModal.generateIllustrationBtn', { model: modelOptions.find((m) => m.id === selectedModel)?.name || '' })}</span>
                    </>
                  )}
                </button>

              </div>

              {/* Right Column: Live Art Preview & Export Actions (5 cols) */}
              <div className="lg:col-span-5 space-y-4 flex flex-col justify-between">
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 min-h-[460px] flex flex-col justify-center">
                  
                  {generatedArt ? (
                    <div className="space-y-4">
                      {/* Image Canvas Container */}
                      <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-black group max-h-[360px] flex items-center justify-center">
                        <img
                          src={generatedArt.imageUrl}
                          alt={captionTitle || t('generateIllustrationModal.generatedAltFallback')}
                          referrerPolicy="no-referrer"
                          className="w-full h-auto object-cover max-h-[360px] rounded-xl group-hover:scale-102 transition-transform duration-300"
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/70 backdrop-blur-md text-amber-300 border border-amber-500/30">
                          {generatedArt.modelUsed}
                        </div>
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/70 backdrop-blur-md text-cyan-300 border border-cyan-500/30">
                          {generatedArt.aspectRatio}
                        </div>
                      </div>

                      {/* Info & Caption */}
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-white">{captionTitle || t('generateIllustrationModal.previewCaptionFallback')}</div>
                        <div className="text-[11px] text-slate-400 flex items-center justify-between">
                          <span>{t('generateIllustrationModal.styleFieldLabel')}<b className="text-slate-200">{stylePreset}</b></span>
                          <span className="text-emerald-400 font-medium">8K Masterpiece</span>
                        </div>
                      </div>

                      {/* Download Buttons (PNG & JPG) */}
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          {t('generateIllustrationModal.downloadToDeviceLabel')}
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleDownload('png')}
                            disabled={isDownloading}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition-all shadow-sm"
                          >
                            <Download className="w-3.5 h-3.5 text-cyan-400" />
                            <span>{t('generateIllustrationModal.downloadPngBtn')}</span>
                          </button>
                          <button
                            onClick={() => handleDownload('jpg')}
                            disabled={isDownloading}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition-all shadow-sm"
                          >
                            <Download className="w-3.5 h-3.5 text-amber-400" />
                            <span>{t('generateIllustrationModal.downloadJpgBtn')}</span>
                          </button>
                        </div>
                      </div>

                      {/* Save & Insert Actions */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                        <button
                          onClick={() => handleSaveToBook(false)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all"
                        >
                          <Check className="w-4 h-4" />
                          <span>{t('generateIllustrationModal.addToBookBtn')}</span>
                        </button>
                        <button
                          onClick={() => handleSaveToBook(true)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all"
                        >
                          <FileText className="w-4 h-4" />
                          <span>{t('generateIllustrationModal.insertIntoTextBtn')}</span>
                        </button>
                      </div>

                    </div>
                  ) : (
                    <div className="text-center space-y-3 text-slate-500 py-12">
                      <div className="w-16 h-16 rounded-3xl bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto text-slate-600">
                        <ImageIcon className="w-8 h-8" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-300">{t('generateIllustrationModal.readyToGenerateHeading')}</h4>
                        <p className="text-xs text-slate-500 max-w-xs mx-auto">
                          {t('generateIllustrationModal.readyToGenerateDesc')}
                        </p>
                      </div>
                    </div>
                  )}

                </div>
              </div>

            </div>
          )}

          {/* TAB 2: UPLOAD CUSTOM ILLUSTRATION (PNG / JPG) */}
          {modalTab === 'upload' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Upload Drop Zone & Inputs (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDropUpload}
                  onClick={() => fileInputRef.current?.click()}
                  className="p-8 rounded-3xl border-2 border-dashed border-slate-700 hover:border-amber-500 bg-slate-900/60 hover:bg-slate-900 transition-all cursor-pointer text-center space-y-3 group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png, image/jpeg, image/jpg, image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8" />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white">
                      {t('generateIllustrationModal.dropzoneHeading')}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {t('generateIllustrationModal.supportedFormatsPrefix')}<b className="text-slate-200">PNG, JPG, JPEG, WEBP</b>{t('generateIllustrationModal.supportedFormatsSuffix')}
                    </p>
                  </div>
                </div>

                {/* Upload Meta Options */}
                <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-1">
                      {t('generateIllustrationModal.uploadCaptionLabel')}
                    </label>
                    <input
                      type="text"
                      value={uploadCaption}
                      onChange={(e) => setUploadCaption(e.target.value)}
                      placeholder={t('generateIllustrationModal.uploadCaptionPlaceholder')}
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-amber-400 focus:outline-hidden"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-1">
                        {t('generateIllustrationModal.chapterLinkLabel')}
                      </label>
                      <select
                        value={targetChapterId}
                        onChange={(e) => setTargetChapterId(e.target.value)}
                        className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 font-medium"
                      >
                        {book.chapters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block mb-1">
                        {t('generateIllustrationModal.categoryStyleLabel')}
                      </label>
                      <input
                        type="text"
                        value={uploadStyle}
                        onChange={(e) => setUploadStyle(e.target.value)}
                        className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200"
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* Upload Preview & Save (5 cols) */}
              <div className="lg:col-span-5 space-y-4">
                <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 min-h-[400px] flex flex-col justify-center">
                  {uploadPreviewUrl ? (
                    <div className="space-y-4">
                      <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-black max-h-[320px] flex items-center justify-center">
                        <img
                          src={uploadPreviewUrl}
                          alt={uploadCaption || t('generateIllustrationModal.uploadedAltFallback')}
                          referrerPolicy="no-referrer"
                          className="w-full h-auto object-cover max-h-[320px] rounded-xl"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-bold text-white">{uploadCaption || t('generateIllustrationModal.uploadCaptionFallback')}</div>
                        {uploadFile && (
                          <div className="text-[11px] text-slate-400">
                            {t('generateIllustrationModal.fileSizeLabel')}{(uploadFile.size / 1024).toFixed(1)} KB • {uploadFile.type}
                          </div>
                        )}
                      </div>

                      {/* Download buttons for uploaded image */}
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          {t('generateIllustrationModal.convertAndDownloadLabel')}
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleDownload('png', uploadPreviewUrl, uploadCaption)}
                            disabled={isDownloading}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition-all"
                          >
                            <Download className="w-3.5 h-3.5 text-cyan-400" />
                            <span>{t('generateIllustrationModal.downloadPngBtn')}</span>
                          </button>
                          <button
                            onClick={() => handleDownload('jpg', uploadPreviewUrl, uploadCaption)}
                            disabled={isDownloading}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition-all"
                          >
                            <Download className="w-3.5 h-3.5 text-amber-400" />
                            <span>{t('generateIllustrationModal.downloadJpgBtn')}</span>
                          </button>
                        </div>
                      </div>

                      {/* Save to book */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                        <button
                          onClick={() => handleSaveUploadedImage(false)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all"
                        >
                          <Check className="w-4 h-4" />
                          <span>{t('generateIllustrationModal.addToBookBtn')}</span>
                        </button>
                        <button
                          onClick={() => handleSaveUploadedImage(true)}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all"
                        >
                          <FileText className="w-4 h-4" />
                          <span>{t('generateIllustrationModal.insertIntoTextBtn')}</span>
                        </button>
                      </div>

                    </div>
                  ) : (
                    <div className="text-center space-y-3 text-slate-500 py-12">
                      <ImageIcon className="w-16 h-16 mx-auto text-slate-700" />
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-slate-300">{t('generateIllustrationModal.noFileSelectedHeading')}</h4>
                        <p className="text-xs text-slate-500 max-w-xs mx-auto">
                          {t('generateIllustrationModal.noFileSelectedDesc')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
};
