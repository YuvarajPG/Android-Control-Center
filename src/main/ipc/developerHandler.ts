import { ipcMain } from 'electron';
import { developerService } from '../services/developerService';
import { logger } from '../services/loggerService';

export function registerDeveloperHandlers(): void {
  // Execute terminal command
  ipcMain.handle('dev:exec-terminal', async (_event, payload: { serial: string; command: string }) => {
    logger.debug(`IPC dev:exec-terminal command: ${payload.command}`, 'DeveloperHandler');
    return developerService.executeTerminalCommand(payload.serial, payload.command);
  });

  // Get system properties
  ipcMain.handle('dev:get-props', async (_event, serial: string) => {
    return developerService.getSystemProperties(serial);
  });

  // Set system property
  ipcMain.handle('dev:set-prop', async (_event, payload: { serial: string; key: string; value: string }) => {
    return developerService.setSystemProperty(payload.serial, payload.key, payload.value);
  });

  // Fetch logcat logs
  ipcMain.handle('dev:fetch-logcat', async (_event, serial: string) => {
    return developerService.fetchLogcatLogs(serial);
  });

  // Query database logs
  ipcMain.handle('dev:query-logs', async (_event, payload: { searchQuery?: string; levelFilter?: string }) => {
    return developerService.queryDatabaseLogs(payload.searchQuery, payload.levelFilter);
  });

  // Clear logs
  ipcMain.handle('dev:clear-logs', async () => {
    return developerService.clearLogs();
  });
}
