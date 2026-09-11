import React, { useRef, useState } from 'react';
import { X, Type, Loader2, AlertTriangle, Trash2, ExternalLink, UploadCloud, FileArchive } from 'lucide-react';
import JSZip from 'jszip';
import { CustomFont } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface FontInstallModalProps {
  installedFonts: CustomFont[];
  onInstall: (font: CustomFont) => void;
  onRemove: (family: string) => void;
  onClose: () => void;
}

/** Хост, з якого дозволено підключати шрифти. */
const GOOGLE_CSS_HOST = 'fonts.googleapis.com';
/** Хост сторінки перегляду шрифтів (звідки користувачі найчастіше копіюють посилання). */
const GOOGLE_SPECIMEN_HOST = 'fonts.google.com';

/** Чи схоже введене на посилання саме на Google Fonts (навіть якщо назву з
 * нього далі не вдасться витягти) — потрібно, щоб показати ТОЧНІШЕ
 * повідомлення про помилку («це посилання без обраного шрифту», а не
 * загальне «не розпізнано»). */
function looksLikeGoogleFontsUrl(raw: string): boolean {
  if (!raw.includes(GOOGLE_CSS_HOST) && !raw.includes(GOOGLE_SPECIMEN_HOST)) return false;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname === GOOGLE_CSS_HOST || url.hostname === GOOGLE_SPECIMEN_HOST;
  } catch {
    return false;
  }
}

/**
 * Витягує назву сімейства з того, що вставив користувач.
 *
 * Приймає всі звичні варіанти: посилання на сторінку шрифту
 * (`https://fonts.google.com/specimen/Roboto+Slab`), посилання на «кошик»
 * підбору кількох шрифтів (`https://fonts.google.com/selection?selection.family=
 * Roboto+Slab:wght@400;700|Open+Sans` — беремо ПЕРШЕ сімейство), пряме
 * посилання на таблицю стилів (`https://fonts.googleapis.com/css2?family=
 * Roboto+Slab:wght@400`) і просто назву («Roboto Slab»). Повертає null, якщо
 * розібрати не вдалося — зокрема якщо посилання веде на Google Fonts, але
 * НЕ містить жодної конкретної назви (наприклад, сторінка «кошика» без
 * обраного шрифту — саме такий випадок і повідомив власник:
 * `fonts.google.com/selection?preview.lang=ura_Latn` не несе `selection.family`
 * взагалі, тож тут об'єктивно нема що розбирати; `looksLikeGoogleFontsUrl`
 * вище дозволяє відрізнити це від «не Google Fonts посилання» для точнішої
 * підказки користувачу).
 */
export function parseFontFamily(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.includes(GOOGLE_CSS_HOST)) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (url.hostname !== GOOGLE_CSS_HOST) return null;
      const family = url.searchParams.get('family');
      if (!family) return null;
      // «Roboto+Slab:wght@400;700» → «Roboto Slab»
      return family.split(':')[0].replace(/\+/g, ' ').trim() || null;
    } catch {
      return null;
    }
  }

  if (raw.includes(GOOGLE_SPECIMEN_HOST)) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (url.hostname !== GOOGLE_SPECIMEN_HOST) return null;
      // /specimen/Playwrite+DE+LA+Guides?preview → «Playwrite DE LA Guides»
      const specimenMatch = url.pathname.match(/\/specimen\/([^/]+)/);
      if (specimenMatch) {
        const family = decodeURIComponent(specimenMatch[1]).replace(/\+/g, ' ').trim();
        return family || null;
      }
      // Сторінка «кошика» підбору (/selection): назва(и), якщо обрані,
      // живуть у ?selection.family=Name:wght@400|Second+Name — беремо перше.
      const selectionFamily = url.searchParams.get('selection.family');
      if (selectionFamily) {
        const first = selectionFamily.split('|')[0];
        const family = first.split(':')[0].replace(/\+/g, ' ').trim();
        return family || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Проста назва: лишаємо літери, цифри, пробіли й дефіси
  if (!/^[\p{L}\p{N} \-]+$/u.test(raw)) return null;
  return raw.replace(/\s+/g, ' ');
}

/** Назва сімейства → канонічне посилання на таблицю стилів Google Fonts. */
export function buildGoogleFontHref(family: string): string {
  const param = family.trim().replace(/\s+/g, '+');
  return `https://${GOOGLE_CSS_HOST}/css2?family=${param}:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap`;
}

