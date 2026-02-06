/**
 * OpenDOTT Web Bluetooth Service
 * Handles connection and image upload to DOTT wearable display
 */

// DOTT BLE Service and Characteristic UUIDs
const DOTT_SERVICE_UUID = '0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc';

// Characteristic UUIDs (derived from handles in protocol analysis)
const CHAR_DATA_UUID = '00001525-0000-1000-8000-00805f9b34fb';      // Data write
const CHAR_TRIGGER_UUID = '00001528-0000-1000-8000-00805f9b34fb';   // Trigger/ACK
// Reserved for future use:
// const CHAR_COMMAND_UUID = '00001526-0000-1000-8000-00805f9b34fb';   // Command
// const CHAR_STATUS_UUID = '00001527-0000-1000-8000-00805f9b34fb';    // Status
// const CHAR_DATA2_UUID = '00001529-0000-1000-8000-00805f9b34fb';     // Data notify
// const CHAR_RESPONSE_UUID = '00001530-0000-1000-8000-00805f9b34fb';  // Response

// Transfer settings
const CHUNK_SIZE = 244;  // MTU - 3 (for ATT header)
const CHUNK_DELAY_MS = 5;

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'uploading';

export interface BleCallbacks {
  onConnectionChange?: (state: ConnectionState) => void;
  onProgress?: (progress: number, bytesTransferred: number, totalBytes: number) => void;
  onError?: (error: Error) => void;
  onUploadComplete?: (success: boolean) => void;
}

class DottBleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private service: BluetoothRemoteGATTService | null = null;
  private dataChar: BluetoothRemoteGATTCharacteristic | null = null;
  private triggerChar: BluetoothRemoteGATTCharacteristic | null = null;
  private callbacks: BleCallbacks = {};
  private _state: ConnectionState = 'disconnected';

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected' || this._state === 'uploading';
  }

  get deviceName(): string | undefined {
    return this.device?.name;
  }

  setCallbacks(callbacks: BleCallbacks) {
    this.callbacks = callbacks;
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

      // Request device with DOTT service
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [DOTT_SERVICE_UUID] },
          { namePrefix: 'Dott' }
        ],
        optionalServices: [DOTT_SERVICE_UUID]
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

      // Get DOTT service
      this.service = await this.server.getPrimaryService(DOTT_SERVICE_UUID);

      // Get characteristics
      this.dataChar = await this.service.getCharacteristic(CHAR_DATA_UUID);
      this.triggerChar = await this.service.getCharacteristic(CHAR_TRIGGER_UUID);

      // Enable notifications on trigger characteristic
      await this.triggerChar.startNotifications();
      this.triggerChar.addEventListener('characteristicvaluechanged', this.handleTriggerNotification.bind(this));

      this.setState('connected');
      return true;
    } catch (error) {
      this.setState('disconnected');
      this.callbacks.onError?.(error as Error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.triggerChar) {
      try {
        await this.triggerChar.stopNotifications();
      } catch {
        // Ignore errors during cleanup
      }
    }

    if (this.server?.connected) {
      this.server.disconnect();
    }

    this.handleDisconnect();
  }

  private handleDisconnect() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.dataChar = null;
    this.triggerChar = null;
    this.setState('disconnected');
  }

  private uploadResolve: ((success: boolean) => void) | null = null;

  private handleTriggerNotification(event: Event) {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    
    if (value && value.byteLength >= 4) {
      const response = value.getUint32(0, true);
      // 0xFFFFFFFF indicates success
      const success = response === 0xFFFFFFFF;
      
      this.callbacks.onUploadComplete?.(success);
      
      if (this.uploadResolve) {
        this.uploadResolve(success);
        this.uploadResolve = null;
      }
    }
  }

  async uploadImage(data: Uint8Array): Promise<boolean> {
    if (!this.isConnected || !this.dataChar || !this.triggerChar) {
      this.callbacks.onError?.(new Error('Not connected to device'));
      return false;
    }

    try {
      this.setState('uploading');
      const totalBytes = data.length;

      // Send data in chunks
      let offset = 0;
      while (offset < totalBytes) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = data.slice(offset, chunkEnd);

        await this.dataChar.writeValueWithoutResponse(chunk);
        
        offset = chunkEnd;
        const progress = (offset / totalBytes) * 100;
        this.callbacks.onProgress?.(progress, offset, totalBytes);

        // Small delay between chunks
        if (offset < totalBytes) {
          await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY_MS));
        }
      }

      // Send trigger with file size (4 bytes, little-endian)
      const triggerData = new Uint8Array(4);
      const view = new DataView(triggerData.buffer);
      view.setUint32(0, totalBytes, true);  // little-endian
      
      await this.triggerChar.writeValueWithResponse(triggerData);

      // Wait for response
      return new Promise((resolve) => {
        this.uploadResolve = resolve;
        
        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.uploadResolve) {
            this.uploadResolve(false);
            this.uploadResolve = null;
            this.callbacks.onError?.(new Error('Upload timeout'));
          }
        }, 10000);
      });
    } catch (error) {
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
