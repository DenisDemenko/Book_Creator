import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, ImageIcon, Cpu, Film, Maximize2, Gauge, FileImage, AlertCircle, Upload, X, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
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
  // Раніше тут бракувало 'openai' і 'leonardo' — сервер уже роками віддає
  // обидва (server/imageGeneration.ts), просто жодне поле компонента не
  // звужувало вибір по цьому союзу настільки, щоб помилка стала видимою.
  provider: 'google' | 'bytedance' | 'openai' | 'leonardo';
  maxSize: '1K' | '2K' | '4K';
  supportsQualityControl: boolean;
  supportsFormatChoice: boolean;
  /**
   * Задача #203. Раніше цього поля не було, і панель малювала завантаження
   * референсів однаково для КОЖНОГО двигуна — з єдиним хардкодженим
   * лімітом 10, той самий, що й на сервері (MAX_REFERENCE_IMAGES). Це і
   * спричинило баг: автор додавав референси до класичного 'leonardo' —
   * панель мовчки дозволяла, а сервер відмовляв лише в момент генерації.
   * Тепер сервер сам каже, чи приймає обраний двигун референси і скільки.
   */
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  available: boolean;
}

interface MediaGenerationPanelProps {
  book: Book;
  isRegistered: boolean;
  onGenerated: (illustration: BookIllustration) => void;
  /**
   * Задача #205. Відео зберігається СЕРВЕРНОЮ медіатекою (`saveAsset`,
   * server/media/mediaLibraryStore.ts), а не в `book.illustrations[]`, як
   * фото — тому воно не може пройти через onGenerated(BookIllustration).
   * Панель лише повідомляє «щось нове зʼявилось на сервері», а батьківський
   * компонент сам перечитує медіатеку (той самий loadLibrary, що й для
   * серверних файлів завантаження).
   */
  onVideoGenerated: () => void;
  onToast: (msg: string) => void;
}

/** Задача #205. Форма відповіді `GET /api/ai/video-engines` (server/videoGeneration.ts::listVideoEngines). */
interface VideoEngineInfo {
  id: string;
  label: string;
  provider: 'leonardo';
  apiVersion: 'v1' | 'v2';
  /** v1 з фіксованим переліком тривалостей (напр. [4, 6, 8]); null — тривалість не налаштовується. */
  durationsSec: number[] | null;
  defaultDurationSec: number | null;
  /** v2 — тривалість діапазоном, а не переліком; null для v1. */
  durationMinSec: number | null;
  durationMaxSec: number | null;
  resolutions: string[];
  defaultResolution: string;
  aspectRatios: string[];
  defaultAspectRatio: string;
  /**
   * Задача #206. Перший кадр підтверджено для ВСІХ 10 двигунів (v1 —
   * окремий ендпоінт `/generations-image-to-video`; v2 — guidances.start_frame)
   * — тому завжди true, поле лишене для симетрії й на випадок майбутнього
   * двигуна без цієї підтримки. Останній кадр — лише для v2.
   */
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  available: boolean;
}

const ALL_SIZES: ('1K' | '2K' | '4K')[] = ['1K', '2K', '4K'];

