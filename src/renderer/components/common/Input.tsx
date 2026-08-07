import React from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, type = 'text', ...props }, ref) => {
    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label className="text-xs font-medium text-m3-on-surface-variant">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <span className="absolute left-3 text-m3-on-surface-variant pointer-events-none">
              {icon}
            </span>
          )}
          <input
            type={type}
            ref={ref}
            className={cn(
              'w-full bg-m3-surface-2 border border-m3-outline-variant/60 rounded-m3-md py-2 text-sm text-m3-on-surface placeholder:text-m3-on-surface-variant/50 transition-colors focus:outline-none focus:border-m3-primary focus:ring-1 focus:ring-m3-primary disabled:opacity-50 disabled:cursor-not-allowed',
              icon ? 'pl-9 pr-3' : 'px-3',
              error && 'border-m3-error focus:border-m3-error focus:ring-m3-error',
              className,
            )}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-m3-error">{error}</span>}
      </div>
    );
  },
);

Input.displayName = 'Input';
