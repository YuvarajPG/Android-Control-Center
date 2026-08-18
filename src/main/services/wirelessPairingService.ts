import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import { EventEmitter } from 'events';
import { adbService } from './adbService';
import { trustedDevicesService } from './trustedDevicesService';
import { deviceDiscoveryService } from './deviceDiscoveryService';
import { logger } from './loggerService';
import { adbCapabilityService } from './adbCapabilityService';

export interface QrPairingSessionData {
  sessionId: string;
  qrPayload: string;
  serviceId: string;
  pairingCode: string;
  hostIp: string;
  port: number;
  expiresInSeconds: number;
  pairingStatus: 'idle' | 'pairing' | 'paired' | 'failed';
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  portDiscoveryStatus: 'idle' | 'discovering' | 'found' | 'failed';
  status: 'WAITING' | 'PAIRING' | 'CONNECTING' | 'CONNECTED' | 'EXPIRED' | 'FAILED' | 'PAIRED_PORT_FAILED' | 'CANCELLED';
  errorMessage?: string;
  discoveredIp?: string;
  discoveredPort?: number;
  connectedSerial?: string;
}

export class WirelessPairingService extends EventEmitter {
  private static instance: WirelessPairingService;
  private currentServer: Server | null = null;
  private currentSession: QrPairingSessionData | null = null;
  private sessionTimeoutTimer: NodeJS.Timeout | null = null;
  private pairingPollInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): WirelessPairingService {
    if (!WirelessPairingService.instance) {
      WirelessPairingService.instance = new WirelessPairingService();
    }
    return WirelessPairingService.instance;
  }

  /**
   * Helper: Get primary non-internal IPv4 address for LAN network binding
   */
  public getPrimaryLanIp(): string {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name];
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '0.0.0.0';
  }

  /**
   * Start or retrieve a persistent Android 11+ Wireless Debugging Pairing Session
   */
  public async startQrPairingSession(forceRefresh: boolean = false): Promise<{ success: boolean; data?: QrPairingSessionData; message?: string }> {
    // Return existing active session if valid and not forcing a refresh
    if (!forceRefresh && this.currentSession && (this.currentSession.status === 'WAITING' || this.currentSession.status === 'PAIRING')) {
      logger.info(`Reusing existing QR pairing session ${this.currentSession.sessionId}`, 'WirelessPairingService');
      return {
        success: true,
        data: this.currentSession,
        message: 'Reused existing QR pairing session.',
      };
    }

    // 1. Cancel previous session if active or forcing refresh
    await this.cancelQrPairing(false);

    const adbPath = await adbService.getAdbExecutablePath();
    if (!adbPath) {
      return {
        success: false,
        message: 'ADB binary is not detected. Please verify ADB installation first.',
      };
    }

    const caps = await adbCapabilityService.detectCapabilities(adbPath);
    if (!caps.supportsQrPairing) {
      logger.info('Official ADB QR pairing capabilities missing on this platform. Recommending manual pairing.', 'WirelessPairingService');
      return {
        success: false,
        message: 'ADB QR pairing is not supported by your system ADB binary. Please use Manual Pairing.',
      };
    }

    logger.info('Starting official pairing session...', 'WirelessPairingService');

    try {
      const hostIp = this.getPrimaryLanIp();

      // Official Android Studio / ADB standard service instance: studio-<random-10-char-string>
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let randomInstance = '';
      for (let i = 0; i < 10; i++) {
        randomInstance += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const serviceId = `studio-${randomInstance}`;
      const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
      const sessionId = `session-${Date.now()}-${randomBytes(2).toString('hex')}`;

      // Official Android 11+ Wireless Debugging QR Spec: WIFI:T:ADB;S:<service_id>;P:<pairing_code>;;
      const qrPayload = `WIFI:T:ADB;S:${serviceId};P:${pairingCode};;`;

      this.currentSession = {
        sessionId,
        qrPayload,
        serviceId,
        pairingCode,
        hostIp,
        port: 0,
        expiresInSeconds: 60,
        pairingStatus: 'pairing',
        connectionStatus: 'disconnected',
        portDiscoveryStatus: 'idle',
        status: 'WAITING',
      };

      logger.info(`QR generated: ${qrPayload}`, 'WirelessPairingService');
      logger.info(`[QR mDNS] Expected pairing service: ${serviceId}`, 'WirelessPairingService');

      // 2. Expiration handling (Strict 60 seconds timeout)
      this.sessionTimeoutTimer = setTimeout(() => {
        if (this.currentSession && this.currentSession.sessionId === sessionId && this.currentSession.status === 'WAITING') {
          this.currentSession.status = 'EXPIRED';
          this.currentSession.errorMessage = 'Android did not advertise the QR pairing service.';
          this.emit('pairing:status', this.currentSession);
          this.cancelQrPairing(false);
        }
      }, 60000);

      // 3. Start mDNS polling loop to discover the pairing service advertised by the phone
      this.startMdnsPairingPoll(serviceId, pairingCode, sessionId);

      return {
        success: true,
        data: this.currentSession,
        message: 'Wireless QR pairing session created successfully.',
      };
    } catch (err: any) {
      logger.error(`Failed starting wireless pairing session: ${err.message}`, 'WirelessPairingService', err);
      return {
        success: false,
        message: `Unable to start pairing service: ${err.message}`,
      };
    }
  }

  /**
   * Periodically poll mDNS to discover the pairing service (_adb-tls-pairing._tcp) matching our serviceId
   */
  private startMdnsPairingPoll(serviceId: string, pairingCode: string, sessionId: string): void {
    if (this.pairingPollInterval) {
      clearInterval(this.pairingPollInterval);
    }

    this.pairingPollInterval = setInterval(async () => {
      if (!this.currentSession || this.currentSession.sessionId !== sessionId || this.currentSession.status !== 'WAITING') {
        if (this.pairingPollInterval) clearInterval(this.pairingPollInterval);
        return;
      }

      try {
        const mdnsRes = await adbService.getMdnsServices();
        const rawOutput = mdnsRes.success && mdnsRes.message ? mdnsRes.message : '';
        const lines = rawOutput.split(/\r?\n/);

        const pairingServices = lines.filter((l) => l.includes('_adb-tls-pairing._tcp'));
        const connectServices = lines.filter((l) => l.includes('_adb-tls-connect._tcp'));

        logger.info(
          `[QR mDNS]\nExpected: ${serviceId}\nPairing services:\n${pairingServices.length ? pairingServices.join('\n') : '(none)'}\nConnect services:\n${connectServices.length ? connectServices.join('\n') : '(none)'}`,
          'WirelessPairingService'
        );

        if (mdnsRes.success && mdnsRes.message) {
          let pairingIp: string | null = null;
          let pairingPort: number | null = null;

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('List of')) continue;
            if (trimmed.includes('_adb-tls-pairing._tcp') && trimmed.includes(serviceId)) {
              const match = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
              if (match) {
                pairingIp = match[1];
                pairingPort = parseInt(match[2], 10);
                break;
              }
            }
          }

          if (pairingIp && pairingPort) {
            logger.info(`[QR mDNS] Phone detected — matching pairing service ${serviceId} found at ${pairingIp}:${pairingPort}`, 'WirelessPairingService');

            if (this.pairingPollInterval) clearInterval(this.pairingPollInterval);
            this.pairingPollInterval = null;

            if (this.sessionTimeoutTimer) {
              clearTimeout(this.sessionTimeoutTimer);
              this.sessionTimeoutTimer = null;
            }

            // Transition to PAIRING ("Phone detected — starting pairing...")
            this.currentSession.status = 'PAIRING';
            this.currentSession.port = pairingPort;
            this.emit('pairing:status', this.currentSession);

            logger.info(`[QR mDNS] Executing ADB TLS pairing with ${pairingIp}:${pairingPort}...`, 'WirelessPairingService');
            const pairRes = await adbService.pairWireless(pairingIp, pairingPort, pairingCode);

            if (pairRes.success) {
              deviceDiscoveryService.clearSuppression(pairingIp);
              logger.info(`[QR mDNS] Pairing SUCCESS for ${pairingIp}:${pairingPort}. Discovering connection endpoint...`, 'WirelessPairingService');
              await this.connectAndVerifyPairedEndpoint(pairingIp, pairingPort);
            } else {
              logger.error(`[QR mDNS] Pairing FAILED for ${pairingIp}:${pairingPort}: ${pairRes.message}`, 'WirelessPairingService');
              this.currentSession.status = 'FAILED';
              this.currentSession.errorMessage = `Pairing failed: ${pairRes.message}`;
              this.emit('pairing:status', this.currentSession);
            }
          }
        }
      } catch (err: any) {
        logger.debug(`mDNS polling error: ${err.message}`, 'WirelessPairingService');
      }
    }, 1000);
  }

  /**
   * Post-pairing verification & endpoint resolution flow.
   */
  public async connectAndVerifyPairedEndpoint(clientIp: string, pairingPort?: number): Promise<{
    success: boolean;
    pairingStatus: 'paired' | 'failed';
    connectionStatus: 'connected' | 'disconnected';
    portDiscoveryStatus: 'idle' | 'found' | 'failed';
    message?: string;
    device?: any;
  }> {
    if (this.currentSession) {
      this.currentSession.pairingStatus = 'paired';
      this.currentSession.connectionStatus = 'connecting';
      this.currentSession.portDiscoveryStatus = 'discovering';
      this.emit('pairing:status', this.currentSession);
    }

    const effectivePairingPort = pairingPort || this.currentSession?.port || 0;
    const rawDevs = await adbService.listRawDevices(true);
    const onlineWirelessDev = rawDevs.find(
      (d) =>
        d.connectionType === 'wireless' &&
        (d.rawStatus === 'device' || d.rawStatus === 'online') &&
        (d.serial.includes(clientIp) || d.serial === clientIp)
    );

    if (onlineWirelessDev) {
      const connSerial = onlineWirelessDev.serial;
      const connIp = connSerial.includes(':') ? connSerial.split(':')[0] : clientIp;
      const connPort = connSerial.includes(':') ? parseInt(connSerial.split(':')[1], 10) : 5555;

      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'connected';
        this.currentSession.portDiscoveryStatus = 'idle';
        this.currentSession.connectedSerial = connSerial;
        this.currentSession.status = 'CONNECTED';
        this.emit('pairing:status', this.currentSession);
      }

      trustedDevicesService.addDevice({
        serialNumber: connSerial,
        deviceName: 'Android Device',
        model: 'Android Device',
        ipAddress: connIp,
        port: connPort,
        connectionType: 'wireless',
        lastConnected: Date.now(),
      });

      return {
        success: true,
        pairingStatus: 'paired',
        connectionStatus: 'connected',
        portDiscoveryStatus: 'idle',
        message: 'Wireless connection successful.',
      };
    }

    let resolvedEndpoint: { ip: string; port: number } | null = null;
    const findMdnsConnectPort = (mdnsStdout: string): number | null => {
      const lines = mdnsStdout.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('List of')) continue;
        if (trimmed.includes('_adb-tls-connect._tcp') || trimmed.includes('_adb._tcp')) {
          const match = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
          if (match) {
            const matchedIp = match[1];
            const matchedPort = parseInt(match[2], 10);
            if ((!clientIp || matchedIp === clientIp) && matchedPort !== effectivePairingPort) {
              return matchedPort;
            }
          }
        }
      }
      return null;
    };

    logger.info(`[Fast Discovery] Starting rapid _adb-tls-connect._tcp lookup for IP ${clientIp}...`, 'WirelessPairingService');

    // Rapid post-pairing discovery: retry every 250ms up to 16 attempts (~4 seconds max)
    const maxAttempts = 16;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const mdnsRes = await adbService.getMdnsServices();
        if (mdnsRes.success && mdnsRes.message) {
          const port = findMdnsConnectPort(mdnsRes.message);
          if (port) {
            resolvedEndpoint = { ip: clientIp, port };
            logger.info(`[Fast Discovery] Found _adb-tls-connect._tcp port ${port} on attempt #${attempt} (~${attempt * 250}ms)`, 'WirelessPairingService');
            break;
          }
        }
      } catch (err) {
        // Ignore single mDNS query error during rapid polling
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    if (!resolvedEndpoint) {
      const failMsg = 'Pairing succeeded, but the Wireless Debugging connection port could not be discovered.';
      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'disconnected';
        this.currentSession.portDiscoveryStatus = 'failed';
        this.currentSession.status = 'PAIRED_PORT_FAILED';
        this.currentSession.errorMessage = failMsg;
        this.emit('pairing:status', this.currentSession);
      }
      return { success: true, pairingStatus: 'paired', connectionStatus: 'disconnected', portDiscoveryStatus: 'failed', message: failMsg };
    }

    const endpointStr = `${resolvedEndpoint.ip}:${resolvedEndpoint.port}`;
    const connRes = await adbService.connectWireless(resolvedEndpoint.ip, resolvedEndpoint.port);
    const postConnectRaw = await adbService.listRawDevices(true);
    const isNowOnline = postConnectRaw.some(
      (d) =>
        (d.serial === endpointStr || d.serial.includes(resolvedEndpoint.ip)) &&
        d.connectionType === 'wireless' &&
        (d.rawStatus === 'device' || d.rawStatus === 'online')
    );

    if (connRes.success && isNowOnline) {
      const wirelessSpecs = await adbService.fetchDetailedDeviceSpecs(endpointStr, 'online', 'wireless');

      // Clear any previous manual disconnect suppression for this device/IP
      deviceDiscoveryService.clearSuppression(resolvedEndpoint.ip, wirelessSpecs.hardwareSerial);
      deviceDiscoveryService.clearSuppression(endpointStr);
      deviceDiscoveryService.clearSuppression(clientIp);

      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'connected';
        this.currentSession.portDiscoveryStatus = 'found';
        this.currentSession.connectedSerial = endpointStr;
        this.currentSession.status = 'CONNECTED';
        this.emit('pairing:status', this.currentSession);
      }
      const cleanName = wirelessSpecs.deviceName && !wirelessSpecs.deviceName.includes('._tcp') && !wirelessSpecs.deviceName.includes('_adb-tls-')
        ? wirelessSpecs.deviceName
        : `${wirelessSpecs.manufacturer || 'Android'} ${wirelessSpecs.model || 'Device'}`;

      trustedDevicesService.addDevice({
        serialNumber: endpointStr,
        deviceName: cleanName,
        model: wirelessSpecs.model || 'Android Phone',
        manufacturer: wirelessSpecs.manufacturer || 'Android',
        hardwareSerial: wirelessSpecs.hardwareSerial || endpointStr,
        ipAddress: resolvedEndpoint.ip,
        port: resolvedEndpoint.port,
        connectionType: 'wireless',
        lastConnected: Date.now(),
      });

      // Force discovery rescan to push the unsuppressed unified device list to UI immediately
      await deviceDiscoveryService.scanDevices(true);

      return { success: true, pairingStatus: 'paired', connectionStatus: 'connected', portDiscoveryStatus: 'found', message: 'Wireless connection successful.' };
    } else {
      const failMsg = 'Pairing succeeded, but the Wireless Debugging connection could not be established.';
      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'disconnected';
        this.currentSession.portDiscoveryStatus = 'failed';
        this.currentSession.status = 'PAIRED_PORT_FAILED';
        this.currentSession.errorMessage = failMsg;
        this.emit('pairing:status', this.currentSession);
      }
      return { success: true, pairingStatus: 'paired', connectionStatus: 'disconnected', portDiscoveryStatus: 'failed', message: failMsg };
    }
  }

  /**
   * Cancel active session & shutdown pairing server
   */
  public async cancelQrPairing(notify: boolean = true): Promise<void> {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
      this.sessionTimeoutTimer = null;
    }
    if (this.pairingPollInterval) {
      clearInterval(this.pairingPollInterval);
      this.pairingPollInterval = null;
    }
    if (this.currentServer) {
      try { this.currentServer.close(); } catch {}
      this.currentServer = null;
    }
    if (this.currentSession && notify) {
      this.currentSession.status = 'CANCELLED';
      this.emit('pairing:status', this.currentSession);
    }
    this.currentSession = null;
    logger.info('QR pairing session cancelled and resources cleaned up.', 'WirelessPairingService');
  }

  public getSession(): QrPairingSessionData | null {
    return this.currentSession;
  }
}

export const wirelessPairingService = WirelessPairingService.getInstance();
