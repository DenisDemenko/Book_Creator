/**
 * Вікно «Описати ШІ» — портрет із медіатеки (задача #220).
 *
 * ЩО ТУТ ВІДБУВАЄТЬСЯ. Автор тисне «Описати ШІ» на фото: ШІ дивиться на
 * зображення й пише, КОГО він справді бачить, у ключі книги (назва, жанр,
 * аудиторія, синопсис, склад персонажів — усе це їде разом із запитом як
 * «ядро письменника»). Текст лягає в редаговане поле, а далі автор вирішує,
 * куди його подіти: до книги, до чернетки інструкції або до курсу — самим
 * текстом або текстом разом із фото.
 *
 * ТРИ РІШЕННЯ, ЯКІ ВАРТО ЗНАТИ:
 *  1. Текст НІКОЛИ не потрапляє в книгу сам. Навіть коли генерація вдалася,
 *     автор спершу читає й править — це той самий принцип, що й у
 *     `GenerateTextFromImageModal` та правому кліку в редакторі.
 *  2. Порожнє поле — не помилка: опис можна вписати чи вставити руками, а
 *     кнопки передачі працюють і без ШІ. Інакше без ключа чи без мережі
 *     вікно було б мертвим.
 *  3. Передача не закриває вікно, поки не вдалася: якщо сталася помилка,
 *     автор має бачити текст і причину, а не втрачати написане.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import {
  descriptionWordCount,
  type DescriptionPayload,
  type DescriptionTarget,
  type WriterCorePayload,
} from '../utils/describeCharacterTransfer';

/** Модель ядра AI, яку можна обрати для опису (дзеркало /api/chat/models). */
interface CoreModel {
  id: string;
  label: string;
  engine: string;
  available: boolean;
  /** Чи модель справді приймає зображення — прапорець із сервера, не здогад. */
  vision: boolean;
}
interface DescribeCharacterModalProps {
  /** Фото, яке описуємо. */
  photo: { url: string; title: string; prompt?: string };
  /** «Ядро письменника» — дані книги, з якими опис має бути в одному ключі. */
  core: WriterCorePayload;
  /**
   * Модель, обрана в розділі «Книга та текст» (`book.preferredAiModelId`).
   * Вона ж — типове значення в списку: автор має бачити ту саму модель, якою
   * вже живе його книга, а не абстрактний «рушій за замовчуванням».
   * Порожнє значення — «хай вирішує адміністратор».
   */
  preferredModelId?: string;
  /**
   * Глави книги (порядок — як у книзі) для вибору місця передачі (#224).
   * Порожній перелік — це не помилка: у новій книзі глав може не бути, і
   * тоді текст створить главу «Опис персонажів» (так було й до #224).
   */
  chapters?: { id: string; title: string }[];
  isRegistered: boolean;
  onClose: () => void;
  /** Виконати передачу. `true` — вдалося (вікно закриється). */
  onTransfer: (target: DescriptionTarget, payload: DescriptionPayload) => Promise<boolean>;
}

const TARGETS: DescriptionTarget[] = ['book', 'instruction', 'course'];

