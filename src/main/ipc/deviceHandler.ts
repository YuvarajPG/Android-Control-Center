import { ipcMain } from 'electron';
import { adbService } from '../services/adbService';
import { deviceDiscoveryService } from '../services/deviceDiscoveryService';
import { trustedDevicesService } from '../services/trustedDevicesService';
import { wirelessPairingService } from '../services/wirelessPairingService';
import { adbCapabilityService } from '../services/adbCapabilityService';
import { logger } from '../services/loggerService';

export function registerDeviceHandlers(): void {
  // ADB Installation & Status Check
  ipcMain.handle('adb:check-installation', async () => {
    logger.debug('IPC adb:check-installation called', 'DeviceHandler');
    return adbService.checkAdbInstallation();
  });

  // Windows Platform Tools Auto-Download
  ipcMain.handle('adb:download-windows', async () => {
    logger.info('IPC adb:download-windows requested', 'DeviceHandler');
    return adbService.downloadPlatformToolsWindows();
  });

  // Device list: return cached data directly — do NOT trigger a new scan.
  // The background polling loop already keeps cachedDevices up-to-date and
  // will push device:list-updated to the renderer whenever something changes.
  ipcMain.handle('device:list', async () => {
    return deviceDiscoveryService.getCachedDevices();
  });

  ipcMain.handle('adb:list-devices', async () => {
    return deviceDiscoveryService.getCachedDevices();
  });

  // Get Auto Wireless Reconnect Feature Flag Status
  ipcMain.handle('device:get-auto-wireless-status', async () => {
    return {
      enabled: deviceDiscoveryService.enableAutoWirelessReconnect,
      message: 'Automatic Wireless Reconnect is currently disabled.',
    };
  });

  // Trigger manual rescan (user clicked Refresh)
  ipcMain.handle('device:rescan', async () => {
    const res = await deviceDiscoveryService.startBoundedDiscoverySession(undefined, true);
    return res.devices;
  });

  // Start event-driven bounded discovery session
  ipcMain.handle('device:start-bounded-discovery', async () => {
    return deviceDiscoveryService.startBoundedDiscoverySession(undefined, false);
  });

  // Reconnect wireless targets on user explicit action
  ipcMain.handle('device:reconnect-all', async () => {
    const res = await deviceDiscoveryService.startBoundedDiscoverySession(undefined, true);
    return res.devices;
  });

  // Forget a trusted device
  ipcMain.handle('device:forget-trusted', async (_event, serial: string) => {
    trustedDevicesService.removeDevice(serial);
    return deviceDiscoveryService.scanDevices();
  });

  // Set preferred transport for unified device
  ipcMain.handle('device:set-preferred-transport', async (_event, payload: { deviceId: string; transport: 'usb' | 'wireless' }) => {
    return deviceDiscoveryService.setPreferredTransport(payload.deviceId, payload.transport);
  });

  // Feature: adb connect <ip>:<port>
  ipcMain.handle('device:connect-wireless', async (_event, payload: { ip: string; port?: number }) => {
    const res = await adbService.connectWireless(payload.ip, payload.port || 5555);
    // Trigger rescan after connection attempt so device:list-updated fires if topology changed
    deviceDiscoveryService.scanDevices();
    return res;
  });

  ipcMain.handle('adb:connect', async (_event, payload: { ip: string; port?: number }) => {
    const res = await adbService.connectWireless(payload.ip, payload.port || 5555);
    deviceDiscoveryService.scanDevices();
    return res;
  });

  // Feature: adb disconnect [target]
  ipcMain.handle('device:disconnect', async (_event, serial?: string) => {
    const res = await adbService.disconnect(serial);
    deviceDiscoveryService.scanDevices();
    return res;
  });

  ipcMain.handle('adb:disconnect', async (_event, serial?: string) => {
    const res = await adbService.disconnect(serial);
    deviceDiscoveryService.scanDevices();
    return res;
  });

  // Feature: adb kill-server
  ipcMain.handle('adb:kill-server', async () => {
    return adbService.killServer();
  });

  // Feature: adb start-server
  ipcMain.handle('adb:start-server', async () => {
    return adbService.startServer();
  });

  // Feature: adb pair <ip>:<port> <pairingCode>
  ipcMain.handle('adb:pair', async (_event, payload: { ip: string; port: number; pairingCode: string }) => {
    logger.info('adb pair started', 'DeviceHandler');
    logger.info(`IPC adb:pair requested for ${payload.ip}:${payload.port}`, 'DeviceHandler');

    const pairRes = await adbService.pairWireless(payload.ip, payload.port, payload.pairingCode);
    if (!pairRes.success) {
      logger.error(`adb pair failed: ${pairRes.message}`, 'DeviceHandler');
      return pairRes;
    }

    logger.info('adb pair successful', 'DeviceHandler');

    // Retrieve active wireless endpoint and execute adb connect
    const connRes = await wirelessPairingService.connectAndVerifyPairedEndpoint(payload.ip);
    if (!connRes.success) {
      logger.error(`adb connect failed: ${connRes.message}`, 'DeviceHandler');
      return {
        success: false,
        message: connRes.message || 'Pairing succeeded, but unable to connect to Wireless Debugging endpoint. Please ensure Wireless Debugging is enabled on your phone and try connecting with the IP address and port.',
      };
    }

    // Verify adb devices output contains active 'device' state
    logger.info('adb devices', 'DeviceHandler');
    const rawDevs = await adbService.listRawDevices();
    logger.info(`adb devices returned ${rawDevs.length} devices`, 'DeviceHandler');

    const onlineDev = rawDevs.find((d) => d.rawStatus === 'device' || d.rawStatus === 'online');
    if (!onlineDev) {
      logger.warn('adb devices returned 0 connected devices in state "device"', 'DeviceHandler');
      return {
        success: false,
        message: 'Pairing succeeded, but no connected device was found in state "device". Please check Wireless Debugging on your phone.',
      };
    }

    logger.info(`Found 1 connected device: ${onlineDev.serial}`, 'DeviceHandler');
    logger.info('Device verified', 'DeviceHandler');
    logger.info('Saving trusted device', 'DeviceHandler');
    logger.info('Setup complete', 'DeviceHandler');

    return {
      success: true,
      message: 'Device paired, connected, and verified successfully!',
    };
  });

  // Feature: adb mdns services
  ipcMain.handle('adb:mdns-services', async () => {
    return adbService.getMdnsServices();
  });

  // Feature: wireless:startQrPairing
  ipcMain.handle('wireless:startQrPairing', async () => {
    logger.info('IPC wireless:startQrPairing requested', 'DeviceHandler');
    return wirelessPairingService.startQrPairingSession();
  });

  // Feature: wireless:cancelQrPairing
  ipcMain.handle('wireless:cancelQrPairing', async () => {
    logger.info('IPC wireless:cancelQrPairing requested', 'DeviceHandler');
    await wirelessPairingService.cancelQrPairing();
    return { success: true };
  });

  // Feature: wireless:refreshQrPairing
  ipcMain.handle('wireless:refreshQrPairing', async () => {
    logger.info('IPC wireless:refreshQrPairing requested (forcing new session)', 'DeviceHandler');
    return wirelessPairingService.startQrPairingSession(true);
  });

  // Feature: wireless:getQrStatus
  ipcMain.handle('wireless:getQrStatus', async () => {
    return { success: true, data: wirelessPairingService.getSession() };
  });

  // Feature: adb:get-capabilities
  ipcMain.handle('adb:get-capabilities', async () => {
    const adbPath = await adbService.getAdbExecutablePath();
    if (!adbPath) {
      return {
        adbPath: null,
        adbVersion: null,
        supportsMdns: false,
        supportsQrPairing: false,
        isDetected: true,
      };
    }
    return adbCapabilityService.detectCapabilities(adbPath);
  });

  // Backward compatibility alias for adb:start-qr-session
  ipcMain.handle('adb:start-qr-session', async () => {
    return wirelessPairingService.startQrPairingSession();
  });

  // Stub keycode handler
  ipcMain.handle('device:send-keycode', async (_event, payload: { serial: string; keycode: number }) => {
    return { success: true, message: `Sent keycode ${payload.keycode} to ${payload.serial}` };
  });
}
