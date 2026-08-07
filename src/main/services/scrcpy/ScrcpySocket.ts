import net from 'net';
import { EventEmitter } from 'events';
import { logger } from '../loggerService';
import { ScrcpyProtocol, StreamMetadata } from './ScrcpyProtocol';

export class ScrcpySocket extends EventEmitter {
  private socket: net.Socket | null = null;
  private isConnected: boolean = false;
  private metadata: StreamMetadata | null = null;

  public connect(port: number, host: string = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`scrcpy socket connecting to ${host}:${port}`, 'ScrcpySocket');
      this.socket = net.connect(port, host);

      this.socket.on('connect', () => {
        this.isConnected = true;
        logger.info(`scrcpy video socket connected to ${host}:${port}`, 'ScrcpySocket');
        this.emit('connected');
        resolve();
      });

      let headerBuffer = Buffer.alloc(0);
      this.socket.on('data', (chunk: Buffer) => {
        if (!this.metadata) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          const meta = ScrcpyProtocol.parseHeader(headerBuffer);
          if (meta) {
            this.metadata = meta;
            logger.info(`Scrcpy video stream header parsed: ${meta.width}x${meta.height} (${meta.deviceName})`, 'ScrcpySocket');
            this.emit('metadata', meta);
            // Remaining buffer after header
            const remaining = headerBuffer.subarray(72);
            if (remaining.length > 0) {
              this.emit('packet', remaining);
            }
          }
        } else {
          this.emit('packet', chunk);
        }
      });

      this.socket.on('error', (err) => {
        logger.error(`scrcpy video socket error: ${err.message}`, 'ScrcpySocket');
        this.emit('error', err);
        if (!this.isConnected) reject(err);
      });

      this.socket.on('close', () => {
        logger.warn('scrcpy video socket disconnected', 'ScrcpySocket');
        this.isConnected = false;
        this.emit('disconnected');
      });
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }
}
