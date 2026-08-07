import { ipcMain } from 'electron';
import { screenService } from '../services/screenService';
import { scrcpyService } from '../services/scrcpyService';
import { logger } from '../services/loggerService';

export function registerScreenHandlers(): void {
  // Take screenshot
  ipcMain.handle('screen:take-screenshot', async (_event, serial: string) => {
    logger.debug(`IPC screen:take-screenshot called for ${serial}`, 'ScreenHandler');
    return screenService.takeScreenshot(serial);
  });

  // Save screenshot image to disk
  ipcMain.handle('screen:save-screenshot', async (_event, base64Image: string) => {
    return screenService.saveScreenshotToDisk(base64Image);
  });

  // Start Screen Recording
  ipcMain.handle('screen:start-record', async (_event, payload: { serial: string; bitRateMb?: number }) => {
    return screenService.startScreenRecord(payload.serial, payload.bitRateMb || 8);
  });

  // Stop Screen Recording & Save Video
  ipcMain.handle('screen:stop-record', async (_event, serial: string) => {
    return screenService.stopScreenRecord(serial);
  });

  // Start scrcpy streaming
  ipcMain.handle('screen:start-stream', async (_event, payload: { serial: string; bitrate: number; fps: number; quality: 'low' | 'medium' | 'high' }) => {
    logger.info(`IPC screen:start-stream called for ${payload.serial}`, 'ScreenHandler');
    return scrcpyService.startStream(payload);
  });

  // Stop scrcpy streaming
  ipcMain.handle('screen:stop-stream', async () => {
    logger.info('IPC screen:stop-stream called', 'ScreenHandler');
    return scrcpyService.stopStream();
  });

  // Get stream stats
  ipcMain.handle('screen:get-stats', async () => {
    return scrcpyService.getStats();
  });
}

