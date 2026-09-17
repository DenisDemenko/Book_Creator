import React, { useState, useEffect } from 'react';

interface NeoTactileNumberInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
}

export const NeoTactileNumberInput: React.FC<NeoTactileNumberInputProps> = ({
  id,
  value,
  onChange,
  unit,
  min = 0,
  max,
  placeholder,
  className = '',
}) => {
  // Store local string representation to allow smooth typing without cursor jumping or forced zeros
  const [displayValue, setDisplayValue] = useState<string>(() => (value === 0 ? '0' : String(value ?? 0)));

  // Sync external changes (e.g. preset selection, reset, or species change)
  useEffect(() => {
    const numericCurrent = displayValue === '' ? 0 : Number(displayValue);
    if (numericCurrent !== value) {
      setDisplayValue(value === 0 ? '0' : String(value ?? 0));
    }
  }, [value]);

  const sanitizeNumber = (val: string): string => {
    // Replace commas with dots
    let sanitized = val.replace(/,/g, '.');
    // Keep only numeric characters and dot
    sanitized = sanitized.replace(/[^0-9.]/g, '');

    // Allow at most one decimal separator
    const parts = sanitized.split('.');
    if (parts.length > 2) {
      sanitized = parts[0] + '.' + parts.slice(1).join('');
    }

    // Strip leading zeros if followed by another digit (e.g. "015000" -> "15000", "040000" -> "40000", "00" -> "0")
    // Keep "0." intact for decimals (e.g. "0.5")
    if (/^0+[0-9]/.test(sanitized)) {
      sanitized = sanitized.replace(/^0+/, '') || '0';
    }

    return sanitized;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = sanitizeNumber(raw);

    setDisplayValue(clean);

    if (clean === '' || clean === '.') {
      onChange(0);
      return;
    }

    let parsed = parseFloat(clean);
    if (isNaN(parsed)) {
      parsed = 0;
    }

    if (min !== undefined && parsed < min) {
      parsed = min;
    }
    if (max !== undefined && parsed > max) {
      parsed = max;
    }

    onChange(parsed);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const target = e.target;
    target.select();
    // iOS Safari requires a slight delay on touch to prevent immediately un-selecting
    setTimeout(() => {
      try {
        target.select();
      } catch {
        // ignore
      }
    }, 50);
  };

  const handleBlur = () => {
    if (displayValue === '' || isNaN(Number(displayValue))) {
      setDisplayValue('0');
      onChange(0);
    } else {
      const num = Number(displayValue);
      // Clean display value from leading zeros or dangling dots
      const cleanString = String(num);
      setDisplayValue(cleanString);
      onChange(num);
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl neo-inset font-mono text-sm text-cyan-300 focus:outline-none focus:border-cyan-400 pr-14 transition-colors"
      />
      {unit && (
        <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono pointer-events-none select-none">
          {unit}
        </span>
      )}
    </div>
  );
};
