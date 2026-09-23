import React, { useMemo, useState } from 'react';
import { MessageSquareQuote, Save, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import type { Character } from '../types';

export interface CharacterDialogueModalProps {
  /** Герої книги — автор сам вибирає, чиї діалоги налаштовує. */
  characters: Character[];
  /** Герой, який був відкритий у сцені — з нього модал і починає. */
  initialCharacterId?: string;
  /**
   * Збереження. Викликається з id героя й готовим масивом діалогів; запис у
   * книгу робить батько (`onUpdateBook`) — модал не знає, як книга
   * зберігається, і не має знати.
   */
  onSave: (characterId: string, dialogues: string[]) => void;
  onClose: () => void;
}

/**
 * «Налаштувати діалоги героя» — постановка власника 23.09.2026, п. 2.
 *
 * ЧОМУ ОКРЕМЕ ПОЛЕ, А НЕ ПОВЕДІНКОВІ ШАБЛОНИ. Поведінковий шаблон описує, ЯК
 * герой тримається в розмові («відводить погляд»), а діалог — те, ЩО він
 * каже. Це різні речі з різним призначенням, і саме тому вони лежать у
 * різних полях (`behaviorPatterns` і `dialogueTemplates`). Підбір за
 * слеш-записом `/character:Ім'я:діалог` бере спершу діалоги, а на поведінкові
 * шаблони падає лише тоді, коли власних діалогів ще немає.
 *
 * КОНВЕНЦІЯ ВВОДУ — ТА САМА, ЩО В ШАБЛОНАХ ПОВЕДІНКИ: один рядок — один
 * діалог, плюс `;` і `|` як роздільники. Автор не мусить вивчати другий
 * спосіб вводу для того самого за змістом поля.
 */
export const CharacterDialogueModal: React.FC<CharacterDialogueModalProps> = ({
  characters,
  initialCharacterId,
  onSave,
  onClose,
}) => {
  const { t } = useLanguage();

  const [charId, setCharId] = useState<string>(
    () =>
      characters.find((c) => c.id === initialCharacterId)?.id ||
      characters[0]?.id ||
      ''
  );
  const selected = useMemo(() => characters.find((c) => c.id === charId), [characters, charId]);

  /** Розбір введеного тексту — та сама логіка, що й `parseBehaviorPatterns` у CharactersView. */
  const parse = (raw: string): string[] =>
    raw
      .split(/\n|;|\|/)
      .map((s) => s.trim())
      .filter(Boolean);

  const [draft, setDraft] = useState<string>(() => (selected?.dialogueTemplates || []).join('\n'));
  const [savedName, setSavedName] = useState<string | null>(null);

  /**
   * Перемикання героя зберігає поточний чернетковий текст у книзі ЛИШЕ через
   * явне «Зберегти» — але чернетку треба підмінити, інакше автор, вибравши
   * іншого героя, побачив би чужі діалоги у своєму полі.
   */
  const switchCharacter = (id: string) => {
    const next = characters.find((c) => c.id === id);
    setCharId(id);
    setDraft((next?.dialogueTemplates || []).join('\n'));
    setSavedName(null);
  };

  const dialogues = parse(draft);
  const ownCount = dialogues.length;
  const patternFallback = (selected?.behaviorPatterns || []).length +
    (selected?.behaviorPatternLibrary || []).reduce((sum, g) => sum + g.patterns.length, 0);

  const handleSave = () => {
    if (!selected) return;
    onSave(selected.id, dialogues);
    setSavedName(`${selected.name}${selected.surname ? ' ' + selected.surname : ''}`.trim());
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-character-dialogue-modal
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full p-6 text-white space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquareQuote className="w-5 h-5 text-cyan-400 shrink-0" />
            <h3 className="text-sm font-bold truncate">{t('editor.dialogueModalTitle')}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold shrink-0" data-dialogue-modal-close>
            <X className="w-4 h-4" />
          </button>
        </div>

        {characters.length === 0 ? (
          <p className="text-xs text-slate-400 leading-relaxed">{t('editor.dialogueModalNoChars')}</p>
        ) : (
          <>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t('editor.dialogueModalHeroLabel')}</label>
              <div className="flex flex-wrap gap-1.5" data-dialogue-modal-heroes>
                {characters.map((c) => {
                  const name = `${c.name}${c.surname ? ' ' + c.surname : ''}`.trim();
                  const active = c.id === charId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => switchCharacter(c.id)}
                      data-dialogue-modal-hero={c.id}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        active
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {name}
                      <span className="ml-1 text-[10px] font-normal opacity-70">
                        {(c.dialogueTemplates || []).length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('editor.dialogueModalFieldLabel')}</label>
              <textarea
                rows={10}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSavedName(null);
                }}
                placeholder={t('editor.dialogueModalPlaceholder')}
                data-dialogue-modal-input
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 leading-relaxed"
              />
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{t('editor.dialogueModalFieldHint')}</p>
              <p className="text-[10px] text-cyan-300/70 mt-1" data-dialogue-modal-count>
                {t('editor.dialogueModalCount', { n: ownCount })}
              </p>
              {ownCount === 0 && patternFallback > 0 && (
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                  {t('editor.dialogueModalUsePatterns', { n: patternFallback })}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <span className="text-[11px] text-emerald-400 min-w-0 truncate" data-dialogue-modal-saved>
                {savedName ? t('editor.dialogueModalSaved', { name: savedName }) : ''}
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
                >
                  {t('editor.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  data-dialogue-modal-save
                  className="px-4 py-2 rounded-xl [background-color:var(--sun-acc)] hover:[background-color:var(--sun-acc-80)] text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  {t('editor.save')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CharacterDialogueModal;
