import { ipcMain } from 'electron';
import { logger, LogLevel } from '../services/loggerService';

export function registerLoggerHandlers(): void {
  ipcMain.handle(
    'log:event',
    async (_event, payload: { level: LogLevel; message: string; context?: string; metadata?: unknown }) => {
      logger.log(payload.level, payload.message, payload.context || 'Renderer', payload.metadata);
      return { success: true };
    },
  );
}
