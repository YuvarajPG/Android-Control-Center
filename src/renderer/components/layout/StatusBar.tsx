import React from 'react';
import { Battery, BatteryCharging, Cpu, HardDrive, Terminal } from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';

export const StatusBar: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const device = getSelectedDevice();

  return (
    <footer className="z-10 flex h-7 min-w-0 shrink-0 items-center justify-between gap-3 border-t border-m3-surface-3 bg-m3-surface-1 px-3 text-[11px] text-m3-on-surface-variant select-none sm:px-4">
      {/* Left Active Device Brief */}
      <div className="flex min-w-0 items-center gap-3">
        {device ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-m3-on-surface">
              <span className={`h-2 w-2 rounded-full ${device.status === 'online' ? 'bg-m3-success' : 'bg-m3-warning'}`} />
              <span className="truncate">{device.name || device.deviceName || device.model} [{device.serialNumber || device.serial}]</span>
            </span>
            <span className="hidden border-l border-m3-surface-4 pl-3 text-m3-on-surface-variant xl:inline">
              OS: <strong className="text-m3-on-surface">{device.androidVersion}</strong>
            </span>
          </>
        ) : (
          <span className="text-m3-on-surface-variant italic">No target device selected</span>
        )}
      </div>

      {/* Right Hardware Stats & Quick Indicators */}
      <div className="flex shrink-0 items-center gap-3 font-mono">
        {device && (
          <>
            <span className="hidden items-center gap-1 2xl:flex">
              <HardDrive className="h-3 w-3 text-m3-primary" />
              Storage: {device.storageFree} free
            </span>

            <span className="flex items-center gap-1">
              {device.isCharging ? (
                <BatteryCharging className="h-3.5 w-3.5 text-m3-success" />
              ) : (
                <Battery className="h-3.5 w-3.5 text-m3-warning" />
              )}
              {device.batteryLevel}%
            </span>

            <span className="hidden items-center gap-1 text-m3-on-surface 2xl:flex">
              <Cpu className="h-3 w-3 text-m3-tertiary" />
              {device.manufacturer} {device.model}
            </span>
          </>
        )}

        <button className="flex items-center gap-1 text-m3-primary hover:text-m3-primary/80 transition-colors">
          <Terminal className="h-3 w-3" />
          <span>Console</span>
        </button>
      </div>
    </footer>
  );
};
