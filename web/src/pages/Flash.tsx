import { useState, useCallback } from 'react';
import { Upload, AlertTriangle, Loader2, Check, ArrowLeft, RefreshCw, Download, ChevronRight, ChevronDown, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { SMPClient, SMP_SERVICE_UUID } from '../lib/smp';

// Embedded firmware URL (bundled in public/)
const OFFICIAL_FIRMWARE_URL = '/release2.0.bin';

type FlashState = 'idle' | 'loading-firmware' | 'connecting' | 'uploading' | 'confirming' | 'success' | 'error';

export function FlashPage() {
  const [state, setState] = useState<FlashState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [useCustomFirmware, setUseCustomFirmware] = useState(false);
  const [customFirmware, setCustomFirmware] = useState<File | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

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
      setProgress(0);
      
      // Get firmware data
      let firmwareData: Uint8Array;
      if (useCustomFirmware && customFirmware) {
        firmwareData = new Uint8Array(await customFirmware.arrayBuffer());
        addLog(`Using custom firmware: ${customFirmware.name}`);
      } else {
        firmwareData = await loadOfficialFirmware();
      }
      
      setState('connecting');
      setStatusMessage('Select your DOTT from the list...');
      addLog('Scanning for DOTT devices...');

      // Request device with SMP service
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Dott' },
        ],
        optionalServices: [SMP_SERVICE_UUID],
      });

      setDeviceName(device.name || 'Unknown Device');
      addLog(`Found device: ${device.name}`);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');
      
      addLog('Connected to GATT server');

      // Create SMP client
      const smp = new SMPClient();
      smp.setCallbacks({
        onLog: addLog,
      });

      // Try to connect via SMP
      const smpConnected = await smp.connect(server);
      
      if (!smpConnected) {
        throw new Error('SMP service not found. Your DOTT may need to be updated using the nRF Connect app first.');
      }

      // List current images
      addLog('Checking current firmware...');
      const images = await smp.listImages();
      
      if (images) {
        addLog(`Found ${images.length} firmware slot(s):`);
        for (const img of images) {
          addLog(`  Slot ${img.slot}: v${img.version} ${img.active ? '(active)' : ''} ${img.confirmed ? '(confirmed)' : ''}`);
        }
      }

      // Upload firmware
      setState('uploading');
      setStatusMessage('Uploading firmware...');
      
      const uploadResult = await smp.uploadImage(firmwareData, (percent) => {
        setProgress(percent);
        setStatusMessage(`Uploading firmware... ${percent}%`);
      });

      if (!uploadResult.success) {
        throw new Error('Firmware upload failed. Please try again.');
      }

      // Mark the new image for test boot
      setState('confirming');
      setStatusMessage('Marking firmware for boot...');
      
      // First try to get the hash from image list
      addLog('Checking uploaded firmware...');
      const newImages = await smp.listImages();
      
      let imageHash: Uint8Array | null = null;
      
      if (newImages && newImages.length >= 1) {
        // Find the non-active slot (where we just uploaded)
        const newImage = newImages.find(img => !img.active);
        if (newImage) {
          addLog(`Found uploaded firmware in slot ${newImage.slot}`);
          imageHash = newImage.hash;
        }
      }
      
      // If we couldn't get hash from image list, use our computed hash
      if (!imageHash && uploadResult.hash) {
        addLog('Using computed firmware hash');
        imageHash = uploadResult.hash;
      }
      
      if (imageHash) {
        addLog('Marking new firmware for boot...');
        const testSuccess = await smp.testImage(imageHash);
        if (!testSuccess) {
          addLog('Warning: Failed to mark image for test - device may not boot new firmware');
        }
      } else {
        addLog('Warning: No hash available - skipping image test');
      }

      // Reset device to boot new firmware
      addLog('Restarting device with new firmware...');
      await smp.reset();

      setState('success');
      setStatusMessage('');
      addLog('Firmware update complete! Your DOTT will restart with the new firmware.');
      
    } catch (err) {
      setState('error');
      const msg = (err as Error).message;
      
      // Make error messages friendlier
      if (msg.includes('User cancelled') || msg.includes('User canceled')) {
        setError('Connection cancelled. Click "Update Now" to try again.');
      } else if (msg.includes('SMP service not found') || msg.includes('No Services')) {
        setError('Your DOTT needs a firmware update first. Please use the nRF Connect app to flash the initial firmware, then come back here for future updates.');
      } else if (msg.includes('not found')) {
        setError('DOTT not found. Make sure it\'s turned on and nearby.');
      } else {
        setError(msg);
      }
      addLog(`Error: ${msg}`);
    }
  }, [useCustomFirmware, customFirmware]);

  const reset = () => {
    setState('idle');
    setError(null);
    setProgress(0);
    setDeviceName(null);
    setLog([]);
    setStatusMessage('');
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
            <p className="text-green-300 mb-4">
              Firmware uploaded successfully! Your DOTT should restart automatically.
            </p>
            <p className="text-zinc-400 text-sm mb-6">
              If it doesn't restart within 30 seconds, try turning it off and on again manually.
            </p>
            <div className="flex gap-4 justify-center">
              <a
                href="/"
                className="px-6 py-3 rounded-lg bg-green-500 text-black font-bold hover:bg-green-400 transition-colors"
              >
                Upload Images
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
            {(state === 'uploading' || state === 'loading-firmware' || state === 'connecting' || state === 'confirming') && (
              <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="flex justify-between text-sm mb-2">
                  <span>{statusMessage || 'Processing...'}</span>
                  {state === 'uploading' && <span>{progress}%</span>}
                </div>
                <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-300",
                      state === 'uploading' ? "bg-blue-500" : "bg-blue-500/50 animate-pulse"
                    )}
                    style={{ width: state === 'uploading' ? `${progress}%` : '100%' }}
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
                    {error.includes('nRF Connect') && (
                      <div className="mt-3 p-3 rounded-lg bg-zinc-900/50 text-zinc-300 text-sm">
                        <div className="font-medium mb-2">First-time setup required:</div>
                        <ol className="list-decimal list-inside space-y-1">
                          <li>Download "nRF Connect" app on your phone</li>
                          <li>Connect to your DOTT device</li>
                          <li>Tap the DFU button (icon with arrows)</li>
                          <li>Select the firmware file</li>
                          <li>After that, you can use this website for future updates</li>
                        </ol>
                        <a
                          href="https://play.google.com/store/apps/details?id=no.nordicsemi.android.mcp"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-3 text-blue-400 hover:underline"
                        >
                          Get nRF Connect for Android
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Main Update Button */}
            <button
              onClick={connectAndFlash}
              disabled={state === 'connecting' || state === 'uploading' || state === 'loading-firmware' || state === 'confirming'}
              className={cn(
                "w-full py-4 rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-2",
                "bg-gradient-to-r from-yellow-500 to-orange-500 text-black hover:from-yellow-400 hover:to-orange-400",
                (state === 'connecting' || state === 'uploading' || state === 'loading-firmware' || state === 'confirming') && "opacity-70 cursor-not-allowed"
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
              ) : state === 'uploading' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Uploading ({progress}%)...
                </>
              ) : state === 'confirming' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Finalizing...
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
            <div className="mt-8 border-t border-zinc-800 pt-6">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <Settings className="w-4 h-4" />
                Advanced Options
              </button>
              
              {showAdvanced && (
                <div className="mt-4 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
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
                        "p-3 rounded-lg border border-dashed text-center text-sm transition-colors",
                        customFirmware ? "border-green-500/50 bg-green-500/10" : "border-zinc-700 hover:border-zinc-600"
                      )}>
                        {customFirmware ? (
                          <div className="text-green-400 flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            {customFirmware.name} ({(customFirmware.size / 1024).toFixed(1)} KB)
                          </div>
                        ) : (
                          <div className="text-zinc-500 flex items-center justify-center gap-2">
                            <Upload className="w-4 h-4" />
                            Select custom firmware file
                          </div>
                        )}
                      </div>
                    </div>
                    {customFirmware && (
                      <button
                        onClick={() => { setCustomFirmware(null); setUseCustomFirmware(false); }}
                        className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                      >
                        <ArrowLeft className="w-3 h-3" />
                        Use official firmware instead
                      </button>
                    )}
                  </div>

                  {/* Warning */}
                  <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500/80 text-sm flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Custom firmware can brick your device if it's not compatible.</span>
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

export default FlashPage;
