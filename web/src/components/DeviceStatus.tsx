import { Bluetooth, BluetoothOff, Loader2 } from 'lucide-react';
import type { ConnectionState } from '../lib/ble';
import { cn } from '../lib/utils';

interface DeviceStatusProps {
  state: ConnectionState;
  deviceName?: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function DeviceStatus({ state, deviceName, onConnect, onDisconnect }: DeviceStatusProps) {
  const isConnecting = state === 'connecting';
  const isConnected = state === 'connected' || state === 'uploading';

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
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
  );
}
