import React, { InputHTMLAttributes } from 'react';

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
  error?: string;
  helperText?: string;
}

export const GlassInput: React.FC<GlassInputProps> = ({
  label,
  icon,
  rightElement,
  error,
  helperText,
  className = '',
  ...props
}) => {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label className="text-xs font-semibold uppercase tracking-wider text-white/80 px-1">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <div className="absolute left-3.5 text-white/60 pointer-events-none flex items-center">
            {icon}
          </div>
        )}
        <input
          className={`glass-input ${icon ? 'pl-10' : ''} ${
            rightElement ? 'pr-12' : ''
          } ${error ? 'border-red-400/80 bg-red-500/10' : ''} ${className}`}
          {...props}
        />
        {rightElement && (
          <div className="absolute right-3 flex items-center">{rightElement}</div>
        )}
      </div>
      {error ? (
        <span className="text-xs text-red-300 font-medium px-1">{error}</span>
      ) : helperText ? (
        <span className="text-xs text-white/50 px-1">{helperText}</span>
      ) : null}
    </div>
  );
};
