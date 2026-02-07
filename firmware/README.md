# OpenDOTT Firmware

An open-source firmware replacement for the DOTT wearable display, built on Zephyr RTOS.

## Status: Work in Progress

This firmware is **not yet functional**. While the codebase compiles and the architecture is in place, the exact hardware pinout is not fully known yet. Once we have the complete pinout, we can finalize the board definition and get this running on real hardware.

### What We Know

- **MCU:** Nordic nRF52840 (ARM Cortex-M4)
- **Display:** GC9A01 240x240 round LCD
- **Flash:** GD25Q128 16MB QSPI flash
- **Filesystem:** LittleFS
- **Bootloader:** MCUboot

### What We Need

- Complete GPIO pinout (display, flash, button, etc.)
- Hardware schematics or board documentation

## Project Structure

```
firmware/
├── boards/arm/opendott/    # Board definition
├── src/                    # Application source
│   ├── main.c              # Entry point
│   ├── ble_service.c       # BLE GATT service
│   ├── display.c           # GC9A01 display driver
│   ├── storage.c           # LittleFS + flash
│   ├── image_handler.c     # GIF parsing & display
│   └── button.c            # Button input
├── include/                # Headers
├── prj.conf                # Zephyr config
└── CMakeLists.txt          # Build config
```

## Building

Requires Zephyr SDK. See the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html).

```bash
west build -b opendott firmware
west flash
```

## Contributing

If you have hardware documentation, schematics, or have successfully probed the pinout, please open an issue or PR!

## Related

- [Web App](../web/) - Browser-based GIF uploader
- [Python Tools](../tools/) - CLI tools for uploading and recovery
