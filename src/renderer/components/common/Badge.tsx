import React from 'react';
import { cn } from '../../utils/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral';
  size?: 'sm' | 'md';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  className,
  variant = 'neutral',
  size = 'md',
  dot = false,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center font-medium leading-none rounded-m3-full select-none';

  const variants = {
    primary: 'bg-m3-primary-container text-m3-on-primary-container',
    secondary: 'bg-m3-secondary-container text-m3-on-secondary-container',
    success: 'bg-m3-success-container/40 text-m3-success border border-m3-success/30',
    warning: 'bg-m3-warning-container/40 text-m3-warning border border-m3-warning/30',
    error: 'bg-m3-error-container/40 text-m3-error border border-m3-error/30',
    neutral: 'bg-m3-surface-4 text-m3-on-surface-variant border border-m3-outline-variant/30',
  };

  const sizes = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  };

  const dotColors = {
    primary: 'bg-m3-primary',
    secondary: 'bg-m3-secondary',
    success: 'bg-m3-success',
    warning: 'bg-m3-warning',
    error: 'bg-m3-error',
    neutral: 'bg-m3-on-surface-variant',
  };

  return (
    <span className={cn(baseStyles, variants[variant], sizes[size], className)} {...props}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0 animate-pulse', dotColors[variant])} />}
      {children}
    </span>
  );
};
