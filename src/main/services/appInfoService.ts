import { app } from 'electron';

export interface AppVersionInfo {
  appVersion: string;
  appName: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  platform: string;
}

export class AppInfoService {
  /**
   * Get app version and runtime dependencies versions
   */
  public static getAppVersionInfo(): AppVersionInfo {
    return {
      appVersion: 'Beta',
      appName: app.getName(),
      electronVersion: process.versions.electron || 'unknown',
      nodeVersion: process.versions.node || 'unknown',
      chromeVersion: process.versions.chrome || 'unknown',
      platform: process.platform,
    };
  }
}
