import { Github, Zap, Shield, Smartphone } from 'lucide-react';
import { useBle } from './hooks/useBle';
import { DeviceStatus } from './components/DeviceStatus';
import { ImageUploader } from './components/ImageUploader';

function App() {
  const { state, isConnected, isUploading, deviceName, deviceInfo, progress, error, logs, connect, disconnect, uploadImage, clearError } = useBle();

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg">OpenDOTT</h1>
              <p className="text-xs text-zinc-500">Open-source firmware</p>
            </div>
          </div>
          
          <a
            href="https://github.com/Bentlybro/opendott"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors"
          >
            <Github className="w-4 h-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Control Your DOTT
          </h2>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Upload images and GIFs directly from your browser. 
            No app needed—just connect via Bluetooth.
          </p>
        </div>

        {/* Web Bluetooth support check */}
        {!navigator.bluetooth && (
          <div className="mb-8 p-4 rounded-xl bg-yellow-500/20 border border-yellow-500/50 text-yellow-400">
            <strong>Web Bluetooth not supported</strong>
            <p className="text-sm mt-1">
              Please use Chrome, Edge, or Opera on desktop. Safari and Firefox don't support Web Bluetooth.
            </p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mb-8 p-4 rounded-xl bg-red-500/20 border border-red-500/50 text-red-400 flex items-center justify-between">
            <span>{error.message}</span>
            <button onClick={clearError} className="text-red-300 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Device status */}
        <div className="mb-8">
          <DeviceStatus
            state={state}
            deviceName={deviceName}
            deviceInfo={deviceInfo}
            onConnect={connect}
            onDisconnect={disconnect}
          />
        </div>

        {/* First-time setup notice */}
        {isConnected && deviceInfo?.firmwareVersion === '0.0.0' && (
          <div className="mb-8 p-4 rounded-xl bg-yellow-500/20 border border-yellow-500/50">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-yellow-400">Firmware Update Required</div>
                <div className="text-sm text-yellow-300 mt-1">
                  Your DOTT has blank firmware. You need to flash the official firmware first before uploading images.
                </div>
                <a
                  href="/flash"
                  className="inline-block mt-3 px-4 py-2 rounded-lg bg-yellow-500 text-black font-medium hover:bg-yellow-400 transition-colors"
                >
                  Flash Firmware →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Image uploader */}
        <div className="mb-8">
          <h3 className="text-xl font-semibold mb-4">Upload Image</h3>
          <ImageUploader
            isConnected={isConnected}
            isUploading={isUploading}
            progress={progress}
            onUpload={uploadImage}
          />
        </div>

        {/* Debug log */}
        {logs.length > 0 && (
          <div className="mb-12">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Transfer Log</h3>
            <div className="bg-zinc-900 rounded-xl p-4 font-mono text-xs max-h-48 overflow-y-auto border border-zinc-800">
              {logs.map((line, i) => (
                <div key={i} className="text-zinc-300">{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Features */}
        <div className="grid sm:grid-cols-3 gap-6 mb-12">
          <FeatureCard
            icon={<Bluetooth className="w-6 h-6" />}
            title="Wireless Upload"
            description="Connect via Bluetooth directly from your browser"
          />
          <FeatureCard
            icon={<Shield className="w-6 h-6" />}
            title="Safe & Validated"
            description="Image validation prevents bricking your device"
          />
          <FeatureCard
            icon={<Smartphone className="w-6 h-6" />}
            title="No App Needed"
            description="Works on any computer with Web Bluetooth"
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-6">
        <div className="max-w-4xl mx-auto px-4 text-center text-zinc-500 text-sm">
          <p>
            OpenDOTT — Open-source software.{' '}
            <a href="https://github.com/Bentlybro/opendott" className="text-blue-400 hover:underline">
              View on GitHub
            </a>
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            Build: {__BUILD_TIME__}
          </p>
        </div>
      </footer>
    </div>
  );
}

function Bluetooth({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 7 10 10-5 5V2l5 5L7 17" />
    </svg>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800">
      <div className="w-12 h-12 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h4 className="font-semibold mb-2">{title}</h4>
      <p className="text-sm text-zinc-400">{description}</p>
    </div>
  );
}

export default App;
