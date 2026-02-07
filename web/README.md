# OpenDOTT Web App

A web-based companion app for the DOTT wearable display. Upload GIFs to your device directly from your browser using Web Bluetooth.

**Live Site:** [opendott.dev](https://opendott.dev)

## Features

- **Web Bluetooth Connection** - Connect to your DOTT device directly from Chrome/Edge
- **GIF Upload** - Upload animated GIFs to display on your device
- **Smart Optimization** - Built-in GIF compression to ensure reliable uploads
- **Size Validation** - Prevents uploads that could brick your device
- **PNG/JPEG Support** - Automatically converts static images to GIF format

## Usage

1. Open [opendott.dev](https://opendott.dev) in Chrome or Edge (Web Bluetooth required)
2. Click "Connect" and select your DOTT device
3. Drop a GIF onto the upload area
4. Click "Upload to Device"

## File Size Limits

The DOTT has limited memory, so file sizes matter:

| Size | Behavior |
|------|----------|
| **>5MB** | Must optimize before uploading |
| **>500KB** | Upload blocked (brick risk) |
| **50-500KB** | Warning shown, optimization suggested |
| **<50KB** | Good to go |

The built-in optimizer uses gifsicle to compress GIFs in your browser.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Tech Stack

- React + TypeScript
- Vite
- Tailwind CSS
- Web Bluetooth API
- gifsicle-wasm-browser (GIF optimization)

## Browser Support

Web Bluetooth is required, which limits support to:
- Chrome (desktop & Android)
- Edge (desktop)
- Opera

Safari and Firefox do not support Web Bluetooth.

## Related

- [OpenDOTT Firmware](../firmware/) - Open-source firmware for the DOTT
- [Python Tools](../tools/) - CLI tools for uploading and recovery
