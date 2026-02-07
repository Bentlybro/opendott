# Building OpenDOTT Firmware

## Prerequisites

### 1. Install Zephyr SDK

Follow the official Zephyr getting started guide:
https://docs.zephyrproject.org/latest/develop/getting_started/index.html

Or use the nRF Connect SDK (recommended for nRF52840):
https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/installation.html

### 2. Set up the environment

```bash
# Clone Zephyr (if not using nRF Connect SDK)
west init ~/zephyrproject
cd ~/zephyrproject
west update

# Set up environment
source ~/zephyrproject/zephyr/zephyr-env.sh
```

### 3. Clone OpenDOTT

```bash
git clone https://github.com/Bentlybro/opendott.git
cd opendott
```

## Building

### Using West (Zephyr build system)

```bash
# Build for OpenDOTT board
west build -b opendott

# Or build with verbose output
west build -b opendott -- -DCMAKE_VERBOSE_MAKEFILE=ON
```

### Manual CMake build

```bash
mkdir build && cd build
cmake -GNinja -DBOARD=opendott ..
ninja
```

## Output files

After successful build:
- `build/zephyr/zephyr.hex` - Full firmware image
- `build/zephyr/zephyr.bin` - Binary image
- `build/zephyr/zephyr.uf2` - UF2 for drag-drop programming
- `build/zephyr/merged.hex` - Merged with bootloader (if applicable)

## Flashing

### Option 1: J-Link / SWD

```bash
west flash
```

### Option 2: MCUboot DFU (Over BLE)

```bash
# Generate DFU package
west sign -t imgtool -- --key <signing-key> 

# Use nRF Connect app or mcumgr to upload
mcumgr --conntype ble --connstring <device-address> image upload build/zephyr/zephyr.signed.bin
```

### Option 3: USB DFU (if in bootloader mode)

```bash
# Put device in bootloader mode (usually hold button while connecting USB)
nrfutil dfu usb-serial -pkg firmware.zip -p /dev/ttyACM0
```

## Configuration

### Changing settings

Edit `prj.conf` for build-time configuration:
- `CONFIG_BT_DEVICE_NAME` - Bluetooth device name
- `CONFIG_LOG_DEFAULT_LEVEL` - Logging verbosity (0-4)

### Board-specific settings

Edit files in `boards/arm/opendott/`:
- `opendott.dts` - Device tree (pin assignments, peripherals)
- `opendott_defconfig` - Default Kconfig options

## Debugging

### RTT Logging

```bash
# Start JLink RTT viewer
JLinkRTTClient
```

### USB Serial Console

```bash
# Connect to USB CDC ACM console
screen /dev/ttyACM0 115200
# or
minicom -D /dev/ttyACM0 -b 115200
```

### GDB Debugging

```bash
west debug
```

## Troubleshooting

### Build fails with missing headers

Make sure you've sourced the Zephyr environment:
```bash
source ~/zephyrproject/zephyr/zephyr-env.sh
```

### Device not found

1. Check USB connection
2. Verify J-Link/debugger is connected
3. Try `west flash --recover` to recover a bricked device

### Bluetooth not advertising

1. Check that CONFIG_BT=y in prj.conf
2. Verify advertising is started in code
3. Check for errors in console output

## Development Workflow

1. Make changes to source files
2. Build: `west build`
3. Flash: `west flash`
4. Monitor: `screen /dev/ttyACM0 115200`
5. Test with upload tool: `python dott_upload.py test.gif`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on real hardware
5. Submit a pull request
