/**
 * OpenDOTT Web Bluetooth Service
 * Handles connection and image upload to DOTT wearable display
 * 
 * Protocol (from reverse engineering):
 * 1. Send trigger command (00401000) to initiate transfer
 * 2. Wait for indication (0xFFFFFFFF = ready)
 * 3. Send image data in chunks
 * 4. Wait for "Transfer Complete" notification
 */

// DOTT BLE Service and Characteristic UUIDs
const DOTT_SERVICE_UUID = '0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc';

// Characteristic UUIDs (from protocol analysis)
const CHAR_DATA_UUID = '00001525-0000-1000-8000-00805f9b34fb';      // Data write (handle 0x0017)
const CHAR_TRIGGER_UUID = '00001528-0000-1000-8000-00805f9b34fb';   // Trigger/ACK (handle 0x001d)
const CHAR_RESPONSE_UUID = '00001530-0000-1000-8000-00805f9b34fb';  // Response notifications

// Transfer settings
const CHUNK_SIZE = 20;  // Default MTU chunk size (conservative)
const CHUNK_DELAY_MS = 5;

// Trigger command value (from captured traffic)
const TRIGGER_COMMAND = new Uint8Array([0x00, 0x40, 0x10, 0x00]);  // 00401000

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'uploading';

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
  private responseChar: BluetoothRemoteGATTCharacteristic | null = null;
  private callbacks: BleCallbacks = {};
  private _state: ConnectionState = 'disconnected';
  private notifications: string[] = [];
  private waitingForIndication = false;
  private indicationResolve: ((value: boolean) => void) | null = null;

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
      this.log('Scanning for DOTT devices...');

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

      this.log(`Found device: ${this.device.name}`);

      // Listen for disconnection
      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      // Connect to GATT server
      this.log('Connecting to GATT server...');
      this.server = await this.device.gatt?.connect() ?? null;
      if (!this.server) {
        throw new Error('Failed to connect to GATT server');
      }

      // Get DOTT service
      this.log('Getting DOTT service...');
      this.service = await this.server.getPrimaryService(DOTT_SERVICE_UUID);

      // Get characteristics
      this.log('Getting characteristics...');
      this.dataChar = await this.service.getCharacteristic(CHAR_DATA_UUID);
      this.triggerChar = await this.service.getCharacteristic(CHAR_TRIGGER_UUID);
      
      try {
        this.responseChar = await this.service.getCharacteristic(CHAR_RESPONSE_UUID);
        await this.responseChar.startNotifications();
        this.responseChar.addEventListener('characteristicvaluechanged', this.handleResponseNotification.bind(this));
        this.log('Response notifications enabled');
      } catch {
        this.log('Response characteristic not available, using trigger for notifications');
      }

      // Enable notifications on trigger characteristic for indications
      await this.triggerChar.startNotifications();
      this.triggerChar.addEventListener('characteristicvaluechanged', this.handleTriggerNotification.bind(this));
      this.log('Trigger notifications enabled');

      this.setState('connected');
      this.log('Connected!');
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
    
    if (this.responseChar) {
      try {
        await this.responseChar.stopNotifications();
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
    this.responseChar = null;
    this.setState('disconnected');
    this.log('Disconnected');
  }

  private handleTriggerNotification(event: Event) {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    
    if (value) {
      const bytes = new Uint8Array(value.buffer);
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      this.log(`[NOTIFY trigger] ${hex}`);
      
      // Check for 0xFFFFFFFF indication (ready signal)
      if (value.byteLength >= 4) {
        const response = value.getUint32(0, true);
        if (response === 0xFFFFFFFF && this.waitingForIndication && this.indicationResolve) {
          this.log('Got ready indication (0xFFFFFFFF)');
          this.indicationResolve(true);
          this.indicationResolve = null;
          this.waitingForIndication = false;
        }
      }
    }
  }

  private handleResponseNotification(event: Event) {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    
    if (value) {
      const bytes = new Uint8Array(value.buffer);
      const text = new TextDecoder().decode(bytes);
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      this.log(`[NOTIFY response] ${hex} = '${text}'`);
      this.notifications.push(text);
      
      if (text === 'Transfer Complete') {
        this.callbacks.onUploadComplete?.(true);
      }
    }
  }

  private async waitForIndication(timeoutMs: number = 5000): Promise<boolean> {
    this.waitingForIndication = true;
    
    return new Promise((resolve) => {
      this.indicationResolve = resolve;
      
      setTimeout(() => {
        if (this.waitingForIndication) {
          this.waitingForIndication = false;
          this.indicationResolve = null;
          resolve(false);
        }
      }, timeoutMs);
    });
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
      
      this.log(`Starting upload of ${totalBytes} bytes`);
      this.log('============================================================');

      // Step 1: Send trigger command to initiate transfer
      this.log('Step 1: Sending trigger command (00401000)');
      await this.triggerChar.writeValueWithResponse(TRIGGER_COMMAND);
      this.log('Trigger sent, waiting for indication...');

      // Step 2: Wait for indication (0xFFFFFFFF)
      const gotIndication = await this.waitForIndication(5000);
      if (!gotIndication) {
        throw new Error('Timeout waiting for device ready indication');
      }

      // Step 3: Send image data in chunks
      this.log('Step 2: Sending image data...');
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

      this.log(`Transfer: ${totalBytes} bytes sent`);
      this.log('Waiting for Transfer Complete...');

      // Step 4: Wait for "Transfer Complete" notification
      const success = await new Promise<boolean>((resolve) => {
        // Check if we already got it
        if (this.notifications.includes('Transfer Complete')) {
          resolve(true);
          return;
        }

        // Wait for it
        const checkInterval = setInterval(() => {
          if (this.notifications.includes('Transfer Complete')) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 100);

        const timeout = setTimeout(() => {
          clearInterval(checkInterval);
          this.log('Timeout waiting for Transfer Complete');
          resolve(false);
        }, 10000);
      });

      if (success) {
        this.log('*** SUCCESS! ***');
        this.callbacks.onUploadComplete?.(true);
      } else {
        this.log('*** FAILED - no Transfer Complete received ***');
        this.callbacks.onUploadComplete?.(false);
      }

      return success;
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
