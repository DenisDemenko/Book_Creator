import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, ImageIcon, Cpu, Film, Maximize2, Gauge, FileImage, AlertCircle, Upload, X } from 'lucide-react';
import { Book, BookIllustration } from '../types';
import { isGuestRestriction } from '../utils/placeholders';
import { useLanguage } from '../i18n/LanguageContext';
import { fileToBase64 } from '../utils/extractChatFileText';

/**
 * Панель налаштувань генерації зображень — постійно змонтована зліва від
 * галереї медіатеки (не модалка), на всю висоту вкладки. Параметри під
 * кожним двигуном звірені з офіційною документацією провайдерів у вересні
 * 2026 (не з тим, що вже випадково підтримував код):
 *
 *   • Google Interactions API (Nano Banana 2 / 2 Lite / Pro) —
 *     response_format.aspect_ratio приймає 10 співвідношень, а не 5, які
 *     раніше були захардкоджені (ai.google.dev/gemini-api/docs/image-generation);
 *     response_format.mime_type дає вибір PNG/JPEG;
 *     generation_config.thinking_level ('minimal'|'high') — задокументовано
 *     лише для лінійки 3.1 Flash Image (Nano Banana 2 і 2 Lite), тому панель
 *     не пропонує його для Pro.
 *   • ByteDance Seedream (Ark) — офіційно НЕ підтримує seed, guidance_scale,
 *     negative_prompt як окреме поле моделі (крім самого Ark, де воно є —
 *     код це вже враховував) чи вибір n/якості; панель тому не додає для
 *     нього фейкових полів, які б нічого не робили.
 *
 * Перелік двигунів і розмірів панель бере з `/api/ai/image-engines` (той
 * самий ендпоінт, яким уже користується QuickAiModal) — а не хардкодить
 * власний список, щоб не розійтися з сервером.
 */

interface EngineInfo {
  id: string;
  label: string;
  modelId: string;
  provider: 'google' | 'bytedance';
  maxSize: '1K' | '2K' | '4K';
  supportsQualityControl: boolean;
  supportsFormatChoice: boolean;
  available: boolean;
}

interface MediaGenerationPanelProps {
  book: Book;
  isRegistered: boolean;
  onGenerated: (illustration: BookIllustration) => void;
  onToast: (msg: string) => void;
}

const ALL_SIZES: ('1K' | '2K' | '4K')[] = ['1K', '2K', '4K'];

/**
 * Максимум референсних зображень для мультиреференсної генерації
 * (задача #52). Значення МАЄ збігатися з `MAX_REFERENCE_IMAGES` у
 * `server/imageGeneration.ts` — той модуль не можна імпортувати в клієнт
 * (node:fs/node:path/node:crypto на верхньому рівні), тож межа
 * продубльована тут навмисно, а не випадково.
 */
const MAX_REFERENCE_IMAGES = 10;

interface ReferenceImage {
  id: string;
  kind: 'upload' | 'url';
  /** Завжди готове до <img src>: data: URI для завантажень, сама URL для посилань. */
  previewUrl: string;
  dataBase64?: string;
  mimeType?: string;
  url?: string;
}

