import { Github, Zap, Shield, Smartphone, HelpCircle, User } from 'lucide-react';
import { useBle } from './hooks/useBle';
import { DeviceStatus } from './components/DeviceStatus';
import { ImageUploader } from './components/ImageUploader';

function App() {
  const { state, isConnected, isUploading, needsUpdate, deviceName, deviceInfo, progress, error, logs, connect, disconnect, uploadImage, clearError } = useBle();

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

        {/* Firmware update needed */}
        {needsUpdate && (
          <div className="mb-8 p-6 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/50">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-yellow-500/30 flex items-center justify-center flex-shrink-0">
                <Zap className="w-6 h-6 text-yellow-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-yellow-400 mb-2">Firmware Update Required</h3>
                <p className="text-yellow-200/80 mb-4">
                  Your DOTT {deviceName && `(${deviceName})`} needs a firmware update before you can upload images. 
                  This only takes a minute!
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="/flash"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-yellow-500 text-black font-bold hover:bg-yellow-400 transition-colors"
                  >
                    <Zap className="w-5 h-5" />
                    Update Firmware
                  </a>
                  <button
                    onClick={disconnect}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-zinc-800 text-white font-medium hover:bg-zinc-700 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
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

        {/* Why & About */}
        <div className="grid sm:grid-cols-2 gap-6 mb-12">
          {/* Why */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <HelpCircle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold">Why OpenDOTT?</h3>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed">
              The official DOTT app was discontinued, leaving devices without a way to upload new images. 
              OpenDOTT brings your DOTT back to life — no more paperweight, just a working wearable display.
            </p>
          </div>

          {/* About */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 text-green-400 flex items-center justify-center">
                <User className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold">About</h3>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              Built by a solo developer who just wanted their DOTT to work again. 
              This is a community project — contributions and feedback are welcome.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="https://discord.com/users/353922987235213313"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#5865F2]/20 text-[#5865F2] text-sm hover:bg-[#5865F2]/30 transition-colors"
              >
                <Discord className="w-4 h-4" />
                Discord
              </a>
              <a
                href="https://github.com/Bentlybro"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700 transition-colors"
              >
                <Github className="w-4 h-4" />
                GitHub
              </a>
            </div>
          </div>
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

function Discord({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
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
