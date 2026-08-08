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
    const tooltipWidth = tooltipEl?.offsetWidth || 160;
    const tooltipHeight = tooltipEl?.offsetHeight || 32;
    const gap = 8;
    const padding = 12;

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

    let top = 0;
    let left = 0;

    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;

    if (placement === 'top') {
      top = targetRect.top - gap;
      left = targetCenterX;
    } else if (placement === 'bottom') {
      top = targetRect.bottom + gap;
      left = targetCenterX;
    } else if (placement === 'left') {
      top = targetCenterY;
      left = targetRect.left - gap;
    } else {
      top = targetCenterY;
      left = targetRect.right + gap;
    }

    let arrowLeftOffset: number | undefined;
    let arrowTopOffset: number | undefined;

    // Viewport edge containment & Arrow tracking adjustment
    if (placement === 'top' || placement === 'bottom') {
      const halfW = tooltipWidth / 2;
      let clampedLeft = left;

      if (left - halfW < padding) {
        clampedLeft = padding + halfW;
      } else if (left + halfW > vw - padding) {
        clampedLeft = vw - padding - halfW;
      }

      arrowLeftOffset = targetCenterX - (clampedLeft - halfW);
      left = clampedLeft;
      top = Math.max(padding, Math.min(vh - padding, top));
    } else {
      const halfH = tooltipHeight / 2;
      let clampedTop = top;

      if (top - halfH < padding) {
        clampedTop = padding + halfH;
      } else if (top + halfH > vh - padding) {
        clampedTop = vh - padding - halfH;
      }

      arrowTopOffset = targetCenterY - (clampedTop - halfH);
      top = clampedTop;
      left = Math.max(padding, Math.min(vw - padding, left));
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

  const transformStyle: Record<string, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

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
              transform: transformStyle[actualPos],
            }}
            className={cn(
              'fixed z-[99999] pointer-events-none transition-opacity duration-150 animate-[fade-in_120ms_ease-out]',
              'px-3 py-1.5 rounded-m3-md text-xs font-medium text-slate-100 bg-slate-900/95 border border-slate-700/60 shadow-xl shadow-black/40 backdrop-blur-md',
              'max-w-xs sm:max-w-sm whitespace-normal break-words leading-snug',
              className,
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {icon && <span className="shrink-0 flex items-center justify-center text-m3-primary">{icon}</span>}
              <div className="min-w-0 flex-1 whitespace-normal break-words">{content}</div>
            </div>

            <span
              style={{
                ...(coords.arrowLeftOffset !== undefined && (actualPos === 'top' || actualPos === 'bottom')
                  ? { left: `${coords.arrowLeftOffset}px`, transform: 'translateX(-50%) rotate(45deg)' }
                  : {}),
                ...(coords.arrowTopOffset !== undefined && (actualPos === 'left' || actualPos === 'right')
                  ? { top: `${coords.arrowTopOffset}px`, transform: 'translateY(-50%) rotate(45deg)' }
                  : {}),
              }}
              className={cn(
                'absolute w-2 h-2 bg-slate-900 border-slate-700/60 rotate-45 pointer-events-none',
                actualPos === 'top' && '-bottom-1 left-1/2 -translate-x-1/2 border-b border-r',
                actualPos === 'bottom' && '-top-1 left-1/2 -translate-x-1/2 border-t border-l',
                actualPos === 'left' && '-right-1 top-1/2 -translate-y-1/2 border-t border-r',
                actualPos === 'right' && '-left-1 top-1/2 -translate-y-1/2 border-b border-l',
              )}
            />
          </div>,
          document.body,
        )}
    </div>
  );
};

