import React from 'react';
import { motion } from 'motion/react';

interface GlassToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  sublabel?: string;
}

export const GlassToggle: React.FC<GlassToggleProps> = ({
  checked,
  onChange,
  label,
  sublabel,
}) => {
  return (
    <div
      className="inline-flex items-center gap-3 cursor-pointer select-none"
      onClick={() => onChange(!checked)}
    >
      <div
        className={`relative w-12 h-7 rounded-full p-1 transition-all duration-300 border ${
          checked
            ? 'bg-white/30 border-white/50 shadow-[0_4px_12px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.7)]'
            : 'bg-black/20 border-white/20 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]'
        }`}
      >
        <motion.div
          animate={{ x: checked ? 20 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={`w-5 h-5 rounded-full shadow-md transition-all ${
            checked
              ? 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.8),inset_0_1px_1px_rgba(255,255,255,0.9)]'
              : 'bg-white/70 shadow-[0_2px_4px_rgba(0,0,0,0.3)]'
          }`}
        />
      </div>
      {(label || sublabel) && (
        <div className="flex flex-col">
          {label && <span className="text-sm font-medium text-white/90">{label}</span>}
          {sublabel && <span className="text-xs text-white/60">{sublabel}</span>}
        </div>
      )}
    </div>
  );
};
