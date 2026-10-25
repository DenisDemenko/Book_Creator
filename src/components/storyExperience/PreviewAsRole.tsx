import React from 'react';
import { Eye, ShieldCheck, UserRound, UsersRound } from 'lucide-react';

export type PreviewRole = 'author' | 'coauthor' | 'editor' | 'observer' | 'game-master' | 'player' | 'facilitator' | 'client' | 'representative' | 'host' | 'participant';

const roleLabels: Record<PreviewRole, string> = {
  author: 'Автор',
  coauthor: 'Співавтор',
  editor: 'Редактор',
  observer: 'Спостерігач',
  'game-master': 'Game Master',
  player: 'Гравець',
  facilitator: 'Фасилітатор',
  client: 'Клієнт',
  representative: 'Представник',
  host: 'Ведучий',
  participant: 'Учасник',
};

interface PreviewAsRoleProps {
  value: PreviewRole;
  roles?: PreviewRole[];
  onChange?: (role: PreviewRole) => void;
  onExitPreview?: () => void;
  active?: boolean;
}

export const PreviewAsRole: React.FC<PreviewAsRoleProps> = ({
  value,
  roles = ['author', 'editor', 'observer', 'player', 'participant'],
  onChange,
  onExitPreview,
  active = true,
}) => (
  <div className={`flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between ${active ? 'border-cyan-500/30 bg-cyan-500/10' : 'border-slate-800 bg-slate-900'}`} data-story-experience="preview-as-role">
    <div className="flex items-start gap-2">
      <div className="mt-0.5 rounded-lg border border-slate-700 bg-slate-950 p-2 text-cyan-300"><Eye className="h-4 w-4" /></div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-300">Preview as Role</div>
        <div className="mt-1 text-xs text-slate-300">Перевірте, що реально бачить користувач із вибраною роллю.</div>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <UsersRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <select value={value} onChange={(event) => onChange?.(event.target.value as PreviewRole)} className="rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-8 text-xs font-semibold text-slate-200 outline-none focus:border-cyan-500/60">
          {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
        </select>
      </div>
      <span className="hidden items-center gap-1 rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-500 md:inline-flex"><ShieldCheck className="h-3 w-3" /> лише UI-перегляд</span>
      {onExitPreview && <button type="button" onClick={onExitPreview} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"><UserRound className="h-3.5 w-3.5" /> Вийти</button>}
    </div>
  </div>
);
