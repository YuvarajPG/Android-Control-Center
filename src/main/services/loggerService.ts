import fs from 'fs';
import { PathUtils } from '../utils/pathUtils';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  metadata?: unknown;
}

export class LoggerService {
  private static instance: LoggerService;

  private constructor() {}

  public static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  /**
   * Write formatted log to console and daily log file
   */
  public log(level: LogLevel, message: string, context: string = 'App', metadata?: unknown): void {
    const timestamp = new Date().toISOString();
    const formattedLog = `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${
      metadata ? ' ' + JSON.stringify(metadata) : ''
    }\n`;

    // Console output with color formatting
    switch (level) {
      case 'debug':
        console.debug(formattedLog.trim());
        break;
      case 'info':
        console.info(formattedLog.trim());
        break;
      case 'warn':
        console.warn(formattedLog.trim());
        break;
      case 'error':
        console.error(formattedLog.trim());
        break;
    }

    // Persist to daily log file
    try {
      const logFile = PathUtils.getTodayLogFilePath();
      fs.appendFileSync(logFile, formattedLog, 'utf-8');
    } catch (err) {
      console.error('Failed writing to log file:', err);
    }
  }

  public debug(message: string, context?: string, metadata?: unknown): void {
    this.log('debug', message, context, metadata);
  }

  public info(message: string, context?: string, metadata?: unknown): void {
    this.log('info', message, context, metadata);
  }

  public warn(message: string, context?: string, metadata?: unknown): void {
    this.log('warn', message, context, metadata);
  }

  public error(message: string, context?: string, metadata?: unknown): void {
    this.log('error', message, context, metadata);
  }
}

export const logger = LoggerService.getInstance();
