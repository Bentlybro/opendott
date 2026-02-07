# DOTT BLE Protocol Documentation

## Overview

The DOTT wearable uses Bluetooth Low Energy for image transfer and device management.
This document describes the **fully decoded protocol** based on Android app decompilation.

**Source:** `expo/modules/dottbluetooth/DottBluetoothManager.java` (weardott app v1.0.5)

## Device Identity

- **Advertised Name:** `Dott_V2_Atin` (varies by device)
- **Example MAC:** E2:E2:B4:44:D5:30
- **MCU:** nRF52840
- **Firmware:** 1.0.0 (reported) / 0.0.0 (MCUboot version)

## Quick Reference: Image Upload

```python
# The protocol is SIMPLE - just send raw GIF bytes!

from bleak import BleakClient
import asyncio

SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"  # NORDIC_THROUGHPUT_SERVICE
CHAR = "00001525-0000-1000-8000-00805f9b34fb"     # Transfer characteristic

async def upload_gif(address: str, gif_path: str):
    async with BleakClient(address) as client:
        # Request high MTU
        mtu = client.mtu_size or 23
        chunk_size = mtu - 3
        
        # Read GIF file
        with open(gif_path, 'rb') as f:
            data = f.read()
        
        # Stream RAW bytes (NO header!)
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await client.write_gatt_char(CHAR, chunk, response=False)
            await asyncio.sleep(0.005)  # 5ms delay
        
        print(f"Uploaded {len(data)} bytes")
```

## BLE Services

### 1. DOTT Image Transfer Service (Primary)

**Service UUID:** `0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc`

This is called `NORDIC_THROUGHPUT_SERVICE_UUID` in the app code.

| Characteristic | UUID | Properties | Description |
|---------------|------|------------|-------------|
| Transfer | 0x1525 | Read, Write-No-Response | **Main characteristic** |

**IMPORTANT:** Characteristic 0x1525 has dual behavior:
- **Read:** Returns MCUboot SMP status (CBOR-encoded)
- **Write:** Accepts raw image data

### 2. Standard Services

| Service | UUID | Purpose |
|---------|------|---------|
| Generic Access | 0x1800 | Device name, appearance |
| Generic Attribute | 0x1801 | GATT change notification |
| Battery Service | 0x180F | Battery level (0-100%) |
| Device Information | 0x180A | Model, firmware, manufacturer |

### 3. MCUmgr SMP Service

**Service UUID:** `8d53dc1d-1db7-4cd3-868b-8a527460aa84`

| Characteristic | UUID | Properties |
|---------------|------|------------|
| SMP | da2e7828-fbce-4e01-ae9e-261174997c48 | Write-No-Response, Notify |

Used for firmware management (image slots, version info). **Not used for image upload!**

## Image Upload Protocol (Decoded from APK)

### Protocol Constants

```java
OPTIMAL_MTU_SIZE = 498            // Requested MTU
DEFAULT_MTU_SIZE = 23             // Fallback MTU
CHUNK_DELAY_MS = 5                // Delay between chunks
MAX_RETRIES = 5                   // Write retries per chunk
MAX_CONSECUTIVE_FAILURES = 5      // Abort threshold
BACKOFF_BASE_DELAY_MS = 50        // Exponential backoff base
BACKOFF_MAX_DELAY_MS = 1000       // Max backoff delay
STABILIZATION_DELAY_MS = 100      // Post-connect stabilization
WRITE_TIMEOUT_MS = 2000           // Write timeout
```

### Connection Sequence

1. **Connect** to device via BLE
2. **Request MTU** of 498 bytes (`gatt.requestMtu(498)`)
3. **Request connection priority** HIGH (`gatt.requestConnectionPriority(1)`)
4. **Request PHY** 2M if supported (Android 8+)
5. **Wait** 100ms for stabilization
6. **Discover services** and find transfer characteristic

### Upload Sequence

