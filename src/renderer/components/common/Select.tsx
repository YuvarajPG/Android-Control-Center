import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  options: SelectOption[];
  error?: string;
  onChange?: (e: { target: { value: string } }) => void;
}

export const Select: React.FC<SelectProps> = ({
  className,
  label,
  options,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === String(value)) || options[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    if (onChange) {
      onChange({ target: { value: optionValue } });
    }
    setIsOpen(false);
  };

  return (
    <div className="w-full flex flex-col gap-1.5 relative" ref={containerRef}>
      {label && (
        <label className="text-xs font-medium text-m3-on-surface-variant">
          {label}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'w-full flex items-center justify-between bg-m3-surface-2 border border-m3-outline-variant/60 rounded-m3-md px-3 py-2 text-sm text-m3-on-surface transition-all focus:outline-none focus:border-m3-primary focus:ring-1 focus:ring-m3-primary disabled:opacity-50 text-left',
          error && 'border-m3-error focus:border-m3-error focus:ring-m3-error',
          isOpen && 'border-m3-primary ring-1 ring-m3-primary',
          className
        )}
      >
        <span className="truncate">{selectedOption?.label || ''}</span>
        <ChevronDown className={cn('h-4 w-4 text-m3-on-surface-variant transition-transform duration-200 shrink-0 ml-2', isOpen && 'rotate-180 text-m3-primary')} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full z-50 bg-m3-surface-3 border border-m3-surface-5 rounded-m3-md shadow-m3-3 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors text-left',
                  isSelected
                    ? 'bg-m3-primary-container/40 text-m3-primary font-semibold'
                    : 'text-m3-on-surface hover:bg-m3-surface-4'
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-m3-primary shrink-0 ml-2" />}
              </button>
            );
          })}
        </div>
      )}
      {error && <span className="text-xs text-m3-error">{error}</span>}
    </div>
  );
};
