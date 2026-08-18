/**
 * Scrcpy Protocol Constants & Specifications (scrcpy 3.x / 4.x)
 */

import { logger } from '../loggerService';

export enum CodecId {
  H264 = 0x68323634, // 'h264'
  H265 = 0x68323635, // 'h265'
  AV1 = 0x00617631,  // 'av1'
}

export interface StreamMetadata {
  deviceName: string;
  width: number;
  height: number;
  codec: 'h264' | 'h265' | 'av1';
}

export class ScrcpyDemuxer {
  private headerParsed: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);
  public metadata: StreamMetadata | null = null;

  public parse(
    chunk: Buffer,
    onMetadata: (meta: StreamMetadata) => void,
    onFramePayload: (payload: Buffer) => void,
  ): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // 1. Strip initial 69-byte device metadata header once
    if (!this.headerParsed) {
      if (this.buffer.length < 69) return;

      const deviceName = this.buffer.subarray(1, 65).toString('utf-8').replace(/\0/g, '').trim();
      this.metadata = {
        deviceName: deviceName || 'Android Device',
        width: 1080,
        height: 2400,
        codec: 'h264',
      };
      this.headerParsed = true;
      this.buffer = this.buffer.subarray(69);
      logger.info(`[Scrcpy] 69-byte header stripped (Device: ${deviceName}), framing H264 packets for decoder`, 'ScrcpyDemuxer');
      onMetadata(this.metadata);
    }

    // 2. Parse 12-byte framed scrcpy 2.x video packets: [8 bytes PTS][4 bytes Size][Payload]
    while (this.buffer.length >= 12) {
      const packetSize = this.buffer.readUInt32BE(8);

      if (packetSize === 0 || packetSize > 10 * 1024 * 1024) {
        const startIdx = this.buffer.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x01]));
        if (startIdx !== -1) {
          onFramePayload(this.buffer.subarray(startIdx));
          this.buffer = Buffer.alloc(0);
        }
        break;
      }

      if (this.buffer.length < 12 + packetSize) {
        break;
      }

      let payload = this.buffer.subarray(12, 12 + packetSize);
      this.buffer = this.buffer.subarray(12 + packetSize);

      const hasStartCode =
        (payload.length >= 4 && payload[0] === 0 && payload[1] === 0 && payload[2] === 0 && payload[3] === 1) ||
        (payload.length >= 3 && payload[0] === 0 && payload[1] === 0 && payload[2] === 1);

      if (!hasStartCode) {
        payload = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), payload]);
      }

      onFramePayload(payload);
    }
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0);
    this.headerParsed = false;
    this.metadata = null;
  }
}

export class ScrcpyProtocol {
  public static parseHeader(buffer: Buffer): { metadata: StreamMetadata; headerSize: number } | null {
    if (buffer.length < 69) return null;
    const deviceName = buffer.subarray(1, 65).toString('utf-8').replace(/\0/g, '').trim();
    const fourCC = buffer.readUInt32BE(65);
    const codec = fourCC === CodecId.H265 ? 'h265' : fourCC === CodecId.AV1 ? 'av1' : 'h264';
    return {
      metadata: { deviceName: deviceName || 'Android Device', width: 1080, height: 2400, codec },
      headerSize: 69,
    };
  }

  public static parseH264NalType(chunk: Buffer): { hasStartCode: boolean; nalType?: number } {
    if (chunk.length >= 4 && chunk[0] === 0x00 && chunk[1] === 0x00 && chunk[2] === 0x00 && chunk[3] === 0x01) {
      return { hasStartCode: true, nalType: chunk[4] & 0x1f };
    }
    if (chunk.length >= 3 && chunk[0] === 0x00 && chunk[1] === 0x00 && chunk[2] === 0x01) {
      return { hasStartCode: true, nalType: chunk[3] & 0x1f };
    }
    return { hasStartCode: false };
  }
}
