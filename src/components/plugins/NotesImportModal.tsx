import React, { useRef, useState } from 'react';
import {
  X,
  Upload,
  Mic,
  FileText,
  Loader2,
  Check,
  AlertTriangle,
  Sparkles,
  Trash2,
  RefreshCw,
  Music,
  Image as ImageIcon,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { AuthUser, Book, BookIllustration, UserRole } from '../../types';
import { hasPermission } from '../../utils/rbac';
import { appendTextToChapterEnd } from '../../utils/bookText';
import { fileToBase64 } from '../../utils/extractChatFileText';
import {
  parseNotesZip,
  matchLooseNotes,
  imagePlaceholderToken,
  type ParsedNoteEntry,
  type LooseFileInput,
} from '../../utils/notesImport';

interface NotesImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  currentRole: UserRole;
  authUser?: AuthUser | null;
  onUpdateBook: (updatedBook: Book, auditAction?: string, auditDetails?: string) => void;
}

type NoteStatus = 'pending' | 'processing' | 'ready' | 'inserting' | 'inserted' | 'skipped' | 'error';

interface ReviewNote extends ParsedNoteEntry {
  status: NoteStatus;
  transcript?: string;
  reasoning?: string;
  confidence?: number;
  usedFallbackEngineForAudio?: boolean;
  errorMessage?: string;
  chosenChapterId?: string;
  insertText?: string;
  insertedChapterTitle?: string;
}

const ZIP_EXT = /\.zip$/i;
const MD_EXT = /\.md$/i;
const AUDIO_EXT = /\.(m4a|mp3|mpeg|wav|aac|ogg|flac|webm|aiff)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|heif|bmp|tiff?)$/i;

/**
 * Плагін «Імпорт нотаток iPhone» (запис #191, розширено запис #192,
 * розділ «Плагіни» в шапці студії). Власник диктує чи нашвидкуруч записує
 * уривки книги в застосунок Нотатки на телефоні — голосом, текстом,
 * чеклістом, таблицею, фото чи посиланням упереміш — експортує нотатки —
 * кожна лягає власним .md-файлом, що посилається на вкладення в теці
 * Attachments/ — і цей плагін розшифровує аудіо, переносить решту вмісту
 * (текст/чекліст/таблиця/картинки/посилання) в формат книги й пропонує
 * главу для вставки. АВТОР ЗАВЖДИ бачить розшифровку й пропозицію ПЕРЕД
 * вставкою і може змінити главу чи сам текст, або пропустити нотатку —
 * жодна нотатка не потрапляє в книгу без явного підтвердження (власник
 * підтвердив цей вибір явно, а не «вставляти автоматично, коли ШІ
 * впевнений»).
 */
