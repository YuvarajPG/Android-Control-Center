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
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { Input } from '../../components/common/Input';
import { ipcService } from '../../services/ipcService';

export const DevicesFeature: React.FC = () => {
  const { devices, selectedDeviceId, setSelectedDeviceId, setPreferredTransport, refreshDevices, reconnectAll, forgetDevice, isLoading, isAutoWirelessEnabled, autoWirelessMessage } = useDeviceStore();
  const { addToast } = useAppStore();

  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
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
        <Card variant="surface-2" className="p-8 text-center text-m3-on-surface-variant my-4">
          <Smartphone className="h-12 w-12 text-m3-primary/40 mx-auto mb-3 animate-pulse" />
          <h3 className="text-base font-bold text-m3-on-surface">Searching for Android Devices...</h3>
          <p className="text-xs text-m3-on-surface-variant max-w-md mx-auto mt-1">
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
                      <p className="text-xs text-m3-on-surface-variant font-mono">
                        {device.manufacturer} • {device.model}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      device.status === 'online'
                        ? 'success'
                        : device.status === 'unauthorized'
                          ? 'warning'
                          : 'neutral'
                    }
                    dot
                  >
                    {device.status.toUpperCase()}
                  </Badge>
                </div>

                {/* Device Specification Metadata Table */}
                <div className="space-y-2 py-3 text-xs border-t border-b border-m3-surface-4/60 my-3 font-mono">
                  <div className="flex justify-between text-m3-on-surface-variant">
                    <span>Manufacturer:</span>
                    <span className="text-m3-on-surface font-semibold">{device.manufacturer || 'Android'}</span>
                  </div>
                  <div className="flex justify-between text-m3-on-surface-variant">
                    <span>Model:</span>
                    <span className="text-m3-on-surface">{device.model}</span>
                  </div>
                  <div className="flex justify-between text-m3-on-surface-variant">
                    <span>Android Version:</span>
                    <span className="text-m3-on-surface">{device.androidVersion}</span>
                  </div>
                  <div className="flex justify-between text-m3-on-surface-variant">
                    <span>Hardware Serial:</span>
                    <span className="text-m3-on-surface">{device.hardwareSerial || device.serialNumber || device.serial}</span>
                  </div>

                  {/* Available Transports */}
                  <div className="pt-2 border-t border-m3-surface-4/40 space-y-1">
                    <span className="text-m3-on-surface-variant block font-sans font-semibold text-[11px]">
                      Available Transports:
                    </span>
                    {availableTransports.map((t) => (
                      <div key={t.type + t.serial} className="flex items-center justify-between pl-1">
                        <span className="flex items-center gap-1.5 text-m3-on-surface font-medium">
                          {t.type === 'usb' ? (
                            <Usb className="h-3.5 w-3.5 text-m3-primary" />
                          ) : (
                            <Wifi className="h-3.5 w-3.5 text-m3-secondary" />
                          )}
                          ✔ {t.type.toUpperCase()} ({t.serial})
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            t.status === 'online' ? 'bg-m3-success/20 text-m3-success' : 'bg-m3-surface-4 text-m3-on-surface-variant'
                          }`}
                        >
                          {t.status.toUpperCase()}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Preferred Transport Selector */}
                  <div className="flex items-center justify-between pt-2 border-t border-m3-surface-4/40">
                    <span className="text-m3-on-surface-variant font-sans font-semibold text-[11px]">Preferred transport:</span>
                    <div className="flex items-center gap-1 bg-m3-surface-4/80 p-0.5 rounded-m3-md">
                      {['usb', 'wireless'].map((tType) => {
                        const isPref = (device.preferredTransport || device.connectionType) === tType;
                        const hasTransport = availableTransports.some((t) => t.type === tType);
                        return (
                          <button
                            key={tType}
                            type="button"
                            disabled={!hasTransport}
                            onClick={() => {
                              setPreferredTransport(device.id, tType as 'usb' | 'wireless');
                              addToast('info', `Set preferred transport to ${tType.toUpperCase()} for ${device.name || device.model}`);
                            }}
                            className={`px-2 py-0.5 text-[10px] rounded font-bold capitalize transition-all ${
                              isPref
                                ? 'bg-m3-primary text-m3-on-primary shadow-sm'
                                : hasTransport
                                  ? 'text-m3-on-surface hover:bg-m3-surface-3'
                                  : 'text-m3-on-surface-variant/40 cursor-not-allowed'
                            }`}
                          >
                            {tType}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Battery & Storage */}
                  <div className="flex justify-between text-m3-on-surface-variant pt-2 border-t border-m3-surface-4/40">
                    <span>Battery Status:</span>
                    <span className="text-m3-on-surface flex items-center gap-1">
                      {device.isCharging ? (
                        <BatteryCharging className="h-3.5 w-3.5 text-m3-success inline" />
                      ) : (
                        <Battery className="h-3.5 w-3.5 text-m3-warning inline" />
                      )}
                      {device.batteryLevel}% {device.isCharging ? '(Charging)' : ''}
                    </span>
                  </div>
                  <div className="flex justify-between text-m3-on-surface-variant">
                    <span>Storage Free:</span>
                    <span className="text-m3-on-surface flex items-center gap-1">
                      <HardDrive className="h-3 w-3 text-m3-primary inline" />
                      {device.storageFree} free / {device.storageTotal}
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
                    {device.connectionType === 'wireless' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Power className="h-3.5 w-3.5 text-m3-warning" />}
                        onClick={async () => {
                          await ipcService.adb.disconnect(device.serial);
                          refreshDevices();
                          addToast('warning', `Disconnected ${device.serial}`);
                        }}
                      >
                        Disconnect
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5 text-m3-on-surface-variant hover:text-m3-error" />}
                      onClick={() => {
                        forgetDevice(device.serial);
                        addToast('info', `Removed ${device.name || device.serial} from remembered devices`);
                      }}
                      title="Forget Remembered Device"
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