/**
 * Резервний максимум референсів — лише поки список двигунів ще не
 * завантажився з сервера (`selectedEngine` тоді `undefined`). Щойно
 * рушій обрано, реальна межа приходить із `selectedEngine.maxReferenceImages`
 * (задача #203) — вона РІЗНА для кожного двигуна (2-16 у нових Leonardo
 * v2, 0 у класичного 'leonardo', 10 у решти) — і більше не хардкодиться
 * тут як єдине число.
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

export const MediaGenerationPanel: React.FC<MediaGenerationPanelProps> = ({ book, isRegistered, onGenerated, onVideoGenerated, onToast }) => {
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
  // Задача #215: скільки секунд триває поточна генерація — єдиний чесний
  // індикатор прогресу, бо ні Leonardo.Ai (фото v2, відео), ні решта
  // провайдерів не віддають проміжний відсоток/крок. null, поки нічого
  // не генерується.
  const [genElapsedSec, setGenElapsedSec] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ url: string; modelUsed: string; kind: 'photo' | 'video' } | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [referenceUrlInput, setReferenceUrlInput] = useState('');
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  // Задача #205: перемикач фото/відео. Обидва режими живуть в одній панелі
  // (спільний промпт, спільна кнопка «Згенерувати»), але кожен зі своїм
  // списком двигунів і параметрами — Leonardo.Ai відео не має aspectRatio/
  // imageSize/quality/format фото-моделей, натомість має resolution/duration.
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [videoEngines, setVideoEngines] = useState<VideoEngineInfo[]>([]);
  const [videoEngineId, setVideoEngineId] = useState<string>('');
  const [videoResolution, setVideoResolution] = useState<string>('');
  const [videoAspectRatio, setVideoAspectRatio] = useState<string>('');
  const [videoDurationSec, setVideoDurationSec] = useState<number | undefined>(undefined);

  // Задача #206: референс першого/останнього кадру для відео — ОДНЕ
  // зображення на поле (Leonardo документує максимум 1 елемент для
  // guidances.start_frame/end_frame і для imageId у v1), тому окремий,
  // простіший стан від масиву referenceImages вище (фото-референси).
  const [startFrameImage, setStartFrameImage] = useState<ReferenceImage | null>(null);
  const [endFrameImage, setEndFrameImage] = useState<ReferenceImage | null>(null);
  const [startFrameUrlInput, setStartFrameUrlInput] = useState('');
  const [endFrameUrlInput, setEndFrameUrlInput] = useState('');
  const startFrameFileInputRef = useRef<HTMLInputElement>(null);
  const endFrameFileInputRef = useRef<HTMLInputElement>(null);

  // Задача #216. Панель постійно займає w-80/w-96 зліва від галереї —
  // на вузьких екранах чи просто щоб побачити більше карток медіатеки,
  // автору нема куди її прибрати. Згорнута форма лишає лише вузьку смугу
  // з іконками-«ярликами» (режим фото/відео, двигун) — клік по будь-якій
  // розгортає панель назад, а не лише загальна кнопка вгорі.
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Задача #216. Список двигунів (5-10 карток) займав половину висоти
  // панелі одразу під заголовком, хоча двигун і так уже вибраний
  // автоматично (перший доступний, див. useEffect нижче) — розгорнутий
  // список був завжди видимим, навіть коли автор про нього не думав.
  // Тепер це розкривний блок: згорнутий показує лише обраний двигун
  // одним рядком, розгортається кліком і сам згортається назад одразу
  // після вибору іншого двигуна.
  const [isEnginePickerOpen, setIsEnginePickerOpen] = useState(false);

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

  // Задача #205: той самий принцип, що й для фото-двигунів вище — окремий
  // ендпоінт (/api/ai/video-engines), бо параметри геть інші (тривалість/
  // роздільність замість aspectRatio/imageSize).
  useEffect(() => {
    fetch('/api/ai/video-engines', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        const list: VideoEngineInfo[] = data?.engines || [];
        setVideoEngines(list);
        setVideoEngineId((prev) => prev || list.find((e) => e.available)?.id || list[0]?.id || '');
      })
      .catch(() => {
        /* панель лишається з порожнім списком відеодвигунів */
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
      case 'leonardo':
        // Задача #203: класичний v1-двигун — без референсів, на відміну
        // від 6 нових нижче. Ярлик тут, а не лише помилка після спроби
        // генерації, щоб автор бачив різницю ЗАЗДАЛЕГІДЬ.
        return t('mediaGenerationPanel.engineTagLeonardoV1');
      default:
        // 6 нових двигунів (задача #203) мають спільний префікс id.
        if (id.startsWith('leonardo-')) return t('mediaGenerationPanel.engineTagLeonardoV2');
        // Автор поскаржився, що незрозуміло, фото чи відео генерує обраний
        // двигун (особливо для брендів на кшталт Leonardo.Ai, який уміє
        // й те, й те) — GPT Image (OpenAI) раніше не мав жодного підпису
        // тут (порожній рядок), тож у панелі не було НІЧОГО, що назвало б
        // результат фото. Тепер запасний варіант завжди явно каже «Фото».
        return t('mediaGenerationPanel.engineTagGeneric');
    }
  };

  /** Задача #205: «4/6/8 с» для v1 (фіксований перелік) або «4–30 с» для v2 (діапазон). */
  const videoDurationLabel = (e: VideoEngineInfo): string => {
    if (e.durationsSec && e.durationsSec.length > 0) {
      return `${e.durationsSec.join('/')}${t('mediaGenerationPanel.videoUnitSeconds')}`;
    }
    if (e.durationMinSec != null && e.durationMaxSec != null) {
      return `${e.durationMinSec}–${e.durationMaxSec}${t('mediaGenerationPanel.videoUnitSeconds')}`;
    }
    return t('mediaGenerationPanel.videoDurationFixed');
  };

  const videoEngineTagFor = (e: VideoEngineInfo): string =>
    `${t('mediaGenerationPanel.videoTagPrefix')} • ${videoDurationLabel(e)} • ${e.resolutions.join('/')}p`;

  const selectedEngine = engines.find((e) => e.id === engineId);

  // Задача #203: реальна межа й підтримка референсів — з обраного
  // двигуна, а не єдиний хардкод. До завантаження списку (engines
  // порожній) лишаємо старий запасний ліміт, щоб панель не блимала.
  const referencesSupported = selectedEngine ? selectedEngine.supportsReferenceImages : true;
  const effectiveMaxReferences = selectedEngine ? selectedEngine.maxReferenceImages : MAX_REFERENCE_IMAGES;

  // Розмір, недоступний обраному двигуну, скидаємо на найбільший дозволений
  // — інакше кнопка «Згенерувати» мовчки надіслала б розмір, який сервер
  // все одно обріже до maxSize.
  useEffect(() => {
    if (!selectedEngine) return;
    if (selectedEngine.maxSize === '1K' && imageSize !== '1K') {
      setImageSize('1K');
    }
  }, [selectedEngine, imageSize]);

  // Задача #203: раніше перемикання на двигун без підтримки референсів
  // (класичний 'leonardo') чи з нижчою межею (наприклад, FLUX Dev — лише
  // 2) лишало вже додані референси в панелі — генерація однаково
  // провалювалась би на сервері. Тепер панель прибирає зайве одразу при
  // виборі двигуна, а не після невдалої спроби.
  useEffect(() => {
    if (!selectedEngine) return;
    if (!referencesSupported && referenceImages.length > 0) {
      setReferenceImages([]);
      onToast(t('mediaGenerationPanel.referenceImagesUnsupportedHint'));
      return;
    }
    if (referenceImages.length > effectiveMaxReferences) {
      setReferenceImages((prev) => prev.slice(0, effectiveMaxReferences));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEngine, referencesSupported, effectiveMaxReferences]);

  const selectedVideoEngine = videoEngines.find((e) => e.id === videoEngineId);

  // Задача #205: при виборі/зміні відеодвигуна підставляємо саме ЙОГО
  // дефолтні resolution/aspectRatio/duration — інакше, наприклад, обраний
  // раніше 1080p лишився б для двигуна, що приймає лише 480p.
  useEffect(() => {
    if (!selectedVideoEngine) return;
    setVideoResolution(selectedVideoEngine.defaultResolution);
    setVideoAspectRatio(selectedVideoEngine.defaultAspectRatio);
    setVideoDurationSec(selectedVideoEngine.defaultDurationSec ?? undefined);
  }, [selectedVideoEngine]);

  // Задача #206: останній кадр без першого не має сенсу (сервер це й так
  // перевіряє, але прибираємо ЗАЗДАЛЕГІДЬ у панелі — той самий принцип,
  // що й «прибрати референси при зміні двигуна» вище, задача #203) —
  // і якщо обраний двигун взагалі не підтримує останній кадр (усі v1).
  useEffect(() => {
    if (!startFrameImage && endFrameImage) {
      setEndFrameImage(null);
    }
  }, [startFrameImage, endFrameImage]);

  useEffect(() => {
    if (selectedVideoEngine && !selectedVideoEngine.supportsEndFrame && endFrameImage) {
      setEndFrameImage(null);
      onToast(t('mediaGenerationPanel.endFrameUnsupportedHint'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoEngine]);

  /** Додає завантажені файли як референси — до вільного місця (MAX_REFERENCE_IMAGES). */
  const handleReferenceFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = effectiveMaxReferences - referenceImages.length;
    if (room <= 0) {
      onToast(t('mediaGenerationPanel.referenceImagesTooMany', { max: effectiveMaxReferences }));
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
    if (referenceImages.length >= effectiveMaxReferences) {
      onToast(t('mediaGenerationPanel.referenceImagesTooMany', { max: effectiveMaxReferences }));
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

  /** Задача #206: те саме завантаження, що й handleReferenceFiles, лише ОДНЕ зображення в одне поле стану (setImage), не масив. */
  const handleSingleFrameFile = async (files: FileList | null, setImage: (r: ReferenceImage | null) => void) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast(t('mediaGenerationPanel.referenceImagesBadFile'));
      return;
    }
    const dataBase64 = await fileToBase64(file);
    setImage({
      id: `frame-${Date.now()}`,
      kind: 'upload',
      dataBase64,
      mimeType: file.type,
      previewUrl: `data:${file.type};base64,${dataBase64}`,
    });
  };

  const handleAddFrameUrl = (urlInput: string, setImage: (r: ReferenceImage | null) => void, clearInput: () => void) => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      onToast(t('mediaGenerationPanel.referenceImagesBadUrl'));
      return;
    }
    setImage({ id: `frame-${Date.now()}`, kind: 'url', url, previewUrl: url });
    clearInput();
  };

  // Задача #215: та сама причина, що й у pollVideoJob нижче (POLL_INTERVAL_MS/
  // MAX_ATTEMPTS дзеркалять server.ts MEDIA_ART_JOB_TTL_MS + серверний
  // POLL_MAX_ATTEMPTS у server/leonardoPhotoGeneration.ts, ~5.8 хв) — з
  // запасом на округлення, той самий інтервал (4с), що й для відео.
  const MEDIA_ART_STATUS_POLL_INTERVAL_MS = 4000;
  const MEDIA_ART_STATUS_POLL_MAX_ATTEMPTS = 100; // ~6.7 хв

  const pollMediaArtJob = async (
    jobId: string
  ): Promise<{
    imageUrl: string;
    promptUsed?: string;
    negativePrompt?: string;
    modelUsed?: string;
    modelKey?: string;
    aspectRatio?: string;
    fileSize?: string;
  } | null> => {
    for (let attempt = 0; attempt < MEDIA_ART_STATUS_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, MEDIA_ART_STATUS_POLL_INTERVAL_MS));
      let res: Response;
      try {
        res = await fetch(`/api/ai/generate-media-art/status/${jobId}`, { credentials: 'same-origin' });
      } catch {
        // Один пропущений опит через тимчасову мережеву проблему не має
        // провалювати всю генерацію — пробуємо ще раз на наступному тіку.
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (typeof data?.elapsedSec === 'number') setGenElapsedSec(data.elapsedSec);

      if (isGuestRestriction(res.status, data)) {
        setErrorMsg(t('mediaGenerationPanel.toastGuestRestricted'));
        onToast(t('mediaGenerationPanel.toastGuestRestricted'));
        return null;
      }
      if (res.status === 402 || data?.kind === 'quota_exceeded') {
        setErrorMsg(t('mediaGenerationPanel.toastQuotaExceeded'));
        onToast(t('mediaGenerationPanel.toastQuotaExceeded'));
        return null;
      }
      if (data?.status === 'complete' && data?.imageUrl) {
        return data;
      }
      if (!res.ok || data?.status === 'error') {
        const msg = data?.error || t('mediaGenerationPanel.toastGenFailed');
        setErrorMsg(msg);
        onToast(msg);
        return null;
      }
      // status === 'pending' — опитуємо далі.
    }
    const msg = t('mediaGenerationPanel.toastGenFailed');
    setErrorMsg(msg);
    onToast(msg);
    return null;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      onToast(t('mediaGenerationPanel.toastEmptyPrompt'));
      return;
    }
    setIsGenerating(true);
    setErrorMsg(null);
    setGenElapsedSec(0);
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
      const submitData = await res.json().catch(() => ({}));

      if (isGuestRestriction(res.status, submitData)) {
        setErrorMsg(t('mediaGenerationPanel.toastGuestRestricted'));
        onToast(t('mediaGenerationPanel.toastGuestRestricted'));
        return;
      }
      if (res.status === 402 || submitData?.kind === 'quota_exceeded') {
        setErrorMsg(t('mediaGenerationPanel.toastQuotaExceeded'));
        onToast(t('mediaGenerationPanel.toastQuotaExceeded'));
        return;
      }
      // Задача #215: сервер тепер відповідає 202 + jobId одразу (той самий
      // фікс, що й /api/ai/generate-video у #210) — жодна відповідь більше
      // не несе готове зображення напряму, лише через опитування статусу.
      if (!res.ok || res.status !== 202 || !submitData?.jobId) {
        const msg = submitData?.error || t('mediaGenerationPanel.toastGenFailed');
        setErrorMsg(msg);
        onToast(msg);
        return;
      }

      const data = await pollMediaArtJob(submitData.jobId);
      if (!data) return;

      setLastResult({ url: data.imageUrl, modelUsed: data.modelUsed || '', kind: 'photo' });

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
      setGenElapsedSec(null);
    }
  };

  /**
   * Задача #205. Свідомо ОКРЕМА від handleGenerate (фото): відео йде на
   * інший ендпоінт (/api/ai/generate-video), з іншим тілом запиту
   * (resolution/aspectRatio/durationSec замість imageSize/quality/format) і
   * головне — результат НЕ можна покласти в onGenerated(BookIllustration),
   * бо сервер зберігає відео в окремій медіатеці (saveAsset), а не в
   * book.illustrations[]. Тому успіх повідомляється через onVideoGenerated()
   * — батько сам перечитає список файлів.
   */
  /** Задача #206: та сама форма, якою вже кодуються referenceImages масиву вище — сервер очікує ідентичний {kind,...} для start/endFrameImage. */
  const frameToPayload = (r: ReferenceImage | null) => {
    if (!r) return undefined;
    return r.kind === 'upload'
      ? { kind: 'upload', dataBase64: r.dataBase64, mimeType: r.mimeType }
      : { kind: 'url', url: r.url };
  };

  // Задача #210, реальний продакшн-збій: живий виклик Seedance 2.5 (5с,
  // 720p) підтвердив, що один довгий HTTP-запит (весь час опитування
  // Leonardo — до кількох хвилин) не доживає до кінця: проксі хостингу
  // обриває з'єднання (502 ROUTER_EXTERNAL_TARGET_ERROR) приблизно на
  // ~90-й секунді, тоді як Leonardo, найімовірніше, продовжує генерацію.
  // Сервер тепер повертає jobId одразу (POST .../generate-video), а цей
  // хелпер опитує статус короткими запитами (кожен — миттєвий) замість
  // одного довгого fetch. Інтервал/кількість спроб — той самий запас, що
  // й у сервера (server/videoGeneration.ts: LEONARDO_VIDEO_POLL_MAX_ATTEMPTS
  // × LEONARDO_VIDEO_POLL_INTERVAL_MS ≈ 6 хв), з запасом на округлення.
  const VIDEO_STATUS_POLL_INTERVAL_MS = 4000;
  const VIDEO_STATUS_POLL_MAX_ATTEMPTS = 110; // ~7.3 хв

  const pollVideoJob = async (
    jobId: string
  ): Promise<{ videoUrl: string; modelUsed?: string } | null> => {
    for (let attempt = 0; attempt < VIDEO_STATUS_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, VIDEO_STATUS_POLL_INTERVAL_MS));
      let res: Response;
      try {
        res = await fetch(`/api/ai/generate-video/status/${jobId}`, { credentials: 'same-origin' });
      } catch {
        // Один пропущений опит через тимчасову мережеву проблему не має
        // провалювати всю генерацію — пробуємо ще раз на наступному тіку.
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (typeof data?.elapsedSec === 'number') setGenElapsedSec(data.elapsedSec);

      if (isGuestRestriction(res.status, data)) {
        setErrorMsg(t('mediaGenerationPanel.toastGuestRestricted'));
        onToast(t('mediaGenerationPanel.toastGuestRestricted'));
        return null;
      }
      if (res.status === 402 || data?.kind === 'quota_exceeded') {
        setErrorMsg(t('mediaGenerationPanel.toastQuotaExceeded'));
        onToast(t('mediaGenerationPanel.toastQuotaExceeded'));
        return null;
      }
      if (data?.status === 'complete' && data?.videoUrl) {
        return data;
      }
      if (!res.ok || data?.status === 'error') {
        const msg = data?.error || t('mediaGenerationPanel.toastGenFailed');
        setErrorMsg(msg);
        onToast(msg);
        return null;
      }
      // status === 'pending' — опитуємо далі.
    }
    const msg = t('mediaGenerationPanel.toastGenFailed');
    setErrorMsg(msg);
    onToast(msg);
    return null;
  };

  const handleGenerateVideo = async () => {
    if (!prompt.trim()) {
      onToast(t('mediaGenerationPanel.toastEmptyPrompt'));
      return;
    }
    setIsGenerating(true);
    setErrorMsg(null);
    setGenElapsedSec(0);
    try {
      const res = await fetch('/api/ai/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt,
          engine: videoEngineId || undefined,
          resolution: videoResolution || undefined,
          aspectRatio: videoAspectRatio || undefined,
          durationSec: typeof videoDurationSec === 'number' ? videoDurationSec : undefined,
          startFrameImage: frameToPayload(startFrameImage),
          endFrameImage: frameToPayload(endFrameImage),
          bookId: book.id,
          context: 'Медіатека',
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
      if (!res.ok || !data?.jobId) {
        const msg = data?.error || t('mediaGenerationPanel.toastGenFailed');
        setErrorMsg(msg);
        onToast(msg);
        return;
      }

      const videoData = await pollVideoJob(data.jobId);
      if (!videoData) return; // помилку вже показано всередині pollVideoJob

      setLastResult({ url: videoData.videoUrl, modelUsed: videoData.modelUsed || '', kind: 'video' });
      // Відео вже збережено на сервері (saveAsset) — просимо галерею
      // перечитати медіатеку, а не тягнемо файл у book.illustrations[].
      onVideoGenerated();
      onToast(t('mediaGenerationPanel.toastVideoGenerated', { model: videoData.modelUsed || '' }));
    } catch (err) {
      console.error('Error generating video:', err);
      setErrorMsg(t('mediaGenerationPanel.toastGenError'));
      onToast(t('mediaGenerationPanel.toastGenError'));
    } finally {
      setIsGenerating(false);
      setGenElapsedSec(null);
    }
  };

  return (
    <aside
      className={`shrink-0 h-full bg-slate-950/95 border-r border-slate-800 flex flex-col overflow-hidden transition-[width] ${
        isPanelCollapsed ? 'w-12' : 'w-full lg:w-80 xl:w-96'
      }`}
    >
      {isPanelCollapsed ? (
        /* Задача #216: згорнута панель — вузька смуга з іконками-ярликами
           замість повної форми. Клік по будь-якій іконці розгортає панель
           назад (а не лише загальна кнопка), бо саме так автор описав
           бажану поведінку — «розгортання з іконок функцій». */
        <div className="flex-1 flex flex-col items-center py-3 gap-1.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => setIsPanelCollapsed(false)}
            className="p-2 rounded-lg text-amber-400 hover:bg-slate-800 transition-colors"
            title={t('mediaGenerationPanel.expandPanelTooltip')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="w-6 h-px bg-slate-800 my-1 shrink-0" />
          <button
            type="button"
            onClick={() => {
              setMode('photo');
              setIsPanelCollapsed(false);
            }}
            className={`p-2 rounded-lg transition-colors ${
              mode === 'photo' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-white hover:bg-slate-800'
            }`}
            title={t('mediaGenerationPanel.modePhotoLabel')}
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('video');
              setIsPanelCollapsed(false);
            }}
            className={`p-2 rounded-lg transition-colors ${
              mode === 'video' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-white hover:bg-slate-800'
            }`}
            title={t('mediaGenerationPanel.modeVideoLabel')}
          >
            <Film className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPanelCollapsed(false);
              setIsEnginePickerOpen(true);
            }}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
            title={t('mediaGenerationPanel.engineLabel')}
          >
            <Cpu className="w-4 h-4" />
          </button>
        </div>
      ) : (
      <>
      <div className="p-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 via-purple-500/20 to-cyan-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-white font-heading">{t('mediaGenerationPanel.heading')}</h2>
          <button
            type="button"
            onClick={() => setIsPanelCollapsed(true)}
            className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title={t('mediaGenerationPanel.collapsePanelTooltip')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{t('mediaGenerationPanel.subheading')}</p>
      </div>

      {!isRegistered ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-xs text-slate-400">{t('mediaGenerationPanel.guestBlocked')}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Задача #205: перемикач фото/відео — раніше цієї панелі відео
              взагалі не було видно, і автор не міг зрозуміти, що генерація
              відео Leonardo.Ai досі не підключена. Тепер це явний вибір
              нагорі форми, а не підпис під одним із двигунів. */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setMode('photo')}
              className={`py-2 rounded-xl border text-center text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'photo'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" /> {t('mediaGenerationPanel.modePhotoLabel')}
            </button>
            <button
              onClick={() => setMode('video')}
              className={`py-2 rounded-xl border text-center text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'video'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" /> {t('mediaGenerationPanel.modeVideoLabel')}
            </button>
          </div>

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

          {/* Reference images — image-to-image / мультиреференсна генерація (#52, #203). Відео (задача #205) референсів не приймає — guidances.start_frame/video_reference лишаються свідомо непідключеними (див. videoGeneration.ts). */}
          {mode === 'photo' && referencesSupported ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('mediaGenerationPanel.referenceImagesLabel')}</span>
              <span className="text-slate-600 font-mono normal-case">
                {t('mediaGenerationPanel.referenceImagesCount', { count: referenceImages.length, max: effectiveMaxReferences })}
              </span>
            </label>
            <p className="text-[10px] text-slate-600 leading-snug">
              {t('mediaGenerationPanel.referenceImagesHint', { max: effectiveMaxReferences })}
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
              disabled={referenceImages.length >= effectiveMaxReferences}
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
                disabled={referenceImages.length >= effectiveMaxReferences}
                className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-hidden disabled:opacity-40"
              />
              <button
                onClick={handleAddReferenceUrl}
                disabled={!referenceUrlInput.trim() || referenceImages.length >= effectiveMaxReferences}
                className="px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white disabled:opacity-40 shrink-0"
              >
                {t('mediaGenerationPanel.referenceImagesUrlAddBtn')}
              </button>
            </div>
          </div>
          ) : null}

          {/* Engine — задача #216: розкривний блок. Двигун і так уже
              вибирається автоматично (перший доступний, useEffect вище),
              тож повний список карток не має стирчати розгорнутим завжди —
              згорнутий стан показує обраний двигун одним рядком, клік
              розгортає повний перелік, вибір іншого двигуна згортає назад. */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setIsEnginePickerOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2"
            >
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.engineLabel')}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${isEnginePickerOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {!isEnginePickerOpen && (
              <button
                type="button"
                onClick={() => setIsEnginePickerOpen(true)}
                className={`w-full p-2 rounded-xl border text-left transition-all ${
                  mode === 'photo' ? 'bg-slate-900 border-amber-500/60' : 'bg-slate-900 border-cyan-500/60'
                }`}
              >
                <span className="text-[11px] font-bold text-white truncate flex items-center gap-1">
                  {mode === 'photo' ? (
                    <ImageIcon className="w-3 h-3 text-amber-400/70 shrink-0" />
                  ) : (
                    <Film className="w-3 h-3 text-cyan-400/70 shrink-0" />
                  )}
                  {(mode === 'photo' ? selectedEngine?.label : selectedVideoEngine?.label) || t('mediaGenerationPanel.engineLabel')}
                </span>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  {mode === 'photo'
                    ? (selectedEngine ? engineTagFor(selectedEngine.id) : '')
                    : (selectedVideoEngine ? videoEngineTagFor(selectedVideoEngine) : '')}
                </div>
              </button>
            )}

            {isEnginePickerOpen && (
            <>
            {/*
              Автор поскаржився: у списку не видно, генерує обраний двигун
              фото чи відео — особливо гостро для рушіїв «через Leonardo.Ai»,
              бо Leonardo.Ai реально вміє й те, й те, а ця панель — лише
              фото-частину. Явний напис тут не залежить від того, чи
              прочитає автор підзаголовок панелі вгорі.
            */}
            {mode === 'photo' ? (
              <>
                <p className="text-[10px] text-amber-400/80 leading-snug flex items-start gap-1">
                  <ImageIcon className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{t('mediaGenerationPanel.engineSectionPhotoNote')}</span>
                </p>
                <div className="space-y-1.5">
                  {engines.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        setEngineId(e.id);
                        setIsEnginePickerOpen(false);
                      }}
                      disabled={!e.available}
                      title={!e.available ? t('mediaGenerationPanel.engineUnavailableHint') : undefined}
                      className={`w-full p-2 rounded-xl border text-left transition-all ${
                        engineId === e.id
                          ? 'bg-slate-900 border-amber-500 ring-1 ring-amber-500/50'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      } ${!e.available ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-white truncate flex items-center gap-1">
                          <ImageIcon className="w-3 h-3 text-amber-400/70 shrink-0" />
                          {e.label}
                        </span>
                        {!e.available && <AlertCircle className="w-3 h-3 text-slate-500 shrink-0" />}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{engineTagFor(e.id)}</div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* Задача #205: ті самі десять відеодвигунів Leonardo.Ai
                    (Motion 2.0, Veo 3, Kling, Seedance 2.5, Wan 3.0,
                    FLUX 3 Video), що вже роками віддає сервер
                    (/api/ai/video-engines, задачі #201/#202) — раніше без
                    жодного інтерфейсу. */}
                <p className="text-[10px] text-cyan-400/80 leading-snug flex items-start gap-1">
                  <Film className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{t('mediaGenerationPanel.videoEngineSectionNote')}</span>
                </p>
                <div className="space-y-1.5">
                  {videoEngines.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        setVideoEngineId(e.id);
                        setIsEnginePickerOpen(false);
                      }}
                      disabled={!e.available}
                      title={!e.available ? t('mediaGenerationPanel.engineUnavailableHint') : undefined}
                      className={`w-full p-2 rounded-xl border text-left transition-all ${
                        videoEngineId === e.id
                          ? 'bg-slate-900 border-cyan-500 ring-1 ring-cyan-500/50'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      } ${!e.available ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-white truncate flex items-center gap-1">
                          <Film className="w-3 h-3 text-cyan-400/70 shrink-0" />
                          {e.label}
                        </span>
                        {!e.available && <AlertCircle className="w-3 h-3 text-slate-500 shrink-0" />}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{videoEngineTagFor(e)}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            </>
            )}
          </div>

          {/* Задача #205: параметри ВІДЕО — своя роздільність/пропорції/
              тривалість замість фото-полів нижче. */}
          {mode === 'video' && selectedVideoEngine && (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Maximize2 className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.videoResolutionLabel')}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {selectedVideoEngine.resolutions.map((res) => (
                    <button
                      key={res}
                      onClick={() => setVideoResolution(res)}
                      className={`py-1.5 rounded-lg border text-center font-mono text-[11px] transition-all ${
                        videoResolution === res
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {res}p
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Film className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.aspectRatioLabel')}
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {selectedVideoEngine.aspectRatios.map((ar) => (
                    <button
                      key={ar}
                      onClick={() => setVideoAspectRatio(ar)}
                      className={`py-1.5 rounded-lg border text-center font-mono text-[11px] transition-all ${
                        videoAspectRatio === ar
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="w-3 h-3 text-amber-400" /> {t('mediaGenerationPanel.videoDurationLabel')}
                </label>
                {selectedVideoEngine.durationsSec && selectedVideoEngine.durationsSec.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {selectedVideoEngine.durationsSec.map((sec) => (
                      <button
                        key={sec}
                        onClick={() => setVideoDurationSec(sec)}
                        className={`py-1.5 rounded-lg border text-center font-mono text-[11px] transition-all ${
                          videoDurationSec === sec
                            ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {sec}{t('mediaGenerationPanel.videoUnitSeconds')}
                      </button>
                    ))}
                  </div>
                ) : selectedVideoEngine.durationMinSec != null && selectedVideoEngine.durationMaxSec != null ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={selectedVideoEngine.durationMinSec}
                      max={selectedVideoEngine.durationMaxSec}
                      step={1}
                      value={videoDurationSec ?? selectedVideoEngine.defaultDurationSec ?? selectedVideoEngine.durationMinSec}
                      onChange={(e) => setVideoDurationSec(Number(e.target.value))}
                      className="flex-1 accent-amber-500"
                    />
                    <span className="text-[11px] font-mono text-amber-300 font-bold w-12 text-right">
                      {videoDurationSec ?? selectedVideoEngine.defaultDurationSec}{t('mediaGenerationPanel.videoUnitSeconds')}
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-600 leading-snug">{t('mediaGenerationPanel.videoDurationFixedHint')}</p>
                )}
              </div>

              {/* Задача #206: референс першого кадру — підтверджено для
                  усіх 10 відеодвигунів (image-to-video). */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>{t('mediaGenerationPanel.startFrameLabel')}</span>
                </label>
                <p className="text-[10px] text-slate-600 leading-snug">{t('mediaGenerationPanel.startFrameHint')}</p>
                {startFrameImage ? (
                  <div className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
                    <img src={startFrameImage.previewUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setStartFrameImage(null)}
                      title={t('mediaGenerationPanel.referenceImagesRemoveTitle')}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={startFrameFileInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        handleSingleFrameFile(e.target.files, setStartFrameImage);
                        e.target.value = '';
                      }}
                    />
                    <button
                      onClick={() => startFrameFileInputRef.current?.click()}
                      className="w-full py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white hover:border-slate-700 flex items-center justify-center gap-1.5"
                    >
                      <Upload className="w-3 h-3" /> {t('mediaGenerationPanel.referenceImagesUploadBtn')}
                    </button>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={startFrameUrlInput}
                        onChange={(e) => setStartFrameUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddFrameUrl(startFrameUrlInput, setStartFrameImage, () => setStartFrameUrlInput(''))}
                        placeholder={t('mediaGenerationPanel.referenceImagesUrlPlaceholder')}
                        className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-hidden"
                      />
                      <button
                        onClick={() => handleAddFrameUrl(startFrameUrlInput, setStartFrameImage, () => setStartFrameUrlInput(''))}
                        disabled={!startFrameUrlInput.trim()}
                        className="px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white disabled:opacity-40 shrink-0"
                      >
                        {t('mediaGenerationPanel.referenceImagesUrlAddBtn')}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Задача #206: референс останнього кадру — лише v2 (Seedance
                  2.5 / Wan 3.0 / Kling O3 / FLUX 3 Video), і лише коли вже
                  обрано перший кадр (жоден із двигунів не приймає останній
                  без першого). */}
              {selectedVideoEngine.supportsEndFrame && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>{t('mediaGenerationPanel.endFrameLabel')}</span>
                  </label>
                  <p className="text-[10px] text-slate-600 leading-snug">
                    {startFrameImage ? t('mediaGenerationPanel.endFrameHint') : t('mediaGenerationPanel.endFrameNeedsStartHint')}
                  </p>
                  {endFrameImage ? (
                    <div className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-800 bg-slate-900">
                      <img src={endFrameImage.previewUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setEndFrameImage(null)}
                        title={t('mediaGenerationPanel.referenceImagesRemoveTitle')}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        ref={endFrameFileInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={!startFrameImage}
                        onChange={(e) => {
                          handleSingleFrameFile(e.target.files, setEndFrameImage);
                          e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => endFrameFileInputRef.current?.click()}
                        disabled={!startFrameImage}
                        className="w-full py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white hover:border-slate-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        <Upload className="w-3 h-3" /> {t('mediaGenerationPanel.referenceImagesUploadBtn')}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={endFrameUrlInput}
                          onChange={(e) => setEndFrameUrlInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddFrameUrl(endFrameUrlInput, setEndFrameImage, () => setEndFrameUrlInput(''))}
                          placeholder={t('mediaGenerationPanel.referenceImagesUrlPlaceholder')}
                          disabled={!startFrameImage}
                          className="flex-1 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-hidden disabled:opacity-40"
                        />
                        <button
                          onClick={() => handleAddFrameUrl(endFrameUrlInput, setEndFrameImage, () => setEndFrameUrlInput(''))}
                          disabled={!startFrameImage || !endFrameUrlInput.trim()}
                          className="px-2.5 py-2 rounded-lg border border-slate-800 bg-slate-900 text-[10px] text-slate-400 hover:text-white disabled:opacity-40 shrink-0"
                        >
                          {t('mediaGenerationPanel.referenceImagesUrlAddBtn')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Aspect ratio */}
          {mode === 'photo' && (
          <>
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
          </>
          )}

          {/* Quality / thinking level — only for engines that document it */}
          {mode === 'photo' && selectedEngine?.supportsQualityControl && (
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
          {mode === 'photo' && selectedEngine?.supportsFormatChoice && (
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
            onClick={() => (mode === 'photo' ? handleGenerate() : handleGenerateVideo())}
            disabled={isGenerating || !prompt.trim() || (mode === 'video' && !videoEngineId)}
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

          {/* Задача #215: жоден провайдер (Leonardo.Ai найперше) не віддає
              відсоток/крок генерації — минулий час це єдине чесне, що
              можна показати замість голого нескінченного спінера. */}
          {isGenerating && genElapsedSec !== null && (
            <div className="text-[10px] text-slate-500 text-center -mt-1">
              {t('mediaGenerationPanel.generatingElapsed', { seconds: String(genElapsedSec) })}
            </div>
          )}

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
                  {lastResult.kind === 'video' ? (
                    <video
                      src={lastResult.url}
                      controls
                      muted
                      loop
                      className="w-full h-auto max-h-48 object-cover"
                    />
                  ) : (
                    <img src={lastResult.url} alt="" referrerPolicy="no-referrer" className="w-full h-auto max-h-48 object-cover" />
                  )}
                </div>
                <p className="text-[10px] text-emerald-400 font-bold">{t('mediaGenerationPanel.resultAddedLabel')}</p>
              </div>
            ) : (
              <div className="text-center py-6 space-y-2 text-slate-600">
                {mode === 'video' ? <Film className="w-8 h-8 mx-auto" /> : <ImageIcon className="w-8 h-8 mx-auto" />}
                <div className="space-y-0.5">
                  <p className="text-[11px] font-bold text-slate-500">{t('mediaGenerationPanel.resultReadyHeading')}</p>
                  <p className="text-[10px] text-slate-600 leading-snug px-2">
                    {mode === 'video' ? t('mediaGenerationPanel.resultReadyDescVideo') : t('mediaGenerationPanel.resultReadyDesc')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </aside>
  );
};
