import React, { useState } from 'react';
import {
  Smartphone,
  Wifi,
  Usb,
  Plus,
  RefreshCw,
  Power,
  QrCode,
  Battery,
  BatteryCharging,
  HardDrive,
  Trash2,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { AndroidDevice } from '../../types/device';
import { useAppStore } from '../../store/useAppStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { Input } from '../../components/common/Input';
import { Tooltip } from '../../components/common/Tooltip';
import { ipcService } from '../../services/ipcService';

export interface DeviceActionConfig {
  showConnect: boolean;
  showDisconnect: boolean;
  showForget: boolean;
}

export function resolveDeviceActions(device: AndroidDevice): DeviceActionConfig {
  const isOnline = device.status === 'online';

  return {
    showConnect: !isOnline,
    showDisconnect: isOnline,
    showForget: true,
  };
}

export const DevicesFeature: React.FC = () => {
  const { devices, selectedDeviceId, setSelectedDeviceId, setPreferredTransport, refreshDevices, reconnectAll, forgetDevice, isLoading, isAutoWirelessEnabled, autoWirelessMessage } = useDeviceStore();
  const { addToast } = useAppStore();

  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [deviceToForget, setDeviceToForget] = useState<AndroidDevice | null>(null);
  const [isForgetExecuting, setIsForgetExecuting] = useState(false);
  const [ipInput, setIpInput] = useState('192.168.1.');
  const [portInput, setPortInput] = useState('5555');
  const [pairingCode, setPairingCode] = useState('');

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(portInput, 10) || 5555;
    addToast('info', `Connecting to wireless device at ${ipInput}:${portNum}...`);
    try {
      const result = await ipcService.adb.connect(ipInput, portNum);
      if (result.success) {
        addToast('success', `Successfully connected to ${ipInput}:${portNum}`);
      } else {
        addToast('warning', result.message || 'Connection attempt completed');
      }
    } catch (err: any) {
      addToast('error', `Failed connecting: ${err.message}`);
    }
    setIsPairModalOpen(false);
  };

  const handleConfirmForget = async () => {
    if (!deviceToForget || isForgetExecuting) return;
    setIsForgetExecuting(true);
    const targetSerial = deviceToForget.hardwareSerial || (deviceToForget as any).serialNumber || deviceToForget.serial || deviceToForget.id;
    const targetName = deviceToForget.name || deviceToForget.deviceName || deviceToForget.model || targetSerial;

    console.log(`[UI] Confirming Forget for: ${targetSerial}`);
    try {
      const wasRemoved = await forgetDevice(targetSerial);
      if (wasRemoved) {
        addToast('info', `Removed ${targetName}`);
      }
    } catch (err: any) {
      addToast('error', `Failed deleting device: ${err.message}`);
    } finally {
      setIsForgetExecuting(false);
      setDeviceToForget(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Device Manager & Auto-Discovery"
        subtitle="Real-time USB & Wireless ADB discovery, remembered trusted targets, and full hardware telemetry"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="filled"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setIsPairModalOpen(true)}
            >
              Pair Wireless Target
            </Button>
            <Button
              variant="tonal"
              size="sm"
              icon={<Wifi className="h-4 w-4" />}
              onClick={() => {
                reconnectAll();
                addToast('info', isAutoWirelessEnabled ? 'Reconnecting remembered wireless devices...' : 'Automatic Wireless Reconnect is currently disabled. Running manual reconnect...');
              }}
            >
              Reconnect Wireless
            </Button>
            <Button
              variant="outlined"
              size="sm"
              icon={<RefreshCw className="h-4 w-4" />}
              isLoading={isLoading}
              onClick={refreshDevices}
            >
              Rescan Bus
            </Button>
          </div>
        }
      />

      {!isAutoWirelessEnabled && (
        <div className="flex items-center gap-2 p-3 text-xs rounded-m3-md bg-m3-surface-3 border border-m3-surface-4 text-m3-on-surface-variant font-medium my-1">
          <Info className="h-4 w-4 text-m3-warning shrink-0" />
          <span>{autoWirelessMessage || 'Automatic Wireless Reconnect is currently disabled.'}</span>
        </div>
      )}

      {/* Target Devices Grid */}
      {devices.length === 0 ? (
        <Card variant="surface-2" className="p-8 text-center border border-dashed border-m3-outline-variant my-4">
          <Smartphone className="h-12 w-12 mx-auto text-m3-on-surface-variant/40 mb-3" />
          <h3 className="text-base font-medium text-m3-on-surface">No Connected or Remembered Devices Found</h3>
          <p className="text-xs text-m3-on-surface-variant mt-1 max-w-md mx-auto">
            Connect an Android device via USB with USB Debugging enabled, or pair a wireless ADB target.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {devices.map((device) => {
            const isSelected = device.id === selectedDeviceId;
            const isOnline = device.status === 'online';
            const availableTransports = device.availableTransports || [
              {
                type: device.connectionType,
                serial: device.serialNumber || device.serial,
                status: device.status,
                ipAddress: device.ipAddress,
                port: device.port,
              },
            ];
            const actions = resolveDeviceActions(device);

            return (
              <Card
                key={device.id || device.serial}
                variant={isSelected ? 'surface-3' : 'surface-2'}
                className={`relative overflow-hidden transition-all duration-200 border ${
                  isSelected ? 'border-m3-primary shadow-m3-2 ring-1 ring-m3-primary/50' : 'border-m3-surface-4'
                }`}
              >
                {/* Header Info */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-m3-md bg-m3-surface-4 text-m3-primary shrink-0">
                      <Smartphone className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-m3-on-surface leading-snug">
                        {device.name || device.deviceName || device.model}
                      </h3>
                      <p className="text-xs text-m3-on-surface-variant">
                        {device.manufacturer} • {device.model}
                      </p>
                    </div>
                  </div>
                  <Badge variant={isOnline ? 'success' : 'neutral'} dot>
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                  </Badge>
                </div>

                {/* Specs List */}
                <div className="space-y-1.5 text-xs text-m3-on-surface-variant py-2 border-t border-b border-m3-surface-4/40 mb-3">
                  <div className="flex justify-between">
                    <span>Manufacturer:</span>
                    <span className="text-m3-on-surface font-medium">{device.manufacturer || 'Android'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Model:</span>
                    <span className="text-m3-on-surface font-medium">{device.model || 'Generic Device'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Android Version:</span>
                    <span className="text-m3-on-surface font-medium">
                      Android {device.androidVersion || '14'} (API {(device as any).apiLevel || '34'})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Hardware Serial:</span>
                    <span className="font-mono text-m3-on-surface font-medium">
                      {device.hardwareSerial || device.serial}
                    </span>
                  </div>

                  {/* Multi-transport Available Selector */}
                  <div className="pt-2">
                    <span className="text-[11px] font-semibold text-m3-on-surface-variant">Available Transports:</span>
                    <div className="mt-1 space-y-1">
                      {availableTransports.map((t) => (
                        <div
                          key={t.type + t.serial}
                          className="flex items-center justify-between p-1.5 rounded-m3-sm bg-m3-surface-3 border border-m3-surface-4/60 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5">
                            {t.type === 'usb' ? (
                              <Usb className="h-3 w-3 text-m3-primary" />
                            ) : (
                              <Wifi className="h-3 w-3 text-m3-tertiary" />
                            )}
                            {device.preferredTransport === t.type && (
                              <span className="text-m3-primary font-bold text-xs">✓</span>
                            )}
                            <span className="capitalize font-medium text-m3-on-surface">{t.type}</span>
                            <span className="font-mono text-m3-on-surface-variant">({t.serial})</span>
                          </div>
                          <span
                            className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                              t.status === 'online'
                                ? 'bg-m3-primary-container text-m3-on-primary-container'
                                : 'bg-m3-surface-4 text-m3-on-surface-variant'
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Transport Preference Switcher / Display */}
                  <div className="flex items-center justify-between pt-2 border-t border-m3-surface-4/40">
                    <span className="text-[11px] font-medium text-m3-on-surface-variant">Preferred transport:</span>
                    <div
                      className="inline-flex rounded-m3-sm p-0.5 bg-m3-surface-3 border border-m3-surface-4 shadow-inner"
                      role="group"
                      aria-label="Preferred transport selector"
                    >
                      {availableTransports.some((t) => t.type === 'usb') && (
                        <button
                          type="button"
                          onClick={() => setPreferredTransport(device.id, 'usb')}
                          aria-pressed={device.preferredTransport === 'usb'}
                          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-m3-xs transition-all duration-150 cursor-pointer ${
                            device.preferredTransport === 'usb'
                              ? 'bg-m3-primary text-m3-on-primary shadow-sm font-bold ring-1 ring-m3-primary/60'
                              : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-4/50'
                          }`}
                        >
                          <Usb className="h-3.5 w-3.5" />
                          <span>USB</span>
                        </button>
                      )}
                      {availableTransports.some((t) => t.type === 'wireless') && (
                        <button
                          type="button"
                          onClick={() => setPreferredTransport(device.id, 'wireless')}
                          aria-pressed={device.preferredTransport === 'wireless'}
                          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-m3-xs transition-all duration-150 cursor-pointer ${
                            device.preferredTransport === 'wireless'
                              ? 'bg-m3-primary text-m3-on-primary shadow-sm font-bold ring-1 ring-m3-primary/60'
                              : 'text-m3-on-surface-variant hover:text-m3-on-surface hover:bg-m3-surface-4/50'
                          }`}
                        >
                          <Wifi className="h-3.5 w-3.5" />
                          <span>Wireless</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Battery & Storage */}
                  <div className="flex justify-between pt-1">
                    <span>Battery Status:</span>
                    <span className="text-m3-on-surface flex items-center gap-1">
                      {device.isCharging ? (
                        <BatteryCharging className="h-3 w-3 text-m3-primary inline" />
                      ) : (
                        <Battery className="h-3 w-3 text-m3-tertiary inline" />
                      )}
                      {device.batteryLevel ?? 100}% ({device.isCharging ? 'Charging' : 'Discharging'})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Storage Free:</span>
                    <span className="text-m3-on-surface flex items-center gap-1">
                      <HardDrive className="h-3 w-3 text-m3-primary inline" />
                      {device.storageFree || '64GB'} free / {device.storageTotal || '128GB'}
                    </span>
                  </div>
                </div>

                {/* Card Action Controls */}
                <div className="flex items-center justify-between pt-1">
                  <Button
                    variant={isSelected ? 'filled' : 'tonal'}
                    size="sm"
                    disabled={!isOnline}
                    onClick={() => {
                      setSelectedDeviceId(device.id);
                      addToast('info', `Active target set to ${device.name || device.model}`);
                    }}
                  >
                    {isSelected ? 'Active Target' : 'Select Device'}
                  </Button>

                  <div className="flex items-center gap-1">
                    {actions.showConnect && (
                      <Tooltip content="Connect / Activate device" position="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<RefreshCw className="h-3.5 w-3.5 text-m3-primary" />}
                          onClick={async () => {
                            console.log(`[UI] Connect clicked: ${device.serial}`);
                            const targetIp = device.ipAddress || (device.serial?.includes(':') ? device.serial.split(':')[0] : undefined);
                            const targetPort = device.port || (device.serial?.includes(':') ? parseInt(device.serial.split(':')[1] || '5555', 10) : 5555);

                            if (targetIp && targetPort) {
                              addToast('info', `Connecting to ${device.name || device.model} (${targetIp}:${targetPort})...`);
                              await ipcService.adb.connect(targetIp, targetPort);
                            } else {
                              addToast('info', `Connecting ${device.name || device.serial}...`);
                            }
                            await ipcService.invoke('device:rescan');
                          }}
                        >
                          Connect
                        </Button>
                      </Tooltip>
                    )}
                    {actions.showDisconnect && (
                      <Tooltip content="Disconnect from application" position="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Power className="h-3.5 w-3.5 text-m3-warning" />}
                          onClick={async () => {
                            const targetSerial = device.hardwareSerial || (device as any).serialNumber || device.serial || device.id;
                            console.log(`[UI] Disconnect clicked for: ${targetSerial}`);
                            await ipcService.adb.disconnect(targetSerial);
                            addToast('warning', `Disconnected ${device.name || device.model}`);
                          }}
                        >
                          Disconnect
                        </Button>
                      </Tooltip>
                    )}
                    {actions.showForget && (
                      <Tooltip content="Delete / Remove Device" position="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 className="h-3.5 w-3.5 text-m3-error" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            console.log(`[UI] Open Forget Confirmation for: ${device.serial || device.hardwareSerial || device.id}`);
                            setDeviceToForget(device);
                          }}
                        >
                          Delete
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Forget Device Confirmation Modal */}
      <Modal
        isOpen={Boolean(deviceToForget)}
        onClose={() => setDeviceToForget(null)}
        title="Forget this device?"
        maxWidth="md"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={isForgetExecuting}
              onClick={() => setDeviceToForget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isForgetExecuting}
              onClick={handleConfirmForget}
            >
              Forget Device
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-xs text-m3-on-surface-variant">
          <p className="leading-relaxed">
            This will remove{' '}
            <strong className="text-m3-on-surface font-semibold">
              {deviceToForget?.name || deviceToForget?.deviceName || deviceToForget?.model || deviceToForget?.serial}
            </strong>{' '}
            from remembered devices and clear its connection/trust information from this computer.
          </p>

          {deviceToForget?.connectionType === 'wireless' && (
            <p className="text-m3-warning font-medium">
              The current wireless ADB connection will be disconnected. You will need to pair/connect this device again.
            </p>
          )}

          <div className="p-3.5 rounded-m3-md bg-m3-surface-3 border border-m3-surface-4 space-y-2">
            <div className="flex items-center gap-1.5 text-m3-on-surface font-semibold">
              <AlertTriangle className="h-4 w-4 text-m3-warning shrink-0" />
              <span>For complete re-authorization, revoke USB debugging authorizations on your phone:</span>
            </div>
            <div className="font-mono text-[11px] bg-m3-surface-1 p-2 rounded border border-m3-surface-4 text-m3-primary">
              Developer Options → Revoke USB debugging authorizations
            </div>
            <p className="text-[11px] text-m3-on-surface-variant/80">
              After reconnecting, Android will ask you to authorize this computer again.
            </p>
          </div>
        </div>
      </Modal>

      {/* Wireless Pairing Modal */}
      <Modal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        title="Pair Device Wirelessly (ADB TCP/IP)"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsPairModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="filled" size="sm" onClick={handlePairSubmit}>
              Connect Target
            </Button>
          </>
        }
      >
        <form onSubmit={handlePairSubmit} className="space-y-4">
          <p className="text-xs text-m3-on-surface-variant">
            Enable Wireless Debugging in Developer Options on your device. Once paired, the application will remember and automatically reconnect to this device on launch without user configuration.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Input
                label="Device IP Address"
                value={ipInput}
                onChange={(e) => setIpInput(e.target.value)}
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <Input
                label="Port"
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                placeholder="5555"
              />
            </div>
          </div>
          <Input
            label="Pairing Code (Optional)"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
            placeholder="6-digit pairing code"
            icon={<QrCode className="h-4 w-4" />}
          />
        </form>
      </Modal>
    </div>
  );
};
