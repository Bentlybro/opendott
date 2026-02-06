import { Bluetooth, BluetoothOff, Loader2, BatteryLow, BatteryMedium, BatteryFull, Info } from 'lucide-react';
import type { ConnectionState, DeviceInfo } from '../lib/ble';
import { cn } from '../lib/utils';

interface DeviceStatusProps {
  state: ConnectionState;
  deviceName?: string;
  deviceInfo?: DeviceInfo | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

function BatteryIcon({ level }: { level: number }) {
  if (level <= 20) return <BatteryLow className="w-4 h-4 text-red-400" />;
  if (level <= 50) return <BatteryMedium className="w-4 h-4 text-yellow-400" />;
  return <BatteryFull className="w-4 h-4 text-green-400" />;
}

export function DeviceStatus({ state, deviceName, deviceInfo, onConnect, onDisconnect }: DeviceStatusProps) {
  const isConnecting = state === 'connecting';
  const isConnected = state === 'connected' || state === 'uploading';

  return (
    <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
      <div className="flex items-center gap-4">
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center",
          isConnected ? "bg-green-500/20 text-green-400" : "bg-zinc-800 text-zinc-400"
        )}>
          {isConnecting ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : isConnected ? (
            <Bluetooth className="w-6 h-6" />
          ) : (
            <BluetoothOff className="w-6 h-6" />
          )}
        </div>
        
        <div className="flex-1">
          <div className="font-medium text-white">
            {isConnected ? deviceName || 'DOTT Device' : 'No Device Connected'}
          </div>
          <div className="text-sm text-zinc-400">
            {isConnecting ? 'Connecting...' : isConnected ? 'Ready to upload' : 'Click to connect'}
          </div>
        </div>
        
        <button
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={isConnecting}
          className={cn(
            "px-4 py-2 rounded-lg font-medium transition-colors",
            isConnected 
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" 
              : "bg-blue-500 text-white hover:bg-blue-600",
            isConnecting && "opacity-50 cursor-not-allowed"
          )}
        >
          {isConnecting ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect'}
        </button>
      </div>
      
      {/* Device Info */}
      {isConnected && deviceInfo && (
        <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {deviceInfo.batteryLevel !== undefined && (
            <div className="flex items-center gap-2">
              <BatteryIcon level={deviceInfo.batteryLevel} />
              <span className="text-sm text-zinc-300">{deviceInfo.batteryLevel}%</span>
            </div>
          )}
          
          {deviceInfo.firmwareVersion && (
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-300">v{deviceInfo.firmwareVersion}</span>
            </div>
          )}
          
          {deviceInfo.modelNumber && (
            <div className="text-sm text-zinc-400">
              Model: {deviceInfo.modelNumber}
            </div>
          )}
          
          {deviceInfo.manufacturer && (
            <div className="text-sm text-zinc-400">
              {deviceInfo.manufacturer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
