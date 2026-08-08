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
  private buffer: Buffer = Buffer.alloc(0);
  private headerParsed: boolean = false;
  public metadata: StreamMetadata | null = null;

  public parse(
    chunk: Buffer,
    onMetadata: (meta: StreamMetadata) => void,
    onFramePayload: (payload: Buffer) => void,
  ): void {
    // Accumulate incoming TCP stream bytes
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // 1. Parse Stream Header (69 bytes: 1 dummy byte + 64 bytes device name + 4 bytes codec ID)
    if (!this.headerParsed) {
      if (this.buffer.length < 69) return;

      const deviceName = this.buffer.subarray(1, 65).toString('utf-8').replace(/\0/g, '').trim();
      const fourCC = this.buffer.readUInt32BE(65);
      const codec = fourCC === CodecId.H265 ? 'h265' : fourCC === CodecId.AV1 ? 'av1' : 'h264';

      this.metadata = {
        deviceName: deviceName || 'Android Device',
        width: 1080,
        height: 2400,
        codec,
      };

      this.headerParsed = true;
      this.buffer = this.buffer.subarray(69);
      logger.info('[Scrcpy] STREAM HEADER COMPLETE', 'ScrcpyDemuxer');
      logger.info('[Scrcpy] STARTING PACKET LOOP', 'ScrcpyDemuxer');
      onMetadata(this.metadata);
    }

    // 2. Parse 4-byte framed packets (4 bytes Packet Size + N bytes Payload)
    while (true) {
      // Need at least 4 bytes to read packet length
      if (this.buffer.length < 4) break;

      const packetSize = this.buffer.readUInt32BE(0);

      // Sanity check packet size (max 10MB per NAL unit)
      if (packetSize === 0 || packetSize > 10 * 1024 * 1024) {
        logger.warn(`[Scrcpy] Invalid packet size: ${packetSize}, searching for resync...`, 'ScrcpyDemuxer');
        // Search for Annex-B start code (00 00 00 01) to resync
        const resyncIdx = this.buffer.indexOf(Buffer.from([0x00, 0x00, 0x00, 0x01]), 1);
        if (resyncIdx !== -1) {
          this.buffer = this.buffer.subarray(resyncIdx);
          continue;
        } else {
          // Retain last 3 bytes in case start code is split across TCP chunks
          this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
          break;
        }
      }

      // Check if full packet payload has arrived over TCP
      if (this.buffer.length < 4 + packetSize) {
        // Incomplete TCP packet: wait for remaining bytes to arrive
        break;
      }

      // Complete packet received: extract payload (4-byte length header + payload)
      const payload = this.buffer.subarray(4, 4 + packetSize);
      this.buffer = this.buffer.subarray(4 + packetSize);

      const nalType = payload.length >= 5 && payload[0] === 0 && payload[1] === 0 && payload[2] === 0 && payload[3] === 1
        ? (payload[4] & 0x1f)
        : (payload[0] & 0x1f);

      logger.info(`[Scrcpy] NAL LENGTH: ${packetSize}`, 'ScrcpyDemuxer');
      logger.info(`[Scrcpy] NAL TYPE: ${nalType}`, 'ScrcpyDemuxer');
      logger.info('[Scrcpy] PACKET FORWARDED TO DECODER', 'ScrcpyDemuxer');
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
