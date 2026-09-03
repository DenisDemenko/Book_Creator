import React from 'react';
import { motion } from 'motion/react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

interface GlassTabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function GlassTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  className = '',
  size = 'md',
}: GlassTabsProps<T>) {
  return (
    <div className={`w-full overflow-x-auto no-scrollbar py-0.5 max-w-full flex items-center ${className}`}>
      <div className="glass-tabs-container flex items-center flex-nowrap w-max min-w-0 shrink-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`glass-tab-btn ${isActive ? 'active font-bold' : ''} ${
                size === 'sm'
                  ? 'py-1.5 px-2.5 sm:px-3 text-xs'
                  : 'py-2 px-3 sm:px-4 text-xs sm:text-sm'
              } flex items-center gap-1.5 sm:gap-2 shrink-0`}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTabPill"
                  className="absolute inset-0 bg-white/25 rounded-[10px] -z-10 border border-white/40"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              {tab.icon && <span className="opacity-90 shrink-0">{tab.icon}</span>}
              <span className="whitespace-nowrap">{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold shrink-0 ${
                    isActive
                      ? 'bg-white/30 text-white'
                      : 'bg-black/20 text-white/70'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