/** Розширення файлів шрифтів, які приймає дропзона (напряму або з zip). */
const FONT_FILE_EXT_RE = /\.(woff2|woff|ttf|otf)$/i;
/** Стеля розміру файлу шрифту — без бекенд-сховища шрифт зберігається
 * ЦІЛКОМ у книзі (base64 у `CustomFont.href`, те саме поле, куди інакше
 * пише посилання на Google Fonts), тож занадто великий файл роздує JSON
 * книги. 3 МБ із запасом вистачає на звичайний .ttf/.otf; стиснутий
 * .woff2 зазвичай у рази менший. */
const MAX_FONT_FILE_BYTES = 3 * 1024 * 1024;

function fontFormatForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'woff2':
      return 'woff2';
    case 'woff':
      return 'woff';
    case 'ttf':
      return 'truetype';
    default:
      return 'opentype';
  }
}

function fontMimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    case 'ttf':
      return 'font/ttf';
    default:
      return 'font/otf';
  }
}

/** «Roboto-Slab-Bold.ttf» → «Roboto Slab» — прибирає розширення, дефіси/
 * підкреслення і типові слова-маркери нарізки (щоб не пропонувати «Roboto
 * Slab Bold» як окрему «родину», якщо користувач це не поправить сам —
 * поле нижче все одно лишається редагованим, це лише стартова здогадка). */
