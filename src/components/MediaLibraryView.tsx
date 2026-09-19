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
  HardDrive,
  Film,
  RefreshCw,
  ArrowUpDown,
  AlertTriangle
} from 'lucide-react';
import { Book, BookIllustration, AuthUser } from '../types';
import { downloadImageAs } from '../utils/helpers';
import { useLanguage } from '../i18n/LanguageContext';
import { detectImageFormat, IMAGE_FORMAT_LABEL } from '../utils/imageFormat';
import {
  DEFAULT_MEDIA_SORT,
  MEDIA_SORT_METHODS,
  formatMediaDate,
  mediaComparator,
  type MediaSortMethod,
} from '../utils/mediaSort';
import { MediaGenerationPanel } from './MediaGenerationPanel';

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

/** Розділ медіатеки — група файлів однієї книги (`GET /api/media/sections`). */
interface LibrarySection {
  bookId: string | null;
  title: string | null;
  count: number;
  sizeBytes: number;
}

/** Файл із серверної медіатеки автора — те, що справді лежить у сховищі. */
interface ServerAsset {
  id: string;
  url: string;
  bookId: string | null;
  kind: string;
  filename: string;
  sizeBytes: number;
  prompt?: string | null;
  /** ISO-дата завантаження — саме за нею працює порядок «від першої генерації». */
  createdAt?: string;
}

/**
 * Картка галереї. Джерела два, і вони не еквівалентні: посилання з книги
 * (обкладинка, портрети, ілюстрації) і файл серверної медіатеки. Показуємо
 * обидва, бо книга може містити старі `data:`-URL, яких на сервері немає.
 */
type MediaCard = {
  id: string;
  url: string;
  title: string;
  type: 'portraits' | 'illustrations' | 'covers' | 'videos';
  prompt?: string;
  source?: string;
  /** Книга-розділ цього файлу; `''` — файли без книги. */
  sectionId: string;
  sectionTitle: string;
  /**
   * Коли файл зʼявився. Серверна медіатека знає це точно; посилання,
   * вбудоване просто в книгу, — лише тоді, коли поруч лежить такий самий
   * файл серверної медіатеки (шукаємо за URL) або коли дата є в самій
   * ілюстрації. Інакше — `undefined`, і картка піде в кінець переліку.
   */
  createdAt?: string;
  /** Вага файлу в байтах; у посилань із книги її немає. */
  sizeBytes?: number;
};

const MB = 1024 * 1024;

/**
 * Мінімум, потрібний видаленню. Саме стільки є і в картки галереї, і в
 * лайтбокса — тому той самий діалог підтвердження обслуговує обидва місця,
 * а не дублюється.
 */
interface DeletableMedia {
  id: string;
  url: string;
  title: string;
  /** `'covers'` / `'portraits'` — усе решта вважається ілюстрацією. */
  type: string;
  /** `'upload'` — файл серверної медіатеки; інакше — посилання з книги. */
  source?: string;
}

/** Службовий id для файлів без книги (`book_id = null`). */
const NO_BOOK_SECTION = '';
const ALL_SECTIONS = '__all__';

/**
 * Ключі підписів для списку сортування. Окремою таблицею, а не зібраним
 * на ходу рядком: так `t()` дістає справжні ключі, а не «схожі» на них.
 */
const SORT_LABEL_KEY: Record<MediaSortMethod, string> = {
  generationAsc: 'mediaLibraryView.sortGenerationAsc',
  generationDesc: 'mediaLibraryView.sortGenerationDesc',
  format: 'mediaLibraryView.sortFormat',
  title: 'mediaLibraryView.sortTitle',
  size: 'mediaLibraryView.sortSize',
};

