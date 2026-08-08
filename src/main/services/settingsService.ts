import fs from 'fs';
import { PathUtils } from '../utils/pathUtils';
import { logger } from './loggerService';

export interface AppSettingsSchema {
  adbPath: string;
  autoConnectWireless: boolean;
  screenMirrorQuality: 'high' | 'medium' | 'low';
  screenFpsLimit: number;
  screenMirrorBitrate: number;
  autoCheckUpdates: boolean;
  logcatBufferSize: number;
  themeMode: 'dark' | 'black';
  hasCompletedFirstRun: boolean;
}

const defaultSettings: AppSettingsSchema = {
  adbPath: '/usr/bin/adb',
  autoConnectWireless: true,
  screenMirrorQuality: 'high',
  screenFpsLimit: 60,
  screenMirrorBitrate: 16,
  autoCheckUpdates: true,
  logcatBufferSize: 500,
  themeMode: 'dark',
  hasCompletedFirstRun: false,
};

export class SettingsService {
  private static instance: SettingsService;
  private settings: AppSettingsSchema;
  private filePath: string;

  private constructor() {
    this.filePath = PathUtils.getSettingsFilePath();
    this.settings = this.loadSettingsFromFile();
  }

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  private loadSettingsFromFile(): AppSettingsSchema {
    try {
      if (fs.existsSync(this.filePath)) {
        const rawData = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(rawData);
        logger.info('Loaded persistent settings from file', 'SettingsService');
        return { ...defaultSettings, ...parsed };
      }
    } catch (err) {
      logger.error('Failed reading settings file, falling back to defaults', 'SettingsService', err);
    }
    return { ...defaultSettings };
  }

  public getSettings(): AppSettingsSchema {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<AppSettingsSchema>): AppSettingsSchema {
    this.settings = { ...this.settings, ...partial };
    this.saveToFile();
    logger.info('Updated settings store', 'SettingsService', partial);
    return this.getSettings();
  }

  public resetToDefaults(): AppSettingsSchema {
    this.settings = { ...defaultSettings };
    this.saveToFile();
    logger.info('Reset settings store to defaults', 'SettingsService');
    return this.getSettings();
  }

  private saveToFile(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed writing settings to disk', 'SettingsService', err);
    }
  }
}

export const settingsService = SettingsService.getInstance();
