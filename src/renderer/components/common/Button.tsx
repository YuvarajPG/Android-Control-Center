import React from 'react';
import { cn } from '../../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'filled',
  size = 'md',
  icon,
  isLoading,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-m3-primary/50 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const variants = {
    filled:
      'bg-m3-primary text-m3-on-primary hover:bg-m3-primary/90 shadow-m3-1 hover:shadow-m3-2',
    tonal:
      'bg-m3-primary-container text-m3-on-primary-container hover:bg-m3-primary-container/80',
    outlined:
      'border border-m3-outline text-m3-on-surface hover:bg-m3-surface-3/50 hover:border-m3-primary',
    ghost:
      'text-m3-on-surface-variant hover:bg-m3-surface-3 hover:text-m3-on-surface',
    danger:
      'bg-m3-error-container text-m3-error hover:bg-m3-error-container/80',
  };

  const sizes = {
    sm: 'text-xs px-3 py-1.5 rounded-m3-sm gap-1.5',
    md: 'text-sm px-4 py-2 rounded-m3-md gap-2',
    lg: 'text-base px-6 py-2.5 rounded-m3-lg gap-2.5',
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
