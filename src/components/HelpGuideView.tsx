import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Languages, MousePointerClick, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { API_BASE } from '../utils/basePath';

export interface HelpGuideViewProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Сторінка довідки «Сутності ядра та діалоги героя» — постановка власника
 * 23.09.2026: «створи сторінку допомоги в кінці всіх сторінок студії… з
 * прикладами принт-скринь панелі героя, де що знайти, та як користуватися
 * покроково, щоб було зрозуміло новачку, українською та англійською».
 *
 * ЧОМУ ПОВНОЕКРАННИЙ ШАР, А НЕ ЩЕ ОДНА ВКЛАДКА НАВІГАЦІЇ. Вкладка жила б у
 * верхньому меню — тобто на ПОЧАТКУ списку, а просили «в кінці всіх сторінок».
 * Тому точка входу — кнопка у футері (той самий футер на кожній сторінці
 * студії), а сама довідка відкривається поверх поточної сторінки: автор не
 * втрачає контекст, повертається одним «Закрити», і жодна вкладка не отримує
 * нового пункту в навігації та нового правила доступу.
 *
 * МОВА. Текст живе у словнику (`helpGuide`) двома повними деревами, тож
 * сторінка йде за перемикачем мови застосунку. Кнопка в шапці перемикає мову
 * ВСЬОГО інтерфейсу (а не лише цієї сторінки) — так новачок одразу бачить, як
 * дістатися другої мови, і не має двох різних перемикачів на екрані.
 *
 * СКРІНШОТИ. Їх робить `npm run live:help-screens` (живий прогін у справжньому
 * Chrome, з номерними мітками на елементах). Якщо файлу немає — показується
 * рамка-заглушка з командою, а не «бита картинка»: сторінка мусить читатися
 * навіть тоді, коли знімки ще не згенеровані.
 */
