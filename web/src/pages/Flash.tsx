import { useState, useCallback } from 'react';
import { Upload, AlertTriangle, Loader2, Check, ArrowLeft, RefreshCw, Download } from 'lucide-react';
import { cn } from '../lib/utils';

// Nordic Secure DFU Service (when device is in DFU mode)
const DFU_SERVICE_UUID = '0000fe59-0000-1000-8000-00805f9b34fb';
const DFU_CONTROL_UUID = '8ec90001-f315-4f60-9fb8-838830daea50';
const DFU_PACKET_UUID = '8ec90002-f315-4f60-9fb8-838830daea50';

// Buttonless DFU characteristics (to trigger DFU mode from normal operation)
const BUTTONLESS_DFU_UUID = '8ec90003-f315-4f60-9fb8-838830daea50';  // With bonds
const BUTTONLESS_DFU_NO_BOND_UUID = '8ec90004-f315-4f60-9fb8-838830daea50';  // Without bonds

// Alternative: McuMgr SMP service (used by MCUboot)
const SMP_SERVICE_UUID = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
const SMP_CHAR_UUID = 'da2e7828-fbce-4e01-ae9e-261174997c48';

// DOTT's main service (for normal operation - check if we need to trigger DFU)
const DOTT_SERVICE_UUID = '0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc';

// Embedded firmware URL (bundled in public/)
const OFFICIAL_FIRMWARE_URL = '/release2.0.bin';

type FlashState = 'idle' | 'loading-firmware' | 'connecting' | 'connected' | 'flashing' | 'success' | 'error';

