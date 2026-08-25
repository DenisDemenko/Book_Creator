import type { NavigationTab } from '../types';

/**
 * Один крок довідкового туру для конкретної вкладки.
 *
 * `dataTour` має точно збігатися зі значенням атрибута `data-tour="..."`
 * на відповідній кнопці/елементі керування в JSX цієї вкладки — саме за
 * цим атрибутом OnboardingTour знаходить елемент на екрані та підсвічує
 * його спливаючим вікном.
 */
export interface TourStep {
  tabId: NavigationTab;
  /** Порядковий номер кроку в межах вкладки, починаючи з 1. */
  step: number;
  /** Значення атрибута data-tour="<tabId>__<step>" на цільовому елементі. */
  dataTour: string;
  /** Короткий заголовок підказки (2-5 слів). */
  title: string;
  /** 1-2 короткі речення, що пояснюють призначення кнопки/блоку. */
  text: string;
}

export type TourStepsByTab = Partial<Record<NavigationTab, TourStep[]>>;
