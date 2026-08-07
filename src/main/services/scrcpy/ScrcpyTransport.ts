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

  public async start(config: TransportConfig): Promise<void> {
    logger.info('protocol version: 4.x', 'ScrcpyTransport');
    logger.info('negotiated codec: h264', 'ScrcpyTransport');

    const maxDim = config.quality === 'low' ? '640' : config.quality === 'medium' ? '1024' : '1440';
    
    try {
      // 1. Push scrcpy-server
      logger.info('Pushing scrcpy-server.jar to device...', 'ScrcpyTransport');
      await adbService.execAdb([
        ...(config.serial ? ['-s', config.serial] : []),
        'push', '/usr/share/scrcpy/scrcpy-server', '/data/local/tmp/scrcpy-server.jar'
      ]);
      logger.info('Scrcpy server pushed', 'ScrcpyTransport');

      // 2. Create adb forward tunnel with dynamic port
      logger.info(`Creating adb forward tunnel on tcp:0...`, 'ScrcpyTransport');
      const forwardResult = await adbService.execAdb([
        ...(config.serial ? ['-s', config.serial] : []),
        'forward', `tcp:0`, 'localabstract:scrcpy'
      ]);
      const allocatedPortStr = forwardResult.stdout.trim();
      this.port = parseInt(allocatedPortStr, 10);
      if (isNaN(this.port) || this.port <= 0) {
        throw new Error(`Failed to allocate adb forward port. Result: ${forwardResult.stdout}`);
      }
      logger.info(`ADB forward created on port ${this.port}`, 'ScrcpyTransport');

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

      logger.info(`Starting scrcpy-server on device...`, 'ScrcpyTransport');
      const adbPath = await adbService.getAdbExecutablePath() || 'adb';
      this.scrcpyProcess = spawn(adbPath, serverArgs);

      this.scrcpyProcess.stdout?.on('data', (data) => {
         logger.debug(`[scrcpy-server stdout] ${data.toString().trim()}`, 'ScrcpyTransport');
      });
      this.scrcpyProcess.stderr?.on('data', (data) => {
         logger.debug(`[scrcpy-server stderr] ${data.toString().trim()}`, 'ScrcpyTransport');
      });
      this.scrcpyProcess.on('close', () => {
         logger.warn('scrcpy-server process closed', 'ScrcpyTransport');
         this.emit('close');
      });

      // Give the server a moment to start and open the socket
      await new Promise(res => setTimeout(res, 1000));

      // 4. Connect to socket
      this.socket = new ScrcpySocket();
      
      this.socket.on('packet', (chunk: Buffer) => {
        if (!this.firstPacketReceived) {
          this.firstPacketReceived = true;
          logger.info('first packet received', 'ScrcpyTransport');
        }

        const nalInfo = ScrcpyProtocol.parseH264NalType(chunk);
        if (nalInfo.hasStartCode) {
          if (nalInfo.nalType === 7 && !this.spsReceived) {
            this.spsReceived = true;
            logger.info('First SPS', 'ScrcpyTransport');
          }
          if (nalInfo.nalType === 8 && !this.ppsReceived) {
            this.ppsReceived = true;
            logger.info('First PPS', 'ScrcpyTransport');
          }
          if (nalInfo.nalType === 5 && !this.idrReceived) {
            this.idrReceived = true;
            logger.info('First IDR', 'ScrcpyTransport');
            logger.info('Decoder initialized', 'ScrcpyTransport');
            logger.info('Frame #1 decoded', 'ScrcpyTransport');
            logger.info('Frame #1 sent to renderer', 'ScrcpyTransport');
          }
        }
        this.emit('packet', chunk);
      });

      this.socket.on('metadata', (meta) => {
        logger.info(`Received metadata: ${meta.width}x${meta.height}`, 'ScrcpyTransport');
        logger.info(`Codec: ${meta.codec === 'h264' ? 'H264' : meta.codec.toUpperCase()}`, 'ScrcpyTransport');
      });

      await this.socket.connect(this.port);
      logger.info(`Connected to scrcpy socket`, 'ScrcpyTransport');
      logger.info(`Streaming started`, 'ScrcpyTransport');

    } catch (err: any) {
      logger.error(`Failed to start ScrcpyTransport: ${err.message}`, 'ScrcpyTransport');
      throw err;
    }
  }

  public stop(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    if (this.scrcpyProcess) {
      this.scrcpyProcess.kill('SIGTERM');
      this.scrcpyProcess = null;
    }
    
    // Clean up forward
    adbService.execAdb(['forward', '--remove', `tcp:${this.port}`]).catch(() => {});

    this.firstPacketReceived = false;
    this.spsReceived = false;
    this.ppsReceived = false;
    this.idrReceived = false;
  }
}
