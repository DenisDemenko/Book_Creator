import React, { useState } from 'react';
import { 
  Calendar, 
  Clock, 
  Wind, 
  Hammer, 
  Droplet, 
  Cpu, 
  Sparkles, 
  Box, 
  Shield, 
  Check, 
  Copy, 
  AlertCircle, 
  ChevronRight,
  Flame,
  Zap,
  CalendarCheck
} from 'lucide-react';
import { CalculationInput, ProductionScheduleResult } from '../types';
import { calculateProductionSchedule, getTodayIsoString } from '../utils/timelineCalculator';
import { NeoTactileCard } from './NeoTactileCard';

interface ProductionTimelineSectionProps {
  input: CalculationInput;
  onChange: (updated: Partial<CalculationInput>) => void;
}

export const ProductionTimelineSection: React.FC<ProductionTimelineSectionProps> = ({
  input,
  onChange,
}) => {
  const [copied, setCopied] = useState(false);
  const schedule: ProductionScheduleResult = calculateProductionSchedule(input);

  const handleCopySchedule = () => {
    const lines = [
      `📅 ГРАФІК ТА ТЕРМІНИ ВИРОБНИЦТВА ВИРОБУ`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `🚀 Дата старту робіт: ${schedule.startDateFormatted}`,
      `🏁 ОРІЄНТОВНА ДАТА ГОТОВНОСТІ: ${schedule.completionDate} (${schedule.completionDayOfWeek})`,
      `⏱️ Загальна тривалість: ${schedule.totalDays} ${schedule.isWorkingDaysMode ? 'робочих днів' : 'календарних днів'}`,
      ``,
      `Етапи виконання робіт:`,
      ...schedule.stages.map(
        (s, idx) => `${idx + 1}. ${s.shortName}: ${s.days} дн. (${s.startDateFull} – ${s.endDateFull})`
      ),
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `* Розраховано у Neo-Tactile Wood & Epoxy Pricing Engine`
    ];

    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const getStageIcon = (iconName: string) => {
    switch (iconName) {
      case 'wind': return <Wind className="w-4 h-4 text-amber-400" />;
      case 'hammer': return <Hammer className="w-4 h-4 text-blue-400" />;
      case 'droplet': return <Droplet className="w-4 h-4 text-cyan-400" />;
      case 'cpu': return <Cpu className="w-4 h-4 text-indigo-400" />;
      case 'sparkles': return <Sparkles className="w-4 h-4 text-emerald-400" />;
      case 'box': return <Box className="w-4 h-4 text-purple-400" />;
      case 'shield': return <Shield className="w-4 h-4 text-rose-400" />;
      default: return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  // Quick Presets
  const applyPreset = (type: 'standard' | 'express' | 'deep_pour') => {
    if (type === 'standard') {
      onChange({
        dryingStageDays: 5,
        carpentryStageDays: 4,
        epoxyCureStageDays: 6,
        cncStageDays: 2,
        finishingStageDays: 3,
        assemblyStageDays: 2,
        bufferDays: 2,
      });
    } else if (type === 'express') {
      onChange({
        dryingStageDays: 1, // вже сухий сляб
        carpentryStageDays: 2,
        epoxyCureStageDays: 3, // швидка смола
        cncStageDays: 1,
        finishingStageDays: 2,
        assemblyStageDays: 1,
        bufferDays: 1,
      });
    } else if (type === 'deep_pour') {
      onChange({
        dryingStageDays: 7,
        carpentryStageDays: 5,
        epoxyCureStageDays: 8, // глибока товста заливка 5-10 см
        cncStageDays: 2,
        finishingStageDays: 4,
        assemblyStageDays: 2,
        bufferDays: 3,
      });
    }
  };

  return (
    <NeoTactileCard
      id="production-timeline-card"
      title="5. Графік виробництва та дедлайн проекту"
      subtitle="Розрахунок орієнтовної кількості днів на кожен технологічний етап і автоматичне прогнозування дати завершення"
      icon={Calendar}
      badge={`${schedule.totalDays} дн. • до ${schedule.completionDateShort}`}
      badgeColor="emerald"
      collapsible
      defaultExpanded
    >
      <div className="space-y-6">
        {/* Hero Completion Banner */}
        <div className="p-5 sm:p-6 rounded-2xl neo-inset bg-gradient-to-br from-slate-900 via-slate-900/90 to-emerald-950/30 border border-emerald-500/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-400">
                <CalendarCheck className="w-4 h-4" />
                <span>АВТОМАТИЧНО РОЗРАХОВАНА ДАТА ГОТОВНОСТІ ВИРОБУ:</span>
              </div>
              <div className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight flex flex-wrap items-baseline gap-2">
                <span>{schedule.completionDate}</span>
                <span className="text-base sm:text-lg font-semibold text-emerald-400 font-sans">
                  ({schedule.completionDayOfWeek})
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Загальний термін виконання: <span className="text-white font-semibold font-mono">{schedule.totalDays} дн.</span>
                {schedule.isWorkingDaysMode ? ' (тільки робочі дні Пн-Пт)' : ' (безперервний технологічний цикл)'}.
                {schedule.daysRemaining > 0 && (
                  <span className="ml-1 text-cyan-300">
                    Очікується через ~{schedule.daysRemaining} дн. від сьогодні.
                  </span>
                )}
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopySchedule}
                className="px-3.5 py-2 rounded-xl neo-pill-default text-xs font-medium flex items-center gap-1.5 cursor-pointer active:scale-95 text-slate-300 hover:text-white border border-white/10"
                title="Скопіювати графік етапів та дедлайн для відправки клієнту"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Скопійовано!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Скопіювати дедлайн</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Global Timeline Settings: Start Date & Working vs Calendar Days */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-2xl neo-card-subtle border border-white/5">
          {/* Start Date */}
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Дата старту робіт
            </label>
            <div className="flex items-center gap-2">
              <input
                id="input-project-start-date"
                type="date"
                value={input.projectStartDate || getTodayIsoString()}
                onChange={(e) => onChange({ projectStartDate: e.target.value })}
                className="w-full neo-input rounded-xl px-3 py-2 text-xs font-mono text-white bg-slate-900/80 border border-white/10 focus:border-cyan-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange({ projectStartDate: getTodayIsoString() })}
                className="px-2.5 py-2 rounded-xl neo-pill-default text-[11px] font-mono whitespace-nowrap cursor-pointer hover:text-white"
                title="Встановити сьогоднішню дату"
              >
                Сьогодні
              </button>
            </div>
          </div>

          {/* Working Days vs Calendar Days Mode */}
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Режим обліку днів
            </label>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl p-1 neo-inset">
              <button
                type="button"
                onClick={() => onChange({ workDaysMode: 'calendar' })}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  input.workDaysMode !== 'working_days'
                    ? 'neo-pill-active text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Календарні дні (полімеризація смоли та сушка масла триває безперервно у вихідні)"
              >
                Календарні дні
              </button>
              <button
                type="button"
                onClick={() => onChange({ workDaysMode: 'working_days' })}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  input.workDaysMode === 'working_days'
                    ? 'neo-pill-active text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Тільки робочі дні цеху (Пн-Пт)"
              >
                Робочі (Пн-Пт)
              </button>
            </div>
          </div>

          {/* Quick Preset Speed */}
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1">
              Швидкі пресети термінів
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset('express')}
                className="flex-1 py-1.5 px-2 rounded-xl neo-pill-default text-[11px] font-medium text-amber-400 hover:text-amber-300 cursor-pointer text-center"
                title="Експрес-замовлення (сухий сляб, швидка смола)"
              >
                Експрес
              </button>
              <button
                type="button"
                onClick={() => applyPreset('standard')}
                className="flex-1 py-1.5 px-2 rounded-xl neo-pill-default text-[11px] font-medium text-cyan-400 hover:text-cyan-300 cursor-pointer text-center"
                title="Стандартний повний цикл (рекомендований)"
              >
                Стандарт
              </button>
              <button
                type="button"
                onClick={() => applyPreset('deep_pour')}
                className="flex-1 py-1.5 px-2 rounded-xl neo-pill-default text-[11px] font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer text-center"
                title="Глибока заливка (масивні річки від 5-8 см)"
              >
                Масив
              </button>
            </div>
          </div>
        </div>

        {/* Visual Gantt Bar (Proportional Stages Timeline) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Візуальний графік етапів проекту:</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {schedule.startDateFormatted} → {schedule.completionDate}
            </span>
          </div>

          {/* Bar track */}
          <div className="w-full h-7 bg-slate-900/90 rounded-xl p-1 border border-white/10 flex overflow-hidden shadow-inner gap-1">
            {schedule.stages.map((st) => {
              const widthPct = schedule.totalDays > 0 ? (st.days / schedule.totalDays) * 100 : 0;
              if (st.days <= 0) return null;
              return (
                <div
                  key={st.id}
                  style={{ width: `${widthPct}%` }}
                  className={`h-full rounded-lg ${st.bgClass} border ${st.borderClass} flex items-center justify-center relative group transition-all cursor-help`}
                  title={`${st.name}: ${st.days} дн. (${st.startDateFull} - ${st.endDateFull})`}
                >
                  <span className={`text-[10px] font-mono font-bold ${st.colorClass} truncate px-1`}>
                    {widthPct > 12 ? `${st.shortName} (${st.days}д)` : widthPct > 6 ? `${st.days}д` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Interactive Stages Cards (Configuring days for each stage) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* 1. Сушка деревини */}
          <div className="p-3.5 rounded-2xl neo-card-subtle border border-amber-500/20 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/20">
                  <Wind className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">1. Камерна сушка / сляби</h4>
                  <p className="text-[10px] text-slate-400">Доведення до 8-10% вологості</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300">
                {schedule.stages.find((s) => s.id === 'drying')?.startDateFull} – {schedule.stages.find((s) => s.id === 'drying')?.endDateFull}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-300">Тривалість:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ dryingStageDays: Math.max(0, (input.dryingStageDays ?? 5) - 1) })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono font-bold text-sm text-amber-300">
                  {input.dryingStageDays ?? 5} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ dryingStageDays: (input.dryingStageDays ?? 5) + 1 })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Якщо сляб уже висушений, можна вказати 0-1 день.</p>
          </div>

          {/* 2. Робота столяра */}
          <div className="p-3.5 rounded-2xl neo-card-subtle border border-blue-500/20 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/20">
                  <Hammer className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">2. Робота столяра</h4>
                  <p className="text-[10px] text-slate-400">Опалубка, фугування, герметизація</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300">
                {schedule.stages.find((s) => s.id === 'carpentry')?.startDateFull} – {schedule.stages.find((s) => s.id === 'carpentry')?.endDateFull}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-300">Тривалість:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ carpentryStageDays: Math.max(0, (input.carpentryStageDays ?? 4) - 1) })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono font-bold text-sm text-blue-300">
                  {input.carpentryStageDays ?? 4} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ carpentryStageDays: (input.carpentryStageDays ?? 4) + 1 })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Вирівнювання слябів, збирання форми, ґрунтовка пор.</p>
          </div>

          {/* 3. Заливка смоли */}
          <div className="p-3.5 rounded-2xl neo-card-subtle border border-cyan-500/20 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/20">
                  <Droplet className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">3. Заливка смоли</h4>
                  <p className="text-[10px] text-slate-400">Пошарове лиття та полімеризація</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300">
                {schedule.stages.find((s) => s.id === 'epoxy')?.startDateFull} – {schedule.stages.find((s) => s.id === 'epoxy')?.endDateFull}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-300">Тривалість:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ epoxyCureStageDays: Math.max(0, (input.epoxyCureStageDays ?? 6) - 1) })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono font-bold text-sm text-cyan-300">
                  {input.epoxyCureStageDays ?? 6} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ epoxyCureStageDays: (input.epoxyCureStageDays ?? 6) + 1 })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Критичний час повної кристалізації (5-7 днів).</p>
          </div>

          {/* 4. ЧПУ обробка */}
          <div className="p-3.5 rounded-2xl neo-card-subtle border border-indigo-500/20 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/20">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">4. ЧПУ обробка</h4>
                  <p className="text-[10px] text-slate-400">Сляб-планінг площини, пази</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300">
                {schedule.stages.find((s) => s.id === 'cnc')?.startDateFull} – {schedule.stages.find((s) => s.id === 'cnc')?.endDateFull}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-300">Тривалість:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ cncStageDays: Math.max(0, (input.cncStageDays ?? 2) - 1) })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono font-bold text-sm text-indigo-300">
                  {input.cncStageDays ?? 2} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ cncStageDays: (input.cncStageDays ?? 2) + 1 })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Вирівнювання обох сторін у нуль та торцювання.</p>
          </div>

          {/* 5. Фініш та масло */}
          <div className="p-3.5 rounded-2xl neo-card-subtle border border-emerald-500/20 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/20">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">5. Фінішне покриття</h4>
                  <p className="text-[10px] text-slate-400">Шліфовка Р80-Р3000, 2 шари масла</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300">
                {schedule.stages.find((s) => s.id === 'finishing')?.startDateFull} – {schedule.stages.find((s) => s.id === 'finishing')?.endDateFull}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-300">Тривалість:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ finishingStageDays: Math.max(0, (input.finishingStageDays ?? 3) - 1) })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono font-bold text-sm text-emerald-300">
                  {input.finishingStageDays ?? 3} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ finishingStageDays: (input.finishingStageDays ?? 3) + 1 })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Міжшарова сушка та полірування смоли.</p>
          </div>

          {/* 6. Монтаж, ВТК та упаковка */}
          <div className="p-3.5 rounded-2xl neo-card-subtle border border-purple-500/20 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/20">
                  <Box className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">6. Монтаж та упаковка</h4>
                  <p className="text-[10px] text-slate-400">Підстілля, C-channel, контроль якості</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300">
                {schedule.stages.find((s) => s.id === 'assembly')?.startDateFull} – {schedule.stages.find((s) => s.id === 'assembly')?.endDateFull}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-300">Тривалість:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ assemblyStageDays: Math.max(0, (input.assemblyStageDays ?? 2) - 1) })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono font-bold text-sm text-purple-300">
                  {input.assemblyStageDays ?? 2} дн.
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ assemblyStageDays: (input.assemblyStageDays ?? 2) + 1 })}
                  className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Кріплення ніжок, стретч, картон, обрешітка.</p>
          </div>
        </div>

        {/* 7. Буфер ризиків / запас часу */}
        <div className="p-3.5 rounded-2xl neo-inset bg-slate-900/60 border border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h5 className="text-xs font-bold text-white">Технологічний буфер на форс-мажори</h5>
              <p className="text-[11px] text-slate-400">
                Захисний запас днів на додаткову дегазацію, висихання між шарами або затримку поставки ніжок
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={() => onChange({ bufferDays: Math.max(0, (input.bufferDays ?? 2) - 1) })}
              className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
            >
              -
            </button>
            <span className="font-mono font-bold text-sm text-rose-300 px-2">
              +{input.bufferDays ?? 2} дн.
            </span>
            <button
              type="button"
              onClick={() => onChange({ bufferDays: (input.bufferDays ?? 2) + 1 })}
              className="w-7 h-7 rounded-lg neo-pill-default text-xs font-bold flex items-center justify-center cursor-pointer text-slate-300 hover:text-white"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </NeoTactileCard>
  );
};