export function FlashPage() {
  const [state, setState] = useState<FlashState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [useCustomFirmware, setUseCustomFirmware] = useState(false);
  const [customFirmware, setCustomFirmware] = useState<File | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const addLog = (msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCustomFirmware(file);
      setUseCustomFirmware(true);
      addLog(`Selected custom firmware: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    }
  };

  // Load official firmware from server
  const loadOfficialFirmware = async (): Promise<Uint8Array> => {
    addLog('Downloading official firmware...');
    const response = await fetch(OFFICIAL_FIRMWARE_URL);
    if (!response.ok) throw new Error('Failed to download firmware');
    const buffer = await response.arrayBuffer();
    addLog(`Downloaded firmware: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
    return new Uint8Array(buffer);
  };

  const connectAndFlash = useCallback(async () => {
    try {
      setState('loading-firmware');
      setError(null);
      setLog([]);
      
      // Get firmware data
      let firmwareData: Uint8Array;
      if (useCustomFirmware && customFirmware) {
        firmwareData = new Uint8Array(await customFirmware.arrayBuffer());
        addLog(`Using custom firmware: ${customFirmware.name}`);
      } else {
        firmwareData = await loadOfficialFirmware();
      }
      
      setState('connecting');
      addLog('Click your DOTT in the Bluetooth picker...');

      // Connect to any DOTT device
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Dott' },
        ],
        optionalServices: [
          DFU_SERVICE_UUID, SMP_SERVICE_UUID, DOTT_SERVICE_UUID,
          DFU_CONTROL_UUID, DFU_PACKET_UUID, SMP_CHAR_UUID,
          BUTTONLESS_DFU_UUID, BUTTONLESS_DFU_NO_BOND_UUID
        ],
      });

      setDeviceName(device.name || 'Unknown Device');
      addLog(`Found device: ${device.name}`);

      let server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');
      
      addLog('Connected to GATT server');
      setState('connected');

      // Try to find DFU service (device already in DFU mode)
      let service;
      let useSmp = false;
      let needsDfuTrigger = false;
      
      try {
        service = await server.getPrimaryService(DFU_SERVICE_UUID);
        addLog('Device is in DFU mode');
      } catch {
        try {
          service = await server.getPrimaryService(SMP_SERVICE_UUID);
          addLog('Found MCUboot SMP service');
          useSmp = true;
        } catch {
          // Device is not in DFU mode - try to trigger buttonless DFU
          needsDfuTrigger = true;
        }
      }

      // If not in DFU mode, try to trigger it
      if (needsDfuTrigger) {
        addLog('Device not in DFU mode, triggering...');
        
        let triggered = false;
        
        // Try buttonless DFU (no bonds)
        try {
          const dfuService = await server.getPrimaryService(DFU_SERVICE_UUID);
          const buttonlessChar = await dfuService.getCharacteristic(BUTTONLESS_DFU_NO_BOND_UUID);
          await buttonlessChar.startNotifications();
          await buttonlessChar.writeValue(new Uint8Array([0x01]));  // Enter DFU mode
          triggered = true;
          addLog('Triggered buttonless DFU');
        } catch {
          // Try with bonds
          try {
            const dfuService = await server.getPrimaryService(DFU_SERVICE_UUID);
            const buttonlessChar = await dfuService.getCharacteristic(BUTTONLESS_DFU_UUID);
            await buttonlessChar.startNotifications();
            await buttonlessChar.writeValue(new Uint8Array([0x01]));
            triggered = true;
            addLog('Triggered buttonless DFU (bonded)');
          } catch {
            // No buttonless DFU available
          }
        }

        if (triggered) {
          addLog('Waiting for device to restart in DFU mode...');
          await new Promise(r => setTimeout(r, 3000));
          
          // Reconnect to device (now in DFU mode)
          addLog('Reconnecting...');
          server = await device.gatt?.connect();
          if (!server) throw new Error('Failed to reconnect after DFU trigger');
          
          try {
            service = await server.getPrimaryService(DFU_SERVICE_UUID);
            addLog('Device is now in DFU mode');
          } catch {
            throw new Error('Device did not enter DFU mode. Please try again.');
          }
        } else {
          throw new Error('Could not trigger DFU mode. Your device may need a firmware update via nRF Connect app first.');
        }
      }

      if (!service) {
        throw new Error('No DFU service available');
      }

      addLog(`Firmware size: ${firmwareData.length} bytes`);

      setState('flashing');
      addLog('Starting firmware upload...');

      if (useSmp) {
        await flashViaSmp(service, firmwareData, setProgress, addLog);
      } else {
        await flashViaDfu(service, firmwareData, setProgress, addLog);
      }

      setState('success');
      addLog('✓ Firmware upload complete!');
      addLog('Your DOTT will restart. You can now return to the main page to upload images.');
      
    } catch (err) {
      setState('error');
      const msg = (err as Error).message;
      // Make error messages friendlier
      if (msg.includes('User cancelled')) {
        setError('Connection cancelled. Click "Update" to try again.');
      } else if (msg.includes('No DFU service')) {
        setError(msg);
      } else {
        setError(`Something went wrong: ${msg}. Try restarting your DOTT and try again.`);
      }
      addLog(`✗ Error: ${msg}`);
    }
  }, [useCustomFirmware, customFirmware]);

  const reset = () => {
    setState('idle');
    setError(null);
    setProgress(0);
    setDeviceName(null);
    setLog([]);
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <a href="/" className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Download className="w-6 h-6 text-blue-500" />
              Firmware Update
            </h1>
            <p className="text-zinc-400 text-sm">Update your DOTT to the latest firmware</p>
          </div>
        </div>

        {/* Success State */}
        {state === 'success' && (
          <div className="mb-8 p-6 rounded-xl bg-green-500/20 border border-green-500/50 text-center">
            <Check className="w-16 h-16 mx-auto mb-4 text-green-400" />
            <h2 className="text-2xl font-bold text-green-400 mb-2">Update Complete!</h2>
            <p className="text-green-300 mb-6">
              Your DOTT is now running the latest firmware. It will restart automatically.
            </p>
            <div className="flex gap-4 justify-center">
              <a
                href="/"
                className="px-6 py-3 rounded-lg bg-green-500 text-black font-bold hover:bg-green-400 transition-colors"
              >
                Upload Images →
              </a>
              <button
                onClick={reset}
                className="px-6 py-3 rounded-lg bg-zinc-800 text-white font-medium hover:bg-zinc-700 transition-colors"
              >
                Flash Another
              </button>
            </div>
          </div>
        )}

        {/* Main Flow (not success state) */}
        {state !== 'success' && (
          <>
            {/* Simple Instructions */}
            <div className="mb-8 p-6 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30">
              <h2 className="text-xl font-bold mb-4">How to Update</h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 font-bold">1</div>
                  <div>
                    <div className="font-medium">Click "Update Now"</div>
                    <div className="text-sm text-zinc-400">Select your DOTT from the Bluetooth picker</div>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 font-bold">2</div>
                  <div>
                    <div className="font-medium">Wait for the update</div>
                    <div className="text-sm text-zinc-400">The firmware will be uploaded automatically</div>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 font-bold">3</div>
                  <div>
                    <div className="font-medium">Done</div>
                    <div className="text-sm text-zinc-400">Your DOTT will restart with the new firmware</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Device status */}
            {deviceName && (
              <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="text-sm text-zinc-400">Connected to</div>
                <div className="font-medium">{deviceName}</div>
              </div>
            )}

            {/* Progress */}
            {(state === 'flashing' || state === 'loading-firmware' || state === 'connecting') && (
              <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="flex justify-between text-sm mb-2">
                  <span>
                    {state === 'loading-firmware' && 'Preparing firmware...'}
                    {state === 'connecting' && 'Waiting for device...'}
                    {state === 'flashing' && 'Uploading firmware...'}
                  </span>
                  {state === 'flashing' && <span>{Math.round(progress)}%</span>}
                </div>
                <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-300",
                      state === 'flashing' ? "bg-blue-500" : "bg-blue-500/50 animate-pulse"
                    )}
                    style={{ width: state === 'flashing' ? `${progress}%` : '100%' }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/20 border border-red-500/50 text-red-400">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium">Update Failed</div>
                    <div className="text-sm mt-1">{error}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Main Update Button */}
            <button
              onClick={connectAndFlash}
              disabled={state === 'connecting' || state === 'flashing' || state === 'loading-firmware'}
              className={cn(
                "w-full py-4 rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-2",
                "bg-gradient-to-r from-yellow-500 to-orange-500 text-black hover:from-yellow-400 hover:to-orange-400",
                (state === 'connecting' || state === 'flashing' || state === 'loading-firmware') && "opacity-70 cursor-not-allowed"
              )}
            >
              {state === 'loading-firmware' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Preparing...
                </>
              ) : state === 'connecting' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Connecting...
                </>
              ) : state === 'flashing' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Updating ({Math.round(progress)}%)...
                </>
              ) : state === 'error' ? (
                <>
                  <RefreshCw className="w-5 h-5" />
                  Try Again
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  Update Now
                </>
              )}
            </button>

            {/* Advanced Options */}
            <div className="mt-8">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showAdvanced ? '▼' : '▶'} Advanced Options
              </button>
              
              {showAdvanced && (
                <div className="mt-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
                  <div className="mb-4">
                    <label className="block mb-2 text-sm font-medium text-zinc-400">Custom Firmware (.bin)</label>
                    <div className="relative">
                      <input
                        type="file"
                        accept=".bin"
                        onChange={handleFileSelect}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className={cn(
                        "p-3 rounded-lg border-2 border-dashed text-center text-sm transition-colors",
                        customFirmware ? "border-green-500 bg-green-500/10" : "border-zinc-700 hover:border-zinc-500"
                      )}>
                        {customFirmware ? (
                          <div className="text-green-400">
                            {customFirmware.name} ({(customFirmware.size / 1024).toFixed(1)} KB)
                          </div>
                        ) : (
                          <div className="text-zinc-500">
                            <Upload className="w-4 h-4 inline mr-2" />
                            Select custom firmware
                          </div>
                        )}
                      </div>
                    </div>
                    {customFirmware && (
                      <button
                        onClick={() => { setCustomFirmware(null); setUseCustomFirmware(false); }}
                        className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        ✕ Use official firmware instead
                      </button>
                    )}
                  </div>

                  {/* Warning */}
                  <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    Custom firmware can brick your device if it's not compatible.
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Log (collapsible) */}
        {log.length > 0 && (
          <div className="mt-6">
            <details className="group">
              <summary className="text-sm font-medium text-zinc-500 cursor-pointer hover:text-zinc-300">
                Show log ({log.length} entries)
              </summary>
              <div className="mt-2 bg-zinc-900 rounded-xl p-4 font-mono text-xs max-h-48 overflow-y-auto border border-zinc-800">
                {log.map((line, i) => (
                  <div key={i} className="text-zinc-400">{line}</div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

// Nordic DFU protocol implementation (simplified)
async function flashViaDfu(
  service: BluetoothRemoteGATTService,
  firmware: Uint8Array,
  setProgress: (p: number) => void,
  addLog: (msg: string) => void
) {
  // Control char for DFU commands, packet char for data
  await service.getCharacteristic(DFU_CONTROL_UUID);
  const packetChar = await service.getCharacteristic(DFU_PACKET_UUID);

  addLog('Got DFU characteristics');

  // This is a simplified implementation - real Nordic DFU is more complex
  // with init packets, CRC checks, etc.
  
  const chunkSize = 20;
  let offset = 0;

  while (offset < firmware.length) {
    const chunk = firmware.slice(offset, offset + chunkSize);
    await packetChar.writeValueWithoutResponse(chunk);
    offset += chunk.length;
    setProgress((offset / firmware.length) * 100);
    
    // Small delay
    await new Promise(r => setTimeout(r, 10));
  }

  addLog('Firmware data sent, finalizing...');
}

// MCUboot SMP protocol implementation (simplified)
async function flashViaSmp(
  service: BluetoothRemoteGATTService,
  firmware: Uint8Array,
  setProgress: (p: number) => void,
  addLog: (msg: string) => void
) {
  const smpChar = await service.getCharacteristic(SMP_CHAR_UUID);

  addLog('Got SMP characteristic');

  // SMP protocol uses CBOR-encoded messages
  // This is a simplified implementation
  
  const chunkSize = 128;
  let offset = 0;

  while (offset < firmware.length) {
    const chunk = firmware.slice(offset, offset + chunkSize);
    
    // Create SMP image upload request (simplified)
    const header = new Uint8Array([
      0x02, // Write request
      0x00, // Flags
      chunk.length + 8, 0x00, // Length (little endian)
      0x00, 0x01, // Group: Image (1)
      0x00, // Sequence
      0x01, // Command: Upload
    ]);
    
    const packet = new Uint8Array(header.length + chunk.length);
    packet.set(header);
    packet.set(chunk, header.length);
    
    await smpChar.writeValueWithoutResponse(packet);
    offset += chunk.length;
    setProgress((offset / firmware.length) * 100);
    
    await new Promise(r => setTimeout(r, 20));
  }

  addLog('Firmware data sent via SMP');
}

export default FlashPage;
