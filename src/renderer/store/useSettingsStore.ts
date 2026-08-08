import { create } from 'zustand';
import { ipcService } from '../services/ipcService';

export interface AppSettings {
  adbPath: string;
  autoConnectWireless: boolean;
  screenMirrorQuality: 'high' | 'medium' | 'low';
  screenFpsLimit: number;
  screenMirrorBitrate: number;
  autoCheckUpdates: boolean;
  logcatBufferSize: number;
  themeMode: 'dark' | 'black';
  hasCompletedFirstRun: boolean;
  advancedAutomationEnabled: boolean;
  autoStartHelperServices: boolean;
  trustedDeviceReconnect: boolean;
}

interface SettingsState {
  settings: AppSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  setFirstRunCompleted: (completed: boolean) => Promise<void>;
}

const defaultSettings: AppSettings = {
  adbPath: '/usr/bin/adb',
  autoConnectWireless: true,
  screenMirrorQuality: 'high',
  screenFpsLimit: 60,
  screenMirrorBitrate: 16,
  autoCheckUpdates: true,
  logcatBufferSize: 500,
  themeMode: 'dark',
  hasCompletedFirstRun: false,
  advancedAutomationEnabled: false,
  autoStartHelperServices: true,
  trustedDeviceReconnect: true,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  isLoaded: false,
  loadSettings: async () => {
    try {
      const loaded = await ipcService.settings.get();
      set({ settings: { ...defaultSettings, ...loaded }, isLoaded: true });
      ipcService.logger.info('Loaded settings from Electron backend storage', 'useSettingsStore');
    } catch {
      set({ isLoaded: true });
    }
  },
  updateSettings: async (newSettings) => {
    const current = get().settings;
    const updated = { ...current, ...newSettings };
    set({ settings: updated });
    try {
      const persisted = await ipcService.settings.update(newSettings);
      set({ settings: { ...defaultSettings, ...persisted } });
      ipcService.logger.info('Persisted updated settings to Electron backend', 'useSettingsStore', newSettings);
    } catch (err) {
      ipcService.logger.error('Failed persisting settings to Electron backend', 'useSettingsStore', err);
    }
  },
  resetToDefaults: async () => {
    set({ settings: defaultSettings });
    try {
      const reset = await ipcService.settings.reset();
      set({ settings: { ...defaultSettings, ...reset } });
      ipcService.logger.info('Reset settings in Electron backend storage', 'useSettingsStore');
    } catch (err) {
      ipcService.logger.error('Failed resetting settings in Electron backend', 'useSettingsStore', err);
    }
  },
  setFirstRunCompleted: async (completed: boolean) => {
    await get().updateSettings({ hasCompletedFirstRun: completed });
  },
}));
