# OpenDOTT BLE Protocol Specification

This document describes the Bluetooth Low Energy (BLE) protocol used to communicate with the DOTT wearable display.

---

## Hardware

| Component | Details |
|-----------|---------|
| MCU | Nordic nRF52840 |
| Display | GC9A01 240×240 round LCD |
| Flash storage | GD25Q128 16MB QSPI flash |

---

## BLE Services

### DOTT Custom Service

The primary service for image transfer and device control.

**Service UUID:** `0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc`

| Characteristic | UUID | Short UUID | Direction | Description |
|----------------|------|------------|-----------|-------------|
| Data | `00001525-0000-1000-8000-00805f9b34fb` | `0x1525` | Write without response | Raw GIF data stream |
| Trigger | `00001528-0000-1000-8000-00805f9b34fb` | `0x1528` | Write with response / Notify | File size trigger; also sends notifications |
| Alt Data Notify | `00001529-0000-1000-8000-00805f9b34fb` | `0x1529` | Notify | Alternate data/status notifications |
| Response/Control | `00001530-0000-1000-8000-00805f9b34fb` | `0x1530` | Write without response / Notify | Pre-transfer control commands and response notifications |

### Standard BLE Services

| Service | UUID | Description |
|---------|------|-------------|
| Battery Service | `0000180f-0000-1000-8000-00805f9b34fb` (`0x180F`) | Battery level (0–100%) |
| Device Information | `0000180a-0000-1000-8000-00805f9b34fb` (`0x180A`) | Firmware version, model number, manufacturer |

#### Device Information Characteristics

| Characteristic | UUID | Description |
|----------------|------|-------------|
| Firmware Revision | `0x2A26` | Firmware version string |
| Model Number | `0x2A24` | Model number string |
| Manufacturer Name | `0x2A29` | Manufacturer name string |

### SMP / MCUboot Service (Firmware Updates)

Used for OTA firmware updates via the MCUboot Simple Management Protocol.

**Service UUID:** `8d53dc1d-1db7-4cd3-868b-8a527460aa84`

---

## Image Transfer Protocol

The transfer protocol follows the same sequence as the reference Python tool (`tools/dott_upload.py`).

### Transfer Settings

| Parameter | Value | Notes |
|-----------|-------|-------|
| Chunk size | MTU − 3 | Web Bluetooth default MTU is 517, giving 514-byte chunks (capped at 495) |
| Chunk delay | 5 ms | Delay between consecutive chunk writes |
| Max reconnect attempts | 2 | Automatic reconnect on GATT disconnect |

### Transfer Steps

#### Step 1 — Pre-transfer Setup

Write the following bytes to **`0x1530`** (Response/Control) **without response**:

```
0xfc   (pre-transfer command 1)
0x10   (pre-transfer command 2)
```

Wait ~50 ms between the two writes, and ~100 ms after the second before proceeding.

> These commands prepare the device to receive a new image. Derived from btsnoop capture analysis.

#### Step 2 — Send File Size (Trigger)

Write the GIF file size as a **4-byte little-endian unsigned integer** to **`0x1528`** (Trigger) **with response**:

```
[ size & 0xFF, (size >> 8) & 0xFF, (size >> 16) & 0xFF, (size >> 24) & 0xFF ]
```

Example: 12345 bytes → `39 30 00 00`

#### Step 3 — Wait for Indication

Wait for a notification/indication on any of the subscribed characteristics (`0x1528`, `0x1529`, `0x1530`). The expected value is:

```
0xFFFFFFFF
```

Allow up to 1 second. If no indication is received, proceed anyway.

#### Step 4 — Stream GIF Data

Write the raw GIF bytes in sequential chunks to **`0x1525`** (Data) **without response**:

- Chunk size = MTU − 3 (typically 495 bytes)
- Insert a **5 ms delay** between each chunk write
- No acknowledgement is required per chunk

#### Step 5 — Wait for Completion

After all data is sent, wait up to **5 seconds** for a notification on any subscribed characteristic.

| Notification text | Outcome |
|-------------------|---------|
| Contains `complete` (case-insensitive) | ✅ Transfer successful |
| Contains `fail` (case-insensitive) | ❌ Transfer failed |
| No notification received | ⚠️ Assumed success — check device screen |

---

## GIF Requirements

The DOTT device only accepts valid GIF files. Invalid or incompatible GIFs may fail to display or cause device instability.

| Requirement | Value |
|-------------|-------|
| Valid formats | `GIF87a` or `GIF89a` |
| Frame type | Full frames only — **no delta/optimized frames** |
| Maximum file size | 500 KB |
| Maximum dimensions | 500 × 500 pixels |
| Maximum frame count | 50 frames |
| Recommended dimensions | 240 × 240 pixels (matches display) |

> **Note on delta frames:** Tools like `gifsicle` apply delta optimization by default, storing only pixels that changed between frames. The DOTT firmware requires every frame to be a complete image. Use `gifsicle --unoptimize` to convert an optimized GIF to full frames before sending.

### Verifying a GIF

A valid GIF for DOTT must:

1. Start with the magic bytes `47 49 46` (`GIF`)
2. Have a version string of `87a` or `89a`
3. Have non-zero, in-range dimensions
4. Have all image frames covering the full canvas width × height
5. Be within the file size limit
6. Not exceed the frame count limit
7. End with the GIF trailer byte `0x3B`

---

## Notification Subscription

On connection, the client subscribes to notifications on all three notification-capable characteristics:

- `0x1528` (Trigger)
- `0x1529` (Alt Data Notify)
- `0x1530` (Response/Control)

This mirrors the Python reference implementation.

---

## Reference Implementation

- **Python tool:** [`tools/dott_upload.py`](../tools/dott_upload.py)
- **Web Bluetooth:** [`web/src/lib/ble.ts`](../web/src/lib/ble.ts)
- **GIF validation:** [`web/src/lib/image.ts`](../web/src/lib/image.ts)
- **GIF conversion:** [`web/src/lib/gifConverter.ts`](../web/src/lib/gifConverter.ts)
