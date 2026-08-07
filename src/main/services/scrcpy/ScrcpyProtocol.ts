/**
 * Scrcpy Protocol Constants & Specifications (scrcpy 3.x / 4.x)
 */

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

export class ScrcpyProtocol {
  /**
   * Parse scrcpy server device header (64 bytes device name + 4 bytes width + 4 bytes height)
   */
  public static parseHeader(buffer: Buffer): StreamMetadata | null {
    if (buffer.length < 72) return null;

    const deviceName = buffer.subarray(0, 64).toString('utf-8').replace(/\0/g, '').trim();
    const width = buffer.readUInt32BE(64);
    const height = buffer.readUInt32BE(68);

    return {
      deviceName: deviceName || 'Android Device',
      width: width || 1080,
      height: height || 2400,
      codec: 'h264',
    };
  }

  /**
   * Check for H264 start code (00 00 00 01 or 00 00 01)
   */
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
