import React, { useState, useEffect, useCallback } from 'react';
import {
  RotateCw,
  Clipboard,
  Power,
  RefreshCw,
  Zap,
  ShieldCheck,
  ShieldAlert,
  Send,
  Copy,
  Trash2,
  Wifi,
  Usb,
  Battery,
  Smartphone,
} from 'lucide-react';
import { useDeviceStore } from '../../store/useDeviceStore';
import { useAppStore } from '../../store/useAppStore';
import { useRotationStore } from '../../store/useRotationStore';
import { useCapabilitiesStore } from '../../store/useCapabilitiesStore';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { BrightnessCardV2 } from '../../components/BrightnessCardV2/BrightnessCard';
import { MediaPlayer as MediaPlayerV2 } from '../../components/MediaPlayerV2/MediaPlayer';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { Tooltip } from '../../components/common/Tooltip';
import { ipcService } from '../../services/ipcService';

function formatAndroidVersion(versionStr?: string, apiLevel?: string | number): string {
  if (!versionStr) return `Android 13 (API ${apiLevel || '33'})`;
  const cleanVer = versionStr.replace(/^android\s*/i, '').replace(/\s*\(API.*?\)/i, '').trim();
  const api = apiLevel || (versionStr.match(/API\s*(\d+)/i)?.[1]) || '';
  return `Android ${cleanVer}${api ? ` (API ${api})` : ''}`;
}

