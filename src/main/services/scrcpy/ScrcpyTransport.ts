import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../loggerService';
import { ScrcpyProtocol } from './ScrcpyProtocol';
import { ScrcpySocket } from './ScrcpySocket';
import { adbService } from '../adbService';

export interface TransportConfig {
  serial: string;
  bitrate: number;
  fps: number;
  quality: 'low' | 'medium' | 'high';
}

export class ScrcpyTransport extends EventEmitter {
  private scrcpyProcess: ChildProcess | null = null;
  private socket: ScrcpySocket | null = null;
  private firstPacketReceived: boolean = false;
  private spsReceived: boolean = false;
  private ppsReceived: boolean = false;
  private idrReceived: boolean = false;
  private port: number = 27183;

  private stdoutLines: string[] = [];
  private stderrLines: string[] = [];
  private firstByteReceived: boolean = false;
  private noFirstByteTimeout: NodeJS.Timeout | null = null;

  public async start(config: TransportConfig): Promise<void> {
    logger.info('[Scrcpy] Protocol version: 4.x', 'ScrcpyTransport');
    logger.info('[Scrcpy] Negotiated codec: h264', 'ScrcpyTransport');

    this.firstByteReceived = false;
    this.stdoutLines = [];
    this.stderrLines = [];

    try {
      // 0. Ensure previous transport instance is completely stopped
      await this.stopAsync();

      // Clean up lingering scrcpy processes on device to release abstract socket
      await adbService.execAdb([
        ...(config.serial ? ['-s', config.serial] : []),
        'shell', 'pkill -f com.genymobile.scrcpy.Server || true'
      ]).catch(() => {});

      // 1. Push scrcpy-server
      logger.info('[Scrcpy] Pushing scrcpy-server.jar to device...', 'ScrcpyTransport');
      await adbService.execAdb([
        ...(config.serial ? ['-s', config.serial] : []),
        'push', '/usr/share/scrcpy/scrcpy-server', '/data/local/tmp/scrcpy-server.jar'
      ]);

      // 2. Create adb forward tunnel with dynamic port
      const forwardResult = await adbService.execAdb([
        ...(config.serial ? ['-s', config.serial] : []),
        'forward', 'tcp:0', 'localabstract:scrcpy'
      ]);
      const allocatedPortStr = forwardResult.stdout.trim();
      this.port = parseInt(allocatedPortStr, 10);
      if (isNaN(this.port) || this.port <= 0) {
        throw new Error(`Failed to allocate adb forward port. Result: ${forwardResult.stdout}`);
      }
      logger.info(`[Scrcpy] ADB forward created on port ${this.port}`, 'ScrcpyTransport');

      // 3. Start scrcpy-server on device
      const serverArgs = [
        ...(config.serial ? ['-s', config.serial] : []),
        'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        '4.1',
        'tunnel_forward=true',
        'audio=false',
        'control=false',
        'show_touches=false',
        'stay_awake=true',
        'video_codec=h264',
        `video_bit_rate=${config.bitrate * 1000000}`,
        `max_fps=${config.fps}`,
        `max_size=${maxDim}`,
      ];

      logger.info('[Scrcpy] Server starting...', 'ScrcpyTransport');
      const adbPath = (await adbService.getAdbExecutablePath()) || 'adb';
      this.scrcpyProcess = spawn(adbPath, serverArgs);
      logger.info(`[Scrcpy] SCRCPY PROCESS STARTED (PID: ${this.scrcpyProcess.pid})`, 'ScrcpyTransport');

      this.scrcpyProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          this.stdoutLines.push(text);
          logger.info(`[scrcpy-server stdout] ${text}`, 'ScrcpyTransport');
        }
      });

      this.scrcpyProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          this.stderrLines.push(text);
          logger.info(`[Scrcpy] STDERR: ${text}`, 'ScrcpyTransport');
        }
      });

      this.scrcpyProcess.on('close', (code, signal) => {
        logger.info('[Scrcpy] SCRCPY PROCESS EXITED', 'ScrcpyTransport');
        logger.info(`[Scrcpy] EXIT CODE: ${code}`, 'ScrcpyTransport');
        logger.info(`[Scrcpy] EXIT SIGNAL: ${signal}`, 'ScrcpyTransport');

        if (!this.firstByteReceived) {
          logger.warn('[Scrcpy] SERVER TERMINATED BEFORE STREAM START', 'ScrcpyTransport');
        }

        logger.info(`[Scrcpy] STDERR:\n${this.stderrLines.join('\n') || '(none)'}`, 'ScrcpyTransport');
        logger.info(`[Scrcpy] STDOUT LAST 100 LINES:\n${this.stdoutLines.slice(-100).join('\n') || '(none)'}`, 'ScrcpyTransport');

        this.emit('close');
      });

      // 3-second timeout diagnostic
      this.noFirstByteTimeout = setTimeout(() => {
        if (!this.firstByteReceived) {
          const isAlive = this.scrcpyProcess && this.scrcpyProcess.exitCode === null;
          logger.warn(`[Scrcpy] 3s TIMEOUT: No first byte received. Process PID ${this.scrcpyProcess?.pid} state: ${isAlive ? 'STILL RUNNING' : 'EXITED (code=' + this.scrcpyProcess?.exitCode + ')'}`, 'ScrcpyTransport');
          logger.warn(`[Scrcpy] DUMP STDERR:\n${this.stderrLines.join('\n') || '(none)'}`, 'ScrcpyTransport');
          logger.warn(`[Scrcpy] DUMP STDOUT LAST 100 LINES:\n${this.stdoutLines.slice(-100).join('\n') || '(none)'}`, 'ScrcpyTransport');
        }
      }, 3000);

      // 4. Connect to socket with retry loop until scrcpy-server is listening on Android
      let connected = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!connected && attempts < maxAttempts) {
        attempts++;
        try {
          if (this.socket) {
            this.socket.disconnect();
          }
          this.socket = new ScrcpySocket();

          this.socket.on('packet', (chunk: Buffer) => {
            this.firstByteReceived = true;
            if (this.noFirstByteTimeout) {
              clearTimeout(this.noFirstByteTimeout);
              this.noFirstByteTimeout = null;
            }

            if (!this.firstPacketReceived) {
              this.firstPacketReceived = true;
              logger.info(`[Scrcpy] First video packet received (${chunk.length} bytes)`, 'ScrcpyTransport');
            }

            const nalInfo = ScrcpyProtocol.parseH264NalType(chunk);
            if (nalInfo.hasStartCode) {
              if (nalInfo.nalType === 7 && !this.spsReceived) {
                this.spsReceived = true;
                logger.info('[Scrcpy] First SPS received', 'ScrcpyTransport');
              }
              if (nalInfo.nalType === 8 && !this.ppsReceived) {
                this.ppsReceived = true;
                logger.info('[Scrcpy] First PPS received', 'ScrcpyTransport');
              }
              if (nalInfo.nalType === 5 && !this.idrReceived) {
                this.idrReceived = true;
                logger.info('[Scrcpy] First IDR received', 'ScrcpyTransport');
              }
            }
            this.emit('packet', chunk);
          });

          this.socket.on('metadata', (meta) => {
            logger.info(`[Scrcpy] Received metadata: ${meta.width}x${meta.height}`, 'ScrcpyTransport');
          });

          logger.info(`[Scrcpy] Connecting to video socket on port ${this.port} (attempt ${attempts}/${maxAttempts})...`, 'ScrcpyTransport');
          await this.socket.connect(this.port);
          connected = true;
          logger.info(`[Scrcpy] Connected to video socket on port ${this.port}`, 'ScrcpyTransport');
        } catch (err: any) {
          logger.warn(`[Scrcpy] Socket connection attempt ${attempts} failed (${err.message}). Retrying in 500ms...`, 'ScrcpyTransport');
          if (this.scrcpyProcess && this.scrcpyProcess.exitCode !== null) {
            throw new Error(`scrcpy-server process exited unexpectedly with code ${this.scrcpyProcess.exitCode}`);
          }
          await new Promise((res) => setTimeout(res, 500));
        }
      }

      if (!connected) {
        throw new Error(`Failed to connect to scrcpy video socket after ${maxAttempts} attempts.`);
      }

    } catch (err: any) {
      logger.error(`[Scrcpy] Failed to start ScrcpyTransport: ${err.message}`, 'ScrcpyTransport');
      throw err;
    }
  }

  public async stopAsync(): Promise<void> {
    logger.info('[Scrcpy] Stopping transport async', 'ScrcpyTransport');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    if (this.scrcpyProcess) {
      this.scrcpyProcess.kill('SIGKILL');
      this.scrcpyProcess = null;
    }

    if (this.port > 0) {
      const p = this.port;
      this.port = 0;
      await adbService.execAdb(['forward', '--remove', `tcp:${p}`]).catch(() => {});
    }

    this.firstPacketReceived = false;
    this.spsReceived = false;
    this.ppsReceived = false;
    this.idrReceived = false;
  }

  public stop(): void {
    this.stopAsync().catch(() => {});
  }
}
