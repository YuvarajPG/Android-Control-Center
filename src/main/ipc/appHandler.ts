import { ipcMain, dialog } from 'electron';
import { appManagerService } from '../services/appManagerService';
import { logger } from '../services/loggerService';

export function registerAppHandlers(): void {
  // List installed apps
  ipcMain.handle('app:list', async (_event, payload: { serial: string; filter: 'all' | 'user' | 'system' }) => {
    logger.debug(`IPC app:list called with filter: ${payload.filter}`, 'AppHandler');
    return appManagerService.listApps(payload.serial, payload.filter);
  });


  // Open native OS file dialog to select local APK files for Install
  ipcMain.handle('app:select-apk-install', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Android Package (*.apk)', extensions: ['apk'] }],
      title: 'Select APK File to Install on Device',
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });

  // Open native OS folder dialog to select export APK destination directory
  ipcMain.handle('app:select-export-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Destination Folder to Export APK Backup',
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });

  // Launch App
  ipcMain.handle('app:launch', async (_event, payload: { serial: string; packageName: string }) => {
    return appManagerService.launchApp(payload.serial, payload.packageName);
  });

  // Force Stop App
  ipcMain.handle('app:stop', async (_event, payload: { serial: string; packageName: string }) => {
    return appManagerService.stopApp(payload.serial, payload.packageName);
  });

  // Install APK
  ipcMain.handle('app:install', async (_event, payload: { serial: string; apkPath: string }) => {
    return appManagerService.installApk(payload.serial, payload.apkPath);
  });

  // Uninstall App
  ipcMain.handle('app:uninstall', async (_event, payload: { serial: string; packageName: string }) => {
    return appManagerService.uninstallApp(payload.serial, payload.packageName);
  });

  // Export / Backup APK
  ipcMain.handle('app:export', async (_event, payload: { serial: string; packageName: string; destDir: string }) => {
    return appManagerService.exportApk(payload.serial, payload.packageName, payload.destDir);
  });

  // Clear App Data / Cache
  ipcMain.handle('app:clear-data', async (_event, payload: { serial: string; packageName: string }) => {
    return appManagerService.clearAppData(payload.serial, payload.packageName);
  });

  // Get Permissions
  ipcMain.handle('app:get-permissions', async (_event, payload: { serial: string; packageName: string }) => {
    return appManagerService.getPermissions(payload.serial, payload.packageName);
  });
}
