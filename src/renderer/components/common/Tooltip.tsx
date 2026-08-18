import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';

export interface TooltipProps {
  content: React.ReactNode | string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  icon?: React.ReactNode;
  delayMs?: number;
  className?: string;
  wrapperClassName?: string;
  disabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  icon,
  delayMs = 120,
  className,
  wrapperClassName,
  disabled = false,
}) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    actualPosition: 'top' | 'bottom' | 'left' | 'right';
    arrowLeftOffset?: number;
    arrowTopOffset?: number;
  }>({
    top: 0,
    left: 0,
    actualPosition: position,
  });

  const targetRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateCoordinates = useCallback(() => {
    if (!targetRef.current) return;
    const targetRect = targetRef.current.getBoundingClientRect();
    if (targetRect.width === 0 && targetRect.height === 0) return;

    const tooltipEl = tooltipRef.current;
    const tooltipWidth = tooltipEl?.offsetWidth || 140;
    const tooltipHeight = tooltipEl?.offsetHeight || 28;
    const gap = 6;
    const padding = 8;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let placement = position;

    // Automatic Flip logic if target is near edge of viewport
    if (position === 'top' && targetRect.top - tooltipHeight - gap < padding) {
      placement = 'bottom';
    } else if (position === 'bottom' && targetRect.bottom + tooltipHeight + gap > vh - padding) {
      placement = 'top';
    } else if (position === 'left' && targetRect.left - tooltipWidth - gap < padding) {
      placement = 'right';
    } else if (position === 'right' && targetRect.right + tooltipWidth + gap > vw - padding) {
      placement = 'left';
    }

    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    let top = 0;
    let left = 0;
    let arrowLeftOffset: number | undefined;
    let arrowTopOffset: number | undefined;

    if (placement === 'top') {
      top = Math.round(targetRect.top - tooltipHeight - gap);
      left = Math.round(targetCenterX - tooltipWidth / 2);
      const clampedLeft = Math.max(padding, Math.min(vw - padding - tooltipWidth, left));
      arrowLeftOffset = Math.round(Math.max(8, Math.min(tooltipWidth - 8, targetCenterX - clampedLeft)));
      left = clampedLeft;
    } else if (placement === 'bottom') {
      top = Math.round(targetRect.bottom + gap);
      left = Math.round(targetCenterX - tooltipWidth / 2);
      const clampedLeft = Math.max(padding, Math.min(vw - padding - tooltipWidth, left));
      arrowLeftOffset = Math.round(Math.max(8, Math.min(tooltipWidth - 8, targetCenterX - clampedLeft)));
      left = clampedLeft;
    } else if (placement === 'left') {
      top = Math.round(targetCenterY - tooltipHeight / 2);
      left = Math.round(targetRect.left - tooltipWidth - gap);
      const clampedTop = Math.max(padding, Math.min(vh - padding - tooltipHeight, top));
      arrowTopOffset = Math.round(Math.max(8, Math.min(tooltipHeight - 8, targetCenterY - clampedTop)));
      top = clampedTop;
    } else {
      top = Math.round(targetCenterY - tooltipHeight / 2);
      left = Math.round(targetRect.right + gap);
      const clampedTop = Math.max(padding, Math.min(vh - padding - tooltipHeight, top));
      arrowTopOffset = Math.round(Math.max(8, Math.min(tooltipHeight - 8, targetCenterY - clampedTop)));
      top = clampedTop;
    }

    setCoords({
      top,
      left,
      actualPosition: placement,
      arrowLeftOffset,
      arrowTopOffset,
    });
  }, [position]);

  const handleMouseEnter = () => {
    if (disabled || !content) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    updateCoordinates();
    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, delayMs);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  useLayoutEffect(() => {
    if (visible) {
      updateCoordinates();
    }
  }, [visible, updateCoordinates]);

  useEffect(() => {
    if (!visible) return;

    const handleScrollOrResize = () => {
      updateCoordinates();
    };

    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true });
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [visible, updateCoordinates]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const actualPos = coords.actualPosition;

  return (
    <div
      ref={targetRef}
      className={cn('inline-flex max-w-full min-w-0', wrapperClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
    >
      {children}
      {visible &&
        content &&
        !disabled &&
        createPortal(
          <div
            ref={tooltipRef}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className={cn(
              'fixed z-[99999] pointer-events-none transition-opacity duration-150 animate-[fade-in_100ms_ease-out]',
              'px-2.5 py-1 rounded-m3-xs text-[11px] font-medium text-slate-100 bg-slate-900 border border-slate-700/80 shadow-lg shadow-black/50 antialiased',
              'max-w-xs sm:max-w-sm whitespace-normal break-words leading-tight',
              className,
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {icon && <span className="shrink-0 flex items-center justify-center text-m3-primary">{icon}</span>}
              <div className="min-w-0 flex-1 whitespace-normal break-words text-slate-100">{content}</div>
            </div>

            <span
              style={{
                ...(coords.arrowLeftOffset !== undefined && (actualPos === 'top' || actualPos === 'bottom')
                  ? { left: `${coords.arrowLeftOffset}px` }
                  : {}),
                ...(coords.arrowTopOffset !== undefined && (actualPos === 'left' || actualPos === 'right')
                  ? { top: `${coords.arrowTopOffset}px` }
                  : {}),
              }}
              className={cn(
                'absolute w-2 h-2 bg-slate-900 border-slate-700/80 rotate-45 pointer-events-none',
                actualPos === 'top' && '-bottom-1 -translate-x-1/2 border-b border-r',
                actualPos === 'bottom' && '-top-1 -translate-x-1/2 border-t border-l',
                actualPos === 'left' && '-right-1 -translate-y-1/2 border-t border-r',
                actualPos === 'right' && '-left-1 -translate-y-1/2 border-b border-l',
              )}
            />
          </div>,
          document.body,
        )}
    </div>
  );
};

