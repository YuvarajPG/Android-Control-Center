import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from './Button';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        className={cn(
          'relative w-full bg-m3-surface-2 border border-m3-surface-4 rounded-m3-xl shadow-m3-3 p-6 text-m3-on-surface z-10 transition-transform animate-in fade-in zoom-in-95 duration-200',
          maxWidths[maxWidth],
        )}
      >
        <div className="flex items-center justify-between pb-4 border-b border-m3-outline-variant/30">
          <h3 className="text-lg font-semibold text-m3-on-surface">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} className="rounded-full p-1 h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="py-4 text-sm text-m3-on-surface-variant max-h-[70vh] overflow-y-auto">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-m3-outline-variant/30">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
