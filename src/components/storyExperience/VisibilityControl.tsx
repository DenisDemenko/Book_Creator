import React from 'react';
import { Eye, EyeOff, LockKeyhole, Shield, UserRoundCheck, Users } from 'lucide-react';

export type VisibilityMode =
  | 'PUBLIC'
  | 'PROJECT'
  | 'ROLE_BASED'
  | 'PRIVATE'
  | 'SECRET'
  | 'GAME_MASTER_ONLY'
  | 'FACILITATOR_ONLY'
  | 'CLIENT_CONTROLLED'
  | 'SENSITIVE';

const meta: Record<VisibilityMode, { label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  PUBLIC: { label: 'Публічно', description: 'Видно всім, хто має доступ до матеріалу.', icon: Eye },
  PROJECT: { label: 'Учасники проєкту', description: 'Видно всім учасникам цього проєкту.', icon: Users },
  ROLE_BASED: { label: 'За ролями', description: 'Видимість залежить від ролі учасника.', icon: UserRoundCheck },
  PRIVATE: { label: 'Приватно', description: 'Видно лише власнику.', icon: LockKeyhole },
  SECRET: { label: 'Секрет', description: 'Прихований сюжетний або ігровий матеріал.', icon: EyeOff },
  GAME_MASTER_ONLY: { label: 'Лише ведучому гри', description: 'Видно тільки Game Master.', icon: Shield },
  FACILITATOR_ONLY: { label: 'Лише фасилітатору', description: 'Видно тільки фасилітатору сесії.', icon: Shield },
  CLIENT_CONTROLLED: { label: 'Контролює клієнт', description: 'Клієнт вирішує, хто бачить цей матеріал.', icon: UserRoundCheck },
  SENSITIVE: { label: 'Чутливі дані', description: 'Потребує особливо обережного показу.', icon: LockKeyhole },
};

interface VisibilityControlProps {
  value: VisibilityMode;
  onChange?: (value: VisibilityMode) => void;
  compact?: boolean;
  disabled?: boolean;
}

export const VisibilityControl: React.FC<VisibilityControlProps> = ({ value, onChange, compact = false, disabled = false }) => {
  const current = meta[value];
  const Icon = current.icon;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-300" title={current.description}>
        <Icon className="h-3 w-3" /> {current.label}
      </span>
    );
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Хто бачить</span>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value as VisibilityMode)}
          className="w-full appearance-none rounded-xl border border-slate-800 bg-slate-950 py-2 pl-9 pr-8 text-xs font-semibold text-slate-200 outline-none focus:border-cyan-500/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {Object.entries(meta).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
      </div>
      <span className="mt-1.5 block text-[10px] leading-4 text-slate-600">{current.description}</span>
    </label>
  );
};
