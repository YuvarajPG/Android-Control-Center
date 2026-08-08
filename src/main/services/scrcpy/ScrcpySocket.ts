import net from 'net';
import { EventEmitter } from 'events';
import { logger } from '../loggerService';
import { ScrcpyDemuxer, StreamMetadata } from './ScrcpyProtocol';

export class ScrcpySocket extends EventEmitter {
  private socket: net.Socket | null = null;
  private isConnected: boolean = false;
  private demuxer: ScrcpyDemuxer = new ScrcpyDemuxer();
  private totalBytesReceived: number = 0;

  public connect(port: number, host: string = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`[Scrcpy] Socket connecting to ${host}:${port}`, 'ScrcpySocket');
      logger.info('[Scrcpy] WAITING FOR STREAM HEADER', 'ScrcpySocket');
      this.socket = net.connect(port, host);
      this.totalBytesReceived = 0;
      this.demuxer.reset();

      let firstByteLogged = false;

      this.socket.on('connect', () => {
        this.isConnected = true;
        logger.info(`[Scrcpy] Socket opened on port ${port}`, 'ScrcpySocket');
        this.emit('connected');
      });

      let noDataTimer: NodeJS.Timeout | null = null;

      this.socket.on('data', (chunk: Buffer) => {
        logger.info(`[Scrcpy] SOCKET DATA EVENT (bytes=${chunk.length})`, 'ScrcpySocket');
        if (noDataTimer) {
          clearTimeout(noDataTimer);
          noDataTimer = null;
        }
        if (!firstByteLogged && chunk.length > 0) {
          firstByteLogged = true;
          logger.info(`[Scrcpy] FIRST BYTE RECEIVED (${chunk.length} bytes)`, 'ScrcpySocket');
          resolve();
        }
        this.totalBytesReceived += chunk.length;
        this.demuxer.parse(
          chunk,
          (meta: StreamMetadata) => {
            logger.info(`[Scrcpy] STREAM HEADER RECEIVED: ${meta.width}x${meta.height} (Codec: ${meta.codec})`, 'ScrcpySocket');
            this.emit('metadata', meta);

            noDataTimer = setTimeout(() => {
              logger.warn('[Scrcpy] NO DATA AFTER HEADER', 'ScrcpySocket');
            }, 2000);
          },
          (framePayload: Buffer) => {
            logger.info(`[Scrcpy] NAL CREATED (${framePayload.length} bytes)`, 'ScrcpySocket');
            this.emit('packet', framePayload);
          },
        );
      });

      this.socket.on('error', (err) => {
        logger.error(`[Scrcpy] Socket error: ${err.message}`, 'ScrcpySocket');
        this.emit('error', err);
        if (!firstByteLogged) reject(err);
      });

      this.socket.on('close', (hadError) => {
        const reason = hadError ? 'socket error' : 'remote server';
        logger.info(`[Scrcpy] SOCKET CLOSED BY SERVER (${reason}, bytes received: ${this.totalBytesReceived})`, 'ScrcpySocket');
        this.isConnected = false;
        this.emit('disconnected');

        if (!firstByteLogged || this.totalBytesReceived === 0) {
          reject(new Error(`Socket closed before stream started (bytes received: ${this.totalBytesReceived})`));
        }
      });
    });
  }

  public disconnect(): void {
    if (this.socket) {
      logger.info('[Scrcpy] SOCKET CLOSED BY CLIENT', 'ScrcpySocket');
      this.socket.destroy();
      this.socket = null;
    }
    this.demuxer.reset();
  }
}
