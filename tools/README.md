# DOTT Tools

Python tools for interacting with the DOTT wearable via Bluetooth LE.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

### Scan for devices

```bash
python dott_upload.py scan
```

### Get device info

```bash
python dott_upload.py info
# or with specific address:
python dott_upload.py info -a XX:XX:XX:XX:XX:XX
```

### Test connection and protocols

```bash
python dott_upload.py test
```

This will try:
- SMP Echo command
- Image state query
- Filesystem read
- Various raw write formats

### Upload an image

```bash
python dott_upload.py upload image.gif
```

Tries multiple methods:
1. MCUmgr Filesystem (SMP Group 8)
2. Custom service (f000ffe1)

## Protocol Notes

### MCUmgr SMP

The device supports Zephyr's MCUmgr protocol over BLE:

- **Service UUID:** `8d53dc1d-1db7-4cd3-868b-8a527460aa84`
- **Characteristic:** `da2e7828-fbce-4e01-ae9e-261174997c48`

Packet format:
```
[Op:1][Flags:1][Len:2][Group:2][Seq:1][Cmd:1][CBOR payload...]
```

### Custom Services

Two custom services for data transfer:

1. **TI-style:** `f000ffe0-0451-4000-b000-000000000000`
   - Write: `f000ffe1-...`
   - Notify: `f000ffe2-...`

2. **Legacy:** `0xFFF0`
   - Notify: `0xFFF1`
   - Write: `0xFFF2`

## Troubleshooting

### "bleak not installed"
```bash
pip install bleak
```

### "cbor2 not installed"
```bash
pip install cbor2
```

### No devices found
- Make sure DOTT is powered on
- Check if it's already connected to another device
- Try moving closer to the device

### GATT errors (0xA0, 0xA4)
- The device expects structured packets, not raw data
- These errors indicate invalid operation or format
