import React, { useState } from 'react';
import { ChevronDown, LucideIcon } from 'lucide-react';

interface NeoTactileCardProps {
  id?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: 'blue' | 'cyan' | 'slate' | 'amber' | 'purple' | 'emerald';
  icon?: LucideIcon;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}

export const NeoTactileCard: React.FC<NeoTactileCardProps> = ({
  id,
  title,
  subtitle,
  badge,
  badgeColor = 'blue',
  icon: Icon,
  collapsible = false,
  defaultExpanded = true,
  children,
  headerAction,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const badgeStyles = {
    blue: 'bg-blue-500/15 text-blue-300 border-blue-400/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30',
    slate: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-400/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  }[badgeColor];

  return (
    <div
      id={id}
      className="neo-card rounded-2xl p-5 md:p-6 transition-all duration-300 relative overflow-hidden"
    >
      {/* Subtle top edge glow reflection */}
      <div className="absolute top-0 left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent pointer-events-none" />

      {/* Header */}
      <div
        className={`flex items-center justify-between ${
          collapsible ? 'cursor-pointer select-none' : ''
        } ${expanded && children ? 'mb-5 pb-3 border-b border-white/5' : ''}`}
        onClick={() => collapsible && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-9 h-9 rounded-xl neo-icon-btn flex items-center justify-center text-cyan-400 shrink-0 shadow-[0_0_12px_rgba(56,189,248,0.2)]">
              <Icon className="w-4 h-4" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-100 tracking-wide">{title}</h3>
              {badge && (
                <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${badgeStyles}`}>
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {headerAction && <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>}
          {collapsible && (
            <button
              type="button"
              className="w-7 h-7 rounded-lg neo-icon-btn flex items-center justify-center text-slate-400 hover:text-slate-200 transition-transform"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${
                  expanded ? 'rotate-180 text-cyan-400' : ''
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {(!collapsible || expanded) && (
        <div className="space-y-4 animate-fadeIn">{children}</div>
      )}
    </div>
  );
};
