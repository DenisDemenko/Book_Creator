import React, { useState } from 'react';
import { X, SpellCheck2, Plus, Trash2, Info } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * Мови, для яких у списку є переклад назви. Код — це BCP-47 тег, який
 * ставиться в атрибут `lang` полів вводу: саме за ним браузер обирає,
 * яким словником підкреслювати помилки.
 */
export const PROOFING_LANGUAGES: { code: string; nameUk: string; nameEn: string }[] = [
  { code: 'uk', nameUk: 'Українська', nameEn: 'Ukrainian' },
  { code: 'en', nameUk: 'Англійська', nameEn: 'English' },
  { code: 'pl', nameUk: 'Польська', nameEn: 'Polish' },
  { code: 'de', nameUk: 'Німецька', nameEn: 'German' },
  { code: 'fr', nameUk: 'Французька', nameEn: 'French' },
  { code: 'es', nameUk: 'Іспанська', nameEn: 'Spanish' },
  { code: 'it', nameUk: 'Італійська', nameEn: 'Italian' },
  { code: 'cs', nameUk: 'Чеська', nameEn: 'Czech' },
  { code: 'sk', nameUk: 'Словацька', nameEn: 'Slovak' },
  { code: 'ro', nameUk: 'Румунська', nameEn: 'Romanian' },
];

interface ProofingLanguageModalProps {
  language: string;
  spellcheckEnabled: boolean;
  customDictionary: string[];
  onChangeLanguage: (code: string) => void;
  onToggleSpellcheck: (enabled: boolean) => void;
  onChangeDictionary: (words: string[]) => void;
  onClose: () => void;
}

/**
 * Вікно вибору мови та словника перевірки орфографії.
 *
 * Важливе обмеження, яке відображене прямо в інтерфейсі: вебсторінка не
 * може встановити словник у браузер. Підкреслення помилок робить сам
 * браузер за атрибутом `lang`, а словники користувач додає у своїх
 * налаштуваннях. Тому «дозавантаження» тут — це власний словник книги:
 * список вигаданих імен і термінів, які не вважати помилками. Він
 * зберігається разом із книгою й застосовується до AI-перевірки.
 */
export const ProofingLanguageModal: React.FC<ProofingLanguageModalProps> = ({
  language,
  spellcheckEnabled,
  customDictionary,
  onChangeLanguage,
  onToggleSpellcheck,
  onChangeDictionary,
  onClose,
}) => {
  const { lang, t } = useLanguage();
  const [newWord, setNewWord] = useState('');

  const langName = (l: (typeof PROOFING_LANGUAGES)[number]) => (lang === 'en' ? l.nameEn : l.nameUk);

  const addWord = () => {
    const w = newWord.trim();
    if (!w) return;
    if (customDictionary.some((x) => x.toLowerCase() === w.toLowerCase())) {
      setNewWord('');
      return;
    }
    onChangeDictionary([...customDictionary, w]);
    setNewWord('');
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl glass-panel-elevated shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <SpellCheck2 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100">{t('editor.proofingModalTitle')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('editor.fontModalClose')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Увімкнення перевірки */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={spellcheckEnabled}
              onChange={(e) => onToggleSpellcheck(e.target.checked)}
              className="w-4 h-4 accent-cyan-500"
            />
            <span className="text-xs font-semibold text-slate-200">
              {t('editor.proofingEnableLabel')}
            </span>
          </label>

          {/* Вибір мови */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              {t('editor.proofingLanguageLabel')}
            </label>
            <select
              value={language}
              onChange={(e) => onChangeLanguage(e.target.value)}
              disabled={!spellcheckEnabled}
              className="w-full p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 cursor-pointer disabled:opacity-50"
            >
              {PROOFING_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="bg-slate-900 text-slate-100">
                  {langName(l)} ({l.code})
                </option>
              ))}
            </select>
          </div>

          {/* Чесне пояснення, звідки беруться словники */}
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-100 text-[11px] leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-cyan-300" />
            <span>{t('editor.proofingBrowserNote')}</span>
          </div>

          {/* Власний словник книги */}
          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t('editor.proofingCustomDictLabel')}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                {t('editor.proofingCustomDictHint')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addWord()}
                placeholder={t('editor.proofingCustomDictPlaceholder')}
                className="flex-1 min-w-0 p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 field-glow"
              />
              <button
                onClick={addWord}
                disabled={!newWord.trim()}
                className="p-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 transition-colors shrink-0"
                title={t('editor.proofingAddWordTitle')}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {customDictionary.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {customDictionary.map((w) => (
                  <span
                    key={w}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-200"
                  >
                    {w}
                    <button
                      onClick={() => onChangeDictionary(customDictionary.filter((x) => x !== w))}
                      className="text-slate-500 hover:text-rose-300 transition-colors"
                      title={t('editor.proofingRemoveWordTitle')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 italic">{t('editor.proofingCustomDictEmpty')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
