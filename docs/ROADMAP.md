# OpenDOTT Roadmap

Now that we've cracked the upload protocol, here's what we can do next!

## ✅ Completed

- [x] Reverse engineer BLE protocol
- [x] Working Python upload tool
- [x] Full protocol documentation
- [x] GIF validation (prevent bricking)

## 🚀 Immediate Improvements (No Firmware Needed)

### 1. Enhanced Upload Tool
- [ ] GUI application (Electron/Tauri)
- [ ] Drag-and-drop GIF upload
- [ ] Auto-resize images to 240x240
- [ ] Convert PNG/JPEG → GIF automatically
- [ ] Preview before upload
- [ ] Animation speed adjustment

### 2. Mobile Apps
- [ ] React Native app (iOS + Android)
- [ ] Camera → GIF pipeline
- [ ] GIF library/favorites
- [ ] Share GIFs between users

### 3. GIF Generation Tools
- [ ] Text → GIF generator
- [ ] Clock/time display
- [ ] Weather widget
- [ ] Notification display (sync from phone)
- [ ] QR code display
- [ ] Custom animation builder

### 4. Integration
- [ ] Home Assistant integration
- [ ] IFTTT/Zapier support
- [ ] Discord bot for uploads
- [ ] API server for remote control

## 🔧 Firmware Investigation

### What We Know
- **MCU:** nRF52840 (ARM Cortex-M4F)
- **RTOS:** Zephyr v3.7.0
- **Bootloader:** MCUboot
- **Flash:** 16MB external (GD25Q128)
- **Display:** GC9A01 240x240

### Firmware Modification Options

#### Option A: Custom Firmware from Scratch
**Difficulty:** Hard | **Risk:** Medium

Build a complete replacement firmware using Zephyr:
- Full control over device behavior
- Add new features (notifications, clock, etc.)
- Fix bugs and improve GIF playback
- Requires understanding of all hardware

**Pros:**
- Complete control
- Can add any feature
- Better optimization possible

**Cons:**
- Lots of work
- Need to reverse-engineer hardware details
- Risk of bricking without recovery

#### Option B: Patch Existing Firmware
**Difficulty:** Very Hard | **Risk:** High

Modify the existing firmware binary:
- Find and patch specific functions
- Add new code in unused space
- Keep existing functionality

**Pros:**
- Leverages existing code
- Less reverse engineering needed

**Cons:**
- Very complex
- Limited space for new code
- Hard to debug

#### Option C: MCUmgr Shell Access
**Difficulty:** Medium | **Risk:** Low

Use the existing MCUmgr/SMP interface:
- Device has shell support
- May allow filesystem access
- Could modify GIFs on-device

**Pros:**
- No firmware modification needed
- Uses existing functionality
- Low risk

**Cons:**
- Limited to what's already exposed
- May not be fully enabled

### Recommended Path

1. **First: Explore MCUmgr shell** - See what's accessible without firmware changes
2. **Then: Set up Zephyr build** - Get the toolchain ready
3. **Create: Minimal test firmware** - Blink LED or show solid color
4. **Build: Feature-complete replacement** - Once test works

## 📦 Custom Firmware Features

If we build custom firmware, here's what we could add:

### Display Improvements
- [ ] Faster GIF playback
- [ ] Multiple GIF slots (switch with button)
- [ ] Smooth transitions between GIFs
- [ ] Brightness control
- [ ] Power-saving sleep mode

### New Display Modes
- [ ] Digital clock
- [ ] Analog clock face
- [ ] Countdown timer
- [ ] Stopwatch
- [ ] Battery indicator overlay
- [ ] Notification icons
- [ ] Text messages
- [ ] QR codes

### Connectivity
- [ ] BLE notifications (phone → DOTT)
- [ ] Find my DOTT (beep/flash)
- [ ] Multiple device pairing
- [ ] Mesh networking between DOTTs?

### Power Management
- [ ] Deep sleep when idle
- [ ] Scheduled on/off times
- [ ] Battery optimization
- [ ] USB power detection

### Button Functions
- [ ] Cycle through stored GIFs
- [ ] Quick presets
- [ ] Brightness control
- [ ] Power off

## 🔌 Hardware Mods

With physical access:
- [ ] Add vibration motor
- [ ] Add speaker/buzzer
- [ ] Larger battery
- [ ] Reset button access
- [ ] JTAG/SWD debug header

## 📱 Companion App Features

### Phase 1: Basic
- Connect to DOTT
- Browse GIF library
- Upload GIFs
- Device info/battery

### Phase 2: Creation
- Take photo → animate
- Text → GIF
- Draw custom frames
- Templates

### Phase 3: Social
- Share GIFs with friends
- Public GIF gallery
- DOTT user profiles
- "Send to friend's DOTT"

## 🛡️ Safety Features

Already implemented:
- [x] GIF validation before upload
- [x] Block non-GIF files

To add:
- [ ] Firmware backup before update
- [ ] Recovery mode instructions
- [ ] Hardware reset documentation

## 📚 Documentation

- [x] BLE Protocol spec
- [x] Hardware info
- [ ] Build instructions (Zephyr)
- [ ] API reference
- [ ] Contribution guide
- [ ] User manual

---

## Next Steps for You

1. **Try the MCUmgr shell** - See if we can poke around on-device
2. **Set up Zephyr toolchain** - Get ready for firmware dev
3. **Design the features you want most** - What would make YOUR DOTT better?
4. **Build the GUI tool** - Make uploading easier for everyone

What do you want to tackle first? 🚀
