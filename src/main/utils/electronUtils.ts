import { BrowserWindow, Notification } from 'electron';
import { logger } from '../services/loggerService';

export class ElectronUtils {
  /**
   * Send an IPC event to all open renderer windows
   */
  public static sendToRenderer(channel: string, payload?: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  /**
   * Display native OS desktop notification without opening terminal
   */
  public static sendNotification(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: `Android Control Center: ${title}`,
          body,
          silent: false,
        });
        notif.show();
      }
      // Also push to React toast system via IPC
      this.sendToRenderer('app:toast-notification', { title, body });
      logger.info(`Notification: ${title} - ${body}`, 'ElectronUtils');
    } catch (err) {
      logger.warn('Failed displaying desktop notification', 'ElectronUtils', err);
    }
  }
}
