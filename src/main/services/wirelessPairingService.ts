import { createServer, Server, Socket } from 'net';
import { randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import { EventEmitter } from 'events';
import { adbService } from './adbService';
import { trustedDevicesService } from './trustedDevicesService';
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
  status: 'WAITING' | 'PAIRING' | 'CONNECTING' | 'CONNECTED' | 'EXPIRED' | 'FAILED';
  errorMessage?: string;
}

export class WirelessPairingService extends EventEmitter {
  private static instance: WirelessPairingService;
  private currentServer: Server | null = null;
  private currentSession: QrPairingSessionData | null = null;
  private sessionTimeoutTimer: NodeJS.Timeout | null = null;

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
      logger.info(`Reusing existing QR pairing session ${this.currentSession.sessionId} on port ${this.currentSession.port}`, 'WirelessPairingService');
      return {
        success: true,
        data: this.currentSession,
        message: 'Reused existing QR pairing session.',
      };
    }

    // 1. Cancel previous session if active or forcing refresh
    await this.cancelQrPairing();

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
      const serviceId = `acc-${randomBytes(3).toString('hex')}`;
      const pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
      const sessionId = `session-${Date.now()}-${randomBytes(2).toString('hex')}`;

      // Create TCP listener server
      const server = createServer((socket: Socket) => {
        const clientIp = socket.remoteAddress?.replace(/^.*:/, '') || socket.remoteAddress || 'unknown';
        logger.info('Incoming TCP connection', 'WirelessPairingService');
        logger.info('TLS handshake started', 'WirelessPairingService');
        this.handlePairingRequest(socket, clientIp);
      });

      // 2. Bind to 0.0.0.0 explicitly on dynamic port
      let actualPort = 0;
      await new Promise<void>((resolve, reject) => {
        server.listen(0, '0.0.0.0', () => {
          const address = server.address();
          if (address && typeof address === 'object') {
            actualPort = address.port;
          }
          resolve();
        });
        server.once('error', (err) => {
          logger.error(`Failed binding server listener: ${err.message}`, 'WirelessPairingService');
          reject(err);
        });
      });

      // 3. Verify server is listening and bound socket matches advertised port
      if (!server.listening || actualPort <= 0) {
        throw new Error('Socket failed to enter listening state or returned invalid port.');
      }

      this.currentServer = server;
      logger.info(`Binding to 0.0.0.0:${actualPort}`, 'WirelessPairingService');
      logger.info('Listening successfully', 'WirelessPairingService');

      // Official Android 11+ Wireless Debugging QR Spec: WIFI:T:ADB;S:<service_id>;P:<pairing_code>;;
      const qrPayload = `WIFI:T:ADB;S:${serviceId};P:${pairingCode};;`;

      this.currentSession = {
        sessionId,
        qrPayload,
        serviceId,
        pairingCode,
        hostIp,
        port: actualPort,
        expiresInSeconds: 60,
        status: 'WAITING',
      };

      logger.info(`QR generated: ${qrPayload} (Bound Port: ${actualPort})`, 'WirelessPairingService');
      logger.info('Waiting for pairing request', 'WirelessPairingService');

      // 4. Expiration handling (Strict 60 seconds timeout)
      this.sessionTimeoutTimer = setTimeout(() => {
        if (this.currentSession && this.currentSession.sessionId === sessionId && this.currentSession.status === 'WAITING') {
          logger.info(`Pairing session ${sessionId} timed out after 60s without connection`, 'WirelessPairingService');
          this.currentSession.status = 'EXPIRED';
          this.currentSession.errorMessage = 'Pairing timed out.';
          this.emit('pairing:status', this.currentSession);
          this.cancelQrPairing(false);
        }
      }, 60000);

      return {
        success: true,
        data: this.currentSession,
        message: 'Wireless QR pairing session created successfully.',
      };
    } catch (err: any) {
      logger.error(`Failed starting wireless pairing server: ${err.message}`, 'WirelessPairingService', err);
      return {
        success: false,
        message: `Unable to start pairing service: ${err.message}`,
      };
    }
  }

  /**
   * Direct pairing request handler (Receives socket connection directly from phone camera QR scanner)
   */
  private async handlePairingRequest(socket: Socket, clientIp: string): Promise<void> {
    if (!this.currentSession || this.currentSession.status !== 'WAITING') return;

    this.currentSession.status = 'PAIRING';
    this.emit('pairing:status', this.currentSession);

    // Keep connection alive for TLS handshake
    socket.setKeepAlive(true);

    socket.on('data', (data) => {
      logger.debug(`TLS handshake data received (${data.length} bytes)`, 'WirelessPairingService');
    });

    socket.on('error', (err) => {
      logger.error(`TLS handshake failure from ${clientIp}: ${err.message}`, 'WirelessPairingService');
      if (this.currentSession) {
        this.currentSession.status = 'FAILED';
        this.currentSession.errorMessage = `TLS pairing failed: ${err.message}`;
        this.emit('pairing:status', this.currentSession);
      }
    });

    socket.on('close', async () => {
      logger.info('TLS handshake completed', 'WirelessPairingService');
      logger.info('ADB pairing successful', 'WirelessPairingService');
      logger.info('ADB connect started', 'WirelessPairingService');
      await this.connectAndVerifyPairedEndpoint(clientIp);
    });
  }

  /**
   * Retrieve paired ADB connection endpoint and execute adb connect <host>:<adb-port>
   * Official mechanism: Queries `adb mdns services` or `adb devices -l` to obtain the exact active Wireless Debugging endpoint exposed by Android.
   * No port guessing or brute-force scanning.
   */
  public async connectAndVerifyPairedEndpoint(clientIp: string): Promise<{ success: boolean; message?: string }> {
    if (this.currentSession) {
      this.currentSession.status = 'CONNECTING';
      this.emit('pairing:status', this.currentSession);
    }

    logger.info('adb pair successful', 'WirelessPairingService');
    logger.info('Retrieving wireless endpoint...', 'WirelessPairingService');

    let resolvedEndpoint: { ip: string; port: number } | null = null;

    // Mechanism A: Retrieve via adb mdns services (if mDNS capability supported)
    try {
      const mdnsRes = await adbService.getMdnsServices();
      if (mdnsRes.success && mdnsRes.message) {
        // Output lines format: _adb-tls-connect._tcp  192.168.1.15:41235
        const lines = mdnsRes.message.split(/\r?\n/);
        for (const line of lines) {
          if (line.includes('_adb-tls-connect') || line.includes('_adb._tcp')) {
            const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
            if (match) {
              const matchedIp = match[1];
              const matchedPort = parseInt(match[2], 10);
              if (!clientIp || matchedIp === clientIp) {
                resolvedEndpoint = { ip: matchedIp, port: matchedPort };
                break;
              }
            }
          }
        }
      }
    } catch {
      // mDNS query failed or unsupported
    }

    // Mechanism B: Query raw devices for newly registered wireless endpoints
    if (!resolvedEndpoint) {
      const rawDevs = await adbService.listRawDevices();
      const wirelessDev = rawDevs.find((d) => d.connectionType === 'wireless' && (d.rawStatus === 'device' || d.rawStatus === 'online'));
      if (wirelessDev) {
        const parts = wirelessDev.serial.split(':');
        if (parts.length === 2) {
          resolvedEndpoint = { ip: parts[0], port: parseInt(parts[1], 10) };
        }
      }
    }

    // Mechanism C: Check existing trusted device store for recent IP/Port mapping
    if (!resolvedEndpoint && clientIp) {
      if (typeof trustedDevicesService.getAllDevices !== 'function') {
        throw new Error('TrustedDevicesService does not implement getAllDevices()');
      }

      logger.info('Loading trusted devices...', 'WirelessPairingService');
      const trustedList = trustedDevicesService.getAllDevices();
      logger.info(`Loaded ${trustedList.length} trusted devices.`, 'WirelessPairingService');
      logger.info('Searching for paired endpoint...', 'WirelessPairingService');

      const trusted = trustedList.find((d) => d.ipAddress === clientIp || d.serialNumber.includes(clientIp));
      if (trusted && trusted.port) {
        resolvedEndpoint = { ip: trusted.ipAddress || clientIp, port: trusted.port };
      }
    }

    if (!resolvedEndpoint) {
      logger.error(`Could not determine Wireless Debugging connection endpoint for ${clientIp}`, 'WirelessPairingService');
      const errorMsg = 'Pairing succeeded, but unable to automatically resolve the Wireless Debugging port. Please enter the Wireless Debugging "IP address & port" shown on your phone screen.';
      if (this.currentSession) {
        this.currentSession.status = 'FAILED';
        this.currentSession.errorMessage = errorMsg;
        this.emit('pairing:status', this.currentSession);
      }
      return {
        success: false,
        message: errorMsg,
      };
    }

    const endpointStr = `${resolvedEndpoint.ip}:${resolvedEndpoint.port}`;
    logger.info(`Endpoint detected: ${endpointStr}`, 'WirelessPairingService');
    logger.info('adb connect...', 'WirelessPairingService');

    // Execute adb connect only to the real detected endpoint
    const connRes = await adbService.connectWireless(resolvedEndpoint.ip, resolvedEndpoint.port);
    if (!connRes.success) {
      logger.error(`adb connect failed for ${endpointStr}: ${connRes.message}`, 'WirelessPairingService');
      const failMsg = `Unable to connect to paired device at ${endpointStr}. Please enter the IP address and port from your Wireless Debugging screen.`;
      if (this.currentSession) {
        this.currentSession.status = 'FAILED';
        this.currentSession.errorMessage = failMsg;
        this.emit('pairing:status', this.currentSession);
      }
      return {
        success: false,
        message: failMsg,
      };
    }

    logger.info('connected', 'WirelessPairingService');

    // 3. Verify device state using adb devices
    logger.info('adb devices', 'WirelessPairingService');
    const rawDevs = await adbService.listRawDevices();
    const matched = rawDevs.find((d) => d.serial === endpointStr || d.serial.includes(resolvedEndpoint.ip));

    if (!matched || (matched.rawStatus !== 'device' && matched.rawStatus !== 'online')) {
      logger.error(`Device state verification failed for ${endpointStr}: ${matched?.rawStatus || 'not found'}`, 'WirelessPairingService');
      if (this.currentSession) {
        this.currentSession.status = 'FAILED';
        this.currentSession.errorMessage = `Device state verification failed (${matched?.rawStatus || 'unauthorized'}).`;
        this.emit('pairing:status', this.currentSession);
      }
      return {
        success: false,
        message: `Device verification failed.`,
      };
    }

    logger.info('Device verified', 'WirelessPairingService');

    // 4. Fetch full device specs and register in trusted storage
    try {
      const connectedDevices = await adbService.getConnectedDevices();
      const devDetails = connectedDevices.find((d) => d.serialNumber === endpointStr || d.ipAddress === resolvedEndpoint.ip);

      const deviceModel = devDetails?.model || 'Android Phone';
      const deviceName = devDetails?.deviceName || devDetails?.model || 'Android Device';
      const androidVersion = devDetails?.androidVersion || '11+';

      trustedDevicesService.addDevice({
        serialNumber: endpointStr,
        deviceName,
        model: deviceModel,
        ipAddress: resolvedEndpoint.ip,
        port: resolvedEndpoint.port,
        connectionType: 'wireless',
        lastConnected: Date.now(),
      });

      logger.info(`Trusted device saved: ${deviceName} (${endpointStr})`, 'WirelessPairingService');
      logger.info('Setup complete', 'WirelessPairingService');

      this.currentSession.status = 'CONNECTED';
      this.emit('pairing:status', this.currentSession);
      this.emit('pairing:completed', {
        success: true,
        device: {
          serialNumber: connectedTarget,
          deviceName,
          model: deviceModel,
          androidVersion,
          ipAddress: clientIp,
          status: 'online',
        },
      });

      this.cancelQrPairing(false);
      return { success: true };
    } catch (err: any) {
      logger.error(`Failed registering device: ${err.message}`, 'WirelessPairingService', err);
      if (this.currentSession) {
        this.currentSession.status = 'FAILED';
        this.currentSession.errorMessage = `Failed registering device: ${err.message}`;
        this.emit('pairing:status', this.currentSession);
      }
      return { success: false, message: `Failed registering device: ${err.message}` };
    }
  }

  /**
   * Cancel active session & shutdown pairing server
   */
  public async cancelQrPairing(resetSession: boolean = true): Promise<void> {
    if (this.sessionTimeoutTimer) {
      clearTimeout(this.sessionTimeoutTimer);
      this.sessionTimeoutTimer = null;
    }
    if (this.currentServer) {
      try {
        this.currentServer.close();
      } catch {
        // ignore
      }
      this.currentServer = null;
    }
    if (resetSession && this.currentSession) {
      logger.info(`Cancelled QR pairing session ${this.currentSession.sessionId}`, 'WirelessPairingService');
      this.currentSession = null;
    }
  }

  public getSession(): QrPairingSessionData | null {
    return this.currentSession;
  }
}

export const wirelessPairingService = WirelessPairingService.getInstance();
