import { ipcMain } from 'electron';
import { adbService } from '../services/adbService';
import { deviceDiscoveryService } from '../services/deviceDiscoveryService';
import { trustedDevicesService } from '../services/trustedDevicesService';
import { wirelessPairingService } from '../services/wirelessPairingService';
import { adbCapabilityService } from '../services/adbCapabilityService';
import { logger } from '../services/loggerService';
import { ElectronUtils } from '../utils/electronUtils';

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

  // Add a trusted device
  ipcMain.handle('device:add-trusted', async (_event, payload: any) => {
    try {
      if (payload && payload.serialNumber) {
        trustedDevicesService.addDevice({
          serialNumber: payload.serialNumber,
          deviceName: payload.deviceName || 'Android Device',
          model: payload.model || 'Android Device',
          connectionType: payload.connectionType || 'wireless',
          ipAddress: payload.ipAddress,
          port: payload.port,
          lastConnected: payload.lastConnected || Date.now(),
        });
      }
      return { success: true };
    } catch (err: any) {
      logger.error('Error adding trusted device', 'DeviceHandler', err);
      return { success: false, message: err.message };
    }
  });

  const handleForgetDevice = async (serial: string) => {
    logger.info(`[MAIN] Forget requested: ${serial}`, 'DeviceHandler');
    const cachedDevs = deviceDiscoveryService.getCachedDevices();
    const cleanSerialIp = serial.includes(':') ? serial.split(':')[0] : serial;

    const dev = cachedDevs.find(
      (d) =>
        d.serialNumber === serial ||
        d.hardwareSerial === serial ||
        d.id === serial ||
        (cleanSerialIp && d.ipAddress === cleanSerialIp),
    );
    const targetName = dev?.deviceName || dev?.model || serial;
    const targetIp = dev?.ipAddress || cleanSerialIp;

    // 1. Disconnect all wireless ADB transports and IP addresses associated with this device
    if (dev?.availableTransports) {
      for (const t of dev.availableTransports) {
        if (t.type === 'wireless' || t.serial.includes(':')) {
          await adbService.disconnect(t.serial);
        }
      }
    }
    if (serial.includes(':')) {
      await adbService.disconnect(serial);
    }
    if (targetIp && targetIp !== serial) {
      await adbService.disconnect(targetIp);
    }

    // 2. Invalidate device caches & suppress auto-activation across all identifiers
    adbService.invalidateStaticDeviceCache(serial);
    if (dev?.hardwareSerial) adbService.invalidateStaticDeviceCache(dev.hardwareSerial);
    if (targetIp) adbService.invalidateStaticDeviceCache(targetIp);

    deviceDiscoveryService.suppressDevice(serial, dev?.hardwareSerial);
    if (targetIp) deviceDiscoveryService.suppressDevice(targetIp);
    if (dev?.id) deviceDiscoveryService.suppressDevice(dev.id);

    // 3. Remove from persistent trusted storage
    const wasRemoved = trustedDevicesService.removeDevice(serial);

    // 4. Force rescan and update UI
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer('device:list-updated', updated);

    logger.info(`[MAIN] Forget result: success for ${targetName}`, 'DeviceHandler');
    return { success: true, wasRemoved, deviceName: targetName, devices: updated };
  };

  ipcMain.handle('device:forget-trusted', async (_event, serial: string) => handleForgetDevice(serial));
  ipcMain.handle('device:forget', async (_event, serial: string) => handleForgetDevice(serial));

  // List trusted devices
  ipcMain.handle('device:list-trusted', async () => {
    try {
      return trustedDevicesService.getTrustedDevices();
    } catch (err: any) {
      logger.error('Error listing trusted devices', 'DeviceHandler', err);
      return [];
    }
  });

  ipcMain.handle('device:get-trusted', async () => {
    try {
      return trustedDevicesService.getTrustedDevices();
    } catch (err: any) {
      logger.error('Error listing trusted devices', 'DeviceHandler', err);
      return [];
    }
  });

  // Set preferred transport for unified device
  ipcMain.handle('device:set-preferred-transport', async (_event, payload: { deviceId: string; transport: 'usb' | 'wireless' }) => {
    return deviceDiscoveryService.setPreferredTransport(payload.deviceId, payload.transport);
  });

  // Feature: adb connect <ip>:<port> or manual activate
  ipcMain.handle('device:connect-wireless', async (_event, payload: { ip: string; port?: number; serial?: string }) => {
    const cleanIp = payload.ip.trim();
    const cleanPort = payload.port || 5555;
    const target = `${cleanIp}:${cleanPort}`;
    logger.info(`[MAIN] device:connect-wireless received for ${target}`, 'DeviceHandler');

    deviceDiscoveryService.clearSuppression(target);
    deviceDiscoveryService.clearSuppression(cleanIp);
    if (payload.serial) deviceDiscoveryService.clearSuppression(payload.serial);

    const res = await adbService.connectWireless(cleanIp, cleanPort);
    const postRaw = await adbService.listRawDevices(true);
    const isOnline = postRaw.some(
      (d) => (d.serial === target || d.serial.includes(cleanIp)) && d.connectionType === 'wireless' && (d.rawStatus === 'device' || d.rawStatus === 'online')
    );

    if (isOnline) {
      const devSpecs = await adbService.fetchDetailedDeviceSpecs(target, 'online', 'wireless');
      trustedDevicesService.addDevice({
        serialNumber: target,
        deviceName: devSpecs.deviceName || devSpecs.model || 'Wireless Android Device',
        model: devSpecs.model || 'Android Phone',
        manufacturer: devSpecs.manufacturer || 'Android',
        hardwareSerial: devSpecs.hardwareSerial || target,
        ipAddress: cleanIp,
        port: cleanPort,
        connectionType: 'wireless',
        lastConnected: Date.now(),
      });
      const updated = await deviceDiscoveryService.scanDevices(true);
      ElectronUtils.sendToRenderer('device:list-updated', updated);
      return { success: true, device: devSpecs, devices: updated };
    } else {
      return { success: false, message: res.message || `Failed connecting to ${target}` };
    }
  });

  ipcMain.handle('device:activate', async (_event, serial: string) => {
    logger.info(`[MAIN] device:activate received for ${serial}`, 'DeviceHandler');
    deviceDiscoveryService.clearSuppression(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer('device:list-updated', updated);
    return { success: true, devices: updated };
  });

  ipcMain.handle('adb:connect', async (_event, payload: { ip: string; port?: number }) => {
    logger.info(`[MAIN] adb:connect received for ${payload.ip}`, 'DeviceHandler');
    const target = `${payload.ip}:${payload.port || 5555}`;
    deviceDiscoveryService.clearSuppression(target);
    deviceDiscoveryService.clearSuppression(payload.ip);
    const res = await adbService.connectWireless(payload.ip, payload.port || 5555);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer('device:list-updated', updated);
    return res;
  });

  ipcMain.handle('wireless:discover-endpoint', async (_event, payload: { ip: string; pairingPort?: number }) => {
    logger.info(`[MAIN] wireless:discover-endpoint for ${payload.ip}`, 'DeviceHandler');
    return wirelessPairingService.connectAndVerifyPairedEndpoint(payload.ip, payload.pairingPort);
  });

  // Feature: adb disconnect [target]
  ipcMain.handle('device:disconnect', async (_event, serial?: string) => {
    logger.info(`[MAIN] device:disconnect received for ${serial || 'all'}`, 'DeviceHandler');
    if (serial) {
      const dev = deviceDiscoveryService.getCachedDevices().find((d) => d.serialNumber === serial || d.hardwareSerial === serial || d.id === serial);
      deviceDiscoveryService.suppressDevice(serial, dev?.hardwareSerial);
    } else {
      deviceDiscoveryService.suppressDevice();
    }
    const res = await adbService.disconnect(serial);
    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer('device:list-updated', updated);
    return res;
  });

  ipcMain.handle('adb:disconnect', async (_event, serial?: string) => {
    logger.info(`[MAIN] adb:disconnect received for ${serial || 'all'}`, 'DeviceHandler');
    if (!serial) {
      deviceDiscoveryService.suppressDevice();
      const res = await adbService.disconnect();
      const updated = await deviceDiscoveryService.scanDevices(true);
      ElectronUtils.sendToRenderer('device:list-updated', updated);
      return res;
    }

    const cachedDevs = deviceDiscoveryService.getCachedDevices();
    const dev = cachedDevs.find(
      (d) =>
        d.serialNumber === serial ||
        d.hardwareSerial === serial ||
        d.id === serial ||
        (d.ipAddress && serial.includes(d.ipAddress)),
    );

    // Suppress background auto-reconnect loops so the device STAYS disconnected
    deviceDiscoveryService.suppressDevice(serial, dev?.hardwareSerial);

    const endpointsToDisconnect = new Set<string>();
    if (serial.includes(':')) endpointsToDisconnect.add(serial);
    if (dev?.ipAddress && dev?.port) endpointsToDisconnect.add(`${dev.ipAddress}:${dev.port}`);

    if (dev?.availableTransports) {
      for (const t of dev.availableTransports) {
        if (t.type === 'wireless' || t.serial.includes(':')) {
          endpointsToDisconnect.add(t.serial);
        }
      }
    }

    if (endpointsToDisconnect.size === 0) {
      endpointsToDisconnect.add(serial);
    }

    for (const ep of endpointsToDisconnect) {
      logger.info(`[MAIN] Executing ADB disconnect for endpoint: ${ep}`, 'DeviceHandler');
      await adbService.disconnect(ep);
    }

    const updated = await deviceDiscoveryService.scanDevices(true);
    ElectronUtils.sendToRenderer('device:list-updated', updated);
    return { success: true };
  });

  // Feature: adb kill-server
  ipcMain.handle('adb:kill-server', async () => {
    return adbService.killServer();
  });

  // Feature: adb start-server
  ipcMain.handle('adb:start-server', async () => {
    return adbService.startServer();
  });

  // Feature: adb pair <pairingIp>:<pairingPort> <pairingCode>
  ipcMain.handle('adb:pair', async (_event, payload: { ip: string; port: number; pairingCode: string }) => {
    const pairingIp = payload.ip;
    const pairingPort = payload.port;
    const pairingCode = payload.pairingCode;

    logger.info(
      `[Wireless Pairing]\nPairing IP: ${pairingIp}\nPairing port: ${pairingPort}`,
      'DeviceHandler'
    );

    const pairRes = await adbService.pairWireless(pairingIp, pairingPort, pairingCode);

    logger.info(
      `[Wireless Pairing]\nPairing IP: ${pairingIp}\nPairing port: ${pairingPort}\nPairing result: ${pairRes.success ? 'SUCCESS' : 'FAILED'}`,
      'DeviceHandler'
    );

    if (!pairRes.success) {
      logger.error(`[Wireless Pairing] adb pair failed: ${pairRes.message}`, 'DeviceHandler');
      return {
        success: false,
        pairingStatus: 'failed',
        connectionStatus: 'disconnected',
        portDiscoveryStatus: 'idle',
        message: pairRes.message || 'Pairing failed. Please check pairing port and code.',
      };
    }

    // Pairing succeeded! Execute post-pairing connection & verification pipeline.
    const connRes = await wirelessPairingService.connectAndVerifyPairedEndpoint(pairingIp, pairingPort);

    // Force fresh background device discovery scan (uncached)
    deviceDiscoveryService.scanDevices(true).catch(() => {});

    return {
      success: true, // PAIRING ITSELF SUCCEEDED!
      pairingStatus: 'paired',
      connectionStatus: connRes.connectionStatus,
      portDiscoveryStatus: connRes.portDiscoveryStatus,
      message: connRes.message || 'Device paired successfully.',
      device: (connRes as any).device,
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
