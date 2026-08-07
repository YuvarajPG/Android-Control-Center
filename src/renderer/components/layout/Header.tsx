import React, { useState } from 'react';
import {
  Smartphone,
  Wifi,
  Usb,
  Battery,
  BatteryCharging,
  RefreshCw,
  AlertCircle,
  Wand2,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { SetupWizardModal } from '../../features/setup/SetupWizardModal';


export const Header: React.FC = () => {
  const { getSelectedDevice, isLoading, refreshDevices } = useDeviceStore();
  const { addToast } = useAppStore();

  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);

  const selectedDevice = getSelectedDevice();

  const handleRefresh = async () => {
    addToast('info', 'Scanning ADB bus for devices...');
    await refreshDevices();
  };

  return (
    <>
      <header className="flex h-16 min-w-0 items-center justify-end gap-3 border-b border-m3-surface-3 bg-m3-surface-1 px-4 shadow-m3-1 select-none sm:px-6">
        {/* Selected Target Device Status Indicator */}
        <div className="flex shrink-0 items-center gap-2">


          <Button
            variant="outlined"
            size="sm"
            icon={<Wand2 className="h-4 w-4 text-m3-primary" />}
            onClick={() => setIsWizardOpen(true)}
            title="Launch Setup Wizard"
          >
            <span className="hidden 2xl:inline">Setup Wizard</span>
          </Button>

          {selectedDevice ? (
            <div className="hidden 2xl:flex items-center gap-3 bg-m3-surface-2 border border-m3-surface-4 rounded-m3-md px-3.5 py-1.5 shadow-inner">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-m3-primary shrink-0" />
                <div className="text-left">
                  <div className="text-xs font-bold text-m3-on-surface leading-tight">
                    {selectedDevice.deviceName || selectedDevice.name || 'Android Device'}
                  </div>
                  <div className="text-[10px] text-m3-on-surface-variant font-mono">
                    {selectedDevice.serialNumber || selectedDevice.serial}
                  </div>
                </div>
              </div>

              {/* Connection Type Badge */}
              <Badge
                variant={selectedDevice.connectionType === 'wireless' ? 'primary' : 'success'}
                size="sm"
                className="font-mono"
              >
                {selectedDevice.connectionType === 'wireless' ? (
                  <>
                    <Wifi className="h-3 w-3 inline mr-1" />
                    WIFI
                  </>
                ) : (
                  <>
                    <Usb className="h-3 w-3 inline mr-1" />
                    USB
                  </>
                )}
              </Badge>

              {/* Battery Indicator */}
              {selectedDevice.batteryLevel !== undefined && (
                <div className="flex items-center gap-1 text-xs font-mono font-semibold text-m3-on-surface-variant pl-2 border-l border-m3-surface-4">
                  {selectedDevice.isCharging ? (
                    <BatteryCharging className="h-3.5 w-3.5 text-m3-success" />
                  ) : (
                    <Battery className="h-3.5 w-3.5 text-m3-primary" />
                  )}
                  <span>{selectedDevice.batteryLevel}%</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-m3-surface-2 border border-m3-surface-4 rounded-m3-md px-3 py-1.5 text-xs text-m3-on-surface-variant font-medium">
              <AlertCircle className="h-4 w-4 text-m3-warning" />
              <span>No Device Selected</span>
            </div>
          )}

          {/* Quick Refresh ADB Bus Button */}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-m3-primary' : ''}`} />}
            onClick={handleRefresh}
            isLoading={isLoading}
            title="Rescan ADB Bus"
          />
        </div>
      </header>

      {/* First-Run Setup Wizard Modal */}
      <SetupWizardModal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </>
  );
};
