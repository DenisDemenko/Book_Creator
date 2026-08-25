import React from 'react';
import { TrainerView, type TrainerConfig } from './TrainerView';

/** Пілотний тренажер «Персонаж» (Фаза 2, 2.2) — конфігурація над спільним движком TrainerView. */
const CONFIG: TrainerConfig = {
  trainerType: 'character',
  titleKey: 'trainersView.characterTitle',
  theoryKey: 'trainersView.characterTheory',
  taskKey: 'trainersView.characterTask',
  placeholderKey: 'trainersView.characterPlaceholder',
  taskPromptKey: 'trainersView.characterTask',
};

export const CharacterTrainer: React.FC = () => <TrainerView config={CONFIG} />;