export const NotesImportModal: React.FC<NotesImportModalProps> = ({
  isOpen,
  onClose,
  book,
  currentRole,
  authUser,
  onUpdateBook,
}) => {
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [isParsingFiles, setIsParsingFiles] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const allowed = hasPermission(currentRole, 'canImportBook');
  const hasChapters = book.chapters.length > 0;

  const updateNote = (id: string, patch: Partial<ReviewNote>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };

  const addEntries = (entries: ParsedNoteEntry[]) => {
    setNotes((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const fresh: ReviewNote[] = entries
        .filter((e) => !existingIds.has(e.id))
        .map((e) => ({ ...e, status: 'pending' as const }));
      return [...prev, ...fresh];
    });
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setFileError(null);
    setIsParsingFiles(true);
    try {
      const files = Array.from(fileList);
      const zipFiles = files.filter((f) => ZIP_EXT.test(f.name));
      const mdFiles = files.filter((f) => MD_EXT.test(f.name));
      const audioFiles = files.filter((f) => AUDIO_EXT.test(f.name));
      const imageFiles = files.filter((f) => IMAGE_EXT.test(f.name));
      const unknown = files.filter(
        (f) => !ZIP_EXT.test(f.name) && !MD_EXT.test(f.name) && !AUDIO_EXT.test(f.name) && !IMAGE_EXT.test(f.name)
      );

      const collected: ParsedNoteEntry[] = [];

      for (const zip of zipFiles) {
        const entries = await parseNotesZip(zip);
        collected.push(...entries);
      }

      if (mdFiles.length > 0 || audioFiles.length > 0 || imageFiles.length > 0) {
        const looseInputs: LooseFileInput[] = [];
        for (const md of mdFiles) {
          looseInputs.push({ name: md.name, kind: 'md', text: await md.text() });
        }
        for (const audio of audioFiles) {
          looseInputs.push({ name: audio.name, kind: 'audio', base64: await fileToBase64(audio), mimeType: null });
        }
        for (const image of imageFiles) {
          looseInputs.push({ name: image.name, kind: 'image', base64: await fileToBase64(image), mimeType: image.type || null });
        }
        collected.push(...matchLooseNotes(looseInputs));
      }

      if (collected.length === 0) {
        setFileError(
          unknown.length > 0
            ? 'Серед вибраних файлів немає жодного .md, аудіо, картинки чи .zip з експортом нотаток.'
            : 'Не вдалося розпізнати жодної нотатки у вибраних файлах.'
        );
      } else {
        addEntries(collected);
      }
    } catch (err: any) {
      setFileError(err?.message || 'Не вдалося прочитати вибрані файли.');
    } finally {
      setIsParsingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processNote = async (note: ReviewNote) => {
    if (!hasChapters) return;
    updateNote(note.id, { status: 'processing', errorMessage: undefined });
    try {
      const response = await fetch('/api/ai/notes-import/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteText: note.bodyText,
          audioBase64: note.audioBase64 || undefined,
          audioMimeType: note.audioMimeType || undefined,
          chapters: book.chapters.map((c) => ({ id: c.id, title: c.title })),
          bookId: book.id,
          modelId: book.preferredAiModelId || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || `Сервер повернув статус ${response.status}.`);
      }
      // ВАЖЛИВО: раніше тут бралося лише data.transcript, і якщо в нотатці
      // була ОДНОЧАСНО й аудіо-розшифровка, й написаний текст (чекліст,
      // таблиця, картинки, посилання) — усе, крім самої розшифровки,
      // мовчки губилося. combinedText — це і є розшифровка + текст нотатки
      // разом, саме так, як повертає сервер.
      const insertText = (data.combinedText && String(data.combinedText).trim()) || note.bodyText.trim();
      updateNote(note.id, {
        status: 'ready',
        transcript: data.transcript || '',
        reasoning: data.reasoning || '',
        confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
        usedFallbackEngineForAudio: !!data.usedFallbackEngineForAudio,
        chosenChapterId: data.suggestedChapterId || book.chapters[0]?.id,
        insertText,
      });
    } catch (err: any) {
      updateNote(note.id, { status: 'error', errorMessage: err?.message || 'Помилка обробки нотатки.' });
    }
  };

  const processAllPending = async () => {
    setIsProcessingAll(true);
    try {
      // Послідовно, не паралельно: одна нотатка — це два виклики AI
      // (розшифровка + підбір глави), і паралельний залп на кілька
      // нотаток одразу — прямий шлях до ліміту запитів провайдера.
      for (const note of notes) {
        if (note.status === 'pending' || note.status === 'error') {
          await processNote(note);
        }
      }
    } finally {
      setIsProcessingAll(false);
    }
  };

  /**
   * Кладе зображення в медіатеку користувача на сервері (`POST
   * /api/media/upload`), а в книгу — коротке посилання на файл, замість
   * десятків мегабайт base64 у JSON книги (той самий прийом і той самий
   * компроміс, що й в ImportMaterialsWizardModal). Гостю сховища немає —
   * і для нього, і при будь-якій помилці сервера падає назад на прямий
   * data:URL: картинка все одно з'явиться в книзі, просто важча.
   */
  const uploadImageToMediaLibrary = async (
    img: { fileName: string; dataUrl: string }
  ): Promise<{ url: string }> => {
    if (!authUser || authUser.isGuest) return { url: img.dataUrl };
    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dataUrl: img.dataUrl, filename: img.fileName, bookId: book.id, kind: 'upload' }),
      });
      const data = await res.json();
      if (res.ok && data?.asset?.url) return { url: data.asset.url as string };
    } catch {
      /* сервер недоступний — повертаємо data-URL нижче */
    }
    return { url: img.dataUrl };
  };

  const handleInsert = async (note: ReviewNote) => {
    if (!note.chosenChapterId) return;
    const chapter = book.chapters.find((c) => c.id === note.chosenChapterId);
    if (!chapter) return;

    updateNote(note.id, { status: 'inserting' });

    let text = (note.insertText || '').trim();
    const now = new Date().toISOString();
    const newIllustrations: BookIllustration[] = [];

    // Картинки нотатки — лише ті, чий токен-заглушка ще реально стоїть у
    // (можливо відредагованому автором) тексті: якщо автор рядок з
    // конкретною картинкою просто видалив з textarea, це й є спосіб
    // «не вставляти цю картинку» — жодного окремого перемикача для цього
    // не потрібно, і зайве завантаження в медіатеку не робиться.
    for (const image of note.images) {
      const token = imagePlaceholderToken(image.placeholderIndex, image.caption);
      if (!text.includes(token)) continue;

      if (image.missing) {
        text = text.split(token).join(`«Зображення "${image.caption}" не додано: файл не знайдено серед вибраного.»`);
        continue;
      }
      if (image.unsupported || !image.mimeType || !image.base64) {
        text = text.split(token).join(
          `«Зображення "${image.caption}" не додано: формат не підтримується — перезбережіть як JPEG або PNG.»`
        );
        continue;
      }

      const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
      const { url } = await uploadImageToMediaLibrary({ fileName: image.fileName || image.caption, dataUrl });
      const illustrationId = `ill-notes-${Date.now()}-${image.placeholderIndex}`;
      newIllustrations.push({
        id: illustrationId,
        chapterId: note.chosenChapterId,
        url,
        caption: image.caption,
        aspectRatio: '1:1',
        style: 'Імпорт нотаток',
        source: 'upload',
        createdAt: now,
      });
      text = text.split(token).join(`[IMG: ${illustrationId} "${image.caption}" wrap=none]`);
    }

    text = text.trim();
    if (!text) {
      updateNote(note.id, { status: 'ready', errorMessage: undefined });
      return;
    }

    const result = appendTextToChapterEnd(book.chapters, note.chosenChapterId, text);
    if (!result) {
      updateNote(note.id, { status: 'ready' });
      return;
    }

    onUpdateBook(
      {
        ...book,
        chapters: result.chapters,
        illustrations: newIllustrations.length ? [...(book.illustrations || []), ...newIllustrations] : book.illustrations,
        updatedAt: now,
      },
      'Текст із плагіна «Імпорт нотаток» додано до книги',
      chapter.title
    );
    updateNote(note.id, { status: 'inserted', insertedChapterTitle: chapter.title, insertText: text });
  };

  const handleSkip = (note: ReviewNote) => updateNote(note.id, { status: 'skipped' });
  const handleRemove = (id: string) => setNotes((prev) => prev.filter((n) => n.id !== id));
  const handleClearAll = () => setNotes([]);

  const pendingCount = notes.filter((n) => n.status === 'pending' || n.status === 'error').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div
        className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 bg-slate-950/70 flex items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Mic className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Імпорт нотаток iPhone</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Голос, текст, чеклісти, таблиці, фото й посилання з експорту «Нотаток» — розшифровка та підбір глави книги.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!allowed ? (
          <div className="p-6">
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-300">Немає доступу</p>
                <p className="text-rose-200/80 mt-1 text-xs">
                  У вашій ролі немає права імпортувати матеріали в книгу.
                </p>
              </div>
            </div>
          </div>
        ) : (
        <div className="p-5 sm:p-6 overflow-y-auto flex-grow flex flex-col gap-4">
          {!hasChapters && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>У книзі ще немає жодного розділу — спершу створіть хоча б один у вкладці «Книга & Текст», щоб було куди вставляти імпортований текст.</span>
            </div>
          )}

          {/* Upload zone */}
          <div className="p-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-slate-600 transition-colors flex flex-col items-center gap-2 text-center">
            <Upload className="w-6 h-6 text-slate-500" />
            <p className="text-xs text-slate-400 max-w-md">
              Оберіть ZIP-експорт нотаток, або окремі .md, аудіо- (.m4a, .mp3, .wav, .aac, .ogg, .flac) і файли-картинки (.png, .jpg, .webp, .gif) — можна кілька за раз.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsingFiles}
              className="mt-1 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-2"
            >
              {isParsingFiles ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span>Обрати файли</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".zip,.md,.m4a,.mp3,.mpeg,.wav,.aac,.ogg,.flac,.webm,.aiff,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif"
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
          </div>

          {fileError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          {notes.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-400">Нотаток: {notes.length}</span>
              <div className="flex items-center gap-2">
                {pendingCount > 0 && (
                  <button
                    onClick={processAllPending}
                    disabled={isProcessingAll || !hasChapters}
                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    {isProcessingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>Обробити всі ({pendingCount})</span>
                  </button>
                )}
                <button
                  onClick={handleClearAll}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Очистити список</span>
                </button>
              </div>
            </div>
          )}

          {/* Notes list */}
          <div className="flex flex-col gap-3">
            {notes.map((note) => (
              <div key={note.id} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {note.audioFileName ? (
                      <Music className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-slate-200 truncate">{note.fileName}</span>
                    {note.audioFileName && (
                      <span className="text-[10px] text-slate-500 font-mono truncate">({note.audioFileName})</span>
                    )}
                    {note.images.length > 0 && (
                      <span className="text-[10px] text-slate-500 flex items-center gap-0.5 shrink-0">
                        <ImageIcon className="w-3 h-3" />
                        {note.images.length}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {note.status === 'pending' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">Очікує</span>}
                    {note.status === 'processing' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Обробка…
                      </span>
                    )}
                    {note.status === 'ready' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Готово до перевірки</span>}
                    {note.status === 'inserting' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Вставка…
                      </span>
                    )}
                    {note.status === 'inserted' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">Вставлено</span>}
                    {note.status === 'skipped' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">Пропущено</span>}
                    {note.status === 'error' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300">Помилка</span>}
                    <button onClick={() => handleRemove(note.id)} className="p-1 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-rose-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {note.audioMissing && (
                  <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>У нотатці є посилання на аудіо, але сам файл не знайдено серед вибраного — оброблено лише текст нотатки.</span>
                  </div>
                )}

                {note.images.some((i) => i.missing || i.unsupported) && (
                  <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {note.images.filter((i) => i.missing).length > 0 &&
                        `Не знайдено серед вибраного: ${note.images.filter((i) => i.missing).length} картинки. `}
                      {note.images.filter((i) => i.unsupported).length > 0 &&
                        `Формат не підтримується (потрібен JPEG/PNG/WEBP/GIF): ${note.images
                          .filter((i) => i.unsupported)
                          .map((i) => i.fileName)
                          .join(', ')}.`}
                    </span>
                  </div>
                )}

                {note.images.some((i) => !i.missing && !i.unsupported && i.base64) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {note.images
                      .filter((i) => !i.missing && !i.unsupported && i.base64)
                      .map((i) => (
                        <img
                          key={i.placeholderIndex}
                          src={`data:${i.mimeType};base64,${i.base64}`}
                          alt={i.caption}
                          title={i.caption}
                          className="w-12 h-12 object-cover rounded-lg border border-slate-700"
                        />
                      ))}
                  </div>
                )}

                {note.status === 'pending' && (
                  <button
                    onClick={() => processNote(note)}
                    disabled={!hasChapters}
                    className="self-start px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Обробити</span>
                  </button>
                )}

                {note.status === 'error' && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-rose-300">{note.errorMessage}</span>
                    <button
                      onClick={() => processNote(note)}
                      className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Спробувати ще раз</span>
                    </button>
                  </div>
                )}

                {(note.status === 'ready' || note.status === 'inserting' || note.status === 'inserted') && (
                  <div className="flex flex-col gap-2.5">
                    {note.usedFallbackEngineForAudio && (
                      <div className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg p-2 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>Розшифровано через Gemini — обрана вами модель ШІ аудіо не підтримує.</span>
                      </div>
                    )}

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        Текст для вставки (можна відредагувати; рядок <code>[[ЗОБРАЖЕННЯ #…]]</code> — місце картинки, видаліть рядок, щоб не вставляти саме її)
                      </label>
                      <textarea
                        value={note.insertText || ''}
                        onChange={(e) => updateNote(note.id, { insertText: e.target.value })}
                        disabled={note.status !== 'ready'}
                        rows={6}
                        className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 leading-relaxed disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>

                    {note.transcript && note.bodyText && note.transcript.trim() !== note.bodyText.trim() && (
                      <div className="text-[11px] text-slate-400 bg-slate-950/60 rounded-lg p-2">
                        <span className="font-bold text-slate-500">Текст самої нотатки (не вставлено окремо — вже входить у поле вище): </span>
                        <span className="italic">«{note.bodyText}»</span>
                      </div>
                    )}

                    {note.status === 'ready' && (
                      <>
                        <div className="flex items-center gap-2">
                          <select
                            value={note.chosenChapterId || ''}
                            onChange={(e) => updateNote(note.id, { chosenChapterId: e.target.value })}
                            className="flex-1 text-xs font-medium p-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100"
                          >
                            {book.chapters.map((ch) => (
                              <option key={ch.id} value={ch.id}>
                                {ch.title}
                              </option>
                            ))}
                          </select>
                          {typeof note.confidence === 'number' && (
                            <span className="text-[10px] font-mono text-slate-400 shrink-0" title="Впевненість ШІ у виборі глави">
                              {note.confidence}%
                            </span>
                          )}
                        </div>
                        {note.reasoning && <p className="text-[11px] text-slate-500 italic">{note.reasoning}</p>}

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleInsert(note)}
                            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                          >
                            <Check className="w-4 h-4" />
                            <span>Вставити в главу</span>
                          </button>
                          <button
                            onClick={() => handleSkip(note)}
                            className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs"
                          >
                            <X className="w-4 h-4" />
                            <span>Пропустити</span>
                          </button>
                        </div>
                      </>
                    )}

                    {note.status === 'inserted' && (
                      <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>Додано до розділу «{note.insertedChapterTitle}».</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {notes.length === 0 && !isParsingFiles && (
            <p className="text-xs text-slate-500 text-center py-6">
              Ще нічого не обрано — додайте файли вище, щоб почати.
            </p>
          )}
        </div>
        )}
      </div>
    </div>
  );
};
