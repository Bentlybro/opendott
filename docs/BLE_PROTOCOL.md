# DOTT BLE Protocol Documentation

## Overview

The DOTT wearable uses Bluetooth Low Energy for image transfer and device management.
This document describes the discovered protocol based on service enumeration.

## Device Identity

- **Advertised Name:** `Dott_V2_Atin` (varies by device)
- **MAC Address:** E2:E2:B4:44:D5:30 (example)
- **MCU:** nRF52840
- **Firmware:** 1.0.0

## BLE Services

### 1. Generic Access (0x1800)
Standard Bluetooth service for device identity.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| Device Name | 0x2A00 | Read | "Dott_V2_Atin" |
| Appearance | 0x2A01 | Read | Device type |
| Peripheral Preferred Connection Parameters | 0x2A04 | Read | Connection params |

### 2. Generic Attribute (0x1801)
Standard GATT service.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| Service Changed | 0x2A05 | Indicate | GATT change notification |

### 3. Battery Service (0x180F)
Standard battery reporting.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| Battery Level | 0x2A19 | Read, Notify | Battery percentage (0-100) |

### 4. Device Information (0x180A)
Device metadata.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| Model Number | 0x2A24 | Read | "nrf52840" |
| Manufacturer Name | 0x2A29 | Read | "Manufacturer" |
| PnP ID | 0x2A50 | Read | Plug and Play ID |
| Firmware Revision | 0x2A26 | Read | "1.0.0" |

### 5. DOTT Image Transfer Service (Custom)

**Service UUID:** `0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc`

This is the proprietary service used for GIF image upload and display control.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| State | 0x1525 | Read, Write-No-Response | Image/device state (CBOR) |
| Command | 0x1526 | Read, Write | Control commands |
| Status | 0x1527 | Read, Write | Status byte |
| ACK | 0x1528 | Read, Write, Indicate | Transfer acknowledgment |
| Data | 0x1529 | Write-No-Response, Notify | **Image data transfer** |
| Response | 0x1530 | Read, Notify | Response data |

#### Characteristic Details

**0x1525 (State):**
- Contains CBOR-encoded device/image state
- Includes MCUmgr image slot info: `bootable`, `pending`, `confirmed`, `active`, `permanent`, `slot`, `version`, `hash`
- Can be very large (65KB+ observed)

**0x1526 (Command):**
- Control commands (format TBD)
- Read/write access

**0x1527 (Status):**
- Single byte status indicator
- Observed value: 0x01 (ready?)

**0x1528 (ACK):**
- Indicate characteristic for transfer acknowledgments
- Not directly readable (Protocol Error 0x02)

**0x1529 (Data) - PRIMARY TRANSFER:**
- Write-without-response for high throughput
- Notify for responses
- This is where image data is streamed

**0x1530 (Response):**
- Read + Notify for device responses
- Used for transfer status/completion

### 6. MCUmgr SMP Service

**Service UUID:** `8d53dc1d-1db7-4cd3-868b-8a527460aa84`

Standard MCUmgr Simple Management Protocol for device management and firmware updates.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| SMP | da2e7828-fbce-4e01-ae9e-261174997c48 | Write-No-Response, Notify | SMP packet I/O |

#### Supported MCUmgr Groups
- **OS (0x00):** Echo, reset
- **Image (0x01):** Firmware image management
- **FS (0x08):** Filesystem operations (returns errors - may not be enabled)
- **Shell (0x09):** Shell access

## Image Transfer Protocol (Hypothesized)

Based on firmware analysis and service discovery:

### Transfer Sequence

1. **Initiate Transfer**
   - Write size header to 0x1529: `[size:4 LE]`
   - Or trigger via 0x1526 command

2. **Data Streaming**
   - Stream GIF data to 0x1529 in chunks
   - Use write-without-response for speed
   - Chunk size: ~200 bytes (conservative MTU)
   - Small delay between chunks (10ms)

3. **Monitor Status**
   - Watch for notifications on 0x1529
   - Check 0x1528 for ACK indications
   - Read 0x1527 for status byte

4. **Completion**
   - Device processes and displays image
   - Response via 0x1530 or notification

### GIF Requirements

From firmware analysis:
- Format: GIF89a or GIF87a
- Size: 240x240 (display resolution)
- Maximum file size: Unknown (16MB flash available)

## Alternative Protocols (From Firmware Strings)

The firmware contains references to other service UUIDs that were NOT present on the enumerated device:

- `f000ffe0-0451-4000-b000-000000000000` (TI-style) - Not found
- `0000fff0-0000-1000-8000-00805f9b34fb` (FFF0) - Not found
- `0000fff1/fff2` - Not found

These may be:
- Legacy protocols from earlier firmware
- Debug/development services not exposed
- Conditional services based on device mode

## Connection Parameters

Recommended settings for stable transfer:
- Connection Interval: 7.5-15ms
- Supervision Timeout: 5-10 seconds
- MTU: Request 512+ (device will negotiate down)

## Python Client Usage

```python
from bleak import BleakClient

DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
DOTT_DATA = "00001529-0000-1000-8000-00805f9b34fb"

async with BleakClient(address) as client:
    # Stream image data
    with open("image.gif", "rb") as f:
        data = f.read()
    
    # Send size header
    await client.write_gatt_char(DOTT_DATA, 
        len(data).to_bytes(4, 'little'),
        response=False)
    
    # Stream chunks
    for i in range(0, len(data), 200):
        chunk = data[i:i+200]
        await client.write_gatt_char(DOTT_DATA, chunk, response=False)
        await asyncio.sleep(0.01)
```

## Next Steps

1. **Verify transfer protocol** - Test with actual GIF upload
2. **Capture app traffic** - Sniff BLE between official app and device
3. **Determine command format** - Reverse engineer 0x1526 commands
4. **Map status codes** - Document 0x1527 values and their meanings
5. **ACK protocol** - Understand 0x1528 indicate mechanism
