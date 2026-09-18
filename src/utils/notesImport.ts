import JSZip from 'jszip';

/**
 * Посилання на аудіо-вкладення в markdown-експорті нотаток виглядає як
 * `[Новая запись](Attachments/EA73AEB0-....m4a)` — стандартний формат
 * експортерів Apple Notes (заголовок посилання — довільний текст мовою
 * інтерфейсу телефону, шлях — завжди відносний, у теці Attachments/).
 */
const AUDIO_LINK_PATTERN = /\[([^\]]*)\]\(([^)]+\.(?:m4a|mp3|mpeg|wav|aac|ogg|flac|webm|aiff))\)/i;

/** Посилання на зображення `![підпис](Attachments/....png)` — markdown-синтаксис картинки, будь-яке розширення (непідтримувані фільтруються пізніше, за фактом резолву файлу). */
const IMAGE_LINK_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Одна знайдена в тексті нотатки картинка ДО резолву самого файлу (лише те, що можна дізнатися з markdown: шлях і підпис). */
export interface ParsedNoteImageRef {
  placeholderIndex: number;
  path: string;
  caption: string;
}

/** Токен-заглушка, який лягає в bodyText на місце `![alt](path)` — власним абзацом, і замінюється плагіном на реальний `[IMG: id ...]` маркер уже ПІСЛЯ завантаження файлу (або на пояснювальний текст, якщо файл не резолвився). Однаковий формат тут і в NotesImportModal — інакше заміна на вставці не знайде токен. */
export function imagePlaceholderToken(index: number, caption: string): string {
  return `[[ЗОБРАЖЕННЯ #${index}: ${caption}]]`;
}

function extractImages(text: string): { text: string; images: ParsedNoteImageRef[] } {
  const images: ParsedNoteImageRef[] = [];
  const replaced = text.replace(IMAGE_LINK_RE, (_whole, alt: string, path: string) => {
    const index = images.length;
    const trimmedPath = path.trim();
    const caption = (alt || '').trim() || basenameOf(trimmedPath);
    images.push({ placeholderIndex: index, path: trimmedPath, caption });
    // Порожні рядки з обох боків — [IMG:...]-маркер (і наш токен на його
    // місці) мусить бути ЦІЛИМ абзацом (markerStringToTiptapDoc розбирає
    // абзаци через split на 2+ переносів рядка й звіряє його ЦІЛКОМ з
    // регуляркою маркера) — байдуже, чи в оригінальному тексті картинка
    // стояла в окремому рядку, чи впритул до сусіднього.
    return `\n\n${imagePlaceholderToken(index, caption)}\n\n`;
  });
  return { text: replaced, images };
}

function splitTableRowCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_CELL_RE = /^:?-+:?$/;

function isTableSeparatorRow(line: string): boolean {
  if (!TABLE_ROW_RE.test(line)) return false;
  const cells = splitTableRowCells(line);
  return cells.length > 0 && cells.every((c) => TABLE_SEP_CELL_RE.test(c));
}

/**
 * Markdown-таблиці (GFM: `| a | b |` + рядок-роздільник `| --- | --- |`)
 * книжковий формат не вміє малювати як таблицю (немає такого вузла в
 * marker-форматі розділу) — перетворюємо кожен рядок даних на читабельний
 * текст `заголовок1: значення1; заголовок2: значення2`, один рядок таблиці
 * — один текстовий рядок.
 */
function convertMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      const headers = splitTableRowCells(line);
      const rowLines: string[] = [];
      let j = i + 2;
      while (j < lines.length && TABLE_ROW_RE.test(lines[j]) && !isTableSeparatorRow(lines[j])) {
        const cells = splitTableRowCells(lines[j]);
        rowLines.push(cells.map((c, idx) => `${(headers[idx] ?? '').trim()}: ${c}`.trim()).join('; '));
        j++;
      }
      out.push('', rowLines.join('\n'), '');
      i = j;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

const CHECKLIST_RE = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/;

/** `- [ ] текст` / `- [x] текст` (чекліст Нотаток) → книжковий формат не має чекліст-вузла, тож рядок стає простим буліт-рядком із позначкою стану (☐/☑). */
function convertChecklists(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(CHECKLIST_RE);
      if (!m) return line;
      const checked = m[1].toLowerCase() === 'x';
      return `${checked ? '☑' : '☐'} ${m[2].trim()}`;
    })
    .join('\n');
}

