/**
 * «Теги з файла»: повернути теги сутностей у книгу з PDF, EPUB, DOCX чи HTML,
 * куди їх вкладено при експорті (постановка власника 03.11.2026).
 *
 * ЧОМУ ЦЕ КРОК З ПІДТВЕРДЖЕННЯМ, А НЕ ОДНА КНОПКА. Повернення змінює текст
 * книги. Автор має спершу побачити, скільки абзаців знайдено, скільки тегів
 * буде поставлено і чого не знайдено, і лише потім погодитись: файл міг бути
 * зроблений з іншої книги чи зі старої редакції цієї.
 *
 * ЧОМУ ЗМІНА ЙДЕ ЧЕРЕЗ `onUpdateBook`, А НЕ ПРЯМО В РЕДАКТОР. Рукопис змінює
 * лише браузер (К2), а редактор сам підхоплює зовнішню зміну тексту розділу —
 * так само, як коли AI переписав текст чи відновили версію. Окрім того, це
 * дає автору запис у історії версій з поясненням, звідки взялись теги, і
 * відкат однією дією. Ставити теги по одному абзацу через редактор означало б
 * сотні окремих правок без спільного відкату.
 *
 * ЧОМУ ПОПЕРЕДНІЙ ПЕРЕГЛЯД РАХУЄТЬСЯ В БРАУЗЕРІ. Сервер лише читає файл і
 * віддає носій; звіряння з книгою потребує поточного тексту, який є тут, а не
 * на сервері (там лише дзеркало).
 */

import React, { useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, Check, Undo2 } from 'lucide-react';
import type { Book } from '../types';
import { applyTagCarrier, parseTagCarrier, revertTagCarrier, type PlacedTags, type TagCarrier } from '../utils/tagCarrier';

interface Props {
  book: Book;
  /** Режим читача: переглянути можна, повернути — ні. */
  readOnly?: boolean;
  onApply: (book: Book, logAction: string, logDetails: string) => void;
}

const KIND_NAME: Record<string, string> = { pdf: 'PDF', zip: 'EPUB чи DOCX', html: 'HTML' };

