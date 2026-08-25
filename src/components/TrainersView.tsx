import React, { useState } from 'react';
import { Dumbbell, Users, MessageCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { CharacterTrainer } from './CharacterTrainer';
import { DialogueTrainer } from './DialogueTrainer';

type TrainerKind = 'character' | 'dialogue';

/**
 * Фаза 2, 2.2: «Пілотні тренажери». Один top-level розділ навігації з
 * перемикачем між двома пілотними тренажерами — так само, як MasteryView
 * перемикає підвкладки, щоб не плодити ще два окремих пункти в шапці.
 */
export const TrainersView: React.FC = () => {
  const { t } = useLanguage();
  const [active, setActive] = useState<TrainerKind>('character');

  return (
    <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-slate-900 text-slate-100 space-y-5">
      <div className="nova-glass-dark rounded-2xl p-5 border border-slate-800 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
          <Dumbbell className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-100">{t('trainersView.pageTitle')}</h1>
          <p className="text-xs text-slate-500">{t('trainersView.pageSubtitle')}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <button
          onClick={() => setActive('character')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            active === 'character' ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>{t('trainersView.characterTitle')}</span>
        </button>
        <button
          onClick={() => setActive('dialogue')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
            active === 'dialogue' ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20' : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          <span>{t('trainersView.dialogueTitle')}</span>
        </button>
      </div>

      {active === 'character' ? <CharacterTrainer /> : <DialogueTrainer />}
    </div>
  );
};