const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/** `[текст](url)` (звичайне посилання, НЕ картинка — ті вже вирізані extractImages до цього кроку) → книжковий маркер `[LINK="url"]текст[/LINK]`, який реально клікабельний у редакторі. */
function convertMarkdownLinks(text: string): string {
  return text.replace(MD_LINK_RE, (_whole, label: string, url: string) => {
    const cleanUrl = url.trim();
    const cleanLabel = (label || '').trim() || cleanUrl;
    return `[LINK="${cleanUrl}"]${cleanLabel}[/LINK]`;
  });
}

// Символ перед URL не може бути `"` чи `]` — саме так виглядає позиція
// одразу після відкриття `[LINK="` чи закриття мітки `]` з convertMarkdownLinks,
// тобто URL, який ця функція вже обгорнула. Захист від подвійного обгортання.
const BARE_URL_RE = /(^|[^"\]])(https?:\/\/[^\s<>\]"]+)/g;

/** «Гола» URL-адреса в тексті нотатки (не markdown-посилання) → той самий клікабельний `[LINK="url"]url[/LINK]` маркер. */
function convertBareUrls(text: string): string {
  return text.replace(BARE_URL_RE, (_whole, prefix: string, url: string) => {
    const clean = url.replace(/[).,;:!?]+$/, '');
    const trailing = url.slice(clean.length);
    return `${prefix}[LINK="${clean}"]${clean}[/LINK]${trailing}`;
  });
}

export interface ParsedNoteMarkdown {
  /** Текст нотатки, готовий лягти прямо в `Section.content`: чекліст і таблиця переведені в читабельний текст, посилання — в клікабельний маркер `[LINK=...]`, картинки — замінені токенами-заглушками (див. imagePlaceholderToken), рядок з аудіо-вкладенням вирізано повністю. */
  bodyText: string;
  /** Відносний шлях до аудіо-вкладення, як він записаний у .md (напр. "Attachments/XXXX.m4a"), або null, якщо аудіо в нотатці нема. */
  audioAttachmentPath: string | null;
  /** Картинки, знайдені в тексті (markdown `![alt](path)`), у порядку появи — placeholderIndex відповідає числу в токені-заглушці всередині bodyText. */
  images: ParsedNoteImageRef[];
}

export function parseNoteMarkdown(mdText: string): ParsedNoteMarkdown {
  let text = (mdText || '').replace(/\r\n/g, '\n');

  const audioMatch = text.match(AUDIO_LINK_PATTERN);
  const audioAttachmentPath = audioMatch ? audioMatch[2].trim() : null;
  if (audioMatch) text = text.replace(audioMatch[0], '');

  const extracted = extractImages(text);
  text = extracted.text;

  text = convertMarkdownTables(text);
  text = convertChecklists(text);
  text = convertMarkdownLinks(text);
  text = convertBareUrls(text);

  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { bodyText: text, audioAttachmentPath, images: extracted.images };
}

/**
 * Аудіо-розширення, які Gemini API приймає інлайн для розуміння аудіо
 * (ai.google.dev/gemini-api/docs/audio, перевірено 18.09.2026 — важливо:
 * .m4a йде саме як `audio/m4a`, а НЕ `audio/mp4`, який офіційно не
 * підтримується, хоч контейнер технічно й mp4).
 */
const AUDIO_MIME_BY_EXT: Record<string, string> = {
  m4a: 'audio/m4a',
  mp3: 'audio/mp3',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  aiff: 'audio/aiff',
};

/** Формати, які приймає `/api/media/upload` (server/media/mediaLibraryStore.ts MEDIA_MIME_EXTENSIONS) — звідси й немає .heic/.heif: типовий формат фото з iPhone, до якого Нотатки посилаються напряму, сервер не приймає. */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function basenameOf(path: string): string {
  const clean = path.replace(/\\/g, '/');
  return clean.split('/').pop() || clean;
}

export function mimeTypeForAudioFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return AUDIO_MIME_BY_EXT[ext] || null;
}

export function mimeTypeForImageFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_MIME_BY_EXT[ext] || null;
}

/** Одна картинка нотатки ПІСЛЯ спроби резолву файлу (з архіву чи серед вільно вибраних). */
export interface ParsedNoteImageAttachment {
  placeholderIndex: number;
  /** Підпис (alt із markdown, або ім'я файлу, якщо alt порожній) — стає caption ілюстрації в книзі. */
  caption: string;
  fileName: string | null;
  /** base64 без префіксу data:URL — готовий лягти в data:URL для завантаження в медіатеку. */
  base64: string | null;
  /** MIME для завантаження — null, якщо формат не підтримується або файл не знайдено. */
  mimeType: string | null;
  /** На картинку є посилання в тексті, але файл не знайдено серед вибраного/архіву. */
  missing: boolean;
  /** Файл знайдено, але розширення сервер не приймає (типово .heic з iPhone) — треба перезберегти як JPEG/PNG. */
  unsupported: boolean;
}

