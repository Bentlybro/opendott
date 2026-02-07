# OpenDOTT Documentation

Technical documentation for the DOTT wearable display.

## Contents

### Hardware
- **[hardware.md](hardware.md)** - Hardware specifications (MCU, display, flash, etc.)

### Reverse Engineering
- **[reverse-engineering.md](reverse-engineering.md)** - Overview of the reverse engineering process
- **[full-reverse-engineering.md](full-reverse-engineering.md)** - Detailed analysis and findings

### Communication Protocol
- **[ble-protocol.md](ble-protocol.md)** - BLE GATT service and characteristics
- **[protocol.md](protocol.md)** - Data transfer protocol details

### Development
- **[building.md](building.md)** - How to build the firmware
- **[roadmap.md](roadmap.md)** - Project roadmap and planned features

## Quick Reference

| Component | Details |
|-----------|---------|
| MCU | Nordic nRF52840 |
| Display | GC9A01 240x240 round LCD |
| Flash | GD25Q128 16MB QSPI |
| Filesystem | LittleFS |
| Bootloader | MCUboot |
| BLE Service | `0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc` |

## Contributing

Found something new? Open a PR to update the docs!
