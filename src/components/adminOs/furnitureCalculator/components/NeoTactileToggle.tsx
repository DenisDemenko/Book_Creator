import React from 'react';

interface NeoTactileToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  sublabel?: string;
}

export const NeoTactileToggle: React.FC<NeoTactileToggleProps> = ({
  id,
  checked,
  onChange,
  label,
  sublabel,
}) => {
  return (
    <div id={id} className="flex items-center justify-between py-2 cursor-pointer select-none" onClick={() => onChange(!checked)}>
      {(label || sublabel) && (
        <div className="mr-3">
          {label && <span className="text-sm font-medium text-slate-200">{label}</span>}
          {sublabel && <p className="text-xs text-slate-400 mt-0.5">{sublabel}</p>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">
          {checked ? 'On' : 'Off'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={(e) => {
            e.stopPropagation();
            onChange(!checked);
          }}
          className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out p-1 neo-inset ${
            checked
              ? 'bg-gradient-to-r from-blue-700 to-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]'
              : 'bg-slate-900/90'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white transition duration-200 ease-in-out shadow-[0_2px_8px_rgba(0,0,0,0.6),0_0_8px_rgba(255,255,255,0.8)] ${
              checked ? 'translate-x-6' : 'translate-x-0 bg-slate-300'
            }`}
          />
        </button>
      </div>
    </div>
  );
};