export const TagCarrierPanel: React.FC<Props> = ({ book, readOnly = false, onApply }) => {
  const [carrier, setCarrier] = useState<TagCarrier | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Що саме поставлено останнім поверненням — для скасування. Живе, доки відкрита сторінка. */
  const [lastApplied, setLastApplied] = useState<{ placed: PlacedTags[]; fileName: string } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  // Попередній перегляд: ті самі функції, що й справжнє повернення, але книга
  // не змінюється — `applyTagCarrier` віддає копію.
  const preview = useMemo(() => (carrier ? applyTagCarrier(book, carrier) : null), [book, carrier]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setCarrier(null);
    setFileName(file.name);
    try {
      const res = await fetch('/api/tag-carrier/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        setMessage(body.error || 'Не вдалося прочитати файл.');
        return;
      }
      if (!body.found) {
        setMessage(
          body.kind === 'unknown'
            ? 'Це не схоже на PDF, EPUB, DOCX чи HTML.'
            : `У цьому файлі (${KIND_NAME[body.kind] ?? body.kind}) немає носія тегів Студії. Його вкладають при експорті, якщо увімкнути перемикач у «Верстці».`
        );
        return;
      }
      const parsed = parseTagCarrier(body.carrier);
      if (!parsed) {
        setMessage('Носій у файлі пошкоджений або з іншої версії Студії.');
        return;
      }
      setCarrier(parsed);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const apply = () => {
    if (!preview || !carrier || preview.tagsPlaced === 0) return;
    onApply(
      preview.book,
      'Теги з файла',
      `Повернуто ${preview.tagsPlaced} тегів у ${preview.matched} абзаців із файла «${fileName}».`
    );
    setLastApplied({ placed: preview.placed, fileName });
    setMessage(
      `Повернуто тегів: ${preview.tagsPlaced} (абзаців: ${preview.matched}). Запис додано в журнал змін; скасувати можна кнопкою нижче, поки сторінку не закрито.`
    );
    setCarrier(null);
  };

  /**
   * Скасування прибирає РІВНО поставлені теги й лише там, де абзац досі
   * починається з них, тож правки, зроблені після повернення, не губляться.
   * Знімка книги тут немає: відновлення цілої книги стерло б ці правки.
   */
  const undo = () => {
    if (!lastApplied) return;
    const r = revertTagCarrier(book, lastApplied.placed);
    if (r.reverted === 0) {
      setMessage('Скасовувати нічого: абзаци, куди ставились теги, уже змінені або теги прибрано.');
      setLastApplied(null);
      return;
    }
    onApply(r.book, 'Скасування тегів з файла', `Прибрано ${r.tagsRemoved} тегів з ${r.reverted} абзаців, повернених із файла «${lastApplied.fileName}».`);
    setMessage(
      `Скасовано: прибрано тегів ${r.tagsRemoved} (абзаців: ${r.reverted})` +
        (r.skipped ? `; ${r.skipped} абзаців змінено після повернення — їх не чіпали.` : '.')
    );
    setLastApplied(null);
  };

  const otherBook = carrier?.bookId && carrier.bookId !== book.id;

  return (
    <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/50 p-3" data-tag-carrier>
      <div className="flex items-center gap-2">
        <FileUp className="h-3.5 w-3.5 text-emerald-300" />
        <span className="flex-1 text-[11px] font-bold text-slate-200">Теги з файла</span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy || readOnly}
          data-tag-carrier-pick
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          title="Прочитати теги з PDF, EPUB, DOCX чи HTML, зробленого цією Студією з увімкненим перемикачем «невидимі теги»."
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
          Обрати файл
        </button>
        <input
          ref={input}
          type="file"
          accept=".pdf,.epub,.docx,.html,.htm,application/pdf,application/epub+zip"
          className="hidden"
          data-tag-carrier-input
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      {message && <p className="text-[11px] text-slate-400" data-tag-carrier-message>{message}</p>}

      {lastApplied && !carrier && (
        <button
          type="button"
          onClick={undo}
          disabled={readOnly}
          data-tag-carrier-undo
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:border-slate-500 disabled:opacity-50"
          title="Прибрати рівно ті теги, які щойно повернуто. Правки, зроблені після цього, лишаються."
        >
          <Undo2 className="h-3 w-3" />
          Скасувати повернення
        </button>
      )}

      {carrier && preview && (
        <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-[11px]" data-tag-carrier-preview>
          <p className="text-slate-300">
            Файл «{fileName}»{carrier.title ? <> — книга «{carrier.title}»</> : null}.
          </p>
          {otherBook && (
            <p className="text-amber-300" data-tag-carrier-other-book>
              Файл зроблено з іншої книги: теги шукатимуться за текстом абзаців, тож збіг можливий лише там, де текст однаковий.
            </p>
          )}
          <p className="text-slate-300">
            Знайдено абзаців: <b>{preview.matched}</b>; буде поставлено тегів: <b>{preview.tagsPlaced}</b>.
          </p>
          {preview.unmatched > 0 && (
            <p className="text-slate-500">
              Не знайдено в книзі: {preview.unmatched} абзаців — їхній текст відтоді змінився.
            </p>
          )}
          {preview.skippedByLimit > 0 && (
            <p className="text-slate-500">Не вмістилось через ліміт 12 тегів на абзац: {preview.skippedByLimit}.</p>
          )}
          {preview.tagsPlaced === 0 ? (
            <p className="text-slate-500">Повертати нічого: усі теги з файла вже стоять у книзі, або абзаців не знайдено.</p>
          ) : (
            <div className="flex gap-1.5 pt-1">
              <button
                type="button"
                onClick={apply}
                disabled={readOnly}
                data-tag-carrier-apply
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                Повернути теги
              </button>
              <button
                type="button"
                onClick={() => setCarrier(null)}
                data-tag-carrier-cancel
                className="rounded-lg border border-slate-700 px-2.5 py-1 font-bold text-slate-300 hover:border-slate-500"
              >
                Скасувати
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagCarrierPanel;
