import { ipcMain } from 'electron';
import { deviceControlService } from '../services/deviceControlService';
import { logger } from '../services/loggerService';

export function registerDeviceControlHandlers(): void {
  // Get Capabilities (Root, Shizuku, Brightness, AutoRotate, Volume)
  ipcMain.handle('control:get-capabilities', async (_event, serial: string) => {
    logger.debug(`IPC control:get-capabilities called for ${serial}`, 'DeviceControlHandler');
    return deviceControlService.getCapabilities(serial);
  });

  // Get Brightness
  ipcMain.handle('control:get-brightness', async (_event, serial: string) => {
    return deviceControlService.getBrightness(serial);
  });

  // Set Brightness
  ipcMain.handle('control:set-brightness', async (_event, payload: { serial: string; level: number }) => {
    return deviceControlService.setBrightness(payload.serial, payload.level);
  });



  // Lock Screen
  ipcMain.handle('control:lock', async (_event, serial: string) => {
    return deviceControlService.lockScreen(serial);
  });

  // Wake Screen
  ipcMain.handle('control:wake', async (_event, serial: string) => {
    return deviceControlService.wakeScreen(serial);
  });

  // Rotate Screen
  ipcMain.handle('control:rotate', async (_event, payload: { serial: string; autoRotate: boolean; degree?: number }) => {
    return deviceControlService.setRotation(payload.serial, payload.autoRotate, payload.degree || 0);
  });

  // Get Rotation State (post-command verification)
  ipcMain.handle('control:get-rotation', async (_event, serial: string) => {
    return deviceControlService.getRotation(serial);
  });

  // Get Media Info (Now Playing)
  ipcMain.handle('control:get-media-info', async (_event, serial: string) => {
    return deviceControlService.getMediaInfo(serial);
  });

  // Media Controls
  ipcMain.handle('control:media', async (_event, payload: { serial: string; action: 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down' }) => {
    return deviceControlService.sendMediaControl(payload.serial, payload.action);
  });

  // Get Clipboard
  ipcMain.handle('control:get-clipboard', async (_event, serial: string) => {
    return deviceControlService.getClipboard(serial);
  });

  // Set Clipboard
  ipcMain.handle('control:set-clipboard', async (_event, payload: { serial: string; text: string }) => {
    if (payload.text) {
      try {
        clipboard.writeText(payload.text);
      } catch {
        // ignore
      }
    }
    return deviceControlService.setClipboard(payload.serial, payload.text);
  });

  // Flashlight Toggle
  ipcMain.handle('control:flashlight', async (_event, payload: { serial: string; enable: boolean }) => {
    return deviceControlService.toggleFlashlight(payload.serial, payload.enable);
  });

  // Restart SystemUI
  ipcMain.handle('control:restart-systemui', async (_event, payload: { serial: string; isRooted: boolean }) => {
    return deviceControlService.restartSystemUI(payload.serial, payload.isRooted);
  });

  // Reboot Device
  ipcMain.handle('control:reboot', async (_event, payload: { serial: string; mode?: 'system' | 'recovery' | 'bootloader' }) => {
    return deviceControlService.rebootDevice(payload.serial, payload.mode || 'system');
  });

  // Power Off Device
  ipcMain.handle('control:power-off', async (_event, serial: string) => {
    return deviceControlService.powerOffDevice(serial);
  });
}
