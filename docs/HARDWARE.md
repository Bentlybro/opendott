# Hardware Documentation

## Overview

The DOTT wearable is a small display badge based on the Nordic nRF52840 SoC.

## Components

### Main MCU: nRF52840

- **Core:** ARM Cortex-M4F @ 64 MHz
- **Flash:** 1 MB internal
- **RAM:** 256 KB
- **Connectivity:** Bluetooth 5.0, NFC, USB 2.0
- **Package:** QFN48 (QI variant)

### Display: GC9A01

- **Type:** Round IPS TFT LCD
- **Resolution:** 240 x 240 pixels
- **Interface:** 4-wire SPI
- **Color Depth:** 16-bit RGB565
- **Driver IC:** GC9A01 (Galaxycore)

**SPI Signals:**
- SCK: Clock
- MOSI: Data out (MCU to display)
- CS: Chip select (active low)
- DC: Data/Command select
- RST: Reset (active low)
- BL: Backlight (PWM capable)

### External Flash: GD25Q128

- **Manufacturer:** GigaDevice
- **Capacity:** 128 Mbit (16 MB)
- **Interface:** QSPI (Quad SPI)
- **JEDEC ID:** 0xC84018
- **Max Speed:** 120 MHz

**Used for:**
- Image storage (LittleFS filesystem)
- Up to ~15 MB usable for images

### Power

- **Battery:** LiPo (size TBD)
- **Charging:** USB-C
- **Charging IC:** Unknown (needs investigation)

### Button

- Single tactile button
- Used for:
  - Short press: Cycle images
  - Medium press: Toggle display
  - Long press: Factory reset

## Pin Mapping (Estimated)

> **Note:** These pins are estimates based on typical nRF52840 designs.
> Actual pinout needs verification with hardware probing.

| Function | nRF52840 Pin | Notes |
|----------|--------------|-------|
| SPI1_SCK | P0.03 | Display clock |
| SPI1_MOSI | P0.04 | Display data |
| Display CS | P0.05 | Active low |
| Display DC | P0.06 | Data/Command |
| Display RST | P0.07 | Active low |
| Backlight | P0.08 | PWM control |
| Button | P0.11 | Active low, pull-up |
| Status LED | P0.13 | Active low |
| QSPI_SCK | P0.19 | Flash clock |
| QSPI_IO0 | P0.20 | Flash data |
| QSPI_IO1 | P0.21 | Flash data |
| QSPI_IO2 | P0.22 | Flash data |
| QSPI_IO3 | P0.23 | Flash data |
| QSPI_CSN | P0.17 | Flash select |

## Original Firmware Analysis

The original firmware was analyzed using binwalk and string extraction.
Key findings:

- **RTOS:** Zephyr v3.7.0
- **Bootloader:** MCUboot
- **GIF Library:** AnimatedGIF
- **Filesystem:** LittleFS
- **BLE Stack:** Zephyr Bluetooth

### Original Device Name

The device advertises as:
- "Dott" (short)
- "Dott_V2_Atin" (full)

## Hardware Verification TODO

- [ ] Probe SPI signals with logic analyzer
- [ ] Verify pin assignments
- [ ] Identify charging IC
- [ ] Measure battery capacity
- [ ] Check for debug pads (SWD)
