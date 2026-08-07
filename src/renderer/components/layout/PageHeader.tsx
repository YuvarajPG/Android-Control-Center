import React from 'react';
import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-between gap-3 border-b border-m3-surface-4/60 pb-4 mb-5 sm:flex-row sm:items-center',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-m3-on-surface tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-xs text-m3-on-surface-variant mt-0.5 leading-normal">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>}
    </div>
  );
};
