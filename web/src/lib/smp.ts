/**
 * SMP (Simple Management Protocol) implementation for MCUboot firmware updates
 * Based on reverse engineering of DOTT wearable BLE protocol
 * 
 * SMP Packet Format:
 * [op, flags, len_hi, len_lo, group_hi, group_lo, seq, cmd] + CBOR payload
 */

// SMP Service and Characteristic UUIDs
export const SMP_SERVICE_UUID = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
export const SMP_CHAR_UUID = 'da2e7828-fbce-4e01-ae9e-261174997c48';

// SMP Operation codes
const OP_READ = 0x00;
const OP_WRITE = 0x02;

// SMP Group IDs
const GROUP_IMAGE = 0x01;

// SMP Command IDs for Image group
const CMD_IMAGE_LIST = 0x00;
const CMD_IMAGE_UPLOAD = 0x01;
const CMD_IMAGE_TEST = 0x02;
// const CMD_IMAGE_CONFIRM = 0x01;  // Same as upload, different payload
const CMD_IMAGE_RESET = 0x05;

// Simple CBOR encoder for our needs
function encodeCBOR(obj: Record<string, unknown>): Uint8Array {
  const entries = Object.entries(obj);
  const parts: number[] = [];
  
  // Map with known length
  if (entries.length < 24) {
    parts.push(0xa0 + entries.length);  // Map of N items
  } else {
    parts.push(0xbf);  // Indefinite map
  }
  
  for (const [key, value] of entries) {
    // Encode key (text string)
    const keyBytes = new TextEncoder().encode(key);
    if (keyBytes.length < 24) {
      parts.push(0x60 + keyBytes.length);
    } else {
      parts.push(0x78, keyBytes.length);
    }
    parts.push(...keyBytes);
    
    // Encode value
    if (typeof value === 'number') {
      if (value < 24) {
        parts.push(value);
      } else if (value < 256) {
        parts.push(0x18, value);
      } else if (value < 65536) {
        parts.push(0x19, (value >> 8) & 0xff, value & 0xff);
      } else {
        parts.push(0x1a, (value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
      }
    } else if (value instanceof Uint8Array) {
      // Byte string
      if (value.length < 24) {
        parts.push(0x40 + value.length);
      } else if (value.length < 256) {
        parts.push(0x58, value.length);
      } else {
        parts.push(0x59, (value.length >> 8) & 0xff, value.length & 0xff);
      }
      parts.push(...value);
    } else if (typeof value === 'boolean') {
      parts.push(value ? 0xf5 : 0xf4);
    }
  }
  
  if (entries.length >= 24) {
    parts.push(0xff);  // End indefinite map
  }
  
  return new Uint8Array(parts);
}

// Simple CBOR decoder for responses
function decodeCBOR(data: Uint8Array): Record<string, unknown> {
  let pos = 0;
  
  function readValue(): unknown {
    const byte = data[pos++];
    const majorType = byte >> 5;
    const additionalInfo = byte & 0x1f;
    
    function readLength(): number {
      if (additionalInfo < 24) return additionalInfo;
      if (additionalInfo === 24) return data[pos++];
      if (additionalInfo === 25) {
        const val = (data[pos] << 8) | data[pos + 1];
        pos += 2;
        return val;
      }
      if (additionalInfo === 26) {
        const val = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
        pos += 4;
        return val;
      }
      return 0;
    }
    
    switch (majorType) {
      case 0: // Unsigned int
        return readLength();
      case 1: // Negative int
        return -1 - readLength();
      case 2: { // Byte string
        const len = readLength();
        const bytes = data.slice(pos, pos + len);
        pos += len;
        return bytes;
      }
      case 3: { // Text string
        const len = readLength();
        const text = new TextDecoder().decode(data.slice(pos, pos + len));
        pos += len;
        return text;
      }
      case 4: { // Array
        const len = additionalInfo === 31 ? -1 : readLength();
        const arr: unknown[] = [];
        while (len === -1 ? data[pos] !== 0xff : arr.length < len) {
          arr.push(readValue());
        }
        if (len === -1) pos++; // Skip break
        return arr;
      }
      case 5: { // Map
        const len = additionalInfo === 31 ? -1 : readLength();
        const map: Record<string, unknown> = {};
        while (len === -1 ? data[pos] !== 0xff : Object.keys(map).length < len) {
          const key = readValue() as string;
          const value = readValue();
          map[key] = value;
        }
        if (len === -1) pos++; // Skip break
        return map;
      }
      case 7: // Special
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        return undefined;
      default:
        return undefined;
    }
  }
  
  return readValue() as Record<string, unknown>;
}

// Build SMP packet
function buildSMPPacket(op: number, group: number, cmd: number, payload: Uint8Array = new Uint8Array(0), seq: number = 0): Uint8Array {
  const header = new Uint8Array(8);
  header[0] = op;
  header[1] = 0x00;  // Flags
  header[2] = (payload.length >> 8) & 0xff;
  header[3] = payload.length & 0xff;
  header[4] = (group >> 8) & 0xff;
  header[5] = group & 0xff;
  header[6] = seq;
  header[7] = cmd;
  
  const packet = new Uint8Array(header.length + payload.length);
  packet.set(header);
  packet.set(payload, header.length);
  return packet;
}

// Parse SMP response
function parseSMPResponse(data: Uint8Array): { op: number; group: number; cmd: number; seq: number; payload: Record<string, unknown> } {
  const op = data[0];
  const group = (data[4] << 8) | data[5];
  const seq = data[6];
  const cmd = data[7];
  const payloadBytes = data.slice(8);
  
  let payload: Record<string, unknown> = {};
  if (payloadBytes.length > 0) {
    try {
      payload = decodeCBOR(payloadBytes);
    } catch (e) {
      console.error('[SMP] CBOR decode error:', e);
      console.log('[SMP] Raw payload hex:', Array.from(payloadBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  }
  
  return { op, group, cmd, seq, payload };
}

// Compute SHA256 hash of data (for image verification)
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Need to convert to ArrayBuffer for crypto.subtle.digest
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

export interface SMPCallbacks {
  onLog?: (msg: string) => void;
  onProgress?: (percent: number, phase: string) => void;
}

export class SMPClient {
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private notifications: Uint8Array[] = [];
  private callbacks: SMPCallbacks = {};
  private seq: number = 0;

  setCallbacks(callbacks: SMPCallbacks) {
    this.callbacks = callbacks;
  }

  private log(msg: string) {
    console.log(`[SMP] ${msg}`);
    this.callbacks.onLog?.(msg);
  }

  async connect(server: BluetoothRemoteGATTServer): Promise<boolean> {
    try {
      this.log('Looking for SMP service...');
      const service = await server.getPrimaryService(SMP_SERVICE_UUID);
      this.log('Found SMP service');
      
      this.char = await service.getCharacteristic(SMP_CHAR_UUID);
      this.log('Found SMP characteristic');
      
      // Enable notifications
      await this.char.startNotifications();
      this.char.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          this.notifications.push(new Uint8Array(value.buffer));
        }
      });
      
      this.log('SMP notifications enabled');
      return true;
    } catch (e) {
      this.log(`SMP connection failed: ${(e as Error).message}`);
      return false;
    }
  }

  private async sendAndWait(packet: Uint8Array, timeoutMs: number = 5000): Promise<Uint8Array | null> {
    if (!this.char) return null;
    
    this.notifications = [];
    await this.char.writeValueWithoutResponse(packet as unknown as BufferSource);
    
    // Wait for response
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.notifications.length > 0) {
        return this.notifications.shift()!;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  async listImages(): Promise<{ slot: number; version: string; hash: Uint8Array; active: boolean; pending: boolean; confirmed: boolean }[] | null> {
    this.log('Listing firmware images...');
    
    const packet = buildSMPPacket(OP_READ, GROUP_IMAGE, CMD_IMAGE_LIST, new Uint8Array(0), this.seq++);
    const response = await this.sendAndWait(packet);
    
    if (!response) {
      this.log('No response to image list');
      return null;
    }
    
    const parsed = parseSMPResponse(response);
    this.log(`Image list response: rc=${parsed.payload['rc'] ?? 'none'}`);
    
    // Debug: log the full payload structure
    console.log('[SMP] Image list payload:', JSON.stringify(parsed.payload, (_, v) => 
      v instanceof Uint8Array ? `<${v.length} bytes>` : v
    ));
    
    if (parsed.payload['rc'] !== undefined && parsed.payload['rc'] !== 0) {
      this.log(`Error: rc=${parsed.payload['rc']}`);
      return null;
    }
    
    const images = parsed.payload['images'] as Array<Record<string, unknown>> | undefined;
    if (!images) {
      this.log('No images in response payload');
      return null;
    }
    
    this.log(`Found ${images.length} image(s) in response`);
    
    return images.map(img => ({
      slot: img['slot'] as number,
      version: img['version'] as string,
      hash: img['hash'] as Uint8Array,
      active: img['active'] as boolean,
      pending: img['pending'] as boolean,
      confirmed: img['confirmed'] as boolean,
    }));
  }

  async uploadImage(firmware: Uint8Array, onProgress?: (percent: number) => void): Promise<{ success: boolean; hash: Uint8Array | null }> {
    this.log(`Starting firmware upload (${firmware.length} bytes)...`);
    
    // Pre-compute hash for first chunk and later verification
    const firmwareHash = await sha256(firmware);
    this.log(`Firmware hash: ${Array.from(firmwareHash.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}...`);
    
    const CHUNK_SIZE = 128;  // Bytes per packet (conservative for BLE)
    let offset = 0;
    let lastPercent = -1;
    
    while (offset < firmware.length) {
      const chunk = firmware.slice(offset, Math.min(offset + CHUNK_SIZE, firmware.length));
      
      // Build upload packet with CBOR payload
      // First chunk needs image length, subsequent chunks don't
      const payloadObj: Record<string, unknown> = {
        'off': offset,
        'data': chunk,
      };
      
      // Only include 'len' and 'sha' on first chunk
      if (offset === 0) {
        payloadObj['len'] = firmware.length;
        payloadObj['sha'] = firmwareHash;
      }
      
      const payload = encodeCBOR(payloadObj);
      const packet = buildSMPPacket(OP_WRITE, GROUP_IMAGE, CMD_IMAGE_UPLOAD, payload, this.seq++);
      
      // First chunk needs longer timeout (device allocates flash)
      const timeout = offset === 0 ? 30000 : 10000;
      
      // Retry logic for transient failures
      let response: Uint8Array | null = null;
      for (let retry = 0; retry < 3; retry++) {
        response = await this.sendAndWait(packet, timeout);
        if (response) break;
        if (retry < 2) {
          this.log(`Retry ${retry + 1} at offset ${offset}...`);
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      if (!response) {
        this.log(`Upload failed at offset ${offset}: no response after 3 retries`);
        return { success: false, hash: null };
      }
      
      const parsed = parseSMPResponse(response);
      
      // Log first response for debugging
      if (offset === 0) {
        console.log('[SMP] First upload response:', JSON.stringify(parsed.payload));
      }
      
      if (parsed.payload['rc'] !== undefined && parsed.payload['rc'] !== 0) {
        this.log(`Upload failed at offset ${offset}: rc=${parsed.payload['rc']}`);
        return { success: false, hash: null };
      }
      
      // Check if device reports different offset (it may have already received this chunk)
      const nextOff = parsed.payload['off'] as number | undefined;
      if (nextOff !== undefined && nextOff > offset) {
        this.log(`Device requested skip to offset ${nextOff}`);
        offset = nextOff;
      } else {
        offset += chunk.length;
      }
      
      const percent = Math.floor((offset / firmware.length) * 100);
      onProgress?.(percent);
      
      if (percent !== lastPercent && percent % 10 === 0) {
        this.log(`Upload progress: ${percent}%`);
        lastPercent = percent;
      }
    }
    
    this.log('Firmware upload complete');
    
    return { success: true, hash: firmwareHash };
  }

  async testImage(hash: Uint8Array): Promise<boolean> {
    this.log('Marking new image for test boot...');
    const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    this.log(`Hash (${hash.length} bytes): ${hashHex.slice(0, 16)}...`);
    console.log('[SMP] Full hash for testImage:', hashHex);
    
    // Try without confirm field first (some implementations don't like it)
    const payload = encodeCBOR({ 'hash': hash });
    console.log('[SMP] testImage payload bytes:', Array.from(payload).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    const packet = buildSMPPacket(OP_WRITE, GROUP_IMAGE, CMD_IMAGE_TEST, payload, this.seq++);
    const response = await this.sendAndWait(packet);
    
    if (!response) {
      this.log('No response to image test');
      return false;
    }
    
    const parsed = parseSMPResponse(response);
    console.log('[SMP] Test image response:', JSON.stringify(parsed.payload));
    
    if (parsed.payload['rc'] !== undefined && parsed.payload['rc'] !== 0) {
      // rc=8 = ENOENT (hash not found)
      // rc=3 = EINVAL (invalid)
      const rcCodes: Record<number, string> = {
        3: 'EINVAL (invalid parameter)',
        5: 'ENOTSUP (not supported)',
        8: 'ENOENT (image not found)',
      };
      const rcName = rcCodes[parsed.payload['rc'] as number] || `unknown`;
      this.log(`Image test failed: rc=${parsed.payload['rc']} (${rcName})`);
      return false;
    }
    
    this.log('Image marked for test boot');
    return true;
  }

  async reset(): Promise<boolean> {
    this.log('Resetting device...');
    
    const packet = buildSMPPacket(OP_WRITE, GROUP_IMAGE, CMD_IMAGE_RESET, new Uint8Array(0), this.seq++);
    await this.char?.writeValueWithoutResponse(packet as unknown as BufferSource);
    
    // Device will disconnect, so we don't wait for response
    this.log('Reset command sent');
    return true;
  }
}
