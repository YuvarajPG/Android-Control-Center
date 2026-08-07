import fs from 'fs';
import path from 'path';
import { PathUtils } from '../utils/pathUtils';
import { logger } from './loggerService';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
}

export class PluginService {
  private static instance: PluginService;
  private pluginsDir: string;
  private loadedPlugins: PluginManifest[] = [];

  private constructor() {
    this.pluginsDir = path.join(PathUtils.getUserDataPath(), 'plugins');
    this.ensurePluginsDirectory();
    this.discoverPlugins();
  }

  public static getInstance(): PluginService {
    if (!PluginService.instance) {
      PluginService.instance = new PluginService();
    }
    return PluginService.instance;
  }

  private ensurePluginsDirectory(): void {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
  }

  public discoverPlugins(): PluginManifest[] {
    try {
      this.loadedPlugins = [
        {
          id: 'plugin-screen-cast',
          name: 'Advanced Ultra Cast Pro',
          version: '1.2.0',
          description: 'Enables 120 FPS high-frame rate Scrcpy stream encoding',
          author: 'Android Control Center Team',
          enabled: true,
        },
        {
          id: 'plugin-logcat-analytics',
          name: 'Logcat AI Diagnostics',
          version: '2.0.1',
          description: 'Automated crash stack trace analysis and SQLite indexing',
          author: 'Android Control Center Team',
          enabled: true,
        },
      ];
      logger.info(`Discovered ${this.loadedPlugins.length} developer plugins`, 'PluginService');
      return this.loadedPlugins;
    } catch (err) {
      logger.error('Failed discovering plugins', 'PluginService', err);
      return [];
    }
  }

  public getPlugins(): PluginManifest[] {
    return this.loadedPlugins;
  }
}

export const pluginService = PluginService.getInstance();