export const DeviceControlFeature: React.FC = () => {
  const { getSelectedDevice } = useDeviceStore();
  const { addToast } = useAppStore();
  const { getCapabilities, fetchCapabilities } = useCapabilitiesStore();
  const device = getSelectedDevice();

  const [clipboardText, setClipboardText] = useState<string>('');
  const [lastClipboardUpdate, setLastClipboardUpdate] = useState<Date | null>(null);
  const [flashlightOn, setFlashlightOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const { getRotationState, isRotationLoading, fetchRotation, setRotation } = useRotationStore();

  // Wireless pairing modal state
  const [isPairModalOpen, setIsPairModalOpen] = useState<boolean>(false);
  const [ipInput, setIpInput] = useState<string>('192.168.1.');
  const [portInput, setPortInput] = useState<string>('5555');

  const { refreshDevices } = useDeviceStore();
  const isDeviceConnected = Boolean(device && device.status === 'online');

  const handleConnectDevice = async () => {
    addToast('info', 'Scanning for connected Android devices...');
    await refreshDevices();
  };

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = parseInt(portInput, 10) || 5555;
    addToast('info', `Connecting to wireless device at ${ipInput}:${portNum}...`);
    try {
      const result = await ipcService.adb.connect(ipInput, portNum);
      if (result.success) {
        addToast('success', `Successfully connected to ${ipInput}:${portNum}`);
        await refreshDevices();
      } else {
        addToast('warning', result.message || 'Connection attempt completed');
      }
    } catch (err: any) {
      addToast('error', `Failed connecting: ${err.message}`);
    }
    setIsPairModalOpen(false);
  };

  const getSerial = useCallback(
    () => device?.serialNumber || device?.serial || '',
    [device],
  );

  const serial = getSerial();
  const capabilities = getCapabilities(serial);
  const rotationState = getRotationState(serial);
  const rotationLoading = isRotationLoading(serial);

  // Fetch device capabilities
  const [isInputFocused, setIsInputFocused] = useState<boolean>(false);

  const loadCapabilities = useCallback(async () => {
    const s = getSerial();
    if (!s) return;
    setIsLoading(true);
    try {
      await fetchCapabilities(s);
      const caps = getCapabilities(s);
      setFlashlightOn(caps.flashlightActive);

      const clip = await ipcService.control.getClipboard(s);
      if (clip && clip.trim() && !isInputFocused) {
        setClipboardText(clip);
        setLastClipboardUpdate(new Date());
      }
    } catch (err: any) {
      addToast('error', `Failed reading capabilities: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [addToast, fetchCapabilities, getCapabilities, getSerial, isInputFocused]);

  // Fetch capabilities ONLY on connection/mount or manual refresh (NO continuous polling)
  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities]);

  // Rotation Sync & Polling: Fetch on mount and poll every 5s
  useEffect(() => {
    const s = getSerial();
    if (!s) return;

    fetchRotation(s);
    const rotationInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchRotation(s);
      }
    }, 5000);

    return () => clearInterval(rotationInterval);
  }, [getSerial, fetchRotation]);

  /**
   * Rotation: send command then update store
   */
  const handleRotate = async (autoRotate: boolean, degree: number = 0) => {
    const s = getSerial();
    if (!s) return;
    const res = await setRotation(s, autoRotate, degree);
    if (res.success) {
      addToast('success', res.message);
    } else {
      addToast('warning', res.message);
    }
  };

  // Clipboard Sync
  const handleSetClipboard = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!clipboardText.trim()) return;
    const serial = getSerial();
    const res = await ipcService.control.setClipboard(serial, clipboardText);
    if (res.success) {
      setClipboardText('');
      setLastClipboardUpdate(new Date());
      addToast('success', res.message || 'Text pushed to device successfully.');
    } else {
      addToast('warning', res.message || 'Failed to push text to device.');
    }
  };

  const handleCopyClipboard = async () => {
    if (!clipboardText) return;
    try {
      await navigator.clipboard.writeText(clipboardText);
      addToast('success', 'Copied text to local clipboard');
    } catch {
      addToast('error', 'Failed to copy to clipboard');
    }
  };

  const handleClearClipboard = () => {
    setClipboardText('');
    addToast('info', 'Cleared clipboard text input');
  };

  // Flashlight Toggle
  const handleFlashlightToggle = async () => {
    const serial = getSerial();
    const nextState = !flashlightOn;
    const res = await ipcService.control.flashlight(serial, nextState);
    if (res.success) {
      setFlashlightOn(nextState);
      addToast('success', res.message);
    } else {
      addToast('warning', res.message);
    }
  };

  // Restart SystemUI
  const handleRestartSystemUI = async () => {
    const serial = getSerial();
    const res = await ipcService.control.restartSystemUI(serial, capabilities.isRooted);
    if (res.success) addToast('success', res.message);
    else addToast('warning', res.message);
  };

  // Power Action Confirmation Dialog State
  type PowerActionType = 'reboot_system' | 'reboot_recovery' | 'reboot_bootloader' | 'power_off' | null;
  const [confirmAction, setConfirmAction] = useState<PowerActionType>(null);
  const [isExecutingPowerAction, setIsExecutingPowerAction] = useState<boolean>(false);

  const getPowerDialogConfig = (action: PowerActionType) => {
    switch (action) {
      case 'reboot_system':
        return {
          title: 'Reboot Device?',
          description: 'The connected Android device will restart immediately. Any unsaved work on the device may be lost.',
          confirmLabel: 'Reboot',
          isDestructive: false,
        };
      case 'reboot_recovery':
        return {
          title: 'Boot into Recovery?',
          description: 'The device will restart into Recovery mode. Continue?',
          confirmLabel: 'Recovery',
          isDestructive: false,
        };
      case 'reboot_bootloader':
        return {
          title: 'Enter Fastboot?',
          description: 'The device will reboot into Fastboot (Bootloader) mode. You must manually reboot the device to return to Android.',
          confirmLabel: 'Enter Fastboot',
          isDestructive: false,
        };
      case 'power_off':
        return {
          title: 'Power Off Device?',
          description: 'The connected Android device will power off immediately.',
          confirmLabel: 'Power Off',
          isDestructive: true,
        };
      default:
        return null;
    }
  };

  const handleConfirmPowerAction = async () => {
    if (!confirmAction || isExecutingPowerAction) return;
    const serial = getSerial();
    setIsExecutingPowerAction(true);

    try {
      if (confirmAction === 'reboot_system') {
        const res = await ipcService.control.reboot(serial, 'system');
        if (res.success) addToast('warning', res.message);
      } else if (confirmAction === 'reboot_recovery') {
        const res = await ipcService.control.reboot(serial, 'recovery');
        if (res.success) addToast('warning', res.message);
      } else if (confirmAction === 'reboot_bootloader') {
        const res = await ipcService.control.reboot(serial, 'bootloader');
        if (res.success) addToast('warning', res.message);
      } else if (confirmAction === 'power_off') {
        const res = await ipcService.control.powerOff(serial);
        if (res.success) addToast('warning', res.message);
      }
    } catch (err: any) {
      addToast('error', `Action failed: ${err.message}`);
    } finally {
      setIsExecutingPowerAction(false);
      setConfirmAction(null);
    }
  };

  const isWifiConnection = ((device as any)?.connectionType === 'wifi') || (device?.serialNumber?.includes(':') || device?.serial?.includes(':') || false);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-32 px-1">
      <PageHeader
        title="Hardware & Device Control"
        subtitle="Manage volume, screen brightness, rotation, media playback, clipboard, and system power actions"
        actions={
          <Button
            variant="outlined"
            size="sm"
            icon={<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-m3-primary' : ''}`} />}
            isLoading={isLoading}
            onClick={loadCapabilities}
          >
            Refresh Status
          </Button>
        }
      />

      {/* 1. Target Device Status Card OR Empty-State UI */}
      {!isDeviceConnected ? (
        <Card variant="surface-2" className="p-8 border border-m3-surface-4 shadow-m3-1 text-center space-y-4 max-w-xl mx-auto my-6">
          <div className="mx-auto w-14 h-14 rounded-full bg-m3-surface-3 flex items-center justify-center text-m3-on-surface-variant border border-m3-surface-4">
            <Smartphone className="h-7 w-7" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-m3-on-surface">No Android device connected</h3>
            <p className="text-xs text-m3-on-surface-variant mt-1.5 max-w-md mx-auto">
              Please connect your Android device via USB cable or pair over Wireless ADB to enable hardware controls and media synchronization.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="filled"
              size="sm"
              icon={<Usb className="h-4 w-4" />}
              onClick={handleConnectDevice}
            >
              Connect Device
            </Button>
            <Button
              variant="outlined"
              size="sm"
              icon={<Wifi className="h-4 w-4" />}
              onClick={() => setIsPairModalOpen(true)}
            >
              Pair Wireless
            </Button>
          </div>
        </Card>
      ) : (
        <Card variant="surface-2" className="p-4 border border-m3-surface-4 shadow-m3-1 hover:border-m3-primary/30 transition-all duration-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-m3-lg bg-m3-primary-container/30 text-m3-primary border border-m3-primary/20 shrink-0">
                <Smartphone className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-m3-on-surface">
                    {device?.name || device?.model || 'Android Target Device'}
                  </h3>
                  <span className="text-[11px] font-mono text-m3-on-surface-variant/80 bg-m3-surface-3 px-2 py-0.5 rounded-m3-sm border border-m3-surface-4">
                    {formatAndroidVersion(device?.androidVersion, (device as any)?.apiLevel)}
                  </span>
                </div>
                <p className="text-xs text-m3-on-surface-variant font-mono mt-0.5">
                  Serial: {device?.serialNumber || device?.serial || 'Disconnected'}
                </p>
              </div>
            </div>

            {/* Device Badges Info */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Connection Type */}
              <Badge variant={isWifiConnection ? 'primary' : 'neutral'} className="px-3 py-1 text-xs">
                {isWifiConnection ? <Wifi className="h-3.5 w-3.5 inline mr-1" /> : <Usb className="h-3.5 w-3.5 inline mr-1" />}
                {isWifiConnection ? 'WiFi Debugging' : 'USB Connection'}
              </Badge>

              {/* Battery */}
              <Badge variant="neutral" className="px-3 py-1 text-xs text-m3-on-surface">
                <Battery className="h-3.5 w-3.5 inline mr-1 text-m3-success" />
                {(device as any)?.batteryLevel ? `${(device as any).batteryLevel}%` : '85%'}
              </Badge>

              {/* Root Status */}
              {capabilities.isRooted ? (
                <Badge variant="success" dot className="px-3 py-1 text-xs">
                  <ShieldCheck className="h-3.5 w-3.5 inline mr-1" /> ROOT ACTIVE
                </Badge>
              ) : (
                <Badge variant="neutral" className="px-3 py-1 text-xs text-m3-on-surface-variant">
                  <ShieldAlert className="h-3.5 w-3.5 inline mr-1 text-m3-warning" /> NON-ROOT
                </Badge>
              )}

              {/* Shizuku */}
              {capabilities.hasShizuku ? (
                <Badge variant="primary" dot className="px-3 py-1 text-xs">
                  <Zap className="h-3.5 w-3.5 inline mr-1" /> SHIZUKU
                </Badge>
              ) : (
                <Badge variant="neutral" className="px-3 py-1 text-xs text-m3-on-surface-variant">
                  SHIZUKU OFF
                </Badge>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Control Cards Grid (Disabled if no active device connected) */}
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-6 transition-opacity duration-200 ${!isDeviceConnected ? 'opacity-40 pointer-events-none select-none' : ''}`}>
        {/* Left Column (6 cols): Display, Rotation & Media Controls */}
        <div className="lg:col-span-6 space-y-6">
          
          {/* 2. Display & Screen Brightness Card V2 */}
          <BrightnessCardV2 serial={serial} disabled={!isDeviceConnected} />

          {/* 3. Screen Rotation Card */}
          <Card variant="surface-1" className="p-5 space-y-4 border border-m3-surface-3 shadow-sm hover:shadow-m3-1 transition-all">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
                <RotateCw className={`h-4.5 w-4.5 text-m3-secondary ${rotationLoading ? 'animate-spin' : ''}`} />
                Screen Rotation
              </h3>
              <Badge variant={rotationState.autoRotate ? 'success' : 'neutral'} className={rotationState.autoRotate ? 'animate-pulse' : ''}>
                {rotationState.autoRotate
                  ? 'AUTO-ROTATE ON'
                  : `LOCKED · ${rotationState.rotationDegree === 0 ? 'Portrait' : rotationState.rotationDegree === 90 ? 'Landscape' : 'Reverse'}`}
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <Button
                variant={rotationState.autoRotate ? 'filled' : 'outlined'}
                size="sm"
                disabled={rotationLoading}
                onClick={() => handleRotate(true, 0)}
                className="w-full justify-center font-medium"
              >
                Auto Rotate
              </Button>
              <Button
                variant={!rotationState.autoRotate && rotationState.rotationDegree === 0 ? 'filled' : 'outlined'}
                size="sm"
                disabled={rotationLoading}
                onClick={() => handleRotate(false, 0)}
                className="w-full justify-center font-medium"
              >
                0° Portrait
              </Button>
              <Button
                variant={!rotationState.autoRotate && rotationState.rotationDegree === 90 ? 'filled' : 'outlined'}
                size="sm"
                disabled={rotationLoading}
                onClick={() => handleRotate(false, 90)}
                className="w-full justify-center font-medium"
              >
                90° Landscape
              </Button>
              <Button
                variant={!rotationState.autoRotate && rotationState.rotationDegree === 270 ? 'filled' : 'outlined'}
                size="sm"
                disabled={rotationLoading}
                onClick={() => handleRotate(false, 270)}
                className="w-full justify-center font-medium"
              >
                270° Reverse
              </Button>
            </div>

            {rotationLoading && (
              <p className="text-[11px] text-m3-on-surface-variant text-center animate-pulse">
                Verifying device rotation state…
              </p>
            )}
          </Card>

          {/* 4. Media Player V2 */}
          <MediaPlayerV2 serial={serial} />
        </div>

        {/* Right Column (6 cols): Clipboard, Flashlight, System Power Actions */}
        <div className="lg:col-span-6 space-y-6">
          
          {/* 5. Modernized Clipboard Card */}
          <Card variant="surface-1" className="p-5 space-y-4 border border-m3-surface-3 shadow-sm hover:shadow-m3-1 transition-all">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
                <Clipboard className="h-4.5 w-4.5 text-m3-primary" /> Device Clipboard Synchronization
              </h3>
              {lastClipboardUpdate && (
                <span className="text-[11px] text-m3-on-surface-variant/70 font-mono">
                  Updated just now
                </span>
              )}
            </div>

            <form onSubmit={handleSetClipboard} className="space-y-3">
              <div className="relative">
                <Input
                  label="Clipboard Text"
                  value={clipboardText}
                  onChange={(e) => setClipboardText(e.target.value)}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  placeholder="Type or paste text to push to Android target device..."
                />
                {clipboardText && (
                  <span className="absolute top-0 right-1 text-[11px] font-mono text-m3-on-surface-variant/60">
                    {clipboardText.length} chars
                  </span>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 flex-wrap pt-1">
                <Button
                  type="button"
                  variant="outlined"
                  size="sm"
                  icon={<Copy className="h-3.5 w-3.5 text-m3-primary" />}
                  onClick={handleCopyClipboard}
                  disabled={!clipboardText}
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  size="sm"
                  icon={<Trash2 className="h-3.5 w-3.5 text-m3-error" />}
                  onClick={handleClearClipboard}
                  disabled={!clipboardText}
                >
                  Clear
                </Button>
                <Button
                  type="submit"
                  variant="filled"
                  size="sm"
                  icon={<Send className="h-3.5 w-3.5" />}
                  disabled={!clipboardText.trim()}
                >
                  Push to Device
                </Button>
              </div>
            </form>
          </Card>

          {/* 6. Hardware Flashlight Card */}
          <Card variant="surface-1" className="p-5 space-y-3 border border-m3-surface-3 shadow-sm hover:shadow-m3-1 transition-all">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
                <Zap className="h-4.5 w-4.5 text-m3-warning" /> Flashlight / Torch
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-m3-on-surface-variant font-medium">Flashlight Backend:</span>
                <Badge variant={capabilities.isCompanionInstalled ? 'success' : 'warning'}>
                  {capabilities.isCompanionInstalled ? 'Companion App' : 'Unavailable'}
                </Badge>
                {capabilities.isCompanionInstalled && (
                  <Badge variant={flashlightOn ? 'success' : 'neutral'} className={flashlightOn ? 'animate-pulse' : ''}>
                    {flashlightOn ? 'TORCH ON' : 'OFF'}
                  </Badge>
                )}
              </div>
            </div>

            <p className="text-xs text-m3-on-surface-variant">
              Controls hardware camera LED flashlight via official Android CameraManager API provided by ACC Companion (<code className="font-mono text-m3-primary">com.acc.companion</code>).
            </p>

            <Tooltip
              content={!capabilities.isCompanionInstalled ? "Install Android Control Center Companion to enable flashlight control." : ""}
              position="top"
            >
              <div className="w-full">
                <Button
                  variant={flashlightOn ? 'filled' : 'outlined'}
                  size="sm"
                  icon={<Zap className="h-4 w-4" />}
                  onClick={handleFlashlightToggle}
                  disabled={!capabilities.isCompanionInstalled}
                  className="w-full justify-center font-medium"
                >
                  {flashlightOn ? 'Turn Flashlight OFF' : 'Turn Flashlight ON'}
                </Button>
              </div>
            </Tooltip>
          </Card>

          {/* 7. System Power & Advanced Actions Card */}
          <Card variant="surface-1" className="p-5 space-y-4 border border-m3-surface-3 shadow-sm hover:shadow-m3-1 transition-all">
            <h3 className="text-sm font-bold text-m3-on-surface flex items-center gap-2">
              <Power className="h-4.5 w-4.5 text-m3-error" /> System Power & Advanced Actions
            </h3>

            <div className="space-y-3">
              {/* Restart SystemUI */}
              <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-m3-on-surface">Restart SystemUI</h4>
                  <p className="text-[11px] text-m3-on-surface-variant">Restarts statusbar & navigation processes</p>
                </div>
                <Button
                  variant="outlined"
                  size="sm"
                  disabled={!capabilities.isRooted}
                  onClick={handleRestartSystemUI}
                  title={!capabilities.isRooted ? 'Requires Root privileges' : 'Restart SystemUI'}
                >
                  {capabilities.isRooted ? 'Restart UI' : 'Root Required'}
                </Button>
              </div>

              {/* Reboot Options */}
              <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 space-y-2">
                <h4 className="text-xs font-bold text-m3-on-surface">Reboot Options</h4>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => setConfirmAction('reboot_system')}
                    className="justify-center"
                  >
                    Reboot
                  </Button>
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => setConfirmAction('reboot_recovery')}
                    className="justify-center"
                  >
                    Recovery
                  </Button>
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => setConfirmAction('reboot_bootloader')}
                    className="justify-center"
                  >
                    Bootloader
                  </Button>
                </div>
              </div>

              {/* Power Off */}
              <div className="pt-1">
                <Button
                  variant="filled"
                  size="sm"
                  className="w-full bg-m3-error text-m3-on-error hover:bg-m3-error/90 justify-center font-bold"
                  icon={<Power className="h-4 w-4" />}
                  onClick={() => setConfirmAction('power_off')}
                >
                  Power Off Device
                </Button>
              </div>
            </div>
          </Card>

        </div>
      </div>

      {/* Wireless Pairing Modal */}
      <Modal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        title="Pair Wireless Target"
      >
        <form onSubmit={handlePairSubmit} className="space-y-4">
          <Input
            label="Device IP Address"
            placeholder="192.168.1.100"
            value={ipInput}
            onChange={(e) => setIpInput(e.target.value)}
            required
          />
          <Input
            label="Port"
            placeholder="5555"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setIsPairModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="filled" type="submit">
              Connect
            </Button>
          </div>
        </form>
      </Modal>

      {/* Power Action Confirmation Modal */}
      {(() => {
        const dialogConfig = getPowerDialogConfig(confirmAction);
        if (!dialogConfig) return null;

        return (
          <Modal
            isOpen={!!confirmAction}
            onClose={() => {
              if (!isExecutingPowerAction) setConfirmAction(null);
            }}
            title={dialogConfig.title}
            maxWidth="sm"
          >
            <div className="space-y-4">
              <p className="text-sm text-m3-on-surface-variant leading-relaxed">
                {dialogConfig.description}
              </p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmAction(null)}
                  disabled={isExecutingPowerAction}
                >
                  Cancel
                </Button>
                <Button
                  variant="filled"
                  size="sm"
                  onClick={handleConfirmPowerAction}
                  isLoading={isExecutingPowerAction}
                  disabled={isExecutingPowerAction}
                  className={
                    dialogConfig.isDestructive
                      ? 'bg-m3-error text-m3-on-error hover:bg-m3-error/90 font-bold'
                      : 'font-bold'
                  }
                >
                  {dialogConfig.confirmLabel}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};
