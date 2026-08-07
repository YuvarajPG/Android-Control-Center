import { ipcMain } from 'electron';
import { SystemService } from '../services/systemService';
import { AppInfoService } from '../services/appInfoService';
import { logger } from '../services/loggerService';

export function registerSystemHandlers(): void {
  ipcMain.handle('system:get-info', async () => {
    logger.debug('IPC handler system:get-info called', 'SystemHandler');
    return SystemService.getSystemInfo();
  });

  ipcMain.handle('system:get-app-version', async () => {
    logger.debug('IPC handler system:get-app-version called', 'SystemHandler');
    return AppInfoService.getAppVersionInfo();
  });

  ipcMain.handle('system:get-platform', async () => {
    return process.platform;
  });
}
