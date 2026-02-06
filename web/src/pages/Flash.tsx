import { useState, useCallback } from 'react';
import { Upload, Zap, AlertTriangle, Loader2, Check, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

// DFU Service UUIDs for Nordic DFU
const DFU_SERVICE_UUID = '0000fe59-0000-1000-8000-00805f9b34fb';
const DFU_CONTROL_UUID = '8ec90001-f315-4f60-9fb8-838830daea50';
const DFU_PACKET_UUID = '8ec90002-f315-4f60-9fb8-838830daea50';

// Alternative: McuMgr SMP service (used by MCUboot)
const SMP_SERVICE_UUID = '8d53dc1d-1db7-4cd3-868b-8a527460aa84';
const SMP_CHAR_UUID = 'da2e7828-fbce-4e01-ae9e-261174997c48';

type FlashState = 'idle' | 'connecting' | 'connected' | 'flashing' | 'success' | 'error';

export function FlashPage() {
  const [state, setState] = useState<FlashState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [firmware, setFirmware] = useState<File | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFirmware(file);
      addLog(`Selected firmware: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    }
  };

  const connectAndFlash = useCallback(async () => {
    if (!firmware) {
      setError('Please select a firmware file first');
      return;
    }

    try {
      setState('connecting');
      setError(null);
      addLog('Scanning for DFU devices...');

      // Try to find device with DFU or SMP service
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Dott' },
          { services: [DFU_SERVICE_UUID] },
          { services: [SMP_SERVICE_UUID] },
        ],
        optionalServices: [DFU_SERVICE_UUID, SMP_SERVICE_UUID, DFU_CONTROL_UUID, DFU_PACKET_UUID, SMP_CHAR_UUID],
      });

      setDeviceName(device.name || 'Unknown Device');
      addLog(`Found device: ${device.name}`);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');
      
      addLog('Connected to GATT server');
      setState('connected');

      // Try to find DFU service
      let service;
      let useSmp = false;
      
      try {
        service = await server.getPrimaryService(DFU_SERVICE_UUID);
        addLog('Found Nordic DFU service');
      } catch {
        try {
          service = await server.getPrimaryService(SMP_SERVICE_UUID);
          addLog('Found MCUboot SMP service');
          useSmp = true;
        } catch {
          throw new Error('No DFU service found. Device may not be in bootloader mode.');
        }
      }

      // Read firmware file
      const firmwareData = new Uint8Array(await firmware.arrayBuffer());
      addLog(`Firmware size: ${firmwareData.length} bytes`);

      setState('flashing');
      addLog('Starting firmware upload...');

      if (useSmp) {
        // MCUboot SMP protocol
        await flashViaSmp(service, firmwareData, setProgress, addLog);
      } else {
        // Nordic DFU protocol
        await flashViaDfu(service, firmwareData, setProgress, addLog);
      }

      setState('success');
      addLog('✓ Firmware upload complete!');
      
    } catch (err) {
      setState('error');
      const msg = (err as Error).message;
      setError(msg);
      addLog(`✗ Error: ${msg}`);
    }
  }, [firmware]);

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
              <Zap className="w-6 h-6 text-yellow-500" />
              Firmware Flash
            </h1>
            <p className="text-zinc-400 text-sm">Upload firmware directly to your DOTT</p>
          </div>
        </div>

        {/* Instructions */}
        <div className="mb-6 p-4 rounded-xl bg-blue-500/20 border border-blue-500/50 text-blue-400">
          <div className="font-medium mb-2">📋 How to Flash</div>
          <ol className="text-sm space-y-1 list-decimal list-inside">
            <li>Put your DOTT in <strong>bootloader mode</strong> (tap the two pins on PCB)</li>
            <li>Device will advertise as "Dott_V2_Atin"</li>
            <li>Download the firmware below (or select your own)</li>
            <li>Click "Flash Firmware"</li>
          </ol>
        </div>

        {/* Download firmware */}
        <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="font-medium mb-2">📦 OpenDOTT Firmware</div>
          <div className="flex items-center gap-4">
            <a 
              href="/opendott-firmware.bin" 
              download="opendott-firmware.bin"
              className="px-4 py-2 rounded-lg bg-green-500 text-white font-medium hover:bg-green-600 transition-colors"
            >
              Download opendott-firmware.bin
            </a>
            <span className="text-sm text-zinc-400">~193 KB</span>
          </div>
        </div>

        {/* Warning */}
        <div className="mb-6 p-4 rounded-xl bg-yellow-500/20 border border-yellow-500/50 text-yellow-400">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">⚠️ Warning</div>
              <div className="text-sm mt-1">
                Flashing incorrect firmware can brick your device. If signature verification fails,
                you may need to use SWD (J6 pads) to recover.
              </div>
            </div>
          </div>
        </div>

        {/* File selection */}
        <div className="mb-6">
          <label className="block mb-2 font-medium">Firmware File (.bin)</label>
          <div className="relative">
            <input
              type="file"
              accept=".bin"
              onChange={handleFileSelect}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className={cn(
              "p-4 rounded-xl border-2 border-dashed text-center transition-colors",
              firmware ? "border-green-500 bg-green-500/10" : "border-zinc-700 hover:border-zinc-500"
            )}>
              {firmware ? (
                <div className="text-green-400">
                  <Check className="w-6 h-6 mx-auto mb-2" />
                  {firmware.name} ({(firmware.size / 1024).toFixed(1)} KB)
                </div>
              ) : (
                <div className="text-zinc-400">
                  <Upload className="w-6 h-6 mx-auto mb-2" />
                  Click or drag to select firmware
                </div>
              )}
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
        {state === 'flashing' && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span>Uploading...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Flash button */}
        <button
          onClick={connectAndFlash}
          disabled={!firmware || state === 'connecting' || state === 'flashing'}
          className={cn(
            "w-full py-4 rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-2",
            state === 'success' 
              ? "bg-green-500 text-white"
              : "bg-blue-500 hover:bg-blue-600 text-white",
            (!firmware || state === 'connecting' || state === 'flashing') && "opacity-50 cursor-not-allowed"
          )}
        >
          {state === 'connecting' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Connecting...
            </>
          ) : state === 'flashing' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Flashing...
            </>
          ) : state === 'success' ? (
            <>
              <Check className="w-5 h-5" />
              Flash Complete!
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Connect & Flash
            </>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="mt-4 p-4 rounded-xl bg-red-500/20 border border-red-500/50 text-red-400">
            {error}
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="mt-6">
            <div className="text-sm font-medium text-zinc-400 mb-2">Log</div>
            <div className="bg-zinc-900 rounded-xl p-4 font-mono text-xs max-h-48 overflow-y-auto">
              {log.map((line, i) => (
                <div key={i} className="text-zinc-300">{line}</div>
              ))}
            </div>
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