export const MediaLibraryView: React.FC<MediaLibraryViewProps> = ({ book, onUpdateBook, authUser }) => {
  const [filter, setFilter] = useState<'all' | 'portraits' | 'illustrations' | 'covers' | 'videos'>('all');
  // Спосіб сортування галереї — спільний для фото й відео (задача про відео:
  // усі вони MP4, тож за форматом їх не розрізнити, а порядок появи — можна).
  const [sort, setSort] = useState<MediaSortMethod>(DEFAULT_MEDIA_SORT);
  const [selectedMedia, setSelectedMedia] = useState<{ id: string; url: string; title: string; type: string; prompt?: string; source?: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  // Задача #217. Йде видалення саме ЦІЄЇ картки — окремий від isDownloading
  // стан, бо видалення й завантаження можуть відбуватись одночасно на РІЗНИХ
  // картках, а не заважати одне одному через спільний прапорець.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Задача #218-Б. Файл, який автор попросив видалити, але ще не
  // підтвердив. Видалення незворотне (див. діалог нижче), тому сама кнопка
  // кошика нічого не стирає — вона лише відкриває попередження.
  const [pendingDelete, setPendingDelete] = useState<DeletableMedia | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [sections, setSections] = useState<LibrarySection[]>([]);
  const [serverAssets, setServerAssets] = useState<ServerAsset[]>([]);
  /** Обраний розділ: id книги, `ALL_SECTIONS` — усі одразу. */
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();
  const isRegistered = !!authUser && !authUser.isGuest;

  /**
   * Серверна медіатека автора: розділи по книгах і самі файли.
   * Два запити замість одного — бо розділ без назви книги неможливо
   * підписати: title лежить у книгосховищі, а не в записі файлу.
   */
  const loadLibrary = useCallback(async () => {
    if (!isRegistered) {
      setSections([]);
      setServerAssets([]);
      return;
    }
    try {
      const [sectionsRes, listRes] = await Promise.all([
        fetch('/api/media/sections', { credentials: 'same-origin' }),
        fetch('/api/media/list', { credentials: 'same-origin' }),
      ]);
      if (sectionsRes.ok) {
        const data = await sectionsRes.json();
        setSections(Array.isArray(data?.sections) ? data.sections : []);
      }
      if (listRes.ok) {
        const data = await listRes.json();
        setServerAssets(Array.isArray(data?.assets) ? data.assets : []);
      }
    } catch {
      /* тихо — галерея просто лишиться книжковою, як була до розділів */
    }
  }, [isRegistered]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Перемикання активної книги в студії повертає галерею в її ж розділ —
  // інакше автор бачив би чужі файли під заголовком своєї книги.
  useEffect(() => {
    setSelectedSectionId(book.id);
  }, [book.id]);

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

  // ── Галерея: два джерела ────────────────────────────────────────────────
  // 1) Посилання з самої книги (обкладинка, портрети, ілюстрації) — у тому
  //    вигляді, у якому автор бачив їх досі. Старі книги можуть тримати тут
  //    `data:`-URL, яких на сервері немає, тож не показувати їх означало б
  //    «зникли картинки».
  // 2) Файли серверної медіатеки — усе, що завантажено для будь-якої книги;
  //    саме вони й розкладаються по розділах через `book_id`.
  //
  // Дати створення книга не зберігає — але для ЗАВАНТАЖЕНИХ файлів вона є
  // на сервері (`MediaAsset.createdAt`), і той самий файл у книзі тримає
  // рівно той самий URL (`/api/media/file?id=…`). Тому картку з книги можна
  // датувати, нічого не вигадуючи: шукаємо її URL серед серверних файлів.
  const assetCreatedAtByUrl = new Map<string, string>();
  for (const asset of serverAssets) {
    if (asset.createdAt && !assetCreatedAtByUrl.has(asset.url)) {
      assetCreatedAtByUrl.set(asset.url, asset.createdAt);
    }
  }

  const objectMedia: MediaCard[] = [];

  if (book.coverConfig.frontArtUrl) {
    objectMedia.push({
      id: 'media-cover',
      url: book.coverConfig.frontArtUrl,
      title: t('mediaLibraryView.coverArtTitle'),
      type: 'covers',
      sectionId: book.id,
      sectionTitle: book.title,
      createdAt: assetCreatedAtByUrl.get(book.coverConfig.frontArtUrl),
    });
  }

  book.characters.forEach((char) => {
    if (char.avatarUrl) {
      objectMedia.push({
        id: `char-media-${char.id}`,
        url: char.avatarUrl,
        title: t('mediaLibraryView.portraitTitle', { name: `${char.name} ${char.surname || ''}` }),
        type: 'portraits',
        sectionId: book.id,
        sectionTitle: book.title,
        createdAt: assetCreatedAtByUrl.get(char.avatarUrl),
      });
    }
  });

  (book.illustrations || []).forEach((ill) => {
    objectMedia.push({
      id: ill.id,
      url: ill.url,
      title: ill.caption,
      type: 'illustrations',
      prompt: ill.promptUsed,
      source: ill.source,
      sectionId: book.id,
      sectionTitle: book.title,
      // Власна дата ілюстрації точніша за пошук за URL — вона про генерацію,
      // а не про завантаження файлу в сховище.
      createdAt: ill.createdAt || assetCreatedAtByUrl.get(ill.url),
    });
  });

  // Той самий файл, описаний і в книзі, і на сервері, показуємо один раз.
  const objectUrls = new Set(objectMedia.map((m) => m.url));
  const sectionTitleById = new Map(sections.map((s) => [s.bookId ?? NO_BOOK_SECTION, s.title || '']));

  const serverCards: MediaCard[] = serverAssets
    .filter((a) => !(a.bookId === book.id && objectUrls.has(a.url)))
    .map((asset) => {
      const sectionId = asset.bookId ?? NO_BOOK_SECTION;
      return {
        id: asset.id,
        url: asset.url,
        title: asset.filename || asset.id,
        type: asset.kind === 'cover_art' ? 'covers' : asset.kind === 'character_art' ? 'portraits' : asset.kind === 'video' ? 'videos' : 'illustrations',
        prompt: asset.prompt || undefined,
        source: 'upload',
        sectionId,
        sectionTitle: sectionTitleById.get(sectionId) || t('mediaLibraryView.sectionNoBook'),
        createdAt: asset.createdAt,
        sizeBytes: asset.sizeBytes,
      } satisfies MediaCard;
    });

  const allMedia: MediaCard[] = [...objectMedia, ...serverCards];

  // Порядок обирає автор (`mediaSort.ts`): типово — «від першої генерації
  // до останньої», бо саме хронологія пояснює, який кадр за яким ішов.
  // Файли без дати компаратор ставить у кінець переліку — і це єдина
  // чесна відповідь, коли дати немає зовсім.
  const visibleMedia = allMedia
    .filter((m) => selectedSectionId === ALL_SECTIONS || m.sectionId === selectedSectionId)
    .filter((m) => filter === 'all' || m.type === filter)
    .sort(mediaComparator(sort));

  // У режимі «Усі книги» картки групуються під заголовком свого розділу —
  // саме те, що дає змогу бачити файли різних книг окремо в одному списку.
  const showSectionHeaders = selectedSectionId === ALL_SECTIONS;
  const groups: { sectionId: string; title: string; items: MediaCard[] }[] = [];
  if (showSectionHeaders) {
    const bySection = new Map<string, MediaCard[]>();
    for (const card of visibleMedia) {
      const bucket = bySection.get(card.sectionId) || [];
      bucket.push(card);
      bySection.set(card.sectionId, bucket);
    }
    for (const [sectionId, items] of bySection) {
      groups.push({ sectionId, title: items[0]?.sectionTitle || t('mediaLibraryView.sectionNoBook'), items });
    }
    // Активна книга — завжди першою: це те, з чим автор працює зараз.
    groups.sort((a, b) =>
      a.sectionId === book.id ? -1 : b.sectionId === book.id ? 1 : a.title.localeCompare(b.title)
    );
  } else {
    groups.push({ sectionId: selectedSectionId, title: '', items: visibleMedia });
  }

  const sectionOptions = [
    { value: book.id, label: book.title },
    ...sections
      .filter((s) => s.bookId && s.bookId !== book.id)
      .map((s) => ({ value: s.bookId as string, label: `${s.title || t('mediaLibraryView.sectionNoBook')} (${s.count})` })),
  ];
  if (sections.some((s) => !s.bookId)) {
    const noBook = sections.find((s) => !s.bookId)!;
    sectionOptions.push({ value: NO_BOOK_SECTION, label: `${t('mediaLibraryView.sectionNoBook')} (${noBook.count})` });
  }

  /** Куди кладеться новий файл: обраний розділ, а в режимі «усі» — активна книга. */
  const uploadTargetBookId = selectedSectionId === ALL_SECTIONS || !selectedSectionId ? book.id : selectedSectionId;

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

  /**
   * Задача #205. Відео НЕ можна прогнати через downloadImageAs() — та функція
   * малює `new Image()` на `<canvas>` і перекодовує в PNG/JPG, а <canvas>
   * не вміє декодувати відеобайти взагалі (просто ніколи не викличе onload).
   * Тому окремий, набагато простіший шлях: забрати байти як blob і віддати
   * через тимчасове посилання — без рекодування, MP4 лишається MP4.
   */
  const handleDownloadVideo = async (url: string, title: string) => {
    setIsDownloading(true);
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const cleanBaseName = (title || 'video').replace(/[^a-zA-Z0-9А-Яа-яЇїІіЄєҐґ_\-\s]/g, '_');
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${cleanBaseName || 'video'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      showToast(t('mediaLibraryView.downloadedVideoToast'));
    } catch (err) {
      console.error('Video download error:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * Задача #217. Галерея — ДВА джерела картки (див. коментар над MediaCard
   * вище), і вони видаляються по-різному:
   *  - `source === 'upload'` — файл СЕРВЕРНОЇ медіатеки (реальний id у
   *    mediaLibraryStore) → DELETE /api/media/:id стирає байти з диска.
   *    Лічильник тарифу при цьому НЕ звільняється — це свідома політика
   *    (`mediaStorage.ts`: той самий підхід, що й у лічильника генерацій),
   *    тому в попередженні про це сказано прямо, а не обіцяно «місце
   *    звільниться».
   *  - інакше — посилання, вбудоване прямо в книгу (обкладинка/портрет/
   *    ілюстрація) — на сервері може взагалі не існувати як окремий файл
   *    (старі книги тримають тут `data:`-URL), тому видалення — це мутація
   *    самої книги через onUpdateBook(), а не мережевий запит.
   *
   * Викликається ЛИШЕ після підтвердження в діалозі (`confirmDelete`).
   */
  const handleDeleteMedia = async (item: DeletableMedia) => {
    setDeletingId(item.id);
    try {
      if (item.source === 'upload') {
        const res = await fetch(`/api/media/${item.id}`, { method: 'DELETE', credentials: 'same-origin' });
        if (!res.ok) {
          showToast(t('mediaLibraryView.toastDeleteFailed'));
          return;
        }
        setServerAssets((prev) => prev.filter((a) => a.id !== item.id));
        loadStorageInfo();
        showToast(t('mediaLibraryView.toastDeleted'));
        return;
      }

      if (item.type === 'covers') {
        onUpdateBook(
          { ...book, coverConfig: { ...book.coverConfig, frontArtUrl: '' } },
          'Видалення медіа',
          `Вилучено обкладинку «${item.title}»`
        );
      } else if (item.type === 'portraits') {
        const charId = item.id.replace('char-media-', '');
        onUpdateBook(
          {
            ...book,
            characters: book.characters.map((c) => (c.id === charId ? { ...c, avatarUrl: '' } : c)),
          },
          'Видалення медіа',
          `Вилучено портрет «${item.title}»`
        );
      } else {
        onUpdateBook(
          { ...book, illustrations: (book.illustrations || []).filter((i) => i.id !== item.id) },
          'Видалення медіа',
          `Вилучено ілюстрацію «${item.title}»`
        );
      }
      showToast(t('mediaLibraryView.toastDeleted'));
    } catch (err) {
      console.error('Media delete error:', err);
      showToast(t('mediaLibraryView.toastDeleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * Задача #218-Б. Видалення з підтвердженням.
   *
   * Відновити видалене нічим: у медіатеки немає кошика й немає архіву —
   * байти з диска стерто, а резервної копії проєкт не тримає. Тому кнопка
   * кошика більше нічого не робить сама: вона лише ставить картку в
   * `pendingDelete`, а діалог просить сказати це явно. Автор бачить і
   * мініатюру того самого файлу (щоб не видалити сусідній кадр), і чесний
   * текст про те, що наслідки незворотні.
   */
  const confirmDelete = async () => {
    const item = pendingDelete;
    if (!item) return;
    await handleDeleteMedia(item);
    // Діалог закриваємо в будь-якому разі: якщо запит упав, картка
    // лишиться на місці, а про помилку скаже тост (toastDeleteFailed).
    setPendingDelete(null);
  };

  /**
   * Завантаження файлу з компʼютера (задача #100).
   *
   * Раніше файл ставав `data:`-URL ВСЕРЕДИНІ книги: альбом жив в IndexedDB
   * одного браузера, а кожне збереження книги тягло ті самі мегабайти на
   * сервер заново. Тепер байти йдуть у медіатеку на сервері, а в книзі
   * лишається коротке посилання.
   *
   * Ліміт тарифу перевіряє САМ маршрут завантаження — окремий виклик
   * check-upload тут прибрано, інакше ті самі байти списувалися б двічі.
   */
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
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(String(event.target?.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          dataUrl,
          filename: file.name,
          bookId: uploadTargetBookId,
          kind: 'upload',
        }),
      });
      const data = await res.json();

      const storage = data?.storage || data;
      if (typeof storage?.usedBytes === 'number') {
        setStorageInfo({
          usedBytes: storage.usedBytes,
          quotaBytes: storage.quotaBytes ?? null,
          remainingBytes: storage.remainingBytes ?? null,
        });
      }
      if (!res.ok || !data?.asset?.url) {
        showToast(data?.error || t('mediaLibraryView.quotaCheckFailed'));
        return;
      }

      const asset = data.asset;
      const caption = file.name.replace(/\.[^/.]+$/, '');
      await loadLibrary();

      // Файл, завантажений у ЧУЖИЙ розділ, не має потрапляти в ілюстрації
      // активної книги — інакше він з'явився б у тексті не тієї книги.
      if (uploadTargetBookId !== book.id) {
        const target = sections.find((s) => (s.bookId ?? NO_BOOK_SECTION) === uploadTargetBookId);
        showToast(
          t('mediaLibraryView.uploadedToSection', { title: target?.title || t('mediaLibraryView.sectionNoBook') })
        );
        return;
      }

      const newIll: BookIllustration = {
        id: `ill-upload-${Date.now()}`,
        chapterId: book.chapters[0]?.id,
        url: asset.url,
        caption,
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
    } catch {
      showToast(t('mediaLibraryView.quotaCheckFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  // Нове зображення з панелі генерації зліва — той самий шлях у книгу, що
  // й пряме завантаження файлу вище (chapterId першої глави, style
  // «Медіатека»), лише source: 'ai' і збережений промпт.
  const handleGeneratedImage = (illustration: BookIllustration) => {
    onUpdateBook(
      {
        ...book,
        illustrations: [...(book.illustrations || []), illustration],
      },
      'Згенеровано зображення в медіатеці',
      `Додано зображення «${illustration.caption}» (${illustration.modelUsed || 'AI'})`
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-900 text-slate-100">

      {/* Панель генерації — на всю висоту вкладки, зліва від галереї. */}
      <MediaGenerationPanel
        book={book}
        isRegistered={isRegistered}
        onGenerated={handleGeneratedImage}
        onVideoGenerated={loadLibrary}
        onToast={showToast}
      />

      <div className="flex-1 p-4 lg:p-6 overflow-y-auto space-y-6">

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
              {t('mediaLibraryView.subBadge', { n: String(visibleMedia.length) })}
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
          {isRegistered && sectionOptions.length > 1 && (
            <select
              value={selectedSectionId}
              onChange={(e) => setSelectedSectionId(e.target.value)}
              data-tour="media__0"
              title={t('mediaLibraryView.sectionLabel')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-cyan-500 focus:outline-hidden max-w-[220px]"
            >
              <option value={ALL_SECTIONS}>{t('mediaLibraryView.sectionAll')}</option>
              {sectionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}

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
            {(['all', 'illustrations', 'portraits', 'covers', 'videos'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  filter === f
                    ? 'bg-slate-800 text-cyan-300 shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f === 'all' ? t('mediaLibraryView.filterAll') : f === 'illustrations' ? t('mediaLibraryView.filterIllustrations') : f === 'portraits' ? t('mediaLibraryView.filterPortraits') : f === 'covers' ? t('mediaLibraryView.filterCovers') : t('mediaLibraryView.filterVideos')}
              </button>
            ))}
          </div>

          {/* Сортування — одне на фото й відео: і ті, і ті лежать в одному
              переліку, а «Відео» окремою вкладкою лишається фільтром. */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800"
            data-tour="media__4"
            title={t('mediaLibraryView.sortLabel')}
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as MediaSortMethod)}
              aria-label={t('mediaLibraryView.sortLabel')}
              className="bg-transparent text-xs text-slate-200 focus:outline-hidden cursor-pointer max-w-[190px]"
            >
              {MEDIA_SORT_METHODS.map((method) => (
                <option key={method} value={method} className="bg-slate-950">
                  {t(SORT_LABEL_KEY[method])}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Media Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-tour="media__3">
        {groups.map((group) => (
          <React.Fragment key={group.sectionId || 'no-book'}>
            {showSectionHeaders && (
              <div className="col-span-full flex items-center justify-between border-b border-slate-800 pb-2 mt-1">
                <h2 className="text-sm font-bold text-white font-heading">{group.title}</h2>
                <span className="text-[11px] text-slate-400">
                  {t('mediaLibraryView.sectionItems', { n: String(group.items.length) })}
                </span>
              </div>
            )}
            {group.items.map((item) => (
          <div
            key={item.id}
            className="group rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 hover:border-cyan-500/50 shadow-lg transition-all flex flex-col justify-between"
          >
            <div 
              onClick={() => setSelectedMedia(item)}
              className="h-48 overflow-hidden bg-black flex items-center justify-center relative cursor-pointer"
            >
              {item.type === 'videos' ? (
                <video
                  src={item.url}
                  muted
                  loop
                  playsInline
                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                  className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300"
                />
              ) : (
                <img
                  src={item.url}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-105 transition-all duration-300"
                />
              )}
              {/* Формат файлу — за ним і відсортовано перелік (для відео — завжди MP4, Leonardo.Ai інших контейнерів не віддає) */}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/60 backdrop-blur-md text-amber-300">
                {item.type === 'videos' ? 'MP4' : IMAGE_FORMAT_LABEL[detectImageFormat(item.url)]}
              </div>
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/60 backdrop-blur-md text-cyan-300 flex items-center gap-1">
                {item.type === 'videos' && <Film className="w-2.5 h-2.5" />}
                {item.type}
              </div>
              {/* Дата появи файлу — вона ж і ключ сортування. Немає дати —
                  немає підпису: прочерк на кожній старій ілюстрації був би шумом. */}
              {formatMediaDate(item.createdAt) && (
                <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/60 backdrop-blur-md text-slate-300">
                  {formatMediaDate(item.createdAt)}
                </div>
              )}
              {/* Задача #217. Кошик — на самій мініатюрі, а не в рядку
                  завантаження нижче (там уже тісно від PNG/JPG/MP4-кнопок).
                  Клік по ньому не має відкривати лайтбокс — stopPropagation.
                  Задача #218-Б: клік не видаляє, а питає підтвердження. */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(item);
                }}
                disabled={deletingId === item.id}
                className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 backdrop-blur-md text-rose-400 hover:bg-rose-500/30 hover:text-rose-300 transition-all disabled:opacity-70 disabled:cursor-wait"
                title={t('mediaLibraryView.deleteTooltip')}
                aria-label={t('mediaLibraryView.deleteTooltip')}
                data-delete-media={item.id}
              >
                {deletingId === item.id ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="p-3.5 space-y-2">
              <h3 className="text-xs font-bold text-white truncate">{item.title}</h3>
              
              {/* Quick Download Buttons */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase font-mono">
                  {t('mediaLibraryView.exportLabel')}
                </span>
                {item.type === 'videos' ? (
                  <button
                    onClick={() => handleDownloadVideo(item.url, item.title)}
                    disabled={isDownloading}
                    className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] font-bold border border-slate-700 flex items-center gap-1 transition-all"
                    title={t('mediaLibraryView.downloadVideoLabel')}
                  >
                    <Download className="w-2.5 h-2.5" />
                    <span>MP4</span>
                  </button>
                ) : (
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
                )}
              </div>

            </div>
          </div>
            ))}
          </React.Fragment>
        ))}
      </div>

      {/* Задача #218-Б. Підтвердження видалення. Стоїть НАД лайтбоксом
          (z-[60] проти z-50), бо видаляти можна і з нього: автор має бачити
          саме попередження, а не два вікна одночасно. */}
      {pendingDelete && (
        <div
          onClick={() => {
            if (deletingId !== pendingDelete.id) setPendingDelete(null);
          }}
          className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-rose-500/40 rounded-3xl max-w-md w-full shadow-2xl space-y-4 p-6 text-white"
            data-delete-dialog
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-rose-500/15 border border-rose-500/30 shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="text-base font-bold text-white">{t('mediaLibraryView.deleteConfirmTitle')}</h3>
                <p className="text-xs text-slate-400 break-words">{pendingDelete.title}</p>
              </div>
            </div>

            {/* Мініатюра саме того файлу: у галереї поруч стоять десятки
                схожих кадрів, і «той чи сусідній» — головний ризик. */}
            <div className="h-32 overflow-hidden rounded-2xl bg-black border border-slate-800 flex items-center justify-center">
              {pendingDelete.type === 'videos' ? (
                <video
                  src={pendingDelete.url}
                  muted
                  loop
                  playsInline
                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                  className="max-h-full w-auto object-contain"
                />
              ) : (
                <img
                  src={pendingDelete.url}
                  alt={pendingDelete.title}
                  referrerPolicy="no-referrer"
                  className="max-h-full w-auto object-contain"
                />
              )}
            </div>

            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 space-y-1.5">
              <p className="text-xs font-bold text-rose-300">{t('mediaLibraryView.deleteConfirmWarning')}</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {pendingDelete.source === 'upload'
                  ? t('mediaLibraryView.deleteConfirmNoteStored')
                  : t('mediaLibraryView.deleteConfirmNoteLinked')}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deletingId === pendingDelete.id}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all disabled:opacity-60"
                data-delete-cancel
              >
                {t('mediaLibraryView.deleteConfirmCancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deletingId === pendingDelete.id}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md transition-all disabled:opacity-70 disabled:cursor-wait"
                data-delete-confirm
              >
                {deletingId === pendingDelete.id ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>{t('mediaLibraryView.deleteConfirmConfirm')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* High-res Modal */}
      {selectedMedia && (
        <div
          onClick={() => setSelectedMedia(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          data-media-lightbox
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-950 border border-slate-800 rounded-3xl max-w-3xl w-full overflow-hidden shadow-2xl space-y-4 p-6 text-white"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-cyan-300">{selectedMedia.title}</h3>
              <div className="flex items-center gap-1">
                {/* Задача #218-Б. Кошик і в лайтбоксі: кадр роздивляються на
                    весь екран саме тоді, коли вирішують, що він зайвий. */}
                <button
                  onClick={() => setPendingDelete(selectedMedia)}
                  className="p-1.5 rounded-full text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-all"
                  title={t('mediaLibraryView.deleteTooltip')}
                  aria-label={t('mediaLibraryView.deleteTooltip')}
                  data-delete-media-lightbox={selectedMedia.id}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedMedia(null)}
                  className="text-slate-400 hover:text-white font-bold text-lg px-1"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="max-h-[55vh] overflow-hidden rounded-2xl bg-black flex items-center justify-center border border-slate-800">
              {selectedMedia.type === 'videos' ? (
                <video
                  src={selectedMedia.url}
                  controls
                  autoPlay
                  className="max-h-[55vh] w-auto object-contain"
                />
              ) : (
                <img
                  src={selectedMedia.url}
                  alt={selectedMedia.title}
                  referrerPolicy="no-referrer"
                  className="max-h-[55vh] w-auto object-contain"
                />
              )}
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
                {selectedMedia.type === 'videos' ? (
                  <button
                    onClick={() => handleDownloadVideo(selectedMedia.url, selectedMedia.title)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t('mediaLibraryView.downloadVideoLabel')}</span>
                  </button>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      </div>
    </div>
  );
};
