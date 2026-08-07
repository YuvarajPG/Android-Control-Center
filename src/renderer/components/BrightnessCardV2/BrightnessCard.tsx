import React from 'react';
import { Sun } from 'lucide-react';
import { Card } from '../common/Card';
import { useBrightness } from './hooks/useBrightness';
import { BrightnessSlider } from './BrightnessSlider';
import { ScreenControls } from './ScreenControls';

interface BrightnessCardProps {
  serial: string;
  disabled?: boolean;
}

export const BrightnessCard: React.FC<BrightnessCardProps> = ({ serial, disabled = false }) => {
  const { sliderValue, updateBrightness, isLoading } = useBrightness(serial);

  return (
    <Card variant="surface-1" className="p-5 space-y-4 border border-m3-surface-3 shadow-sm hover:shadow-m3-1 transition-all">
      <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
        <Sun className={`h-4.5 w-4.5 text-m3-primary ${isLoading ? 'animate-spin' : ''}`} /> Display & Screen Controls
      </h3>

      <div className="space-y-2.5 bg-m3-surface-2/80 p-3.5 rounded-m3-md border border-m3-surface-4">
        <div className="flex justify-between items-center text-xs font-semibold">
          <span className="text-m3-on-surface-variant flex items-center gap-1.5">
            Screen Brightness
          </span>
        </div>
        <BrightnessSlider value={sliderValue} onChange={updateBrightness} disabled={disabled} />
      </div>

      <ScreenControls serial={serial} disabled={disabled} />
    </Card>
  );
};

export { BrightnessCard as BrightnessCardV2 };
