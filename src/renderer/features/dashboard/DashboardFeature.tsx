import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Smartphone,
  Battery,
  BatteryCharging,
  Cpu,
  HardDrive,
  Wifi,
  Usb,
  ShieldCheck,
  Radio,
  Thermometer,
  Layers,
  ArrowUpRight,
  MonitorPlay,
  FolderOpen,
  AppWindow,
  Terminal,
  Zap,
  Eye,
  EyeOff,
  Settings,
  AlertCircle,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';

// ─── Helper: display unknown when value is absent ──────────────────────────
const val = (v: any, format?: (x: any) => string): string => {
  if (v === undefined || v === null || v === '' || v === 'N/A') return 'Unknown';
  return format ? format(v) : String(v);
};

// ─── Connection badge helper ───────────────────────────────────────────────
function ConnectionBadge({ device }: { device: any }) {
  if (!device) {
    return <Badge variant="neutral" className="font-mono text-[10px]">Not Connected</Badge>;
  }
  const status = device.status || '';
  if (status === 'unauthorized') {
    return <Badge variant="warning" className="font-mono text-[10px]">Unauthorized</Badge>;
  }
  if (status === 'offline') {
    return <Badge variant="neutral" className="font-mono text-[10px]">Offline</Badge>;
  }
  const ct = device.connectionType;
  if (ct === 'wireless') {
    return (
      <Badge variant="primary" className="font-mono text-[10px]">
        <Wifi className="h-3 w-3 inline mr-1" />Wireless
      </Badge>
    );
  }
  if (ct === 'usb') {
    return (
      <Badge variant="neutral" className="font-mono text-[10px]">
        <Usb className="h-3 w-3 inline mr-1" />USB
      </Badge>
    );
  }
  // device exists but connectionType unknown
  return <Badge variant="neutral" className="font-mono text-[10px]">Unknown</Badge>;
}

