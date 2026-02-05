# DOTT Firmware Complete Reverse Engineering Report
============================================================

## 1. Firmware Structure

### MCUboot Image Header (0x000-0x1FF)
```
Magic:       0x96f3b83d (MCUboot)
Load Addr:   0x00000000
Header Size: 512 bytes
Image Size:  262344 bytes
Version:     0.0.0+0
```

### ARM Cortex-M4 Vector Table (0x200-0x3FF)
```
Initial SP        : 0x2002f640
Reset Handler     : 0x000151ad
NMI Handler       : 0x00039511
HardFault Handler : 0x00015199
SVCall Handler    : 0x000153a1
PendSV Handler    : 0x0001536d
SysTick Handler   : 0x00015199
```

## 2. Memory Layout (Inferred)

| Region | Address | Size | Purpose |
|--------|---------|------|---------|
| Internal Flash | 0x00000000 | 1 MB | Code + MCUboot |
| SRAM | 0x20000000 | 256 KB | RAM |
| External QSPI | TBD | 16 MB | Image storage |

## 3. Key Functions (String References)

### Transfer Protocol
| String | Address | Purpose |
|--------|---------|---------|
| `Trigger received` | 0x038dba | Transfer start trigger |
| `Received length: %u bytes` | 0x038d50 | Size received |
| `Total written so far: %d bytes` | 0x038cc9 | Progress tracking |
| `Still waiting: total_written = %d, expec` | 0x038e11 | Wait for completion |
| `Full transfer complete. Processing...` | 0x038dcb | Transfer done, start processing |
| `Transfer Complete` | 0x038df1 | Success |
| `Transfer Fail` | 0x038e03 | Failure |

### GIF Processing
| String | Address | Purpose |
|--------|---------|---------|
| `Starting GIF decoder...` | 0x039142 | Decode init |
| `External flash ready, proceeding to play` | 0x039184 | Flash ready |
| `GIF_openFlash:` | 0x038b54 | Open GIF from flash |
| `Successfully opened GIF` | 0x0391b1 | GIF loaded |
| `Image size: %d x %d` | 0x0391c9 | Dimensions |
| `AnimatedGIF` | 0x038b9d | GIF library |

### BLE/Bluetooth
| String | Address | Purpose |
|--------|---------|---------|
| `Bluetooth failed to initialise` | 0x038ebb | BT init |
| `Advertising successfully started` | 0x038e7d | Advertising |
| `Connected` | 0x038ede | Connection |
| `Disconnected` | 0x038e9e | Disconnection |
| `custom_service initialization failed` | 0x039257 | Custom service |
| `BT ENABLED` | 0x038f92 | BT state |

### Flash Operations
| String | Address | Purpose |
|--------|---------|---------|
| `Erase started for size = %u` | 0x038c3f | Erase |
| `Erase Completed` | 0x038c6a | Erase done |
| `Successfully wrote %u to flash offset 0x` | 0x038d22 | Write |
| `Flash write failed` | 0x038c93 | Write error |
| `External flash device not found` | 0x038b1b | Flash missing |

### Button Handler
| String | Address | Purpose |
|--------|---------|---------|
| `Short Press handler` | 0x039213 | Short press |
| `Medium Press handler` | 0x03922b | Medium press |
| `Long Press handler` | 0x039244 | Long press |
| `Button pressed for %lld ms` | 0x0391f4 | Press duration |

## 4. Transfer Protocol (Reconstructed)

```
STATE MACHINE:

    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    ▼                                                         │
  IDLE ──────► TRIGGERED ──────► RECEIVING ──────► WAITING    │
    │           (size)           (chunks)         (complete?) │
    │                                                │        │
    │                                    ┌───────────┘        │
    │                                    ▼                    │
    │                              PROCESSING                 │
    │                                    │                    │
    │                         ┌──────────┴──────────┐         │
    │                         ▼                     ▼         │
    │                     DECODING              FAILED ───────┤
    │                         │                               │
    │                         ▼                               │
    │                    DISPLAYING                           │
    │                         │                               │
    └─────────────────────────┴───────────────────────────────┘
```

### Protocol Messages
1. **Trigger**: Device receives transfer start signal
2. **Size**: `Received length: %u bytes` - expected total
3. **Data**: Chunks written to flash, tracked via `Total written so far`
4. **Wait**: Loops until `total_written == expected`
5. **Process**: `Full transfer complete. Processing...`
6. **Decode**: `Starting GIF decoder...`
7. **Display**: Shows on screen

## 5. BLE Service UUIDs (Confirmed)

### Standard Services
- Generic Access: 0x1800
- Generic Attribute: 0x1801
- Battery Service: 0x180F
- Device Information: 0x180A

### Custom Services
- **0xFFF0**: Command/Response service
  - 0xFFF1: NOTIFY (responses)
  - 0xFFF2: WRITE (commands)

- **f000ffe0-0451-4000-b000-000000000000**: Data transfer
  - f000ffe1: WRITE (data chunks)
  - f000ffe2: NOTIFY (status)

- **8d53dc1d-1db7-4cd3-868b-8a527460aa84**: MCUmgr SMP
  - da2e7828-fbce-4e01-ae9e-261174997c48: SMP characteristic

## 6. MCUmgr Support

The firmware includes full MCUmgr support:

| Group | Name | ID |
|-------|------|-----|
| OS | mcumgr_os_grp | 0x00 |
| Image | mcumgr_img_grp | 0x01 |
| Filesystem | mcumgr_fs_grp | 0x08 |
| Shell | mcumgr_shell_grp | 0x09 |

## 7. THE BUG: Why Non-GIFs Brick the Device

### Root Cause
There is **NO VALIDATION** between receiving data and writing to flash.

### Evidence
```
1. 'Received length: %u bytes'     <- Just logs the size
2. 'Total written so far: %d'      <- Writes blindly
3. 'Full transfer complete'        <- No format check here!
4. 'Starting GIF decoder...'       <- Assumes it's a GIF
5. CRASH if not valid GIF
```

### What Should Happen
```c
// BEFORE writing to flash:
if (memcmp(data, "GIF89a", 6) != 0 && 
    memcmp(data, "GIF87a", 6) != 0) {
    return ERROR_INVALID_FORMAT;  // REJECT!
}
```

## 8. Hardware Summary

| Component | Part | Details |
|-----------|------|---------|
| MCU | nRF52840 | ARM Cortex-M4F @ 64MHz |
| Display | GC9A01 | 240x240 IPS, SPI |
| Flash | GD25Q128 | 16MB QSPI |
| Filesystem | LittleFS | On external flash |
| RTOS | Zephyr | v3.7.0 |
| Bootloader | MCUboot | v0.0.0 |
