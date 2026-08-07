import React from 'react';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center p-8 border border-dashed border-m3-outline-variant/40 rounded-m3-xl bg-m3-surface-1/50 my-4',
        className,
      )}
    >
      <div className="p-4 bg-m3-surface-2 rounded-full text-m3-primary mb-3 shadow-m3-1">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-m3-on-surface mb-1">{title}</h3>
      <p className="text-xs text-m3-on-surface-variant max-w-md mb-4 leading-relaxed">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
};
