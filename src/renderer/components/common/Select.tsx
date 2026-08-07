import React from 'react';
import { cn } from '../../utils/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
}

export const Select: React.FC<SelectProps> = ({
  className,
  label,
  options,
  error,
  ...props
}) => {
  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-medium text-m3-on-surface-variant">
          {label}
        </label>
      )}
      <select
        className={cn(
          'w-full bg-m3-surface-2 border border-m3-outline-variant/60 rounded-m3-md px-3 py-2 text-sm text-m3-on-surface transition-colors focus:outline-none focus:border-m3-primary focus:ring-1 focus:ring-m3-primary disabled:opacity-50',
          error && 'border-m3-error focus:border-m3-error focus:ring-m3-error',
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-m3-surface-2 text-m3-on-surface">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-m3-error">{error}</span>}
    </div>
  );
};
