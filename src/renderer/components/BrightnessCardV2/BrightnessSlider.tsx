import React from 'react';
import { Sun, SunMedium } from 'lucide-react';

interface BrightnessSliderProps {
  value: number; // 0..255
  onChange: (value: number) => void;
  disabled?: boolean;
}

export const BrightnessSlider: React.FC<BrightnessSliderProps> = ({ value, onChange, disabled = false }) => {
  const renderIcon = () => {
    if (value < 85) return <SunMedium className="h-4 w-4 text-m3-on-surface-variant shrink-0" />;
    if (value < 170) return <Sun className="h-4 w-4 text-m3-primary shrink-0" />;
    return <Sun className="h-4 w-4 text-m3-primary shrink-0 drop-shadow-[0_0_8px_rgba(168,199,250,0.6)]" />;
  };

  return (
    <div className="flex items-center gap-3 pt-1">
      {renderIcon()}
      <input
        type="range"
        min="0"
        max="255"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full h-2.5 bg-m3-surface-4 rounded-lg appearance-none cursor-pointer accent-m3-primary transition-all disabled:opacity-50"
      />
      <Sun className="h-5 w-5 text-m3-primary shrink-0" />
    </div>
  );
};