/** Одна розпізнана нотатка, готова для показу в списку плагіна й (за підтвердженням автора) відправки на сервер. */
export interface ParsedNoteEntry {
  /** Унікальний в межах імпорту ідентифікатор — шлях у архіві або ім'я вільного файлу. */
  id: string;
  /** Ім'я .md файлу (підпис нотатки в списку) — або ім'я аудіофайлу, якщо .md не було. */
  fileName: string;
  bodyText: string;
  audioFileName: string | null;
  /** base64 без префіксу data:URL — готовий лягти в тіло запиту на сервер як є. */
  audioBase64: string | null;
  audioMimeType: string | null;
  /** .md посилався на аудіо, якого не знайшлось серед файлів імпорту (розсинхронізований експорт). */
  audioMissing: boolean;
  images: ParsedNoteImageAttachment[];
}

function resolveZipAttachmentEntry(
  zip: JSZip,
  noteMdPath: string,
  attachmentPath: string
): { path: string; entry: JSZip.JSZipObject } | null {
  const noteDir = noteMdPath.includes('/') ? noteMdPath.slice(0, noteMdPath.lastIndexOf('/') + 1) : '';
  // Порядок кандидатів навмисний: спершу поруч із нотаткою (типовий формат
  // експортера — Attachments/ вкладена в теку нотатки), потім шлях як є
  // (архів без підтек), і нарешті — спільна Attachments/ у корені архіву
  // (деякі експортери саме так пакують усі вкладення разом). Той самий
  // резолвер — і для аудіо, і для кожної картинки нотатки.
  const candidates = [
    `${noteDir}${attachmentPath}`,
    attachmentPath,
    attachmentPath.replace(/^.*\//, 'Attachments/'),
  ];
  for (const candidate of candidates) {
    const entry = zip.file(candidate);
    if (entry) return { path: candidate, entry };
  }
  return null;
}

/**
 * Розбирає ZIP-експорт нотаток (кожна нотатка — .md файл; вкладення —
 * у теці Attachments/, спільній чи поруч із нотаткою) на список нотаток із
 * розпізнаним текстом і вже прочитаним base64 аудіо й картинок (якщо вони
 * є й підтримуваного розширення). Вкладення читаються одразу, а не лениво:
 * обсяг нотаток телефону зазвичай малий, і тримати JSZip-об'єкт живим між
 * рендерами React-компонента складніше, ніж просто прочитати все за один
 * прохід.
 */
export async function parseNotesZip(zipInput: File | ArrayBuffer | Blob | Uint8Array): Promise<ParsedNoteEntry[]> {
  const zip = await JSZip.loadAsync(zipInput as any);
  const entries: ParsedNoteEntry[] = [];
  const mdPaths = Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir && /\.md$/i.test(p))
    .sort();

  for (const path of mdPaths) {
    const raw = await zip.files[path].async('string');
    const { bodyText, audioAttachmentPath, images: imageRefs } = parseNoteMarkdown(raw);

    let audioFileName: string | null = null;
    let audioBase64: string | null = null;
    let audioMimeType: string | null = null;
    let audioMissing = false;

    if (audioAttachmentPath) {
      const resolved = resolveZipAttachmentEntry(zip, path, audioAttachmentPath);
      if (resolved) {
        audioFileName = basenameOf(resolved.path);
        audioMimeType = mimeTypeForAudioFilename(audioFileName);
        if (audioMimeType) {
          audioBase64 = await resolved.entry.async('base64');
        }
      } else {
        audioMissing = true;
      }
    }

    const images: ParsedNoteImageAttachment[] = [];
    for (const ref of imageRefs) {
      const resolved = resolveZipAttachmentEntry(zip, path, ref.path);
      if (!resolved) {
        images.push({ placeholderIndex: ref.placeholderIndex, caption: ref.caption, fileName: null, base64: null, mimeType: null, missing: true, unsupported: false });
        continue;
      }
      const fileName = basenameOf(resolved.path);
      const mimeType = mimeTypeForImageFilename(fileName);
      if (!mimeType) {
        images.push({ placeholderIndex: ref.placeholderIndex, caption: ref.caption, fileName, base64: null, mimeType: null, missing: false, unsupported: true });
        continue;
      }
      const base64 = await resolved.entry.async('base64');
      images.push({ placeholderIndex: ref.placeholderIndex, caption: ref.caption, fileName, base64, mimeType, missing: false, unsupported: false });
    }

    entries.push({ id: path, fileName: basenameOf(path), bodyText, audioFileName, audioBase64, audioMimeType, audioMissing, images });
  }

  return entries;
}

