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

type Engine = 'gemini' | 'gpt';

interface DescribeCharacterModalProps {
  /** Фото, яке описуємо. */
  photo: { url: string; title: string; prompt?: string };
  /** «Ядро письменника» — дані книги, з якими опис має бути в одному ключі. */
  core: WriterCorePayload;
  isRegistered: boolean;
  onClose: () => void;
  /** Виконати передачу. `true` — вдалося (вікно закриється). */
  onTransfer: (target: DescriptionTarget, payload: DescriptionPayload) => Promise<boolean>;
}

const TARGETS: DescriptionTarget[] = ['book', 'instruction', 'course'];

export const DescribeCharacterModal: React.FC<DescribeCharacterModalProps> = ({
  photo,
  core,
  isRegistered,
  onClose,
  onTransfer,
}) => {
  const { t } = useLanguage();
  const [engines, setEngines] = useState<{ gemini: boolean; gpt: boolean }>({ gemini: false, gpt: false });
  const [engine, setEngine] = useState<Engine>('gemini');
  const [title, setTitle] = useState(photo.title || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<DescriptionTarget>('book');
  const [transferring, setTransferring] = useState(false);
  const autoStarted = useRef(false);

  /** Чи налаштовані ключі рушіїв — щоб не пропонувати те, чого немає. */
  useEffect(() => {
    let alive = true;
    fetch('/api/ai/text-engines', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setEngines({ gemini: !!d.gemini, gpt: !!d.gpt });
        if (!d.gemini && d.gpt) setEngine('gpt');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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
          engine,
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
  }, [core, engine, isRegistered, photo.prompt, photo.title, photo.url, t, title]);

  /** Перший опис починається сам: автор уже натиснув «Описати ШІ», чекати ще одного кліку зайве. */
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    describe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transfer = async (withPhoto: boolean) => {
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
      });
      if (ok) onClose();
    } finally {
      setTransferring(false);
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
          <span className="text-[11px] text-slate-400">{t('describeCharacter.engineLabel')}</span>
          {(['gemini', 'gpt'] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEngine(e)}
              disabled={busy}
              title={!engines[e] ? t('describeCharacter.notConfiguredSuffix', { hint: e === 'gemini' ? t('describeCharacter.geminiHint') : t('describeCharacter.gptHint') }) : (e === 'gemini' ? t('describeCharacter.geminiHint') : t('describeCharacter.gptHint'))}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                engine === e ? 'bg-slate-800 text-cyan-300 border-cyan-500/40' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
              } ${!engines[e] ? 'opacity-60' : ''}`}
            >
              {e === 'gemini' ? 'Gemini' : 'GPT'}
            </button>
          ))}
          <button
            onClick={describe}
            disabled={busy}
            data-describe-generate
            className="ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-wait text-white text-xs font-bold shadow-md transition-all"
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{busy ? t('describeCharacter.writing') : text ? t('describeCharacter.rewriteBtn') : t('describeCharacter.writeBtn')}</span>
          </button>
        </div>

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
              onChange={(e) => setTarget(e.target.value as DescriptionTarget)}
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

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => transfer(false)}
                disabled={transferring}
                data-describe-transfer-text
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold border border-slate-700 transition-all disabled:opacity-60"
              >
                {transferring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{t('describeCharacter.transferTextBtn')}</span>
              </button>
              <button
                onClick={() => transfer(true)}
                disabled={transferring}
                data-describe-transfer-both
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md transition-all disabled:opacity-60"
              >
                {transferring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                <span>{t('describeCharacter.transferBothBtn')}</span>
              </button>
            </div>
          </div>
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
