import { CalculationInput, ProductionScheduleResult, ProductionStageItem } from '../types';

const UK_MONTHS = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'
];

const UK_MONTHS_SHORT = [
  'січ', 'лют', 'бер', 'кві', 'тра', 'чер',
  'лип', 'сер', 'вер', 'жов', 'лис', 'гру'
];

const UK_DAYS_OF_WEEK = [
  'Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'
];

export function getTodayIsoString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatUkDate(date: Date, includeYear = true): string {
  const day = date.getDate();
  const monthName = UK_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  return includeYear ? `${day} ${monthName} ${year}` : `${day} ${monthName}`;
}

export function formatUkDateShort(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export function formatUkDateDayMonth(date: Date): string {
  const day = date.getDate();
  const monthShort = UK_MONTHS_SHORT[date.getMonth()];
  return `${day} ${monthShort}`;
}

/**
 * Add days to a date, optionally skipping weekends (working days mode)
 */
export function addDaysToDate(startDate: Date, daysToAdd: number, workingDaysOnly = false): Date {
  const result = new Date(startDate.getTime());
  if (daysToAdd <= 0) return result;

  if (!workingDaysOnly) {
    result.setDate(result.getDate() + daysToAdd);
    return result;
  }

  let added = 0;
  while (added < daysToAdd) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }

  return result;
}

/**
 * Calculate full production schedule based on stages
 */
export function calculateProductionSchedule(input: CalculationInput): ProductionScheduleResult {
  const startDateStr = input.projectStartDate || getTodayIsoString();
  const isWorkingDaysMode = input.workDaysMode === 'working_days';

  // Parse start date (UTC safe)
  const [y, m, d] = startDateStr.split('-').map(Number);
  const currentCursor = new Date(y, (m || 1) - 1, d || 1);

  // If start date is on weekend in working days mode, advance to next Monday
  if (isWorkingDaysMode) {
    while (currentCursor.getDay() === 0 || currentCursor.getDay() === 6) {
      currentCursor.setDate(currentCursor.getDate() + 1);
    }
  }

  const projectStartDateObj = new Date(currentCursor.getTime());

  // Stages configuration
  const stageDefs: Array<{
    id: string;
    name: string;
    shortName: string;
    days: number;
    colorClass: string;
    bgClass: string;
    borderClass: string;
    iconName: ProductionStageItem['iconName'];
    description: string;
  }> = [
    {
      id: 'drying',
      name: 'Камерна сушка та стабілізація деревини',
      shortName: 'Сушка слябів',
      days: Math.max(0, input.dryingStageDays ?? 5),
      colorClass: 'text-amber-400',
      bgClass: 'bg-amber-500/15',
      borderClass: 'border-amber-500/40',
      iconName: 'wind',
      description: 'Конвекційна сушка або акліматизація слябів до вологості 8-10% для уникнення розтріскування',
    },
    {
      id: 'carpentry',
      name: 'Столярні роботи та підготовка заливки',
      shortName: 'Робота столяра',
      days: Math.max(0, input.carpentryStageDays ?? 4),
      colorClass: 'text-blue-400',
      bgClass: 'bg-blue-500/15',
      borderClass: 'border-blue-500/40',
      iconName: 'hammer',
      description: 'Калібрування слебів, фугування граней, виготовлення опалубки, герметизація та фіксація струбцинами',
    },
    {
      id: 'epoxy',
      name: 'Заливка смоли та полімеризація',
      shortName: 'Заливка смоли',
      days: Math.max(0, input.epoxyCureStageDays ?? 6),
      colorClass: 'text-cyan-400',
      bgClass: 'bg-cyan-500/15',
      borderClass: 'border-cyan-500/40',
      iconName: 'droplet',
      description: 'Пошарове або масивне лиття, вакуумація/дегазація та повна кристалізація смоли перед механічною обробкою',
    },
    {
      id: 'cnc',
      name: 'ЧПУ обробка та калібрування площини',
      shortName: 'ЧПУ фрезерування',
      days: Math.max(0, input.cncStageDays ?? 2),
      colorClass: 'text-indigo-400',
      bgClass: 'bg-indigo-500/15',
      borderClass: 'border-indigo-500/40',
      iconName: 'cpu',
      description: 'Сляб-планінг площин стільниці в ідеальний горизонт, вибірка пазів під C-channel, зняття фасок',
    },
    {
      id: 'finishing',
      name: 'Шліфування, полірування та фінішне покриття',
      shortName: 'Фініш та масло',
      days: Math.max(0, input.finishingStageDays ?? 3),
      colorClass: 'text-emerald-400',
      bgClass: 'bg-emerald-500/15',
      borderClass: 'border-emerald-500/40',
      iconName: 'sparkles',
      description: 'Послідовна шліфовка зернистістю P80-P3000, полірування епоксидної річки, 2-3 шари масла-воску з міжшаровою сушкою',
    },
    {
      id: 'assembly',
      name: 'Монтаж фурнітури, підстілля, ВТК та упаковка',
      shortName: 'Монтаж і пакування',
      days: Math.max(0, input.assemblyStageDays ?? 2),
      colorClass: 'text-purple-400',
      bgClass: 'bg-purple-500/15',
      borderClass: 'border-purple-500/40',
      iconName: 'box',
      description: 'Врізка металевих підсилювачів, монтаж муфт Rampa, кріплення підстілля, контроль якості та обрешітка',
    },
  ];

  // Optional buffer days
  const bufferDays = Math.max(0, input.bufferDays ?? 2);
  if (bufferDays > 0) {
    stageDefs.push({
      id: 'buffer',
      name: 'Технологічний буфер на ризики та контроль',
      shortName: 'Буфер ризиків',
      days: bufferDays,
      colorClass: 'text-rose-400',
      bgClass: 'bg-rose-500/15',
      borderClass: 'border-rose-500/40',
      iconName: 'shield',
      description: 'Запас на непередбачувані затримки, додаткову витримку смоли або міжшарову кристалізацію',
    });
  }

  const stages: ProductionStageItem[] = [];
  let runningDate = new Date(projectStartDateObj.getTime());
  let totalStageDays = 0;

  for (const def of stageDefs) {
    const stageStart = new Date(runningDate.getTime());
    // Note: epoxy curing happens even on weekends because chemical crystallization does not stop,
    // but in strict working-days mode we can follow the user's selected mode or calculate calendar equivalent.
    const stageEnd = addDaysToDate(stageStart, def.days, isWorkingDaysMode);
    runningDate = new Date(stageEnd.getTime());
    totalStageDays += def.days;

    stages.push({
      ...def,
      startDate: formatUkDateDayMonth(stageStart),
      endDate: formatUkDateDayMonth(stageEnd),
      startDateFull: formatUkDateShort(stageStart),
      endDateFull: formatUkDateShort(stageEnd),
    });
  }

  const completionDateObj = runningDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = completionDateObj.getTime() - today.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

  return {
    startDate: startDateStr,
    startDateFormatted: formatUkDate(projectStartDateObj),
    completionDate: formatUkDate(completionDateObj),
    completionDateShort: formatUkDateShort(completionDateObj),
    completionDayOfWeek: UK_DAYS_OF_WEEK[completionDateObj.getDay()],
    totalDays: totalStageDays,
    totalWorkingDays: isWorkingDaysMode ? totalStageDays : Math.round(totalStageDays * (5 / 7)),
    isWorkingDaysMode,
    stages,
    daysRemaining,
  };
}
