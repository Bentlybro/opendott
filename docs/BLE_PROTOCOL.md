# DOTT BLE Protocol Documentation

## Overview

The DOTT uses multiple BLE services:
- Standard GATT services (GAP, GATT, Battery, Device Info)
- MCUmgr SMP for firmware management
- Custom services for image transfer

---

## BLE Services Map

### Standard Services

#### Generic Access (0x1800)
| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| Device Name | 0x2A00 | READ | "Dott" |
| Appearance | 0x2A01 | READ | [0] Unknown |
| Peripheral Preferred Connection Parameters | 0x2A04 | READ | Connection params |

#### Generic Attribute (0x1801)
| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| Service Changed | 0x2A05 | INDICATE | Standard |
| Client Supported Features | 0x2B29 | READ, WRITE | Feature flags |
| Database Hash | 0x2B2A | READ | GATT DB hash |

#### Battery Service (0x180F)
| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| Battery Level | 0x2A19 | READ, NOTIFY | 0-100% |

#### Device Information (0x180A)
| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| Model Number | 0x2A24 | READ | Model string |
| Manufacturer Name | 0x2A29 | READ | Manufacturer |
| PnP ID | 0x2A50 | READ | Vendor/Product ID |
| Firmware Revision | 0x2A26 | READ | Version string |

---

### MCUmgr SMP Service

**Service UUID:** `8d53dc1d-1db7-4cd3-868b-8a527460aa84`

This is the standard Zephyr MCUmgr Simple Management Protocol service.

| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| SMP | `da2e7828-fbce-4e01-ae9e-261174997c48` | WRITE_NO_RESP, NOTIFY | MCUmgr commands |

#### SMP Protocol Format

8-byte header + CBOR payload:

```
| Byte | Field          | Description                    |
|------|----------------|--------------------------------|
| 0    | Op             | 0=Read, 1=Read RSP, 2=Write, 3=Write RSP |
| 1    | Flags          | 0x00 normally                  |
| 2-3  | Length         | Payload length (big-endian)    |
| 4-5  | Group ID       | Command group (big-endian)     |
| 6    | Sequence       | Packet sequence number         |
| 7    | Command ID     | Command within group           |
| 8+   | Payload        | CBOR-encoded data              |
```

#### Known SMP Groups

| Group ID | Name | Commands |
|----------|------|----------|
| 0x00 | OS | Task list, buffer info, echo, reset |
| 0x01 | Image | List, upload, erase, confirm |
| 0x02 | Stat | Read statistics |
| 0x03 | Config | Read/write config values |
| 0x04 | Log | Read logs |
| 0x05 | Crash | Crash dump |
| 0x08 | FS | Filesystem operations |
| 0x09 | Shell | Shell commands |

#### Tested Commands

```python
# Group 0, Cmd 2 - Task list
# Response includes: "tasks", "BT RX", "mcumgr smp", "sysworkq", "logging", "didle", "dmain"

# Group 0, Cmd 6 - Buffer info  
# Response: buf_size=6409, buf_count=4

# Group 1, Cmd 0 - Image list
# Response: slot 0 & 1 info, version 0.0.0, SHA-256 hashes
# Booleans: bootable, pending, confirmed, active, permanent
```

---

### Custom Service: 0xFFF0

**Service UUID:** `0000FFF0-0000-1000-8000-00805f9b34fb`

| Characteristic | UUID | Properties | Purpose |
|----------------|------|------------|---------|
| Response | 0xFFF1 | NOTIFY | Feedback/responses |
| Command | 0xFFF2 | WRITE, WRITE_NO_RESP | Command input |

---

### Custom Service: TI-style

**Service UUID:** `f000ffe0-0451-4000-b000-000000000000`

| Characteristic | UUID | Properties | Purpose |
|----------------|------|------------|---------|
| Write | `f000ffe1-0451-4000-b000-000000000000` | WRITE, WRITE_NO_RESP | Primary write target |
| Notify | `f000ffe2-0451-4000-b000-000000000000` | NOTIFY | Notification source |

> **Note:** The `f000` prefix and `0451` vendor ID suggest TI (Texas Instruments) origin.
> This might be a generic template they started with.

---

## Image Transfer Protocol (Theory)

Based on firmware strings and testing:

1. **Initiate transfer** via custom service or SMP FS group
2. **Send chunks** to write characteristic
3. **Device tracks** `total_written` vs `expected`
4. **Completion** triggers processing
5. **NO VALIDATION** (original firmware bug!)

### Suspected Flow

```
Client                          Device
  |                               |
  |-- Enable notifications ------>|
  |                               |
  |-- Start transfer cmd -------->|
  |<----- ACK -------------------|
  |                               |
  |-- Data chunk 1 -------------->|
  |-- Data chunk 2 -------------->|
  |-- ...                         |
  |-- Data chunk N -------------->|
  |                               |
  |<----- Transfer Complete ------|
  |                               |
  |        [Device processes]     |
  |        [GIF decoder runs]     |
  |        [Display updates]      |
```

---

## GATT Errors Encountered

| Error Code | Meaning |
|------------|---------|
| 0xA0 | Invalid operation / unknown command |
| 0xA4 | Unexpected format / bad packet |

Raw text writes ("hello", "GIF89a") return these errors.
**Structured packets required** (likely MCUmgr or custom format).

---

## Testing Notes

### What Works
- BLE connection stable (bleak, nRF Connect)
- Notifications enable successfully
- MCUmgr commands get valid responses

### What Doesn't
- Raw data writes rejected
- No USB serial output
- No screen updates from BLE yet

---

## Python Example (bleak)

```python
import asyncio
from bleak import BleakClient

DEVICE_ADDRESS = "XX:XX:XX:XX:XX:XX"

# Custom service UUIDs
WRITE_CHAR = "f000ffe1-0451-4000-b000-000000000000"
NOTIFY_CHAR = "f000ffe2-0451-4000-b000-000000000000"

# MCUmgr SMP
SMP_CHAR = "da2e7828-fbce-4e01-ae9e-261174997c48"

def notification_handler(sender, data):
    print(f"Notification: {data.hex()}")

async def main():
    async with BleakClient(DEVICE_ADDRESS) as client:
        print(f"Connected: {client.is_connected}")
        
        # Enable notifications
        await client.start_notify(NOTIFY_CHAR, notification_handler)
        
        # Send MCUmgr echo command (Group 0, Cmd 0)
        # Op=2 (write), Flags=0, Len=5, Group=0, Seq=0, Cmd=0
        header = bytes([0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00])
        payload = b'\xa1\x61d\x64test'  # CBOR: {"d": "test"}
        
        await client.write_gatt_char(SMP_CHAR, header + payload)
        
        await asyncio.sleep(2)

asyncio.run(main())
```

---

## Next Steps

1. **Reverse the Android APK** to find exact image upload protocol
2. **Fuzz the custom services** with structured packets
3. **Try SMP FS group** (0x08) for file operations
4. **Test SMP Image Upload** (Group 1, Cmd 1) for raw data transfer
