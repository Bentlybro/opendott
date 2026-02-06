# OpenDOTT Python Tools

Command-line tools for interacting with DOTT wearable displays.

## Requirements

```bash
pip install bleak
```

## Tools

### dott_upload.py - Upload Images

Upload GIF images to your DOTT device:

```bash
# Scan and upload
python dott_upload.py upload image.gif

# Upload to specific device
python dott_upload.py upload image.gif -a E2:E2:B4:44:D5:30

# Validate without uploading
python dott_upload.py validate image.gif

# Get device info
python dott_upload.py info
```

**GIF Requirements:**
- Format: GIF87a or GIF89a
- Size: 240×240 pixels
- **Important:** Must have full frames (no delta/optimized frames)

Use `gifsicle --unoptimize input.gif -o output.gif` to fix optimized GIFs.

### dott_discover.py - Discover Devices

Scan for DOTT devices and show their services:

```bash
python dott_discover.py
```

### dott_flash.py - Firmware Flashing

Flash firmware via BLE DFU (requires DFU mode):

```bash
python dott_flash.py firmware.bin
```

## Test Files

- `full_frames.gif` - Working test GIF (4 frames, full 240×240)
- `test_image.gif` - Example GIF (may have partial frames)

## Protocol

See [docs/BLE_PROTOCOL.md](../docs/BLE_PROTOCOL.md) for full protocol documentation.
