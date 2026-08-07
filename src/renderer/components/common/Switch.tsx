import React from 'react';
import { cn } from '../../utils/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  className,
}) => {
  return (
    <label className={cn('inline-flex items-center gap-3 cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary/50',
          checked ? 'bg-m3-primary' : 'bg-m3-surface-5',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-m3-surface-0 shadow-m3-1 ring-0 transition duration-200 ease-in-out',
            checked ? 'translate-x-5 bg-m3-on-primary' : 'translate-x-0 bg-m3-on-surface-variant',
          )}
        />
      </button>
      {label && <span className="text-sm font-medium text-m3-on-surface">{label}</span>}
    </label>
  );
};