```
uploadGif(deviceId, name, urlString):
  1. Validate preconditions (connected, not already uploading)
  2. Reset upload state
  3. Read/download file data
  4. Calculate chunk size = MTU - 3
  5. FOR each chunk:
     a. writePacketWithRetry(chunk)
     b. sleep(5ms)
  6. Upload complete
```

### Critical: NO FRAMING!

The official app sends **raw GIF bytes** with:
- **NO** size header
- **NO** sequence numbers
- **NO** SMP encoding
- **NO** acknowledgment protocol

Just raw `byte[]` chunks written directly to the characteristic.

### Write Type Selection

```java
// Prefer write-without-response for speed
if (supportsWriteNoResponse) {
    preferredWriteType = WRITE_TYPE_NO_RESPONSE;  // 1
} else if (supportsWrite) {
    preferredWriteType = WRITE_TYPE_DEFAULT;       // 2
}
```

### Retry Logic

```java
// Exponential backoff on failure
delay = min(50 * 2^(retryCount-1), 1000)ms
```

## GIF Requirements

From firmware analysis and testing:
- **Format:** GIF89a or GIF87a (magic bytes)
- **Dimensions:** 240x240 pixels (display size)
- **Trailer:** Must end with 0x3B (GIF trailer)
- **Max size:** Unknown, but 16MB flash available
- **⚠️ CRITICAL: Full frames only!** The device does NOT support delta/optimized GIFs.
  Each frame must be a complete 240x240 image, not a partial update patch.
  
### GIF Optimization Warning

Many GIF tools (ezgif, Photoshop, etc.) create "optimized" GIFs where only changed pixels
are stored in subsequent frames. The DOTT firmware cannot decode these!

**Bad (won't animate):**
```
Frame 0: 240x240 (full)
Frame 1: 25x8 at (107,118)  ← PARTIAL FRAME - won't work!
Frame 2: 25x8 at (107,118)
```

**Good (will animate):**
```
Frame 0: 240x240 (full)
Frame 1: 240x240 (full)  ← COMPLETE FRAME - works!
Frame 2: 240x240 (full)
```

To convert an optimized GIF to full frames, use:
```bash
# Using gifsicle
gifsicle --unoptimize input.gif -o output.gif

# Using ffmpeg
ffmpeg -i input.gif -vf "scale=240:240" -loop 0 output.gif
```

## DFU (Firmware Update)

The app also supports firmware updates via Nordic DFU library - this is **separate** from image uploads.

### DFU Service

Uses Nordic's standard DFU protocol:
1. Download `.hex` firmware from server
2. Convert to binary
3. Create DFU zip package
4. Execute DFU via Nordic library

### DFU Parameters

```java
DfuServiceInitiator(deviceId)
    .setKeepBond(false)
    .setPacketsReceiptNotificationsEnabled(true)
    .setPacketsReceiptNotificationsValue(12)
    .setNumberOfRetries(3)
    .setRebootTime(2000)
    .setScanTimeout(15000)
    .setMtu(517)
    .setForceDfu(true)
```

## Troubleshooting

### Upload succeeds but image doesn't display

1. **Check format:** File must be valid GIF
2. **Check dimensions:** Must be 240x240 or smaller
3. **Check trailer:** Must end with 0x3B
4. **NO size header:** Don't prepend file size!

### Connection drops during upload

1. Reduce chunk size (try MTU - 3 or even 200 bytes)
2. Increase inter-chunk delay (try 10-20ms)
3. Enable write-with-response for debugging

### Device shows old image

The GIF data persists in flash. Upload a new valid GIF to replace it.

## Tool Usage

```bash
# Scan for devices
python dott_upload.py scan

# Upload a GIF (uses correct protocol automatically)
python dott_upload.py upload cat.gif

# Upload with validation bypass (dangerous!)
python dott_upload.py upload broken.gif --force

# Test with experimental size header
python dott_upload.py upload cat.gif --header
```

## Protocol History

The firmware strings suggest an older protocol with size-based framing:
- `"Received length: %u bytes"`
- `"Still waiting: total_written = %d, expected = %d"`

This may be dead code or an alternative not used by the current app.

---

*Protocol fully decoded from APK decompilation. February 2026.*
