# OpenDOTT 🎯

**Open-source tools for the DOTT wearable display**

Upload custom GIFs to your DOTT badge without the official app!

![DOTT Device](https://weardott.com/images/dott-device.png)

## Features

- ✅ **Working upload tool** - Python CLI for uploading GIFs
- ✅ **Full protocol documentation** - Completely reverse-engineered
- ✅ **GIF validation** - Prevents bricking from invalid files
- 🚧 **Custom firmware** - Coming soon!

## Quick Start

### Requirements

- Python 3.8+
- Bluetooth LE support
- DOTT wearable device

### Installation

```bash
git clone https://github.com/Bentlybro/opendott.git
cd opendott/tools
pip install bleak
```

### Upload a GIF

```bash
# Scan for devices
python dott_upload.py scan

# Upload an image
python dott_upload.py test_image.gif

# Or specify device address
python dott_upload.py -a E2:E2:B4:44:D5:30 test_image.gif
```

## GIF Requirements

| Property | Requirement |
|----------|-------------|
| Format | GIF87a or GIF89a |
| Dimensions | 240x240 pixels |
| Animation | Supported |

## Protocol Overview

The DOTT uses a simple BLE protocol:

1. **Trigger** - Write `0x00401000` to characteristic 0x1528
2. **Wait** - Device responds with `0xFFFFFFFF` when ready
3. **Stream** - Send raw GIF bytes to characteristic 0x1525
4. **Done** - Device responds "Transfer Complete"

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full specification.

## Hardware

| Component | Part |
|-----------|------|
| MCU | nRF52840 |
| Display | GC9A01 (240x240 round LCD) |
| Flash | GD25Q128 (16MB) |
| RTOS | Zephyr v3.7.0 |

## Project Structure

```
opendott/
├── tools/           # Python upload tools
│   ├── dott_upload.py      # Main upload tool
│   └── test_image.gif      # Test GIF
├── docs/            # Documentation
│   ├── PROTOCOL.md         # BLE protocol spec
│   ├── HARDWARE.md         # Hardware details
│   └── ROADMAP.md          # Future plans
├── src/             # Firmware source (WIP)
└── boards/          # Zephyr board definitions
```

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for planned features:

- 📱 Mobile app
- 🖥️ Desktop GUI
- ⚡ Auto-conversion from PNG/JPEG
- 🔧 Custom firmware with new features
- ⏰ Clock mode, notifications, and more!

## Why This Exists

The official DOTT app works fine, but:
- No desktop support
- Can't automate uploads
- Uploading non-GIF files can brick the device!

This project provides safe, open-source alternatives.

## Contributing

Contributions welcome! Areas that need help:
- GUI applications
- Mobile apps
- Firmware development
- Testing on different platforms

## Credits

Reverse engineered by **Bently** and **Orion** 🌟

## License

MIT - See [LICENSE](LICENSE)

---

*Not affiliated with DOTT/weardott. Use at your own risk.*
