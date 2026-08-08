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
  pairingStatus: 'idle' | 'pairing' | 'paired' | 'failed';
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  portDiscoveryStatus: 'idle' | 'discovering' | 'found' | 'failed';
  status: 'WAITING' | 'PAIRING' | 'CONNECTING' | 'CONNECTED' | 'EXPIRED' | 'FAILED' | 'PAIRED_PORT_FAILED';
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
        pairingStatus: 'pairing',
        connectionStatus: 'disconnected',
        portDiscoveryStatus: 'idle',
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
   * Post-pairing verification & endpoint resolution flow.
   * Pairing success and port discovery are two separate operations.
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
      this.currentSession.pairingStatus = 'paired'; // Pairing HAS SUCCEEDED!
      this.currentSession.connectionStatus = 'connecting';
      this.currentSession.portDiscoveryStatus = 'discovering';
      this.emit('pairing:status', this.currentSession);
    }

    const effectivePairingPort = pairingPort || this.currentSession?.port || 0;
    logger.info(
      `[Wireless Pairing]\nPairing IP: ${clientIp}\nPairing port: ${effectivePairingPort || 'N/A'}\nPairing result: SUCCESS`,
      'WirelessPairingService'
    );

    // 1. Force fresh uncached adb devices -l query (bypassing 15s cache!)
    const rawDevs = await adbService.listRawDevices(true);
    const rawDevListStr = rawDevs.map((d) => `${d.serial}\t${d.rawStatus}\t(${d.connectionType})`).join('\n');

    logger.info(
      `[Wireless Connection]\nFresh adb devices result:\n${rawDevListStr || 'No active devices listed'}`,
      'WirelessPairingService'
    );

    // Check if USB device is detected
    const usbDev = rawDevs.find((d) => d.connectionType === 'usb' && (d.rawStatus === 'device' || d.rawStatus === 'online'));
    if (usbDev) {
      logger.info(`Detected USB device:\n${usbDev.serial}`, 'WirelessPairingService');
    }

    // Check if an ACTUAL wireless connection is already online (MUST be wireless connectionType with IP:port)
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

      logger.info(
        `[Wireless Connection]\nDetected connected device: ${connSerial}\nConnection type: wireless\nConnection IP: ${connIp}\nConnection port: ${connPort}`,
        'WirelessPairingService'
      );

      logger.info(
        `[Port Discovery]\nDiscovery method: already_connected\nDiscovered connection port: ${connPort}\nDiscovery result: FOUND`,
        'WirelessPairingService'
      );

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
        device: {
          serialNumber: connSerial,
          deviceName: 'Android Device',
          model: 'Android Device',
          connectionType: 'wireless',
          ipAddress: connIp,
          port: connPort,
          status: 'online',
        },
      };
    }

    // 2. Wireless is NOT yet connected -> Log wireless state and begin port discovery for clientIp
    logger.info(
      `Wireless state for ${clientIp}:\npaired but not connected\n\nWireless connection port:\nNOT YET KNOWN\n\nDiscovery:\nREQUIRED`,
      'WirelessPairingService'
    );

    let resolvedEndpoint: { ip: string; port: number } | null = null;
    let discoveryMethod = 'none';

    // Helper: Parse MDNS output for clientIp
    const findMdnsPort = (mdnsStdout: string): number | null => {
      const lines = mdnsStdout.split(/\r?\n/);
      for (const line of lines) {
        if (line.includes('_adb-tls-connect') || line.includes('_adb._tcp')) {
          const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{2,5})/);
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

    // Mechanism A: adb mdns services (Attempt 1)
    try {
      const mdnsRes = await adbService.getMdnsServices();
      if (mdnsRes.success && mdnsRes.message) {
        const port = findMdnsPort(mdnsRes.message);
        if (port) {
          resolvedEndpoint = { ip: clientIp, port };
          discoveryMethod = 'mdns';
        }
      }
    } catch {}

    // Mechanism A2: adb mdns services (Retry after 600ms if not found immediately)
    if (!resolvedEndpoint) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      try {
        const mdnsRes = await adbService.getMdnsServices();
        if (mdnsRes.success && mdnsRes.message) {
          const port = findMdnsPort(mdnsRes.message);
          if (port) {
            resolvedEndpoint = { ip: clientIp, port };
            discoveryMethod = 'mdns_retry';
          }
        }
      } catch {}
    }

    // Mechanism B: System mDNS / Avahi service discovery (Linux / macOS system fallback)
    if (!resolvedEndpoint) {
      try {
        const sysMdns = await adbService.discoverSystemMdnsServices();
        if (sysMdns.success && sysMdns.services.length > 0) {
          const match = sysMdns.services.find((s) => s.ip === clientIp && s.port !== effectivePairingPort);
          if (match) {
            resolvedEndpoint = { ip: clientIp, port: match.port };
            discoveryMethod = 'system_mdns_avahi';
          }
        }
      } catch {}
    }

    // Mechanism C: Check existing trusted device store for this explicit IP
    if (!resolvedEndpoint && clientIp) {
      try {
        const trustedList = trustedDevicesService.getAll();
        const trusted = trustedList.find((d) => d.ipAddress === clientIp || d.serialNumber.includes(clientIp));
        if (trusted && trusted.port && trusted.port !== effectivePairingPort && trusted.port !== 5555) {
          resolvedEndpoint = { ip: trusted.ipAddress || clientIp, port: trusted.port };
          discoveryMethod = 'trusted_store';
        }
      } catch {}
    }

    logger.info(
      `[Port Discovery]\nDiscovery method: ${discoveryMethod}\nDiscovered connection port: ${resolvedEndpoint ? resolvedEndpoint.port : 'NONE'}\nDiscovery result: ${resolvedEndpoint ? 'FOUND' : 'FAILED'}`,
      'WirelessPairingService'
    );

    if (!resolvedEndpoint) {
      const failMsg = 'Pairing succeeded, but the Wireless Debugging connection port could not be discovered.';

      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'disconnected';
        this.currentSession.portDiscoveryStatus = 'failed';
        this.currentSession.discoveredIp = clientIp;
        this.currentSession.status = 'PAIRED_PORT_FAILED';
        this.currentSession.errorMessage = failMsg;
        this.emit('pairing:status', this.currentSession);
      }

      return {
        success: true, // Pairing itself IS successful!
        pairingStatus: 'paired',
        connectionStatus: 'disconnected',
        portDiscoveryStatus: 'failed',
        message: failMsg,
      };
    }

    // 3. Connect strictly to discovered connection port (NEVER pairing port!)
    const endpointStr = `${resolvedEndpoint.ip}:${resolvedEndpoint.port}`;
    logger.info(
      `Discovered wireless connection:\n${endpointStr}\n\nExecuting:\nadb connect ${endpointStr}`,
      'WirelessPairingService'
    );

    const connRes = await adbService.connectWireless(resolvedEndpoint.ip, resolvedEndpoint.port);
    const postConnectRaw = await adbService.listRawDevices(true);
    const isNowOnline = postConnectRaw.some(
      (d) =>
        (d.serial === endpointStr || d.serial.includes(resolvedEndpoint.ip)) &&
        d.connectionType === 'wireless' &&
        (d.rawStatus === 'device' || d.rawStatus === 'online')
    );

    logger.info(
      `[Wireless Connection]\nFresh adb devices result:\n${postConnectRaw.map((d) => `${d.serial}\t${d.rawStatus}\t(${d.connectionType})`).join('\n')}`,
      'WirelessPairingService'
    );

    if (connRes.success && isNowOnline) {
      logger.info(`Wireless connection: SUCCESS for ${endpointStr}`, 'WirelessPairingService');

      // Fetch actual hardware specs specifically for this wireless endpoint
      const wirelessSpecs = await adbService.fetchDetailedDeviceSpecs(endpointStr, 'online', 'wireless');

      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'connected';
        this.currentSession.portDiscoveryStatus = 'found';
        this.currentSession.connectedSerial = endpointStr;
        this.currentSession.status = 'CONNECTED';
        this.emit('pairing:status', this.currentSession);
      }

      trustedDevicesService.addDevice({
        serialNumber: endpointStr,
        deviceName: wirelessSpecs.deviceName || wirelessSpecs.model || 'Wireless Android Device',
        model: wirelessSpecs.model || 'Android Phone',
        manufacturer: wirelessSpecs.manufacturer || 'Android',
        hardwareSerial: wirelessSpecs.hardwareSerial || endpointStr,
        ipAddress: resolvedEndpoint.ip,
        port: resolvedEndpoint.port,
        connectionType: 'wireless',
        lastConnected: Date.now(),
      });

      return {
        success: true,
        pairingStatus: 'paired',
        connectionStatus: 'connected',
        portDiscoveryStatus: 'found',
        message: 'Wireless connection successful.',
        device: {
          serialNumber: endpointStr,
          deviceName: wirelessSpecs.deviceName || wirelessSpecs.model || 'Wireless Android Device',
          model: wirelessSpecs.model || 'Android Phone',
          manufacturer: wirelessSpecs.manufacturer || 'Android',
          hardwareSerial: wirelessSpecs.hardwareSerial || endpointStr,
          connectionType: 'wireless',
          ipAddress: resolvedEndpoint.ip,
          port: resolvedEndpoint.port,
          status: 'online',
        },
      };
    } else {
      logger.error(`Wireless connection failed for ${endpointStr}`, 'WirelessPairingService');
      const failMsg = 'Pairing succeeded, but the Wireless Debugging connection could not be established.';

      if (this.currentSession) {
        this.currentSession.pairingStatus = 'paired';
        this.currentSession.connectionStatus = 'disconnected';
        this.currentSession.portDiscoveryStatus = 'failed';
        this.currentSession.discoveredIp = resolvedEndpoint.ip;
        this.currentSession.discoveredPort = resolvedEndpoint.port;
        this.currentSession.status = 'PAIRED_PORT_FAILED';
        this.currentSession.errorMessage = failMsg;
        this.emit('pairing:status', this.currentSession);
      }

      return {
        success: true, // Pairing itself IS successful!
        pairingStatus: 'paired',
        connectionStatus: 'disconnected',
        portDiscoveryStatus: 'failed',
        message: failMsg,
      };
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
