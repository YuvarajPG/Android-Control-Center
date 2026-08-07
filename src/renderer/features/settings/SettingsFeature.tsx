import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  Wifi,
  MonitorPlay,
  Info,
  RotateCcw,
  Save,
  Zap,
} from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Switch } from '../../components/common/Switch';
import { Select } from '../../components/common/Select';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppStore } from '../../store/useAppStore';
import { ipcService } from '../../services/ipcService';
import { AppVersionInfo, SystemInfo } from '../../types/electron';

export const SettingsFeature: React.FC = () => {
  const { settings, updateSettings, resetToDefaults } = useSettingsStore();
  const { addToast } = useAppStore();

  const [appInfo, setAppInfo] = useState<AppVersionInfo | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    ipcService.system.getAppVersion().then(setAppInfo).catch(() => {});
    ipcService.system.getInfo().then(setSystemInfo).catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(settings);
    addToast('success', 'Application settings saved to persistent storage');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Application Settings"
        subtitle="Configure ADB binary executable location, streaming defaults, and workspace preferences"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outlined"
              size="sm"
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={async () => {
                await resetToDefaults();
                addToast('info', 'Settings reset to default configuration');
              }}
            >
              Reset Defaults
            </Button>
            <Button
              variant="filled"
              size="sm"
              icon={<Save className="h-4 w-4" />}
              onClick={handleSave}
            >
              Save Settings
            </Button>
          </div>
        }
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: ADB Binary Configuration */}
        <Card variant="surface-1" className="space-y-4">
          <h3 className="text-sm font-bold text-m3-on-surface border-b border-m3-surface-3 pb-3 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-m3-primary" />
            ADB Daemon & Executable Path
          </h3>

          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <Input
                label="ADB Executable Path"
                value={settings.adbPath}
                onChange={(e) => updateSettings({ adbPath: e.target.value })}
                placeholder="/usr/bin/adb"
                className="flex-1 font-mono"
              />
              <Button
                type="button"
                variant="tonal"
                size="md"
                onClick={() => addToast('info', 'File browser prompt opened')}
              >
                Browse...
              </Button>
            </div>
            <p className="text-xs text-m3-on-surface-variant">
              Leave blank to auto-detect system-wide <code className="text-m3-primary">adb</code> binary installed in PATH.
            </p>
          </div>
        </Card>

        {/* Section 2: Advanced Automation & Helper Services */}
        <Card variant="surface-1" className="space-y-4">
          <h3 className="text-sm font-bold text-m3-on-surface border-b border-m3-surface-3 pb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-m3-primary" />
            Advanced Automation
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4">
              <div>
                <h4 className="text-sm font-semibold text-m3-on-surface">Enable Advanced Automation</h4>
                <p className="text-xs text-m3-on-surface-variant">Enable automated background services, helper management, and smart reconnect.</p>
              </div>
              <Switch
                checked={settings.advancedAutomationEnabled}
                onChange={(checked) => updateSettings({ advancedAutomationEnabled: checked })}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4">
              <div>
                <h4 className="text-sm font-semibold text-m3-on-surface">Automatically Reconnect Trusted Devices</h4>
                <p className="text-xs text-m3-on-surface-variant">Reconnect known trusted devices automatically when they join Wi-Fi.</p>
              </div>
              <Switch
                checked={settings.trustedDeviceReconnect}
                onChange={(checked) => updateSettings({ trustedDeviceReconnect: checked })}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4">
              <div>
                <h4 className="text-sm font-semibold text-m3-on-surface">Automatically Start Helper Services</h4>
                <p className="text-xs text-m3-on-surface-variant">Launch background companion telemetry and scrcpy video bridges automatically.</p>
              </div>
              <Switch
                checked={settings.autoStartHelperServices}
                onChange={(checked) => updateSettings({ autoStartHelperServices: checked })}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="tonal"
                size="sm"
                onClick={() => addToast('info', 'Helper app check initialized.')}
              >
                Manage Helper Apps
              </Button>
              <Button
                type="button"
                variant="outlined"
                size="sm"
                onClick={() => {
                  updateSettings({ hasCompletedFirstRun: false });
                  addToast('info', 'First-run setup wizard reset. Re-open wizard to run setup.');
                }}
              >
                Re-run Setup
              </Button>
            </div>
          </div>
        </Card>

        {/* Section 3: Wireless & Connection Defaults */}
        <Card variant="surface-1" className="space-y-4">
          <h3 className="text-sm font-bold text-m3-on-surface border-b border-m3-surface-3 pb-3 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-m3-secondary" />
            Connection & Discovery
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4">
              <div>
                <h4 className="text-sm font-semibold text-m3-on-surface">Wireless Auto-Reconnect</h4>
                <p className="text-xs text-m3-on-surface-variant">Remember trusted devices and automatically reconnect on startup or Wi-Fi return using exponential backoff.</p>
              </div>
              <Switch
                checked={settings.autoConnectWireless}
                onChange={(checked) => updateSettings({ autoConnectWireless: checked })}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4">
              <div>
                <h4 className="text-sm font-semibold text-m3-on-surface">Auto-Check Application Updates</h4>
                <p className="text-xs text-m3-on-surface-variant">Check GitHub releases on application launch.</p>
              </div>
              <Switch
                checked={settings.autoCheckUpdates}
                onChange={(checked) => updateSettings({ autoCheckUpdates: checked })}
              />
            </div>
          </div>
        </Card>

        {/* Section 3: Display & Streaming Defaults */}
        <Card variant="surface-1" className="space-y-4">
          <h3 className="text-sm font-bold text-m3-on-surface border-b border-m3-surface-3 pb-3 flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-m3-tertiary" />
            Stream & Video Quality
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Default Mirror Quality"
              options={[
                { value: 'high', label: 'High (1080p, 8 Mbps)' },
                { value: 'medium', label: 'Balanced (720p, 4 Mbps)' },
                { value: 'low', label: 'Low Latency (480p, 2 Mbps)' },
              ]}
              value={settings.screenMirrorQuality}
              onChange={(e) => updateSettings({ screenMirrorQuality: e.target.value as any })}
            />

            <Select
              label="Frame Rate Cap (FPS)"
              options={[
                { value: '60', label: '60 FPS (Smooth)' },
                { value: '30', label: '30 FPS (Power Saving)' },
                { value: '120', label: '120 FPS (High Refresh)' },
              ]}
              value={String(settings.screenFpsLimit)}
              onChange={(e) => updateSettings({ screenFpsLimit: Number(e.target.value) })}
            />
          </div>
        </Card>

        {/* Section 4: About & System Runtime Info */}
        <Card variant="surface-1" className="space-y-3">
          <h3 className="text-sm font-bold text-m3-on-surface border-b border-m3-surface-3 pb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-m3-primary" />
            System Information & Electron Runtime
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-center">
              <span className="text-m3-on-surface-variant block mb-1">App Version</span>
              <span className="text-m3-primary font-bold">{appInfo?.appVersion || 'v1.0.0'}</span>
            </div>
            <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-center">
              <span className="text-m3-on-surface-variant block mb-1">Electron</span>
              <span className="text-m3-on-surface font-bold">{appInfo?.electronVersion || '33.2.1'}</span>
            </div>
            <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-center">
              <span className="text-m3-on-surface-variant block mb-1">Node.js</span>
              <span className="text-m3-on-surface font-bold">{appInfo?.nodeVersion || '26.5.0'}</span>
            </div>
            <div className="p-3 bg-m3-surface-2 rounded-m3-md border border-m3-surface-4 text-center">
              <span className="text-m3-on-surface-variant block mb-1">Platform</span>
              <span className="text-m3-secondary font-bold uppercase">{systemInfo?.platform || 'LINUX'} ({systemInfo?.arch || 'x64'})</span>
            </div>
          </div>

          {systemInfo && (
            <div className="mt-3 pt-3 border-t border-m3-surface-4 text-xs font-mono text-m3-on-surface-variant grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>Host OS: <strong className="text-m3-on-surface">{systemInfo.type} {systemInfo.osRelease}</strong></div>
              <div>CPU Cores: <strong className="text-m3-on-surface">{systemInfo.cpuCores} cores</strong> ({systemInfo.cpuModel})</div>
              <div>Memory: <strong className="text-m3-on-surface">{systemInfo.freeMemoryMB} MB free / {systemInfo.totalMemoryMB} MB total</strong></div>
              <div>Host Name: <strong className="text-m3-on-surface">{systemInfo.hostname}</strong></div>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
};
