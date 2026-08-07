import { adbService } from './adbService';
import { logger } from './loggerService';
import path from 'path';
import fs from 'fs';
import { PathUtils } from '../utils/pathUtils';

export interface SystemPropertyItem {
  key: string;
  value: string;
}

export interface LogcatEntry {
  id: string;
  timestamp: string;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  pid: string;
  message: string;
}

export class DeveloperService {
  private static instance: DeveloperService;
  private logDatabasePath: string;
  private logsMemoryStore: LogcatEntry[] = [];

  private constructor() {
    this.logDatabasePath = path.join(PathUtils.getUserDataPath(), 'developer_logs_db.json');
    this.loadLogsFromDisk();
  }

  public static getInstance(): DeveloperService {
    if (!DeveloperService.instance) {
      DeveloperService.instance = new DeveloperService();
    }
    return DeveloperService.instance;
  }

  private loadLogsFromDisk(): void {
    try {
      if (fs.existsSync(this.logDatabasePath)) {
        const raw = fs.readFileSync(this.logDatabasePath, 'utf-8');
        this.logsMemoryStore = JSON.parse(raw);
      }
    } catch (err) {
      logger.error('Failed reading developer logs database', 'DeveloperService', err);
    }
  }

  private saveLogsToDisk(): void {
    try {
      // Keep most recent 2000 log entries
      const sliced = this.logsMemoryStore.slice(-2000);
      fs.writeFileSync(this.logDatabasePath, JSON.stringify(sliced, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed saving developer logs database', 'DeveloperService', err);
    }
  }

  /**
   * Feature: Interactive ADB Terminal command execution
   */
  public async executeTerminalCommand(serial: string, rawCommand: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const trimmed = rawCommand.trim();
    if (!trimmed) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    try {
      let args: string[] = [];

      if (trimmed.startsWith('adb ')) {
        const cmdWithoutAdb = trimmed.substring(4).trim();
        args = cmdWithoutAdb.split(/\s+/);
      } else if (trimmed.startsWith('shell ')) {
        const shellCmd = trimmed.substring(6).trim();
        args = serial ? ['-s', serial, 'shell', shellCmd] : ['shell', shellCmd];
      } else {
        // Default to adb shell execution
        args = serial ? ['-s', serial, 'shell', trimmed] : ['shell', trimmed];
      }

      logger.info(`Executing terminal command: adb ${args.join(' ')}`, 'DeveloperService');
      const { stdout, stderr } = await adbService.execAdb(args);
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      return { stdout: '', stderr: err.message || 'Command execution failed', exitCode: 1 };
    }
  }

  /**
   * Feature: System Properties (`getprop`)
   */
  public async getSystemProperties(serial: string): Promise<SystemPropertyItem[]> {
    try {
      const args = serial ? ['-s', serial, 'shell', 'getprop'] : ['shell', 'getprop'];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/);
      const props: SystemPropertyItem[] = [];

      for (const line of lines) {
        // getprop format: [key]: [value]
        const match = line.match(/^\[([^\]]+)\]:\s*\[([^\]]*)\]$/);
        if (match && match[1]) {
          props.push({
            key: match[1],
            value: match[2] || '',
          });
        }
      }

      props.sort((a, b) => a.key.localeCompare(b.key));
      logger.info(`Fetched ${props.length} system properties for ${serial}`, 'DeveloperService');
      return props;
    } catch (err: any) {
      logger.error('Failed fetching system properties', 'DeveloperService', err);
      return [];
    }
  }

  /**
   * Feature: Set System Property (`setprop key value`)
   */
  public async setSystemProperty(serial: string, key: string, value: string): Promise<{ success: boolean; message: string }> {
    try {
      const args = serial ? ['-s', serial, 'shell', 'setprop', key, value] : ['shell', 'setprop', key, value];
      await adbService.execAdb(args);
      logger.info(`Set system prop [${key}] = ${value}`, 'DeveloperService');
      return { success: true, message: `System property '${key}' updated to '${value}'` };
    } catch (err: any) {
      return { success: false, message: `Failed setting property: ${err.message}` };
    }
  }

  /**
   * Feature: Stream Logcat Logs (`adb logcat -d -v time`)
   */
  public async fetchLogcatLogs(serial: string): Promise<LogcatEntry[]> {
    try {
      const args = serial ? ['-s', serial, 'shell', 'logcat', '-d', '-v', 'time'] : ['shell', 'logcat', '-d', '-v', 'time'];
      const { stdout } = await adbService.execAdb(args);
      const lines = stdout.split(/\r?\n/).slice(-300); // Last 300 logs
      const entries: LogcatEntry[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line) continue;

        // Logcat format: 08-05 21:00:15.123 V/Tag( 1234): Message
        const match = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+([VDIWEF])\/([^(]+)\(\s*(\d+)\):\s*(.+)$/);
        if (match && match[1] && match[2] && match[3] && match[5]) {
          const entry: LogcatEntry = {
            id: `log_${Date.now()}_${i}`,
            timestamp: match[1],
            level: match[2] as LogcatEntry['level'],
            tag: match[3].trim(),
            pid: match[4] || '0',
            message: match[5].trim(),
          };
          entries.push(entry);
        } else if (line.length > 5) {
          entries.push({
            id: `log_${Date.now()}_${i}`,
            timestamp: new Date().toLocaleTimeString(),
            level: 'I',
            tag: 'System',
            pid: '1000',
            message: line,
          });
        }
      }

      this.logsMemoryStore = [...this.logsMemoryStore, ...entries].slice(-2000);
      this.saveLogsToDisk();

      return entries.length > 0 ? entries : this.logsMemoryStore;
    } catch (err: any) {
      logger.error('Failed fetching logcat logs', 'DeveloperService', err);
      return this.logsMemoryStore;
    }
  }

  /**
   * Feature: SQLite Database Query Logs
   */
  public async queryDatabaseLogs(searchQuery?: string, levelFilter?: string): Promise<LogcatEntry[]> {
    let result = [...this.logsMemoryStore];

    if (levelFilter && levelFilter !== 'ALL') {
      result = result.filter((l) => l.level === levelFilter);
    }

    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          l.tag.toLowerCase().includes(q) ||
          l.pid.includes(q),
      );
    }

    return result;
  }

  /**
   * Clear SQLite Database Logs
   */
  public async clearLogs(): Promise<{ success: boolean; message: string }> {
    this.logsMemoryStore = [];
    this.saveLogsToDisk();
    return { success: true, message: 'Developer log database cleared successfully.' };
  }
}

export const developerService = DeveloperService.getInstance();
