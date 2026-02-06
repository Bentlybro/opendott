# OpenDOTT

Open-source firmware and web tools for the DOTT wearable display.

![Build Status](https://github.com/Bentlybro/opendott/actions/workflows/build.yml/badge.svg)

## 🎯 What is this?

The DOTT is a small wearable display that shows GIFs. The original firmware has a bug where uploading a non-GIF file can brick the device. This project provides:

1. **Open-source firmware** with proper image validation
2. **Web app** to easily flash firmware and upload images directly from your browser

## 📁 Project Structure

```
opendott/
├── firmware/     # Zephyr RTOS firmware for nRF52840
├── web/          # React web app for flashing & image uploads
├── docs/         # Hardware documentation & protocol specs
└── tools/        # Python scripts for development/testing
```

## 🚀 Quick Start

### Flash Firmware (via Web App)

1. Visit [opendott.dev](https://opendott.dev) (coming soon)
2. Click "Connect Device"
3. Select your DOTT from the Bluetooth list
4. Click "Flash Firmware"

### Upload Images

1. Connect to your DOTT via the web app
2. Drag & drop an image or GIF
3. Preview how it looks on the round display
4. Click "Upload"

## 🔧 Development

### Firmware

Requirements: Zephyr SDK, west, arm-none-eabi toolchain

```bash
cd firmware
west init -l .
west update
west build -b opendott
```

### Web App

Requirements: Node.js 18+

```bash
cd web
npm install
npm run dev
```

## 📋 Hardware

- **MCU:** nRF52840 (ARM Cortex-M4F)
- **Display:** GC9A01 240x240 round LCD
- **Flash:** GD25Q128 16MB QSPI
- **Connectivity:** Bluetooth Low Energy

## 📜 License

MIT License - See [LICENSE](LICENSE)

## 🙏 Credits

Reverse engineering and firmware by the community. Original DOTT device by Bott.
