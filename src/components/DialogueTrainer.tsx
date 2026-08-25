import React from 'react';
import { TrainerView, type TrainerConfig } from './TrainerView';

/** Пілотний тренажер «Діалог» (Фаза 2, 2.2) — конфігурація над спільним движком TrainerView. */
const CONFIG: TrainerConfig = {
  trainerType: 'dialogue',
  titleKey: 'trainersView.dialogueTitle',
  theoryKey: 'trainersView.dialogueTheory',
  taskKey: 'trainersView.dialogueTask',
  placeholderKey: 'trainersView.dialoguePlaceholder',
  taskPromptKey: 'trainersView.dialogueTask',
};

export const DialogueTrainer: React.FC = () => <TrainerView config={CONFIG} />;
