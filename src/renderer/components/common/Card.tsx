import React from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'surface-1' | 'surface-2' | 'surface-3' | 'outlined' | 'glass';
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  variant = 'surface-2',
  interactive = false,
  ...props
}) => {
  const baseStyles = 'min-w-0 rounded-m3-lg p-4 shadow-m3-1 transition-[border-color,box-shadow,transform] duration-200';

  const variants = {
    'surface-1': 'bg-m3-surface-1 text-m3-on-surface border border-m3-surface-3/30',
    'surface-2': 'bg-m3-surface-2 text-m3-on-surface border border-m3-surface-4/40',
    'surface-3': 'bg-m3-surface-3 text-m3-on-surface border border-m3-surface-5/50',
    outlined: 'bg-transparent text-m3-on-surface border border-m3-outline-variant',
    glass: 'm3-glass text-m3-on-surface border border-white/10 shadow-m3-1',
  };

  const interactiveStyles = interactive
    ? 'hover:border-m3-primary/50 hover:shadow-m3-2 cursor-pointer active:scale-[0.99]'
    : '';

  return (
    <div className={cn(baseStyles, variants[variant], interactiveStyles, className)} {...props}>
      {children}
    </div>
  );
};
