# DOTT BLE Protocol - Complete Specification

> Fully reverse-engineered from the official weardott Android app and BLE traffic capture.
> February 2026

## Overview

The DOTT wearable is a 240x240 round LCD display badge that shows animated GIFs. It uses Bluetooth Low Energy for image transfer and device management.

## Hardware

| Component | Part | Notes |
|-----------|------|-------|
| MCU | nRF52840 | Nordic Semiconductor, ARM Cortex-M4F, BLE 5.0 |
| Display | GC9A01 | 240x240 round LCD, SPI interface |
| Flash | GD25Q128 | 128Mbit (16MB) QSPI NOR flash |
| OS | Zephyr RTOS | v3.7.0 with MCUboot bootloader |

## BLE Services

### DOTT Image Service

**Service UUID:** `0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc`

| Characteristic | UUID | Handle* | Properties | Purpose |
|----------------|------|---------|------------|---------|
| Data | 0x1525 | 0x0016 | Read, Write-No-Response | GIF data transfer |
| Command | 0x1526 | 0x0018 | Read, Write | Commands (unused?) |
| Status | 0x1527 | 0x001a | Read, Write | Status (unused?) |
| Trigger | 0x1528 | 0x001c | Read, Write, Indicate | Transfer trigger + ACK |
| Notify | 0x1529 | 0x001f | Write, Notify | Transfer notifications |
| Response | 0x1530 | 0x0022 | Read, Notify | Completion notifications |

*Handles may vary by platform/connection.

### Standard Services

| Service | UUID | Purpose |
|---------|------|---------|
| Generic Access | 0x1800 | Device name, appearance |
| Generic Attribute | 0x1801 | GATT notifications |
| Battery Service | 0x180F | Battery level (0-100%) |
| Device Information | 0x180A | Model, firmware version |
| MCUmgr SMP | 8d53dc1d-1db7-4cd3-868b-8a527460aa84 | Firmware management |

## Image Upload Protocol

### Sequence Diagram

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │   DOTT   │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  1. Write 0x00401000 to 0x1528          │
     │────────────────────────────────────────>│
     │                                         │
     │  2. Indication: 0xFFFFFFFF              │
     │<────────────────────────────────────────│
     │                                         │
     │  3. Write GIF chunk 1 to 0x1525         │
     │────────────────────────────────────────>│
     │  3. Write GIF chunk 2 to 0x1525         │
     │────────────────────────────────────────>│
     │  ...                                    │
     │  3. Write GIF chunk N to 0x1525         │
     │────────────────────────────────────────>│
     │                                         │
     │  4. Notification: "Transfer Complete"   │
     │<────────────────────────────────────────│
     │                                         │
```

### Step-by-Step

#### 1. Connect and Setup

```python
# Connect to device
client = BleakClient(address)
await client.connect()

# Enable notifications on trigger characteristic (0x1528)
await client.start_notify(UUID_1528, notification_handler)

# Also enable on 0x1529 and 0x1530 for responses
await client.start_notify(UUID_1529, notification_handler)
await client.start_notify(UUID_1530, notification_handler)
```

#### 2. Send Trigger Command

```python
# Magic trigger command - tells device to enter receive mode
TRIGGER_CMD = bytes([0x00, 0x40, 0x10, 0x00])

await client.write_gatt_char(UUID_1528, TRIGGER_CMD, response=True)

# Wait for indication (0xFFFFFFFF means device is ready)
# This comes as a notification on 0x1528
```

#### 3. Stream GIF Data

```python
# Calculate chunk size (MTU - 3 for ATT header)
chunk_size = mtu - 3  # Typically 495 bytes with 498 MTU

# Stream raw GIF bytes - NO HEADERS!
for i in range(0, len(gif_data), chunk_size):
    chunk = gif_data[i:i+chunk_size]
    await client.write_gatt_char(UUID_1525, chunk, response=False)
    await asyncio.sleep(0.005)  # 5ms delay between chunks
```

#### 4. Wait for Completion

```python
# Device sends "Transfer Complete" or "Transfer Fail" as notification
# on characteristic 0x1529
```

### Protocol Constants

| Constant | Value | Notes |
|----------|-------|-------|
| Trigger Command | `0x00401000` | Fixed magic value |
| Ready Indication | `0xFFFFFFFF` | Device ready to receive |
| Optimal MTU | 498 | Request via MTU exchange |
| Chunk Delay | 5ms | Delay between chunks |
| Success Response | "Transfer Complete" | ASCII string |
| Failure Response | "Transfer Fail" | ASCII string |

### GIF Requirements

| Property | Requirement |
|----------|-------------|
| Format | GIF87a or GIF89a |
| Dimensions | 240x240 pixels (display size) |
| Animation | Supported (NETSCAPE extension) |
| Max Size | Unknown, but 16MB flash available |

## Error Handling

### "Transfer Fail" Response

The device returns "Transfer Fail" when:
- GIF data is corrupted or invalid
- Transfer was interrupted
- Unknown internal error

### No Response

If no completion notification is received:
- Check if display updated (transfer may have succeeded)
- Device may need reset
- Try reconnecting and re-uploading

## MCUmgr / SMP Protocol

The device also supports MCUmgr Simple Management Protocol for firmware operations.

**SMP Service UUID:** `8d53dc1d-1db7-4cd3-868b-8a527460aa84`
**SMP Characteristic:** `da2e7828-fbce-4e01-ae9e-261174997c48`

Reading from the DOTT data characteristic (0x1525) returns CBOR-encoded MCUboot status including:
- `bootable`, `pending`, `confirmed`, `active`, `permanent` flags
- `slot`, `version`, `hash` metadata

## Discovery Notes

### What We Tried (Failed Approaches)

1. **Raw GIF bytes only** - No trigger, device ignored data
2. **Size header + GIF** - "Transfer Fail"
3. **Size to trigger, GIF to data** - "Transfer Fail"
4. **Various size encodings** - All failed

### The Breakthrough

Capturing actual BLE traffic from the official app revealed:
- The trigger is a fixed command (`0x00401000`), NOT a size value
- The device acknowledges with `0xFFFFFFFF` indication
- Only then does it accept raw GIF data

### Key Files for Analysis

- `DottBluetoothManager.java` - Main BLE code (decompiled from APK)
- `btsnoop_hci.log` - Captured BLE traffic from official app
- `release2.0.bin` - Original firmware (MCUboot image)

## Credits

Reverse engineered by Bently and Orion, February 2026.