export const MediaGenerationPanel: React.FC<MediaGenerationPanelProps> = ({ book, isRegistered, onGenerated, onToast }) => {
  const { t } = useLanguage();

  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [aspectRatios, setAspectRatios] = useState<string[]>(['1:1', '3:4', '4:3', '9:16', '16:9']);
  const [engineId, setEngineId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('2K');
  const [quality, setQuality] = useState<'' | 'minimal' | 'high'>('');
  const [outputFormat, setOutputFormat] = useState<'' | 'png' | 'jpeg'>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ imageUrl: string; modelUsed: string } | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [referenceUrlInput, setReferenceUrlInput] = useState('');
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/ai/image-engines', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        const list: EngineInfo[] = data?.engines || [];
        setEngines(list);
        setEngineId((prev) => prev || list.find((e) => e.available)?.id || list[0]?.id || '');
        if (Array.isArray(data?.aspectRatios) && data.aspectRatios.length > 0) {
          setAspectRatios(data.aspectRatios);
        }
      })
      .catch(() => {
        /* панель лишається із дефолтним (вузьким) списком співвідношень */
      });
  }, []);

  const engineTagFor = (id: string): string => {
    switch (id) {
      case 'nano-banana-2-lite':
        return t('mediaGenerationPanel.engineTagLite');
      case 'nano-banana-2':
        return t('mediaGenerationPanel.engineTagStandard');
      case 'nano-banana-pro':
        return t('mediaGenerationPanel.engineTagPro');
      case 'seedream':
        return t('mediaGenerationPanel.engineTagSeedream');
      default:
        return '';
    }
  };

  const selectedEngine = engines.find((e) => e.id === engineId);

  // Розмір, недоступний обраному двигуну, скидаємо на найбільший дозволений
  // — інакше кнопка «Згенерувати» мовчки надіслала б розмір, який сервер
  // все одно обріже до maxSize.
  useEffect(() => {
    if (!selectedEngine) return;
    if (selectedEngine.maxSize === '1K' && imageSize !== '1K') {
      setImageSize('1K');
    }
  }, [selectedEngine, imageSize]);

  /** Додає завантажені файли як референси — до вільного місця (MAX_REFERENCE_IMAGES). */
  const handleReferenceFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (room <= 0) {
      onToast(t('mediaGenerationPanel.referenceImagesTooMany', { max: MAX_REFERENCE_IMAGES }));
      return;
    }
    const picked = Array.from(files).slice(0, room);
    for (const file of picked) {
      if (!file.type.startsWith('image/')) {
        onToast(t('mediaGenerationPanel.referenceImagesBadFile'));
        continue;
      }
      const dataBase64 = await fileToBase64(file);
      setReferenceImages((prev) => [
        ...prev,
        {
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'upload',
          dataBase64,
          mimeType: file.type,
          previewUrl: `data:${file.type};base64,${dataBase64}`,
        },
      ]);
    }
  };

  /** Додає референс за посиланням (введеним у сусіднє поле). */
  const handleAddReferenceUrl = () => {
    const url = referenceUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      onToast(t('mediaGenerationPanel.referenceImagesBadUrl'));
      return;
    }
    if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
      onToast(t('mediaGenerationPanel.referenceImagesTooMany', { max: MAX_REFERENCE_IMAGES }));
      return;
    }
    setReferenceImages((prev) => [
      ...prev,
      { id: `ref-${Date.now()}`, kind: 'url', url, previewUrl: url },
    ]);
    setReferenceUrlInput('');
  };

  const removeReferenceImage = (id: string) => {
    setReferenceImages((prev) => prev.filter((r) => r.id !== id));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      onToast(t('mediaGenerationPanel.toastEmptyPrompt'));
      return;
    }
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/ai/generate-media-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt,
          engine: engineId || undefined,
          aspectRatio,
          imageSize,
          negativePrompt: negativePrompt.trim() || undefined,
          quality: quality || undefined,
          outputFormat: outputFormat || undefined,
          bookId: book.id,
          referenceImages:
            referenceImages.length > 0
              ? referenceImages.map((r) =>
                  r.kind === 'upload'
                    ? { kind: 'upload', dataBase64: r.dataBase64, mimeType: r.mimeType }
                    : { kind: 'url', url: r.url }
                )
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (isGuestRestriction(res.status, data)) {
        setErrorMsg(t('mediaGenerationPanel.toastGuestRestricted'));
        onToast(t('mediaGenerationPanel.toastGuestRestricted'));
        return;
      }
      if (res.status === 402 || data?.kind === 'quota_exceeded') {
        setErrorMsg(t('mediaGenerationPanel.toastQuotaExceeded'));
        onToast(t('mediaGenerationPanel.toastQuotaExceeded'));
        return;
      }
      if (!res.ok || !data?.imageUrl) {
        const msg = data?.error || t('mediaGenerationPanel.toastGenFailed');
        setErrorMsg(msg);
        onToast(msg);
        return;
      }

      setLastResult({ imageUrl: data.imageUrl, modelUsed: data.modelUsed || '' });

      const newIll: BookIllustration = {
        id: `ill-media-${Date.now()}`,
        chapterId: book.chapters[0]?.id,
        url: data.imageUrl,
        caption: prompt.trim().slice(0, 80) || 'Зображення з медіатеки',
        promptUsed: data.promptUsed || prompt.trim(),
        negativePrompt: data.negativePrompt || undefined,
        aspectRatio: data.aspectRatio || aspectRatio,
        style: 'Медіатека',
        modelUsed: data.modelUsed,
        modelKey: data.modelKey,
        source: 'ai',
        createdAt: new Date().toISOString(),
        fileSize: data.fileSize,
      };
      onGenerated(newIll);
      onToast(t('mediaGenerationPanel.toastGenerated', { model: data.modelUsed || '' }));
    } catch (err) {
      console.error('Error generating media art:', err);
      setErrorMsg(t('mediaGenerationPanel.toastGenError'));
      onToast(t('mediaGenerationPanel.toastGenError'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <aside className="w-full lg:w-80 xl:w-96 shrink-0 h-full bg-slate-950/95 border-r border-slate-800 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 via-purple-500/20 to-cyan-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-white font-heading">{t('mediaGenerationPanel.heading')}</h2>
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{t('mediaGenerationPanel.subheading')}</p>
      </div>

      {!isRegistered ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-xs text-slate-400">{t('mediaGenerationPanel.guestBlocked')}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
              {t('mediaGenerationPanel.promptLabel')}
            </label>
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('mediaGenerationPanel.promptPlaceholder')}
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:border-amber-400 focus:outline-hidden resize-none leading-relaxed"
            />
          </div>

          {/* Negative prompt */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {t('mediaGenerationPanel.negativePromptLabel')}
            </label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder={t('mediaGenerationPanel.negativePromptPlaceholder')}
              className="w-full p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono focus:border-amber-400 focus:outline-hidden"
            />
          </div>

          {/* Reference images — image-to-image / мультиреференсна генерація (#52) */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('mediaGenerationPanel.referenceImagesLabel')}</span>
              <span className="text-slate-600 font-mono normal-case">
                {t('mediaGenerationPanel.referenceImagesCount', { count: referenceImages.length, max: MAX_REFERENCE_IMAGES })}
              </span>
            </label>
            <p className="text-[10px] text-slate-600 leading-snug">
              {t('mediaGenerationPanel.referenceImagesHint', { max: MAX_REFERENCE_IMAGES })}
            </p>

            {referenceImages.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {referenceImages.map((r) => (
                  <div
                    key={r.id}
                    className="relative group aspect-square rounded-lg overflow-hidden border border-slate-800 bg-slate-900"
                  >
                    <img src={r.previewUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeReferenceImage(r.id)}
                      title={t('mediaGenerationPanel.referenceImagesRemoveTitle')}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={referenceFileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleReferenceFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => referenceFileInputRef.current?.click()}
              disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
              className="w-full py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3 h-3" /> {t('mediaGenerationPanel.referenceImagesUploadBtn')}
            </button>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={referenceUrlInput}
                onChange={(e) => setReferenceUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddReferenceUrl()}
                placeholder={t('mediaGenerationPanel.referenceImagesUrlPlaceholder')}
                disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
                className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-hidden disabled:opacity-40"
              />
              <button
                onClick={handleAddReferenceUrl}
                disabled={!referenceUrlInput.trim() || referenceImages.length >= MAX_REFERENCE_IMAGES}
                className="px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white disabled:opacity-40 shrink-0"
              >
                {t('mediaGenerationPanel.referenceImagesUrlAddBtn')}
              </button>
            </div>
          </div>

          {/* Engine */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.engineLabel')}
            </label>
            <div className="space-y-1.5">
              {engines.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEngineId(e.id)}
                  disabled={!e.available}
                  title={!e.available ? t('mediaGenerationPanel.engineUnavailableHint') : undefined}
                  className={`w-full p-2 rounded-xl border text-left transition-all ${
                    engineId === e.id
                      ? 'bg-slate-900 border-amber-500 ring-1 ring-amber-500/50'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  } ${!e.available ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-white truncate">{e.label}</span>
                    {!e.available && <AlertCircle className="w-3 h-3 text-slate-500 shrink-0" />}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5">{engineTagFor(e.id)}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect ratio */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Film className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.aspectRatioLabel')}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {aspectRatios.map((ar) => (
                <button
                  key={ar}
                  onClick={() => setAspectRatio(ar)}
                  className={`py-1.5 rounded-lg border text-center font-mono text-[11px] transition-all ${
                    aspectRatio === ar
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>
          </div>

          {/* Image size */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Maximize2 className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.imageSizeLabel')}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {ALL_SIZES.map((sz) => {
                const disabled = !!selectedEngine && selectedEngine.maxSize === '1K' && sz !== '1K';
                return (
                  <button
                    key={sz}
                    onClick={() => !disabled && setImageSize(sz)}
                    disabled={disabled}
                    title={disabled ? t('mediaGenerationPanel.imageSizeUnavailableHint') : undefined}
                    className={`py-1.5 rounded-lg border text-center font-mono text-[11px] transition-all ${
                      imageSize === sz && !disabled
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                        : disabled
                          ? 'bg-slate-900/40 border-slate-800/60 text-slate-600 cursor-not-allowed'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {sz}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quality / thinking level — only for engines that document it */}
          {selectedEngine?.supportsQualityControl && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Gauge className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.qualityLabel')}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ['', t('mediaGenerationPanel.qualityAuto')],
                  ['minimal', t('mediaGenerationPanel.qualityFast')],
                  ['high', t('mediaGenerationPanel.qualityHigh')],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setQuality(val)}
                    className={`py-1.5 rounded-lg border text-center text-[10px] font-bold transition-all ${
                      quality === val
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 leading-snug">{t('mediaGenerationPanel.qualityHint')}</p>
            </div>
          )}

          {/* Output format — only for engines that document it */}
          {selectedEngine?.supportsFormatChoice && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <FileImage className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.formatLabel')}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ['', t('mediaGenerationPanel.formatAuto')],
                  ['png', t('mediaGenerationPanel.formatPng')],
                  ['jpeg', t('mediaGenerationPanel.formatJpeg')],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setOutputFormat(val)}
                    className={`py-1.5 rounded-lg border text-center text-[10px] font-bold transition-all ${
                      outputFormat === val
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-purple-600 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 text-slate-950 font-bold text-xs shadow-xl transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>{t('mediaGenerationPanel.generatingBtn')}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('mediaGenerationPanel.generateBtn')}</span>
              </>
            )}
          </button>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Live result preview */}
          <div className="pt-2 border-t border-slate-800">
            {lastResult ? (
              <div className="space-y-1.5">
                <div className="rounded-xl overflow-hidden border border-slate-700 bg-black">
                  <img src={lastResult.imageUrl} alt="" referrerPolicy="no-referrer" className="w-full h-auto max-h-48 object-cover" />
                </div>
                <p className="text-[10px] text-emerald-400 font-bold">{t('mediaGenerationPanel.resultAddedLabel')}</p>
              </div>
            ) : (
              <div className="text-center py-6 space-y-2 text-slate-600">
                <ImageIcon className="w-8 h-8 mx-auto" />
                <div className="space-y-0.5">
                  <p className="text-[11px] font-bold text-slate-500">{t('mediaGenerationPanel.resultReadyHeading')}</p>
                  <p className="text-[10px] text-slate-600 leading-snug px-2">{t('mediaGenerationPanel.resultReadyDesc')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
