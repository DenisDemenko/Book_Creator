import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { PHOTO_TARGET_LABELS, type CoursePhotoTarget } from '../../shared/courseGapFill';

/**
 * «Додати фото» з блоку «Готовність» (прохання власника 13.11.2026).
 *
 * Рядок «Модуль 1: немає фото» ШІ не закриє — потрібен файл автора. Але й
 * лишати його без дії незручно: автор читає про брак фото в одному місці, а
 * класти знімок мусить у іншому. Тому поруч із рядком стоїть кнопка, а вікно
 * дає обидва шляхи, які в Студії вже є: вибрати з медіатеки або завантажити
 * новий файл.
 *
 * ЧОМУ ЗАВАНТАЖЕННЯ ТУТ, А НЕ ЛИШЕ ПОСИЛАННЯ НА МЕДІАТЕКУ. Вибір із медіатеки
 * (`PickFromMediaLibraryModal`) свідомо нічого не вантажить — і це правильно для
 * нього. Але в автора, який щойно зібрав курс із телефона, потрібного знімка в
 * медіатеці може й не бути, і відсилати його в інший розділ означає загубити
 * те, що він робив. Завантаження йде тим самим маршрутом `POST /api/media/upload`,
 * що й «Медіатека»: ліміт тарифу рахує сервер, окремого шляху в обхід немає.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

export interface CourseAddPhotoModalProps {
  target: CoursePhotoTarget;
  /** Текст пункту готовності — у вікні видно, що саме закриваємо. */
  problem: string;
  /** Знімок обрано або завантажено: адреса для `coverUrl` / `coverPhotoUrl`. */
  onPicked: (url: string) => void;
  /** Відкрити наявний вибір із медіатеки — він живе в редакторі курсу. */
  onOpenLibrary: () => void;
  onClose: () => void;
  /** Підміняється в тестах. */
  upload?: (file: File) => Promise<string>;
}

async function uploadToLibrary(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл.'));
    reader.readAsDataURL(file);
  });
  const res = await fetch('/api/media/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename: file.name || 'course-photo', kind: 'upload' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Помилка ${res.status}`);
  const url = (body as { asset?: { url?: string } })?.asset?.url;
  if (!url) throw new Error('Сервер не повернув адресу файлу.');
  return url;
}

export const CourseAddPhotoModal: React.FC<CourseAddPhotoModalProps> = ({
  target,
  problem,
  onPicked,
  onOpenLibrary,
  onClose,
  upload = uploadToLibrary,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    // Перевіряємо ДО читання файлу: інакше автор чекає на завантаження 50 МБ,
    // щоб почути «завелике». Ліміт і тип однаково звіряє сервер.
    if (!ALLOWED.includes(file.type)) {
      setError('Вітрина приймає JPEG, PNG, WebP, AVIF або GIF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Файл завеликий: ${(file.size / 1024 / 1024).toFixed(1)} МБ, межа — 20 МБ.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = await upload(file);
      onPicked(url);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не вдалося завантажити файл.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      data-photo-modal={target.kind}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-4" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">Додати фото: {PHOTO_TARGET_LABELS[target.kind]}</h3>
            <p className="mt-1 text-[11px] text-slate-500">{problem}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-50" aria-label="Закрити">
            <X className="w-4 h-4" />
          </button>
        </div>

        {busy ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400" data-photo-busy>
            <Loader2 className="w-4 h-4 animate-spin" /> Завантажую фото в медіатеку…
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenLibrary();
                onClose();
              }}
              className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-700 bg-slate-950/60 text-left hover:border-amber-400"
              data-photo-choice="library"
            >
              <ImageIcon className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-100">Вибрати з медіатеки</span>
                <span className="block text-[11px] text-slate-500">Знімки, які вже лежать у вашій медіатеці.</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-700 bg-slate-950/60 text-left hover:border-amber-400"
              data-photo-choice="upload"
            >
              <Upload className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-100">Завантажити нове фото</span>
                <span className="block text-[11px] text-slate-500">Файл із цього пристрою ляже в медіатеку й одразу стане фото курсу.</span>
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED.join(',')}
              className="hidden"
              data-photo-file
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void take(file);
              }}
            />
          </div>
        )}

        {error ? <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200" data-photo-error>{error}</div> : null}
      </div>
    </div>
  );
};