export const HelpGuideView: React.FC<HelpGuideViewProps> = ({ isOpen, onClose }) => {
  const { t, toggleLang, lang } = useLanguage();

  /** Escape закриває сторінку — як будь-яке модальне вікно в Студії. */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const paragraphs = (key: string) => t(key).split('\n');
  const steps = (key: string) => t(key).split('\n').filter((s) => s.trim());

  /** Пункти змісту — ті самі секції, що нижче, з якорями. */
  const toc: { id: string; titleKey: string }[] = [
    { id: 'help-s1', titleKey: 'helpGuide.s1Title' },
    { id: 'help-s2', titleKey: 'helpGuide.s2Title' },
    { id: 'help-s3', titleKey: 'helpGuide.s3Title' },
    { id: 'help-s4', titleKey: 'helpGuide.s4Title' },
    { id: 'help-s5', titleKey: 'helpGuide.s5Title' },
    { id: 'help-s6', titleKey: 'helpGuide.s6Title' },
    { id: 'help-s7', titleKey: 'helpGuide.s7Title' },
    { id: 'help-s8', titleKey: 'helpGuide.s8Title' },
  ];

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm overflow-y-auto"
      data-help-page
      role="dialog"
      aria-label={t('helpGuide.title')}
    >
      <div className="max-w-5xl mx-auto my-6 px-4 pb-16">
        <div className="rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
          {/* ── Шапка ───────────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-cyan-400 font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                {t('helpGuide.footerTitle')}
              </div>
              <h1 className="text-lg font-bold text-white mt-0.5">{t('helpGuide.title')}</h1>
              <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">{t('helpGuide.subtitle')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleLang}
                title={t('helpGuide.switchLangHint')}
                data-help-lang-toggle
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-[11px] font-bold hover:border-cyan-500/60 transition-colors"
              >
                <Languages className="w-3.5 h-3.5" />
                {t('helpGuide.switchLangBtn')}
                <span className="text-slate-500 font-normal">· {lang === 'uk' ? 'UA' : 'EN'}</span>
              </button>
              <button
                onClick={onClose}
                data-help-close
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 text-slate-200 text-[11px] font-bold hover:bg-slate-700 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                {t('helpGuide.closeBtn')}
              </button>
            </div>
          </div>

          <div className="px-6 py-5 space-y-8">
            {/* ── Зміст ─────────────────────────────────────────────── */}
            <nav className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-2">
                {t('helpGuide.tocTitle')}
              </div>
              <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="text-[12.5px] text-slate-300 hover:text-cyan-300 transition-colors"
                    >
                      {t(item.titleKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* ── 1. Що таке сутності ───────────────────────────────── */}
            <section id="help-s1" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s1Title')}</h2>
              {paragraphs('helpGuide.s1Body').map((line, i) => (
                <p
                  key={i}
                  className={
                    line.trim().startsWith('[/')
                      ? 'text-[12.5px] font-mono text-cyan-300 pl-4'
                      : 'text-[13px] text-slate-300 leading-relaxed'
                  }
                >
                  {line}
                </p>
              ))}
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-2">
                <div className="text-[11.5px] font-bold text-amber-300">{t('helpGuide.s1NoteTitle')}</div>
                <ul className="space-y-1.5">
                  {steps('helpGuide.s1Notes').map((line, i) => (
                    <li key={i} className="text-[12.5px] text-amber-100/90 leading-relaxed flex gap-2">
                      <span className="text-amber-400 shrink-0">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* ── 2. Панель сутностей ───────────────────────────────── */}
            <section id="help-s2" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s2Title')}</h2>
              <p className="text-[13px] text-amber-200/90 leading-relaxed rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2">
                {t('helpGuide.s2Where')}
              </p>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s2Body')}</p>

              <Screenshot
                file="entities-panel.png"
                caption={t('helpGuide.s2CaptionTop')}
                numbersTitle={t('helpGuide.numbersLabel')}
                items={steps('helpGuide.s2Marks')}
                missing={t('helpGuide.screenshotMissing')}
              />
              <Screenshot
                file="entities-panel-rows.png"
                caption={t('helpGuide.s2CaptionRows')}
                numbersTitle={t('helpGuide.numbersLabel')}
                items={steps('helpGuide.s2MarksRows')}
                missing={t('helpGuide.screenshotMissing')}
              />
            </section>

            {/* ── 3. Слеш-підбір ───────────────────────────────────── */}
            <section id="help-s3" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s3Title')}</h2>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s3Body')}</p>
              <StepList items={steps('helpGuide.s3Steps')} />
              <p className="text-[12.5px] text-slate-400 leading-relaxed flex gap-2">
                <MousePointerClick className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>{t('helpGuide.s3Tip')}</span>
              </p>
            </section>

            {/* ── 4. Діалоги героя ─────────────────────────────────── */}
            <section id="help-s4" className="space-y-4 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s4Title')}</h2>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s4Body')}</p>

              <h3 className="text-[13.5px] font-bold text-cyan-300">{t('helpGuide.s4StepsTitle')}</h3>
              <StepList items={steps('helpGuide.s4Steps1')} />
              <Screenshot
                file="scene-dialogues-block.png"
                caption={t('helpGuide.s4MarksScene')}
                missing={t('helpGuide.screenshotMissing')}
              />
              <Screenshot
                file="dialogues-modal.png"
                caption={t('helpGuide.s4StepsTitle')}
                numbersTitle={t('helpGuide.numbersLabel')}
                items={steps('helpGuide.s4MarksModal')}
                note={t('helpGuide.s4ModalNote')}
                missing={t('helpGuide.screenshotMissing')}
              />

              <h3 className="text-[13.5px] font-bold text-cyan-300">{t('helpGuide.s4StepsTitle2')}</h3>
              <StepList items={steps('helpGuide.s4Steps2')} />
              <Screenshot
                file="slash-dialogue-menu.png"
                caption={t('helpGuide.s4StepsTitle2')}
                numbersTitle={t('helpGuide.numbersLabel')}
                items={steps('helpGuide.s4MarksMenu')}
                missing={t('helpGuide.screenshotMissing')}
              />

              <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/30 p-4 space-y-2">
                <div className="text-[11.5px] font-bold text-cyan-300">{t('helpGuide.s4ResultTitle')}</div>
                <p className="text-[12px] font-mono text-slate-200 break-words">{t('helpGuide.s4Result')}</p>
                <p className="text-[12.5px] text-slate-300 leading-relaxed">{t('helpGuide.s4ResultNote')}</p>
              </div>
              <Screenshot
                file="canvas-result.png"
                caption={t('helpGuide.s4ResultTitle')}
                missing={t('helpGuide.screenshotMissing')}
              />

              <h3 className="text-[13.5px] font-bold text-cyan-300">{t('helpGuide.s4ShortcutTitle')}</h3>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s4Shortcut')}</p>
            </section>

            {/* ── 5. Експорт ────────────────────────────────────────── */}
            <section id="help-s5" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s5Title')}</h2>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s5Body')}</p>
            </section>

            {/* ── 6. Помилки ────────────────────────────────────────── */}
            <section id="help-s6" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s6Title')}</h2>
              <StepList items={steps('helpGuide.s6Items')} tone="rose" />
            </section>

            {/* ── 7. Чат ────────────────────────────────────────────── */}
            <section id="help-s7" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s7Title')}</h2>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s7Body')}</p>
            </section>

            {/* ── 8. Якщо не виходить ───────────────────────────────── */}
            <section id="help-s8" className="space-y-3 scroll-mt-24">
              <h2 className="text-base font-bold text-white">{t('helpGuide.s8Title')}</h2>
              <p className="text-[13px] text-slate-300 leading-relaxed">{t('helpGuide.s8Body')}</p>
            </section>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-3">
              <a
                href="#help-top"
                onClick={(e) => {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-cyan-300 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
                {t('helpGuide.tocTitle')}
              </a>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-[12px] font-bold hover:bg-slate-700 transition-colors"
              >
                {t('helpGuide.closeBtn')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Нумерований список кроків — спільний вигляд для всіх секцій. */
const StepList: React.FC<{ items: string[]; tone?: 'cyan' | 'rose' }> = ({ items, tone = 'cyan' }) => (
  <ol className="space-y-2">
    {items.map((line, i) => (
      <li key={i} className="flex gap-2.5">
        <span
          className={`shrink-0 w-5 h-5 rounded-lg text-[11px] font-bold flex items-center justify-center ${
            tone === 'rose' ? 'bg-rose-500/15 text-rose-300' : 'bg-cyan-500/15 text-cyan-300'
          }`}
        >
          {i + 1}
        </span>
        <span className="text-[12.5px] text-slate-300 leading-relaxed">{line}</span>
      </li>
    ))}
  </ol>
);

/**
 * Скріншот із підписом і (за потреби) розшифровкою номерних міток.
 *
 * Номери на самому знімку малює живий прогін (`scripts/live-helpScreens.mts`):
 * він підсвічує потрібні елементи й ставить на них кружечки з цифрами. Тут
 * лишається тільки перелічити, що яка цифра означає — і якщо картинки немає,
 * перелік усе одно корисний, тож він не ховається.
 */
const Screenshot: React.FC<{
  file: string;
  caption: string;
  numbersTitle?: string;
  items?: string[];
  note?: string;
  missing: string;
}> = ({ file, caption, numbersTitle, items, note, missing }) => {
  const [failed, setFailed] = useState(false);
  const src = `${API_BASE}/help/${file}`;

  return (
    <figure className="space-y-2">
      {failed ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-4 text-[12px] text-slate-400 leading-relaxed">
          {missing}
        </div>
      ) : (
        <img
          src={src}
          alt={caption}
          loading="lazy"
          onError={() => setFailed(true)}
          data-help-screenshot={file}
          className="w-full rounded-2xl border border-slate-800 shadow-lg"
        />
      )}
      <figcaption className="text-[12px] text-slate-400 leading-relaxed">{caption}</figcaption>
      {items && items.length > 0 && (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-3.5 space-y-1.5">
          {numbersTitle && (
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              {numbersTitle}
            </div>
          )}
          <ol className="space-y-1.5">
            {items.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-lg bg-orange-500/15 text-orange-300 text-[11px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-[12.5px] text-slate-300 leading-relaxed">{line}</span>
              </li>
            ))}
          </ol>
          {note && <p className="text-[12px] text-slate-400 leading-relaxed pt-1">{note}</p>}
        </div>
      )}
    </figure>
  );
};

export default HelpGuideView;