/** Один файл, який автор перетягнув чи обрав вручну (без ZIP) — уже прочитаний клієнтом (FileReader). */
export interface LooseFileInput {
  name: string;
  kind: 'md' | 'audio' | 'image';
  /** Прочитаний текст — лише для kind === 'md'. */
  text?: string;
  /** base64 без префіксу data:URL — для kind === 'audio' | 'image'. */
  base64?: string;
  mimeType?: string | null;
}

/**
 * Той самий результат, що й parseNotesZip, але для кількох окремо
 * вибраних файлів (без архіву). Аудіо й картинки шукаються за іменем
 * файлу, записаним у .md (basename, без урахування теки), кожен файл
 * використовується не більше одного разу — і серед аудіо, і серед картинок
 * окремо.
 */
export function matchLooseNotes(files: LooseFileInput[]): ParsedNoteEntry[] {
  const mdFiles = files.filter((f) => f.kind === 'md');
  const audioFiles = files.filter((f) => f.kind === 'audio');
  const imageFiles = files.filter((f) => f.kind === 'image');
  const usedAudioNames = new Set<string>();
  const usedImageNames = new Set<string>();
  const entries: ParsedNoteEntry[] = [];

  for (const md of mdFiles) {
    const { bodyText, audioAttachmentPath, images: imageRefs } = parseNoteMarkdown(md.text || '');
    let audioFileName: string | null = null;
    let audioBase64: string | null = null;
    let audioMimeType: string | null = null;
    let audioMissing = false;

    if (audioAttachmentPath) {
      const wantedName = basenameOf(audioAttachmentPath);
      const match = audioFiles.find((a) => a.name === wantedName && !usedAudioNames.has(a.name));
      if (match) {
        usedAudioNames.add(match.name);
        audioFileName = match.name;
        audioBase64 = match.base64 || null;
        audioMimeType = match.mimeType || mimeTypeForAudioFilename(match.name);
      } else {
        audioMissing = true;
      }
    }

    const images: ParsedNoteImageAttachment[] = imageRefs.map((ref) => {
      const wantedName = basenameOf(ref.path);
      const match = imageFiles.find((f) => f.name === wantedName && !usedImageNames.has(f.name));
      if (!match) {
        return { placeholderIndex: ref.placeholderIndex, caption: ref.caption, fileName: null, base64: null, mimeType: null, missing: true, unsupported: false };
      }
      usedImageNames.add(match.name);
      const mimeType = match.mimeType || mimeTypeForImageFilename(match.name);
      if (!mimeType) {
        return { placeholderIndex: ref.placeholderIndex, caption: ref.caption, fileName: match.name, base64: null, mimeType: null, missing: false, unsupported: true };
      }
      return { placeholderIndex: ref.placeholderIndex, caption: ref.caption, fileName: match.name, base64: match.base64 || null, mimeType, missing: false, unsupported: false };
    });

    entries.push({ id: md.name, fileName: md.name, bodyText, audioFileName, audioBase64, audioMimeType, audioMissing, images });
  }

  // Аудіофайл без жодного .md, що на нього посилається, — теж валідна
  // нотатка (голосовий запис скинули окремо, без супровідного тексту):
  // текст порожній, ШІ розшифрує сам запис. «Осиротіла» картинка без .md
  // так само не має тексту-контексту — окремою нотаткою НЕ стає (свідомо:
  // без жодного диктованого чи написаного слова навколо, підбирати главу
  // для неї ШІ довелося б наосліп).
  for (const audio of audioFiles) {
    if (usedAudioNames.has(audio.name)) continue;
    entries.push({
      id: audio.name,
      fileName: audio.name,
      bodyText: '',
      audioFileName: audio.name,
      audioBase64: audio.base64 || null,
      audioMimeType: audio.mimeType || mimeTypeForAudioFilename(audio.name),
      audioMissing: false,
      images: [],
    });
  }

  return entries;
}