// ─── Redacted text component ───────────────────────────────────────────────
function RevealField({
  value,
  visible,
  onToggle,
  className = '',
}: {
  value: string | undefined | null;
  visible: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const display =
    !value || value === 'Unknown'
      ? 'Unknown'
      : visible
      ? value
      : '••••••••••••';

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono">{display}</span>
      {value && value !== 'Unknown' && (
        <button
          onClick={onToggle}
          className="text-m3-on-surface-variant/60 hover:text-m3-primary transition-colors"
          title={visible ? 'Hide' : 'Reveal'}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}

// ─── Progress bar that shows "Unknown" when data absent ───────────────────
function MetricBar({
  value,
  color = 'bg-m3-primary',
}: {
  value: number | undefined | null;
  color?: string;
}) {
  if (value === undefined || value === null) {
    return (
      <div className="w-full bg-m3-surface-4 h-2 rounded-full overflow-hidden flex items-center px-2">
        <span className="text-[9px] text-m3-on-surface-variant/50 font-mono">no data</span>
      </div>
    );
  }
  return (
    <div className="w-full bg-m3-surface-4 h-2 rounded-full overflow-hidden">
      <div
        className={`${color} h-full rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ─── Metric value badge ────────────────────────────────────────────────────
function MetricValue({
  value,
  unit = '',
  colorClass = 'text-m3-primary',
}: {
  value: number | string | undefined | null;
  unit?: string;
  colorClass?: string;
}) {
  if (value === undefined || value === null || value === '') {
    return <span className="font-mono text-m3-on-surface-variant/60 font-medium text-xs">Unknown</span>;
  }
  return (
    <span className={`font-mono font-bold text-xs ${colorClass}`}>
      {value}{unit}
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export const DashboardFeature: React.FC = () => {
  const navigate = useNavigate();
  const { getSelectedDevice, devices } = useDeviceStore();
  const device = getSelectedDevice();

  // Per-session privacy visibility state
  const [serialVisible, setSerialVisible] = useState(false);
  const [ipVisible, setIpVisible] = useState(false);

  const hasDevice = !!device;
  const isOnline = device?.status === 'online';

  // ── Empty state: no devices connected at all ──────────────────────────────
  if (!hasDevice && devices.length === 0) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-8">
        <PageHeader
          title="Device Control Dashboard"
          subtitle="Real-time hardware telemetry, system metrics, and automatic ADB device telemetry updates"
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="tonal"
                size="sm"
                icon={<MonitorPlay className="h-4 w-4" />}
                onClick={() => navigate('/screen')}
              >
                Launch Mirror
              </Button>
              <Button
                variant="filled"
                size="sm"
                icon={<Smartphone className="h-4 w-4" />}
                onClick={() => navigate('/devices')}
              >
                Manage Devices
              </Button>
            </div>
          }
        />

        {/* Empty State */}
        <Card
          variant="surface-2"
          className="flex flex-col items-center justify-center py-20 border-m3-surface-4 text-center space-y-5"
        >
          <div className="h-20 w-20 rounded-full bg-m3-surface-3 flex items-center justify-center border border-m3-surface-4">
            <Smartphone className="h-9 w-9 text-m3-on-surface-variant/40" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-bold text-m3-on-surface">No Android Device Connected</h3>
            <p className="text-xs text-m3-on-surface-variant max-w-xs mx-auto">
              Connect a device via USB cable or Wireless ADB, then open Manage Devices to get started.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="filled"
              size="sm"
              icon={<Smartphone className="h-4 w-4" />}
              onClick={() => navigate('/devices')}
            >
              Manage Devices
            </Button>
            <Button
              variant="outlined"
              size="sm"
              icon={<Settings className="h-4 w-4" />}
              onClick={() => navigate('/settings')}
            >
              Setup Wizard
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="Device Control Dashboard"
        subtitle="Real-time hardware telemetry, system metrics, and automatic ADB device telemetry updates"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="tonal"
              size="sm"
              icon={<MonitorPlay className="h-4 w-4" />}
              onClick={() => navigate('/screen')}
            >
              Launch Mirror
            </Button>
            <Button
              variant="filled"
              size="sm"
              icon={<Smartphone className="h-4 w-4" />}
              onClick={() => navigate('/devices')}
            >
              Manage Devices
            </Button>
          </div>
        }
      />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Device Card */}
        <Card
          variant="surface-2"
          className="lg:col-span-4 p-6 flex flex-col items-center justify-between border-m3-surface-4 relative overflow-hidden bg-gradient-to-b from-m3-surface-2 to-m3-surface-1 shadow-m3-2"
        >
          <div className="absolute -top-12 -left-12 w-48 h-48 bg-m3-primary/10 rounded-full blur-3xl pointer-events-none" />

          {/* Status & Connection badges */}
          <div className="w-full flex items-center justify-between mb-4 z-10">
            <Badge
              variant={isOnline ? 'success' : device?.status === 'unauthorized' ? 'warning' : 'neutral'}
              dot
            >
              {device?.status?.toUpperCase() || 'NO TARGET'}
            </Badge>
            <ConnectionBadge device={device} />
          </div>

          {/* Phone mockup or placeholder */}
          {hasDevice ? (
            <div className="relative border-[6px] border-m3-surface-5 rounded-[40px] p-2 bg-m3-surface-0 shadow-m3-3 my-2 w-56 h-[380px] flex flex-col justify-between overflow-hidden group transition-all duration-300 hover:scale-[1.02] border-m3-outline-variant/40">
              {/* Notch */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-16 h-3 bg-m3-surface-5 rounded-full z-20 flex items-center justify-center">
                <div className="h-1.5 w-1.5 rounded-full bg-black/60" />
              </div>

              {/* Simulated AMOLED screen */}
              <div className="w-full h-full bg-gradient-to-b from-[#111625] via-[#161B2E] to-[#0D101C] rounded-[32px] p-4 flex flex-col justify-between text-center relative overflow-hidden">
                {/* Status bar */}
                <div className="flex justify-between items-center text-[10px] text-m3-on-surface-variant font-mono pt-1">
                  <span>──</span>
                  <div className="flex items-center gap-1">
                    {device?.batteryLevel !== undefined && device?.batteryLevel !== null ? (
                      <span>{device.batteryLevel}%</span>
                    ) : (
                      <span className="opacity-40">–%</span>
                    )}
                  </div>
                </div>

                {/* Center content */}
                <div className="my-auto space-y-2 py-4">
                  <div className="p-3 bg-m3-primary-container/30 text-m3-primary rounded-full w-14 h-14 mx-auto flex items-center justify-center shadow-m3-1 animate-pulse">
                    <Zap className="h-7 w-7 text-m3-primary" />
                  </div>
                  <h4 className="text-sm font-bold text-m3-on-surface leading-tight px-1">
                    {device?.deviceName || device?.name || 'Android Device'}
                  </h4>
                  <p className="text-[11px] text-m3-primary font-mono font-semibold">
                    {device?.manufacturer} {device?.model}
                  </p>
                  <p className="text-[10px] text-m3-on-surface-variant font-mono">
                    {device?.androidVersion || 'Android Version Unknown'}
                  </p>
                </div>

                {/* Bottom nav pill */}
                <div className="pb-1 flex justify-center">
                  <div className="h-1 w-16 bg-m3-on-surface-variant/40 rounded-full" />
                </div>
              </div>
            </div>
          ) : (
            /* No device selected placeholder */
            <div className="w-56 h-[380px] flex flex-col items-center justify-center text-center space-y-4 border-2 border-dashed border-m3-surface-4 rounded-[40px] my-2">
              <Smartphone className="h-12 w-12 text-m3-on-surface-variant/30" />
              <div className="space-y-1 px-4">
                <p className="text-sm font-bold text-m3-on-surface">Android Device</p>
                <p className="text-[11px] text-m3-on-surface-variant">No Target Device Selected</p>
                <p className="text-[10px] text-m3-on-surface-variant/70 mt-2">
                  Select a connected device from Manage Devices.
                </p>
              </div>
              <Button variant="tonal" size="sm" onClick={() => navigate('/devices')}>
                Manage Devices
              </Button>
            </div>
          )}

          {/* Serial & IP with privacy toggles */}
          <div className="w-full text-center mt-4 space-y-1.5 font-mono text-xs border-t border-m3-surface-4 pt-3">
            <div className="flex items-center justify-center gap-1 text-m3-on-surface-variant">
              <span className="text-[11px]">Serial:</span>
              <RevealField
                value={device?.serialNumber || (device as any)?.serial || null}
                visible={serialVisible}
                onToggle={() => setSerialVisible((v) => !v)}
                className="text-m3-primary text-[11px]"
              />
            </div>
            <div className="flex items-center justify-center gap-1 text-m3-on-surface-variant">
              <span className="text-[11px]">IP:</span>
              <RevealField
                value={device?.ipAddress || null}
                visible={ipVisible}
                onToggle={() => setIpVisible((v) => !v)}
                className="text-[11px]"
              />
            </div>
          </div>
        </Card>

        {/* Right Column: Metric Cards Grid */}
        <div className="lg:col-span-8 space-y-6">
          {/* Primary Hardware Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Battery Level */}
            <Card variant="surface-1" className="p-4 space-y-2 border-m3-surface-3 transition-all duration-200 hover:border-m3-success/40">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <Battery className="h-4 w-4 text-m3-success" /> Battery Level
                </span>
                <MetricValue
                  value={device?.batteryLevel ?? null}
                  unit="%"
                  colorClass="text-m3-success"
                />
              </div>
              <MetricBar value={device?.batteryLevel ?? null} color="bg-m3-success" />
              <p className="text-[11px] text-m3-on-surface-variant/80">
                Health:{' '}
                <strong className="text-m3-on-surface">
                  {val((device as any)?.batteryHealth)}
                </strong>
              </p>
            </Card>

            {/* Charging Status */}
            <Card variant="surface-1" className="p-4 space-y-2 border-m3-surface-3 transition-all duration-200 hover:border-m3-primary/40">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <BatteryCharging className="h-4 w-4 text-m3-primary" /> Charging
                </span>
                {device?.isCharging !== undefined ? (
                  <Badge variant={device.isCharging ? 'success' : 'neutral'}>
                    {device.isCharging ? 'CHARGING' : 'DISCHARGING'}
                  </Badge>
                ) : (
                  <Badge variant="neutral">Unknown</Badge>
                )}
              </div>
              <p className="text-sm font-bold text-m3-on-surface mt-1">
                {device?.chargingType
                  ? device.chargingType
                  : device?.isCharging !== undefined
                  ? device.isCharging
                    ? 'USB Data Port'
                    : 'Discharging on Battery'
                  : 'Unknown'}
              </p>
              <p className="text-[11px] text-m3-on-surface-variant/80">
                Power Source: {val(device?.connectionType, (v) => v === 'usb' ? 'USB Bus' : 'Wireless / Battery')}
              </p>
            </Card>

            {/* CPU Usage */}
            <Card variant="surface-1" className="p-4 space-y-2 border-m3-surface-3 transition-all duration-200 hover:border-m3-tertiary/40">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-m3-tertiary" /> CPU Usage
                </span>
                <MetricValue
                  value={device?.cpuUsage ?? null}
                  unit="%"
                  colorClass="text-m3-tertiary"
                />
              </div>
              <MetricBar value={device?.cpuUsage ?? null} color="bg-m3-tertiary" />
              <p className="text-[11px] text-m3-on-surface-variant/80 truncate">
                {device?.cpuCores ? `${device.cpuCores} Cores` : 'Cores: Unknown'}{' '}
                {device?.cpuModel ? `• ${device.cpuModel}` : ''}
              </p>
            </Card>

            {/* RAM Allocation */}
            <Card variant="surface-1" className="p-4 space-y-2 border-m3-surface-3 transition-all duration-200 hover:border-m3-secondary/40">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-m3-secondary" /> RAM
                </span>
                <MetricValue
                  value={device?.ramPercent ?? null}
                  unit="%"
                  colorClass="text-m3-secondary"
                />
              </div>
              <MetricBar value={device?.ramPercent ?? null} color="bg-m3-secondary" />
              <p className="text-[11px] text-m3-on-surface-variant/80">
                Used:{' '}
                <strong className="text-m3-on-surface">
                  {device?.ramUsedGB ?? 'Unknown'}
                </strong>{' '}
                / {device?.ramTotalGB ?? 'Unknown'}
              </p>
            </Card>

            {/* Internal Storage */}
            <Card variant="surface-1" className="p-4 space-y-2 border-m3-surface-3 transition-all duration-200 hover:border-m3-primary/40">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-m3-primary" /> Storage
                </span>
                <MetricValue
                  value={device?.storageUsedPercent ?? null}
                  unit="%"
                  colorClass="text-m3-primary"
                />
              </div>
              <MetricBar value={device?.storageUsedPercent ?? null} color="bg-m3-primary" />
              <p className="text-[11px] text-m3-on-surface-variant/80">
                Free:{' '}
                <strong className="text-m3-on-surface">
                  {device?.storageFree ?? 'Unknown'}
                </strong>{' '}
                of {device?.storageTotal ?? 'Unknown'}
              </p>
            </Card>

            {/* Thermal */}
            <Card variant="surface-1" className="p-4 space-y-2 border-m3-surface-3 transition-all duration-200 hover:border-m3-warning/40">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <Thermometer className="h-4 w-4 text-m3-warning" /> Thermal
                </span>
                <MetricValue
                  value={device?.temperature ?? null}
                  unit=" °C"
                  colorClass="text-m3-warning"
                />
              </div>
              <p className="text-sm font-bold text-m3-on-surface mt-1">
                {device?.thermalStatus ?? 'Unknown'}
              </p>
              <p className="text-[11px] text-m3-on-surface-variant/80">
                Safe Operating Limit: &lt; 45 °C
              </p>
            </Card>
          </div>

          {/* Secondary Connectivity & System Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Network */}
            <Card variant="surface-2" className="p-4 space-y-2 border-m3-surface-4">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  {device?.networkType === 'cellular' ? (
                    <Radio className="h-4 w-4 text-m3-primary animate-pulse" />
                  ) : (
                    <Wifi className="h-4 w-4 text-m3-primary" />
                  )}
                  {device?.networkType === 'cellular' ? 'Mobile Data' : 'Wi-Fi Connection'}
                </span>
                {device?.networkType === 'cellular' ? (
                  <Badge variant="primary">
                    {device?.cellularGeneration || 'LTE'}
                  </Badge>
                ) : (
                  <MetricValue
                    value={device?.networkRssi ?? null}
                    unit=" dBm"
                    colorClass="text-m3-primary"
                  />
                )}
              </div>
              <p className="text-sm font-bold text-m3-on-surface">
                {device?.networkType === 'cellular'
                  ? device?.carrierName || 'Cellular Operator'
                  : device?.networkSsid || 'Unknown SSID'}
              </p>
              <p className="text-[11px] text-m3-on-surface-variant/80">
                {device?.networkType === 'cellular' ? (
                  <span>
                    Operator: <strong className="text-m3-on-surface">{device?.carrierName || 'Unknown'}</strong>
                  </span>
                ) : (
                  <span>
                    Signal Quality:{' '}
                    <strong className={device?.networkRssi ? 'text-m3-success' : 'text-m3-on-surface-variant'}>
                      {device?.networkRssi
                        ? device.networkRssi > -60
                          ? 'Excellent'
                          : device.networkRssi > -75
                          ? 'Good'
                          : 'Weak'
                        : 'Unknown'}
                    </strong>
                  </span>
                )}
              </p>
            </Card>

            {/* IP Address — hidden by default */}
            <Card variant="surface-2" className="p-4 space-y-2 border-m3-surface-4">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <Radio className="h-4 w-4 text-m3-secondary" /> IP Address
                </span>
                <Badge variant="secondary">IPv4</Badge>
              </div>
              <div className="text-sm font-bold text-m3-on-surface">
                <RevealField
                  value={device?.ipAddress || null}
                  visible={ipVisible}
                  onToggle={() => setIpVisible((v) => !v)}
                />
              </div>
              <p className="text-[11px] text-m3-on-surface-variant/80">
                TCP/IP Port:{' '}
                <span className="font-mono text-m3-primary">
                  {device?.port || (device?.serialNumber?.includes(':') ? device.serialNumber.split(':')[1] : (device?.serial?.includes(':') ? device.serial.split(':')[1] : '5555'))}
                </span>
              </p>
            </Card>

            {/* ADB Status */}
            <Card variant="surface-2" className="p-4 space-y-2 border-m3-surface-4">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-m3-success" /> ADB Status
                </span>
                <Badge variant={isOnline ? 'success' : 'neutral'} dot>
                  {isOnline ? 'ACTIVE' : device?.status?.toUpperCase() ?? 'UNKNOWN'}
                </Badge>
              </div>
              <p className="text-sm font-bold text-m3-on-surface">
                {device?.adbStatus ?? (isOnline ? 'Active Connected' : 'Not Connected')}
              </p>
              <p className="text-[11px] text-m3-on-surface-variant/80">
                Transport:{' '}
                {device?.connectionType
                  ? `${device.connectionType.toUpperCase()} (${device?.port || (device?.serialNumber?.includes(':') ? device.serialNumber.split(':')[1] : (device?.serial?.includes(':') ? device.serial.split(':')[1] : '5555'))})`
                  : 'Unknown'}
              </p>
            </Card>

            {/* Wireless Debugging — spans 2 cols */}
            <Card variant="surface-2" className="p-4 space-y-2 border-m3-surface-4 col-span-1 sm:col-span-2 lg:col-span-3">
              <div className="flex items-center justify-between text-xs text-m3-on-surface-variant">
                <span className="font-semibold flex items-center gap-1.5">
                  <Wifi className="h-4 w-4 text-m3-primary" /> Wireless Debugging (ADB TCP/IP)
                </span>
                <Badge variant={device?.wirelessDebugging !== false && isOnline ? 'success' : 'neutral'}>
                  {device?.wirelessDebugging !== false && isOnline ? 'ENABLED' : 'DISABLED'}
                </Badge>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div>
                  <p className="text-sm font-bold text-m3-on-surface">
                    {device?.ipAddress
                      ? (
                        <span>
                          Listening on{' '}
                          <span className="font-mono">
                            {ipVisible ? device.ipAddress : '••••••••••••'}
                          </span>
                          :{device?.port || (device?.serialNumber?.includes(':') ? device.serialNumber.split(':')[1] : (device?.serial?.includes(':') ? device.serial.split(':')[1] : '5555'))}
                          <button
                            onClick={() => setIpVisible((v) => !v)}
                            className="ml-1.5 text-m3-on-surface-variant/60 hover:text-m3-primary transition-colors"
                          >
                            {ipVisible ? <EyeOff className="h-3.5 w-3.5 inline" /> : <Eye className="h-3.5 w-3.5 inline" />}
                          </button>
                        </span>
                      )
                      : <span className="text-m3-on-surface-variant/60">No IP Address Available</span>
                    }
                  </p>
                  <p className="text-[11px] text-m3-on-surface-variant/80">
                    Automatic background discovery &amp; trusted reconnect active
                  </p>
                </div>
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => navigate('/devices')}
                >
                  Pairing Settings
                </Button>
              </div>
            </Card>
          </div>

          {/* No-device-selected warning when devices list is non-empty but none selected */}
          {!hasDevice && devices.length > 0 && (
            <Card variant="surface-2" className="p-4 border border-m3-warning/40 bg-m3-warning-container/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-m3-warning shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-m3-on-surface">No target device selected</p>
                <p className="text-[11px] text-m3-on-surface-variant">
                  {devices.length} device{devices.length > 1 ? 's' : ''} available — select one to view live telemetry.
                </p>
              </div>
              <Button variant="tonal" size="sm" onClick={() => navigate('/devices')}>
                Select Device
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div>
        <h3 className="text-xs font-semibold text-m3-on-surface-variant uppercase tracking-wider mb-3">
          Quick Access Modules
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card
            variant="surface-2"
            interactive
            onClick={() => navigate('/screen')}
            className="group flex flex-col justify-between h-28"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 rounded-m3-md bg-m3-primary-container/40 text-m3-primary">
                <MonitorPlay className="h-5 w-5" />
              </div>
              <ArrowUpRight className="h-4 w-4 text-m3-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-m3-on-surface">Screen Mirroring</h4>
              <p className="text-[11px] text-m3-on-surface-variant">Low latency Scrcpy video stream</p>
            </div>
          </Card>

          <Card
            variant="surface-2"
            interactive
            onClick={() => navigate('/files')}
            className="group flex flex-col justify-between h-28"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 rounded-m3-md bg-m3-secondary-container/40 text-m3-secondary">
                <FolderOpen className="h-5 w-5" />
              </div>
              <ArrowUpRight className="h-4 w-4 text-m3-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-m3-on-surface">File Explorer</h4>
              <p className="text-[11px] text-m3-on-surface-variant">Push &amp; pull device storage files</p>
            </div>
          </Card>

          <Card
            variant="surface-2"
            interactive
            onClick={() => navigate('/apps')}
            className="group flex flex-col justify-between h-28"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 rounded-m3-md bg-m3-tertiary-container/40 text-m3-tertiary">
                <AppWindow className="h-5 w-5" />
              </div>
              <ArrowUpRight className="h-4 w-4 text-m3-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-m3-on-surface">App Manager</h4>
              <p className="text-[11px] text-m3-on-surface-variant">Installed packages &amp; drag APKs</p>
            </div>
          </Card>

          <Card
            variant="surface-2"
            interactive
            onClick={() => navigate('/developer')}
            className="group flex flex-col justify-between h-28"
          >
            <div className="flex items-start justify-between">
              <div className="p-2 rounded-m3-md bg-m3-surface-4 text-m3-primary">
                <Terminal className="h-5 w-5" />
              </div>
              <ArrowUpRight className="h-4 w-4 text-m3-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-m3-on-surface">Logcat &amp; Shell</h4>
              <p className="text-[11px] text-m3-on-surface-variant">Live logcat stream &amp; raw ADB shell</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
