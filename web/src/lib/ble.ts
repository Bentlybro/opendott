/**
 * OpenDOTT Web Bluetooth Service
 * Handles connection and image upload to DOTT wearable display
 * 
 * Protocol (matched EXACTLY to working Python tool):
 * 1. Send FILE SIZE (4 bytes LE) to trigger char (0x1528) with response
 * 2. Wait for indication
 * 3. Send image data chunks to data char (0x1525) without response
 * 4. Wait for "Transfer Complete" notification
 */

// DOTT BLE Service and Characteristic UUIDs
const DOTT_SERVICE_UUID = '0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc';

// Standard BLE UUIDs for device info
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL_UUID = '00002a19-0000-1000-8000-00805f9b34fb';
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const FIRMWARE_REVISION_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const MODEL_NUMBER_UUID = '00002a24-0000-1000-8000-00805f9b34fb';
const MANUFACTURER_UUID = '00002a29-0000-1000-8000-00805f9b34fb';

// Characteristic UUIDs (exact same as Python tool)
const UUID_1525 = '00001525-0000-1000-8000-00805f9b34fb';  // Data
const UUID_1528 = '00001528-0000-1000-8000-00805f9b34fb';  // Trigger
const UUID_1529 = '00001529-0000-1000-8000-00805f9b34fb';  // Alt data
const UUID_1530 = '00001530-0000-1000-8000-00805f9b34fb';  // Response

// Transfer settings
const DEFAULT_MTU = 517;     // Web Bluetooth typically negotiates this
const MAX_CHUNK_SIZE = 244;  // Safer chunk size (like Python with MTU 247)
const CHUNK_DELAY_MS = 10;   // Slightly slower for reliability
const MAX_RETRIES = 3;

/**
 * Validate GIF has full frames (required for DOTT - no delta optimization!)
 */
export function validateGifFrames(data: Uint8Array): { valid: boolean; message: string; frames: number } {
  if (data.length < 13) {
    return { valid: false, message: 'File too small', frames: 0 };
  }
  
  const header = String.fromCharCode(...data.slice(0, 6));
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return { valid: false, message: 'Not a valid GIF file', frames: 0 };
  }
  
  const width = data[6] | (data[7] << 8);
  const height = data[8] | (data[9] << 8);
  
  let pos = 13;
  if (data[10] & 0x80) {  // Global color table
    const gctSize = 3 * (2 ** ((data[10] & 0x07) + 1));
    pos += gctSize;
  }
  
  const frames: Array<{ w: number; h: number }> = [];
  
  while (pos < data.length - 1) {
    if (data[pos] === 0x21) {  // Extension
      if (data[pos + 1] === 0xF9) {  // GCE
        pos += 8;
      } else {
        pos += 2;
        while (pos < data.length && data[pos] !== 0) {
          pos += data[pos] + 1;
        }
        pos += 1;
      }
    } else if (data[pos] === 0x2C) {  // Image descriptor
      const fw = data[pos + 5] | (data[pos + 6] << 8);
      const fh = data[pos + 7] | (data[pos + 8] << 8);
      frames.push({ w: fw, h: fh });
      
      pos += 10;
      if (data[pos - 1] & 0x80) {  // Local color table
        pos += 3 * (2 ** ((data[pos - 1] & 0x07) + 1));
      }
      pos += 1;  // LZW min code size
      while (pos < data.length && data[pos] !== 0) {
        pos += data[pos] + 1;
      }
      pos += 1;
    } else if (data[pos] === 0x3B) {  // Trailer
      break;
    } else {
      pos += 1;
    }
  }
  
  const partialFrames = frames.filter(f => f.w !== width || f.h !== height);
  
  if (partialFrames.length > 0) {
    return {
      valid: false,
      message: `GIF has ${partialFrames.length} partial frame(s). DOTT requires full ${width}x${height} frames for animation. Use "gifsicle --unoptimize" to fix.`,
      frames: frames.length
    };
  }
  
  return {
    valid: true,
    message: `Valid: ${frames.length} full ${width}x${height} frames`,
    frames: frames.length
  };
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'uploading';

export interface DeviceInfo {
  batteryLevel?: number;  // 0-100
  firmwareVersion?: string;
  modelNumber?: string;
  manufacturer?: string;
}

export interface BleCallbacks {
  onConnectionChange?: (state: ConnectionState) => void;
  onProgress?: (progress: number, bytesTransferred: number, totalBytes: number) => void;
  onError?: (error: Error) => void;
  onUploadComplete?: (success: boolean) => void;
  onLog?: (message: string) => void;
}

class DottBleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private service: BluetoothRemoteGATTService | null = null;
  private dataChar: BluetoothRemoteGATTCharacteristic | null = null;
  private triggerChar: BluetoothRemoteGATTCharacteristic | null = null;
  private callbacks: BleCallbacks = {};
  private _state: ConnectionState = 'disconnected';
  private notifications: string[] = [];
  private mtu: number = DEFAULT_MTU;

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected' || this._state === 'uploading';
  }

  get deviceName(): string | undefined {
    return this.device?.name;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    if (!this.server?.connected) {
      return {};
    }

    const info: DeviceInfo = {};

    // Read battery level
    try {
      const batteryService = await this.server.getPrimaryService(BATTERY_SERVICE_UUID);
      const batteryChar = await batteryService.getCharacteristic(BATTERY_LEVEL_UUID);
      const batteryValue = await batteryChar.readValue();
      info.batteryLevel = batteryValue.getUint8(0);
    } catch {
      // Battery service not available
    }

    // Read device info
    try {
      const deviceInfoService = await this.server.getPrimaryService(DEVICE_INFO_SERVICE_UUID);
      
      try {
        const fwChar = await deviceInfoService.getCharacteristic(FIRMWARE_REVISION_UUID);
        const fwValue = await fwChar.readValue();
        info.firmwareVersion = new TextDecoder().decode(fwValue.buffer).replace(/\0/g, '');
      } catch { /* Not available */ }

      try {
        const modelChar = await deviceInfoService.getCharacteristic(MODEL_NUMBER_UUID);
        const modelValue = await modelChar.readValue();
        info.modelNumber = new TextDecoder().decode(modelValue.buffer).replace(/\0/g, '');
      } catch { /* Not available */ }

      try {
        const mfgChar = await deviceInfoService.getCharacteristic(MANUFACTURER_UUID);
        const mfgValue = await mfgChar.readValue();
        info.manufacturer = new TextDecoder().decode(mfgValue.buffer).replace(/\0/g, '');
      } catch { /* Not available */ }
    } catch {
      // Device info service not available
    }

    return info;
  }

  setCallbacks(callbacks: BleCallbacks) {
    this.callbacks = callbacks;
  }

  private log(msg: string) {
    console.log(`[BLE] ${msg}`);
    this.callbacks.onLog?.(msg);
  }

  private setState(state: ConnectionState) {
    this._state = state;
    this.callbacks.onConnectionChange?.(state);
  }

  async connect(): Promise<boolean> {
    if (!navigator.bluetooth) {
      this.callbacks.onError?.(new Error('Web Bluetooth is not supported in this browser'));
      return false;
    }

    try {
      this.setState('connecting');
      this.log('Scanning...');

      // Request device with DOTT service
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [DOTT_SERVICE_UUID] },
          { namePrefix: 'Dott' }
        ],
        optionalServices: [DOTT_SERVICE_UUID, BATTERY_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID]
      });

      if (!this.device) {
        throw new Error('No device selected');
      }

      // Listen for disconnection
      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      // Connect to GATT server
      this.server = await this.device.gatt?.connect() ?? null;
      if (!this.server) {
        throw new Error('Failed to connect to GATT server');
      }

      // Get MTU (Web Bluetooth doesn't expose this directly, use default)
      this.mtu = DEFAULT_MTU;
      this.log(`Connected, MTU: ${this.mtu}`);

      // Get DOTT service
      this.service = await this.server.getPrimaryService(DOTT_SERVICE_UUID);

      // Get characteristics (same as Python: UUID_1525 for data, UUID_1528 for trigger)
      this.dataChar = await this.service.getCharacteristic(UUID_1525);
      this.triggerChar = await this.service.getCharacteristic(UUID_1528);

      // Enable notifications on multiple UUIDs (same as Python)
      const notifyUuids = [UUID_1528, UUID_1529, UUID_1530];
      for (const uuid of notifyUuids) {
        try {
          const char = await this.service.getCharacteristic(uuid);
          await char.startNotifications();
          char.addEventListener('characteristicvaluechanged', this.handleNotification.bind(this));
        } catch {
          // Ignore if not available
        }
      }
      
      // Small delay like Python (0.2s)
      await new Promise(r => setTimeout(r, 200));

      this.setState('connected');
      return true;
    } catch (error) {
      this.setState('disconnected');
      this.callbacks.onError?.(error as Error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.handleDisconnect();
    this.log('Disconnected');
  }

  private handleDisconnect() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.dataChar = null;
    this.triggerChar = null;
    this.setState('disconnected');
  }

  private handleNotification(event: Event) {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    
    if (value) {
      const bytes = new Uint8Array(value.buffer);
      const hex = bytes.length > 0 ? Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('') : '';
      const text = new TextDecoder().decode(bytes);
      this.log(`[NOTIFY] ${hex} = '${text}'`);
      this.notifications.push(text);
    }
  }

  async uploadImage(data: Uint8Array): Promise<boolean> {
    if (!this.isConnected || !this.dataChar || !this.triggerChar) {
      this.callbacks.onError?.(new Error('Not connected to device'));
      return false;
    }

    try {
      this.setState('uploading');
      this.notifications = [];
      const totalBytes = data.length;
      const chunkSize = Math.min(this.mtu - 3, MAX_CHUNK_SIZE);  // Web BT max is 512
      
      this.log('============================================================');
      this.log(`Uploading ${totalBytes} bytes`);
      this.log('============================================================');
      
      // Debug: log first few bytes to verify GIF header
      const header = Array.from(data.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      this.log(`First 20 bytes: ${header}`);
      
      // Verify it's a GIF
      if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
        const width = data[6] | (data[7] << 8);
        const height = data[8] | (data[9] << 8);
        this.log(`GIF detected: ${width}x${height}`);
      }

      // Step 0: Pre-transfer commands (from btsnoop analysis)
      try {
        const responseChar = await this.service!.getCharacteristic(UUID_1530);
        await responseChar.writeValueWithoutResponse(new Uint8Array([0xfc]));
        this.log('Step 0: Wrote 0xfc to 0x1530');
        await new Promise(r => setTimeout(r, 50));
        await responseChar.writeValueWithoutResponse(new Uint8Array([0x10]));
        this.log('        Wrote 0x10 to 0x1530');
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        this.log(`Pre-transfer commands skipped: ${(e as Error).message}`);
      }

      // Step 1: TRIGGER - Write FILE SIZE (4 bytes LE) to 0x1528 with response
      // This is EXACTLY what Python does: struct.pack('<I', len(gif_data))
      const sizeTrigger = new Uint8Array(4);
      const view = new DataView(sizeTrigger.buffer);
      view.setUint32(0, totalBytes, true);  // little-endian
      
      this.log(`Step 1: Trigger with file size (${Array.from(sizeTrigger).map(b => b.toString(16).padStart(2, '0')).join('')})`);
      
      try {
        await this.triggerChar.writeValueWithResponse(sizeTrigger);
        this.log('  OK');
      } catch (e) {
        this.log(`  Error: ${(e as Error).message}`);
        return false;
      }

      // Wait for indication (up to 1 second, same as Python)
      this.log('  Waiting for indication...');
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (this.notifications.length > 0) {
          this.log(`  Got indication: ${JSON.stringify(this.notifications)}`);
          break;
        }
      }
      if (this.notifications.length === 0) {
        this.log('  No indication received (continuing anyway)');
      }

      // Step 2: DATA - Send raw bytes to 0x1525 without response
      this.log('');
      this.log(`Step 2: Sending GIF data (${chunkSize}b chunks)...`);
      const startTime = Date.now();
      
      let lastLogPct = 0;
      for (let i = 0; i < totalBytes; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        
        // Retry logic for GATT errors
        let success = false;
        for (let retry = 0; retry < MAX_RETRIES && !success; retry++) {
          try {
            await this.dataChar.writeValueWithoutResponse(chunk);
            success = true;
          } catch (e) {
            if (retry < MAX_RETRIES - 1) {
              this.log(`  Retry ${retry + 1}/${MAX_RETRIES} at offset ${i}...`);
              await new Promise(r => setTimeout(r, 50 * (retry + 1)));  // Backoff
            } else {
              throw e;  // Give up after max retries
            }
          }
        }
        
        await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
        
        const pct = Math.floor(((i + chunk.length) / totalBytes) * 100);
        this.callbacks.onProgress?.(pct, i + chunk.length, totalBytes);
        
        // Log every ~16% like Python does
        if (pct >= lastLogPct + 16) {
          this.log(`  [${pct.toString().padStart(3)}%]`);
          lastLogPct = pct;
        }
      }
      
      const elapsed = (Date.now() - startTime) / 1000;
      this.log('');
      this.log(`Transfer: ${totalBytes} bytes in ${elapsed.toFixed(2)}s`);

      // Wait for response (2 seconds like Python)
      this.log('');
      this.log('Waiting for response...');
      await new Promise(r => setTimeout(r, 2000));
      
      this.log(`Notifications: ${JSON.stringify(this.notifications)}`);

      // Check for success/failure (same logic as Python)
      const hasComplete = this.notifications.some(n => n.toLowerCase().includes('complete'));
      const hasFail = this.notifications.some(n => n.toLowerCase().includes('fail'));
      
      if (hasComplete) {
        this.log('');
        this.log('*** SUCCESS! ***');
        this.callbacks.onUploadComplete?.(true);
        return true;
      } else if (hasFail) {
        this.log('');
        this.log('[X] FAILED');
        this.callbacks.onUploadComplete?.(false);
        return false;
      } else {
        this.log('');
        this.log('[?] No notification - check if screen updated!');
        this.callbacks.onUploadComplete?.(true);  // Assume success like Python
        return true;
      }
    } catch (error) {
      this.log(`Error: ${(error as Error).message}`);
      this.callbacks.onError?.(error as Error);
      return false;
    } finally {
      if (this._state === 'uploading') {
        this.setState('connected');
      }
    }
  }
}

// Singleton instance
export const bleService = new DottBleService();
