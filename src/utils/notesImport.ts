import JSZip from 'jszip';

/** Один розпізнаний уривок з .md-нотатки: текст без рядка з посиланням на аудіо, і сам шлях до вкладення (якщо є). */
export interface ParsedNoteMarkdown {
  /** Текст нотатки БЕЗ рядка-посилання на аудіо-вкладення, порожні рядки прибрано. */
  bodyText: string;
  /** Відносний шлях до аудіо-вкладення, як він записаний у .md (напр. "Attachments/XXXX.m4a"), або null, якщо аудіо в нотатці нема. */
  audioAttachmentPath: string | null;
}

/**
 * Посилання на аудіо-вкладення в markdown-експорті нотаток виглядає як
 * `[Новая запись](Attachments/EA73AEB0-....m4a)` — стандартний формат
 * експортерів Apple Notes (заголовок посилання — довільний текст мовою
 * інтерфейсу телефону, шлях — завжди відносний, у теці Attachments/).
 */
const AUDIO_LINK_PATTERN = /\[([^\]]*)\]\(([^)]+\.(?:m4a|mp3|mpeg|wav|aac|ogg|flac|webm|aiff))\)/i;

export function parseNoteMarkdown(mdText: string): ParsedNoteMarkdown {
  const text = (mdText || '').replace(/\r\n/g, '\n');
  const match = text.match(AUDIO_LINK_PATTERN);
  const audioAttachmentPath = match ? match[2].trim() : null;
  const withoutAudioLink = match ? text.replace(match[0], '') : text;
  const bodyText = withoutAudioLink
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return { bodyText, audioAttachmentPath };
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

export function basenameOf(path: string): string {
  const clean = path.replace(/\\/g, '/');
  return clean.split('/').pop() || clean;
}

export function mimeTypeForAudioFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return AUDIO_MIME_BY_EXT[ext] || null;
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
}

function resolveZipAudioEntry(
  zip: JSZip,
  noteMdPath: string,
  audioAttachmentPath: string
): { path: string; entry: JSZip.JSZipObject } | null {
  const noteDir = noteMdPath.includes('/') ? noteMdPath.slice(0, noteMdPath.lastIndexOf('/') + 1) : '';
  // Порядок кандидатів навмисний: спершу поруч із нотаткою (типовий формат
  // експортера — Attachments/ вкладена в теку нотатки), потім шлях як є
  // (архів без підтек), і нарешті — спільна Attachments/ у корені архіву
  // (деякі експортери саме так пакують усі вкладення разом).
  const candidates = [
    `${noteDir}${audioAttachmentPath}`,
    audioAttachmentPath,
    audioAttachmentPath.replace(/^.*\//, 'Attachments/'),
  ];
  for (const candidate of candidates) {
    const entry = zip.file(candidate);
    if (entry) return { path: candidate, entry };
  }
  return null;
}

/**
 * Розбирає ZIP-експорт нотаток (кожна нотатка — .md файл; аудіо-вкладення —
 * у теці Attachments/, спільній чи поруч із нотаткою) на список нотаток із
 * розпізнаним текстом і вже прочитаним base64 аудіо (якщо воно є й
 * підтримуваного розширення). Аудіо читається одразу, а не лениво: обсяг
 * голосових нотаток телефону зазвичай малий, і тримати JSZip-об'єкт живим
 * між рендерами React-компонента складніше, ніж просто прочитати все за
 * один прохід.
 */
export async function parseNotesZip(zipInput: File | ArrayBuffer | Blob | Uint8Array): Promise<ParsedNoteEntry[]> {
  const zip = await JSZip.loadAsync(zipInput as any);
  const entries: ParsedNoteEntry[] = [];
  const mdPaths = Object.keys(zip.files)
    .filter((p) => !zip.files[p].dir && /\.md$/i.test(p))
    .sort();

  for (const path of mdPaths) {
    const raw = await zip.files[path].async('string');
    const { bodyText, audioAttachmentPath } = parseNoteMarkdown(raw);

    let audioFileName: string | null = null;
    let audioBase64: string | null = null;
    let audioMimeType: string | null = null;
    let audioMissing = false;

    if (audioAttachmentPath) {
      const resolved = resolveZipAudioEntry(zip, path, audioAttachmentPath);
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

    entries.push({
      id: path,
      fileName: basenameOf(path),
      bodyText,
      audioFileName,
      audioBase64,
      audioMimeType,
      audioMissing,
    });
  }

  return entries;
}

/** Один файл, який автор перетягнув чи обрав вручну (без ZIP) — уже прочитаний клієнтом (FileReader). */
export interface LooseFileInput {
  name: string;
  kind: 'md' | 'audio';
  /** Прочитаний текст — лише для kind === 'md'. */
  text?: string;
  /** base64 без префіксу data:URL — лише для kind === 'audio'. */
  base64?: string;
  mimeType?: string | null;
}

/**
 * Той самий результат, що й parseNotesZip, але для кількох окремо
 * вибраних файлів (без архіву) — рівно такий набір, який власник надіслав
 * як приклад: один .md і один .m4a. Аудіо шукається за іменем файлу,
 * записаним у .md (basename, без урахування теки), кожен аудіофайл
 * використовується не більше одного разу.
 */
export function matchLooseNotes(files: LooseFileInput[]): ParsedNoteEntry[] {
  const mdFiles = files.filter((f) => f.kind === 'md');
  const audioFiles = files.filter((f) => f.kind === 'audio');
  const usedAudioNames = new Set<string>();
  const entries: ParsedNoteEntry[] = [];

  for (const md of mdFiles) {
    const { bodyText, audioAttachmentPath } = parseNoteMarkdown(md.text || '');
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

    entries.push({ id: md.name, fileName: md.name, bodyText, audioFileName, audioBase64, audioMimeType, audioMissing });
  }

  // Аудіофайл без жодного .md, що на нього посилається, — теж валідна
  // нотатка (голосовий запис скинули окремо, без супровідного тексту):
  // текст порожній, ШІ розшифрує сам запис.
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
    });
  }

  return entries;
}
