import { ipcMain } from 'electron';
import { settingsService, AppSettingsSchema } from '../services/settingsService';

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async () => {
    return settingsService.getSettings();
  });

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettingsSchema>) => {
    return settingsService.updateSettings(partial);
  });

  ipcMain.handle('settings:reset', async () => {
    return settingsService.resetToDefaults();
  });
}
