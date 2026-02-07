# Reverse Engineering Notes

## Firmware Analysis

### Source

- **File:** `release2.0_1.bin`
- **Size:** 263,192 bytes
- **Format:** MCUboot image

### MCUboot Header

```
Offset 0x000: MCUboot header (512 bytes)
  Magic:       0x96f3b83d (valid)
  Load Addr:   0x00000000
  Header Size: 512
  Image Size:  262,344 bytes
  Version:     0.0.0+0 (unversioned!)
  Flags:       0x00000000
```

### Identified Components

| Component | Evidence |
|-----------|----------|
| nRF52840 | String: "nrf52840" |
| Zephyr RTOS | String: "Zephyr version %s", "*** Booting Zephyr OS build v3.7.0 ***" |
| MCUboot | Partition strings, boot_set_next references |
| LittleFS | String: "LittleFS version %u.%u" |
| AnimatedGIF | String: "AnimatedGIF", GIF parsing functions |
| GC9A01 | String: "gc9a01@0", "display_gc9x01x" |
| GD25Q128 | String: "GD25Q128", JEDEC ID in code |

### Key Strings Found

```
# BLE
"Dott"
"Dott_V2_Atin"
"custom_service initialization failed."
"Advertising successfully started"
"Bluetooth failed to initialise: %d"

# Transfer
"Received length: %u bytes"
"Total written so far: %d bytes"
"Still waiting: total_written = %d, expected = %d"
"Full transfer complete. Processing..."
"Transfer Complete"
"Transfer Fail"

# GIF Processing
"Starting GIF decoder..."
"External flash ready, proceeding to play GIF"
"Successfully opened GIF"
"Image size: %d x %d"
"GIF_openFlash: Invalid flash device"

# Errors
"Error writing chunk to display: %i"
"Flash write failed at 0x%08lx"
"External flash not ready, cannot play GIF"

# Debug
"(GIF created with https://ezgif.com/maker"  <- In embedded test GIF!
```

### Embedded GIF

A test GIF was found embedded in the firmware:

- **Offset:** 0x3F96A
- **Format:** GIF89a
- **Dimensions:** 240x240 pixels
- **Size:** ~1020 bytes
- **Comment:** "GIF created with https://ezgif.com/maker"

### The Bug: Why Non-GIFs Brick the Device

Based on string analysis, the data flow is:

1. BLE receives data chunks
2. Data written directly to flash (`Successfully wrote %u to flash offset 0x%08lX`)
3. After complete: `"Full transfer complete. Processing..."`
4. GIF decoder called: `"Starting GIF decoder..."`
5. Decoder tries to open: `GIF_openFlash()`

**The problem:** There is NO validation of the data format before step 2.
The code writes anything to flash, then tries to parse it as a GIF.

If the data isn't a valid GIF:
- AnimatedGIF library fails to parse
- Possible crash, memory corruption, or undefined behavior
- Bad data persists in flash
- On next boot, same crash happens
- **Device bricked**

### BLE Protocol (Partial)

Based on strings, the transfer protocol appears to be:

1. **Start transfer:** Send expected file size
2. **Data chunks:** Write to "Image Data" characteristic
3. **Progress tracking:** Firmware tracks `total_written` vs `expected`
4. **Completion:** Firmware processes when sizes match

**Service:** Custom GATT service (UUIDs not yet extracted)

**Characteristics (estimated):**
- Image Data (Write without response)
- Transfer Control (Write/Notify)
- Device Info (Read)

## BLE Sniffing TODO

To complete the protocol documentation:

1. Use nRF Connect app to discover service/characteristic UUIDs
2. Sniff BLE traffic during image upload
3. Document exact packet format
4. Verify chunk size and transfer protocol

## Disassembly Notes

The code section starts at offset 0x200 (after MCUboot header).

Initial vector table:
```
0x200: 40f6 0220  ; Initial SP
0x204: ad51 0100  ; Reset vector -> 0x000151ad
...
```

Full disassembly requires:
- ARM Cortex-M4 toolchain
- Ghidra or IDA Pro
- Zephyr symbol information would help

## Recovery Options

The original firmware has NO apparent recovery mechanism:

- No button combo for factory reset
- No USB DFU mode mentioned
- MCUboot present but update mechanism unclear

To unbrick a device:
1. Connect SWD debugger to debug pads (if present)
2. Flash new firmware directly
3. Or flash via MCUboot serial recovery mode

## Files

| File | Description |
|------|-------------|
| `release2.0.bin` | Original firmware |
| `code.bin` | Code section (no MCUboot header) |
| `embedded.gif` | Extracted test GIF |
| `ANALYSIS.md` | Full analysis summary |
