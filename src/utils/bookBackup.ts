import JSZip from 'jszip';
import { Book } from '../types';

/**
 * Резервна копія книги («Резервна копія книги (ZIP)») — на відміну від
 * DOCX/EPUB/друкованого PDF чи course.zip (усі вони — представлення для
 * читання, з втратою структури), тут пакується повний, дослівний Book JSON:
 * глави, розділи, персонажі, ілюстрації, курс, верстка PDF, налаштування
 * видання — усе, що потрібно, щоб відкрити файл і продовжити редагування
 * так, ніби роботу й не переривали.
 *
 * Зображення й файли матеріалів курсу вже зберігаються в самому Book як
 * data:URL (той самий підхід, що й у src/utils/storage.ts), тому їх не
 * потрібно розпаковувати в окремі файли — book.json самодостатній.
 */

export const BOOK_BACKUP_SCHEMA_VERSION = 1;

export interface BookBackupManifest {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  bookId: string;
  title: string;
  author: string;
  chapterCount: number;
  wordCount: number;
}

export type BookBackupErrorKind =
  | 'not_a_zip'
  | 'course_export'
  | 'missing_book_json'
  | 'invalid_json'
  | 'invalid_schema';

export class BookBackupError extends Error {
  kind: BookBackupErrorKind;
  constructor(kind: BookBackupErrorKind, message: string) {
    super(message);
    this.name = 'BookBackupError';
    this.kind = kind;
  }
}

function countWords(book: Book): number {
  return (book.chapters || []).reduce(
    (sum, c) => sum + (c.sections || []).reduce((s, sec) => s + (sec.wordCount || 0), 0),
    0
  );
}

/**
 * Пакує повну книгу в ZIP: book.json (дослівні дані), manifest.json
 * (короткі метадані для швидкого прев'ю без розбору всього JSON) та
 * README.txt з поясненням для людини, яка відкриє архів поза застосунком.
 */
export async function exportBookToBackupZip(book: Book): Promise<void> {
  const zip = new JSZip();

  const manifest: BookBackupManifest = {
    schemaVersion: BOOK_BACKUP_SCHEMA_VERSION,
    appVersion: 'Fusion Lab Studio',
    exportedAt: new Date().toISOString(),
    bookId: book.id,
    title: book.title,
    author: book.author,
    chapterCount: (book.chapters || []).length,
    wordCount: countWords(book),
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('book.json', JSON.stringify(book, null, 2));
  zip.file(
    'README.txt',
    'Це повна резервна копія проєкту книги Fusion Lab Studio.\n' +
      'Файл book.json містить усі дані рукопису: глави, розділи, персонажів,\n' +
      'ілюстрації, курс, верстку PDF та налаштування видання.\n\n' +
      'Щоб продовжити роботу над книгою — на стартовій сторінці Fusion Lab Studio\n' +
      'натисніть «Відкрити з ZIP» і виберіть цей файл.\n\n' +
      'Не редагуйте book.json вручну без потреби: пошкоджений JSON унеможливить імпорт.\n'
  );

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const safeTitle = (book.title || 'book').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_backup.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Мінімальна структурна перевірка. Не повна валідація типів (це зробив би
 * лише повноцінний JSON Schema), а швидкий, зрозумілий людині захист від
 * відверто чужого чи пошкодженого файлу — перевіряємо саме ті поля Book,
 * які в types.ts позначені обов'язковими.
 */
function isPlausibleBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.title === 'string' &&
    typeof b.author === 'string' &&
    Array.isArray(b.chapters) &&
    Array.isArray(b.characters) &&
    typeof b.layoutConfig === 'object' && b.layoutConfig !== null &&
    typeof b.coverConfig === 'object' && b.coverConfig !== null &&
    typeof b.visualBible === 'object' && b.visualBible !== null
  );
}

export interface ReadBookBackupResult {
  book: Book;
  manifest: BookBackupManifest | null;
}

/**
 * Читає ZIP, обраний користувачем через <input type="file">, і повертає
 * розібрану книгу. Розрізняє три випадки помилки, щоб повідомлення було
 * по суті, а не загальним «не вдалося»:
 *   1. файл узагалі не ZIP / пошкоджений архів;
 *   2. це наш власний course.zip (є course-info.json, немає book.json) —
 *      коректний архів, але не той формат: у ньому немає повного тексту
 *      книги, потрібного для продовження редагування;
 *   3. book.json відсутній, або є, але це не JSON книги Fusion Lab Studio.
 */
export async function readBookBackupZip(file: File): Promise<ReadBookBackupResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new BookBackupError(
      'not_a_zip',
      'Обраний файл не є коректним ZIP-архівом (пошкоджений або невірний формат).'
    );
  }

  const bookEntry = zip.file('book.json');
  if (!bookEntry) {
    if (zip.file('course-info.json')) {
      throw new BookBackupError(
        'course_export',
        'Це архів курсу (course.zip) — він містить лише матеріали курсу та готовий HTML для перегляду, ' +
          'без повного тексту рукопису, потрібного для продовження редагування. ' +
          'Щоб відновити повну книгу, використайте архів «Резервна копія книги», ' +
          'створений кнопкою «Зберегти резервну копію (ZIP)» на стартовій сторінці.'
      );
    }
    throw new BookBackupError(
      'missing_book_json',
      'У цьому ZIP-архіві не знайдено файл book.json — це не резервна копія книги Fusion Lab Studio.'
    );
  }

  let bookRaw: string;
  let manifest: BookBackupManifest | null = null;
  try {
    bookRaw = await bookEntry.async('string');
    const manifestEntry = zip.file('manifest.json');
    if (manifestEntry) {
      manifest = JSON.parse(await manifestEntry.async('string')) as BookBackupManifest;
    }
  } catch {
    throw new BookBackupError('invalid_json', 'Не вдалося прочитати вміст архіву — файли пошкоджені.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bookRaw);
  } catch {
    throw new BookBackupError(
      'invalid_json',
      'Файл book.json містить некоректний JSON і не може бути розібраний.'
    );
  }

  if (!isPlausibleBook(parsed)) {
    throw new BookBackupError(
      'invalid_schema',
      'Вміст book.json не відповідає структурі книги Fusion Lab Studio (відсутні обов’язкові поля).'
    );
  }

  return { book: parsed, manifest };
}