export function guessFamilyFromFilename(filename: string): string {
  const base = filename.replace(FONT_FILE_EXT_RE, '');
  const cleaned = base
    .replace(/[-_]+/g, ' ')
    .replace(/\b(Regular|Bold|Italic|Oblique|Light|Medium|SemiBold|Semi-Bold|ExtraBold|Extra-Bold|Black|Thin|Variable|VF)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || base.trim() || filename;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Пакує байти шрифту в `data:text/css` таблицю стилів з одним `@font-face` —
 * той самий "href", яким модалка вже й так оперує для Google Fonts (просто
 * лінк на CSS), тож `<link rel="stylesheet" href={f.href}>` у EditorView.tsx
 * підхоплює обидва джерела АБСОЛЮТНО однаково, без жодних змін там. Сама
 * CSS-таблиця віддається через `encodeURIComponent`, а НЕ через другий шар
 * base64 (типова помилка тут — обгорнути вже-base64-рядок ще раз у base64,
 * що майже подвоює розмір): base64-байти шрифту лишаються один раз, а
 * навколишній CSS-текст лише процентно екранується.
 */
export function buildDataUrlFontFace(family: string, bytes: ArrayBuffer, ext: string): string {
  const format = fontFormatForExt(ext);
  const mime = fontMimeForExt(ext);
  const b64 = arrayBufferToBase64(bytes);
  const safeFamily = family.replace(/"/g, '\\"');
  const css = `@font-face{font-family:"${safeFamily}";src:url(data:${mime};base64,${b64}) format("${format}");font-display:swap;}`;
  return `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;
}

interface ExtractedFont {
  name: string;
  bytes: ArrayBuffer;
  ext: string;
}

/** Переважний порядок форматів, якщо в zip лежить кілька файлів шрифту —
 * woff2 як найкомпактніший обирається першим. */
const FONT_EXT_PREFERENCE = ['woff2', 'woff', 'otf', 'ttf'];

async function extractFirstFontFromZip(file: File): Promise<ExtractedFont | null> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((f) => !f.dir && FONT_FILE_EXT_RE.test(f.name));
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    const extA = (a.name.match(FONT_FILE_EXT_RE)?.[1] || '').toLowerCase();
    const extB = (b.name.match(FONT_FILE_EXT_RE)?.[1] || '').toLowerCase();
    return FONT_EXT_PREFERENCE.indexOf(extA) - FONT_EXT_PREFERENCE.indexOf(extB);
  });
  const entry = entries[0];
  const bytes = await entry.async('arraybuffer');
  const ext = (entry.name.match(FONT_FILE_EXT_RE)?.[1] || 'ttf').toLowerCase();
  const name = entry.name.split('/').pop() || entry.name;
  return { name, bytes, ext };
}

/**
 * Вікно підключення шрифту — з Google Fonts (посилання/назва) або з
 * власного файлу (drag&drop чи вибір .zip/.woff2/.woff/.ttf/.otf).
 *
 * Для Google Fonts будуємо канонічний css2-URL і підвантажуємо його; для
 * локального файлу пакуємо байти в `data:` CSS-таблицю (buildDataUrlFontFace
 * вище) — обидва шляхи сходяться в той самий стан попереднього перегляду
 * (`preview`/`status`), тож решта екрана (зразок тексту, кнопка «Встановити»,
 * список уже підключених) спільна й не дублюється.
 *
 * Дизайн — та сама неоморфна тема Modul_token (token-module-scope + nm-*,
 * src/styles/tokenModuleTheme.css), що й у AI-коуча/AI-чату (CoachModal.tsx,
 * QuickAiModal.tsx), а не власна темна/бурштинова палітра, яка була тут
 * раніше.
 */
export const FontInstallModal: React.FC<FontInstallModalProps> = ({
  installedFonts,
  onInstall,
  onRemove,
  onClose,
}) => {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [preview, setPreview] = useState<{ family: string; href: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Джерело з файлу (zip чи напряму шрифт) — окремо від текстового поля,
  // бо тут ще потрібна назва сімейства (з файлу її напряму не видно так
  // однозначно, як з Google Fonts URL), яку користувач може поправити
  // перед перевіркою.
  const [pendingFile, setPendingFile] = useState<{ bytes: ArrayBuffer; ext: string } | null>(null);
  const [fileFamily, setFileFamily] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetOutcome = () => {
    setStatus('idle');
    setPreview(null);
    setError(null);
  };

  const finalizeCheck = async (family: string, href: string) => {
    if (installedFonts.some((f) => f.family.toLowerCase() === family.toLowerCase())) {
      setStatus('error');
      setPreview(null);
      setError(t('editor.fontModalDuplicate', { family }));
      return;
    }
    setStatus('loading');
    setError(null);
    if (!document.querySelector(`link[data-nova-font-check="${family}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.novaFontCheck = family;
      document.head.appendChild(link);
    }
    try {
      await document.fonts.load(`16px "${family}"`);
      const ok = document.fonts.check(`16px "${family}"`);
      if (!ok) throw new Error('not available');
      setPreview({ family, href });
      setStatus('ready');
    } catch {
      setStatus('error');
      setPreview(null);
      setError(t('editor.fontModalLoadError', { family }));
    }
  };

  const handleCheck = async () => {
    const family = parseFontFamily(input);
    if (!family) {
      setStatus('error');
      setPreview(null);
      setError(
        looksLikeGoogleFontsUrl(input) ? t('editor.fontModalParseErrorNoFamily') : t('editor.fontModalParseError')
      );
      return;
    }
    await finalizeCheck(family, buildGoogleFontHref(family));
  };

  const handleFileSelected = async (file: File) => {
    resetOutcome();
    setPendingFile(null);

    const isZip = /\.zip$/i.test(file.name);
    const isFontFile = FONT_FILE_EXT_RE.test(file.name);
    if (!isZip && !isFontFile) {
      setStatus('error');
      setError(t('editor.fontModalUnsupportedFile'));
      return;
    }
    if (file.size > MAX_FONT_FILE_BYTES) {
      setStatus('error');
      setError(
        t('editor.fontModalFileTooLarge', {
          size: (file.size / (1024 * 1024)).toFixed(1),
          max: String(Math.round(MAX_FONT_FILE_BYTES / (1024 * 1024))),
        })
      );
      return;
    }

    try {
      let extracted: ExtractedFont | null;
      if (isZip) {
        extracted = await extractFirstFontFromZip(file);
        if (!extracted) {
          setStatus('error');
          setError(t('editor.fontModalZipNoFont'));
          return;
        }
      } else {
        const ext = (file.name.match(FONT_FILE_EXT_RE)?.[1] || 'ttf').toLowerCase();
        extracted = { name: file.name, bytes: await file.arrayBuffer(), ext };
      }
      setPendingFile({ bytes: extracted.bytes, ext: extracted.ext });
      setFileFamily(guessFamilyFromFilename(extracted.name));
    } catch (err) {
      console.error('Error reading font file:', err);
      setStatus('error');
      setError(t('editor.fontModalZipNoFont'));
    }
  };

  const handleCheckFile = async () => {
    if (!pendingFile) return;
    const family = fileFamily.trim();
    if (!family) {
      setStatus('error');
      setError(t('editor.fontModalParseError'));
      return;
    }
    await finalizeCheck(family, buildDataUrlFontFace(family, pendingFile.bytes, pendingFile.ext));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  };

  const handleInstall = () => {
    if (!preview) return;
    onInstall({ family: preview.family, href: preview.href, addedAt: new Date().toISOString() });
    setPendingFile(null);
    setInput('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="token-module-scope w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="shrink-0 p-4 nm-outset-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg nm-outset flex items-center justify-center text-[var(--primary)] shrink-0">
              <Type className="w-4 h-4" />
            </div>
            <h3 className="text-[14px] font-bold text-[var(--on-surface)] truncate">{t('editor.fontModalTitle')}</h3>
          </div>
          <button
            onClick={onClose}
            className="nm-btn p-2 rounded-lg text-[var(--on-surface-variant)] shrink-0"
            aria-label={t('editor.fontModalClose')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 nm-flat">
          <p className="text-[11px] text-[var(--outline)] leading-relaxed">
            {t('editor.fontModalHint')}{' '}
            <a
              href="https://fonts.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--primary)] hover:underline inline-flex items-center gap-0.5"
            >
              fonts.google.com <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                resetOutcome();
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              placeholder={t('editor.fontModalPlaceholder')}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg nm-inset text-xs text-[var(--on-surface)] outline-none bg-transparent placeholder:text-[var(--outline)]"
            />
            <button
              onClick={handleCheck}
              disabled={status === 'loading' || !input.trim()}
              className="nm-btn-primary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('editor.fontModalCheckBtn')}</span>
            </button>
          </div>

          {/* Роздільник + дропзона файлу — альтернатива посиланню, коли воно
              не спрацьовує (саме на це поскаржився власник: сторінка «кошика»
              Google Fonts без обраного шрифту в URL). */}
          <div className="flex items-center gap-2 text-[10px] text-[var(--outline)] uppercase tracking-wider">
            <div className="flex-1 h-px bg-[var(--outline-variant)]" />
            <span>{t('editor.fontModalOrDivider')}</span>
            <div className="flex-1 h-px bg-[var(--outline-variant)]" />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer transition-all ${
              dragActive ? 'nm-inset' : 'nm-outset hover:nm-inset'
            }`}
          >
            <UploadCloud className={`w-5 h-5 ${dragActive ? 'text-[var(--primary)]' : 'text-[var(--outline)]'}`} />
            <p className="text-[11px] font-semibold text-[var(--on-surface)]">
              {dragActive ? t('editor.fontModalDropActive') : t('editor.fontModalDropHint')}
            </p>
            <p className="text-[10px] text-[var(--outline)] underline underline-offset-2">
              {t('editor.fontModalDropBrowse')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.woff2,.woff,.ttf,.otf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
                e.target.value = '';
              }}
            />
          </div>
          <p className="text-[10px] text-[var(--outline)] leading-relaxed -mt-2">{t('editor.fontModalDropSubhint')}</p>

          {pendingFile && (
            <div className="rounded-xl nm-inset p-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-[var(--on-surface-variant)]">
                <FileArchive className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                <span>{t('editor.fontModalFileFamilyLabel')}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={fileFamily}
                  onChange={(e) => {
                    setFileFamily(e.target.value);
                    resetOutcome();
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCheckFile()}
                  placeholder={t('editor.fontModalFileFamilyPlaceholder')}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg nm-inset text-xs text-[var(--on-surface)] outline-none bg-transparent placeholder:text-[var(--outline)]"
                />
                <button
                  onClick={handleCheckFile}
                  disabled={status === 'loading' || !fileFamily.trim()}
                  className="nm-btn-primary px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{t('editor.fontModalInstallFromFileBtn')}</span>
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl nm-inset border-l-2 border-rose-400/60 text-rose-300 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {status === 'ready' && preview && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--outline)]">
                {t('editor.fontModalPreviewLabel')} — {preview.family}
              </div>
              <div
                className="p-3 rounded-xl nm-inset text-[var(--on-surface)] text-base leading-relaxed"
                style={{ fontFamily: `"${preview.family}", serif` }}
              >
                {t('editor.fontModalPreviewText')}
              </div>
              <button onClick={handleInstall} className="nm-btn-primary w-full py-2 rounded-xl text-xs font-bold">
                {t('editor.fontModalInstallBtn', { family: preview.family })}
              </button>
            </div>
          )}

          {installedFonts.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--outline)]">
                {t('editor.fontModalInstalledLabel')}
              </div>
              {installedFonts.map((f) => (
                <div key={f.family} className="flex items-center justify-between gap-2 p-2 rounded-lg nm-inset">
                  <span
                    className="text-xs text-[var(--on-surface)] truncate"
                    style={{ fontFamily: `"${f.family}", serif` }}
                  >
                    {f.family}
                  </span>
                  <button
                    onClick={() => onRemove(f.family)}
                    className="nm-btn p-1 rounded text-[var(--outline)] hover:text-rose-300 shrink-0"
                    title={t('editor.fontModalRemoveTitle')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