export const DescribeCharacterModal: React.FC<DescribeCharacterModalProps> = ({
  photo,
  core,
  preferredModelId,
  chapters,
  isRegistered,
  onClose,
  onTransfer,
}) => {
  const { t } = useLanguage();
  const [models, setModels] = useState<CoreModel[]>([]);
  const [modelId, setModelId] = useState('');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [title, setTitle] = useState(photo.title || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<DescriptionTarget>('book');
  /**
   * Глава, куди автор передає текст (#224). Типове значення — ОСТАННЯ глава:
   * саме туди текст лягав до #224, і це найближче місце до того, над чим
   * автор працює. Вибір зберігається, поки вікно відкрите: автор бачить, куди
   * саме поїде текст, ще ДО натискання кнопки передачі.
   */
  const [chapterId, setChapterId] = useState('');
  /** Підтвердження передачі: крок між «натиснув» і «поїхало» (просив власник). */
  const [confirming, setConfirming] = useState<null | { withPhoto: boolean }>(null);
  const [transferring, setTransferring] = useState(false);
  const autoStarted = useRef(false);

  const chapterList = chapters || [];
  const chosenChapter = chapterList.find((c) => c.id === chapterId) || null;

  // Типова глава — остання, і лише якщо автор ще нічого не вибрав сам.
  useEffect(() => {
    if (chapterId || !chapterList.length) return;
    setChapterId(chapterList[chapterList.length - 1].id);
  }, [chapterId, chapterList]);

  /**
   * Список моделей — той самий, що й у редакторі (`/api/chat/models`), і
   * той самий, що в «Ядрі AI». Показуємо ЛИШЕ ті, що справді бачать
   * зображення: сервер віддає це прапорцем `vision` по кожній моделі
   * (`server/chatProviders.ts::CHAT_MODELS`), бо зір — властивість моделі, а
   * не рушія. DeepSeek V4 Pro, Llama 3.3 70B і будь-яка нова текстова
   * модель того ж провайдера відсіються самі, без правки клієнта.
   * Типове значення — модель книги; якщо вона зору не має, у списку
   * лишається «Автоматично», а причину автор бачить підписом.
   */
  useEffect(() => {
    let alive = true;
    fetch('/api/chat/models', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list = ((d?.models || []) as CoreModel[]).filter((m) => m.vision);
        setModels(list);
        if (preferredModelId && list.some((m) => m.id === preferredModelId)) setModelId(preferredModelId);
        setModelsLoaded(true);
      })
      .catch(() => setModelsLoaded(true));
    return () => {
      alive = false;
    };
  }, [preferredModelId]);

  const describe = useCallback(async () => {
    if (!isRegistered) {
      setText(t('describeCharacter.guestStub'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/describe-character-from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          imageUrl: photo.url,
          // `modelId` (навіть порожній) — ознака клієнта нового зразка:
          // порожнє значення означає «модель із прив'язки адміністратора»
          // (server/coreModuleModels.ts, модуль «Текст за фото»).
          modelId,
          engine: models.find((m) => m.id === modelId)?.engine || 'gemini',
          photoLabel: photo.title,
          generationPrompt: photo.prompt,
          ...core,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error || t('describeCharacter.genericFailError')));
        return;
      }
      const written = String(data?.text || '').trim();
      setText(written);
      if (!title.trim()) setTitle(photo.title || t('describeCharacter.transferBookTitle'));
    } catch {
      setError(t('describeCharacter.serverUnavailableError'));
    } finally {
      setBusy(false);
    }
  }, [core, modelId, models, isRegistered, photo.prompt, photo.title, photo.url, t, title]);

  /**
   * Перший опис починається сам — але ЛИШЕ після того, як приїхав список
   * моделей: інакше дефолтний запит пішов би з порожнім `modelId`, тобто
   * не тією моделлю, яку автор обрав у «Книга та текст».
   */
  useEffect(() => {
    if (!modelsLoaded || autoStarted.current) return;
    autoStarted.current = true;
    describe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsLoaded]);

  /**
   * Передача. Для книги спершу питаємо ПІДТВЕРДЖЕННЯ глави (задача #224):
   * автор має бачити назву глави й розуміти, що текст приїде AI-чернеткою,
   * а не шукати потім, «куди воно поділося». Для інструкції та курсу
   * підтвердження не потрібне: там місце одне й фіксоване.
   */
  const requestTransfer = (withPhoto: boolean) => {
    const clean = text.trim();
    if (!clean) {
      setError(t('describeCharacter.emptyTextError'));
      return;
    }
    setError(null);
    if (target === 'book' && !confirming) {
      setConfirming({ withPhoto });
      return;
    }
    void runTransfer(withPhoto);
  };

  const runTransfer = async (withPhoto: boolean) => {
    const clean = text.trim();
    if (!clean) {
      setError(t('describeCharacter.emptyTextError'));
      return;
    }
    setError(null);
    setTransferring(true);
    try {
      const ok = await onTransfer(target, {
        title: title.trim() || t('describeCharacter.transferBookTitle'),
        text: clean,
        photo: withPhoto ? { url: photo.url, title: photo.title } : null,
        // Порожній id — «хай вирішує книга»: у новій книзі глав може ще не
        // бути, і тоді вставка створить першу сама.
        chapterId: target === 'book' ? chapterId : undefined,
      });
      if (ok) onClose();
    } finally {
      setTransferring(false);
      setConfirming(null);
    }
  };

  const words = descriptionWordCount(text);

  return (
    <div
      onClick={() => { if (!transferring) onClose(); }}
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
      data-describe-modal
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-950 border border-slate-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-4 p-6 text-white"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-black border border-slate-800 shrink-0">
              <img src={photo.url} alt={photo.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-cyan-300">{t('describeCharacter.heading')}</h3>
              <p className="text-[11px] text-slate-400 truncate">
                {t('describeCharacter.photoLabel')} {photo.title}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg px-1" aria-label={t('describeCharacter.closeBtn')}>
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-400">{t('describeCharacter.subheading')}</p>

        <div className="flex items-center flex-wrap gap-2">
          <span className="text-[11px] text-slate-400">{t('describeCharacter.modelLabel')}</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={busy || models.length === 0}
            data-describe-model
            title={t('describeCharacter.modelHint')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:border-cyan-500 focus:outline-hidden max-w-[280px] disabled:opacity-60"
          >
            <option value="">{t('describeCharacter.modelAuto')}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.label}
                {!m.available ? ` ${t('describeCharacter.modelNoKeySuffix')}` : ''}
                {m.id === preferredModelId ? ` ${t('describeCharacter.modelBookSuffix')}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={describe}
            disabled={busy}
            data-describe-generate
            className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-wait text-white text-xs font-bold shadow-md transition-all"
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {/* Задача #221. Після відмови (наприклад, «модель перевантажена»)
                кнопка змінює підпис на «Спробувати ще раз» — автор має бачити,
                що саме ця кнопка і є повторною спробою. */}
            <span>
              {busy
                ? t('describeCharacter.writing')
                : error && !text.trim()
                ? t('describeCharacter.retryBtn')
                : text
                ? t('describeCharacter.rewriteBtn')
                : t('describeCharacter.writeBtn')}
            </span>
          </button>
        </div>

        {/* Чому саме ця модель стоїть типово — автор має бачити без здогадів. */}
        <p className="text-[10px] text-slate-500 leading-relaxed">{t('describeCharacter.modelHint')}</p>

        <div className="space-y-1.5">
          <label className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{t('describeCharacter.textLabel')}</span>
            <span className="font-mono text-slate-500">{words} {t('describeCharacter.wordsSuffix')}</span>
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            data-describe-text
            placeholder={t('describeCharacter.textareaPlaceholder')}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 leading-relaxed focus:border-cyan-500 focus:outline-hidden resize-y"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-200">{error}</p>
          </div>
        )}

        <div className="pt-3 border-t border-slate-800 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">{t('describeCharacter.titleLabel')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-describe-title
              className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:border-cyan-500 focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-400">{t('describeCharacter.transferLabel')}</span>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value as DescriptionTarget);
                setConfirming(null);
              }}
              data-describe-target
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:border-cyan-500 focus:outline-hidden"
            >
              {TARGETS.map((item) => (
                <option key={item} value={item}>
                  {item === 'book'
                    ? t('describeCharacter.targetBook')
                    : item === 'instruction'
                    ? t('describeCharacter.targetInstruction')
                    : t('describeCharacter.targetCourse')}
                </option>
              ))}
            </select>

            {/*
              Вибір глави (задача #224). Раніше текст ішов в останню главу
              БЕЗ відома автора: він бачив тост «додано новим розділом» і не
              знав ні глави, ні того, що вставлений текст — сирий HTML.
            */}
            {target === 'book' && (
              <select
                value={chapterId}
                onChange={(e) => {
                  setChapterId(e.target.value);
                  setConfirming(null);
                }}
                data-describe-chapter
                disabled={!chapterList.length}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:border-cyan-500 focus:outline-hidden disabled:opacity-60 min-w-[160px]"
              >
                {chapterList.length ? (
                  chapterList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))
                ) : (
                  <option value="">{t('describeCharacter.chapterWillCreate')}</option>
                )}
              </select>
            )}

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => requestTransfer(false)}
                disabled={transferring}
                data-describe-transfer-text
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold border border-slate-700 transition-all disabled:opacity-60"
              >
                {transferring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{t('describeCharacter.transferTextBtn')}</span>
              </button>
              <button
                onClick={() => requestTransfer(true)}
                disabled={transferring}
                data-describe-transfer-both
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md transition-all disabled:opacity-60"
              >
                {transferring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{t('describeCharacter.transferBothBtn')}</span>
              </button>
            </div>
          </div>

          {target === 'book' && (
            <p className="text-[10px] text-slate-500 leading-snug">
              {chapterList.length
                ? t('describeCharacter.chapterHint', { chapter: chosenChapter?.title || '' })
                : t('describeCharacter.chapterWillCreateHint')}
            </p>
          )}

          {/*
            Підтвердження глави — окремий крок, як просив власник: спершу
            вибір, потім явне «так, саме сюди», і аж тоді передача. Друга
            кнопка передачі перезаписує вибір (текст / текст із фото), тож
            автор не може «підтвердити» одне, а передати інше.
          */}
          {confirming && target === 'book' && (
            <div
              data-describe-confirm-panel
              className="rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-3 space-y-2"
            >
              <p className="text-[11px] font-bold text-cyan-200">
                {t('describeCharacter.confirmHeading', {
                  chapter: chosenChapter?.title || t('describeCharacter.chapterNewTitle'),
                })}
              </p>
              <p className="text-[10px] text-slate-400 leading-snug">{t('describeCharacter.confirmHint')}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void runTransfer(confirming.withPhoto)}
                  disabled={transferring}
                  data-describe-confirm
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold transition-all disabled:opacity-60"
                >
                  {transferring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{t('describeCharacter.confirmBtn')}</span>
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  disabled={transferring}
                  data-describe-confirm-cancel
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-bold border border-slate-800 transition-all disabled:opacity-60"
                >
                  {t('describeCharacter.confirmCancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-slate-800 transition-all">
            {t('describeCharacter.closeBtn')}
          </button>
        </div>
      </div>
    </div>
  );
};
