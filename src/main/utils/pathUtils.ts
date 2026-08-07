import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export class PathUtils {
  /**
   * Get user data folder path
   */
  static getUserDataPath(): string {
    if (typeof app !== 'undefined' && app && typeof app.getPath === 'function') {
      try {
        return app.getPath('userData');
      } catch {
        // Fallback if app is not ready or in test env
      }
    }
    return path.join(process.cwd(), '.temp_user_data');
  }

  /**
   * Get settings JSON file path
   */
  static getSettingsFilePath(): string {
    return path.join(this.getUserDataPath(), 'settings.json');
  }

  /**
   * Get logs folder path, creating it if missing
   */
  static getLogsDirectory(): string {
    const logsDir = path.join(this.getUserDataPath(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    return logsDir;
  }

  /**
   * Get current log file path for today
   */
  static getTodayLogFilePath(): string {
    const dateStr = new Date().toISOString().split('T')[0];
    return path.join(this.getLogsDirectory(), `app-${dateStr}.log`);
  }
}
