import React from 'react';
import { Lock, Power } from 'lucide-react';
import { Button } from '../common/Button';
import { ipcService } from '../../services/ipcService';

interface ScreenControlsProps {
  serial: string;
  disabled?: boolean;
}

export const ScreenControls: React.FC<ScreenControlsProps> = ({ serial, disabled = false }) => {
  const handleWake = async () => {
    if (!serial) return;
    await ipcService.control.wake(serial);
  };

  const handleLock = async () => {
    if (!serial) return;
    await ipcService.control.lock(serial);
  };

  return (
    <div className="grid grid-cols-2 gap-3 pt-1">
      <Button
        variant="tonal"
        size="sm"
        disabled={disabled}
        icon={<Lock className="h-4 w-4 text-m3-warning" />}
        onClick={handleLock}
        className="w-full justify-center font-medium"
      >
        Lock Screen
      </Button>
      <Button
        variant="filled"
        size="sm"
        disabled={disabled}
        icon={<Power className="h-4 w-4 text-m3-primary" />}
        onClick={handleWake}
        className="w-full justify-center font-medium"
      >
        Wake Screen
      </Button>
    </div>
  );
};
