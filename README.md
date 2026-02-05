# OpenDOTT 🎨

**Open source firmware for the DOTT wearable display.**

*Because uploading a PNG shouldn't brick your device.*

---

## What is DOTT?

DOTT is a small wearable display (badge) that shows animated GIFs. It was a [Kickstarter project](https://www.kickstarter.com/projects/weardott/dott-a-wearable-for-gifs-videos-and-qr-codes) that shipped with... let's say "fragile" firmware.

**Problems with the original firmware:**
- 🐌 GIF playback is laggy
- 💀 Uploading any non-GIF file **permanently bricks the device**
- 🚫 No recovery mechanism
- 🤷 No input validation whatsoever

This project aims to create a **proper** open source replacement.

## Hardware

| Component | Part | Specs |
|-----------|------|-------|
| MCU | nRF52840 | ARM Cortex-M4F, 64MHz, 1MB Flash, 256KB RAM, BLE 5.0 |
| Display | GC9A01 | 240x240 round IPS LCD, SPI interface |
| Storage | GD25Q128 | 16MB QSPI NOR flash |
| Interface | USB-C | CDC-ACM serial + charging |

## Features (Planned)

- [x] Basic display driver
- [ ] GIF playback (smooth, double-buffered)
- [ ] PNG support (static images)
- [ ] JPEG support (static images)
- [ ] BLE image transfer with **proper validation**
- [ ] USB mass storage mode
- [ ] Web-based companion app
- [ ] Factory reset (long press)
- [ ] OTA firmware updates
- [ ] Battery level reporting
- [ ] Multiple image slots

## Building

### Prerequisites

- [Zephyr SDK](https://docs.zephyrproject.org/latest/develop/getting_started/index.html)
- nRF Connect SDK (optional, for full Nordic tooling)
- Python 3.8+

### Setup

```bash
# Clone the repo
git clone https://github.com/Bentlybro/opendott.git
cd opendott

# Set up Zephyr workspace (if not already done)
west init -l .
west update

# Build
west build -b opendott

# Flash (requires J-Link or compatible debugger)
west flash
```

### Flashing via USB (DFU)

The original bootloader supports USB DFU. You can flash without a debugger:

```bash
# Put device in DFU mode (hold button while connecting USB)
nrfutil dfu usb-serial -pkg opendott.zip -p /dev/ttyACM0
```

## Project Structure

```
opendott/
├── src/
│   ├── main.c              # Application entry point
│   ├── display.c           # GC9A01 display driver
│   ├── storage.c           # External flash + filesystem
│   ├── ble_service.c       # Custom BLE GATT service
│   ├── image_handler.c     # Image validation & decoding
│   └── button.c            # Button input handling
├── boards/arm/opendott/    # Board definition
├── docs/                   # Documentation
├── CMakeLists.txt
├── prj.conf                # Kconfig
└── Kconfig
```

## BLE Protocol

### Service UUID
`TBD` - Will be documented after BLE sniffing

### Characteristics
| Name | UUID | Properties | Description |
|------|------|------------|-------------|
| Image Transfer | TBD | Write | Chunked image upload |
| Transfer Control | TBD | Write/Notify | Start/stop/status |
| Device Info | TBD | Read | Battery, version, etc |

## Why Not Just Fix the Original?

The original firmware has fundamental architectural issues:
- No input validation before flash writes
- No error recovery paths  
- Tightly coupled components
- No proper state machine

It's easier (and more fun) to write it properly from scratch.

## Contributing

Contributions welcome! Areas that need help:
- BLE protocol reverse engineering (sniffing the original app)
- GIF decoder optimization
- Companion app development
- Hardware documentation

## License

MIT License - Do whatever you want with it.

## Credits

- Reverse engineering & firmware analysis: [@Bentlybro](https://github.com/Bentlybro) + Orion 🤖
- Original hardware: DOTT team (we're just making it actually work)

---

*"You had one job: display a GIF without bricking. ONE JOB."*
